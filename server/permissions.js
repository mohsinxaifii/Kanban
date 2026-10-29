// Permission keys. A permission is a capability; it never grants authority over a
// task on its own. Approving, for example, also requires being the task's assigned
// approver for the current step (see workflow.js).
export const PERMISSIONS = [
  { key: 'tasks.create', label: 'Create and assign tasks', help: 'Create tasks, set the assignee, approvers, delivery owner and recipient.' },
  { key: 'tasks.edit', label: 'Edit briefs and deadlines', help: 'Change the brief, priority and due dates of tasks they can see.' },
  { key: 'assets.submit', label: 'Add Drive links and submit versions', help: 'Submit a new asset version for review on tasks assigned to them.' },
  { key: 'comments.write', label: 'Comment and request changes', help: 'Post comments. Requesting changes still requires being the assigned reviewer.' },
  { key: 'review.approve', label: 'Approve a review stage', help: 'Can be named as an approver. They only approve the steps they are assigned to on each task.' },
  { key: 'workflow.move', label: 'Move tasks through permitted stages', help: 'Move tasks between Backlog, Planned and In Progress. Review and delivery stages are reached only through submissions, approvals and delivery records.' },
  { key: 'delivery.record', label: 'Record final delivery', help: 'Record delivery on tasks where they are the delivery owner.' },
  { key: 'work.oversee', label: 'See all team work', help: 'See every task in the projects they can access, not only work they are involved in, and export the status report.' },
  { key: 'users.manage', label: 'Manage users and permissions', help: 'Invite, update and deactivate people, change roles, permissions and project access, and manage projects.' },
];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

export const ROLES = [
  {
    key: 'admin', label: 'Administrator',
    permissions: ['tasks.create', 'tasks.edit', 'comments.write', 'workflow.move', 'work.oversee', 'users.manage'],
  },
  {
    key: 'creative_head', label: 'Creative Head',
    permissions: ['tasks.create', 'tasks.edit', 'comments.write', 'review.approve', 'workflow.move', 'work.oversee'],
  },
  {
    key: 'account_manager', label: 'Account Manager',
    // Approval is deliberately off: account managers approve only when explicitly authorised.
    permissions: ['tasks.create', 'tasks.edit', 'comments.write', 'workflow.move', 'delivery.record'],
  },
  {
    key: 'producer', label: 'Editor / Designer',
    permissions: ['assets.submit', 'comments.write', 'workflow.move'],
  },
  {
    key: 'recipient', label: 'Recipient',
    permissions: [],
  },
];
export const ROLE_KEYS = ROLES.map((r) => r.key);
export const roleDefaults = (role) => [...(ROLES.find((r) => r.key === role)?.permissions || [])];
