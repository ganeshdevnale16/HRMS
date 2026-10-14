/** Email template helpers (pure, unit-tested). */
export const TEMPLATE_VARS = ['firstName', 'name', 'position', 'location', 'workMode', 'recruiter', 'companyName'] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARS)[number], string>>;

/** Replaces {{firstName}} etc. Unknown placeholders are left visible so they get noticed in the preview. */
export const render = (tpl: string, v: TemplateVars) => tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => ((v as any)[k] != null && (v as any)[k] !== '' ? String((v as any)[k]) : m));

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → simple HTML email (paragraphs, line breaks, clickable links). */
export function textToHtml(text: string) {
  const body = text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}</div>`;
}

export const BUILT_IN_TEMPLATES = [
  { id: 'interest', name: 'Check interest in a role', subject: 'Opportunity: {{position}} ({{location}})',
    body: 'Hi {{firstName}},\n\nI came across your profile and think you could be a strong fit for a {{position}} role ({{workMode}}, {{location}}).\n\nWould you be open to a quick 15-minute call this week? Please reply with a convenient time and your current notice period.\n\nRegards,\n{{recruiter}}\n{{companyName}}' },
  { id: 'shortlisted', name: 'Shortlisted — next steps', subject: 'Next steps for the {{position}} role',
    body: 'Hi {{firstName}},\n\nThank you for your interest in the {{position}} role. We have reviewed your profile and would like to move you to the interview stage.\n\nWe will share interview details shortly. Please reply with your availability for the next few days.\n\nRegards,\n{{recruiter}}\n{{companyName}}' },
  { id: 'documents', name: 'Request documents', subject: 'Documents needed — {{position}}',
    body: 'Hi {{firstName}},\n\nTo move ahead with your application for {{position}}, please reply with:\n\n1. Updated resume\n2. Last 3 months’ salary slips\n3. Relieving / experience letters\n4. Government photo ID\n\nRegards,\n{{recruiter}}\n{{companyName}}' },
  { id: 'followup', name: 'Follow-up (no reply)', subject: 'Following up: {{position}}',
    body: 'Hi {{firstName}},\n\nJust following up on my earlier message about the {{position}} role. Let me know if you are interested and a good time to talk.\n\nRegards,\n{{recruiter}}\n{{companyName}}' },
  { id: 'rejection', name: 'Not progressing (polite)', subject: 'Your application for {{position}}',
    body: 'Hi {{firstName}},\n\nThank you for your time and interest in the {{position}} role. After careful consideration, we will not be moving forward with your application at this stage.\n\nWe will keep your profile on file and reach out if a suitable role opens up.\n\nBest wishes,\n{{recruiter}}\n{{companyName}}' },
  { id: 'blank', name: 'Blank message', subject: '', body: 'Hi {{firstName}},\n\n\n\nRegards,\n{{recruiter}}\n{{companyName}}' },
];
