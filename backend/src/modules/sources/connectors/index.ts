import type { Connector } from './types.js';
import { restConnector } from './rest.js';
import { postgresConnector } from './postgres.js';
import { csvUrlConnector } from './csvurl.js';
import { imapConnector } from './imap.js';
import { graphMailConnector } from './graphmail.js';

const push = (type: string, label: string, canonical = false): Connector => ({ type, label, pull: false, canonical });

/** Register new connector types here. */
export const connectors: Record<string, Connector> = {
  imap: imapConnector,
  graphmail: graphMailConnector,
  csvurl: csvUrlConnector,
  rest: restConnector,
  postgres: postgresConnector,
  webhook: push('webhook', 'Inbound webhook'),
  file: push('file', 'CSV / Excel upload'),
  resume: push('resume', 'Resume upload (PDF / DOCX)', true),
  careers: push('careers', 'Careers page applications', true),
  manual: push('manual', 'Manual entry', true),
};

type Tpl = { id: string; name: string; connector: string; group: string; ready: boolean; note: string; link?: string; linkText?: string; config: Record<string, unknown>; mapping: Record<string, string>; secretFields?: string[] };

/**
 * Templates = connector type + default config + field mapping for a known system.
 * ready=true  → works today with your own account / credentials.
 * ready=false → needs a commercial partnership or API access from that vendor first.
 */
