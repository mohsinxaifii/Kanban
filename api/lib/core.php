<?php
// Settings, database access and HTTP helpers shared by every route.

// ---------- settings ----------
// Values come from api/config.php (see config.sample.php). An environment variable with
// the same name takes priority, which is how the test suite configures the server.
function cfg(string $key, string $default = ''): string {
  static $file = null;
  if ($file === null) {
    $path = __DIR__ . '/../config.php';
    $file = is_file($path) ? (require $path) : [];
    if (!is_array($file)) $file = [];
  }
  $env = getenv($key);
  if ($env !== false) return (string) $env;
  if (array_key_exists($key, $file) && $file[$key] !== null) {
    $v = $file[$key];
    return is_bool($v) ? ($v ? 'true' : 'false') : (string) $v;
  }
  return $default;
}

function demo_mode(): bool { return cfg('DEMO_MODE', 'true') !== 'false'; }

// Address people use, for invite links. Taken from the request when not configured.
function public_url(): string {
  $u = rtrim(cfg('PUBLIC_URL'), '/');
  if ($u !== '') return $u;
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
  return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ---------- time ----------
function now(): string {
  $t = microtime(true);
  return gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%03dZ', (int) (($t - floor($t)) * 1000));
}
function now_ms(): int { return (int) floor(microtime(true) * 1000); }
function iso_ms(?string $iso): ?int {
  if (!$iso) return null;
  try { return (int) (new DateTimeImmutable($iso))->format('Uv'); } catch (Exception $e) { return null; }
}
function token(int $bytes): string { return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '='); }

// ---------- database ----------
const SCHEMA = <<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  permissions TEXT NOT NULL,
  project_access TEXT NOT NULL DEFAULT '"all"',
  status TEXT NOT NULL DEFAULT 'invited',
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
  priority TEXT NOT NULL DEFAULT 'medium',
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
  link_kind TEXT NOT NULL,
  drive_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  review_deadline TEXT,
  status TEXT NOT NULL DEFAULT 'in_review',
  current_step INTEGER NOT NULL DEFAULT 0,
  access_issue INTEGER NOT NULL DEFAULT 0,
  access_check TEXT NOT NULL DEFAULT 'not_checked',
  access_check_detail TEXT
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  step_position INTEGER NOT NULL,
  step_label TEXT NOT NULL,
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL,
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
  verified INTEGER NOT NULL DEFAULT 0,
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
  kind TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_id, folder_id);
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE COLLATE NOCASE,
  permissions TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Sign-in and sign-up attempt counters (rate limiting across requests).
-- "Forgot password" links. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, n INTEGER NOT NULL, started_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_steps_task ON approval_steps(task_id, position);
CREATE INDEX IF NOT EXISTS idx_subs_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_reviews_sub ON reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);
SQL;

// Bumped whenever SCHEMA or the column checks below change.
const SCHEMA_VERSION = 3;

// Every table that holds workspace data, children first.
const DATA_TABLES = ['reviews', 'deliveries', 'submissions', 'approval_steps', 'comments', 'activity', 'notifications',
  'saved_items', 'saved_folders', 'tasks', 'sessions', 'password_resets', 'users', 'projects', 'clients', 'roles'];

function database_path(): string {
  return cfg('DATABASE_PATH', dirname(__DIR__, 2) . '/data/studio.db');
}

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  $file = database_path();
  if (!is_dir(dirname($file))) mkdir(dirname($file), 0750, true);
  $pdo = new PDO('sqlite:' . $file, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_STRINGIFY_FETCHES => false,
    PDO::ATTR_TIMEOUT => 10,
  ]);
  $pdo->exec('PRAGMA busy_timeout = 10000');
  $pdo->exec('PRAGMA foreign_keys = ON');
  if ((int) $pdo->query('PRAGMA user_version')->fetchColumn() < SCHEMA_VERSION) migrate($pdo);
  return $pdo;
}

function migrate(PDO $pdo): void {
  $pdo->exec('PRAGMA journal_mode = WAL');
  $pdo->exec(SCHEMA);
  $cols = fn ($t) => array_column($pdo->query("PRAGMA table_info($t)")->fetchAll(), 'name');
  // Columns added after the first release.
  if (!in_array('tour_done', $cols('users'), true)) $pdo->exec('ALTER TABLE users ADD COLUMN tour_done INTEGER NOT NULL DEFAULT 0');
  if (!in_array('requested_at', $cols('users'), true)) $pdo->exec('ALTER TABLE users ADD COLUMN requested_at TEXT');
  if (!in_array('stage_entered_at', $cols('tasks'), true)) $pdo->exec('ALTER TABLE tasks ADD COLUMN stage_entered_at TEXT');
  $pdo->exec('PRAGMA user_version = ' . SCHEMA_VERSION);
}

