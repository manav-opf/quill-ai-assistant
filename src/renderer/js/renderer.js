import {
  MEETING_SYSTEM_PROMPT,
  SAMPLE_MEETING,
  SAMPLE_EMAIL,
  PPT_TEMPLATE_LABELS,
  SAMPLE_PPT_CONTENT,
  PW_ICONS,
  NOTES_STORAGE_KEY,
  NOTES_GRAMMAR_PREF_KEY,
  NOTES_GRAMMAR_MAX_CHARS,
  NOTES_GRAMMAR_SYSTEM,
  THEME_PREF_KEY,
} from './constants.js';

/**
 * Renderer — UI logic, OpenAI calls via preload bridge (callAI).
 *
 * File map (search for section headers `// ---`):
 * Meeting · Email · PPT · Passwords · Notes (incl. grammar) · Tabs · Clear · Theme
 *
 * Project layout: `src/main.js`, `src/preload.js`, `src/renderer/` (HTML, CSS, this file).
 * Static strings and keys: `constants.js`.
 */

// Last parsed meeting result (for follow-up email)
let lastMeetingActions = [];

// Last generated PPT slide data (for download)
let lastPptSlides = [];

/**
 * Calls OpenAI via main process (fetch + API key stay in main).
 * @param {string} userContent - User message content
 * @param {string} [systemContent] - Optional system message
 * @returns {Promise<string>}
 */
async function callAI(userContent, systemContent, aiOptions = {}) {
  const api = window.electronAPI;
  if (!api?.openaiChat) {
    throw new Error('electronAPI.openaiChat is not available. Check preload and contextIsolation.');
  }

  const messages = [];
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }
  messages.push({ role: 'user', content: userContent });

  const temperature = typeof aiOptions.temperature === 'number' ? aiOptions.temperature : 0.4;
  const result = await api.openaiChat(messages, { temperature });
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

// --- Notes (localStorage, this device only) ---
let notesList = [];
let activeNoteId = null;
let notesFlushTimer = null;
let notesGrammarPendingCorrected = null;

