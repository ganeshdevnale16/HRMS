import type { Candidate, Requirement } from '@prisma/client';

type C = Pick<Candidate, 'skills' | 'expYears' | 'location' | 'noticeDays' | 'expectedCtc'>;
type R = Pick<Requirement, 'skills' | 'expMin' | 'expMax' | 'location' | 'workMode' | 'noticeMax' | 'ctcMax'>;

export const WEIGHTS = { skills: 0.5, experience: 0.2, location: 0.12, notice: 0.1, ctc: 0.08 };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#/]/g, '');

/** Explainable, deterministic fit score (0-100). AI summaries sit on top of this, never replace it. */
export function matchScore(c: C, r: R) {
  const cs = c.skills.map(norm);
  const hit = r.skills.filter((s) => {
    const t = norm(s);
    return cs.some((x) => x === t || (x.length > 2 && t.includes(x)) || (t.length > 2 && x.includes(t)));
  });
  const skills = r.skills.length ? hit.length / r.skills.length : 0;
  const e = c.expYears;
  const experience = e >= r.expMin && e <= r.expMax ? 1 : e < r.expMin ? Math.max(0, 1 - (r.expMin - e) / 2) : Math.max(0, 1 - (e - r.expMax) / 4);
  const location = c.location && norm(c.location) === norm(r.location) ? 1 : r.workMode === 'REMOTE' ? 0.9 : 0.35;
  const nd = c.noticeDays ?? 30;
  const notice = nd <= r.noticeMax ? 1 : Math.max(0, 1 - (nd - r.noticeMax) / 60);
  const ec = c.expectedCtc ?? 0;
  const ctc = !ec || ec <= r.ctcMax ? 1 : Math.max(0, 1 - ((ec - r.ctcMax) / r.ctcMax) * 2);
  const factors = { skills, experience, location, notice, ctc };
  const score = Math.round(100 * Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * (factors as any)[k], 0));
  return { score, matched: hit, missing: r.skills.filter((s) => !hit.includes(s)), factors };
}
