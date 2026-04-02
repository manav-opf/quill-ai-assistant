/**
 * Renderer constants — prompts, sample content, storage keys, static UI snippets.
 */

/** Meeting analysis system prompt (JSON shape for the model). */
export const MEETING_SYSTEM_PROMPT = `Extract the following from the meeting transcript:
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

export const SAMPLE_MEETING = `Team Sync — March 28, 2026

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

export const SAMPLE_EMAIL = `Subject: Invoice #8842 — payment not reflected

Hi Support,

I paid invoice #8842 last Tuesday via ACH. The money left my bank but your portal still shows "Outstanding". Our accounting team needs this cleared before month-end close.

Please confirm receipt and update the status, or let me know what reference number you need.

Thanks,
Riley Chen
Finance Ops, Northwind LLC`;

/** Display names for PPT template keys (must match select option values). */
export const PPT_TEMPLATE_LABELS = {
  modern: 'Modern Gradient',
  minimal: 'Minimal Clean',
  dark: 'Dark Pro',
};

export const SAMPLE_PPT_CONTENT = `Internal pitch: Quill rollout (Q2)

We are launching Quill as the default desktop assistant for meeting notes and customer email drafts. Goals: cut follow-up time by 40%, standardize action tracking, and reduce tone inconsistencies in support replies.

Target users: team leads, PMs, and tier-1 support. Success metrics: weekly active users, average time from meeting end to summary sent, and CSAT on outbound replies.

Rollout in three waves: pilot (50 users), department expansion, then company-wide. Training will be two short videos plus office hours.

Risks: API cost spikes, change management fatigue, and privacy questions about transcripts. Mitigations: usage dashboards, executive sponsors, and clear data-handling FAQ.

Ask: approve pilot headcount and comms plan by Friday. Next step: schedule kickoff with IT for SSO-ready builds.`;

/** Inline SVG snippets for password vault cards (trusted static HTML). */
export const PW_ICONS = {
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

/** Notes tab — localStorage */
export const NOTES_STORAGE_KEY = 'quill-notes-v1';
export const NOTES_GRAMMAR_PREF_KEY = 'quill-notes-grammar-assist';
export const NOTES_GRAMMAR_MAX_CHARS = 12000;

export const NOTES_GRAMMAR_SYSTEM = `You are an editor. Fix grammar and spelling only. Do not change meaning, facts, names, or tone.

The input uses this structure — you MUST preserve it exactly:
- Paragraphs: normal lines; separate blocks with a blank line.
- Bulleted lists: each item is one line starting with "- " (hyphen + space). Consecutive "- " lines are one list.
- Numbered lists: each item is one line starting with "1. ", "2. ", etc. (digit(s) + dot + space). Consecutive numbered lines are one list; you may renumber them 1. 2. 3. as needed.
- Headings: "## Title" (level 2) or "### Title" (level 3) on their own line.

Do not merge list items into paragraphs. Do not remove "- " or "N. " prefixes from list lines. Do not add markdown except exactly "## " and "### " for headings.

Output format — nothing before or after this block:
<<<CORRECTED>>>
(then the full corrected note using the same rules as the input)`;

/** Theme preference localStorage key (must match inline script in index.html). */
export const THEME_PREF_KEY = 'quill-theme-pref';
