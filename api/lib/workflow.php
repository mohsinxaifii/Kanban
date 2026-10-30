<?php
// Permissions, roles, stages and the visibility / ownership rules. Every route goes
// through these, so the rules are enforced on the server whatever the interface shows.

const PERMISSIONS = [
  ['key' => 'tasks.create', 'label' => 'Create and assign tasks', 'help' => 'Create tasks, set the assignee, approvers, delivery owner and recipient.'],
  ['key' => 'tasks.edit', 'label' => 'Edit briefs and deadlines', 'help' => 'Change the brief, priority and due dates of tasks they can see.'],
  ['key' => 'assets.submit', 'label' => 'Add Drive links and submit versions', 'help' => 'Submit a new asset version for review on tasks assigned to them.'],
  ['key' => 'comments.write', 'label' => 'Comment and request changes', 'help' => 'Post comments. Requesting changes still requires being the assigned reviewer.'],
  ['key' => 'review.approve', 'label' => 'Approve a review stage', 'help' => 'Can be named as an approver. They only approve the steps they are assigned to on each task.'],
  ['key' => 'workflow.move', 'label' => 'Move tasks through permitted stages', 'help' => 'Move tasks between Backlog, Planned and In Progress. Review and delivery stages are reached only through submissions, approvals and delivery records.'],
  ['key' => 'delivery.record', 'label' => 'Record final delivery', 'help' => 'Record delivery on tasks where they are the delivery owner.'],
  ['key' => 'work.oversee', 'label' => 'See all team work', 'help' => 'See every task in the projects they can access, not only work they are involved in, and export the status report.'],
  ['key' => 'users.manage', 'label' => 'Manage users and permissions', 'help' => 'Invite, update and deactivate people, set their passwords, change roles, permissions and project access, and manage projects.'],
];
function permission_keys(): array { return array_column(PERMISSIONS, 'key'); }
function permission_label(string $k): string { foreach (PERMISSIONS as $p) if ($p['key'] === $k) return $p['label']; return $k; }

const ROLES = [
  ['key' => 'admin', 'label' => 'Administrator', 'permissions' => ['tasks.create', 'tasks.edit', 'comments.write', 'workflow.move', 'work.oversee', 'users.manage']],
  ['key' => 'creative_head', 'label' => 'Creative Head', 'permissions' => ['tasks.create', 'tasks.edit', 'comments.write', 'review.approve', 'workflow.move', 'work.oversee']],
  // Approval is deliberately off: account managers approve only when explicitly authorised.
  ['key' => 'account_manager', 'label' => 'Account Manager', 'permissions' => ['tasks.create', 'tasks.edit', 'comments.write', 'workflow.move', 'delivery.record']],
  ['key' => 'producer', 'label' => 'Editor / Designer', 'permissions' => ['assets.submit', 'comments.write', 'workflow.move']],
  ['key' => 'recipient', 'label' => 'Recipient', 'permissions' => []],
];
function role_keys(): array { return array_column(ROLES, 'key'); }
function role_defaults(string $role): array { foreach (ROLES as $r) if ($r['key'] === $role) return $r['permissions']; return []; }

const STAGES = [
  ['key' => 'backlog', 'label' => 'Backlog'],
  ['key' => 'planned', 'label' => 'Planned'],
  ['key' => 'in_progress', 'label' => 'In Progress'],
  ['key' => 'in_review', 'label' => 'In Review'],
  ['key' => 'changes_requested', 'label' => 'Changes Requested'],
  ['key' => 'ready_to_deliver', 'label' => 'Ready to Deliver'],
  ['key' => 'delivered', 'label' => 'Delivered'],
];
function stage_keys(): array { return array_column(STAGES, 'key'); }
function stage_label(string $k): string { foreach (STAGES as $s) if ($s['key'] === $k) return $s['label']; return $k; }
// Blocked is a flag, not a column, and may be raised in any active stage.
const ACTIVE_STAGES = ['planned', 'in_progress', 'in_review', 'changes_requested', 'ready_to_deliver'];
// Stages a person may move a card into by hand (drag or status menu).
const MANUAL_TARGETS = ['backlog', 'planned', 'in_progress'];

function can(array $user, string $perm): bool { return $user['status'] === 'active' && in_array($perm, $user['permissions'], true); }

function has_project_access(array $user, $projectId): bool {
  if ($user['project_access'] === 'all') return true;
  return is_array($user['project_access']) && in_array((int) $projectId, array_map('intval', $user['project_access']), true);
}

