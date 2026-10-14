# HRMS — Recruitment Lifecycle Platform

Client requirement → sourcing → screening → communication → interview → selection → hiring → BGV → joining → billing, in one system.

| Layer | Stack |
|---|---|
| Web | React 18, TypeScript, Vite (Deloitte-aligned theme in `frontend/src/theme.css`) |
| API | Node 22, Express, TypeScript, Zod validation, JWT auth with roles |
| Data | PostgreSQL via Prisma; Redis + BullMQ for scheduled source syncs |
| Meetings | Microsoft Teams (Graph), Zoom (S2S OAuth), Google Meet (Calendar API), Cisco Webex, in person, phone |
| Calendars | Outlook free/busy (Graph `getSchedule`), Google free/busy |
| AI | Azure OpenAI or Anthropic Claude behind one gateway (`backend/src/modules/ai`) |

## Free setup (no Docker, no credit card)

| Need | Free service | Upgrade later by changing… |
|---|---|---|
| Database | **Neon** Postgres (neon.tech) | `DATABASE_URL` → Neon paid, Azure PostgreSQL, AWS RDS |
| Hosting (API + website as one service) | **Render** free web service | `plan: starter` in `render.yaml` (no sleeping) |
| Background syncs | Built into the API, plus **GitHub Actions** cron (`.github/workflows/cron.yml`) | set `REDIS_URL` and run the worker |
| Video interviews | **Jitsi Meet** (no account) | add Teams / Zoom / Meet / Webex keys |
| Email | **Brevo API** (HTTPS — Render free blocks SMTP); Gmail App Password works locally | Office 365 / SendGrid / SES SMTP values |
| AI | **Groq** free API (OpenAI-compatible) | `AI_PROVIDER=azure` or `anthropic` |

### 1. Database (5 min)
neon.tech → sign up → **New project** (region: Singapore, closest to India) → copy the connection string.

### 2. Run on your laptop
```powershell
cd backend
copy .env.example .env      # then fill the REQUIRED block: DATABASE_URL, JWT_SECRET, ENCRYPTION_KEY
npm install
npm run db:setup            # creates all tables in Neon
npm run db:seed             # admin@hrms.local / ChangeMe!2026 (no fake data; SEED_DEMO=true for samples)
npm run dev                 # API → http://localhost:4000

# second terminal
cd frontend
npm install
npm run dev                 # app → http://localhost:5173
```

### 3. Put it online (Render free)