export const templates: Tpl[] = [
  // ---- Work today, free or with your own account ----
  { id: 'gmail', link: 'https://myaccount.google.com/apppasswords', linkText: 'Create a Gmail App Password',  group: 'Email inboxes', ready: true, name: 'Gmail / Google Workspace inbox', connector: 'imap',
    note: 'Forward Naukri, LinkedIn, Indeed and agency application emails here. Each attached resume becomes a candidate. Needs an App Password (Google Account → Security → 2-Step Verification → App passwords).',
    config: { host: 'imap.gmail.com', port: 993, secure: true, mailbox: 'INBOX', firstSyncDays: 7, maxMessages: 200, markSeen: true }, mapping: {}, secretFields: ['user', 'password'] },
  { id: 'imap', group: 'Email inboxes', ready: true, name: 'Any IMAP inbox (Zoho, GoDaddy, Hostinger…)', connector: 'imap',
    note: 'Use your mail provider’s IMAP host and an app password if your provider supports them.',
    config: { host: '', port: 993, secure: true, mailbox: 'INBOX', firstSyncDays: 7, maxMessages: 200, markSeen: true }, mapping: {}, secretFields: ['user', 'password'] },
  { id: 'm365', link: 'https://learn.microsoft.com/graph/permissions-reference#mailread', linkText: 'Mail.Read permission',  group: 'Email inboxes', ready: true, name: 'Microsoft 365 / Outlook mailbox', connector: 'graphmail',
    note: 'Uses the Microsoft app from Integrations (Teams). Add the Mail.Read application permission and grant admin consent.',
    config: { mailbox: 'careers@yourcompany.com', folder: 'inbox', firstSyncDays: 7, maxMessages: 200 }, mapping: {} },
  { id: 'gsheet', link: 'https://support.google.com/docs/answer/2494822', linkText: 'How to share a Google Sheet',  group: 'Forms & sheets', ready: true, name: 'Google Form / Google Sheet', connector: 'csvurl',
    note: 'Link a Google Form to a sheet, share the sheet as "Anyone with the link: Viewer", paste its link. New rows sync on schedule.',
    config: { url: '' }, mapping: {} },
  { id: 'csvurl', group: 'Forms & sheets', ready: true, name: 'Any CSV / Excel link', connector: 'csvurl', note: 'A published CSV or XLSX URL from any system.', config: { url: '' }, mapping: {} },
  { id: 'file', group: 'Forms & sheets', ready: true, name: 'Spreadsheet upload (CSV / Excel)', connector: 'file', note: 'Upload files by hand; map columns on each upload.', config: {}, mapping: {} },

  // ---- ATS / HR systems with public APIs (your account's API key) ----
  { id: 'greenhouse', link: 'https://developers.greenhouse.io/harvest.html', linkText: 'Greenhouse Harvest API',  group: 'ATS & HR systems', ready: true, name: 'Greenhouse', connector: 'rest',
    note: 'Harvest API key (Configure → Dev Center → API Credential Management, type Harvest). Paste the key as username; leave password empty.',
    config: { url: 'https://harvest.greenhouse.io/v1/candidates', authType: 'basic', pagination: 'page', pageParam: 'page', pageSizeParam: 'per_page', pageSize: 100, sinceParam: 'updated_after', sinceFormat: 'iso' },
    mapping: { first_name: 'name', last_name: 'name', 'email_addresses.0.value': 'email', 'phone_numbers.0.value': 'phone', 'addresses.0.value': 'location', company: 'company', title: 'title', id: 'externalId' }, secretFields: ['username', 'password'] },
  { id: 'lever', link: 'https://hire.lever.co/developer/documentation', linkText: 'Lever API docs',  group: 'ATS & HR systems', ready: true, name: 'Lever', connector: 'rest',
    note: 'Settings → Integrations and API → API credentials. Paste the key as username; leave password empty.',
    config: { url: 'https://api.lever.co/v1/opportunities?expand=contact', authType: 'basic', recordsPath: 'data', pagination: 'cursor', cursorParam: 'offset', cursorPath: 'next', pageSizeParam: 'limit', pageSize: 100, sinceParam: 'updated_at_start', sinceFormat: 'epochMs' },
    mapping: { name: 'name', 'emails.0': 'email', 'phones.0.value': 'phone', location: 'location', headline: 'title', id: 'externalId' }, secretFields: ['username', 'password'] },
  { id: 'workable', link: 'https://workable.readme.io/reference/generate-an-access-token', linkText: 'Workable access token',  group: 'ATS & HR systems', ready: true, name: 'Workable', connector: 'rest',
    note: 'Settings → Integrations → Access token (r_candidates). Replace YOURCOMPANY in the URL with your Workable subdomain.',
    config: { url: 'https://YOURCOMPANY.workable.com/spi/v3/candidates', authType: 'bearer', recordsPath: 'candidates', pagination: 'nextUrl', nextUrlPath: 'paging.next', pageSizeParam: 'limit', pageSize: 100, sinceParam: 'updated_after', sinceFormat: 'iso' },
    mapping: { name: 'name', email: 'email', phone: 'phone', address: 'location', headline: 'title', skills: 'skills', id: 'externalId', resume_url: 'resumeUrl' }, secretFields: ['token'] },
  { id: 'zoho', link: 'https://api-console.zoho.in/', linkText: 'Zoho API console',  group: 'ATS & HR systems', ready: true, name: 'Zoho Recruit (India DC)', connector: 'rest',
    note: 'Create a Self Client at api-console.zoho.in with scope ZohoRecruit.modules.candidate.READ, generate a refresh token, then paste client ID, secret and refresh token.',
    config: { url: 'https://recruit.zoho.in/recruit/v2/Candidates', authType: 'oauth2_refresh', authScheme: 'Zoho-oauthtoken', tokenUrl: 'https://accounts.zoho.in/oauth/v2/token', recordsPath: 'data', pagination: 'page', pageParam: 'page', pageSizeParam: 'per_page', pageSize: 200 },
    mapping: { First_Name: 'name', Last_Name: 'name', Email: 'email', Mobile: 'phone', City: 'location', Experience_in_Years: 'expYears', Skill_Set: 'skills', Current_Employer: 'company', Current_Job_Title: 'title', Current_Salary: 'currentCtc', Expected_Salary: 'expectedCtc', Highest_Qualification_Held: 'education', id: 'externalId' }, secretFields: ['clientId', 'clientSecret', 'refreshToken'] },
  { id: 'rest', group: 'ATS & HR systems', ready: true, name: 'Any REST API', connector: 'rest', note: 'Any system with a JSON API. Use "Test & preview" to detect fields.', config: { url: '', authType: 'apiKey', recordsPath: '', pagination: 'none' }, mapping: {} },
  { id: 'internal-db', group: 'ATS & HR systems', ready: true, name: 'Internal database (PostgreSQL)', connector: 'postgres', note: 'Read-only user. $1 in the query = last sync time.', config: { query: "SELECT * FROM candidates WHERE updated_at > COALESCE($1, '1970-01-01')" }, mapping: {}, secretFields: ['connectionString'] },
  { id: 'webhook', group: 'ATS & HR systems', ready: true, name: 'Vendor / agency push (webhook)', connector: 'webhook', note: 'Give each agency its own signed endpoint so submissions are tracked per vendor.', config: {}, mapping: {} },

  // ---- Job portals: need the portal's partner access ----
  { id: 'naukri', group: 'Job portals (partner access needed)', ready: false, name: 'Naukri RMS / Resdex', connector: 'rest',
    note: 'Naukri has no public API. Ask your Naukri account manager for RMS API access and its spec. Works today: forward Naukri application emails to a resume inbox above.',
    config: { url: '', authType: 'oauth2' }, mapping: {} },
  { id: 'linkedin', group: 'Job portals (partner access needed)', ready: false, name: 'LinkedIn Recruiter (RSC)', connector: 'webhook',
    note: 'Requires LinkedIn Recruiter System Connect partner approval. Works today: forward LinkedIn applicant emails to a resume inbox above.',
    config: {}, mapping: { firstName: 'name', lastName: 'name', emailAddress: 'email', phoneNumber: 'phone', 'location.name': 'location', headline: 'title', id: 'externalId' } },
  { id: 'indeed', group: 'Job portals (partner access needed)', ready: false, name: 'Indeed Apply', connector: 'webhook',
    note: 'Requires Indeed partner onboarding. Works today: forward Indeed applicant emails to a resume inbox above.',
    config: {}, mapping: { 'applicant.fullName': 'name', 'applicant.email': 'email', 'applicant.phoneNumber': 'phone', id: 'externalId' } },
];
