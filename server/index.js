import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { initDb, dbLocation, one, all, run, tx, now } from './db.js';
import { PERMISSIONS, PERMISSION_KEYS, ROLES, ROLE_KEYS, roleDefaults } from './permissions.js';
import {
  STAGES, ACTIVE_STAGES, HttpError, forbid, bad, can, hasProjectAccess, loadSteps, currentSubmission,
  involvement, viewLevel, requireView, nextAction, checkManualMove, stageLabel, MANUAL_TARGETS,
} from './workflow.js';
import { parseDriveLink, previewUrl, driveIntegration, checkLinkSharing } from './drive.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { seedDemo, DEMO_PASSWORD } from './seed.js';

const PORT = Number(process.env.PORT || 3000);
const DEMO_MODE = (process.env.DEMO_MODE ?? 'true') !== 'false';
const COOKIE = 'dd_session';
const SESSION_DAYS = 14;
// Render provides RENDER_EXTERNAL_URL automatically.
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

await initDb();
if (DEMO_MODE) await seedDemo();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

// ---------- helpers ----------
const str = (v, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optId = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function rowToUser(r) {
  if (!r) return null;
  return { ...r, permissions: JSON.parse(r.permissions), project_access: JSON.parse(r.project_access), password_hash: undefined, invite_token: undefined };
}
const getUser = async (id) => rowToUser(await one('SELECT * FROM users WHERE id = ?', id));
const userRef = (u) => (u ? { id: u.id, name: u.name, color: u.color, title: u.title, is_demo: !!u.is_demo, status: u.status } : null);
async function userMap() {
  const m = new Map();
  for (const r of await all('SELECT * FROM users')) m.set(r.id, rowToUser(r));
  return m;
}

const logActivity = (taskId, actorId, kind, message) =>
  run('INSERT INTO activity (task_id, actor_id, kind, message, created_at) VALUES (?,?,?,?,?)', taskId, actorId, kind, message, now());
const pendingNotifications = [];
async function notify(userId, taskId, message, exceptId) {
  if (!userId || userId === exceptId) return;
  await run('INSERT INTO notifications (user_id, task_id, message, created_at) VALUES (?,?,?,?)', userId, taskId, message, now());
  pendingNotifications.push(userId);
}
const touch = (taskId) => run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), taskId);

// ---------- live updates (Server-Sent Events) ----------
// Events carry no task data, only a signal to refetch, so each client re-reads
// through the same permission checks.
const streams = new Map(); // userId -> Set(res)
function emitAll(type) {
  for (const set of streams.values()) for (const res of set) res.write(`data: ${JSON.stringify({ type })}\n\n`);
}
function flush() {
  emitAll('changed');
  const ids = new Set(pendingNotifications.splice(0));
  for (const id of ids) for (const res of streams.get(id) || []) res.write(`data: ${JSON.stringify({ type: 'notification' })}\n\n`);
}

