<?php
// Design Dimensions studio API. Every request under /api/ is routed here (see the
// .htaccess next to index.html). Permission rules live in lib/workflow.php.
if (PHP_VERSION_ID < 80100) {
  http_response_code(500);
  header('Content-Type: application/json');
  exit(json_encode(['error' => 'This app needs PHP 8.1 or newer. Choose it in cPanel → MultiPHP Manager.']));
}
if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
  http_response_code(500);
  header('Content-Type: application/json');
  exit(json_encode(['error' => 'The PHP "pdo_sqlite" extension is not enabled. Turn it on in cPanel → Select PHP Version → Extensions.']));
}

// On a real server the app only runs once api/config.php exists, so it never starts in
// demo mode or with a database inside the web folder by accident. (Local development
// and tests pass settings as environment variables instead.)
if (!is_file(__DIR__ . '/config.php') && getenv('DATABASE_PATH') === false && PHP_SAPI !== 'cli-server') {
  http_response_code(503);
  header('Content-Type: application/json');
  exit(json_encode(['error' => 'The studio is not set up yet: upload api/config.php (copy of config.sample.php).']));
}

require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/passwords.php';
require __DIR__ . '/lib/workflow.php';
require __DIR__ . '/lib/integrations.php';
require __DIR__ . '/lib/seed.php';

const COOKIE = 'dd_session';
const SESSION_DAYS = 14;
const COLORS = ['#7c5cff', '#e5484d', '#12a594', '#f76b15', '#3e63dd', '#d6409f', '#8e4ec6', '#0d74ce', '#ad7f58', '#46a758'];
const DELIVERY_METHODS = ['Google Drive share', 'Email', 'WeTransfer', 'Client portal', 'Other'];

// ---------- start-up ----------
// One-time wipe: set RESET_WORKSPACE to a phrase and every person, task and project is
// deleted on the next request. The same phrase is then needed to create the first
// administrator on the setup screen. Each phrase is applied once.
function reset_phrase(): string { return trim(cfg('RESET_WORKSPACE')); }
function phrase_hash(string $p): string { return hash('sha256', "dd-reset:$p"); }

function boot(): void {
  $phrase = reset_phrase();
  if ($phrase !== '' && setting('reset_applied') !== phrase_hash($phrase)) {
    tx(function () use ($phrase) {
      if (setting('reset_applied') === phrase_hash($phrase)) return;
      foreach (DATA_TABLES as $t) run("DELETE FROM $t");
      set_setting('reset_applied', phrase_hash($phrase));
      // A reset workspace never gets the sample data back.
      set_setting('demo_seeded', now());
    });
  }
  if (demo_mode()) seed_demo();
}

// ---------- people ----------
function row_to_user(?array $r): ?array {
  if (!$r) return null;
  $r['permissions'] = json_decode($r['permissions'], true) ?: [];
  $r['project_access'] = json_decode($r['project_access'], true);
  unset($r['password_hash'], $r['invite_token']);
  return $r;
}
function get_user($id): ?array { return $id === null ? null : row_to_user(one('SELECT * FROM users WHERE id = ?', (int) $id)); }
function user_ref(?array $u): ?array {
  return $u ? ['id' => $u['id'], 'name' => $u['name'], 'color' => $u['color'], 'title' => $u['title'], 'is_demo' => (bool) $u['is_demo'], 'status' => $u['status']] : null;
}
function user_map(): array {
  $m = [];
  foreach (all('SELECT * FROM users') as $r) $m[$r['id']] = row_to_user($r);
  return $m;
}

function log_activity(int $taskId, int $actorId, string $kind, string $message): void {
  run('INSERT INTO activity (task_id, actor_id, kind, message, created_at) VALUES (?,?,?,?,?)', $taskId, $actorId, $kind, $message, now());
}
function notify($userId, ?int $taskId, string $message, $exceptId = null): void {
  if (!$userId || $userId === $exceptId) return;
  run('INSERT INTO notifications (user_id, task_id, message, created_at) VALUES (?,?,?,?)', $userId, $taskId, $message, now());
}
function touch_task(int $taskId): void { run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), $taskId); }

// ---------- live updates ----------
// Open pages ask /api/changes every few seconds. A counter changes whenever anything
// does, and each page then re-reads through the same permission checks.
function flush_changes(): void {
  run("INSERT INTO settings (key, value) VALUES ('change_seq', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1");
}

// ---------- auth ----------
function cookie_secure(): bool { return cfg('COOKIE_SECURE') === 'true' || str_starts_with(public_url(), 'https://'); }
function set_cookie(string $name, string $value, array $opts): void {
  setcookie($name, $value, ['path' => $opts['path'] ?? '/', 'expires' => $opts['expires'] ?? 0, 'httponly' => true, 'samesite' => 'Lax', 'secure' => cookie_secure()]);
}
function set_session(int $userId): void {
  $token = token(32);
  $expires = time() + SESSION_DAYS * 86400;
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', $token, $userId, gmdate('Y-m-d\TH:i:s.000\Z', $expires));
  set_cookie(COOKIE, $token, ['expires' => $expires]);
}
function session_user(): ?array {
  $token = $_COOKIE[COOKIE] ?? '';
  if (!$token) return null;
  $r = one('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', $token);
  if (!$r || $r['session_expires'] < now()) return null;
  unset($r['session_expires']);
  $u = row_to_user($r);
  if ($u['status'] !== 'active') return null;
  if ($u['is_demo'] && !demo_mode()) return null; // demo accounts stop working once demo mode is off
  return $u;
}
function auth(): array {
  $u = session_user();
  if (!$u) throw new HttpError(401, 'Please sign in.');
  return $u;
}
function need(string $perm): array {
  $u = auth();
  if (!can($u, $perm)) forbid('You need the "' . permission_label($perm) . '" permission.');
  return $u;
}

// Sets a password and signs the person out everywhere else.
function set_password(int $userId, string $pw, ?string $keepToken = null): void {
  run('UPDATE users SET password_hash = ? WHERE id = ?', hash_password($pw), $userId);
  run('DELETE FROM sessions WHERE user_id = ? AND token != ?', $userId, (string) $keepToken);
  run('DELETE FROM password_resets WHERE user_id = ?', $userId);
}
function check_new_password(string $pw): void {
  if (mb_strlen($pw) < 10) bad('Use at least 10 characters for the password.');
}

// ---------- reference data ----------
function visible_projects(array $user): array {
  $rows = all('SELECT p.id, p.name, p.client_id, p.is_demo, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name');
  return array_values(array_filter($rows, fn ($p) => has_project_access($user, $p['id'])));
}

// ---------- roles ----------
// Built-in roles plus roles created from job titles. Saving a person whose job title
// matches a role saves the permissions chosen for them as that role's permissions.
function all_roles(): array {
  $rows = all('SELECT * FROM roles ORDER BY created_at');
  $byKey = array_column($rows, null, 'key');
  $out = [];
  foreach (ROLES as $r) {
    $o = $byKey[$r['key']] ?? null;
    $out[] = ['key' => $r['key'], 'label' => $o['label'] ?? $r['label'], 'permissions' => $o ? json_decode($o['permissions'], true) : $r['permissions'], 'builtin' => true];
  }
  foreach ($rows as $r) {
    if (!in_array($r['key'], role_keys(), true)) $out[] = ['key' => $r['key'], 'label' => $r['label'], 'permissions' => json_decode($r['permissions'], true), 'builtin' => false];
  }
  return $out;
}
function find_role(string $key): ?array { foreach (all_roles() as $r) if ($r['key'] === $key) return $r; return null; }
function save_role_from_title(string $title, array $permissions): string {
  $perms = json_encode($permissions);
  foreach (all_roles() as $r) {
    if (mb_strtolower($r['label']) === mb_strtolower($title)) {
      run('INSERT INTO roles (key, label, permissions, created_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET permissions = excluded.permissions', $r['key'], $r['label'], $perms, now());
      return $r['key'];
    }
  }
  $key = 'role_' . bin2hex(random_bytes(6));
  run('INSERT INTO roles (key, label, permissions, created_at) VALUES (?,?,?,?)', $key, $title, $perms, now());
  return $key;
}

// ---------- task serialisation ----------
function task_context(?array $taskIds = null): array {
  $users = user_map();
  $projects = array_column(all('SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id'), null, 'id');
  $filter = $taskIds !== null ? 'WHERE task_id IN (' . (implode(',', array_map('intval', $taskIds)) ?: 'NULL') . ')' : '';
  $steps = [];
  foreach (all("SELECT * FROM approval_steps $filter ORDER BY task_id, position") as $s) $steps[$s['task_id']][] = $s;
  $subs = []; // latest non-superseded submission per task
  foreach (all('SELECT * FROM submissions ' . ($filter ? "$filter AND" : 'WHERE') . " status != 'superseded' ORDER BY id") as $s) $subs[$s['task_id']] = $s;
  $lastReview = [];
  $rf = $filter ? str_replace('task_id', 's.task_id', $filter) : '';
  foreach (all("SELECT r.submission_id, MAX(r.created_at) AS at FROM reviews r JOIN submissions s ON s.id = r.submission_id $rf GROUP BY r.submission_id") as $r) $lastReview[$r['submission_id']] = $r['at'];
  return compact('users', 'projects', 'steps', 'subs', 'lastReview');
}

function step_states(array $steps, ?array $sub, array $task): array {
  $out = [];
  foreach ($steps as $i => $s) {
    $state = 'pending';
    if ($sub && $sub['status'] === 'approved') $state = 'approved';
    elseif ($sub && $sub['status'] === 'in_review') $state = $i < $sub['current_step'] ? 'approved' : ($i === $sub['current_step'] ? 'current' : 'pending');
    if ($task['stage'] === 'delivered' && ($sub['status'] ?? null) === 'approved') $state = 'approved';
    $out[] = ['id' => $s['id'], 'position' => $s['position'], 'label' => $s['label'], 'approver_id' => $s['approver_id'], 'state' => $state];
  }
  return $out;
}

