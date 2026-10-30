// Persistence in a single SQLite file (through libSQL), kept on the server's own disk.
// On cPanel, point DATABASE_PATH at a folder outside public_html so it is never served.
import { createClient } from '@libsql/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.env.DATABASE_PATH || 'data/studio.db');
fs.mkdirSync(path.dirname(file), { recursive: true });
export const client = createClient({ url: `file:${file}` });
export const dbLocation = file;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,              -- JSON array of permission keys
  project_access TEXT NOT NULL DEFAULT '"all"', -- JSON: "all" or array of project ids
  status TEXT NOT NULL DEFAULT 'invited', -- invited | pending (signed up, awaiting approval) | active | deactivated
  password_hash TEXT,
  invite_token TEXT UNIQUE,
  invited_by INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6b7280',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  brief TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium', -- urgent | high | medium | low
  stage TEXT NOT NULL DEFAULT 'backlog',
  creator_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER REFERENCES users(id),
  delivery_owner_id INTEGER REFERENCES users(id),
  recipient_id INTEGER REFERENCES users(id),
  due_date TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  blocked_resolver_id INTEGER REFERENCES users(id),
  blocked_by_id INTEGER REFERENCES users(id),
  blocked_at TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Configurable approval chain for a task, in order.
CREATE TABLE IF NOT EXISTS approval_steps (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  approver_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  link TEXT NOT NULL,
  link_kind TEXT NOT NULL,     -- file | folder | doc
  drive_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  review_deadline TEXT,
  -- in_review | approved | changes_requested | superseded
  status TEXT NOT NULL DEFAULT 'in_review',
  current_step INTEGER NOT NULL DEFAULT 0,
  access_issue INTEGER NOT NULL DEFAULT 0,
  -- not_checked | link_shared | restricted | error  (never claims a specific reviewer has access)
  access_check TEXT NOT NULL DEFAULT 'not_checked',
  access_check_detail TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  step_position INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,       -- approved | changes_requested | cannot_access | access_restored
  feedback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  recipient_id INTEGER NOT NULL REFERENCES users(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  method TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,   -- 1 only for an automated send confirmed by an integration
  delivered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
-- Personal folders where someone keeps tasks and links. Private to their owner.
CREATE TABLE IF NOT EXISTS saved_folders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES saved_folders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,          -- task | link
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_id, folder_id);
-- Roles named after job titles, with the permissions last saved for that title.
-- A row with a built-in key (admin, producer…) overrides that role's defaults.
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE COLLATE NOCASE,
  permissions TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_steps_task ON approval_steps(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subs_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_reviews_sub ON reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`;

export async function initDb() {
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  await client.execute('PRAGMA foreign_keys = ON');
  await client.executeMultiple(SCHEMA);
  // Columns added after the first release.
  const cols = (await client.execute('PRAGMA table_info(users)')).rows.map((r) => r[1]);
  if (!cols.includes('tour_done')) await client.execute('ALTER TABLE users ADD COLUMN tour_done INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('requested_at')) await client.execute('ALTER TABLE users ADD COLUMN requested_at TEXT'); // self sign-up requests
  const taskCols = (await client.execute('PRAGMA table_info(tasks)')).rows.map((r) => r[1]);
  // When the task entered its current stage (null = since it was created).
  if (!taskCols.includes('stage_entered_at')) await client.execute('ALTER TABLE tasks ADD COLUMN stage_entered_at TEXT');
}

// Every table that holds workspace data, children first (hosted databases may not
// enforce ON DELETE CASCADE).
export const DATA_TABLES = ['reviews', 'deliveries', 'submissions', 'approval_steps', 'comments', 'activity', 'notifications',
  'saved_items', 'saved_folders', 'tasks', 'sessions', 'users', 'projects', 'clients', 'roles'];

export const now = () => new Date().toISOString();

// Statements inside tx() run on the open transaction (found through async context),
// so helper functions can call one/all/run without passing a handle around.
const txStore = new AsyncLocalStorage();
let queue = Promise.resolve();
function exclusive(fn) {
  const result = queue.then(fn, fn);
  queue = result.catch(() => {});
  return result;
}

const toRows = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
async function exec(sql, args) {
  const conn = txStore.getStore() || client;
  return conn.execute({ sql, args });
}

export const one = async (sql, ...p) => toRows(await exec(sql, p))[0];
export const all = async (sql, ...p) => toRows(await exec(sql, p));
export async function run(sql, ...p) {
  // Writes outside a transaction wait for any transaction in progress.
  const rs = txStore.getStore() ? await exec(sql, p) : await exclusive(() => exec(sql, p));
  return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid };
}

// One write transaction at a time; all statements commit or none do.
export function tx(fn) {
  if (txStore.getStore()) return fn();
  return exclusive(async () => {
    const t = await client.transaction('write');
    try {
      const r = await txStore.run(t, fn);
      await t.commit();
      return r;
    } catch (e) {
      await t.rollback().catch(() => {});
      throw e;
    } finally {
      t.close();
    }
  });
}