function q(string $sql, array $params): PDOStatement {
  $st = db()->prepare($sql);
  foreach (array_values($params) as $i => $v) {
    $type = is_int($v) ? PDO::PARAM_INT : (is_null($v) ? PDO::PARAM_NULL : (is_bool($v) ? PDO::PARAM_INT : PDO::PARAM_STR));
    $st->bindValue($i + 1, is_bool($v) ? (int) $v : (is_float($v) ? (string) $v : $v), $type);
  }
  $st->execute();
  return $st;
}
function one(string $sql, ...$p): ?array { $r = q($sql, $p)->fetch(); return $r === false ? null : $r; }
function all(string $sql, ...$p): array { return q($sql, $p)->fetchAll(); }
function run(string $sql, ...$p): array {
  $st = q($sql, $p);
  return ['changes' => $st->rowCount(), 'id' => (int) db()->lastInsertId()];
}

// One write transaction at a time (BEGIN IMMEDIATE takes the write lock up front, so
// two requests never both read and then both try to write). Nested calls join the outer one.
function tx(callable $fn) {
  static $depth = 0;
  if ($depth > 0) return $fn();
  db()->exec('BEGIN IMMEDIATE');
  $depth++;
  try {
    $r = $fn();
    $depth--;
    db()->exec('COMMIT');
    return $r;
  } catch (Throwable $e) {
    $depth--;
    db()->exec('ROLLBACK');
    throw $e;
  }
}

function setting(string $key): ?string { return one('SELECT value FROM settings WHERE key = ?', $key)['value'] ?? null; }
function set_setting(string $key, string $value): void { run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', $key, $value); }

// ---------- HTTP ----------
class HttpError extends Exception {
  public int $status;
  public function __construct(int $status, string $message) { parent::__construct($message); $this->status = $status; }
}
function bad(string $msg) { throw new HttpError(400, $msg); }
function forbid(string $msg) { throw new HttpError(403, $msg); }
function not_found(string $msg) { throw new HttpError(404, $msg); }

function json_out($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
}
function redirect(string $url): void { http_response_code(302); header('Location: ' . $url); }

function body(): array {
  static $b = null;
  if ($b !== null) return $b;
  $raw = file_get_contents('php://input');
  if ($raw === '' || $raw === false) return $b = [];
  if (strlen($raw) > 200 * 1024) throw new HttpError(413, 'Request is too large.');
  $d = json_decode($raw, true);
  if (json_last_error() !== JSON_ERROR_NONE) bad('Invalid JSON.');
  return $b = is_array($d) ? $d : [];
}
function has(array $b, string $k): bool { return array_key_exists($k, $b); }

// Trimmed string or '' (anything that is not a string becomes '').
function str($v, int $max = 5000): string { return is_string($v) ? mb_substr(trim($v), 0, $max) : ''; }
function opt_id($v): ?int { return ($v === null || $v === '') ? null : (is_numeric($v) ? (int) $v : -1); }
function is_date($v): bool { return is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v); }
function valid_email(string $e): bool { return (bool) preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $e); }

function client_ip(): string { return $_SERVER['REMOTE_ADDR'] ?? ''; }

// Simple fixed-window counter in the database. Returns false when over the limit.
function attempts_ok(string $key, int $max, int $windowMs): bool {
  $a = one('SELECT n, started_ms FROM attempts WHERE key = ?', $key);
  return !$a || now_ms() - $a['started_ms'] > $windowMs || $a['n'] < $max;
}
function attempts_add(string $key, int $windowMs): void {
  $a = one('SELECT n, started_ms FROM attempts WHERE key = ?', $key);
  if (!$a || now_ms() - $a['started_ms'] > $windowMs) run('INSERT OR REPLACE INTO attempts (key, n, started_ms) VALUES (?, 1, ?)', $key, now_ms());
  else run('UPDATE attempts SET n = n + 1 WHERE key = ?', $key);
}
function attempts_clear(string $key): void { run('DELETE FROM attempts WHERE key = ?', $key); }

// Work that runs after the response has been sent (emails, the Drive check).
function after_response(?callable $fn = null): array {
  static $jobs = [];
  if ($fn) $jobs[] = $fn;
  return $jobs;
}
function run_after_response(): void {
  $jobs = after_response();
  if (!$jobs) return;
  if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  elseif (function_exists('litespeed_finish_request')) litespeed_finish_request();
  ignore_user_abort(true);
  foreach ($jobs as $job) { try { $job(); } catch (Throwable $e) { error_log((string) $e); } }
}

// Outgoing HTTPS request (Google sign-in and the Drive check). Uses cURL when the host has
// it, otherwise PHP's own stream wrapper.
function http_request(string $method, string $url, ?string $body = null, array $headers = [], int $timeout = 10): array {
  if (function_exists('curl_init')) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
      CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => $body]);
    $res = curl_exec($c);
    $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    if ($res === false) throw new RuntimeException('network');
    return [$status, $res];
  }
  $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '',
    'timeout' => $timeout, 'ignore_errors' => true]]);
  $res = @file_get_contents($url, false, $ctx);
  if ($res === false) throw new RuntimeException('network');
  $status = 0;
  foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $status = (int) $m[1];
  return [$status, $res];
}
