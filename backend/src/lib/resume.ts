import { prisma } from '../db.js';
import { ai, getAiConfig } from '../modules/ai/ai.service.js';
import { BASE_SKILLS, extractText, heuristicParse } from './resumeText.js';

export { isResume, RESUME_EXT, extractText, heuristicParse } from './resumeText.js';

async function knownSkills() {
  const reqs = await prisma.requirement.findMany({ where: { status: 'OPEN' }, select: { skills: true } });
  return [...new Set([...BASE_SKILLS, ...reqs.flatMap((r) => r.skills)])];
}

/** Text extraction → AI parsing (if configured) → rule-based values fill anything AI missed. */
export async function parseResume(data: Buffer, name: string, mime?: string, userId?: string) {
  const text = await extractText(data, name, mime).catch((e) => { throw new Error(`${name}: ${e.message}`); });
  const h = heuristicParse(text, await knownSkills());
  let parsed: Record<string, unknown> = {};
  let usedAI = false;
  const cfg = await getAiConfig('parsing');
  if (cfg.provider !== 'none' && cfg.apiKey) {
    try { parsed = (await ai.parseResume(text, { userId })) as any; usedAI = true; } catch (e: any) { console.warn(`[resume] AI parse failed for ${name}: ${e.message}`); }
  }
  const pick = (k: string) => (parsed[k] != null && parsed[k] !== '' ? parsed[k] : (h as any)[k]);
  const skills = [...new Set([...(Array.isArray(parsed.skills) ? (parsed.skills as string[]) : []), ...h.skills])];
  const fields: Record<string, unknown> = {
    name: pick('name'), email: pick('email'), phone: pick('phone'), location: pick('location'), expYears: pick('expYears'),
    skills: skills.join(', '), company: parsed.company, title: parsed.title, currentCtc: pick('currentCtc'), expectedCtc: pick('expectedCtc'),
    noticeDays: pick('noticeDays'), education: pick('education'),
  };
  return { fields, text, usedAI, ai: usedAI ? { provider: cfg.provider, model: cfg.model, label: (cfg as any).label } : null };
}