function summarize(array $task, array $ctx, string $view): array {
  $steps = $ctx['steps'][$task['id']] ?? [];
  $sub = $ctx['subs'][$task['id']] ?? null;
  $u = fn ($id) => $id === null ? null : user_ref($ctx['users'][$id] ?? null);
  $p = $ctx['projects'][$task['project_id']];
  $na = next_action($task, $steps, $sub);
  $waitingSince = $task['updated_at'];
  if ($task['stage'] === 'in_review' && $sub) $waitingSince = $ctx['lastReview'][$sub['id']] ?? $sub['submitted_at'];
  $base = [
    'id' => $task['id'], 'title' => $task['title'], 'stage' => $task['stage'], 'priority' => $task['priority'], 'due_date' => $task['due_date'],
    'project' => ['id' => $p['id'], 'name' => $p['name']], 'client' => ['id' => $p['client_id'], 'name' => $p['client_name']],
    'creator' => $u($task['creator_id']), 'assignee' => $u($task['assignee_id']), 'delivery_owner' => $u($task['delivery_owner_id']), 'recipient' => $u($task['recipient_id']),
    'is_demo' => (bool) $task['is_demo'], 'view' => $view, 'updated_at' => $task['updated_at'], 'created_at' => $task['created_at'], 'sort_order' => $task['sort_order'],
    'stage_entered_at' => $task['stage_entered_at'] ?: $task['created_at'],
  ];
  if ($view === 'deliverable') return $base + ['next_action' => ['kind' => 'done', 'user' => null]];
  return $base + [
    'blocked' => $task['blocked'] ? ['reason' => $task['blocked_reason'], 'resolver' => $u($task['blocked_resolver_id']), 'by' => $u($task['blocked_by_id']), 'at' => $task['blocked_at']] : null,
    'next_action' => $na + ['user' => $u($na['user_id'])],
    'steps' => array_map(fn ($s) => $s + ['approver' => $u($s['approver_id'])], step_states($steps, $sub, $task)),
    'current_submission' => $sub ? [
      'id' => $sub['id'], 'version' => $sub['version'], 'status' => $sub['status'], 'access_issue' => (bool) $sub['access_issue'], 'submitted_at' => $sub['submitted_at'],
      'review_deadline' => $sub['review_deadline'], 'submitted_by' => $u($sub['submitted_by']),
      'thumbnail_url' => $sub['link_kind'] !== 'folder' && $sub['drive_id'] && !str_starts_with($sub['drive_id'], 'DEMO-') ? "https://drive.google.com/thumbnail?id={$sub['drive_id']}&sz=w400" : null,
    ] : null,
    'waiting_since' => $waitingSince,
  ];
}

function visible_tasks(array $user): array {
  $tasks = all('SELECT * FROM tasks ORDER BY sort_order, id');
  $ctx = task_context();
  $out = [];
  foreach ($tasks as $t) {
    $view = view_level($user, $t, $ctx['steps'][$t['id']] ?? []);
    if ($view) $out[] = summarize($t, $ctx, $view);
  }
  return $out;
}

function allowed_actions(array $user, array $task, array $steps, ?array $sub): array {
  $inv = involvement($user, $task, $steps);
  $oversee = can($user, 'work.oversee');
  $isCurrentApprover = $sub && $sub['status'] === 'in_review' && (($steps[$sub['current_step']]['approver_id'] ?? null) === $user['id']);
  $moveTargets = [];
  foreach (stage_keys() as $s) {
    try { check_manual_move($user, $task, $steps, $s); if ($s !== $task['stage']) $moveTargets[] = $s; } catch (HttpError $e) { /* not allowed */ }
  }
  return [
    'edit' => can($user, 'tasks.edit') && $task['stage'] !== 'delivered',
    'assign' => can($user, 'tasks.create') && $task['stage'] !== 'delivered',
    'edit_steps' => can($user, 'tasks.create') && !in_array($task['stage'], ['in_review', 'delivered'], true),
    'move_to' => $moveTargets,
    'submit' => can($user, 'assets.submit') && (!empty($inv['assignee']) || $oversee) && $task['stage'] !== 'delivered' && count($steps) > 0,
    'review' => $isCurrentApprover && !$sub['access_issue'] && can($user, 'review.approve'),
    'fix_access' => (bool) ($sub && $sub['status'] === 'in_review' && $sub['access_issue'] && ($sub['submitted_by'] === $user['id'] || !empty($inv['assignee']))),
    'deliver' => $task['stage'] === 'ready_to_deliver' && $task['delivery_owner_id'] === $user['id'] && can($user, 'delivery.record'),
    'comment' => can($user, 'comments.write') && $task['stage'] !== 'delivered',
    'block' => !$task['blocked'] && in_array($task['stage'], ACTIVE_STAGES, true) && (can($user, 'comments.write') || can($user, 'workflow.move')),
    'unblock' => (bool) $task['blocked'] && ($task['blocked_resolver_id'] === $user['id'] || $task['blocked_by_id'] === $user['id'] || $oversee),
  ];
}

function task_detail(array $user, $taskId): array {
  [$task, $steps, $view] = require_view($user, $taskId, 'any');
  $ctx = task_context([$task['id']]);
  $sub = $ctx['subs'][$task['id']] ?? null;
  $summary = summarize($task, $ctx, $view);
  $u = fn ($id) => $id === null ? null : user_ref($ctx['users'][$id] ?? null);
  $allSubs = all('SELECT * FROM submissions WHERE task_id = ? ORDER BY id DESC', $task['id']);
  $subById = array_column($allSubs, null, 'id');
  $deliveries = array_map(function ($d) use ($subById, $u) {
    $s = $subById[$d['submission_id']];
    return array_merge($d, ['verified' => (bool) $d['verified'], 'recipient' => $u($d['recipient_id']), 'sender' => $u($d['sender_id']),
      'version' => $s['version'], 'link' => $s['link'], 'preview_url' => preview_url($s)]);
  }, all('SELECT * FROM deliveries WHERE task_id = ? ORDER BY id', $task['id']));
  if ($view === 'deliverable') return $summary + ['deliveries' => $deliveries];
  $reviews = all('SELECT r.* FROM reviews r JOIN submissions s ON s.id = r.submission_id WHERE s.task_id = ? ORDER BY r.id', $task['id']);
  $submissions = array_map(fn ($s) => array_merge($s, [
    'access_issue' => (bool) $s['access_issue'], 'submitted_by' => $u($s['submitted_by']), 'preview_url' => preview_url($s),
    'reviews' => array_values(array_map(fn ($r) => $r + ['reviewer' => $u($r['reviewer_id'])], array_filter($reviews, fn ($r) => $r['submission_id'] === $s['id']))),
  ]), $allSubs);
  return $summary + [
    'brief' => $task['brief'],
    'submissions' => $submissions,
    'deliveries' => $deliveries,
    'comments' => array_map(fn ($c) => $c + ['author' => $u($c['author_id'])], all('SELECT * FROM comments WHERE task_id = ? ORDER BY id', $task['id'])),
    'activity' => array_map(fn ($a) => $a + ['actor' => $u($a['actor_id'])], all('SELECT * FROM activity WHERE task_id = ? ORDER BY id DESC', $task['id'])),
    'allowed' => allowed_actions($user, $task, $steps, $sub),
  ];
}

// Validates that a named person can play a role on a task in this project.
function check_person(?int $id, int $projectId, string $roleLabel, ?string $perm = null): ?array {
  if ($id === null) return null;
  $p = get_user($id);
  if (!$p || $p['status'] === 'deactivated' || ($p['is_demo'] && !demo_mode())) bad("$roleLabel: choose an existing, active person.");
  if (!has_project_access($p, $projectId)) bad("{$p['name']} does not have access to this project. An administrator can grant it in Settings.");
  if ($perm && !in_array($perm, $p['permissions'], true)) {
    bad("{$p['name']} cannot be the " . mb_strtolower($roleLabel) . ' because they do not have the "' . permission_label($perm) . '" permission.');
  }
  return $p;
}
function check_steps($rawSteps, int $projectId): array {
  if (!is_array($rawSteps)) return [];
  if (count($rawSteps) > 6) bad('Use at most six approval steps.');
  $out = [];
  foreach (array_values($rawSteps) as $i => $s) {
    $approverId = opt_id($s['approver_id'] ?? null);
    if (!$approverId) bad('Approval step ' . ($i + 1) . ' needs an approver.');
    $p = check_person($approverId, $projectId, 'Approver', 'review.approve');
    $out[] = ['label' => str($s['label'] ?? '', 60) ?: 'Approval ' . ($i + 1), 'approver_id' => $approverId, 'name' => $p['name']];
  }
  return $out;
}
function write_steps(int $taskId, array $steps): void {
  run('DELETE FROM approval_steps WHERE task_id = ?', $taskId);
  foreach ($steps as $i => $s) run('INSERT INTO approval_steps (task_id, position, label, approver_id) VALUES (?,?,?,?)', $taskId, $i, $s['label'], $s['approver_id']);
}
function describe_steps(array $steps): string { return implode(' → ', array_map(fn ($s) => "{$s['label']} ({$s['name']})", $steps)); }

