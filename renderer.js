/**
 * Renderer — UI logic, OpenAI calls via preload bridge (callAI).
 */

// Last parsed meeting result (for follow-up email)
let lastMeetingActions = [];

// Last generated PPT slide data (for download)
let lastPptSlides = [];

/** Meeting analysis system prompt (user-specified JSON shape). */
const MEETING_SYSTEM_PROMPT = `Extract the following from the meeting transcript:
1. Summary (short paragraph)
2. Action items (list)
3. Owner for each action (if available)
4. Deadlines (if mentioned)

Return ONLY valid JSON in this format:
{
  "summary": "",
  "actions": [
    {
      "task": "",
      "owner": "",
      "deadline": ""
    }
  ]
}`;

const SAMPLE_MEETING = `Team Sync — March 28, 2026

Alex: Thanks everyone. Quick standup on the billing rollout.

Jordan: API migration is done. We need QA to run regression by Friday EOD.

Alex: Great. Sam, can you own the client comms?

Sam: Yes. I'll send the notice to enterprise customers by Thursday.

Jordan: There's one blocker — the legacy webhook still times out. I'll pair with Morgan today to fix it.

Morgan: Works for me. Target fix by Wednesday COB.

Alex: Perfect. Reminder: design review for the dashboard refresh is Monday 10am. Priya, you'll present.

Priya: On it. I'll share the Figma link tomorrow morning.

Alex: Cool. Anything else?

Sam: We should document the rollback steps. I'll draft and share by end of week.

Alex: Thanks. Let's ship it.`;

const SAMPLE_EMAIL = `Subject: Invoice #8842 — payment not reflected

Hi Support,

I paid invoice #8842 last Tuesday via ACH. The money left my bank but your portal still shows "Outstanding". Our accounting team needs this cleared before month-end close.

Please confirm receipt and update the status, or let me know what reference number you need.

Thanks,
Riley Chen
Finance Ops, Northwind LLC`;

const PPT_TEMPLATE_LABELS = {
  modern: 'Modern Gradient',
  minimal: 'Minimal Clean',
  dark: 'Dark Pro',
};

const SAMPLE_PPT_CONTENT = `Internal pitch: Quill rollout (Q2)

We are launching Quill as the default desktop assistant for meeting notes and customer email drafts. Goals: cut follow-up time by 40%, standardize action tracking, and reduce tone inconsistencies in support replies.

Target users: team leads, PMs, and tier-1 support. Success metrics: weekly active users, average time from meeting end to summary sent, and CSAT on outbound replies.

Rollout in three waves: pilot (50 users), department expansion, then company-wide. Training will be two short videos plus office hours.

Risks: API cost spikes, change management fatigue, and privacy questions about transcripts. Mitigations: usage dashboards, executive sponsors, and clear data-handling FAQ.

Ask: approve pilot headcount and comms plan by Friday. Next step: schedule kickoff with IT for SSO-ready builds.`;

/**
 * Calls OpenAI via main process (fetch + API key stay in main).
 * @param {string} userContent - User message content
 * @param {string} [systemContent] - Optional system message
 * @returns {Promise<string>}
 */
async function callAI(userContent, systemContent) {
  const api = window.electronAPI;
  if (!api?.openaiChat) {
    throw new Error('electronAPI.openaiChat is not available. Check preload and contextIsolation.');
  }

  const messages = [];
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }
  messages.push({ role: 'user', content: userContent });

  const result = await api.openaiChat(messages, { temperature: 0.4 });
  if (!result.ok) {
    throw new Error(result.error || 'Unknown API error');
  }
  return result.text || '';
}

/** Strip markdown fences and isolate JSON object from model output. */
function extractJsonText(raw) {
  const t = String(raw).trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);
  return t;
}