function loadNotesGrammarPref() {
  try {
    return localStorage.getItem(NOTES_GRAMMAR_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveNotesGrammarPref(on) {
  try {
    if (on) localStorage.setItem(NOTES_GRAMMAR_PREF_KEY, 'true');
    else localStorage.removeItem(NOTES_GRAMMAR_PREF_KEY);
  } catch (e) {
    console.warn('Could not save grammar assist preference', e);
  }
}

function parseNotesGrammarOutput(raw) {
  const t = String(raw).trim();
  const mark = '<<<CORRECTED>>>';
  const i = t.indexOf(mark);
  if (i === -1) {
    const jt = extractJsonText(t);
    try {
      const data = JSON.parse(jt);
      if (typeof data.corrected === 'string') return data.corrected;
    } catch {
      /* fall through */
    }
    throw new Error('Could not read grammar result. Try again.');
  }
  return t.slice(i + mark.length).replace(/^\s*\n/, '').trimEnd();
}

function notesGrammarDismiss() {
  notesGrammarPendingCorrected = null;
  const panel = document.getElementById('notes-grammar-panel');
  const applyBtn = document.getElementById('btn-notes-grammar-apply');
  const statusEl = document.getElementById('notes-grammar-status');
  panel?.classList.add('hidden');
  if (statusEl) statusEl.textContent = '';
  if (applyBtn) applyBtn.disabled = true;
}

function updateNotesGrammarUi() {
  const cb = document.getElementById('notes-grammar-enabled');
  const checkBtn = document.getElementById('btn-notes-grammar-check');
  if (!cb || !checkBtn) return;
  const on = cb.checked;
  const hasNote = !!activeNoteId;
  checkBtn.classList.toggle('hidden', !on);
  checkBtn.disabled = !on || !hasNote || checkBtn.dataset.loading === '1';
  if (!on) notesGrammarDismiss();
}

async function runNotesGrammarCheck() {
  const cb = document.getElementById('notes-grammar-enabled');
  if (!cb?.checked || !activeNoteId) return;
  const checkBtn = document.getElementById('btn-notes-grammar-check');
  const panel = document.getElementById('notes-grammar-panel');
  const statusEl = document.getElementById('notes-grammar-status');
  const applyBtn = document.getElementById('btn-notes-grammar-apply');
  if (!panel || !statusEl || !applyBtn || !checkBtn) return;
  const el = getNotesBodyEl();
  const gramPlain = noteHtmlToGrammarPlain(el.innerHTML);
  const trimmed = gramPlain.trim();
  if (!trimmed) {
    notesGrammarPendingCorrected = null;
    panel.classList.remove('hidden');
    statusEl.textContent = 'Write something in the note before checking grammar.';
    applyBtn.disabled = true;
    return;
  }
  if (gramPlain.length > NOTES_GRAMMAR_MAX_CHARS) {
    panel.classList.remove('hidden');
    statusEl.textContent = `Note is too long for a single check (max ${NOTES_GRAMMAR_MAX_CHARS.toLocaleString()} characters). Shorten the text or split into another note.`;
    applyBtn.disabled = true;
    return;
  }
  notesGrammarPendingCorrected = null;
  applyBtn.disabled = true;
  panel.classList.remove('hidden');
  statusEl.textContent = 'Checking grammar…';
  checkBtn.dataset.loading = '1';
  checkBtn.disabled = true;
  try {
    const raw = await callAI(gramPlain, NOTES_GRAMMAR_SYSTEM, { temperature: 0.15 });
    const corrected = parseNotesGrammarOutput(raw);
    const norm = (s) => s.replace(/\r\n/g, '\n').trim();
    if (norm(corrected) === norm(gramPlain)) {
      statusEl.textContent = 'No grammar or spelling changes suggested.';
      notesGrammarPendingCorrected = null;
      applyBtn.disabled = true;
    } else {
      notesGrammarPendingCorrected = corrected;
      statusEl.textContent = 'Suggestions ready. Review the warning below, then apply if you want the corrected text.';
      applyBtn.disabled = false;
    }
  } catch (e) {
    statusEl.textContent = e.message || 'Grammar check failed.';
    notesGrammarPendingCorrected = null;
    applyBtn.disabled = true;
  } finally {
    delete checkBtn.dataset.loading;
    updateNotesGrammarUi();
  }
}

function applyNotesGrammarCorrections() {
  if (notesGrammarPendingCorrected == null) return;
  setNotesBodyHtml(grammarPlainToNoteHtml(notesGrammarPendingCorrected));
  scheduleNotesFlush();
  notesGrammarDismiss();
  getNotesBodyEl().focus();
  syncNotesToolbarActiveStates();
}

function loadNotesFromStorage() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveNotesToStorage() {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notesList));
  } catch (e) {
    console.warn('Could not save notes', e);
  }
}

function getNotesBodyEl() {
  return document.getElementById('notes-body');
}

function notesBodyToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').replace(/\u00a0/g, ' ');
}

function plainTextToNoteHtml(text) {
  const paras = String(text).split(/\n\n+/);
  if (paras.length === 1 && !paras[0].trim()) return '<p><br></p>';
  const parts = paras
    .map((p) => {
      const lines = p
        .split('\n')
        .map((line) => escapeHtml(line))
        .join('<br>');
      return `<p>${lines || '<br>'}</p>`;
    })
    .join('');
  return parts || '<p><br></p>';
}

