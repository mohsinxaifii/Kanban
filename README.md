# Design Dimensions · Studio

Internal creative-production workspace for Design Dimensions: a Linear-style board that shows what the team is making, who is responsible, what needs approval and where work is waiting.

- **Team Board** with filters (client, project, week, creator, approver, action owner, priority, blocked), optional small Drive thumbnails, and drag-and-drop plus an accessible status menu on every card.
- **My Work**, **Approvals** (sorted by urgency and waiting time), **Weekly Planner** (this week, next week, future weeks, per person) and **Settings**.
- Task side panel with brief, Google Drive submissions, versions, review decisions, comments, approval steps, deadlines, delivery records and full activity history.
- Separate fields for creator, current action owner, assigned approver(s), delivery owner and final recipient. The creator is never replaced.
- Workflow: Backlog → Planned → In Progress → In Review → Changes Requested → Ready to Deliver → Delivered, with a Blocked flag (reason + person needed) on any active stage.
- Configurable approval chain per task (for example Creative Head → Account Manager). Approvals are tied to the exact version reviewed; a new version always needs fresh approval.
- Permissions are enforced on the server. Review, approval and delivery stages can only be reached through submissions, approvals and delivery records, so dragging a card cannot skip approval.
- Live updates: changes made by one person appear for everyone else without refreshing, plus in-app notifications.
- **Job titles are roles**: when you save a person, their job title becomes a role with exactly the permissions you chose, and the next person given that title starts with the same permissions (Settings → Roles and permissions lists them).
- **Team sign-up link**: one shareable link where people ask to join with their name, email and designation. They get no access until someone who manages users approves them and picks their role, permissions and projects (Settings → People).
- **Export report** (top bar, for people with "See all team work", which administrators and creative heads have by default): a spreadsheet (CSV) of every open task with its stage, how long it has been there, who it is waiting on and for how long, the deadline and whether it is overdue.
- **Saved**: each person's private folders of tasks and web links. Save a task from its panel; saving never shares or widens access.
- A short **welcome tour** for every new person on their first sign-in, which they can replay from "Take the tour" in the sidebar.

## Stack

- PHP 8.1+ (no frameworks, no Composer) with SQLite through PDO: one database file on the server. Runs on ordinary cPanel shared hosting.
- React 18 + Vite front end, built to static files, Inter typeface (bundled)
- Live updates: open pages check for changes every few seconds
- Sign in with Google or with email and password (bcrypt hashes; hashes from the earlier Node.js version are still accepted and upgraded on next sign-in), HttpOnly session cookies, invitation links, **forgot password** emails, and **administrators can set anyone's password** (Settings → People → Edit)
- Everyone can change their own password in Settings → Your account
- Settings → Appearance: light, dark or system theme, four text sizes and four text styles (saved per device)

## Run it locally

Needs Node.js (only to build the front end) and PHP 8.1+ with the `pdo_sqlite` extension.

```bash
npm install
npm run build                         # front end into dist/
php -S localhost:3000 -t dist api/router.php   # http://localhost:3000
```