function parseMeetingJson(text) {
  const jsonStr = extractJsonText(text);
  const data = JSON.parse(jsonStr);
  if (typeof data.summary !== 'string') data.summary = '';
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

/** Parse and normalize PPT JSON from the model. */
function parsePptJson(text) {
  const jsonStr = extractJsonText(text);
  const data = JSON.parse(jsonStr);
  if (!data || typeof data !== 'object') throw new Error('Invalid response: not an object.');
  if (!Array.isArray(data.slides)) throw new Error('Invalid response: missing "slides" array.');

  const slides = data.slides.map((s, i) => {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    let bullets = Array.isArray(s?.bullets) ? s.bullets.map((b) => String(b ?? '').trim()).filter(Boolean) : [];
    if (bullets.length > 5) bullets = bullets.slice(0, 5);
    return {
      title: title || `Slide ${i + 1}`,
      bullets: bullets.length ? bullets : ['(No bullet points provided)'],
    };
  });

  return slides;
}

function renderPptPreview(slides) {
  const el = document.getElementById('ppt-preview');
  el.innerHTML = slides
    .map(
      (s, idx) => `
    <div class="ppt-slide-card">
      <h4>${idx + 1}. ${escapeHtml(s.title)}</h4>
      <ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('');
}

function pptPreviewAsPlainText(slides) {
  return slides
    .map((s, i) => {
      const lines = [`${i + 1}. ${s.title}`, ...s.bullets.map((b) => `   • ${b}`)];
      return lines.join('\n');
    })
    .join('\n\n');
}

function renderMeetingOutput(data) {
  const el = document.getElementById('meeting-output');
  const items = (data.actions || [])
    .map((a) => {
      const task = escapeHtml(a.task || '');
      const owner = a.owner ? escapeHtml(a.owner) : '—';
      const deadline = a.deadline ? escapeHtml(a.deadline) : '—';
      return `<li><strong>${task}</strong><br /><span class="meta">Owner: ${owner} · Deadline: ${deadline}</span></li>`;
    })
    .join('');

  el.innerHTML = `
    <h3>Summary</h3>
    <p>${escapeHtml(data.summary || '')}</p>
    <h3>Action items</h3>
    <ul>${items || '<li class="meta">No action items extracted.</li>'}</ul>
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideError(id) {
  const el = document.getElementById(id);
  el.classList.add('hidden');
  el.textContent = '';
}

function setLoading(id, on) {
  document.getElementById(id).classList.toggle('hidden', !on);
}

/** Reset meeting tab: transcript, results, errors, loading, action state. */
function clearMeetingWorkspace() {
  document.getElementById('meeting-input').value = '';
  document.getElementById('meeting-analysis-custom').value = '';
  document.getElementById('followup-custom').value = '';
  document.getElementById('meeting-output').innerHTML = '';
  hideError('meeting-error');
  setLoading('meeting-loading', false);
  document.getElementById('btn-followup-email').disabled = true;
  document.getElementById('btn-copy-meeting').disabled = true;
  lastMeetingActions = [];
}

/** Reset email tab: message, reply, tone default, errors, loading. */
function clearEmailWorkspace() {
  document.getElementById('email-input').value = '';
  document.getElementById('email-reply-custom').value = '';
  document.getElementById('email-output').textContent = '';
  document.getElementById('tone-select').value = 'Professional';
  hideError('email-error');
  setLoading('email-loading', false);
  document.getElementById('btn-copy-email').disabled = true;
}

function clearPptWorkspace() {
  document.getElementById('ppt-input').value = '';
  document.getElementById('ppt-template-select').value = 'modern';
  document.getElementById('ppt-slide-count').value = '6';
  document.getElementById('ppt-preview').innerHTML = '';
  hideError('ppt-error');
  setLoading('ppt-loading', false);
  document.getElementById('btn-download-ppt').disabled = true;
  document.getElementById('btn-copy-ppt').disabled = true;
  lastPptSlides = [];
}

function hidePwGateError() {
  const el = document.getElementById('pw-gate-error');
  el.classList.add('hidden');
  el.textContent = '';
}

function showPwGateError(message) {
  const el = document.getElementById('pw-gate-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

function clearPasswordForm() {
  document.getElementById('pw-entry-id').value = '';
  document.getElementById('pw-title').value = '';
  document.getElementById('pw-username').value = '';
  document.getElementById('pw-password').value = '';
  document.getElementById('pw-url').value = '';
  document.getElementById('pw-notes').value = '';
  document.getElementById('pw-form-heading').textContent = 'New entry';
}

function clearPasswordWorkspace() {
  hidePwGateError();
  document.getElementById('pw-master-new').value = '';
  document.getElementById('pw-master-confirm').value = '';
  document.getElementById('pw-master-unlock').value = '';
  clearPasswordForm();
  document.getElementById('pw-search').value = '';
}

let pwEntriesCache = [];

function getPasswordApi() {
  const api = window.electronAPI;
  if (!api?.passwordVaultStatus) {
    throw new Error('Password vault is not available. Check preload.');
  }
  return api;
}

async function refreshPasswordVaultGate() {
  const api = getPasswordApi();
  hidePwGateError();
  try {
    const st = await api.passwordVaultStatus();
    if (!st.ok) {
      showPwGateError(st.error || 'Could not read vault status.');
      return;
    }
    if (st.unlocked) {
      document.getElementById('pw-locked').classList.add('hidden');
      document.getElementById('pw-open').classList.remove('hidden');
      await refreshPasswordList();
      return;
    }
    document.getElementById('pw-open').classList.add('hidden');
    document.getElementById('pw-locked').classList.remove('hidden');
    pwEntriesCache = [];
    document.getElementById('pw-list').innerHTML = '';
    document.getElementById('pw-list-empty').classList.remove('hidden');
    if (st.exists) {
      document.getElementById('pw-flow-create').classList.add('hidden');
      document.getElementById('pw-flow-unlock').classList.remove('hidden');
    } else {
      document.getElementById('pw-flow-unlock').classList.add('hidden');
      document.getElementById('pw-flow-create').classList.remove('hidden');
    }
  } catch (e) {
    showPwGateError(e.message || String(e));
  }
}

async function refreshPasswordList() {
  const api = getPasswordApi();
  const res = await api.passwordVaultList();
  if (!res.ok) return;
  pwEntriesCache = Array.isArray(res.entries) ? res.entries : [];
  pwEntriesCache.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderPasswordList();
}

function formatPwUpdated(ts) {
  if (ts == null || ts === '') return '';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

const PW_ICONS = {
  user:
    '<svg class="pw-card-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  link:
    '<svg class="pw-card-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  note:
    '<svg class="pw-card-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
  copy:
    '<svg class="pw-btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  userBtn:
    '<svg class="pw-btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  edit:
    '<svg class="pw-btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash:
    '<svg class="pw-btn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

function renderPasswordList() {
  const listEl = document.getElementById('pw-list');
  const emptyEl = document.getElementById('pw-list-empty');
  const q = document.getElementById('pw-search').value.trim().toLowerCase();
  const filtered = pwEntriesCache.filter((e) => {
    if (!q) return true;
    const hay = `${e.title} ${e.username} ${e.url} ${e.notes}`.toLowerCase();
    return hay.includes(q);
  });
  if (!filtered.length) {
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', pwEntriesCache.length > 0);
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.innerHTML = filtered
    .map((e) => {
      const title = e.title || 'Untitled';
      const initialRaw = title.trim().charAt(0) || '?';
      const initial = escapeHtml(initialRaw.toLocaleUpperCase());
      const when = formatPwUpdated(e.updatedAt);
      const whenHtml = when
        ? `<div class="pw-card-updated">Updated · ${escapeHtml(when)}</div>`
        : '';
      const userRow = e.username
        ? `<div class="pw-card-row">${PW_ICONS.user}<span class="pw-card-row-text">${escapeHtml(e.username)}</span></div>`
        : `<div class="pw-card-row">${PW_ICONS.user}<span class="pw-card-row-text meta">No username</span></div>`;
      let urlRow = '';
      if (e.url) {
        const href = escapeHtml(e.url);
        urlRow = `<div class="pw-card-row">${PW_ICONS.link}<span class="pw-card-row-text"><a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a></span></div>`;
      }
      const notesBlock = e.notes
        ? `<div class="pw-card-notes">${PW_ICONS.note}<p class="pw-card-notes-text">${escapeHtml(e.notes)}</p></div>`
        : '';
      return `
    <div class="pw-card" role="listitem" data-pw-id="${escapeHtml(e.id)}">
      <div class="pw-card-inner">
        <div class="pw-card-top">
          <div class="pw-card-avatar" aria-hidden="true">${initial}</div>
          <div class="pw-card-main">
            <h3 class="pw-card-title">${escapeHtml(title)}</h3>
            ${whenHtml}
            <div class="pw-card-rows">
              ${userRow}
              ${urlRow}
            </div>
            ${notesBlock}
          </div>
        </div>
        <div class="pw-card-actions">
          <button type="button" class="btn btn-ghost btn-sm btn-pw-copy-pass" data-id="${escapeHtml(e.id)}">${PW_ICONS.copy}<span>Password</span></button>
          <button type="button" class="btn btn-ghost btn-sm btn-pw-copy-user" data-id="${escapeHtml(e.id)}">${PW_ICONS.userBtn}<span>Username</span></button>
          <button type="button" class="btn btn-ghost btn-sm btn-pw-edit" data-id="${escapeHtml(e.id)}">${PW_ICONS.edit}<span>Edit</span></button>
          <button type="button" class="btn btn-clear-header btn-sm btn-pw-delete" data-id="${escapeHtml(e.id)}">${PW_ICONS.trash}<span>Delete</span></button>
        </div>
      </div>
    </div>`;
    })
    .join('');

  listEl.querySelectorAll('.btn-pw-copy-pass').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        const api = getPasswordApi();
        const r = await api.passwordVaultCopyPassword({ id });
        if (!r.ok) throw new Error(r.error || 'Copy failed');
      } catch (err) {
        alert(err.message || String(err));
      }
    });
  });
  listEl.querySelectorAll('.btn-pw-copy-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const entry = pwEntriesCache.find((x) => x.id === id);
      if (!entry?.username) return;
      try {
        await navigator.clipboard.writeText(entry.username);
      } catch {
        alert('Could not copy username.');
      }
    });
  });
  listEl.querySelectorAll('.btn-pw-edit').forEach((btn) => {
    btn.addEventListener('click', () => void loadPasswordEntryForEdit(btn.getAttribute('data-id')));
  });
  listEl.querySelectorAll('.btn-pw-delete').forEach((btn) => {
    btn.addEventListener('click', () => void deletePasswordEntry(btn.getAttribute('data-id')));
  });
}

