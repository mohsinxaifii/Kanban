# Design Dimensions · Studio

Internal creative-production workspace for Design Dimensions: a Linear-style board that shows what the team is making, who is responsible, what needs approval and where work is waiting.

- **Team Board** with filters (client, project, week, creator, approver, action owner, priority, blocked), optional small Drive thumbnails, and drag-and-drop plus an accessible status menu on every card.
- **My Work**, **Approvals** (sorted by urgency and waiting time), **Weekly Planner** (this week, next week, future weeks, per person) and **Team Settings**.
- Task side panel with brief, Google Drive submissions, versions, review decisions, comments, approval steps, deadlines, delivery records and full activity history.
- Separate fields for creator, current action owner, assigned approver(s), delivery owner and final recipient. The creator is never replaced.
- Workflow: Backlog → Planned → In Progress → In Review → Changes Requested → Ready to Deliver → Delivered, with a Blocked flag (reason + person needed) on any active stage.
- Configurable approval chain per task (for example Creative Head → Account Manager). Approvals are tied to the exact version reviewed; a new version always needs fresh approval.
- Permissions are enforced on the server. Review, approval and delivery stages can only be reached through submissions, approvals and delivery records, so dragging a card cannot skip approval.
- Live updates: changes made by one person appear for everyone else without refreshing, plus in-app notifications.

## Stack

- Node.js 22.13+ with Express 5 and SQLite via libSQL: a local file in development, or a hosted Turso database in production
- React 18 + Vite front end, Inter typeface (bundled)
- Server-Sent Events for live updates
- Sign in with Google or with email and password (scrypt hashes, HttpOnly session cookies); invitation links for new people
- Light, dark and system themes (switch at the bottom of the sidebar)

## Run it locally

```bash
npm install
npm run build      # build the front end into dist/
npm start          # http://localhost:3000
```