// ---------- auth ----------
function parseCookies(h = '') {
  return Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
async function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, expires.toISOString());
  const secure = process.env.COOKIE_SECURE === 'true' || PUBLIC_URL.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}${secure}`);
}
async function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const r = await one('SELECT u.* , s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', token);
  if (!r || r.session_expires < now()) return null;
  const u = rowToUser(r);
  delete u.session_expires;
  if (u.status !== 'active') return null;
  if (u.is_demo && !DEMO_MODE) return null; // demo accounts stop working once demo mode is off
  return u;
}
// Mutating requests must come from our own front end (blocks cross-site form posts).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dd-studio') {
    return res.status(403).json({ error: 'Missing request header.' });
  }
  next();
});
const auth = async (req, res, next) => {
  const u = await sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Please sign in.' });
  req.user = u;
  next();
};
const need = (perm) => (req, res, next) => (can(req.user, perm) ? next() : res.status(403).json({ error: `You need the "${PERMISSIONS.find((p) => p.key === perm)?.label}" permission.` }));

const loginAttempts = new Map();
app.post('/api/auth/login', async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  const key = `${req.ip}|${email}`;
  const a = loginAttempts.get(key) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const row = await one('SELECT * FROM users WHERE email = ?', email);
  const ok = row && row.status === 'active' && !(row.is_demo && !DEMO_MODE) && row.password_hash && (await verifyPassword(str(req.body.password, 200), row.password_hash));
  if (!ok) {
    a.n += 1; loginAttempts.set(key, a);
    const msg = row?.status === 'deactivated' ? 'This account has been deactivated.' : row?.status === 'invited' ? 'This invitation has not been accepted yet. Use your invite link.' : 'Email or password is incorrect.';
    return res.status(401).json({ error: msg });
  }
  loginAttempts.delete(key);
  await setSession(res, row.id);
  res.json({ user: await getUser(row.id) });
});
app.post('/api/auth/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await run('DELETE FROM sessions WHERE token = ?', token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/auth/demo', async (req, res) => {
  if (!DEMO_MODE) return res.json({ enabled: false, accounts: [] });
  const accounts = await all("SELECT name, email, title FROM users WHERE is_demo = 1 AND status = 'active' ORDER BY id");
  res.json({ enabled: true, password: DEMO_PASSWORD, accounts });
});
app.get('/api/invite/:token', async (req, res) => {
  const r = await one("SELECT name, email FROM users WHERE invite_token = ? AND status = 'invited'", req.params.token);
  if (!r) return res.status(404).json({ error: 'This invitation is invalid or has already been used.' });
  res.json(r);
});
app.post('/api/invite/:token', async (req, res) => {
  const r = await one("SELECT * FROM users WHERE invite_token = ? AND status = 'invited'", req.params.token);
  if (!r) return res.status(404).json({ error: 'This invitation is invalid or has already been used.' });
  const pw = str(req.body.password, 200);
  if (pw.length < 10) return res.status(400).json({ error: 'Use at least 10 characters.' });
  await run("UPDATE users SET password_hash = ?, status = 'active', invite_token = NULL WHERE id = ?", await hashPassword(pw), r.id);
  await setSession(res, r.id);
  res.json({ user: await getUser(r.id) });
});

// ---------- live stream ----------
app.get('/api/events', auth, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const set = streams.get(req.user.id) || new Set();
  set.add(res); streams.set(req.user.id, set);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); set.delete(res); });
});

// ---------- reference data ----------
async function visibleProjects(user) {
  return (await all(`SELECT p.id, p.name, p.client_id, p.is_demo, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name`))
    .filter((p) => hasProjectAccess(user, p.id));
}
app.get('/api/meta', auth, async (req, res) => {
  res.json({
    stages: STAGES, activeStages: ACTIVE_STAGES, manualTargets: MANUAL_TARGETS,
    permissions: PERMISSIONS, roles: ROLES,
    projects: await visibleProjects(req.user),
    driveIntegration: driveIntegration(),
    demoMode: DEMO_MODE,
  });
});

// Searchable people field source. Only existing accounts are returned; typing a
// name never creates anyone.
app.get('/api/people', auth, async (req, res) => {
  const manage = can(req.user, 'users.manage');
  const rows = (await all("SELECT * FROM users WHERE status != 'deactivated' ORDER BY name")).map(rowToUser)
    .filter((u) => DEMO_MODE || !u.is_demo);
  res.json(rows.map((u) => ({
    ...userRef(u), role: u.role,
    email: manage || u.id === req.user.id ? u.email : undefined,
    can_approve: u.permissions.includes('review.approve'),
    can_submit: u.permissions.includes('assets.submit'),
    can_deliver: u.permissions.includes('delivery.record'),
    project_access: u.project_access,
  })));
});

// ---------- task serialisation ----------
// Loads everything a set of task summaries needs in a few queries (no per-task round trips,
// which matters when the database is remote).
async function context(taskIds) {
  const users = await userMap();
  const projects = new Map((await all('SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id')).map((p) => [p.id, p]));
  const filter = taskIds ? `WHERE task_id IN (${taskIds.map(Number).join(',') || 'NULL'})` : '';
  const steps = new Map();
  for (const s of await all(`SELECT * FROM approval_steps ${filter} ORDER BY task_id, position`)) {
    if (!steps.has(s.task_id)) steps.set(s.task_id, []);
    steps.get(s.task_id).push(s);
  }
  const subs = new Map(); // latest non-superseded submission per task
  for (const s of await all(`SELECT * FROM submissions ${filter ? `${filter} AND` : 'WHERE'} status != 'superseded' ORDER BY id`)) subs.set(s.task_id, s);
  const lastReview = new Map();
  for (const r of await all(`SELECT r.submission_id, MAX(r.created_at) AS at FROM reviews r JOIN submissions s ON s.id = r.submission_id
    ${filter ? filter.replace('task_id', 's.task_id') : ''} GROUP BY r.submission_id`)) lastReview.set(r.submission_id, r.at);
  return { users, projects, steps, subs, lastReview };
}
function stepStates(steps, sub, task) {
  return steps.map((s, i) => {
    let state = 'pending';
    if (sub && sub.status === 'approved') state = 'approved';
    else if (sub && sub.status === 'in_review') state = i < sub.current_step ? 'approved' : i === sub.current_step ? 'current' : 'pending';
    if (task.stage === 'delivered' && sub?.status === 'approved') state = 'approved';
    return { id: s.id, position: s.position, label: s.label, approver_id: s.approver_id, state };
  });
}
function summarize(task, ctx, view) {
  const steps = ctx.steps.get(task.id) || [];
  const sub = ctx.subs.get(task.id) || null;
  const u = (id) => userRef(ctx.users.get(id));
  const p = ctx.projects.get(task.project_id);
  const na = nextAction(task, steps, sub);
  let waitingSince = task.updated_at;
  if (task.stage === 'in_review' && sub) waitingSince = ctx.lastReview.get(sub.id) || sub.submitted_at;
  const base = {
    id: task.id, title: task.title, stage: task.stage, priority: task.priority, due_date: task.due_date,
    project: { id: p.id, name: p.name }, client: { id: p.client_id, name: p.client_name },
    creator: u(task.creator_id), assignee: u(task.assignee_id), delivery_owner: u(task.delivery_owner_id), recipient: u(task.recipient_id),
    is_demo: !!task.is_demo, view, updated_at: task.updated_at, created_at: task.created_at, sort_order: task.sort_order,
  };
  if (view === 'deliverable') return { ...base, next_action: { kind: 'done', user: null } };
  return {
    ...base,
    blocked: task.blocked ? { reason: task.blocked_reason, resolver: u(task.blocked_resolver_id), by: u(task.blocked_by_id), at: task.blocked_at } : null,
    next_action: { ...na, user: u(na.user_id) },
    steps: stepStates(steps, sub, task).map((s) => ({ ...s, approver: u(s.approver_id) })),
    current_submission: sub ? {
      id: sub.id, version: sub.version, status: sub.status, access_issue: !!sub.access_issue, submitted_at: sub.submitted_at, review_deadline: sub.review_deadline, submitted_by: u(sub.submitted_by),
      thumbnail_url: sub.link_kind !== 'folder' && sub.drive_id && !sub.drive_id.startsWith('DEMO-') ? `https://drive.google.com/thumbnail?id=${sub.drive_id}&sz=w400` : null,
    } : null,
    waiting_since: waitingSince,
  };
}
async function visibleTasks(user) {
  const tasks = await all('SELECT * FROM tasks ORDER BY sort_order, id');
  const ctx = await context();
  const out = [];
  for (const t of tasks) {
    const view = viewLevel(user, t, ctx.steps.get(t.id) || []);
    if (view) out.push(summarize(t, ctx, view));
  }
  return out;
}
function allowedActions(user, task, steps, sub) {
  const inv = involvement(user, task, steps);
  const oversee = can(user, 'work.oversee');
  const isCurrentApprover = sub && sub.status === 'in_review' && steps[sub.current_step]?.approver_id === user.id;
  const moveTargets = [];
  for (const s of STAGES.map((x) => x.key)) {
    try { checkManualMove(user, task, steps, s); if (s !== task.stage) moveTargets.push(s); } catch { /* not allowed */ }
  }
  return {
    edit: can(user, 'tasks.edit') && task.stage !== 'delivered',
    assign: can(user, 'tasks.create') && task.stage !== 'delivered',
    edit_steps: can(user, 'tasks.create') && !['in_review', 'delivered'].includes(task.stage),
    move_to: moveTargets,
    submit: can(user, 'assets.submit') && (inv.has('assignee') || oversee) && task.stage !== 'delivered' && steps.length > 0,
    review: !!isCurrentApprover && !sub.access_issue && can(user, 'review.approve'),
    fix_access: !!(sub && sub.status === 'in_review' && sub.access_issue && (sub.submitted_by === user.id || inv.has('assignee'))),
    deliver: task.stage === 'ready_to_deliver' && task.delivery_owner_id === user.id && can(user, 'delivery.record'),
    comment: can(user, 'comments.write') && task.stage !== 'delivered',
    block: !task.blocked && ACTIVE_STAGES.includes(task.stage) && (can(user, 'comments.write') || can(user, 'workflow.move')),
    unblock: !!task.blocked && (task.blocked_resolver_id === user.id || task.blocked_by_id === user.id || oversee),
  };
}
async function taskDetail(user, taskId) {
  const { task, steps, view } = await requireView(user, taskId, 'any');
  const ctx = await context([task.id]);
  const sub = ctx.subs.get(task.id) || null;
  const summary = summarize(task, ctx, view);
  const u = (id) => userRef(ctx.users.get(id));
  const allSubs = await all('SELECT * FROM submissions WHERE task_id = ? ORDER BY id DESC', task.id);
  const subById = new Map(allSubs.map((s) => [s.id, s]));
  const deliveries = (await all('SELECT * FROM deliveries WHERE task_id = ? ORDER BY id', task.id)).map((d) => {
    const s = subById.get(d.submission_id);
    return { ...d, verified: !!d.verified, recipient: u(d.recipient_id), sender: u(d.sender_id), version: s.version, link: s.link, preview_url: previewUrl(s) };
  });
  if (view === 'deliverable') return { ...summary, deliveries };
  const reviews = await all('SELECT r.* FROM reviews r JOIN submissions s ON s.id = r.submission_id WHERE s.task_id = ? ORDER BY r.id', task.id);
  const submissions = allSubs.map((s) => ({
    ...s, access_issue: !!s.access_issue, submitted_by: u(s.submitted_by), preview_url: previewUrl(s),
    reviews: reviews.filter((r) => r.submission_id === s.id).map((r) => ({ ...r, reviewer: u(r.reviewer_id) })),
  }));
  return {
    ...summary,
    brief: task.brief,
    submissions,
    deliveries,
    comments: (await all('SELECT * FROM comments WHERE task_id = ? ORDER BY id', task.id)).map((c) => ({ ...c, author: u(c.author_id) })),
    activity: (await all('SELECT * FROM activity WHERE task_id = ? ORDER BY id DESC', task.id)).map((a) => ({ ...a, actor: u(a.actor_id) })),
    allowed: allowedActions(user, task, steps, sub),
  };
}

