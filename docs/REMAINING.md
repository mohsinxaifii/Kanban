# Infrastructure and integrations still needed

The app runs end to end today with its own accounts, database and live updates. These pieces are needed before the whole team relies on it.

## Needed before real use

1. **Hosting.** Runs on cPanel with PHP 8.1+ and a SQLite file in the home folder (README → Deploying on cPanel).
2. **Database backups.** Include the `DATABASE_PATH` folder in cPanel backups, and keep an off-server copy.
3. **Email.** Invitations and password resets go out from a cPanel mailbox (README → Emails). Administrators can also set anyone's password. Notification digests are not built yet.
4. **Real data.** Moved over from Turso (README → Moving from Turso and Render). Set `DEMO_MODE` to `false` once demo accounts are no longer wanted.

## Recommended

5. **Google sign-in credentials.** “Continue with Google” is built in; it needs an OAuth client ID and secret from Google Cloud Console (README → Google sign-in).
6. **Google Drive API integration (OAuth, per user).** The optional API-key check only tells you whether a link is shared publicly. A proper integration, using each submitter's Google authorisation, could read the file name and thumbnail, list the file's permissions and warn when the assigned reviewer is not on them. It must keep the rule that the app never changes sharing or makes files public on its own.
7. **Automated delivery.** Deliveries are recorded manually and labelled "Manual record". Sending through Gmail or Drive sharing with confirmation would allow "Verified automated send" records (the data model already distinguishes them).
8. **Error monitoring and uptime checks** (Sentry or similar, plus a ping on `/api/health`).

## Known limits of this version

- Live updates arrive within about 5 seconds (pages poll for changes).
- Workflow stages and role defaults are defined in code (`server/workflow.js`, `server/permissions.js`). Per-person permissions and per-task approval chains are configurable in the app; editing the stage list itself is not.
- Card thumbnails are off by default (Thumbnails toggle on the board). They come from Google Drive and only appear for people whose Google account can open the file; sample tasks have no real files, so they show none.