async function loadPasswordEntryForEdit(id) {
  const entry = pwEntriesCache.find((x) => x.id === id);
  if (!entry) return;
  document.getElementById('pw-entry-id').value = entry.id;
  document.getElementById('pw-title').value = entry.title || '';
  document.getElementById('pw-username').value = entry.username || '';
  document.getElementById('pw-url').value = entry.url || '';
  document.getElementById('pw-notes').value = entry.notes || '';
  document.getElementById('pw-form-heading').textContent = 'Edit entry';
  try {
    const api = getPasswordApi();
    const r = await api.passwordVaultGetPassword({ id: entry.id });
    if (!r.ok) throw new Error(r.error || 'Could not read password');
    document.getElementById('pw-password').value = r.password || '';
  } catch (e) {
    document.getElementById('pw-password').value = '';
    alert(e.message || String(e));
  }
}

async function deletePasswordEntry(id) {
  if (!window.confirm('Delete this entry? This cannot be undone.')) return;
  try {
    const api = getPasswordApi();
    const r = await api.passwordVaultDelete({ id });
    if (!r.ok) throw new Error(r.error || 'Delete failed');
    clearPasswordForm();
    await refreshPasswordList();
  } catch (e) {
    alert(e.message || String(e));
  }
}

document.getElementById('btn-pw-create').addEventListener('click', async () => {
  hidePwGateError();
  try {
    const api = getPasswordApi();
    const masterPassword = document.getElementById('pw-master-new').value;
    const confirmPassword = document.getElementById('pw-master-confirm').value;
    const r = await api.passwordVaultCreate({ masterPassword, confirmPassword });
    if (!r.ok) throw new Error(r.error || 'Could not create vault');
    document.getElementById('pw-master-new').value = '';
    document.getElementById('pw-master-confirm').value = '';
    await refreshPasswordVaultGate();
  } catch (e) {
    showPwGateError(e.message || String(e));
  }
});