/** Plain text inside one block element (p, li, h2, …); <br> → newline */
function noteBlockInnerPlain(el) {
  let out = '';
  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const t = node.tagName.toLowerCase();
    if (t === 'br') out += '\n';
    else node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** List item text only (drops nested ul/ol for a stable grammar round-trip) */
function noteListItemPlain(li) {
  const clone = li.cloneNode(true);
  clone.querySelectorAll('ul, ol').forEach((n) => n.remove());
  return (clone.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Note HTML → wire format for grammar API (lists/headings preserved as plain lines).
 */
function noteHtmlToGrammarPlain(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  const out = [];
  d.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\u00a0/g, ' ').trim();
      if (t) {
        out.push(t);
        out.push('');
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'ul') {
      node.querySelectorAll(':scope > li').forEach((li) => {
        const text = noteListItemPlain(li);
        if (text) out.push(`- ${text}`);
      });
      out.push('');
    } else if (tag === 'ol') {
      let n = 1;
      node.querySelectorAll(':scope > li').forEach((li) => {
        const text = noteListItemPlain(li);
        if (text) {
          out.push(`${n}. ${text}`);
          n += 1;
        }
      });
      out.push('');
    } else if (tag === 'p') {
      const t = noteBlockInnerPlain(node);
      if (t) out.push(t);
      out.push('');
    } else if (tag === 'h2') {
      out.push(`## ${noteBlockInnerPlain(node)}`);
      out.push('');
    } else if (tag === 'h3') {
      out.push(`### ${noteBlockInnerPlain(node)}`);
      out.push('');
    } else if (tag === 'div') {
      const t = noteBlockInnerPlain(node);
      if (t) {
        out.push(t);
        out.push('');
      }
    }
  });
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

function escapeLineToHtml(s) {
  return escapeHtml(s).split('\n').join('<br>');
}

/**
 * Grammar wire format → note HTML (paragraphs, ul, ol, h2, h3).
 */
function grammarPlainToNoteHtml(text) {
  const norm = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!norm) return '<p><br></p>';
  const lines = norm.split('\n');
  const htmlParts = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (/^###\s+/.test(line)) {
      htmlParts.push(`<h3>${escapeHtml(line.replace(/^###\s+/, '').trim())}</h3>`);
      i += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      htmlParts.push(`<h2>${escapeHtml(line.replace(/^##\s+/, '').trim())}</h2>`);
      i += 1;
      continue;
    }
    if (/^-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, '').trim());
        i += 1;
      }
      htmlParts.push(
        `<ul>${items.map((it) => `<li>${escapeLineToHtml(it)}</li>`).join('')}</ul>`
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, '').trim());
        i += 1;
      }
      htmlParts.push(
        `<ol>${items.map((it) => `<li>${escapeLineToHtml(it)}</li>`).join('')}</ol>`
      );
      continue;
    }
    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) break;
      if (/^-\s+/.test(l) || /^\d+\.\s+/.test(l) || /^###\s+/.test(l) || /^##\s+/.test(l)) break;
      para.push(l);
      i += 1;
    }
    const ptext = para.join('\n').trim();
    if (ptext) htmlParts.push(`<p>${escapeLineToHtml(ptext)}</p>`);
  }
  const joined = htmlParts.join('');
  return joined || '<p><br></p>';
}

function noteBodyLooksLikeHtml(s) {
  return /<[a-z][\s\S]*>/i.test(String(s).trim());
}

function setNotesBodyHtml(raw) {
  const el = getNotesBodyEl();
  if (!raw) {
    el.innerHTML = '<p><br></p>';
    updateNotesBodyEmptyClass();
    return;
  }
  const s = String(raw);
  if (noteBodyLooksLikeHtml(s)) {
    el.innerHTML = s;
  } else {
    el.innerHTML = plainTextToNoteHtml(s);
  }
  updateNotesBodyEmptyClass();
}

function getNotesBodyHtml() {
  return getNotesBodyEl().innerHTML;
}

function updateNotesBodyEmptyClass() {
  const el = getNotesBodyEl();
  const plain = notesBodyToPlainText(el.innerHTML).trim();
  el.classList.toggle('notes-body-empty', plain.length === 0);
}

