/** Small stroke icon set (24×24, 1.75 stroke). */
const P: Record<string, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  requirements: 'M9 6V4h6v2M3 7h18v13H3zM3 12h18',
  sources: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  candidates: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  pipeline: 'M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v6h-4z',
  interviews: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16',
  interviewers: 'M15 20v-1.5A3.5 3.5 0 0 0 11.5 15h-5A3.5 3.5 0 0 0 3 18.5V20M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM16 11l2 2 4-4',
  offer: 'M14 3H6v18h12V7zM14 3v4h4M9 14l2 2 4-4',
  integrations: 'M9 7V3M15 7V3M7 7h10v5a5 5 0 0 1-10 0zM12 17v4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  chevron: 'M9 6l6 6-6 6',
};
export default function Icon({ name, size = 16 }: { name: keyof typeof P | string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] ?? ''} /></svg>;
}
