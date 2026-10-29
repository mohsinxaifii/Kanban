// SQLite persistence via Node's built-in driver (Node >= 22.13).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DATABASE_PATH || path.resolve('data/studio.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,              -- JSON array of permission keys
  project_access TEXT NOT NULL DEFAULT '"all"', -- JSON: "all" or array of project ids
  status TEXT NOT NULL DEFAULT 'invited', -- invited | active | deactivated
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
  -- not_checked | verified | failed  (only set to verified by a real Drive integration)
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
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_steps_task ON approval_steps(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subs_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
`);

export const now = () => new Date().toISOString();

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
