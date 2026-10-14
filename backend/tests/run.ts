/**
 * HRMS self-test: npm test  (no database needed)
 * Checks resume reading (PDF/DOCX), the rule-based parser, spreadsheet mapping + clean-up,
 * duplicate detection, fit scoring and calendar invites, using the files in tests/fixtures.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractText, heuristicParse } from '../src/lib/resumeText.js';
import { applyMapping, guessField, normalise, CANONICAL_FIELDS } from '../src/lib/normalise.js';
import { matchScore } from '../src/lib/matching.js';
import { buildIcs } from '../src/lib/ics.js';
import { callProvider, parseJsonLoose } from '../src/modules/ai/providers.js';
import { merge, resolve, fromLegacy } from '../src/modules/ai/settings.js';
import { render, textToHtml, BUILT_IN_TEMPLATES } from '../src/lib/template.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
let pass = 0, fail = 0, skip = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; console.log(`  ✘ ${name}  → got ${JSON.stringify(got)}`); } };
const section = (s: string) => console.log(`\n${s}`);
const file = (f: string) => fs.readFileSync(path.join(dir, f));

async function resumes() {
  section('Resume reading');
  const cases: [string, any][] = [
    ['Priya_Shah_Java_Developer.pdf', { name: 'Priya Shah', email: 'priya.shah.test@example.com', phone: '9876510001', location: 'Pune', expYears: 5, currentCtc: 12, expectedCtc: 16, noticeDays: 30, skills: ['Java', 'Spring Boot', 'Microservices', 'SQL', 'Kafka'] }],
    ['Amol_Jadhav_SAP_FICO.pdf', { name: 'Amol Jadhav', email: 'amol.jadhav.test@example.com', phone: '9822010002', location: 'Mumbai', expYears: 7, currentCtc: 18, expectedCtc: 24, noticeDays: 60, skills: ['SAP FICO', 'S/4HANA', 'GST'] }],
    ['Kavya_Iyer_Java_DUPLICATE_TEST.pdf', { name: 'Kavya Iyer', email: 'kavya.iyer.test@example.com', phone: '9811110005', noticeDays: 60, skills: ['Java', 'Spring Boot', 'Hibernate'] }],
    ['Nisha_Reddy_React_Developer.docx', { name: 'Nisha Reddy', email: 'nisha.reddy.test@example.com', phone: '9900110003', location: 'Hyderabad', expYears: 3, noticeDays: 0, skills: ['React', 'TypeScript', 'Redux'] }],
    ['Rohan_Mehta_Data_Engineer.docx', { name: 'Rohan Mehta', email: 'rohan.mehta.test@example.com', phone: '9845010004', location: 'Bengaluru', expYears: 6, noticeDays: 45, skills: ['Python', 'Spark', 'Databricks'] }],
  ];
  const skills = ['Java', 'Spring Boot', 'Microservices', 'SQL', 'Kafka', 'SAP FICO', 'S/4HANA', 'GST', 'Hibernate', 'React', 'TypeScript', 'Redux', 'Python', 'Spark', 'Databricks', 'Azure Data Factory'];
  for (const [f, want] of cases) {
    let text: string;
    try { text = await extractText(file(f), f); }
    catch (e: any) {
      if (/Cannot find (module|package) 'mammoth'/.test(e.message) || /mammoth/.test(e.message) && f.endsWith('.docx')) { skip++; console.log(`  – ${f}: skipped (mammoth not installed)`); continue; }
      ok(`${f} readable`, false, e.message); continue;
    }
    const h = heuristicParse(text, skills);
    console.log(`  ${f}`);
    for (const [k, v] of Object.entries(want)) {
      if (k === 'skills') ok(`   skills include ${(v as string[]).join(', ')}`, (v as string[]).every((s) => h.skills.includes(s)), h.skills);
      else ok(`   ${k} = ${v}`, (h as any)[k] === v, (h as any)[k]);
    }
  }
  try { await extractText(file('Scanned_Image_Only_SHOULD_FAIL.pdf'), 'scan.pdf'); ok('scanned image PDF is rejected', false, 'no error'); }
  catch (e: any) { ok('scanned image PDF is rejected with a clear message', /no readable text/.test(e.message), e.message); }
  try { await extractText(Buffer.from('x'), 'old.doc'); ok('.doc rejected', false); } catch (e: any) { ok('old .doc rejected with a clear message', /\.doc/.test(e.message), e.message); }
}

async function spreadsheet() {
  section('Spreadsheet mapping, clean-up and duplicates (candidates_test.xlsx)');
  let rows: Record<string, unknown>[];
  try {
    const XLSX = await import('xlsx');
    rows = XLSX.utils.sheet_to_json(XLSX.read(file('candidates_test.xlsx'), { type: 'buffer' }).Sheets.Candidates, { defval: '' });
  } catch { rows = JSON.parse(file('candidates_test.json').toString()); console.log('  (xlsx not installed — using the JSON copy of the sheet)'); }
  const fields = Object.keys(rows[0]);
  const mapping = Object.fromEntries(fields.map((f) => [f, guessField(f)])) as any;
  const expect: Record<string, string> = { 'Candidate Name': 'name', 'Mail ID': 'email', 'Mobile No': 'phone', 'Current City': 'location', 'Total Exp': 'expYears', 'Key Skills': 'skills',
    'Current Company': 'company', Designation: 'title', 'Current CTC': 'currentCtc', 'Expected CTC': 'expectedCtc', 'Notice Period': 'noticeDays', Qualification: 'education', 'Test note': '' };
  for (const [k, v] of Object.entries(expect)) ok(`"${k}" → ${v || 'ignored'}`, mapping[k] === v, mapping[k]);

  const n = rows.map((r) => normalise(applyMapping(r, mapping)));
  const sneha = n.find((c) => c.email === 'sneha.deshmukh.test@example.com')!;
  ok('name tidied: "sneha DESHMUKH" → "Sneha Deshmukh"', sneha?.name === 'Sneha Deshmukh', sneha?.name);
  ok('phone "+91 98765 00102" → 9876500102', sneha?.phone === '9876500102', sneha?.phone);
  ok('city "pune, maharashtra" → Pune', sneha?.location === 'Pune', sneha?.location);
  ok('CTC 1400000 → 14 LPA', sneha?.currentCtc === 14, sneha?.currentCtc);
  ok('notice "2 months" → 60 days', sneha?.noticeDays === 60, sneha?.noticeDays);
  ok('skill "S/4HANA" kept whole (not split on /)', normalise({ name: 'X', skills: 'SAP FICO, S/4HANA; GL | AP/AR' }).skills.join('|') === 'SAP FICO|S/4HANA|GL|AP/AR', normalise({ name: 'X', skills: 'SAP FICO, S/4HANA; GL | AP/AR' }).skills);
  ok('skills split on ";"', sneha?.skills.join('|') === 'Java|Spring Boot|Kafka|AWS', sneha?.skills);
  const sap = normalise({ name: 'X', skills: 'SAP FICO, S/4HANA, AP/AR, CI/CD' });
  ok('"S/4HANA", "AP/AR", "CI/CD" kept whole', sap.skills.join('|') === 'SAP FICO|S/4HANA|AP/AR|CI/CD', sap.skills);
  const divya = n.find((c) => c.email?.startsWith('divya'))!;
  ok('notice "Immediate" → 0', divya.noticeDays === 0, divya.noticeDays);

  // same rules as ingest.service: reject without name or contact; merge on email/phone
  const pool = [{ email: 'kavya.iyer.test@example.com', phone: '9811110005' }]; // Kavya already imported from her resume
  let added = 0, merged = 0, rejected = 0;
  for (const c of n) {
    if (!c.name || (!c.email && !c.phone && !c.externalId)) { rejected++; continue; }
    if (pool.some((p) => (c.email && p.email === c.email) || (c.phone && p.phone === c.phone))) { merged++; continue; }
    pool.push({ email: c.email!, phone: c.phone! }); added++;
  }
  ok('import result: 8 new, 2 merged, 2 rejected', added === 8 && merged === 2 && rejected === 2, { added, merged, rejected });
  ok('canonical field list intact', CANONICAL_FIELDS.includes('name') && CANONICAL_FIELDS.includes('externalId'));
}

async function template() {
  section('In-app samples (Download sample buttons)');
  let rows: Record<string, unknown>[];
  try { const XLSX = await import('xlsx'); rows = XLSX.utils.sheet_to_json(XLSX.read(file('HRMS_Candidate_Template.xlsx'), { type: 'buffer' }).Sheets.Candidates, { defval: '' }); }
  catch { rows = JSON.parse(file('HRMS_Candidate_Template.json').toString()); }
  const mapping = Object.fromEntries(Object.keys(rows[0]).map((f) => [f, guessField(f)])) as any;
  const want: Record<string, string> = { 'Full Name': 'name', Email: 'email', Phone: 'phone', 'Current Location': 'location', 'Total Experience (years)': 'expYears', Skills: 'skills', 'Current Company': 'company',
    'Current Title': 'title', 'Current CTC (LPA)': 'currentCtc', 'Expected CTC (LPA)': 'expectedCtc', 'Notice Period (days)': 'noticeDays', Education: 'education', 'Requirement Code': 'requirementCode' };
  ok('every template column maps automatically', Object.entries(want).every(([k, v]) => mapping[k] === v), mapping);
  const n = rows.map((r) => normalise(applyMapping(r, mapping)));
  ok('Requirement Code read (R-1001), blank stays empty', n[0].requirementCode === 'R-1001' && n[1].requirementCode === null, n.map((x) => x.requirementCode));
  ok('all 3 example rows valid', n.every((c) => c.name && (c.email || c.phone)), n.map((c) => c.name));
  for (const f of ['Sample_Resume.pdf', 'Sample_Resume.docx']) {
    const h = heuristicParse(await extractText(file(f), f), ['Java', 'Spring Boot', 'SQL', 'Microservices']);
    ok(`${f}: name, email, phone, 4.5 yrs, CTC 12/16, notice 30`, h.name === 'Ananya Rao' && h.email === 'ananya.rao.sample@example.com' && h.phone === '9876543210' && h.expYears === 4.5 && h.currentCtc === 12 && h.expectedCtc === 16 && h.noticeDays === 30, h);
  }
}

function emailTemplates() {
  section('Candidate email templates');
  const v = { firstName: 'Priya', name: 'Priya Shah', position: 'Java Developer', location: 'Pune', workMode: 'Hybrid', recruiter: 'Krishna', companyName: 'Deloitte Recruitment' };
  const t = BUILT_IN_TEMPLATES.find((x) => x.id === 'interest')!;
  const out = render(t.body, v);
  ok('placeholders filled', out.startsWith('Hi Priya,') && out.includes('Java Developer role (Hybrid, Pune)') && out.endsWith('Krishna\nDeloitte Recruitment'), out.slice(0, 80));
  ok('subject filled', render(t.subject, v) === 'Opportunity: Java Developer (Pune)');
  ok('every built-in template fills completely', BUILT_IN_TEMPLATES.every((x) => !/\{\{/.test(render(x.subject + x.body, v))));
  ok('unknown placeholder left visible', render('Hi {{nickname}}', v) === 'Hi {{nickname}}');
  const html = textToHtml('Hi <b>Priya</b>,\n\nJoin: https://meet.jit.si/HRMS-1\nThanks');
  ok('HTML is escaped, paragraphs and links made', html.includes('&lt;b&gt;Priya&lt;/b&gt;') && html.includes('<a href="https://meet.jit.si/HRMS-1">') && (html.match(/<p /g) ?? []).length === 2, html);
}

function scoring() {
  section('Fit scoring');
  const java = { skills: ['Java', 'Spring Boot', 'Microservices', 'SQL'], expMin: 3, expMax: 6, location: 'Pune', workMode: 'HYBRID' as const, noticeMax: 60, ctcMax: 18 };
  const strong = matchScore({ skills: ['Java', 'Spring Boot', 'Microservices', 'SQL', 'Kafka'], expYears: 5, location: 'Pune', noticeDays: 30, expectedCtc: 16 }, java);
  const weak = matchScore({ skills: ['Tally', 'GST', 'Accounting'], expYears: 9, location: 'Ahmedabad', noticeDays: 30, expectedCtc: 12 }, java);
  ok(`strong Java profile scores ≥ 90 (${strong.score})`, strong.score >= 90, strong);
  ok(`accounts profile scores < 40 (${weak.score})`, weak.score < 40, weak);
  ok('missing skills are listed', weak.missing.length === 4, weak.missing);
}

function invites() {
  section('Calendar invites');
  const ics = buildIcs({ uid: 'x@hrms', sequence: 0, method: 'REQUEST', start: new Date('2026-10-20T05:30:00Z'), end: new Date('2026-10-20T06:30:00Z'), summary: 'Interview: Test, Java', description: 'Line 1\nLine 2', location: 'https://meet.jit.si/HRMS-abc', organizer: { name: 'Recruiting', email: 'hr@example.com' }, attendees: [{ name: 'A', email: 'a@example.com' }] });
  ok('valid VCALENDAR', ics.startsWith('BEGIN:VCALENDAR') && ics.includes('METHOD:REQUEST') && ics.trim().endsWith('END:VCALENDAR'));
  ok('UTC start time', ics.includes('DTSTART:20261020T053000Z'));
  ok('commas escaped', ics.includes('SUMMARY:Interview: Test\\, Java'));
}

async function aiProviders() {
  section('AI providers (mocked network — checks request format and response reading)');
  const real = globalThis.fetch;
  let last: { url: string; init: any } | null = null;
  const reply = (body: unknown, status = 200) => { (globalThis as any).fetch = async (url: string, init: any) => { last = { url, init }; return new Response(JSON.stringify(body), { status }); }; };
  try {
    reply({ choices: [{ message: { content: '{"ok":true}' } }] });
    let out = await callProvider({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini' }, 'sys', 'hi', true);
    ok('OpenAI: URL, Bearer key, JSON mode, reply read', last!.url === 'https://api.openai.com/v1/chat/completions' && last!.init.headers.Authorization === 'Bearer sk-test' && JSON.parse(last!.init.body).response_format.type === 'json_object' && out === '{"ok":true}', { url: last!.url, out });
    out = await callProvider({ provider: 'openai', apiKey: 'gsk', baseUrl: 'https://api.groq.com/openai/v1/', model: 'llama' }, 's', 'u', false);
    ok('OpenAI-compatible (Groq) base URL', last!.url === 'https://api.groq.com/openai/v1/chat/completions', last!.url);

    reply({ content: [{ type: 'text', text: 'OK' }] });
    out = await callProvider({ provider: 'anthropic', apiKey: 'sk-ant' }, 'sys', 'hi', false);
    const ab = JSON.parse(last!.init.body);
    ok('Claude: URL, x-api-key, version header, system prompt, reply read', last!.url === 'https://api.anthropic.com/v1/messages' && last!.init.headers['x-api-key'] === 'sk-ant' && last!.init.headers['anthropic-version'] === '2023-06-01' && ab.system === 'sys' && ab.model === 'claude-sonnet-5-5' && out === 'OK', { out, model: ab.model });

    reply({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] });
    out = await callProvider({ provider: 'gemini', apiKey: 'AIza' }, 'sys', 'hi', true);
    const gb = JSON.parse(last!.init.body);
    ok('Gemini: URL, key header, JSON mode, reply read', last!.url.includes('/models/gemini-2.5-flash:generateContent') && last!.init.headers['x-goog-api-key'] === 'AIza' && gb.generationConfig.responseMimeType === 'application/json' && out === '{"a":1}', { url: last!.url, out });

    reply({ choices: [{ message: { content: 'OK' } }] });
    out = await callProvider({ provider: 'azure', apiKey: 'az', azureEndpoint: 'https://x.openai.azure.com/', azureDeployment: 'gpt-4o' }, 's', 'u', false);
    ok('Azure OpenAI: deployment URL and api-key header', last!.url === 'https://x.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21' && last!.init.headers['api-key'] === 'az' && out === 'OK', last!.url);

    reply({ error: { message: 'Incorrect API key provided' } }, 401);
    try { await callProvider({ provider: 'openai', apiKey: 'bad' }, 's', 'u', false); ok('bad key → error', false); }
    catch (e: any) { ok('bad key → clear error with hint', /401.*Incorrect API key.*check the API key/.test(e.message), e.message); }
    try { await callProvider({ provider: 'none' }, 's', 'u', false); ok('AI off → error', false); } catch (e: any) { ok('AI off → "not configured" message', /not configured/.test(e.message), e.message); }
    try { await callProvider({ provider: 'gemini' }, 's', 'u', false); ok('no key → error', false); } catch (e: any) { ok('missing key → clear message', /No API key/.test(e.message), e.message); }
    ok('JSON wrapped in prose/code fences is still read', (parseJsonLoose<any>('Sure!\n```json\n{"name":"A"}\n```')).name === 'A');
  } finally { (globalThis as any).fetch = real; }
}

function aiRouting() {
  section('AI provider selection (which AI is used for what)');
  const env = { active: 'gemini' as const, features: {}, providers: { gemini: { apiKey: 'env-g', model: 'gemini-2.5-flash' }, openai: {} } };
  let s = merge(null, env as any);
  ok('only .env Gemini key → Gemini used everywhere', resolve(s, 'screening').provider === 'gemini' && resolve(s, 'parsing').provider === 'gemini');
  s = merge({ active: 'openai', features: { screening: 'anthropic' }, providers: { openai: { apiKey: 'sk', model: 'gpt-4o' }, anthropic: { apiKey: 'ant' } } } as any, env as any);
  ok('default OpenAI for resume reading', resolve(s, 'parsing').provider === 'openai' && resolve(s, 'parsing').model === 'gpt-4o', resolve(s, 'parsing'));
  ok('screening routed to Claude with its default model', resolve(s, 'screening').provider === 'anthropic' && resolve(s, 'screening').model === 'claude-sonnet-5-5', resolve(s, 'screening'));
  ok('per-run override to Gemini (.env key still available)', resolve(s, 'screening', 'gemini').provider === 'gemini' && resolve(s, 'screening', 'gemini').apiKey === 'env-g');
  ok('override to a provider with no key is refused', /not connected/.test(resolve(s, 'screening', 'azure').reason));
  s = merge({ active: 'openai', features: { screening: 'anthropic' }, providers: { openai: { apiKey: 'sk' } } } as any, { active: 'none', features: {}, providers: {} } as any);
  ok('route to a disconnected provider falls back to default', resolve(s, 'screening').provider === 'openai', resolve(s, 'screening'));
  s = merge({ active: 'none', features: {}, providers: { openai: { apiKey: 'sk' } } } as any, { active: 'none', features: {}, providers: {} } as any);
  ok('default set to Off → AI off even with keys saved', resolve(s, 'general').provider === 'none');
  const legacy = fromLegacy({ provider: 'gemini', apiKey: 'k', model: 'm' });
  ok('old single-provider setting upgraded', legacy.active === 'gemini' && legacy.providers.gemini?.apiKey === 'k');
}

await resumes();
await aiProviders();
aiRouting();
await template();
await spreadsheet();
emailTemplates();
scoring();
invites();
console.log(`\n${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
process.exit(fail ? 1 : 0);
