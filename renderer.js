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
  });
});

// --- Clear workspace ---
document.getElementById('btn-clear-workspace').addEventListener('click', () => {
  const tab = getActiveTabName();
  if (tab === 'email') clearEmailWorkspace();
  else if (tab === 'ppt') clearPptWorkspace();
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
