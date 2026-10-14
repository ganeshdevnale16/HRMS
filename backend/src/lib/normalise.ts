export const CANONICAL_FIELDS = [
  'name', 'email', 'phone', 'location', 'expYears', 'skills', 'company', 'title',
  'currentCtc', 'expectedCtc', 'noticeDays', 'education', 'workMode', 'externalId', 'resumeUrl', 'requirementCode',
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
export type Mapping = Record<string, CanonicalField | ''>;

const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o) ?? o?.[path];

/** Applies a source's field mapping. Several source fields mapped to one target are joined (first + last name). */
export function applyMapping(raw: Record<string, unknown>, mapping: Mapping) {
  const out: Partial<Record<CanonicalField, string>> = {};
  for (const [src, target] of Object.entries(mapping)) {
    if (!target) continue;
    let v = get(raw, src);
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v = v.map((x) => (typeof x === 'object' ? (x as any).name ?? JSON.stringify(x) : x)).join(', ');
    const s = String(v);
    out[target] = out[target] ? out[target] + (target === 'name' ? ' ' : ', ') + s : s;
  }
  return out;
}

const num = (v?: string) => {
  if (v == null || v === '') return null;
  const s = String(v).toLowerCase();
  if (/immediate|serving/.test(s)) return 0;
  const m = s.match(/[\d.]+/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (/month/.test(s)) n *= 30;
  return n;
};
/** CTC in lakhs per annum: "12 LPA", "1200000", "12.5" all become 12 / 12.5. */
const ctc = (v?: string) => {
  let n = num(v);
  if (n == null) return null;
  if (n > 1000) n = n / 100000;
  return Math.round(n * 10) / 10;
};
const title = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

export function normalise(o: Partial<Record<CanonicalField, string>>) {
  const phone = String(o.phone ?? '').replace(/\D/g, '').slice(-10);
  const c = ctc(o.currentCtc);
  return {
    name: o.name ? title(o.name) : '',
    email: o.email ? o.email.trim().toLowerCase() : null,
    phone: phone.length >= 10 ? phone : null,
    location: o.location ? title(o.location.split(',')[0]) : null,
    expYears: num(o.expYears) ?? 0,
    skills: [...new Set(String(o.skills ?? '').split(/[,;|\n]+/).map((s) => s.trim()).filter(Boolean))],
    company: o.company?.trim() || null,
    title: o.title?.trim() || null,
    currentCtc: c,
    expectedCtc: ctc(o.expectedCtc) ?? (c ? Math.round(c * 1.3 * 10) / 10 : null),
    noticeDays: num(o.noticeDays) ?? null,
    education: o.education?.trim() || null,
    workMode: o.workMode?.trim() || null,
    resumeUrl: o.resumeUrl || null,
    externalId: o.externalId || null,
    requirementCode: o.requirementCode ? String(o.requirementCode).trim().toUpperCase() : null,
  };
}
export type NormalisedCandidate = ReturnType<typeof normalise>;

/** Suggests a target for an incoming field name; used before AI mapping. */
export function guessField(field: string): CanonicalField | '' {
  const t = field.split('.').pop()!.toLowerCase().replace(/[^a-z]/g, '');
  const rules: [CanonicalField, RegExp][] = [
    ['requirementCode', /requirement|reqcode|reqid|jobcode|jobid|positioncode/], ['email', /email|mail/], ['phone', /phone|mobile|contact/], ['expectedCtc', /expected|ectc|expectedpay/],
    ['currentCtc', /ctc|salary|currentpay/], ['noticeDays', /notice|^np/], ['expYears', /experience|exp|years/],
    ['skills', /skill|competenc|tech/], ['company', /company|employer|organi/], ['title', /title|designation|headline|role/],
    ['location', /location|city|^loc|geo/], ['education', /education|qualification|degree/], ['workMode', /workmode/],
    ['externalId', /^id$|candidateid|externalid|ref$/], ['resumeUrl', /resume|cv/],
    ['name', /name/],
  ];
  return rules.find(([, re]) => re.test(t))?.[0] ?? '';
}
