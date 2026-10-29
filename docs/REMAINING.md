# Infrastructure and integrations still needed

The app runs end to end today with its own accounts, database and live updates. These pieces are needed before the whole team relies on it.

## Needed before real use

1. **Hosting.** A Render Blueprint (`render.yaml`) is included for Render's free plan, with the database in a free Turso database. You need a Render account and a Turso account (README → Deploying). Optionally add a custom domain such as `studio.designdimensions.com` and set `PUBLIC_URL` to it. Run one instance.
2. **Database backups.** Turso keeps point-in-time history depending on plan; for extra safety schedule a periodic export (`turso db shell <db> .dump > backup.sql`) to your own storage.
3. **Email for invitations and notifications.** Invites currently produce a link the administrator copies and sends. Connect a transactional email service (Postmark, Resend, SES or Google Workspace SMTP) to send invite links and, optionally, notification digests. Password reset also depends on this; today an administrator can issue a fresh invite link for pending invitations, and `npm run create-admin` can reset an administrator.
4. **A real administrator account and real data.** Run `npm run create-admin`, invite the team, add real clients and projects, remove the demo data and set `DEMO_MODE=false`.

## Recommended

5. **Google sign-in (OAuth / Google Workspace SSO).** Replaces passwords with the studio's Google accounts and restricts sign-in to the company domain. The invitation and permission model stays the same; only login changes.
6. **Google Drive API integration (OAuth, per user).** The optional API-key check only tells you whether a link is shared publicly. A proper integration, using each submitter's Google authorisation, could read the file name and thumbnail, list the file's permissions and warn when the assigned reviewer is not on them. It must keep the rule that the app never changes sharing or makes files public on its own.
7. **Automated delivery.** Deliveries are recorded manually and labelled "Manual record". Sending through Gmail or Drive sharing with confirmation would allow "Verified automated send" records (the data model already distinguishes them).
8. **Error monitoring and uptime checks** (Sentry or similar, plus a ping on `/api/health`).

## Known limits of this version

- Live updates and login rate limiting are held in memory, so the app should run as a single process.
- On Render's free plan the app sleeps when idle and takes up to a minute to wake.
- Workflow stages and role defaults are defined in code (`server/workflow.js`, `server/permissions.js`). Per-person permissions and per-task approval chains are configurable in the app; editing the stage list itself is not.
- Card thumbnails are off by default (Thumbnails toggle on the board). They come from Google Drive and only appear for people whose Google account can open the file; sample tasks have no real files, so they show none.