// ---------- administration helpers ----------
function sanitize_access($v) {
  if ($v === 'all') return 'all';
  if (!is_array($v)) bad('Choose the projects this person can access.');
  $ids = array_column(all('SELECT id FROM projects'), 'id');
  return array_values(array_filter(array_unique(array_map('intval', $v)), fn ($id) => in_array($id, $ids, true)));
}
function sanitize_perms($v): array {
  if (!is_array($v)) bad('Permissions must be a list.');
  return array_values(array_unique(array_filter($v, fn ($k) => is_string($k) && in_array($k, permission_keys(), true))));
}
function admin_view(array $r): array {
  $u = row_to_user($r);
  $u['has_password'] = !empty($r['password_hash']);
  $u['invite_url'] = $r['status'] === 'invited' && $r['invite_token'] ? public_url() . "/#/invite/{$r['invite_token']}" : null;
  return $u;
}
function email_invite(array $row, array $inviter): array {
  $v = admin_view($row);
  if (!$v['invite_url']) return ['status' => 'not_invited'];
  return send_invite($row['email'], $row['name'], $inviter['name'], $v['invite_url']);
}
function assert_admin_remains(int $excludingId, array $nextUser): void {
  foreach (all("SELECT * FROM users WHERE status = 'active'") as $r) {
    $u = $r['id'] === $excludingId ? $nextUser : row_to_user($r);
    if ($u['status'] === 'active' && in_array('users.manage', $u['permissions'], true) && (demo_mode() || !$u['is_demo'])) return;
  }
  if ($nextUser['status'] === 'active' && in_array('users.manage', $nextUser['permissions'], true) && (demo_mode() || !$nextUser['is_demo'])) return;
  bad('At least one active person must keep the "Manage users and permissions" permission.');
}
function setup_open(): bool { return reset_phrase() !== '' && !one('SELECT id FROM users LIMIT 1'); }

function signup_token(): ?string { return setting('signup_token'); }
function signup_view(): array { $t = signup_token(); return ['enabled' => (bool) $t, 'url' => $t ? public_url() . "/#/join/$t" : null]; }
function valid_signup($token): bool { $t = signup_token(); return $t && is_string($token) && hash_equals($t, $token); }

function clean_url($v): string {
  $u = str($v, 2000);
  if ($u !== '' && !preg_match('/^[a-z][a-z0-9+.-]*:/i', $u)) $u = "https://$u";
  $p = parse_url($u);
  if (!$p || !in_array(strtolower($p['scheme'] ?? ''), ['http', 'https'], true) || empty($p['host'])) bad('Enter a web link starting with http:// or https://.');
  if (!isset($p['path']) || $p['path'] === '') {
    $u = preg_replace('#^([a-z]+://[^/?\#]+)#i', '$1/', $u);
  }
  return $u;
}
function own_folder(array $user, $id): array {
  $f = one('SELECT * FROM saved_folders WHERE id = ? AND user_id = ?', (int) $id, $user['id']);
  if (!$f) not_found('Folder not found.');
  return $f;
}
function own_item(array $user, $id): array {
  $i = one('SELECT * FROM saved_items WHERE id = ? AND user_id = ?', (int) $id, $user['id']);
  if (!$i) not_found('Saved item not found.');
  return $i;
}

// ---------- routes ----------
$routes = [];
function route(string $method, string $pattern, callable $fn): void {
  global $routes;
  $re = '#^' . preg_replace('#:(\w+)#', '(?P<$1>[^/]+)', $pattern) . '$#';
  $routes[] = [$method, $re, $fn];
}

route('GET', '/health', fn () => json_out(['ok' => true]));