document.getElementById('btn-pw-unlock').addEventListener('click', async () => {
  hidePwGateError();
  try {
    const api = getPasswordApi();
    const masterPassword = document.getElementById('pw-master-unlock').value;
    const r = await api.passwordVaultUnlock({ masterPassword });
    if (!r.ok) throw new Error(r.error || 'Could not unlock');
    document.getElementById('pw-master-unlock').value = '';
    await refreshPasswordVaultGate();
  } catch (e) {
    showPwGateError(e.message || String(e));
  }
});

document.getElementById('btn-pw-lock').addEventListener('click', async () => {
  try {
    const api = getPasswordApi();
    await api.passwordVaultLock();
    clearPasswordForm();
    await refreshPasswordVaultGate();
  } catch (e) {
    alert(e.message || String(e));
  }
});

document.getElementById('btn-pw-new').addEventListener('click', () => {
  clearPasswordForm();
});

document.getElementById('btn-pw-generate').addEventListener('click', async () => {
  try {
    const api = getPasswordApi();
    const len = document.getElementById('pw-gen-length').value;
    const r = await api.passwordVaultGenerate({ length: len });
    if (!r.ok) throw new Error(r.error || 'Generate failed');
    document.getElementById('pw-password').value = r.password || '';
  } catch (e) {
    alert(e.message || String(e));
  }
});

