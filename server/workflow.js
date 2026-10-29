// Visibility, ownership and stage rules. Every route goes through these, so the
// rules are enforced on the server whatever the interface shows.
import { all, one } from './db.js';

export const STAGES = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'in_review', label: 'In Review' },
  { key: 'changes_requested', label: 'Changes Requested' },
  { key: 'ready_to_deliver', label: 'Ready to Deliver' },
  { key: 'delivered', label: 'Delivered' },
];
export const STAGE_KEYS = STAGES.map((s) => s.key);
export const stageLabel = (k) => STAGES.find((s) => s.key === k)?.label || k;
// Blocked is a flag, not a column, and may be raised in any active stage.
export const ACTIVE_STAGES = ['planned', 'in_progress', 'in_review', 'changes_requested', 'ready_to_deliver'];
// Stages a person may move a card into by hand (drag or status menu).
export const MANUAL_TARGETS = ['backlog', 'planned', 'in_progress'];

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const forbid = (msg) => { throw new HttpError(403, msg); };
export const bad = (msg) => { throw new HttpError(400, msg); };

export const can = (user, perm) => user.status === 'active' && user.permissions.includes(perm);

export function hasProjectAccess(user, projectId) {
  if (user.project_access === 'all') return true;
  return Array.isArray(user.project_access) && user.project_access.includes(Number(projectId));
}

export function loadSteps(taskId) {
  return all('SELECT * FROM approval_steps WHERE task_id = ? ORDER BY position', taskId);
}
// The submission that currently drives the workflow (latest non-superseded).
export function currentSubmission(taskId) {
  return one(`SELECT * FROM submissions WHERE task_id = ? AND status != 'superseded'
              ORDER BY id DESC LIMIT 1`, taskId) || null;
}

// How a user relates to a task. Used for both visibility and authority.
export function involvement(user, task, steps) {
  const r = new Set();
  if (task.creator_id === user.id) r.add('creator');
  if (task.assignee_id === user.id) r.add('assignee');
  if (task.delivery_owner_id === user.id) r.add('delivery_owner');
  if (task.recipient_id === user.id) r.add('recipient');
  if (task.blocked && task.blocked_resolver_id === user.id) r.add('resolver');
  if (steps.some((s) => s.approver_id === user.id)) r.add('approver');
  return r;
}

// 'full' | 'deliverable' | null
export function viewLevel(user, task, steps) {
  if (user.status !== 'active') return null;
  if (!hasProjectAccess(user, task.project_id)) return null;
  if (can(user, 'work.oversee')) return 'full';
  const inv = involvement(user, task, steps);
  if (['creator', 'assignee', 'delivery_owner', 'approver', 'resolver'].some((k) => inv.has(k))) return 'full';
  // Recipients see only what has been delivered to them.
  if (inv.has('recipient') && task.stage === 'delivered') return 'deliverable';
  return null;
}

export function requireView(user, taskId, level = 'full') {
  const task = one('SELECT * FROM tasks WHERE id = ?', Number(taskId));
  if (!task) throw new HttpError(404, 'Task not found.');
  const steps = loadSteps(task.id);
  const v = viewLevel(user, task, steps);
  if (!v) throw new HttpError(404, 'Task not found.'); // do not reveal existence
  if (level === 'full' && v !== 'full') forbid('You only have access to the delivered files for this task.');
  return { task, steps, view: v };
}

// Who must act next, and why. Shown on every card.
export function nextAction(task, steps, sub) {
  if (task.stage === 'delivered') return { user_id: null, kind: 'done' };
  if (task.blocked) return { user_id: task.blocked_resolver_id, kind: 'blocked' };
  if (task.stage === 'in_review' && sub && sub.status === 'in_review') {
    if (sub.access_issue) return { user_id: sub.submitted_by, kind: 'fix_access' };
    const step = steps[sub.current_step];
    return { user_id: step?.approver_id ?? null, kind: 'approve', step_label: step?.label, step_position: sub.current_step };
  }
  if (task.stage === 'ready_to_deliver') return { user_id: task.delivery_owner_id, kind: 'deliver' };
  if (task.stage === 'changes_requested') return { user_id: task.assignee_id || task.creator_id, kind: 'revise' };
  if (task.stage === 'backlog' || task.stage === 'planned') return { user_id: task.assignee_id || task.creator_id, kind: 'start' };
  return { user_id: task.assignee_id || task.creator_id, kind: 'work' };
}

// Validate a manual move. Review, approval and delivery stages are reached only
// through their own actions, so dragging cannot skip an approval.
export function checkManualMove(user, task, steps, to) {
  if (!STAGE_KEYS.includes(to)) bad('Unknown stage.');
  if (to === task.stage) return;
  if (!can(user, 'workflow.move')) forbid('You do not have permission to move tasks.');
  const inv = involvement(user, task, steps);
  if (!can(user, 'work.oversee') && !inv.has('assignee') && !inv.has('creator')) {
    forbid('Only the assignee, the creator or someone overseeing the team can move this task.');
  }
  if (task.stage === 'delivered') bad('Delivered tasks are closed. Create a follow-up task instead.');
  if (task.stage === 'in_review') bad('This task is in review. It moves on when the assigned reviewer approves or requests changes.');
  if (to === 'in_review') bad('Submit a version for review to move this task into In Review.');
  if (to === 'changes_requested') bad('Only the assigned reviewer can request changes.');
  if (to === 'ready_to_deliver') bad('A task becomes Ready to Deliver only when every approval step has approved the current version.');
  if (to === 'delivered') bad('Record the delivery to mark this task Delivered.');
  if (!MANUAL_TARGETS.includes(to)) bad('That move is not allowed.');
}