function syncNotesToolbarActiveStates() {
  const tb = document.getElementById('notes-toolbar');
  if (!tb) return;
  ['bold', 'italic', 'underline', 'strikeThrough'].forEach((cmd) => {
    const btn = tb.querySelector(`[data-cmd="${cmd}"]`);
    if (!btn) return;
    try {
      const on = document.queryCommandState(cmd);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } catch {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
  tb.querySelectorAll('[data-cmd="formatBlock"]').forEach((btn) => {
    const want = (btn.dataset.value || '').toLowerCase();
    let cur = '';
    try {
      cur = (document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, '');
    } catch {
      /* ignore */
    }
    const on = cur === want;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  ['insertUnorderedList', 'insertOrderedList'].forEach((cmd) => {
    const btn = tb.querySelector(`[data-cmd="${cmd}"]`);
    if (!btn) return;
    try {
      const on = document.queryCommandState(cmd);
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    } catch {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

function notesRunCommand(cmd, value = null) {
  const body = getNotesBodyEl();
  if (body.getAttribute('contenteditable') !== 'true') return;
  body.focus();
  try {
    if (cmd === 'formatBlock' && value) {
      document.execCommand('formatBlock', false, value);
    } else if (cmd === 'foreColor' && value) {
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, value);
    } else {
      document.execCommand(cmd, false, null);
    }
  } catch (e) {
    console.warn(e);
  }
  updateNotesBodyEmptyClass();
  scheduleNotesFlush();
  syncNotesToolbarActiveStates();
}

function notePreviewLine(note) {
  const t = String(note?.title ?? '').trim();
  if (t) return t.length > 72 ? `${t.slice(0, 72)}…` : t;
  const bodyText = notesBodyToPlainText(note?.body ?? '').trim();
  const line = bodyText
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (line) return line.length > 72 ? `${line.slice(0, 72)}…` : line;
  return 'Empty note';
}

function formatNotesUpdated(ts) {
  if (ts == null || ts === '') return '';
  try {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function flushNotesNow() {
  if (notesFlushTimer) {
    clearTimeout(notesFlushTimer);
    notesFlushTimer = null;
  }
  if (!activeNoteId) return;
  const i = notesList.findIndex((n) => n.id === activeNoteId);
  if (i < 0) return;
  notesList[i].title = document.getElementById('notes-title-input').value;
  notesList[i].body = getNotesBodyHtml();
  notesList[i].updatedAt = Date.now();
  saveNotesToStorage();
}

function scheduleNotesFlush() {
  if (notesFlushTimer) clearTimeout(notesFlushTimer);
  notesFlushTimer = setTimeout(() => {
    notesFlushTimer = null;
    flushNotesNow();
    renderNotesList();
  }, 400);
}

function syncEditorFromActive() {
  const n = notesList.find((x) => x.id === activeNoteId);
  document.getElementById('notes-title-input').value = n?.title ?? '';
  setNotesBodyHtml(n?.body ?? '');
  syncNotesToolbarActiveStates();
}

function updateNotesEditorState() {
  const has = !!activeNoteId;
  document.getElementById('notes-title-input').disabled = !has;
  getNotesBodyEl().setAttribute('contenteditable', has ? 'true' : 'false');
  document.querySelectorAll('#notes-toolbar .notes-fmt-btn, #notes-toolbar .notes-color-swatch').forEach((el) => {
    el.disabled = !has;
  });
  const colorIn = document.getElementById('notes-color-custom');
  if (colorIn) colorIn.disabled = !has;
  syncNotesToolbarActiveStates();
  updateNotesGrammarUi();
}

function renderNotesList() {
  const listEl = document.getElementById('notes-list');
  const emptyEl = document.getElementById('notes-list-empty');
  const q = document.getElementById('notes-search').value.trim().toLowerCase();
  const sorted = [...notesList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const filtered = sorted.filter((n) => {
    if (!q) return true;
    const hay = `${n.title}\n${notesBodyToPlainText(n.body)}`.toLowerCase();
    return hay.includes(q);
  });
  if (!filtered.length) {
    listEl.innerHTML = '';
    emptyEl.classList.toggle('hidden', notesList.length > 0);
    return;
  }
  emptyEl.classList.add('hidden');
  const trashSvg = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
  listEl.innerHTML = filtered
    .map((n) => {
      const active = n.id === activeNoteId ? ' active' : '';
      const when = formatNotesUpdated(n.updatedAt);
      const nid = escapeHtml(n.id);
      return `<div class="notes-list-row${active}" role="listitem">
        <button type="button" class="notes-list-item" data-note-id="${nid}">
          <span class="notes-list-title">${escapeHtml(notePreviewLine(n))}</span>
          <span class="notes-list-meta">${when ? escapeHtml(when) : '—'}</span>
        </button>
        <button type="button" class="notes-list-delete" data-note-id="${nid}" title="Delete note" aria-label="Delete note">${trashSvg}</button>
      </div>`;
    })
    .join('');

  listEl.querySelectorAll('.notes-list-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-note-id');
      if (id) selectNote(id);
    });
  });
  listEl.querySelectorAll('.notes-list-delete').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.getAttribute('data-note-id');
      if (id) deleteNoteById(id);
    });
  });
}

function selectNote(id) {
  flushNotesNow();
  notesGrammarDismiss();
  activeNoteId = id;
  syncEditorFromActive();
  updateNotesEditorState();
  renderNotesList();
}

function createNewNote() {
  flushNotesNow();
  notesGrammarDismiss();
  const note = {
    id: crypto.randomUUID(),
    title: '',
    body: '',
    updatedAt: Date.now(),
  };
  notesList.push(note);
  activeNoteId = note.id;
  saveNotesToStorage();
  syncEditorFromActive();
  updateNotesEditorState();
  renderNotesList();
  document.getElementById('notes-title-input').focus();
}

function deleteNoteById(id) {
  if (!id || !notesList.some((n) => n.id === id)) return;
  if (!window.confirm('Delete this note? This cannot be undone.')) return;
  flushNotesNow();
  notesGrammarDismiss();
  const wasActive = activeNoteId === id;
  notesList = notesList.filter((n) => n.id !== id);
  saveNotesToStorage();
  if (wasActive) {
    const sorted = [...notesList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    activeNoteId = sorted[0]?.id ?? null;
    syncEditorFromActive();
  }
  updateNotesEditorState();
  renderNotesList();
}

function initNotesTab() {
  notesList = loadNotesFromStorage();
  if (activeNoteId && !notesList.some((n) => n.id === activeNoteId)) {
    activeNoteId = null;
  }
  if (!activeNoteId && notesList.length) {
    const sorted = [...notesList].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    activeNoteId = sorted[0].id;
  }
  syncEditorFromActive();
  updateNotesEditorState();
  renderNotesList();
}

function clearNotesWorkspace() {
  document.getElementById('notes-search').value = '';
  flushNotesNow();
  notesGrammarDismiss();
  if (activeNoteId) {
    const i = notesList.findIndex((n) => n.id === activeNoteId);
    if (i >= 0) {
      notesList[i].title = '';
      notesList[i].body = '';
      notesList[i].updatedAt = Date.now();
      saveNotesToStorage();
    }
    syncEditorFromActive();
  }
  renderNotesList();
}

document.getElementById('btn-notes-new').addEventListener('click', () => createNewNote());
document.getElementById('notes-title-input').addEventListener('input', () => scheduleNotesFlush());
getNotesBodyEl().addEventListener('input', () => {
  updateNotesBodyEmptyClass();
  scheduleNotesFlush();
});
getNotesBodyEl().addEventListener('paste', (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, text);
  updateNotesBodyEmptyClass();
  scheduleNotesFlush();
});
document.getElementById('notes-search').addEventListener('input', () => renderNotesList());

const notesGrammarEnabledEl = document.getElementById('notes-grammar-enabled');
if (notesGrammarEnabledEl) {
  notesGrammarEnabledEl.checked = loadNotesGrammarPref();
  notesGrammarEnabledEl.addEventListener('change', () => {
    saveNotesGrammarPref(notesGrammarEnabledEl.checked);
    updateNotesGrammarUi();
  });
}
document.getElementById('btn-notes-grammar-check')?.addEventListener('click', () => {
  void runNotesGrammarCheck();
});
document.getElementById('btn-notes-grammar-dismiss')?.addEventListener('click', () => notesGrammarDismiss());
document.getElementById('btn-notes-grammar-apply')?.addEventListener('click', () => applyNotesGrammarCorrections());

updateNotesGrammarUi();

document.getElementById('notes-toolbar').addEventListener('click', (e) => {
  const swatch = e.target.closest('.notes-color-swatch[data-cmd]');
  if (swatch && !swatch.disabled) {
    notesRunCommand('foreColor', swatch.dataset.value);
    return;
  }
  const btn = e.target.closest('.notes-fmt-btn[data-cmd]');
  if (!btn || btn.disabled) return;
  const cmd = btn.dataset.cmd;
  const val = btn.dataset.value;
  if (cmd === 'formatBlock' && val) notesRunCommand('formatBlock', val);
  else notesRunCommand(cmd);
});

document.getElementById('notes-color-custom').addEventListener('input', (e) => {
  notesRunCommand('foreColor', e.target.value);
});

document.addEventListener('selectionchange', () => {
  if (getActiveTabName() !== 'notes') return;
  if (document.activeElement !== getNotesBodyEl()) return;
  syncNotesToolbarActiveStates();
});

// --- Tabs ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const leaving = getActiveTabName();
    const name = tab.dataset.tab;
    if (leaving === 'notes' && name !== 'notes') {
      flushNotesNow();
      renderNotesList();
      notesGrammarDismiss();
    }
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
    if (name === 'notes') {
      initNotesTab();
    }
  });
});

// --- Clear workspace ---
document.getElementById('btn-clear-workspace').addEventListener('click', () => {
  const tab = getActiveTabName();
  if (tab === 'email') clearEmailWorkspace();
  else if (tab === 'ppt') clearPptWorkspace();
  else if (tab === 'passwords') clearPasswordWorkspace();
  else if (tab === 'notes') clearNotesWorkspace();
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