document.getElementById('pw-show-password').addEventListener('change', (ev) => {
  const input = document.getElementById('pw-password');
  input.type = ev.target.checked ? 'text' : 'password';
});

document.getElementById('btn-pw-save').addEventListener('click', async () => {
  try {
    const api = getPasswordApi();
    const id = document.getElementById('pw-entry-id').value.trim();
    const payload = {
      id: id || undefined,
      title: document.getElementById('pw-title').value,
      username: document.getElementById('pw-username').value,
      password: document.getElementById('pw-password').value,
      url: document.getElementById('pw-url').value,
      notes: document.getElementById('pw-notes').value,
    };
    const r = await api.passwordVaultSaveEntry(payload);
    if (!r.ok) throw new Error(r.error || 'Save failed');
    clearPasswordForm();
    await refreshPasswordList();
  } catch (e) {
    alert(e.message || String(e));
  }
});

document.getElementById('pw-search').addEventListener('input', () => renderPasswordList());

function getActiveTabName() {
  const t = document.querySelector('.tab.active');
  return t ? t.dataset.tab : 'meeting';
}

/** Append optional user instructions to a prompt body. */
function withOptionalInstructions(base, heading, instructions) {
  const t = String(instructions ?? '').trim();
  if (!t) return base;
  return `${base}\n\n---\n${heading}\n${t}`;
}

function sanitizeSlideCount(value) {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return 6;
  return Math.min(12, Math.max(3, n));
}

function buildPptSystemPrompt(template, count) {
  const chosenTemplate = PPT_TEMPLATE_LABELS[template] ? template : 'modern';
  const templateName = PPT_TEMPLATE_LABELS[chosenTemplate];
  return `Convert the following content into a business presentation.

Design style:
- Template: ${templateName}
- Make slides visually polished and presentation-ready
- Keep a consistent visual voice across all slides

Rules:
- Exactly ${count} slides
- Each slide:
  - Title
  - 3-5 bullet points
- Keep concise and professional

Return ONLY valid JSON in this format:
{
  "slides": [
    {
      "title": "",
      "bullets": ["", "", ""]
    }
  ]
}`;
}

function enforceSlideCount(slides, count) {
  const target = sanitizeSlideCount(count);
  const normalized = Array.isArray(slides) ? slides.slice(0, target) : [];
  while (normalized.length < target) {
    normalized.push({
      title: `Slide ${normalized.length + 1}`,
      bullets: ['(Add key point)', '(Add supporting point)', '(Add next action)'],
    });
  }
  return normalized;
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.panel').forEach((p) => {
      const active = p.id === `panel-${name}`;
      p.classList.toggle('active', active);
      p.hidden = !active;
    });
    if (name === 'passwords') {
      void refreshPasswordVaultGate();
    }
  });
});