// Sign-in
route('POST', '/auth/login', function () {
  $b = body();
  $email = mb_strtolower(str($b['email'] ?? '', 200));
  $key = 'login|' . client_ip() . '|' . $email;
  if (!attempts_ok($key, 10, 15 * 60000)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  $row = one('SELECT * FROM users WHERE email = ?', $email);
  $ok = false;
  if ($row && $row['status'] === 'active' && !($row['is_demo'] && !demo_mode()) && $row['password_hash']) {
    [$ok, $upgraded] = verify_password(str($b['password'] ?? '', 200), $row['password_hash']);
    if ($ok && $upgraded) run('UPDATE users SET password_hash = ? WHERE id = ?', $upgraded, $row['id']);
  }
  if (!$ok) {
    attempts_add($key, 15 * 60000);
    $msg = match ($row['status'] ?? null) {
      'deactivated' => 'This account has been deactivated.',
      'invited' => 'This invitation has not been accepted yet. Use your invite link.',
      'pending' => 'Your request to join is waiting for an administrator to approve it.',
      default => 'Email or password is incorrect.',
    };
    throw new HttpError(401, $msg);
  }
  attempts_clear($key);
  set_session($row['id']);
  json_out(['user' => get_user($row['id'])]);
});
route('POST', '/auth/logout', function () {
  if (!empty($_COOKIE[COOKIE])) run('DELETE FROM sessions WHERE token = ?', $_COOKIE[COOKIE]);
  set_cookie(COOKIE, '', ['expires' => 1]);
  json_out(['ok' => true]);
});
route('GET', '/auth/me', fn () => json_out(['user' => auth()]));
route('GET', '/auth/demo', function () {
  $setup = setup_open();
  $extra = ['google' => google_enabled(), 'setup' => $setup, 'email' => email_enabled()];
  if (!demo_mode() || $setup) return json_out(['enabled' => false, 'accounts' => []] + $extra);
  $accounts = all("SELECT name, email, title FROM users WHERE is_demo = 1 AND status = 'active' ORDER BY id");
  json_out(['enabled' => true, 'password' => demo_password(), 'accounts' => $accounts] + $extra);
});
// First administrator after a reset. Only works while nobody exists, and only with the phrase.
route('POST', '/auth/setup', function () {
  if (!setup_open()) not_found('This workspace is already set up. Sign in instead.');
  if (!attempts_ok('setup', 10, 15 * 60000)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  $b = body();
  if (!hash_equals(phrase_hash(reset_phrase()), phrase_hash(str($b['code'] ?? '', 500)))) {
    attempts_add('setup', 15 * 60000);
    forbid('That setup phrase is not right. Use the RESET_WORKSPACE value from the server settings.');
  }
  $name = str($b['name'] ?? '', 120);
  $email = mb_strtolower(str($b['email'] ?? '', 200));
  $pw = str($b['password'] ?? '', 200);
  if (!$name) bad('Enter your name.');
  if (!valid_email($email)) bad('Enter a valid email address.');
  check_new_password($pw);
  $hash = hash_password($pw);
  $id = tx(function () use ($name, $email, $hash) {
    if (one('SELECT id FROM users LIMIT 1')) bad('This workspace is already set up. Sign in instead.');
    return run("INSERT INTO users (name, email, title, role, permissions, project_access, status, password_hash, is_demo, color, created_at)
      VALUES (?,?,'Administrator','admin',?,'\"all\"','active',?,0,'#111827',?)", $name, $email, json_encode(role_defaults('admin')), $hash, now())['id'];
  });
  set_session($id);
  json_out(['user' => get_user($id)], 201);
});
route('POST', '/me/tour', function () {
  $u = auth();
  run('UPDATE users SET tour_done = ? WHERE id = ?', (body()['done'] ?? true) === false ? 0 : 1, $u['id']);
  json_out(['ok' => true]);
});
// Change your own password (needs the current one).
route('POST', '/me/password', function () {
  $u = auth();
  $b = body();
  $row = one('SELECT password_hash FROM users WHERE id = ?', $u['id']);
  if (!$row['password_hash'] || !verify_password(str($b['current'] ?? '', 200), $row['password_hash'])[0]) bad('Your current password is not right.');
  $pw = str($b['password'] ?? '', 200);
  check_new_password($pw);
  set_password($u['id'], $pw, $_COOKIE[COOKIE] ?? null);
  json_out(['ok' => true]);
});

// Forgot password. Always answers the same way, so it never reveals who has an account.
route('POST', '/auth/forgot', function () {
  $email = mb_strtolower(str(body()['email'] ?? '', 200));
  if (!valid_email($email)) bad('Enter the email address you sign in with.');
  if (!email_enabled()) bad('Password reset emails are not set up yet. Ask an administrator to set a new password for you.');
  $ipKey = 'forgot|' . client_ip();
  $mailKey = 'forgot|' . $email;
  if (!attempts_ok($ipKey, 10, 60 * 60000)) throw new HttpError(429, 'Too many requests. Try again later.');
  attempts_add($ipKey, 60 * 60000);
  $row = one('SELECT * FROM users WHERE email = ?', $email);
  if ($row && $row['status'] === 'active' && !$row['is_demo'] && attempts_ok($mailKey, 3, 60 * 60000)) {
    attempts_add($mailKey, 60 * 60000);
    $t = token(32);
    run('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', $row['id'], now());
    run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', hash('sha256', $t), $row['id'], gmdate('Y-m-d\TH:i:s.000\Z', time() + 3600));
    $url = public_url() . "/#/reset/$t";
    after_response(fn () => send_reset($row['email'], $row['name'], $url));
  }
  json_out(['ok' => true]);
});
function reset_row(string $t): ?array {
  return one('SELECT u.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ? AND u.status = ?', hash('sha256', $t), now(), 'active');
}
route('GET', '/reset/:token', function ($p) {
  $r = reset_row($p['token']);
  if (!$r) not_found('This reset link has expired or was already used. Ask for a new one.');
  json_out(['name' => $r['name'], 'email' => $r['email']]);
});
route('POST', '/reset/:token', function ($p) {
  $r = reset_row($p['token']);
  if (!$r) not_found('This reset link has expired or was already used. Ask for a new one.');
  $pw = str(body()['password'] ?? '', 200);
  check_new_password($pw);
  set_password($r['id'], $pw);
  set_session($r['id']);
  json_out(['user' => get_user($r['id'])]);
});

// Google sign-in
const OAUTH_COOKIE = 'dd_oauth';
function login_error(string $code): void { redirect("/#/login?error=$code"); }
route('GET', '/auth/google', function () {
  if (!google_enabled()) return login_error('google-off');
  [$url, $state, $nonce] = google_start();
  setcookie(OAUTH_COOKIE, "$state.$nonce", ['path' => '/api/auth/google', 'expires' => time() + 600, 'httponly' => true, 'samesite' => 'Lax', 'secure' => cookie_secure()]);
  redirect($url);
});
route('GET', '/auth/google/callback', function () {
  [$state, $nonce] = array_pad(explode('.', (string) ($_COOKIE[OAUTH_COOKIE] ?? '')), 2, '');
  setcookie(OAUTH_COOKIE, '', ['path' => '/api/auth/google', 'expires' => 1, 'httponly' => true, 'samesite' => 'Lax', 'secure' => cookie_secure()]);
  if (!google_enabled()) return login_error('google-off');
  if (!empty($_GET['error'])) return login_error('google-cancelled');
  if (!$state || $state !== ($_GET['state'] ?? '') || empty($_GET['code'])) return login_error('google-state');
  try { $email = google_finish((string) $_GET['code'], $nonce); } catch (RuntimeException $e) { return login_error(str_starts_with($e->getMessage(), 'google-') ? $e->getMessage() : 'google-token'); }
  $row = one('SELECT * FROM users WHERE email = ?', $email);
  // Google never creates accounts: the person must have been added in Settings.
  if (!$row || $row['is_demo']) return login_error('no-account');
  if ($row['status'] === 'deactivated') return login_error('deactivated');
  if ($row['status'] === 'pending') return login_error('pending');
  if ($row['status'] === 'invited') run("UPDATE users SET status = 'active', invite_token = NULL WHERE id = ?", $row['id']);
  set_session($row['id']);
  redirect('/#/my-work');
});

// Invitations
route('GET', '/invite/:token', function ($p) {
  $r = one("SELECT name, email FROM users WHERE invite_token = ? AND status = 'invited'", $p['token']);
  if (!$r) not_found('This invitation is invalid or has already been used.');
  json_out($r);
});
route('POST', '/invite/:token', function ($p) {
  $r = one("SELECT * FROM users WHERE invite_token = ? AND status = 'invited'", $p['token']);
  if (!$r) not_found('This invitation is invalid or has already been used.');
  $pw = str(body()['password'] ?? '', 200);
  if (mb_strlen($pw) < 10) bad('Use at least 10 characters.');
  run("UPDATE users SET password_hash = ?, status = 'active', invite_token = NULL WHERE id = ?", hash_password($pw), $r['id']);
  set_session($r['id']);
  json_out(['user' => get_user($r['id'])]);
});

// Live updates (polled)
route('GET', '/changes', function () {
  $u = auth();
  json_out(['seq' => (int) (setting('change_seq') ?? 0), 'notification' => (int) (one('SELECT MAX(id) AS m FROM notifications WHERE user_id = ?', $u['id'])['m'] ?? 0)]);
});

// Reference data
route('GET', '/meta', function () {
  $u = auth();
  json_out([
    'stages' => STAGES, 'activeStages' => ACTIVE_STAGES, 'manualTargets' => MANUAL_TARGETS,
    'permissions' => PERMISSIONS, 'roles' => all_roles(),
    'projects' => visible_projects($u),
    'driveIntegration' => drive_integration(),
    'emailEnabled' => email_enabled(),
    'pendingRequests' => can($u, 'users.manage') ? (int) one("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'")['n'] : 0,
    'demoMode' => demo_mode(),
  ]);
});
// Searchable people field source. Only existing accounts are returned.
route('GET', '/people', function () {
  $me = auth();
  $manage = can($me, 'users.manage');
  $out = [];
  foreach (all("SELECT * FROM users WHERE status IN ('active', 'invited') ORDER BY name") as $r) {
    $u = row_to_user($r);
    if (!demo_mode() && $u['is_demo']) continue;
    $p = user_ref($u) + ['role' => $u['role']];
    if ($manage || $u['id'] === $me['id']) $p['email'] = $u['email'];
    $out[] = $p + [
      'can_approve' => in_array('review.approve', $u['permissions'], true),
      'can_submit' => in_array('assets.submit', $u['permissions'], true),
      'can_deliver' => in_array('delivery.record', $u['permissions'], true),
      'project_access' => $u['project_access'],
    ];
  }
  json_out($out);
});

// Tasks
route('GET', '/tasks', fn () => json_out(visible_tasks(auth())));
route('GET', '/tasks/:id', fn ($p) => json_out(task_detail(auth(), $p['id'])));

route('POST', '/tasks', function () {
  $me = need('tasks.create');
  $b = body();
  $title = str($b['title'] ?? '', 200);
  if (!$title) bad('Give the task a title.');
  $projectId = (int) ($b['project_id'] ?? 0);
  if (!one('SELECT id FROM projects WHERE id = ?', $projectId)) bad('Choose a project.');
  if (!has_project_access($me, $projectId)) forbid('You do not have access to that project.');
  $assignee = check_person(opt_id($b['assignee_id'] ?? null), $projectId, 'Assignee', 'assets.submit');
  $delivery = check_person(opt_id($b['delivery_owner_id'] ?? null) ?? $me['id'], $projectId, 'Delivery owner', 'delivery.record');
  $recipient = check_person(opt_id($b['recipient_id'] ?? null), $projectId, 'Recipient');
  $steps = check_steps($b['steps'] ?? [], $projectId);
  $priority = in_array($b['priority'] ?? null, ['urgent', 'high', 'medium', 'low'], true) ? $b['priority'] : 'medium';
  $stage = in_array($b['stage'] ?? null, ['backlog', 'planned', 'in_progress'], true) ? $b['stage'] : ($assignee ? 'planned' : 'backlog');
  $id = tx(function () use ($b, $me, $title, $projectId, $assignee, $delivery, $recipient, $steps, $priority, $stage) {
    $t = now();
    $taskId = run('INSERT INTO tasks (title, project_id, brief, priority, stage, creator_id, assignee_id, delivery_owner_id, recipient_id, due_date, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', $title, $projectId, str($b['brief'] ?? '', 20000), $priority, $stage, $me['id'], $assignee['id'] ?? null,
      $delivery['id'] ?? null, $recipient['id'] ?? null, is_date($b['due_date'] ?? null) ? $b['due_date'] : null, now_ms(), $t, $t)['id'];
    write_steps($taskId, $steps);
    log_activity($taskId, $me['id'], 'created', 'Created the task' . ($assignee ? " and assigned {$assignee['name']}" : ''));
    if ($steps) log_activity($taskId, $me['id'], 'steps', 'Set approval steps: ' . describe_steps($steps));
    if ($assignee) notify($assignee['id'], $taskId, "{$me['name']} assigned you \"$title\"", $me['id']);
    return $taskId;
  });
  flush_changes();
  json_out(task_detail($me, $id), 201);
});

route('PATCH', '/tasks/:id', function ($p) {
  $me = auth();
  [$task] = require_view($me, $p['id']);
  if ($task['stage'] === 'delivered') bad('Delivered tasks are closed.');
  $b = body();
  $changes = [];
  $sets = [];
  foreach (['title', 'brief', 'priority', 'due_date'] as $f) if (has($b, $f) && !can($me, 'tasks.edit')) forbid('You need the "Edit briefs and deadlines" permission.');
  foreach (['assignee_id', 'delivery_owner_id', 'recipient_id', 'project_id'] as $f) if (has($b, $f) && !can($me, 'tasks.create')) forbid('You need the "Create and assign tasks" permission to change who is responsible.');
  if (has($b, 'title')) { $v = str($b['title'], 200); if (!$v) bad('Title cannot be empty.'); $sets['title'] = $v; $changes[] = 'title'; }
  if (has($b, 'brief')) { $sets['brief'] = str($b['brief'], 20000); $changes[] = 'brief'; }
  if (has($b, 'priority')) { if (!in_array($b['priority'], ['urgent', 'high', 'medium', 'low'], true)) bad('Unknown priority.'); $sets['priority'] = $b['priority']; $changes[] = "priority to {$b['priority']}"; }
  if (has($b, 'due_date')) { $sets['due_date'] = is_date($b['due_date']) ? $b['due_date'] : null; $changes[] = 'deadline to ' . ($sets['due_date'] ?: 'none'); }
  $projectId = has($b, 'project_id') ? (int) $b['project_id'] : $task['project_id'];
  if (has($b, 'project_id')) {
    if (!one('SELECT id FROM projects WHERE id = ?', $projectId) || !has_project_access($me, $projectId)) bad('Choose a project you can access.');
    $sets['project_id'] = $projectId; $changes[] = 'project';
  }
  $newAssignee = null;
  if (has($b, 'assignee_id')) { $x = check_person(opt_id($b['assignee_id']), $projectId, 'Assignee', 'assets.submit'); $sets['assignee_id'] = $x['id'] ?? null; $changes[] = 'assignee to ' . ($x['name'] ?? 'nobody'); $newAssignee = $x; }
  if (has($b, 'delivery_owner_id')) { $x = check_person(opt_id($b['delivery_owner_id']), $projectId, 'Delivery owner', 'delivery.record'); $sets['delivery_owner_id'] = $x['id'] ?? null; $changes[] = 'delivery owner to ' . ($x['name'] ?? 'nobody'); }
  if (has($b, 'recipient_id')) { $x = check_person(opt_id($b['recipient_id']), $projectId, 'Recipient'); $sets['recipient_id'] = $x['id'] ?? null; $changes[] = 'final recipient to ' . ($x['name'] ?? 'nobody'); }
  // creator_id is never writable.
  if (!$sets) bad('Nothing to update.');
  tx(function () use ($sets, $task, $me, $changes, $newAssignee) {
    $cols = implode(', ', array_map(fn ($k) => "$k = ?", array_keys($sets)));
    run("UPDATE tasks SET $cols, updated_at = ? WHERE id = ?", ...array_values($sets), ...[now(), $task['id']]);
    log_activity($task['id'], $me['id'], 'edited', 'Changed ' . implode(', ', $changes));
    if ($newAssignee) notify($newAssignee['id'], $task['id'], "{$me['name']} assigned you \"{$task['title']}\"", $me['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

route('PUT', '/tasks/:id/steps', function ($p) {
  $me = need('tasks.create');
  [$task] = require_view($me, $p['id']);
  if ($task['stage'] === 'in_review') bad('Approval steps are locked while a version is in review.');
  if ($task['stage'] === 'delivered') bad('Delivered tasks are closed.');
  $steps = check_steps(body()['steps'] ?? null, $task['project_id']);
  tx(function () use ($task, $steps, $me) {
    write_steps($task['id'], $steps);
    log_activity($task['id'], $me['id'], 'steps', $steps ? 'Set approval steps: ' . describe_steps($steps) : 'Removed all approval steps');
    touch_task($task['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

route('POST', '/tasks/:id/move', function ($p) {
  $me = auth();
  [$task, $steps] = require_view($me, $p['id']);
  $to = (string) (body()['stage'] ?? '');
  check_manual_move($me, $task, $steps, $to);
  if ($to !== $task['stage']) {
    tx(function () use ($task, $to, $me) {
      run('UPDATE tasks SET stage = ?, sort_order = ?, updated_at = ?, stage_entered_at = ? WHERE id = ?', $to, now_ms(), now(), now(), $task['id']);
      if (!in_array($to, ACTIVE_STAGES, true) && $task['blocked']) run('UPDATE tasks SET blocked = 0 WHERE id = ?', $task['id']);
      $reopened = $task['stage'] === 'ready_to_deliver' ? ' (reopened: a new version will need fresh approval)' : '';
      log_activity($task['id'], $me['id'], 'moved', 'Moved from ' . stage_label($task['stage']) . ' to ' . stage_label($to) . $reopened);
    });
    flush_changes();
  }
  json_out(task_detail($me, $task['id']));
});

route('POST', '/tasks/:id/block', function ($p) {
  $me = auth();
  [$task, $steps] = require_view($me, $p['id']);
  $a = allowed_actions($me, $task, $steps, current_submission($task['id']));
  if (!$a['block']) forbid($task['blocked'] ? 'This task is already blocked.' : (!in_array($task['stage'], ACTIVE_STAGES, true) ? 'Only active tasks can be blocked.' : 'You cannot block this task.'));
  $b = body();
  $reason = str($b['reason'] ?? '', 1000);
  if (!$reason) bad('Say why the task is blocked.');
  $resolver = check_person(opt_id($b['resolver_id'] ?? null), $task['project_id'], 'Person needed to unblock');
  if (!$resolver) bad('Choose the person needed to resolve the block.');
  tx(function () use ($task, $me, $reason, $resolver) {
    run('UPDATE tasks SET blocked = 1, blocked_reason = ?, blocked_resolver_id = ?, blocked_by_id = ?, blocked_at = ?, updated_at = ? WHERE id = ?', $reason, $resolver['id'], $me['id'], now(), now(), $task['id']);
    log_activity($task['id'], $me['id'], 'blocked', "Flagged as blocked, needs {$resolver['name']}: $reason");
    notify($resolver['id'], $task['id'], "{$me['name']} needs you to unblock \"{$task['title']}\": $reason", $me['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});
route('POST', '/tasks/:id/unblock', function ($p) {
  $me = auth();
  [$task, $steps] = require_view($me, $p['id']);
  if (!allowed_actions($me, $task, $steps, current_submission($task['id']))['unblock']) forbid('Only the person needed, the person who raised the block, or someone overseeing the team can clear it.');
  $note = str(body()['note'] ?? '', 1000);
  tx(function () use ($task, $me, $note) {
    run('UPDATE tasks SET blocked = 0, updated_at = ? WHERE id = ?', now(), $task['id']);
    log_activity($task['id'], $me['id'], 'unblocked', 'Cleared the block' . ($note ? ": $note" : ''));
    if ($task['blocked_by_id']) notify($task['blocked_by_id'], $task['id'], "{$me['name']} cleared the block on \"{$task['title']}\"", $me['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

// Submissions and reviews
route('POST', '/tasks/:id/submissions', function ($p) {
  $me = auth();
  [$task, $steps] = require_view($me, $p['id']);
  if (!can($me, 'assets.submit')) forbid('You need the "Add Drive links and submit versions" permission.');
  $inv = involvement($me, $task, $steps);
  if (empty($inv['assignee']) && !can($me, 'work.oversee')) forbid('Only the assignee can submit versions for this task.');
  if ($task['stage'] === 'delivered') bad('This task has been delivered. Create a follow-up task for new work.');
  if (!$steps) bad('Add at least one approval step before submitting for review.');
  $b = body();
  $drive = parse_drive_link($b['link'] ?? '');
  if (!$drive) bad('Paste a Google Drive file, folder, Docs, Sheets or Slides link (https://drive.google.com/... or https://docs.google.com/...).');
  $version = str($b['version'] ?? '', 40);
  if (!$version) bad('Add a version label, for example v2.');
  $deadline = is_date($b['review_deadline'] ?? null) ? $b['review_deadline'] : null;
  $subId = tx(function () use ($task, $steps, $me, $drive, $version, $deadline, $b) {
    $t = now();
    $previous = array_map('mb_strtolower', array_column(all('SELECT version FROM submissions WHERE task_id = ?', $task['id']), 'version'));
    if (in_array(mb_strtolower($version), $previous, true)) bad("Version \"$version\" was already submitted. Use a new label so every decision stays tied to the exact version reviewed.");
    // A new version supersedes any version still open, so it needs fresh approval.
    $hadApproved = (bool) one("SELECT 1 AS x FROM submissions WHERE task_id = ? AND status = 'approved'", $task['id']);
    run("UPDATE submissions SET status = 'superseded' WHERE task_id = ? AND status = 'in_review'", $task['id']);
    $id = run("INSERT INTO submissions (task_id, version, link, link_kind, drive_id, note, submitted_by, submitted_at, review_deadline, status, current_step)
      VALUES (?,?,?,?,?,?,?,?,?,'in_review',0)", $task['id'], $version, $drive['link'], $drive['kind'], $drive['drive_id'], str($b['note'] ?? '', 4000), $me['id'], $t, $deadline)['id'];
    run("UPDATE tasks SET stage = 'in_review', blocked = 0, updated_at = ?, stage_entered_at = ?, sort_order = ? WHERE id = ?", $t, $t, now_ms(), $task['id']);
    $first = $steps[0];
    $approver = get_user($first['approver_id']);
    log_activity($task['id'], $me['id'], 'submitted', "Submitted $version for review. Waiting for {$approver['name']} ({$first['label']})");
    if ($hadApproved) log_activity($task['id'], $me['id'], 'submitted', "$version replaces an approved version and needs fresh approval");
    notify($approver['id'], $task['id'], "{$me['name']} submitted $version of \"{$task['title']}\" for your approval", $me['id']);
    return $id;
  });
  flush_changes();
  // Optional Drive check runs after the response and never changes sharing.
  if (drive_integration()) {
    after_response(function () use ($drive, $subId) {
      [$status, $detail] = check_link_sharing($drive['drive_id']);
      run('UPDATE submissions SET access_check = ?, access_check_detail = ? WHERE id = ?', $status, $detail, $subId);
      flush_changes();
    });
  }
  json_out(task_detail($me, $task['id']), 201);
});

route('POST', '/submissions/:id/review', function ($p) {
  $me = auth();
  $found = one('SELECT task_id FROM submissions WHERE id = ?', (int) $p['id']);
  if (!$found) not_found('Submission not found.');
  [$task, $steps] = require_view($me, $found['task_id']);
  $b = body();
  $decision = (string) ($b['decision'] ?? '');
  $feedback = str($b['feedback'] ?? '', 4000);
  tx(function () use ($p, $task, $steps, $me, $decision, $feedback) {
    // Re-read inside the transaction so two reviewers cannot act on the same step at once.
    $sub = one('SELECT * FROM submissions WHERE id = ?', (int) $p['id']);
    $current = current_submission($task['id']);
    if (!$current || $current['id'] !== $sub['id'] || $sub['status'] !== 'in_review') bad('This version is no longer awaiting review. Decisions apply only to the current version.');
    $step = $steps[$sub['current_step']] ?? null;
    if (!$step || $step['approver_id'] !== $me['id']) forbid('Only ' . ($step ? get_user($step['approver_id'])['name'] : 'the assigned approver') . ' can review this step.');
    if (!can($me, 'review.approve')) forbid('You need the "Approve a review stage" permission.');
    if ($sub['access_issue']) bad('You reported you cannot open this file. Wait for the submitter to fix sharing first.');
    if (!in_array($decision, ['approved', 'changes_requested', 'cannot_access'], true)) bad('Choose Approve, Request changes or Cannot access file.');
    if ($decision !== 'approved' && !$feedback) bad($decision === 'cannot_access' ? 'Describe the access problem, for example the error Drive shows.' : 'Add feedback so the team knows what to change.');
    $t = now();
    run('INSERT INTO reviews (submission_id, step_position, step_label, reviewer_id, decision, feedback, created_at) VALUES (?,?,?,?,?,?,?)', $sub['id'], $step['position'], $step['label'], $me['id'], $decision, $feedback, $t);
    $submitter = get_user($sub['submitted_by']);
    if ($decision === 'approved') {
      $next = $steps[$sub['current_step'] + 1] ?? null;
      if ($next) {
        run('UPDATE submissions SET current_step = ? WHERE id = ?', $sub['current_step'] + 1, $sub['id']);
        touch_task($task['id']);
        $na = get_user($next['approver_id']);
        log_activity($task['id'], $me['id'], 'approved', "Approved {$sub['version']} ({$step['label']}). Waiting for {$na['name']} ({$next['label']})");
        notify($na['id'], $task['id'], "\"{$task['title']}\" {$sub['version']} is waiting for your approval ({$next['label']})", $me['id']);
        notify($submitter['id'], $task['id'], "{$me['name']} approved {$sub['version']} of \"{$task['title']}\". Now with {$na['name']}", $me['id']);
      } else {
        run("UPDATE submissions SET status = 'approved' WHERE id = ?", $sub['id']);
        run("UPDATE tasks SET stage = 'ready_to_deliver', sort_order = ?, updated_at = ?, stage_entered_at = ? WHERE id = ?", now_ms(), $t, $t, $task['id']);
        $owner = get_user($task['delivery_owner_id']);
        log_activity($task['id'], $me['id'], 'approved', "Approved {$sub['version']} ({$step['label']}). All approvals complete; ready to deliver" . ($owner ? ", handoff by {$owner['name']}" : ''));
        if ($owner) notify($owner['id'], $task['id'], "\"{$task['title']}\" {$sub['version']} is approved and ready for you to deliver", $me['id']);
        notify($submitter['id'], $task['id'], "{$me['name']} approved {$sub['version']} of \"{$task['title']}\"", $me['id']);
      }
    } elseif ($decision === 'changes_requested') {
      run("UPDATE submissions SET status = 'changes_requested' WHERE id = ?", $sub['id']);
      run("UPDATE tasks SET stage = 'changes_requested', sort_order = ?, updated_at = ?, stage_entered_at = ? WHERE id = ?", now_ms(), $t, $t, $task['id']);
      log_activity($task['id'], $me['id'], 'changes', "Requested changes on {$sub['version']} ({$step['label']}): $feedback");
      notify($task['assignee_id'] ?: $submitter['id'], $task['id'], "{$me['name']} requested changes on {$sub['version']} of \"{$task['title']}\"", $me['id']);
    } else {
      run('UPDATE submissions SET access_issue = 1 WHERE id = ?', $sub['id']);
      touch_task($task['id']);
      log_activity($task['id'], $me['id'], 'access', "Cannot open {$sub['version']} in Google Drive: $feedback");
      notify($submitter['id'], $task['id'], "{$me['name']} cannot open {$sub['version']} of \"{$task['title']}\" in Google Drive. Check the file's sharing.", $me['id']);
    }
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

route('POST', '/submissions/:id/access-restored', function ($p) {
  $me = auth();
  $sub = one('SELECT * FROM submissions WHERE id = ?', (int) $p['id']);
  if (!$sub) not_found('Submission not found.');
  [$task, $steps] = require_view($me, $sub['task_id']);
  $current = current_submission($task['id']);
  if (!allowed_actions($me, $task, $steps, $current)['fix_access'] || $current['id'] !== $sub['id']) forbid('Only the submitter can confirm sharing was fixed.');
  $note = str(body()['note'] ?? '', 1000);
  $step = $steps[$sub['current_step']];
  $approver = get_user($step['approver_id']);
  tx(function () use ($sub, $step, $me, $note, $task, $approver) {
    run('UPDATE submissions SET access_issue = 0 WHERE id = ?', $sub['id']);
    run('INSERT INTO reviews (submission_id, step_position, step_label, reviewer_id, decision, feedback, created_at) VALUES (?,?,?,?,?,?,?)', $sub['id'], $step['position'], $step['label'], $me['id'], 'access_restored', $note, now());
    log_activity($task['id'], $me['id'], 'access', "Updated Drive sharing for {$sub['version']}" . ($note ? ": $note" : '') . ". Back with {$approver['name']}");
    notify($step['approver_id'], $task['id'], "{$me['name']} updated sharing on {$sub['version']} of \"{$task['title']}\". Please try again.", $me['id']);
    touch_task($task['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

// Comments
route('POST', '/tasks/:id/comments', function ($p) {
  $me = need('comments.write');
  [$task, $steps] = require_view($me, $p['id']);
  $text = str(body()['body'] ?? '', 4000);
  if (!$text) bad('Write a comment first.');
  $na = next_action($task, $steps, current_submission($task['id']))['user_id'];
  tx(function () use ($task, $me, $text, $na) {
    run('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)', $task['id'], $me['id'], $text, now());
    foreach (array_unique(array_filter([$task['creator_id'], $task['assignee_id'], $na])) as $id) notify($id, $task['id'], "{$me['name']} commented on \"{$task['title']}\"", $me['id']);
    touch_task($task['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']), 201);
});

// Delivery
route('POST', '/tasks/:id/deliver', function ($p) {
  $me = auth();
  [$task] = require_view($me, $p['id']);
  if ($task['stage'] !== 'ready_to_deliver') bad('Only approved tasks that are Ready to Deliver can be delivered.');
  if ($task['delivery_owner_id'] !== $me['id']) forbid('Only the delivery owner can record delivery.');
  if (!can($me, 'delivery.record')) forbid('You need the "Record final delivery" permission.');
  if (!$task['recipient_id']) bad('Set the final recipient before recording delivery.');
  $sub = current_submission($task['id']);
  if (!$sub || $sub['status'] !== 'approved') bad('There is no fully approved version to deliver.');
  $b = body();
  $method = in_array($b['method'] ?? null, DELIVERY_METHODS, true) ? $b['method'] : null;
  if (!$method) bad('Choose how it was delivered.');
  $rcpt = get_user($task['recipient_id']);
  tx(function () use ($task, $sub, $me, $method, $b, $rcpt) {
    $t = now();
    if (one('SELECT stage FROM tasks WHERE id = ?', $task['id'])['stage'] !== 'ready_to_deliver') bad('This task is no longer Ready to Deliver.');
    // verified = 0: this is a manual record.
    run('INSERT INTO deliveries (task_id, submission_id, recipient_id, sender_id, method, note, verified, delivered_at) VALUES (?,?,?,?,?,?,0,?)',
      $task['id'], $sub['id'], $task['recipient_id'], $me['id'], $method, str($b['note'] ?? '', 2000), $t);
    run("UPDATE tasks SET stage = 'delivered', blocked = 0, sort_order = ?, updated_at = ?, stage_entered_at = ? WHERE id = ?", now_ms(), $t, $t, $task['id']);
    log_activity($task['id'], $me['id'], 'delivered', "Recorded manual delivery of {$sub['version']} to {$rcpt['name']} via $method");
    notify($rcpt['id'], $task['id'], "{$me['name']} delivered \"{$task['title']}\" ({$sub['version']}) to you", $me['id']);
    notify($task['creator_id'], $task['id'], "\"{$task['title']}\" was delivered to {$rcpt['name']}", $me['id']);
  });
  flush_changes();
  json_out(task_detail($me, $task['id']));
});

// Notifications
route('GET', '/notifications', function () {
  json_out(all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60', auth()['id']));
});
route('POST', '/notifications/read', function () {
  $me = auth();
  $b = body();
  if (!empty($b['all'])) run('UPDATE notifications SET read = 1 WHERE user_id = ?', $me['id']);
  elseif ((int) ($b['id'] ?? 0)) run('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?', $me['id'], (int) $b['id']);
  json_out(['ok' => true]);
});

// Status report (CSV), for people who oversee the team.
route('GET', '/reports/status.csv', function () {
  $me = need('work.oversee');
  $includeDelivered = ($_GET['delivered'] ?? '') === '1';
  $at = now_ms();
  $today = gmdate('Y-m-d');
  $order = array_flip(stage_keys());
  $tasks = array_values(array_filter(visible_tasks($me), fn ($t) => $t['view'] === 'full' && ($includeDelivered || $t['stage'] !== 'delivered')));
  usort($tasks, fn ($a, $b) => ($order[$a['stage']] <=> $order[$b['stage']]) ?: strcmp($a['due_date'] ?: '9999', $b['due_date'] ?: '9999'));
  $delivered = $includeDelivered ? array_column(all('SELECT task_id, MAX(delivered_at) AS at FROM deliveries GROUP BY task_id'), 'at', 'task_id') : [];
  $next = ['start' => 'Start work', 'work' => 'Make / finish the work', 'revise' => 'Make requested changes', 'approve' => 'Review and approve',
    'fix_access' => 'Fix Drive sharing', 'deliver' => 'Deliver to recipient', 'blocked' => 'Resolve blocker', 'done' => ''];
  $days = fn (?string $iso) => $iso ? max(0, intdiv($at - iso_ms($iso), 86400000)) : '';
  $cell = function ($v) {
    $t = $v === null ? '' : (string) $v;
    if (preg_match('/^[=+\-@\t\r]/', $t)) $t = "'$t"; // stop spreadsheet formula injection
    return preg_match('/[",\n]/', $t) ? '"' . str_replace('"', '""', $t) . '"' : $t;
  };
  $rows = [['Task', 'Title', 'Client', 'Project', 'Stage', 'In this stage since', 'Days in this stage', 'Waiting on', 'Next step',
    'Waiting since', 'Days waiting', 'Deadline', 'Deadline status', 'Blocked', 'Blocked reason', 'Priority', 'Assigned to', 'Approvers',
    'Current version', 'Delivery owner', 'Recipient', 'Created by', 'Created on', 'Delivered on']];
  foreach ($tasks as $t) {
    $done = $t['stage'] === 'delivered';
    if ($t['due_date']) {
      $diff = (int) round((strtotime($t['due_date'] . ' UTC') - strtotime("$today UTC")) / 86400);
      if ($done) $deadline = 'Delivered';
      elseif ($diff < 0) $deadline = 'Overdue by ' . -$diff . ' day' . ($diff === -1 ? '' : 's');
      elseif ($diff === 0) $deadline = 'Due today';
      else $deadline = "Due in $diff day" . ($diff === 1 ? '' : 's');
    } else $deadline = $done ? 'Delivered' : 'No deadline';
    $na = $t['next_action'] ?? [];
    $rows[] = [
      "DD-{$t['id']}", $t['title'], $t['client']['name'], $t['project']['name'], stage_label($t['stage']),
      substr($t['stage_entered_at'], 0, 10), $days($t['stage_entered_at']),
      $done ? '' : ($na['user']['name'] ?? 'Nobody assigned'), $done ? '' : ($next[$na['kind']] ?? '') . (!empty($na['step_label']) ? " ({$na['step_label']})" : ''),
      $done ? '' : substr($t['waiting_since'] ?? '', 0, 10), $done ? '' : $days($t['waiting_since'] ?? null),
      $t['due_date'] ?? '', $deadline, $t['blocked'] ? 'Yes' : 'No', $t['blocked']['reason'] ?? '', $t['priority'],
      $t['assignee']['name'] ?? '', implode('; ', array_map(fn ($s) => "{$s['label']}: " . ($s['approver']['name'] ?? '?'), $t['steps'] ?? [])),
      $t['current_submission']['version'] ?? '', $t['delivery_owner']['name'] ?? '', $t['recipient']['name'] ?? '', $t['creator']['name'] ?? '',
      substr($t['created_at'], 0, 10), substr($delivered[$t['id']] ?? '', 0, 10),
    ];
  }
  header('Content-Type: text/csv; charset=utf-8');
  header("Content-Disposition: attachment; filename=\"studio-status-$today.csv\"");
  header('Cache-Control: no-store');
  echo "\u{FEFF}" . implode("\r\n", array_map(fn ($r) => implode(',', array_map($cell, $r)), $rows)) . "\r\n";
});

// Saved folders (private to each person)
route('GET', '/saved', function () {
  $me = auth();
  $folders = all('SELECT id, name, created_at FROM saved_folders WHERE user_id = ? ORDER BY name COLLATE NOCASE', $me['id']);
  $items = all('SELECT * FROM saved_items WHERE user_id = ? ORDER BY created_at DESC, id DESC', $me['id']);
  $taskIds = array_values(array_unique(array_filter(array_column($items, 'task_id'))));
  $tasks = [];
  if ($taskIds) {
    $ctx = task_context($taskIds);
    foreach (all('SELECT * FROM tasks WHERE id IN (' . implode(',', array_map('intval', $taskIds)) . ')') as $t) {
      // Saving a card never widens access: it shows only while you can still see the task.
      $view = view_level($me, $t, $ctx['steps'][$t['id']] ?? []);
      if ($view) $tasks[$t['id']] = summarize($t, $ctx, $view);
    }
  }
  json_out(['folders' => array_map(fn ($f) => $f + ['items' => array_values(array_map(function ($i) use ($tasks) {
    $o = ['id' => $i['id'], 'kind' => $i['kind'], 'title' => $i['title'], 'note' => $i['note'], 'url' => $i['url'], 'created_at' => $i['created_at'], 'task_id' => $i['task_id']];
    if ($i['kind'] === 'task') $o['task'] = $tasks[$i['task_id']] ?? null;
    return $o;
  }, array_filter($items, fn ($i) => $i['folder_id'] === $f['id'])))], $folders)]);
});
route('POST', '/saved/folders', function () {
  $me = auth();
  $name = str(body()['name'] ?? '', 80);
  if (!$name) bad('Give the folder a name.');
  if (one('SELECT id FROM saved_folders WHERE user_id = ? AND name = ? COLLATE NOCASE', $me['id'], $name)) bad('You already have a folder with that name.');
  $r = run('INSERT INTO saved_folders (user_id, name, created_at) VALUES (?,?,?)', $me['id'], $name, now());
  json_out(['id' => $r['id'], 'name' => $name], 201);
});
route('PATCH', '/saved/folders/:id', function ($p) {
  $me = auth();
  $f = own_folder($me, $p['id']);
  $name = str(body()['name'] ?? '', 80);
  if (!$name) bad('Give the folder a name.');
  if (one('SELECT id FROM saved_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?', $me['id'], $name, $f['id'])) bad('You already have a folder with that name.');
  run('UPDATE saved_folders SET name = ? WHERE id = ?', $name, $f['id']);
  json_out(['ok' => true]);
});
route('DELETE', '/saved/folders/:id', function ($p) {
  $f = own_folder(auth(), $p['id']);
  tx(function () use ($f) {
    run('DELETE FROM saved_items WHERE folder_id = ?', $f['id']);
    run('DELETE FROM saved_folders WHERE id = ?', $f['id']);
  });
  json_out(['ok' => true]);
});
route('POST', '/saved/items', function () {
  $me = auth();
  $b = body();
  $f = own_folder($me, $b['folder_id'] ?? 0);
  $note = str($b['note'] ?? '', 1000);
  if (($b['kind'] ?? '') === 'task') {
    [$task] = require_view($me, $b['task_id'] ?? 0, 'any');
    if (one('SELECT id FROM saved_items WHERE folder_id = ? AND task_id = ?', $f['id'], $task['id'])) bad("This task is already in “{$f['name']}”.");
    $r = run("INSERT INTO saved_items (folder_id, user_id, kind, task_id, title, note, created_at) VALUES (?,?,'task',?,?,?,?)", $f['id'], $me['id'], $task['id'], $task['title'], $note, now());
    return json_out(['id' => $r['id']], 201);
  }
  if (($b['kind'] ?? '') === 'link') {
    $url = clean_url($b['url'] ?? '');
    $title = str($b['title'] ?? '', 200) ?: (string) parse_url($url, PHP_URL_HOST);
    $r = run("INSERT INTO saved_items (folder_id, user_id, kind, url, title, note, created_at) VALUES (?,?,'link',?,?,?,?)", $f['id'], $me['id'], $url, $title, $note, now());
    return json_out(['id' => $r['id']], 201);
  }
  bad('Choose a task or a link to save.');
});
route('PATCH', '/saved/items/:id', function ($p) {
  $me = auth();
  $i = own_item($me, $p['id']);
  $b = body();
  $folderId = has($b, 'folder_id') ? own_folder($me, $b['folder_id'])['id'] : $i['folder_id'];
  $title = has($b, 'title') ? (str($b['title'], 200) ?: $i['title']) : $i['title'];
  $note = has($b, 'note') ? str($b['note'], 1000) : $i['note'];
  $url = $i['kind'] === 'link' && has($b, 'url') ? clean_url($b['url']) : $i['url'];
  run('UPDATE saved_items SET folder_id = ?, title = ?, note = ?, url = ? WHERE id = ?', $folderId, $title, $note, $url, $i['id']);
  json_out(['ok' => true]);
});
route('DELETE', '/saved/items/:id', function ($p) {
  $i = own_item(auth(), $p['id']);
  run('DELETE FROM saved_items WHERE id = ?', $i['id']);
  json_out(['ok' => true]);
});

// Administration
route('DELETE', '/admin/roles/:key', function ($p) {
  need('users.manage');
  $key = $p['key'];
  if (in_array($key, role_keys(), true)) bad('Built-in roles cannot be deleted.');
  if (!one('SELECT key FROM roles WHERE key = ?', $key)) not_found('Role not found.');
  $n = (int) one('SELECT COUNT(*) AS n FROM users WHERE role = ?', $key)['n'];
  if ($n) bad("$n " . ($n === 1 ? 'person has' : 'people have') . ' this role. Give them another job title first.');
  run('DELETE FROM roles WHERE key = ?', $key);
  flush_changes();
  json_out(['ok' => true]);
});
route('GET', '/admin/users', function () {
  need('users.manage');
  json_out(array_map('admin_view', all('SELECT * FROM users ORDER BY is_demo, name')));
});
route('POST', '/admin/users', function () {
  $me = need('users.manage');
  $b = body();
  $name = str($b['name'] ?? '', 120);
  $email = mb_strtolower(str($b['email'] ?? '', 200));
  if (!$name) bad('Enter their name.');
  if (!valid_email($email)) bad('Enter a valid email address.');
  if (one('SELECT id FROM users WHERE email = ?', $email)) bad('Someone with that email already exists.');
  $role = is_string($b['role'] ?? null) && find_role($b['role']) ? $b['role'] : 'producer';
  $title = str($b['title'] ?? '', 80);
  // Same rule as before: any list (even an empty one) sets permissions explicitly.
  $explicit = is_array($b['permissions'] ?? null) || !empty($b['permissions']);
  $perms = $explicit ? sanitize_perms($b['permissions']) : find_role($role)['permissions'];
  $access = !has($b, 'project_access') ? 'all' : sanitize_access($b['project_access']);
  if ($title && $explicit) $role = save_role_from_title($title, $perms);
  $color = COLORS[(int) one('SELECT COUNT(*) AS n FROM users')['n'] % count(COLORS)];
  $id = run("INSERT INTO users (name, email, title, role, permissions, project_access, status, invite_token, invited_by, color, created_at)
    VALUES (?,?,?,?,?,?,'invited',?,?,?,?)", $name, $email, $title, $role, json_encode($perms), json_encode($access), token(24), $me['id'], $color, now())['id'];
  flush_changes();
  $row = one('SELECT * FROM users WHERE id = ?', $id);
  json_out(admin_view($row) + ['invite_email' => email_invite($row, $me)], 201);
});
route('PATCH', '/admin/users/:id', function ($p) {
  need('users.manage');
  $row = one('SELECT * FROM users WHERE id = ?', (int) $p['id']);
  if (!$row) not_found('Person not found.');
  $cur = row_to_user($row);
  $b = body();
  $next = $cur;
  if (has($b, 'name')) { $next['name'] = str($b['name'], 120); if (!$next['name']) bad('Name cannot be empty.'); }
  if (has($b, 'email')) {
    $next['email'] = mb_strtolower(str($b['email'], 200));
    if (!valid_email($next['email'])) bad('Enter a valid email address.');
    if (one('SELECT id FROM users WHERE email = ? AND id != ?', $next['email'], $cur['id'])) bad('Someone else already uses that email.');
  }
  if (has($b, 'title')) $next['title'] = str($b['title'], 80);
  if (has($b, 'role')) { if (!is_string($b['role']) || !find_role($b['role'])) bad('Unknown role.'); $next['role'] = $b['role']; }
  if (has($b, 'permissions')) $next['permissions'] = sanitize_perms($b['permissions']);
  if (has($b, 'project_access')) $next['project_access'] = sanitize_access($b['project_access']);
  if (has($b, 'status')) {
    if (!in_array($b['status'], ['active', 'deactivated'], true)) bad('Unknown status.');
    if ($b['status'] === 'active' && $cur['status'] === 'deactivated') $next['status'] = $row['password_hash'] ? 'active' : 'invited';
    if ($b['status'] === 'active' && $cur['status'] === 'pending') $next['status'] = 'active'; // approving a sign-up request
    if ($b['status'] === 'deactivated') $next['status'] = 'deactivated';
  }
  assert_admin_remains($cur['id'], $next);
  tx(function () use (&$next, $b, $cur) {
    if (has($b, 'title') && has($b, 'permissions') && $next['title']) $next['role'] = save_role_from_title($next['title'], $next['permissions']);
    run('UPDATE users SET name = ?, email = ?, title = ?, role = ?, permissions = ?, project_access = ?, status = ? WHERE id = ?',
      $next['name'], $next['email'], $next['title'], $next['role'], json_encode($next['permissions']), json_encode($next['project_access']), $next['status'], $cur['id']);
    if ($next['status'] === 'deactivated') run('DELETE FROM sessions WHERE user_id = ?', $cur['id']);
  });
  if ($cur['status'] === 'pending' && $next['status'] === 'active') {
    run('UPDATE users SET requested_at = NULL WHERE id = ?', $cur['id']);
    after_response(fn () => send_approved($next['email'], $next['name']));
  }
  flush_changes();
  json_out(admin_view(one('SELECT * FROM users WHERE id = ?', $cur['id'])));
});
// An administrator sets a new password for anyone. Invited people become active (they no
// longer need their invite link); everyone is signed out of their other sessions.
route('POST', '/admin/users/:id/password', function ($p) {
  $me = need('users.manage');
  $row = one('SELECT * FROM users WHERE id = ?', (int) $p['id']);
  if (!$row) not_found('Person not found.');
  if ($row['status'] === 'pending') bad('Approve this sign-up request first.');
  $pw = str(body()['password'] ?? '', 200);
  check_new_password($pw);
  tx(function () use ($row, $pw, $me) {
    set_password($row['id'], $pw, $row['id'] === $me['id'] ? ($_COOKIE[COOKIE] ?? null) : null);
    if ($row['status'] === 'invited') run("UPDATE users SET status = 'active', invite_token = NULL WHERE id = ?", $row['id']);
  });
  flush_changes();
  json_out(admin_view(one('SELECT * FROM users WHERE id = ?', $row['id'])));
});
// Declining a sign-up request removes it entirely.
route('POST', '/admin/users/:id/decline', function ($p) {
  need('users.manage');
  $row = one('SELECT * FROM users WHERE id = ?', (int) $p['id']);
  if (!$row || $row['status'] !== 'pending') bad('Only pending sign-up requests can be declined.');
  run('DELETE FROM users WHERE id = ?', $row['id']);
  flush_changes();
  json_out(['ok' => true]);
});

// Shared sign-up link
route('GET', '/admin/signup', function () { need('users.manage'); json_out(signup_view()); });
route('POST', '/admin/signup', function () {
  need('users.manage');
  $b = body();
  if (($b['enabled'] ?? null) === false) run("DELETE FROM settings WHERE key = 'signup_token'");
  elseif (!empty($b['regenerate']) || !signup_token()) set_setting('signup_token', token(18));
  json_out(signup_view());
});
route('GET', '/join/:token', function ($p) {
  if (!valid_signup($p['token'])) not_found('This sign-up link is not valid any more. Ask the studio for a new one.');
  json_out(['ok' => true, 'google' => google_enabled()]);
});
route('POST', '/join/:token', function ($p) {
  if (!valid_signup($p['token'])) not_found('This sign-up link is not valid any more. Ask the studio for a new one.');
  $key = 'join|' . client_ip();
  if (!attempts_ok($key, 10, 60 * 60000)) throw new HttpError(429, 'Too many sign-ups from this connection. Try again later.');
  $b = body();
  $name = str($b['name'] ?? '', 120);
  $email = mb_strtolower(str($b['email'] ?? '', 200));
  $title = str($b['title'] ?? '', 80);
  $pw = str($b['password'] ?? '', 200);
  if (!$name) bad('Enter your name.');
  if (!valid_email($email)) bad('Enter a valid email address.');
  if (!$title) bad('Enter your designation, for example Video Editor.');
  check_new_password($pw);
  $existing = one('SELECT status FROM users WHERE email = ?', $email);
  if ($existing) bad($existing['status'] === 'pending' ? 'You have already asked to join. An administrator will approve you soon.' : 'An account with this email already exists. Sign in instead.');
  attempts_add($key, 60 * 60000);
  $color = COLORS[(int) one('SELECT COUNT(*) AS n FROM users')['n'] % count(COLORS)];
  $id = run("INSERT INTO users (name, email, title, role, permissions, project_access, status, password_hash, color, created_at, requested_at)
    VALUES (?,?,?,'producer','[]','[]','pending',?,?,?,?)", $name, $email, $title, hash_password($pw), $color, now(), now())['id'];
  $person = ['name' => $name, 'email' => $email, 'title' => $title];
  foreach (all("SELECT * FROM users WHERE status = 'active'") as $r) {
    $ad = row_to_user($r);
    if (!in_array('users.manage', $ad['permissions'], true) || (!demo_mode() && $ad['is_demo'])) continue;
    notify($ad['id'], null, "$name ($title) asked to join. Review the request in Settings.");
    after_response(fn () => send_signup_notice($ad['email'], $ad['name'], $person));
  }
  flush_changes();
  json_out(['id' => $id, 'status' => 'pending'], 201);
});
route('POST', '/admin/users/:id/reinvite', function ($p) {
  $me = need('users.manage');
  $row = one('SELECT * FROM users WHERE id = ?', (int) $p['id']);
  if (!$row || $row['status'] !== 'invited') bad('Only pending invitations can be re-sent.');
  run('UPDATE users SET invite_token = ? WHERE id = ?', token(24), $row['id']);
  $fresh = one('SELECT * FROM users WHERE id = ?', $row['id']);
  json_out(admin_view($fresh) + ['invite_email' => (body()['email'] ?? null) === false ? ['status' => 'skipped'] : email_invite($fresh, $me)]);
});
route('POST', '/admin/users/:id/send-invite', function ($p) {
  $me = need('users.manage');
  $row = one('SELECT * FROM users WHERE id = ?', (int) $p['id']);
  if (!$row || $row['status'] !== 'invited') bad('Only pending invitations can be emailed.');
  if (!email_enabled()) bad('Email sending is not set up. Add EMAIL_FROM to api/config.php.');
  $email = email_invite($row, $me);
  if ($email['status'] !== 'sent') throw new HttpError(502, "The invitation email could not be sent: {$email['error']}");
  json_out(admin_view($row) + ['invite_email' => $email]);
});
route('GET', '/admin/projects', function () {
  need('users.manage');
  json_out([
    'clients' => all('SELECT * FROM clients ORDER BY name'),
    'projects' => all('SELECT p.*, c.name AS client_name, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name'),
  ]);
});
route('POST', '/admin/projects', function () {
  need('users.manage');
  $b = body();
  $name = str($b['name'] ?? '', 120);
  $clientName = str($b['client_name'] ?? '', 120);
  if (!$name || !$clientName) bad('Enter a client and a project name.');
  $id = tx(function () use ($name, $clientName) {
    $c = one('SELECT id FROM clients WHERE name = ? COLLATE NOCASE', $clientName);
    $cid = $c ? $c['id'] : run('INSERT INTO clients (name) VALUES (?)', $clientName)['id'];
    return run('INSERT INTO projects (name, client_id) VALUES (?,?)', $name, $cid)['id'];
  });
  flush_changes();
  json_out(['id' => $id], 201);
});
// Removes the fictional demo people and sample work, leaving real accounts alone.
route('POST', '/admin/demo/remove', function () {
  $me = need('users.manage');
  if ($me['is_demo']) bad('Sign in with a real administrator account to remove demo data. Demo accounts cannot remove themselves.');
  tx(function () {
    $demoTasks = 'SELECT id FROM tasks WHERE is_demo = 1';
    run("DELETE FROM reviews WHERE submission_id IN (SELECT id FROM submissions WHERE task_id IN ($demoTasks))");
    foreach (['deliveries', 'submissions', 'approval_steps', 'comments', 'activity', 'notifications', 'saved_items'] as $table) run("DELETE FROM $table WHERE task_id IN ($demoTasks)");
    run('DELETE FROM tasks WHERE is_demo = 1');
    foreach (all('SELECT id FROM users WHERE is_demo = 1') as $u) {
      $id = $u['id'];
      $used = one('SELECT 1 AS x FROM tasks WHERE creator_id = ? OR assignee_id = ? OR delivery_owner_id = ? OR recipient_id = ? OR blocked_resolver_id = ?
        UNION SELECT 1 FROM approval_steps WHERE approver_id = ? UNION SELECT 1 FROM submissions WHERE submitted_by = ?
        UNION SELECT 1 FROM comments WHERE author_id = ? UNION SELECT 1 FROM reviews WHERE reviewer_id = ? LIMIT 1', ...array_fill(0, 9, $id));
      if ($used) run("UPDATE users SET status = 'deactivated' WHERE id = ?", $id);
      else {
        foreach (['notifications', 'saved_items', 'saved_folders', 'sessions', 'password_resets'] as $t) run("DELETE FROM $t WHERE user_id = ?", $id);
        run('DELETE FROM activity WHERE actor_id = ?', $id);
        run('DELETE FROM users WHERE id = ?', $id);
      }
    }
    run('DELETE FROM projects WHERE is_demo = 1 AND id NOT IN (SELECT project_id FROM tasks)');
    run('DELETE FROM clients WHERE is_demo = 1 AND id NOT IN (SELECT client_id FROM projects)');
  });
  flush_changes();
  json_out(['ok' => true]);
});

// ---------- dispatch ----------
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = preg_replace('#^.*?/api(?=/|$)#', '', rawurldecode($path)) ?: '/';
$path = rtrim($path, '/') ?: '/';

try {
  // Mutating requests must come from our own front end (blocks cross-site form posts).
  if ($method !== 'GET' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'dd-studio') forbid('Missing request header.');
  if ($path !== '/health') boot();
  $matched = false;
  foreach ($routes as [$m, $re, $fn]) {
    if ($m === $method && preg_match($re, $path, $mm)) {
      $matched = true;
      $fn(array_filter($mm, 'is_string', ARRAY_FILTER_USE_KEY));
      break;
    }
  }
  if (!$matched) not_found('Not found.');
} catch (HttpError $e) {
  if (db()->inTransaction()) db()->exec('ROLLBACK');
  json_out(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
  if (db()->inTransaction()) db()->exec('ROLLBACK');
  error_log((string) $e);
  json_out(['error' => 'Something went wrong on the server.'], 500);
}
run_after_response();