function load_steps(int $taskId): array { return all('SELECT * FROM approval_steps WHERE task_id = ? ORDER BY position', $taskId); }
// The submission that currently drives the workflow (latest non-superseded).
function current_submission(int $taskId): ?array {
  return one("SELECT * FROM submissions WHERE task_id = ? AND status != 'superseded' ORDER BY id DESC LIMIT 1", $taskId);
}

// How a user relates to a task. Used for both visibility and authority.
function involvement(array $user, array $task, array $steps): array {
  $id = $user['id'];
  $r = [];
  if ($task['creator_id'] === $id) $r['creator'] = true;
  if ($task['assignee_id'] === $id) $r['assignee'] = true;
  if ($task['delivery_owner_id'] === $id) $r['delivery_owner'] = true;
  if ($task['recipient_id'] === $id) $r['recipient'] = true;
  if ($task['blocked'] && $task['blocked_resolver_id'] === $id) $r['resolver'] = true;
  foreach ($steps as $s) if ($s['approver_id'] === $id) $r['approver'] = true;
  return $r;
}

// 'full' | 'deliverable' | null
function view_level(array $user, array $task, array $steps): ?string {
  if ($user['status'] !== 'active') return null;
  if (!has_project_access($user, $task['project_id'])) return null;
  if (can($user, 'work.oversee')) return 'full';
  $inv = involvement($user, $task, $steps);
  foreach (['creator', 'assignee', 'delivery_owner', 'approver', 'resolver'] as $k) if (!empty($inv[$k])) return 'full';
  // Recipients see only what has been delivered to them.
  if (!empty($inv['recipient']) && $task['stage'] === 'delivered') return 'deliverable';
  return null;
}

function require_view(array $user, $taskId, string $level = 'full'): array {
  $task = one('SELECT * FROM tasks WHERE id = ?', (int) $taskId);
  if (!$task) not_found('Task not found.');
  $steps = load_steps($task['id']);
  $v = view_level($user, $task, $steps);
  if (!$v) not_found('Task not found.'); // do not reveal existence
  if ($level === 'full' && $v !== 'full') forbid('You only have access to the delivered files for this task.');
  return [$task, $steps, $v];
}

// Who must act next, and why. Shown on every card.
function next_action(array $task, array $steps, ?array $sub): array {
  $owner = $task['assignee_id'] ?: $task['creator_id'];
  if ($task['stage'] === 'delivered') return ['user_id' => null, 'kind' => 'done'];
  if ($task['blocked']) return ['user_id' => $task['blocked_resolver_id'], 'kind' => 'blocked'];
  if ($task['stage'] === 'in_review' && $sub && $sub['status'] === 'in_review') {
    if ($sub['access_issue']) return ['user_id' => $sub['submitted_by'], 'kind' => 'fix_access'];
    $step = $steps[$sub['current_step']] ?? null;
    return ['user_id' => $step['approver_id'] ?? null, 'kind' => 'approve', 'step_label' => $step['label'] ?? null, 'step_position' => $sub['current_step']];
  }
  if ($task['stage'] === 'ready_to_deliver') return ['user_id' => $task['delivery_owner_id'], 'kind' => 'deliver'];
  if ($task['stage'] === 'changes_requested') return ['user_id' => $owner, 'kind' => 'revise'];
  if ($task['stage'] === 'backlog' || $task['stage'] === 'planned') return ['user_id' => $owner, 'kind' => 'start'];
  return ['user_id' => $owner, 'kind' => 'work'];
}

// Validate a manual move. Review, approval and delivery stages are reached only
// through their own actions, so dragging cannot skip an approval.
function check_manual_move(array $user, array $task, array $steps, string $to): void {
  if (!in_array($to, stage_keys(), true)) bad('Unknown stage.');
  if ($to === $task['stage']) return;
  if (!can($user, 'workflow.move')) forbid('You do not have permission to move tasks.');
  $inv = involvement($user, $task, $steps);
  if (!can($user, 'work.oversee') && empty($inv['assignee']) && empty($inv['creator'])) {
    forbid('Only the assignee, the creator or someone overseeing the team can move this task.');
  }
  if ($task['stage'] === 'delivered') bad('Delivered tasks are closed. Create a follow-up task instead.');
  if ($task['stage'] === 'in_review') bad('This task is in review. It moves on when the assigned reviewer approves or requests changes.');
  if ($to === 'in_review') bad('Submit a version for review to move this task into In Review.');
  if ($to === 'changes_requested') bad('Only the assigned reviewer can request changes.');
  if ($to === 'ready_to_deliver') bad('A task becomes Ready to Deliver only when every approval step has approved the current version.');
  if ($to === 'delivered') bad('Record the delivery to mark this task Delivered.');
  if (!in_array($to, MANUAL_TARGETS, true)) bad('That move is not allowed.');
}