// --- Clear workspace ---
document.getElementById('btn-clear-workspace').addEventListener('click', () => {
  const tab = getActiveTabName();
  if (tab === 'email') clearEmailWorkspace();
  else if (tab === 'ppt') clearPptWorkspace();
  else if (tab === 'passwords') clearPasswordWorkspace();
  else clearMeetingWorkspace();
});

document.getElementById('btn-clear-meeting').addEventListener('click', () => {
  clearMeetingWorkspace();
});

document.getElementById('btn-clear-email').addEventListener('click', () => {
  clearEmailWorkspace();
});

document.getElementById('btn-clear-ppt').addEventListener('click', () => {
  clearPptWorkspace();
});

// --- Meeting ---
document.getElementById('btn-sample-meeting').addEventListener('click', () => {
  document.getElementById('meeting-input').value = SAMPLE_MEETING;
});

document.getElementById('btn-analyze').addEventListener('click', async () => {
  const transcript = document.getElementById('meeting-input').value.trim();
  const out = document.getElementById('meeting-output');
  const btnFollow = document.getElementById('btn-followup-email');
  const btnCopy = document.getElementById('btn-copy-meeting');

  hideError('meeting-error');
  out.innerHTML = '';
  btnFollow.disabled = true;
  btnCopy.disabled = true;
  lastMeetingActions = [];

  if (!transcript) {
    showError('meeting-error', 'Paste a meeting transcript first.');
    return;
  }

  setLoading('meeting-loading', true);
  try {
    const analysisExtra = document.getElementById('meeting-analysis-custom').value;
    const userMessage = withOptionalInstructions(
      transcript,
      'Additional instructions from the user (apply when extracting summary, actions, owners, and deadlines):',
      analysisExtra,
    );
    const text = await callAI(userMessage, MEETING_SYSTEM_PROMPT);
    const data = parseMeetingJson(text);
    lastMeetingActions = data.actions || [];
    renderMeetingOutput(data);
    btnFollow.disabled = lastMeetingActions.length === 0;
    btnCopy.disabled = false;
  } catch (e) {
    showError('meeting-error', e.message || String(e));
  } finally {
    setLoading('meeting-loading', false);
  }
});

document.getElementById('btn-followup-email').addEventListener('click', async () => {
  hideError('meeting-error');
  if (!lastMeetingActions.length) {
    showError('meeting-error', 'Run “Analyze Meeting” first to extract action items.');
    return;
  }

  const payload = JSON.stringify({ actions: lastMeetingActions }, null, 2);
  const followExtra = document.getElementById('followup-custom').value;
  const userPrompt = withOptionalInstructions(
    `Write a professional follow-up email summarizing these action items and assigning responsibilities clearly.

Action items (JSON):
${payload}`,
    'Additional instructions for how to write this email (tone, length, audience, formatting, etc.):',
    followExtra,
  );

  setLoading('meeting-loading', true);
  try {
    const email = await callAI(userPrompt);
    // Show follow-up in meeting output area below existing content
    const out = document.getElementById('meeting-output');
    const block = document.createElement('div');
    block.innerHTML = `<h3>Follow-up email</h3><pre class="email-output" style="margin:0;white-space:pre-wrap">${escapeHtml(email)}</pre>`;
    out.appendChild(block);
  } catch (e) {
    showError('meeting-error', e.message || String(e));
  } finally {
    setLoading('meeting-loading', false);
  }
});

document.getElementById('btn-copy-meeting').addEventListener('click', async () => {
  const out = document.getElementById('meeting-output');
  const text = out.innerText || '';
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showError('meeting-error', 'Could not copy to clipboard.');
  }
});

// --- Email ---
document.getElementById('btn-sample-email').addEventListener('click', () => {
  document.getElementById('email-input').value = SAMPLE_EMAIL;
});