// Validates that a named person can play a role on a task in this project.
async function checkPerson(id, projectId, roleLabel, perm) {
  if (id === null) return null;
  const p = await getUser(id);
  if (!p || p.status === 'deactivated' || (p.is_demo && !DEMO_MODE)) bad(`${roleLabel}: choose an existing, active person.`);
  if (!hasProjectAccess(p, projectId)) bad(`${p.name} does not have access to this project. An administrator can grant it in Team settings.`);
  if (perm && !p.permissions.includes(perm)) {
    const label = PERMISSIONS.find((x) => x.key === perm).label;
    bad(`${p.name} cannot be the ${roleLabel.toLowerCase()} because they do not have the "${label}" permission.`);
  }
  return p;
}
async function checkSteps(rawSteps, projectId) {
  if (!Array.isArray(rawSteps)) return [];
  if (rawSteps.length > 6) bad('Use at most six approval steps.');
  const out = [];
  for (const [i, s] of rawSteps.entries()) {
    const approverId = optId(s.approver_id);
    if (!approverId) bad(`Approval step ${i + 1} needs an approver.`);
    const p = await checkPerson(approverId, projectId, 'Approver', 'review.approve');
    out.push({ label: str(s.label, 60) || `Approval ${i + 1}`, approver_id: approverId, name: p.name });
  }
  return out;
}
async function writeSteps(taskId, steps) {
  await run('DELETE FROM approval_steps WHERE task_id = ?', taskId);
  for (const [i, s] of steps.entries()) await run('INSERT INTO approval_steps (task_id, position, label, approver_id) VALUES (?,?,?,?)', taskId, i, s.label, s.approver_id);
}
const describeSteps = (steps) => steps.map((s) => `${s.label} (${s.name})`).join(' → ');

// ---------- tasks ----------
app.get('/api/tasks', auth, async (req, res) => res.json(await visibleTasks(req.user)));
app.get('/api/tasks/:id', auth, async (req, res) => res.json(await taskDetail(req.user, req.params.id)));