For development with hot reload (API on :3000, UI on http://localhost:5173):

```bash
npm run dev
```

On first start the server creates `data/studio.db` and, while `DEMO_MODE` is on (the default), seeds the demo workspace.

### Demo accounts

The login page lists the fictional demo accounts. All use the password `demo-studio-2026` (change with `DEMO_PASSWORD`).

| Person | Role | Notes |
| --- | --- | --- |
| Aanya Shah | Creative Head | Approver on most sample tasks |
| Rohan Mehta | Video Editor | |
| Meera Kapoor | Graphic Designer | |
| Kabir Sethi | Account Manager | Explicitly authorised to approve (not a role default), to show a two-step chain |
| Nisha Rao | Marketing Recipient | Access to the Halden Audio projects only |
| Studio Admin | Administrator | Manages people and permissions |

They use the reserved `demo.designdimensions.test` domain, are labelled **Demo** everywhere, and the sample tasks are labelled **Sample**. The client names (Halden Audio, Saffron & Sage, Northpeak Outdoors) are fictional.

### Going live with real accounts

1. Create a real administrator:
   ```bash
   npm run create-admin -- "Your Name" you@designdimensions.com
   ```
2. Sign in as that administrator, open **Team Settings → People → Add person** and invite the team. Each invite produces a link; email sending is not configured yet, so send the link yourself. People get access only after accepting.
3. Add your real clients and projects in **Team Settings → Projects**.
4. Remove the sample people and work in **Team Settings → Demo data**, and set `DEMO_MODE=false` so they are not seeded into a new database.

## Configuration

Copy `.env.example` to `.env` (loaded automatically by `npm start`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_URL` | `http://localhost:3000` | Used in invite links. An `https://` URL also marks cookies `Secure` |
| `DATABASE_PATH` | `./data/studio.db` | Local SQLite file, used when no Turso URL is set |
| `TURSO_DATABASE_URL` | empty | Hosted database (`libsql://…`). When set, it is used instead of the local file |
| `TURSO_AUTH_TOKEN` | empty | Token for the Turso database |
| `DEMO_MODE` | `true` | Seed the demo workspace once per database. When `false`, demo accounts cannot sign in |
| `DEMO_PASSWORD` | `demo-studio-2026` | Password for demo accounts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | empty | Optional. Enables “Continue with Google”. See Google sign-in below |
| `GOOGLE_DRIVE_API_KEY` | empty | Optional. See Google Drive below |

## Verification

Two scripts start their own server on a fresh temporary database:

```bash
npm run verify       # 105 API checks with separate signed-in accounts
npm run build && npm run verify:ui   # browser walkthrough (needs a Playwright Chromium, or CHROME_PATH=/path/to/chrome)
```

`npm run verify` runs the full example (Kabir creates “Product launch reel”, Rohan submits v1, Aanya requests changes, Rohan submits v2, Aanya approves, Kabir delivers to Nisha) and checks, among other things, that:

- unassigned or unauthorised people cannot see restricted tasks, approve, submit or record delivery;
- stages cannot be skipped by moving cards, including straight to Ready to Deliver or Delivered;
- every decision is tied to a specific version, earlier versions and decisions are preserved, and a new version (even after approval) restarts approval at step 1;
- removing someone's approval permission stops them approving immediately, even on a step they are named on;
- invitations, deactivation (with immediate sign-out) and project-level access work;
- open sessions receive live updates, and everything persists across a server restart.

It writes `verify-output/verification-report.md`. The UI walkthrough saves screenshots to `verify-output/screens/`.

## Google sign-in

“Continue with Google” appears on the sign-in and invitation pages once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Google only proves who someone is: the email must already belong to someone added in Team Settings. An invited person who signs in with Google using the invited email is activated; anyone else is turned away, and no account is ever created from a Google sign-in. Demo accounts cannot use Google.

To create the credentials:

1. In [Google Cloud Console](https://console.cloud.google.com), create or pick a project.
2. **APIs & Services → OAuth consent screen**: choose *External* (or *Internal* if everyone uses your Google Workspace), add the app name and your email, and keep the default scopes (`openid`, `email`, `profile`). Publish the app so it is not limited to test users.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*. Under **Authorised redirect URIs** add `https://<your-service>.onrender.com/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback` for local use).
4. Put the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (Render → Environment).

## Google Drive

App permissions and Google Drive permissions are separate. Naming a reviewer in the app does **not** share the file with them, and the app never changes sharing or makes files public. The submit form says this, and reviewers can report **Cannot access file** (with a required description), which sends the next action back to the submitter until they confirm sharing is fixed.

- Without configuration, every submission shows **Access not verified**.
- With `GOOGLE_DRIVE_API_KEY`, the server asks Drive whether the link opens for *anyone with the link*. It reports “Link-shared” or “Restricted in Drive”. It still does not claim that a specific reviewer can open a restricted file.
- Previews use Google's embed URLs and load with the viewer's own Google session, so they show whether *you* can open it.

## Deploying

### Render free plan + Turso (no cost)

Render's free web services have no persistent disk, so the database lives in [Turso](https://turso.tech), a hosted SQLite service with a free tier. The included `render.yaml` sets this up.

1. **Create the database.** Sign up at turso.tech, create a database (pick the location closest to your Render region, which is Singapore in `render.yaml`), then from the database page copy its **URL** (`libsql://…turso.io`) and create an **auth token**.
2. **Create the service.** In the Render dashboard choose **New → Blueprint**, connect GitHub and select this repository. When asked, paste `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, then click **Apply**. The first build takes a few minutes.
3. Open the `onrender.com` URL. The tables and demo workspace are created automatically on first start. Invite links use Render's address automatically; set `PUBLIC_URL` if you add a custom domain.
4. Create your real administrator from your own computer, pointed at the same Turso database:
   ```bash
   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run create-admin -- "Your Name" you@designdimensions.com
   ```
5. Before adding real clients, set `DEMO_MODE=false` in the service's **Environment** tab. Demo accounts then stop signing in and the login page no longer lists them. Remove the sample work in Team Settings → Demo data.

Free-plan behaviour to expect: the service sleeps after about 15 minutes without visits and takes roughly 30–60 seconds to wake on the next visit. Live updates reconnect automatically. Data is safe in Turso throughout. Check current free-tier limits on both services when you sign up.

To move to an always-on paid instance later, change `plan: free` to `plan: starter` in `render.yaml`; nothing else needs to change.

### Other hosts

Any host that runs a Node.js process with a persistent disk works (Render, Railway, Fly.io, a small VM). A `Dockerfile` is included:

```bash
docker build -t dd-studio .
docker run -p 3000:3000 -v dd-data:/data -e PUBLIC_URL=https://studio.example.com -e DEMO_MODE=false dd-studio
```

Run a single instance: live updates are held in one process. Put it behind HTTPS, and either mount a persistent volume for the local database file or set `TURSO_DATABASE_URL`.

## What is still needed

See [docs/REMAINING.md](docs/REMAINING.md).