Full step-by-step guide with links: **[DEPLOY.md](DEPLOY.md)**. Summary:
1. Push this folder to a **private** GitHub repo (`.env` is git-ignored — never commit it).
2. Render → **New → Blueprint** → choose the repo. It reads `render.yaml`.
3. Fill the variables Render asks for: `DATABASE_URL` (same Neon URL), `ENCRYPTION_KEY` (same as your laptop, or saved source credentials can't be decrypted), `APP_URL` (`https://<service>.onrender.com`), plus email and AI keys if you have them.
4. Deploy. Open `https://<service>.onrender.com` and sign in.
5. Optional, for scheduled syncs: in GitHub → Settings → Secrets → Actions add `HRMS_URL` and `CRON_SECRET` (copy it from Render's environment tab).

Free-tier limits: the Render service sleeps after 15 minutes idle (first load ~1 minute), Neon free has 0.5 GB storage, Brevo 300 emails/day, Groq has rate limits. Fine for demos and pilots; not for real client data.

## Going paid (no code changes)
1. Render: `plan: starter` → no sleeping, webhooks always on.
2. Redis: add a Key Value / Upstash instance, set `REDIS_URL`, uncomment the worker in `render.yaml`.
3. Database: move to Neon paid or Azure PostgreSQL, update `DATABASE_URL`. Before that, run `npx prisma migrate dev --name init` once and commit `prisma/migrations` so future schema changes are versioned (the start script switches to `migrate deploy` automatically).
4. Meetings: add Teams/Zoom/Google/Webex keys (see below). Set `JITSI_ENABLED=false` if the client wants only corporate tools.
5. AI: `AI_PROVIDER=azure` with Azure OpenAI in an India region for data residency.
6. Enterprise (Deloitte): Azure Container Apps + Azure PostgreSQL + Key Vault + Entra ID SSO, using the Dockerfiles and `docker-compose.yml` in this repo.

## Roles

`ADMIN` everything, including data sources and users · `RECRUITER` requirements, candidates, interviews, interviewers · `INTERVIEWER` sees only their own interviews and submits their own scorecards · `FINANCE` billing · `VIEWER` read only.

## Interview scheduling

1. **Interviewers** page: add each interviewer with the skills they assess, the rounds they take, working days and hours, time zone, daily and weekly limits, buffer between interviews, which calendar holds their availability, and their default meeting platform.
2. **Schedule interview** (from Interviews or a candidate's page):
   - pick candidate, round, duration and platform (only connected platforms can be chosen);
   - HRMS ranks interviewers by skill match with the requirement (65%) and spare capacity this week (35%);
   - it finds common free slots for the whole panel from their Outlook/Google calendars **plus** interviews already booked in HRMS, inside working hours, respecting buffers and daily limits;
   - on confirm it creates the meeting and sends invites.
3. Reschedule and cancel update the meeting on the platform and notify everyone. Each panelist submits a scorecard, and AI can check it for vague or non-job-related remarks.

| Platform | Who sends invites | Setup |
|---|---|---|
| Microsoft Teams | Exchange (Outlook invite with Teams link) | Azure app registration → API permissions → **Application** `Calendars.ReadWrite` → grant admin consent. Set `MS_*`. `MS_ORGANIZER_UPN` is the mailbox that owns interview events (a shared recruiting mailbox works well). Restrict the app to that mailbox with `New-ApplicationAccessPolicy` in Exchange Online PowerShell. |
| Zoom | HRMS (.ics by email) | Zoom Marketplace → Server-to-Server OAuth app → scopes to create, update and delete meetings. Set `ZOOM_*`, and configure SMTP. |
| Google Meet | Google Calendar | Service account with domain-wide delegation for `https://www.googleapis.com/auth/calendar`. Set `GOOGLE_*`. |
| Webex | Webex | Service app or integration token with meeting scopes. Set `WEBEX_ACCESS_TOKEN`. |
| In person / phone | HRMS (.ics by email) | SMTP only. |

**Add another platform** (e.g. Amazon Chime, Jitsi, BlueJeans): implement `MeetingProvider` in `backend/src/modules/scheduling/providers/`, register it in `providers/index.ts`, add the enum value to `MeetingProviderId` in `schema.prisma`, run a migration.

Check each connection on the **Integrations** page with **Test connection**.

## Candidate data sources — real connectors

All sources run through one pipeline: **connector → field mapping (or resume parsing) → normalisation → duplicate check (email, phone, source record ID) → merge or create → auto-match to the best open requirement**. Add sources in the app under **Data sources → Add data source → Test & preview → Connect**. No code changes.

**Work today, free:**

| Source | How it works |
|---|---|
| **Resume upload** | Candidates → Upload resumes. Up to 50 PDF/DOCX/TXT files at once, each parsed into a candidate with the file attached. |
| **Gmail / Google Workspace inbox** | IMAP + App Password. Forward application emails from Naukri, LinkedIn, Indeed, Foundit, agencies to this inbox; every resume attachment becomes a candidate tagged with its channel ("via Naukri"). |
| **Any IMAP inbox** | Zoho Mail, GoDaddy, Hostinger, etc. |
| **Microsoft 365 mailbox** | Via Microsoft Graph (same Azure app as Teams, plus Mail.Read). |
| **Google Form / Google Sheet / CSV link** | Point a Google Form at a sheet, share it as "Anyone with the link: Viewer", paste the link. New rows sync on schedule. |
| **Spreadsheet upload** | CSV/Excel with any columns; map once. |

**Work with your account's API key:** Greenhouse, Lever, Workable, Zoho Recruit (templates included), any REST API (API key, bearer, basic, OAuth2 client-credentials or refresh-token; page/offset/cursor/next-URL pagination; incremental sync), a PostgreSQL database, or a signed webhook for agencies.

**Need the portal's partner access:** Naukri RMS/Resdex, LinkedIn RSC, Indeed Apply have no public API. Until you have it, the inbox connectors capture their application emails.

Resumes are parsed by the configured AI (OpenAI, Claude, Gemini or Azure OpenAI) with a rule-based fallback, so imports keep working when AI is off. Files are stored in Postgres (free) or any S3-compatible bucket (`STORAGE_DRIVER=s3`). Scanned image-only PDFs need OCR and are reported as unreadable.

**Add a new connector type** (e.g. SFTP, SQL Server, Salesforce): implement `Connector` in `backend/src/modules/sources/connectors/` and register it in `connectors/index.ts`.

## Email

**Integrations → Email**: choose Gmail / Google Workspace, Microsoft 365 (SMTP or Graph), Zoho, Brevo, SendGrid, Amazon SES or any SMTP server → enter the login → **Send test email** → **Save**. Settings are encrypted in the database (or come from `SMTP_*` in `.env`).

Used for: emailing candidates (candidate page → **Send email**, or tick several on Candidates / Talent database → **Email**) with templates and `{{firstName}}`-style placeholders — each person gets a separate email, logged in their Communication history — and for interview invites (.ics) on Jitsi, Zoom, in-person and phone interviews.

## AI providers

Integrations → **AI provider**: choose OpenAI, Anthropic Claude, Google Gemini, Azure OpenAI (or any OpenAI-compatible API such as Groq via the base URL), paste the key, **Test**, **Save**. The key is encrypted in the database and never returned to the browser; saved settings override `.env`. Switch providers any time.

## AI guardrails

- The explainable fit score (`lib/matching.ts`) is deterministic. AI adds summaries on top; it never moves a candidate by itself.
- Prompts instruct the model to ignore protected characteristics; feedback analysis flags non-job-related remarks.
- Every AI call is written to `AuditLog` with its purpose and provider.
- Hiring AI is high-risk under the EU AI Act and needs care under India's DPDP Act: keep human review, document the scoring, and run periodic adverse-impact checks before client use.

## Before production

- Azure AD / Entra ID single sign-on (replace password login in `auth.routes.ts` with OIDC).
- Store secrets in Azure Key Vault; terminate TLS at the load balancer; enable Postgres backups and point-in-time restore.
- Resume parsing (Azure Document Intelligence + LLM) and blob storage for resumes and BGV documents.
- Candidate consent capture, data retention jobs and right-to-erasure handling under the DPDP Act.
- Automated tests (scheduler slot logic, normalisation, connectors) and CI/CD.


## Optional: public careers page
Off by default. Set `PUBLIC_CAREERS=true` to enable `/api/public/jobs` and `/api/public/jobs/:code/apply` for a careers website.