app.post('/api/tasks', auth, need('tasks.create'), async (req, res) => {
  const b = req.body;
  const title = str(b.title, 200);
  if (!title) bad('Give the task a title.');
  const projectId = Number(b.project_id);
  if (!(await one('SELECT id FROM projects WHERE id = ?', projectId))) bad('Choose a project.');
  if (!hasProjectAccess(req.user, projectId)) forbid('You do not have access to that project.');
  const assignee = await checkPerson(optId(b.assignee_id), projectId, 'Assignee', 'assets.submit');
  const delivery = await checkPerson(optId(b.delivery_owner_id) ?? req.user.id, projectId, 'Delivery owner', 'delivery.record');
  const recipient = await checkPerson(optId(b.recipient_id), projectId, 'Recipient');
  const steps = await checkSteps(b.steps || [], projectId);
  const priority = ['urgent', 'high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium';
  const stage = ['backlog', 'planned', 'in_progress'].includes(b.stage) ? b.stage : (assignee ? 'planned' : 'backlog');
  const id = await tx(async () => {
    const t = now();
    const r = await run(`INSERT INTO tasks (title, project_id, brief, priority, stage, creator_id, assignee_id, delivery_owner_id, recipient_id, due_date, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, title, projectId, str(b.brief, 20000), priority, stage, req.user.id, assignee?.id ?? null,
      delivery?.id ?? null, recipient?.id ?? null, isDate(b.due_date) ? b.due_date : null, Date.now(), t, t);
    const taskId = Number(r.lastInsertRowid);
    await writeSteps(taskId, steps);
    await logActivity(taskId, req.user.id, 'created', `Created the task${assignee ? ` and assigned ${assignee.name}` : ''}`);
    if (steps.length) await logActivity(taskId, req.user.id, 'steps', `Set approval steps: ${describeSteps(steps)}`);
    if (assignee) await notify(assignee.id, taskId, `${req.user.name} assigned you "${title}"`, req.user.id);
    return taskId;
  });
  flush();
  res.status(201).json(await taskDetail(req.user, id));
});

app.patch('/api/tasks/:id', auth, async (req, res) => {
  const { task } = await requireView(req.user, req.params.id);
  if (task.stage === 'delivered') bad('Delivered tasks are closed.');
  const b = req.body;
  const changes = [];
  const sets = {};
  const editFields = ['title', 'brief', 'priority', 'due_date'];
  const assignFields = ['assignee_id', 'delivery_owner_id', 'recipient_id', 'project_id'];
  if (editFields.some((f) => f in b) && !can(req.user, 'tasks.edit')) forbid('You need the "Edit briefs and deadlines" permission.');
  if (assignFields.some((f) => f in b) && !can(req.user, 'tasks.create')) forbid('You need the "Create and assign tasks" permission to change who is responsible.');
  if ('title' in b) { const v = str(b.title, 200); if (!v) bad('Title cannot be empty.'); sets.title = v; changes.push('title'); }
  if ('brief' in b) { sets.brief = str(b.brief, 20000); changes.push('brief'); }
  if ('priority' in b) { if (!['urgent', 'high', 'medium', 'low'].includes(b.priority)) bad('Unknown priority.'); sets.priority = b.priority; changes.push(`priority to ${b.priority}`); }
  if ('due_date' in b) { sets.due_date = isDate(b.due_date) ? b.due_date : null; changes.push(`deadline to ${sets.due_date || 'none'}`); }
  const projectId = 'project_id' in b ? Number(b.project_id) : task.project_id;
  if ('project_id' in b) {
    if (!(await one('SELECT id FROM projects WHERE id = ?', projectId)) || !hasProjectAccess(req.user, projectId)) bad('Choose a project you can access.');
    sets.project_id = projectId; changes.push('project');
  }
  let newAssignee = null;
  if ('assignee_id' in b) { const p = await checkPerson(optId(b.assignee_id), projectId, 'Assignee', 'assets.submit'); sets.assignee_id = p?.id ?? null; changes.push(`assignee to ${p?.name || 'nobody'}`); newAssignee = p; }
  if ('delivery_owner_id' in b) { const p = await checkPerson(optId(b.delivery_owner_id), projectId, 'Delivery owner', 'delivery.record'); sets.delivery_owner_id = p?.id ?? null; changes.push(`delivery owner to ${p?.name || 'nobody'}`); }
  if ('recipient_id' in b) { const p = await checkPerson(optId(b.recipient_id), projectId, 'Recipient'); sets.recipient_id = p?.id ?? null; changes.push(`final recipient to ${p?.name || 'nobody'}`); }
  // creator_id is never writable.
  const keys = Object.keys(sets);
  if (!keys.length) bad('Nothing to update.');
  await tx(async () => {
    await run(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => sets[k]), now(), task.id);
    await logActivity(task.id, req.user.id, 'edited', `Changed ${changes.join(', ')}`);
    if (newAssignee) await notify(newAssignee.id, task.id, `${req.user.name} assigned you "${task.title}"`, req.user.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

app.put('/api/tasks/:id/steps', auth, need('tasks.create'), async (req, res) => {
  const { task } = await requireView(req.user, req.params.id);
  if (task.stage === 'in_review') bad('Approval steps are locked while a version is in review.');
  if (task.stage === 'delivered') bad('Delivered tasks are closed.');
  const steps = await checkSteps(req.body.steps, task.project_id);
  await tx(async () => {
    await writeSteps(task.id, steps);
    await logActivity(task.id, req.user.id, 'steps', steps.length ? `Set approval steps: ${describeSteps(steps)}` : 'Removed all approval steps');
    await touch(task.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

app.post('/api/tasks/:id/move', auth, async (req, res) => {
  const { task, steps } = await requireView(req.user, req.params.id);
  const to = String(req.body.stage || '');
  checkManualMove(req.user, task, steps, to);
  if (to !== task.stage) {
    await tx(async () => {
      await run('UPDATE tasks SET stage = ?, sort_order = ?, updated_at = ? WHERE id = ?', to, Date.now(), now(), task.id);
      if (!ACTIVE_STAGES.includes(to) && task.blocked) await run('UPDATE tasks SET blocked = 0 WHERE id = ?', task.id);
      const reopened = task.stage === 'ready_to_deliver' ? ' (reopened: a new version will need fresh approval)' : '';
      await logActivity(task.id, req.user.id, 'moved', `Moved from ${stageLabel(task.stage)} to ${stageLabel(to)}${reopened}`);
    });
    flush();
  }
  res.json(await taskDetail(req.user, task.id));
});

app.post('/api/tasks/:id/block', auth, async (req, res) => {
  const { task, steps } = await requireView(req.user, req.params.id);
  const a = allowedActions(req.user, task, steps, await currentSubmission(task.id));
  if (!a.block) forbid(task.blocked ? 'This task is already blocked.' : !ACTIVE_STAGES.includes(task.stage) ? 'Only active tasks can be blocked.' : 'You cannot block this task.');
  const reason = str(req.body.reason, 1000);
  if (!reason) bad('Say why the task is blocked.');
  const resolver = await checkPerson(optId(req.body.resolver_id), task.project_id, 'Person needed to unblock');
  if (!resolver) bad('Choose the person needed to resolve the block.');
  await tx(async () => {
    await run('UPDATE tasks SET blocked = 1, blocked_reason = ?, blocked_resolver_id = ?, blocked_by_id = ?, blocked_at = ?, updated_at = ? WHERE id = ?', reason, resolver.id, req.user.id, now(), now(), task.id);
    await logActivity(task.id, req.user.id, 'blocked', `Flagged as blocked, needs ${resolver.name}: ${reason}`);
    await notify(resolver.id, task.id, `${req.user.name} needs you to unblock "${task.title}": ${reason}`, req.user.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});
app.post('/api/tasks/:id/unblock', auth, async (req, res) => {
  const { task, steps } = await requireView(req.user, req.params.id);
  if (!allowedActions(req.user, task, steps, await currentSubmission(task.id)).unblock) forbid('Only the person needed, the person who raised the block, or someone overseeing the team can clear it.');
  const note = str(req.body.note, 1000);
  await tx(async () => {
    await run('UPDATE tasks SET blocked = 0, updated_at = ? WHERE id = ?', now(), task.id);
    await logActivity(task.id, req.user.id, 'unblocked', `Cleared the block${note ? `: ${note}` : ''}`);
    if (task.blocked_by_id) await notify(task.blocked_by_id, task.id, `${req.user.name} cleared the block on "${task.title}"`, req.user.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

// ---------- submissions & reviews ----------
app.post('/api/tasks/:id/submissions', auth, async (req, res) => {
  const { task, steps } = await requireView(req.user, req.params.id);
  if (!can(req.user, 'assets.submit')) forbid('You need the "Add Drive links and submit versions" permission.');
  const inv = involvement(req.user, task, steps);
  if (!inv.has('assignee') && !can(req.user, 'work.oversee')) forbid('Only the assignee can submit versions for this task.');
  if (task.stage === 'delivered') bad('This task has been delivered. Create a follow-up task for new work.');
  if (!steps.length) bad('Add at least one approval step before submitting for review.');
  const drive = parseDriveLink(req.body.link);
  if (!drive) bad('Paste a Google Drive file, folder, Docs, Sheets or Slides link (https://drive.google.com/... or https://docs.google.com/...).');
  const version = str(req.body.version, 40);
  if (!version) bad('Add a version label, for example v2.');
  const deadline = isDate(req.body.review_deadline) ? req.body.review_deadline : null;
  const t = now();
  const subId = await tx(async () => {
    const previous = (await all('SELECT version FROM submissions WHERE task_id = ?', task.id)).map((s) => s.version.toLowerCase());
    if (previous.includes(version.toLowerCase())) bad(`Version "${version}" was already submitted. Use a new label so every decision stays tied to the exact version reviewed.`);
    // A new version supersedes any version still open, so it needs fresh approval.
    const hadApproved = !!(await one("SELECT 1 AS x FROM submissions WHERE task_id = ? AND status = 'approved'", task.id));
    await run("UPDATE submissions SET status = 'superseded' WHERE task_id = ? AND status = 'in_review'", task.id);
    const r = await run(`INSERT INTO submissions (task_id, version, link, link_kind, drive_id, note, submitted_by, submitted_at, review_deadline, status, current_step)
      VALUES (?,?,?,?,?,?,?,?,?,'in_review',0)`, task.id, version, drive.link, drive.kind, drive.driveId, str(req.body.note, 4000), req.user.id, t, deadline);
    await run("UPDATE tasks SET stage = 'in_review', blocked = 0, updated_at = ?, sort_order = ? WHERE id = ?", t, Date.now(), task.id);
    const first = steps[0];
    const approver = await getUser(first.approver_id);
    await logActivity(task.id, req.user.id, 'submitted', `Submitted ${version} for review. Waiting for ${approver.name} (${first.label})`);
    if (hadApproved) await logActivity(task.id, req.user.id, 'submitted', `${version} replaces an approved version and needs fresh approval`);
    await notify(approver.id, task.id, `${req.user.name} submitted ${version} of "${task.title}" for your approval`, req.user.id);
    return Number(r.lastInsertRowid);
  });
  flush();
  res.status(201).json(await taskDetail(req.user, task.id));
  // Optional Drive check runs afterwards and never changes sharing.
  if (driveIntegration()) {
    const result = await checkLinkSharing(drive.driveId);
    await run('UPDATE submissions SET access_check = ?, access_check_detail = ? WHERE id = ?', result.status, result.detail, subId);
    flush();
  }
});

app.post('/api/submissions/:id/review', auth, async (req, res) => {
  const found = await one('SELECT task_id FROM submissions WHERE id = ?', Number(req.params.id));
  if (!found) throw new HttpError(404, 'Submission not found.');
  const { task, steps } = await requireView(req.user, found.task_id);
  const decision = String(req.body.decision || '');
  const feedback = str(req.body.feedback, 4000);
  await tx(async () => {
    // Re-read inside the transaction so two reviewers cannot act on the same step at once.
    const sub = await one('SELECT * FROM submissions WHERE id = ?', Number(req.params.id));
    const current = await currentSubmission(task.id);
    if (!current || current.id !== sub.id || sub.status !== 'in_review') bad('This version is no longer awaiting review. Decisions apply only to the current version.');
    const step = steps[sub.current_step];
    if (!step || step.approver_id !== req.user.id) forbid(`Only ${step ? (await getUser(step.approver_id)).name : 'the assigned approver'} can review this step.`);
    if (!can(req.user, 'review.approve')) forbid('You need the "Approve a review stage" permission.');
    if (sub.access_issue) bad('You reported you cannot open this file. Wait for the submitter to fix sharing first.');
    if (!['approved', 'changes_requested', 'cannot_access'].includes(decision)) bad('Choose Approve, Request changes or Cannot access file.');
    if (decision !== 'approved' && !feedback) bad(decision === 'cannot_access' ? 'Describe the access problem, for example the error Drive shows.' : 'Add feedback so the team knows what to change.');
    const t = now();
    await run('INSERT INTO reviews (submission_id, step_position, step_label, reviewer_id, decision, feedback, created_at) VALUES (?,?,?,?,?,?,?)', sub.id, step.position, step.label, req.user.id, decision, feedback, t);
    const submitter = await getUser(sub.submitted_by);
    if (decision === 'approved') {
      const next = steps[sub.current_step + 1];
      if (next) {
        await run('UPDATE submissions SET current_step = ? WHERE id = ?', sub.current_step + 1, sub.id);
        await touch(task.id);
        const na = await getUser(next.approver_id);
        await logActivity(task.id, req.user.id, 'approved', `Approved ${sub.version} (${step.label}). Waiting for ${na.name} (${next.label})`);
        await notify(na.id, task.id, `"${task.title}" ${sub.version} is waiting for your approval (${next.label})`, req.user.id);
        await notify(submitter.id, task.id, `${req.user.name} approved ${sub.version} of "${task.title}". Now with ${na.name}`, req.user.id);
      } else {
        await run("UPDATE submissions SET status = 'approved' WHERE id = ?", sub.id);
        await run("UPDATE tasks SET stage = 'ready_to_deliver', sort_order = ?, updated_at = ? WHERE id = ?", Date.now(), t, task.id);
        const owner = await getUser(task.delivery_owner_id);
        await logActivity(task.id, req.user.id, 'approved', `Approved ${sub.version} (${step.label}). All approvals complete; ready to deliver${owner ? `, handoff by ${owner.name}` : ''}`);
        if (owner) await notify(owner.id, task.id, `"${task.title}" ${sub.version} is approved and ready for you to deliver`, req.user.id);
        await notify(submitter.id, task.id, `${req.user.name} approved ${sub.version} of "${task.title}"`, req.user.id);
      }
    } else if (decision === 'changes_requested') {
      await run("UPDATE submissions SET status = 'changes_requested' WHERE id = ?", sub.id);
      await run("UPDATE tasks SET stage = 'changes_requested', sort_order = ?, updated_at = ? WHERE id = ?", Date.now(), t, task.id);
      await logActivity(task.id, req.user.id, 'changes', `Requested changes on ${sub.version} (${step.label}): ${feedback}`);
      await notify(task.assignee_id || submitter.id, task.id, `${req.user.name} requested changes on ${sub.version} of "${task.title}"`, req.user.id);
    } else {
      await run('UPDATE submissions SET access_issue = 1 WHERE id = ?', sub.id);
      await touch(task.id);
      await logActivity(task.id, req.user.id, 'access', `Cannot open ${sub.version} in Google Drive: ${feedback}`);
      await notify(submitter.id, task.id, `${req.user.name} cannot open ${sub.version} of "${task.title}" in Google Drive. Check the file's sharing.`, req.user.id);
    }
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

app.post('/api/submissions/:id/access-restored', auth, async (req, res) => {
  const sub = await one('SELECT * FROM submissions WHERE id = ?', Number(req.params.id));
  if (!sub) throw new HttpError(404, 'Submission not found.');
  const { task, steps } = await requireView(req.user, sub.task_id);
  const current = await currentSubmission(task.id);
  if (!allowedActions(req.user, task, steps, current).fix_access || current.id !== sub.id) forbid('Only the submitter can confirm sharing was fixed.');
  const note = str(req.body.note, 1000);
  const step = steps[sub.current_step];
  const approver = await getUser(step.approver_id);
  await tx(async () => {
    await run('UPDATE submissions SET access_issue = 0 WHERE id = ?', sub.id);
    await run('INSERT INTO reviews (submission_id, step_position, step_label, reviewer_id, decision, feedback, created_at) VALUES (?,?,?,?,?,?,?)', sub.id, step.position, step.label, req.user.id, 'access_restored', note, now());
    await logActivity(task.id, req.user.id, 'access', `Updated Drive sharing for ${sub.version}${note ? `: ${note}` : ''}. Back with ${approver.name}`);
    await notify(step.approver_id, task.id, `${req.user.name} updated sharing on ${sub.version} of "${task.title}". Please try again.`, req.user.id);
    await touch(task.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

// ---------- comments ----------
app.post('/api/tasks/:id/comments', auth, need('comments.write'), async (req, res) => {
  const { task, steps } = await requireView(req.user, req.params.id);
  const body = str(req.body.body, 4000);
  if (!body) bad('Write a comment first.');
  const na = nextAction(task, steps, await currentSubmission(task.id)).user_id;
  await tx(async () => {
    await run('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)', task.id, req.user.id, body, now());
    for (const id of new Set([task.creator_id, task.assignee_id, na].filter(Boolean))) await notify(id, task.id, `${req.user.name} commented on "${task.title}"`, req.user.id);
    await touch(task.id);
  });
  flush();
  res.status(201).json(await taskDetail(req.user, task.id));
});

// ---------- delivery ----------
const DELIVERY_METHODS = ['Google Drive share', 'Email', 'WeTransfer', 'Client portal', 'Other'];
app.post('/api/tasks/:id/deliver', auth, async (req, res) => {
  const { task } = await requireView(req.user, req.params.id);
  if (task.stage !== 'ready_to_deliver') bad('Only approved tasks that are Ready to Deliver can be delivered.');
  if (task.delivery_owner_id !== req.user.id) forbid('Only the delivery owner can record delivery.');
  if (!can(req.user, 'delivery.record')) forbid('You need the "Record final delivery" permission.');
  if (!task.recipient_id) bad('Set the final recipient before recording delivery.');
  const sub = await currentSubmission(task.id);
  if (!sub || sub.status !== 'approved') bad('There is no fully approved version to deliver.');
  const method = DELIVERY_METHODS.includes(req.body.method) ? req.body.method : null;
  if (!method) bad('Choose how it was delivered.');
  const t = now();
  const rcpt = await getUser(task.recipient_id);
  await tx(async () => {
    const fresh = await one('SELECT stage FROM tasks WHERE id = ?', task.id);
    if (fresh.stage !== 'ready_to_deliver') bad('This task is no longer Ready to Deliver.');
    // verified = 0: this is a manual record. Only an automated send confirmed by an integration may set it.
    await run('INSERT INTO deliveries (task_id, submission_id, recipient_id, sender_id, method, note, verified, delivered_at) VALUES (?,?,?,?,?,?,0,?)',
      task.id, sub.id, task.recipient_id, req.user.id, method, str(req.body.note, 2000), t);
    await run("UPDATE tasks SET stage = 'delivered', blocked = 0, sort_order = ?, updated_at = ? WHERE id = ?", Date.now(), t, task.id);
    await logActivity(task.id, req.user.id, 'delivered', `Recorded manual delivery of ${sub.version} to ${rcpt.name} via ${method}`);
    await notify(rcpt.id, task.id, `${req.user.name} delivered "${task.title}" (${sub.version}) to you`, req.user.id);
    await notify(task.creator_id, task.id, `"${task.title}" was delivered to ${rcpt.name}`, req.user.id);
  });
  flush();
  res.json(await taskDetail(req.user, task.id));
});

// ---------- notifications ----------
app.get('/api/notifications', auth, async (req, res) => {
  res.json(await all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', req.user.id));
});
app.post('/api/notifications/read', auth, async (req, res) => {
  if (req.body.all) await run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  else if (Number(req.body.id)) await run('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?', req.user.id, Number(req.body.id));
  res.json({ ok: true });
});

// ---------- administration ----------
const COLORS = ['#7c5cff', '#e5484d', '#12a594', '#f76b15', '#3e63dd', '#d6409f', '#8e4ec6', '#0d74ce', '#ad7f58', '#46a758'];
async function sanitizeAccess(v) {
  if (v === 'all') return 'all';
  if (!Array.isArray(v)) bad('Choose the projects this person can access.');
  const ids = (await all('SELECT id FROM projects')).map((p) => p.id);
  return [...new Set(v.map(Number))].filter((id) => ids.includes(id));
}
function sanitizePerms(v) {
  if (!Array.isArray(v)) bad('Permissions must be a list.');
  return [...new Set(v.filter((k) => PERMISSION_KEYS.includes(k)))];
}
function adminView(r) {
  const u = rowToUser(r);
  return { ...u, invite_url: r.status === 'invited' && r.invite_token ? `${PUBLIC_URL}/#/invite/${r.invite_token}` : null };
}
async function assertAdminRemains(excludingId, nextUser) {
  const admins = (await all("SELECT * FROM users WHERE status = 'active'")).map(rowToUser)
    .map((u) => (u.id === excludingId ? nextUser : u))
    .filter((u) => u && u.status === 'active' && u.permissions.includes('users.manage') && (DEMO_MODE || !u.is_demo));
  if (!admins.length) bad('At least one active person must keep the "Manage users and permissions" permission.');
}
app.get('/api/admin/users', auth, need('users.manage'), async (req, res) => {
  res.json((await all('SELECT * FROM users ORDER BY is_demo, name')).map(adminView));
});
app.post('/api/admin/users', auth, need('users.manage'), async (req, res) => {
  const name = str(req.body.name, 120);
  const email = str(req.body.email, 200).toLowerCase();
  if (!name) bad('Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Enter a valid email address.');
  if (await one('SELECT id FROM users WHERE email = ?', email)) bad('Someone with that email already exists.');
  const role = ROLE_KEYS.includes(req.body.role) ? req.body.role : 'producer';
  const perms = req.body.permissions ? sanitizePerms(req.body.permissions) : roleDefaults(role);
  const access = req.body.project_access === undefined ? 'all' : await sanitizeAccess(req.body.project_access);
  const token = crypto.randomBytes(24).toString('base64url');
  const color = COLORS[(await one('SELECT COUNT(*) AS n FROM users')).n % COLORS.length];
  const r = await run(`INSERT INTO users (name, email, title, role, permissions, project_access, status, invite_token, invited_by, color, created_at)
    VALUES (?,?,?,?,?,?,'invited',?,?,?,?)`, name, email, str(req.body.title, 80), role, JSON.stringify(perms), JSON.stringify(access), token, req.user.id, color, now());
  flush();
  res.status(201).json(adminView(await one('SELECT * FROM users WHERE id = ?', Number(r.lastInsertRowid))));
});
app.patch('/api/admin/users/:id', auth, need('users.manage'), async (req, res) => {
  const row = await one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!row) throw new HttpError(404, 'Person not found.');
  const cur = rowToUser(row);
  const b = req.body;
  const next = { ...cur };
  if ('name' in b) { next.name = str(b.name, 120); if (!next.name) bad('Name cannot be empty.'); }
  if ('email' in b) {
    next.email = str(b.email, 200).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) bad('Enter a valid email address.');
    if (await one('SELECT id FROM users WHERE email = ? AND id != ?', next.email, cur.id)) bad('Someone else already uses that email.');
  }
  if ('title' in b) next.title = str(b.title, 80);
  if ('role' in b) { if (!ROLE_KEYS.includes(b.role)) bad('Unknown role.'); next.role = b.role; }
  if ('permissions' in b) next.permissions = sanitizePerms(b.permissions);
  if ('project_access' in b) next.project_access = await sanitizeAccess(b.project_access);
  if ('status' in b) {
    if (!['active', 'deactivated'].includes(b.status)) bad('Unknown status.');
    if (b.status === 'active' && cur.status === 'deactivated') next.status = row.password_hash ? 'active' : 'invited';
    if (b.status === 'deactivated') next.status = 'deactivated';
  }
  await assertAdminRemains(cur.id, next);
  await tx(async () => {
    await run('UPDATE users SET name = ?, email = ?, title = ?, role = ?, permissions = ?, project_access = ?, status = ? WHERE id = ?',
      next.name, next.email, next.title, next.role, JSON.stringify(next.permissions), JSON.stringify(next.project_access), next.status, cur.id);
    if (next.status === 'deactivated') await run('DELETE FROM sessions WHERE user_id = ?', cur.id);
  });
  flush();
  res.json(adminView(await one('SELECT * FROM users WHERE id = ?', cur.id)));
});
app.post('/api/admin/users/:id/reinvite', auth, need('users.manage'), async (req, res) => {
  const row = await one('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!row || row.status !== 'invited') bad('Only pending invitations can be re-sent.');
  await run('UPDATE users SET invite_token = ? WHERE id = ?', crypto.randomBytes(24).toString('base64url'), row.id);
  res.json(adminView(await one('SELECT * FROM users WHERE id = ?', row.id)));
});
app.get('/api/admin/projects', auth, need('users.manage'), async (req, res) => {
  res.json({
    clients: await all('SELECT * FROM clients ORDER BY name'),
    projects: await all('SELECT p.*, c.name AS client_name, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name'),
  });
});
app.post('/api/admin/projects', auth, need('users.manage'), async (req, res) => {
  const name = str(req.body.name, 120);
  const clientName = str(req.body.client_name, 120);
  if (!name || !clientName) bad('Enter a client and a project name.');
  const id = await tx(async () => {
    const c = (await one('SELECT id FROM clients WHERE name = ? COLLATE NOCASE', clientName))
      || { id: Number((await run('INSERT INTO clients (name) VALUES (?)', clientName)).lastInsertRowid) };
    return Number((await run('INSERT INTO projects (name, client_id) VALUES (?,?)', name, c.id)).lastInsertRowid);
  });
  flush();
  res.status(201).json({ id });
});
// Removes the fictional demo people and sample work, leaving real accounts alone.
app.post('/api/admin/demo/remove', auth, need('users.manage'), async (req, res) => {
  if (req.user.is_demo) bad('Sign in with a real administrator account to remove demo data. Demo accounts cannot remove themselves.');
  await tx(async () => {
    // Child rows are deleted explicitly: hosted databases may not enforce ON DELETE CASCADE.
    const demoTasks = 'SELECT id FROM tasks WHERE is_demo = 1';
    await run(`DELETE FROM reviews WHERE submission_id IN (SELECT id FROM submissions WHERE task_id IN (${demoTasks}))`);
    for (const table of ['deliveries', 'submissions', 'approval_steps', 'comments', 'activity', 'notifications']) {
      await run(`DELETE FROM ${table} WHERE task_id IN (${demoTasks})`);
    }
    await run('DELETE FROM tasks WHERE is_demo = 1');
    for (const u of await all('SELECT id FROM users WHERE is_demo = 1')) {
      const used = await one(`SELECT 1 AS x FROM tasks WHERE creator_id = ?1 OR assignee_id = ?1 OR delivery_owner_id = ?1 OR recipient_id = ?1 OR blocked_resolver_id = ?1
        UNION SELECT 1 FROM approval_steps WHERE approver_id = ?1 UNION SELECT 1 FROM submissions WHERE submitted_by = ?1
        UNION SELECT 1 FROM comments WHERE author_id = ?1 UNION SELECT 1 FROM reviews WHERE reviewer_id = ?1 LIMIT 1`, u.id);
      if (used) await run("UPDATE users SET status = 'deactivated' WHERE id = ?", u.id);
      else {
        await run('DELETE FROM notifications WHERE user_id = ?', u.id);
        await run('DELETE FROM activity WHERE actor_id = ?', u.id);
        await run('DELETE FROM sessions WHERE user_id = ?', u.id);
        await run('DELETE FROM users WHERE id = ?', u.id);
      }
    }
    await run('DELETE FROM projects WHERE is_demo = 1 AND id NOT IN (SELECT project_id FROM tasks)');
    await run('DELETE FROM clients WHERE is_demo = 1 AND id NOT IN (SELECT client_id FROM projects)');
  });
  flush();
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- errors & static ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Design Dimensions studio on ${PUBLIC_URL} (database ${dbLocation}, demo mode ${DEMO_MODE ? 'on' : 'off'})`));
