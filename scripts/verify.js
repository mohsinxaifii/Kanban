// End-to-end verification against a real server process and a fresh database.
// Every actor signs in with their own account and cookie. Run: npm run verify
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dd-verify-')), 'verify.db');
const PW = process.env.DEMO_PASSWORD || 'demo-studio-2026';
const results = [];
let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
      env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, DEMO_MODE: 'true', PUBLIC_URL: BASE, GOOGLE_DRIVE_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => { if (String(d).includes('studio on')) resolve(); });
    server.stderr.on('data', (d) => process.stderr.write(d));
    server.on('exit', (c) => c && reject(new Error(`server exited ${c}`)));
  });
}
const stopServer = () => new Promise((r) => { server.once('exit', r); server.kill(); });

class Client {
  constructor(label) { this.label = label; this.cookie = ''; }
  async req(method, p, body, { header = true } = {}) {
    const res = await fetch(BASE + '/api' + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(header ? { 'X-Requested-With': 'dd-studio' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let data = null; try { data = await res.json(); } catch { /* none */ }
    return { status: res.status, data };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  put(p, b) { return this.req('PUT', p, b); }
  async login(email, password = PW) { const r = await this.post('/auth/login', { email, password }); return r; }
}
const demo = (n) => `${n}@demo.designdimensions.test`;

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`);
}
const section = (t) => { console.log(`\n${t}`); results.push({ section: t }); };
const expectStatus = (name, r, status) => check(name, r.status === status, `got ${r.status} ${JSON.stringify(r.data)}`);

async function main() {
  await startServer();
  const kabir = new Client('Kabir'); const rohan = new Client('Rohan'); const aanya = new Client('Aanya');
  const meera = new Client('Meera'); const nisha = new Client('Nisha'); const admin = new Client('Admin');
  for (const [c, n] of [[kabir, 'kabir'], [rohan, 'rohan'], [aanya, 'aanya'], [meera, 'meera'], [nisha, 'nisha'], [admin, 'studio']]) {
    const r = await c.login(demo(n));
    if (r.status !== 200) throw new Error(`login failed for ${n}: ${JSON.stringify(r.data)}`);
  }
  const people = (await kabir.get('/people')).data;
  const id = (first) => people.find((p) => p.name.startsWith(first)).id;
  const projects = (await kabir.get('/meta')).data.projects;
  const aurora = projects.find((p) => p.name === 'Aurora headphones launch').id;
  const trail = projects.find((p) => p.name === 'Trail Series').id;
  const link = (v) => `https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr${v}/view?usp=sharing`;

  // Live update stream for Aanya, to confirm collaborators see changes without refreshing.
  const events = [];
  const ac = new AbortController();
  fetch(`${BASE}/api/events`, { headers: { Cookie: aanya.cookie }, signal: ac.signal }).then(async (res) => {
    const reader = res.body.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; events.push(new TextDecoder().decode(value)); }
  }).catch(() => {});

  section('Example workflow, step 1: Kabir creates "Product launch reel"');
  expectStatus('Rohan (editor) cannot create tasks', await rohan.post('/tasks', { title: 'x', project_id: aurora }), 403);
  expectStatus('Meera cannot be named approver (no approval permission)', await kabir.post('/tasks', { title: 'x', project_id: aurora, steps: [{ label: 'CH', approver_id: id('Meera') }] }), 400);
  expectStatus('Nisha cannot be recipient on a project she has no access to', await kabir.post('/tasks', { title: 'x', project_id: trail, recipient_id: id('Nisha') }), 400);
  expectStatus('Unknown person id is rejected (typing a name never creates anyone)', await kabir.post('/tasks', { title: 'x', project_id: aurora, assignee_id: 99999 }), 400);
  let r = await kabir.post('/tasks', {
    title: 'Product launch reel', project_id: aurora, brief: '30s launch reel for Aurora.', priority: 'high', due_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
    assignee_id: id('Rohan'), delivery_owner_id: id('Kabir'), recipient_id: id('Nisha'), steps: [{ label: 'Creative Head', approver_id: id('Aanya') }],
  });
  expectStatus('Kabir creates the task', r, 201);
  const T = r.data.id;
  check('Creator is Kabir', r.data.creator.name === 'Kabir Sethi');
  check('Assigned to Rohan, approver Aanya, recipient Nisha, delivery owner Kabir',
    r.data.assignee.name === 'Rohan Mehta' && r.data.steps[0].approver.name === 'Aanya Shah' && r.data.recipient.name === 'Nisha Rao' && r.data.delivery_owner.name === 'Kabir Sethi');
  check('Next action: Rohan', r.data.next_action.user?.name === 'Rohan Mehta');
  expectStatus('Meera (not involved, no oversight) cannot open the task', await meera.get(`/tasks/${T}`), 404);
  check('Meera does not see the task on her board', !(await meera.get('/tasks')).data.some((t) => t.id === T));
  expectStatus('Nisha cannot see the task before delivery', await nisha.get(`/tasks/${T}`), 404);

  section('Step 2: Rohan submits v1 from Google Drive');
  expectStatus('Dragging to In Review without a submission is refused', await rohan.post(`/tasks/${T}/move`, { stage: 'in_review' }), 400);
  expectStatus('Dragging straight to Ready to Deliver is refused', await rohan.post(`/tasks/${T}/move`, { stage: 'ready_to_deliver' }), 400);
  expectStatus('Dragging straight to Delivered is refused', await kabir.post(`/tasks/${T}/move`, { stage: 'delivered' }), 400);
  expectStatus('Non-Drive link is rejected', await rohan.post(`/tasks/${T}/submissions`, { link: 'https://example.com/file', version: 'v1' }), 400);
  expectStatus('Meera cannot submit on a task not assigned to her', await meera.post(`/tasks/${T}/submissions`, { link: link('v1'), version: 'v1' }), 404);
  r = await rohan.post(`/tasks/${T}/submissions`, { link: link('v1'), version: 'v1', note: 'First cut', review_deadline: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) });
  expectStatus('Rohan submits v1', r, 201);
  const v1 = r.data.submissions[0];
  check('Submission records link, version, submitter, time and deadline', v1.link === link('v1') && v1.version === 'v1' && v1.submitted_by.name === 'Rohan Mehta' && v1.submitted_at && v1.review_deadline);
  check('Drive access is reported as not verified (no integration configured)', v1.access_check === 'not_checked');

  section('Step 3: waiting for Aanya; Rohan remains creator-side unchanged');
  check('Stage is In Review', r.data.stage === 'in_review');
  check('Status reads "Waiting for Aanya\'s approval"', r.data.next_action.kind === 'approve' && r.data.next_action.user.name === 'Aanya Shah');
  check('Creator is still Kabir (never replaced in review)', r.data.creator.name === 'Kabir Sethi');
  expectStatus('Rohan cannot approve his own submission', await rohan.post(`/submissions/${v1.id}/review`, { decision: 'approved' }), 403);
  expectStatus('Kabir (can approve, but not assigned on this task) cannot approve', await kabir.post(`/submissions/${v1.id}/review`, { decision: 'approved' }), 403);
  expectStatus('Meera cannot approve', await meera.post(`/submissions/${v1.id}/review`, { decision: 'approved' }), 404);
  expectStatus('Cards in review cannot be dragged out', await kabir.post(`/tasks/${T}/move`, { stage: 'in_progress' }), 400);
  expectStatus('Approval steps are locked during review', await kabir.put(`/tasks/${T}/steps`, { steps: [{ label: 'CH', approver_id: id('Kabir') }] }), 400);
  const aNotes = (await aanya.get('/notifications')).data;
  check('Aanya is notified in the app', aNotes.some((n) => n.task_id === T && n.message.includes('v1')));

  section('Step 4: Aanya requests changes; next action returns to Rohan');
  expectStatus('Request changes without feedback is refused', await aanya.post(`/submissions/${v1.id}/review`, { decision: 'changes_requested' }), 400);
  r = await aanya.post(`/submissions/${v1.id}/review`, { decision: 'changes_requested', feedback: 'Open on the product turn; tighten the last 5s.' });
  expectStatus('Aanya requests changes with feedback', r, 200);
  check('Stage is Changes Requested', r.data.stage === 'changes_requested');
  check('Next action: Rohan', r.data.next_action.user.name === 'Rohan Mehta');
  check('Creator is still Kabir', r.data.creator.name === 'Kabir Sethi');
  expectStatus('v1 can no longer be approved', await aanya.post(`/submissions/${v1.id}/review`, { decision: 'approved' }), 400);
  expectStatus('Dragging from Changes Requested to Ready to Deliver is refused', await rohan.post(`/tasks/${T}/move`, { stage: 'ready_to_deliver' }), 400);

  section('Step 5: Rohan submits v2; Aanya approves v2');
  expectStatus('Re-using the label v1 is refused', await rohan.post(`/tasks/${T}/submissions`, { link: link('v2'), version: 'v1' }), 400);
  r = await rohan.post(`/tasks/${T}/submissions`, { link: link('v2'), version: 'v2', note: 'Re-cut opening' });
  expectStatus('Rohan submits v2', r, 201);
  const v2 = r.data.submissions[0];
  r = await aanya.post(`/submissions/${v2.id}/review`, { decision: 'approved' });
  expectStatus('Aanya approves v2', r, 200);
  const subs = r.data.submissions;
  check('Approval is recorded against v2 specifically', subs.find((s) => s.version === 'v2').reviews.some((x) => x.decision === 'approved' && x.reviewer.name === 'Aanya Shah'));
  check('v1 and its change request are preserved', subs.find((s) => s.version === 'v1').reviews.some((x) => x.decision === 'changes_requested'));

  section('Step 6: Ready to Deliver, Kabir responsible for handoff');
  check('Stage is Ready to Deliver (not Delivered)', r.data.stage === 'ready_to_deliver');
  check('Next action: Kabir, deliver to Nisha', r.data.next_action.kind === 'deliver' && r.data.next_action.user.name === 'Kabir Sethi' && r.data.recipient.name === 'Nisha Rao');
  check('Kabir is notified in the app', (await kabir.get('/notifications')).data.some((n) => n.task_id === T && n.message.includes('ready for you to deliver')));
  expectStatus('Rohan cannot record delivery', await rohan.post(`/tasks/${T}/deliver`, { method: 'Email' }), 403);
  expectStatus('Aanya cannot record delivery', await aanya.post(`/tasks/${T}/deliver`, { method: 'Email' }), 403);

  section('Step 7: Kabir delivers v2 to Nisha and records it');
  r = await kabir.post(`/tasks/${T}/deliver`, { method: 'Google Drive share', note: 'Shared final folder with Nisha.' });
  expectStatus('Kabir records delivery', r, 200);
  const d = r.data.deliveries[0];
  check('Stage is Delivered', r.data.stage === 'delivered');
  check('Delivery records recipient, approved version, sender, time and method', d.recipient.name === 'Nisha Rao' && d.version === 'v2' && d.sender.name === 'Kabir Sethi' && d.delivered_at && d.method === 'Google Drive share');
  check('Delivery is labelled a manual record, not a verified automated send', d.verified === false);
  r = await nisha.get(`/tasks/${T}`);
  expectStatus('Nisha can now open the delivered task', r, 200);
  check('Nisha sees only the deliverable (no drafts, comments or reviews)', r.data.view === 'deliverable' && !r.data.submissions && !r.data.comments && r.data.deliveries[0].version === 'v2');
  expectStatus('Nisha cannot comment', await nisha.post(`/tasks/${T}/comments`, { body: 'hi' }), 403);
  expectStatus('Delivered tasks cannot be moved back', await kabir.post(`/tasks/${T}/move`, { stage: 'in_progress' }), 400);

  section('Configurable multi-step approval and fresh approval for new versions');
  r = await aanya.post('/tasks', { title: 'Verify: two-step film', project_id: trail, assignee_id: id('Rohan'), delivery_owner_id: id('Kabir'),
    steps: [{ label: 'Creative Head', approver_id: id('Aanya') }, { label: 'Account Manager', approver_id: id('Kabir') }] });
  const T2 = r.data.id;
  r = await rohan.post(`/tasks/${T2}/submissions`, { link: 'https://drive.google.com/drive/folders/1FolderIdAbCdEfGhIjK', version: 'v1' });
  check('Folder links are accepted', r.status === 201 && r.data.submissions[0].link_kind === 'folder');
  const t2v1 = r.data.submissions[0].id;
  expectStatus('Kabir cannot approve before his step', await kabir.post(`/submissions/${t2v1}/review`, { decision: 'approved' }), 403);
  r = await aanya.post(`/submissions/${t2v1}/review`, { decision: 'approved' });
  check('After step 1, waiting for Kabir (step 2)', r.data.stage === 'in_review' && r.data.next_action.user.name === 'Kabir Sethi' && r.data.next_action.step_position === 1);
  r = await rohan.post(`/tasks/${T2}/submissions`, { link: link('t2v2'), version: 'v2' });
  check('A revised version restarts approval at step 1 (fresh approval)', r.data.next_action.user.name === 'Aanya Shah' && r.data.submissions.find((s) => s.version === 'v1').status === 'superseded');
  const t2v2 = r.data.submissions[0].id;
  expectStatus('Approving the superseded v1 is refused', await kabir.post(`/submissions/${t2v1}/review`, { decision: 'approved' }), 400);
  await aanya.post(`/submissions/${t2v2}/review`, { decision: 'approved' });
  r = await kabir.post(`/submissions/${t2v2}/review`, { decision: 'approved' });
  check('Both steps approved v2: Ready to Deliver', r.data.stage === 'ready_to_deliver');
  r = await rohan.post(`/tasks/${T2}/submissions`, { link: link('t2v3'), version: 'v3' });
  check('Submitting v3 after approval sends it back to review (approval does not carry over)', r.data.stage === 'in_review' && r.data.next_action.user.name === 'Aanya Shah');
  expectStatus('Delivery is impossible while the new version is unapproved', await kabir.post(`/tasks/${T2}/deliver`, { method: 'Email' }), 400);

  section('"Cannot access file" and blocked flag');
  const t2v3 = r.data.submissions[0].id;
  expectStatus('Reporting access problems requires a description', await aanya.post(`/submissions/${t2v3}/review`, { decision: 'cannot_access' }), 400);
  r = await aanya.post(`/submissions/${t2v3}/review`, { decision: 'cannot_access', feedback: 'Drive says I need access.' });
  check('Access problem returns the next action to the submitter', r.data.next_action.kind === 'fix_access' && r.data.next_action.user.name === 'Rohan Mehta');
  expectStatus('Approval is paused until sharing is fixed', await aanya.post(`/submissions/${t2v3}/review`, { decision: 'approved' }), 400);
  r = await rohan.post(`/submissions/${t2v3}/access-restored`, { note: 'Shared with Aanya' });
  check('After Rohan fixes sharing, it is back with Aanya', r.data.next_action.kind === 'approve' && r.data.next_action.user.name === 'Aanya Shah');
  expectStatus('Blocking requires a reason', await rohan.post(`/tasks/${T2}/block`, { resolver_id: id('Kabir') }), 400);
  r = await rohan.post(`/tasks/${T2}/block`, { reason: 'Need client music licence', resolver_id: id('Kabir') });
  check('Blocked flag names the person needed; they become the next action', r.data.blocked?.resolver.name === 'Kabir Sethi' && r.data.next_action.kind === 'blocked' && r.data.next_action.user.name === 'Kabir Sethi');
  check('Blocked task keeps its stage', r.data.stage === 'in_review');
  expectStatus('Meera cannot clear the block', await meera.post(`/tasks/${T2}/unblock`, {}), 404);
  expectStatus('Kabir (person needed) clears the block', await kabir.post(`/tasks/${T2}/unblock`, {}), 200);

  section('Team settings, invitations and access control');
  expectStatus('Rohan cannot open user management', await rohan.get('/admin/users'), 403);
  expectStatus('Kabir cannot change permissions', await kabir.patch(`/admin/users/${id('Rohan')}`, { permissions: ['review.approve'] }), 403);
  r = await admin.post('/admin/users', { name: 'Priya Real', email: 'priya@example.com', role: 'producer', project_access: [aurora] });
  expectStatus('Admin invites a new person by name and email', r, 201);
  const invite = r.data.invite_url.split('/invite/')[1];
  const priya = new Client('Priya');
  expectStatus('Invited person cannot sign in before accepting', await priya.login('priya@example.com', 'whatever-123'), 401);
  expectStatus('Invite accepted with a password', await priya.post(`/invite/${invite}`, { password: 'priya-password-1' }), 200);
  expectStatus('Invite link cannot be reused', await new Client('x').post(`/invite/${invite}`, { password: 'another-pass-1' }), 404);
  check('Priya only sees projects she was given', (await priya.get('/meta')).data.projects.every((p) => p.id === aurora));
  r = await aanya.post(`/submissions/${t2v3}/review`, { decision: 'approved' });
  check('Aanya approves v3; now at Kabir\'s step', r.data.next_action.user.name === 'Kabir Sethi');
  r = await admin.patch(`/admin/users/${id('Kabir')}`, { permissions: ['tasks.create', 'tasks.edit', 'comments.write', 'workflow.move', 'delivery.record'] });
  expectStatus('Admin updates Kabir\'s permissions', r, 200);
  r = await kabir.post(`/submissions/${t2v3}/review`, { decision: 'approved' });
  check('Kabir can no longer approve his own step once approval permission is removed', r.status === 403 && /permission/.test(r.data.error), JSON.stringify(r));
  const priyaId = (await admin.get('/admin/users')).data.find((u) => u.email === 'priya@example.com').id;
  expectStatus('Admin deactivates Priya', await admin.patch(`/admin/users/${priyaId}`, { status: 'deactivated' }), 200);
  expectStatus('Deactivated person is signed out immediately', await priya.get('/tasks'), 401);
  expectStatus('Deactivated person cannot sign in', await priya.login('priya@example.com', 'priya-password-1'), 401);
  expectStatus('Admin cannot remove the last user manager', await admin.patch(`/admin/users/${(await admin.get('/auth/me')).data.user.id}`, { permissions: [] }), 400);
  expectStatus('Requests without the app header are refused (cross-site protection)', await kabir.req('POST', `/tasks/${T2}/comments`, { body: 'x' }, { header: false }), 403);
  expectStatus('Signed-out requests are refused', await new Client('anon').get('/tasks'), 401);

  section('Live updates');
  await new Promise((res) => setTimeout(res, 300));
  check('Aanya\'s open session received live change events', events.join('').includes('"changed"') && events.join('').includes('"notification"'));
  ac.abort();

  section('Persistence across a server restart');
  await stopServer();
  await startServer();
  const k2 = new Client('Kabir again');
  await k2.login(demo('kabir'));
  r = await k2.get(`/tasks/${T}`);
  check('Product launch reel is still Delivered with full history after restart', r.status === 200 && r.data.stage === 'delivered' && r.data.submissions.length === 2 && r.data.deliveries.length === 1 && r.data.activity.length >= 6);
  check('Sessions persist across restart (Rohan still signed in)', (await rohan.get('/auth/me')).status === 200);

  section('Removing demo data keeps real work');
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/create-admin.js', 'Real Admin', 'real.admin@example.com'],
    { env: { ...process.env, DATABASE_PATH: DB, ADMIN_PASSWORD: 'real-admin-password' }, stdio: 'ignore' });
  const realAdmin = new Client('Real admin');
  expectStatus('A real administrator created with create-admin can sign in', await realAdmin.login('real.admin@example.com', 'real-admin-password'), 200);
  const demoAdmin = new Client('demo admin');
  await demoAdmin.login(demo('studio'));
  expectStatus('Demo administrators cannot remove demo data', await demoAdmin.post('/admin/demo/remove'), 400);
  expectStatus('Real administrator removes demo data', await realAdmin.post('/admin/demo/remove'), 200);
  const left = (await realAdmin.get('/tasks')).data;
  check('No sample tasks remain', !left.some((t) => t.is_demo));
  check('Real tasks remain, with their history', left.some((t) => t.title === 'Product launch reel' && t.stage === 'delivered'));
  const users = (await realAdmin.get('/admin/users')).data;
  check('Demo people who worked on real tasks are deactivated, not deleted', users.find((u) => u.name === 'Rohan Mehta')?.status === 'deactivated');
  check('Demo people with no real work are deleted', !users.some((u) => u.name === 'Meera Kapoor'));

  await stopServer();
  const failed = results.filter((x) => x.ok === false);
  const passed = results.filter((x) => x.ok).length;
  console.log(`\n${passed} passed, ${failed.length} failed`);
  const md = ['# Verification report', '', `Run ${new Date().toISOString()} against a fresh database with separate signed-in accounts.`, '', `**${passed} passed, ${failed.length} failed**`, ''];
  for (const x of results) md.push(x.section ? `\n### ${x.section}\n` : `- ${x.ok ? '✅' : '❌'} ${x.name}${!x.ok && x.detail ? ` (${x.detail})` : ''}`);
  fs.mkdirSync('verify-output', { recursive: true });
  fs.writeFileSync('verify-output/verification-report.md', md.join('\n') + '\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await stopServer(); } catch { /* ignore */ } process.exit(1); });