For development with hot reload: `npm run dev` (UI on http://localhost:5173, API on :3000).

Without `api/config.php` the app uses `data/studio.db` next to the project and seeds the demo workspace.

### Demo accounts

While `DEMO_MODE` is on, the login page lists fictional demo accounts. All use the password `demo-studio-2026`.

| Person | Role | Notes |
| --- | --- | --- |
| Aanya Shah | Creative Head | Approver on most sample tasks |
| Rohan Mehta | Video Editor | |
| Meera Kapoor | Graphic Designer | |
| Kabir Sethi | Account Manager | Explicitly authorised to approve (not a role default), to show a two-step chain |
| Nisha Rao | Marketing Recipient | Access to the Halden Audio projects only |
| Studio Admin | Administrator | Manages people and permissions |

### Starting over with an empty workspace

Set `RESET_WORKSPACE` in `api/config.php` to a phrase only you know. On the next request everything is deleted once for that phrase and the site shows **Set up your studio**, where you create the first administrator with the same phrase. Empty it again afterwards.

## Configuration

Settings live in `api/config.php` (copy `api/config.sample.php`). It is never served to browsers and is not part of the upload zip, so updates keep it.

| Setting | Purpose |
| --- | --- |
| `PUBLIC_URL` | The site address, used in invite and reset links. Taken from the request if empty |
| `DATABASE_PATH` | The SQLite file. Keep it outside `public_html` |
| `DEMO_MODE` | `true` seeds and allows the fictional demo accounts; `false` turns them off |
| `EMAIL_FROM` | Sender for invitations and password resets. Without it, no email is sent and admins copy links themselves |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | Optional: send through a mailbox over SMTP instead of the server's own mail |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional: “Continue with Google” |
| `GOOGLE_DRIVE_API_KEY` | Optional: checks whether submitted Drive links are shared publicly |
| `RESET_WORKSPACE` | A phrase. Deletes all data once per phrase (see above) |

## Verification

Both scripts start PHP's built-in server on a fresh temporary database:

```bash
npm run verify                         # 181 API checks with separate signed-in accounts
npm run build && npm run verify:ui     # browser walkthrough (needs a Playwright Chromium, or CHROME_PATH=…)
```

If your PHP has no `pdo_sqlite` loaded, pass it in: `PHP_ARGS="-d extension=/path/to/pdo_sqlite.so" npm run verify`.

They cover the full workflow (create → submit → request changes → resubmit → approve → deliver), permissions and project access, stage rules, invitations, the sign-up link, password reset, administrator-set passwords, sign-in with passwords from the earlier version, live-update signals and persistence. `npm run verify` writes `verify-output/verification-report.md`.

## Emails (invitations and password resets)

With `EMAIL_FROM` set, adding a person emails their invitation link, and **Forgot password?** on the sign-in page emails a reset link (valid for one hour, works once). Invite links are always shown to the administrator as well.

1. cPanel → **Email Accounts → Create**, for example `studio@designdimensions.in`.
2. Put that address in `EMAIL_FROM`. That is enough: mail goes out through the server.
3. If emails land in spam, also fill in `SMTP_HOST` (often `mail.designdimensions.in`), `SMTP_PORT` `465`, `SMTP_USER` (the full address) and `SMTP_PASSWORD`.

Without email, people who forget their password ask an administrator, who sets a new one in Settings → People → Edit → **Set password**.

## Google sign-in

“Continue with Google” appears on the sign-in and invitation pages once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Google only proves who someone is: the email must already belong to someone added in Settings. An invited person who signs in with Google using the invited email is activated; anyone else is turned away, and no account is ever created from a Google sign-in. Demo accounts cannot use Google.

To create the credentials:

1. In [Google Cloud Console](https://console.cloud.google.com), create or pick a project.
2. **APIs & Services → OAuth consent screen**: choose *External* (or *Internal* if everyone uses your Google Workspace), add the app name and your email, and keep the default scopes (`openid`, `email`, `profile`). Publish the app so it is not limited to test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*. Under **Authorised redirect URIs** add `https://team.designdimensions.in/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback` for local use).
4. Put the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `api/config.php`.

## Google Drive

App permissions and Google Drive permissions are separate. Naming a reviewer in the app does **not** share the file with them, and the app never changes sharing or makes files public. The submit form says this, and reviewers can report **Cannot access file** (with a required description), which sends the next action back to the submitter until they confirm sharing is fixed.

- Without configuration, every submission shows **Access not verified**.
- With `GOOGLE_DRIVE_API_KEY`, the server asks Drive whether the link opens for *anyone with the link*. It reports “Link-shared” or “Restricted in Drive”. It still does not claim that a specific reviewer can open a restricted file.
- Previews use Google's embed URLs and load with the viewer's own Google session, so they show whether *you* can open it.

## Deploying on cPanel

Everything runs on the cPanel account: PHP serves the app and the database is one file in the home folder. No Node.js, Render or Turso is needed on the server.

### First install

1. **Subdomain.** cPanel → **Domains → Create a New Domain**: `team.designdimensions.in`. Note its document root (for example `/home1/a178436f/team.designdimensions.in`). Then **SSL/TLS Status → Run AutoSSL** so it gets HTTPS.
2. **PHP.** cPanel → **MultiPHP Manager**: set the subdomain to PHP 8.1 or newer. If the app later says `pdo_sqlite` is missing, enable it in **Select PHP Version → Extensions**.
3. **Build the zip** on your computer: `npm ci && npm run package` → `release/team-studio.zip`.
4. **Upload.** File Manager → the subdomain's document root → **Upload** the zip → **Extract**.
5. **Settings.** In `api/`, copy `config.sample.php` to `config.php` and edit it (File Manager → Edit). At least `PUBLIC_URL`, `DATABASE_PATH` and `DEMO_MODE`.
6. **Database folder.** File Manager → home folder → **+ Folder** `studio-data` (outside `public_html`). Put the database there (next section), or leave it empty for a new workspace.
7. Open `https://team.designdimensions.in/api/health`; it answers `{"ok":true}`.

### Moving from Turso and Render (one time)

1. Finish the steps above, but do not tell the team yet.
2. **Freeze the old site:** Render → the service → **Settings → Suspend Web Service**.
3. **Copy the data** on your computer (Turso dashboard → the database → its URL and a new token):
   ```bash
   TURSO_DATABASE_URL='libsql://…turso.io' TURSO_AUTH_TOKEN='…' DATABASE_PATH=./studio.db npm run import-from-turso
   ```
   Every line must say `ok`. It writes one file, `studio.db`, and refuses to overwrite an existing one.
4. **Upload** `studio.db` into `studio-data/` on cPanel.
5. Sign in at the new address and check people and tasks. Everyone keeps their password; each person's first sign-in takes a second or two longer while it is upgraded.
6. Send the team the new address. Keep Render suspended (and Turso) for a week as a fallback, then delete them.

### Updating

`npm run package`, upload the zip to the same folder and extract it over the old files. `api/config.php` and the database are not touched.

### Backups

Everything is in `studio-data/` (`studio.db`, plus `-wal`/`-shm` files while in use). Include the home folder in cPanel **Backup**, and download a copy regularly.

### Notes

- Live updates are a quick check every 5 seconds from each open page; it pauses while the tab is hidden.
- `.htaccess` sends every `/api/…` request to `api/index.php` and forces HTTPS. `api/config.php` and `api/lib/` are blocked from the web.

## What is still needed

See [docs/REMAINING.md](docs/REMAINING.md).