document.getElementById('btn-generate-reply').addEventListener('click', async () => {
  const body = document.getElementById('email-input').value.trim();
  const tone = document.getElementById('tone-select').value;
  const pre = document.getElementById('email-output');
  const btnCopy = document.getElementById('btn-copy-email');

  hideError('email-error');
  pre.textContent = '';
  btnCopy.disabled = true;

  if (!body) {
    showError('email-error', 'Paste an email or ticket first.');
    return;
  }

  const replyExtra = document.getElementById('email-reply-custom').value;
  const userPrompt = withOptionalInstructions(
    `Write a ${tone} reply to the following email or support request. Be clear, concise, and helpful.

---
${body}`,
    'Additional instructions from the user for this reply:',
    replyExtra,
  );

  setLoading('email-loading', true);
  try {
    const reply = await callAI(userPrompt);
    pre.textContent = reply;
    btnCopy.disabled = false;
  } catch (e) {
    showError('email-error', e.message || String(e));
  } finally {
    setLoading('email-loading', false);
  }
});

document.getElementById('btn-copy-email').addEventListener('click', async () => {
  const text = document.getElementById('email-output').textContent || '';
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showError('email-error', 'Could not copy to clipboard.');
  }
});

// --- PPT Generator ---
document.getElementById('btn-sample-ppt').addEventListener('click', () => {
  document.getElementById('ppt-input').value = SAMPLE_PPT_CONTENT;
});

document.getElementById('btn-generate-slides').addEventListener('click', async () => {
  const raw = document.getElementById('ppt-input').value.trim();
  const template = document.getElementById('ppt-template-select').value;
  const slideCount = sanitizeSlideCount(document.getElementById('ppt-slide-count').value);
  document.getElementById('ppt-slide-count').value = String(slideCount);
  hideError('ppt-error');
  document.getElementById('ppt-preview').innerHTML = '';
  document.getElementById('btn-download-ppt').disabled = true;
  document.getElementById('btn-copy-ppt').disabled = true;
  lastPptSlides = [];

  if (!raw) {
    showError('ppt-error', 'Paste or type some content to turn into slides.');
    return;
  }

  setLoading('ppt-loading', true);
  try {
    const text = await callAI(raw, buildPptSystemPrompt(template, slideCount));
    const slides = parsePptJson(text);
    if (!slides.length) {
      throw new Error('No slides were generated. Try again.');
    }
    lastPptSlides = enforceSlideCount(slides, slideCount);
    renderPptPreview(lastPptSlides);
    document.getElementById('btn-download-ppt').disabled = false;
    document.getElementById('btn-copy-ppt').disabled = false;
  } catch (e) {
    const msg = e instanceof SyntaxError ? 'Could not parse AI response as JSON. Try again.' : e.message || String(e);
    showError('ppt-error', msg);
  } finally {
    setLoading('ppt-loading', false);
  }
});

document.getElementById('btn-download-ppt').addEventListener('click', async () => {
  hideError('ppt-error');
  if (!lastPptSlides.length) {
    showError('ppt-error', 'Generate slides first.');
    return;
  }
  const api = window.electronAPI;
  if (!api?.savePPTX) {
    showError('ppt-error', 'savePPTX is not available. Check preload.');
    return;
  }
  try {
    const template = document.getElementById('ppt-template-select').value;
    const result = await api.savePPTX(lastPptSlides, { template });
    if (result.canceled) return;
    if (!result.ok) {
      showError('ppt-error', result.error || 'Could not save file.');
    }
  } catch (e) {
    showError('ppt-error', e.message || String(e));
  }
});

document.getElementById('btn-copy-ppt').addEventListener('click', async () => {
  if (!lastPptSlides.length) return;
  try {
    await navigator.clipboard.writeText(pptPreviewAsPlainText(lastPptSlides));
  } catch {
    showError('ppt-error', 'Could not copy to clipboard.');
  }
});

// --- Theme: Light / Dark / System (preference in localStorage) ---
const THEME_PREF_KEY = 'quill-theme-pref';

function getThemePref() {
  return localStorage.getItem(THEME_PREF_KEY) || 'system';
}

function getEffectiveTheme() {
  const pref = getThemePref();
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', getEffectiveTheme());
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    const active = btn.dataset.themePref === getThemePref();
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initTheme() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme();
  });
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      localStorage.setItem(THEME_PREF_KEY, btn.dataset.themePref);
      applyTheme();
    });
  });
}

initTheme();
