import { useState } from 'react';
import { api } from '../api.js';
import { useApp, Modal } from '../components/ui.jsx';
import { PersonPicker, REQ } from '../components/PersonPicker.jsx';
import { Icon } from '../components/icons.jsx';

// Ordered approval chain, e.g. Creative Head → Account Manager. Only configured steps apply.
export function StepsEditor({ steps, onChange, projectId }) {
  const update = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {steps.map((s, i) => (
        <div key={i} className="row" style={{ alignItems: 'center' }}>
          <span className="step"><span className="n">{i + 1}</span></span>
          <input className="input" style={{ width: 170 }} value={s.label} onChange={(e) => update(i, { label: e.target.value })} aria-label={`Step ${i + 1} name`} placeholder="Step name" />
          <div style={{ flex: 1 }}>
            <PersonPicker value={s.approver_id} onChange={(id) => update(i, { approver_id: id })} label={`Step ${i + 1} approver`} placeholder="Choose approver" requirement={REQ.approve} projectId={projectId} allowClear={false} />
          </div>
          <button type="button" className="icon-btn" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((_, j) => j !== i))}><Icon.close /></button>
        </div>
      ))}
      <div className="row">
        <button type="button" className="btn sm" onClick={() => onChange([...steps, { label: steps.length ? 'Account Manager' : 'Creative Head', approver_id: null }])}><Icon.plus /> Add approval step</button>
        <span className="hint">Only people authorised to approve can be chosen. Approval authority applies to this task only.</span>
      </div>
    </div>
  );
}

export function NewTask({ onClose, onCreated }) {
  const { meta, me, toast, reloadTasks } = useApp();
  const [t, setT] = useState({
    title: '', project_id: meta.projects[0]?.id || '', brief: '', priority: 'medium', due_date: '', stage: 'planned',
    assignee_id: null, delivery_owner_id: me.permissions.includes('delivery.record') ? me.id : null, recipient_id: null,
    steps: [{ label: 'Creative Head', approver_id: null }],
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setT({ ...t, [k]: v?.target ? v.target.value : v });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const steps = t.steps.filter((s) => s.approver_id);
      const created = await api('/tasks', { method: 'POST', body: { ...t, steps } });
      await reloadTasks();
      toast(`Created “${created.title}”`);
      onCreated(created);
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal title="New task" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" form="new-task" type="submit" disabled={busy || !t.title || !t.project_id}>Create task</button>
    </>}>
      <form id="new-task" className="stack" onSubmit={submit}>
        <input className="title-input" placeholder="Task title" value={t.title} onChange={set('title')} autoFocus aria-label="Task title" required />
        <div className="grid2">
          <div className="field"><label htmlFor="nt-project">Client · project</label>
            <select id="nt-project" className="select" value={t.project_id} onChange={set('project_id')} required>
              {meta.projects.map((p) => <option key={p.id} value={p.id}>{p.client_name} · {p.name}{p.is_demo ? ' (sample)' : ''}</option>)}
            </select>
          </div>
          <div className="grid2">
            <div className="field"><label htmlFor="nt-due">Deadline</label><input id="nt-due" type="date" className="input" value={t.due_date} onChange={set('due_date')} /></div>
            <div className="field"><label htmlFor="nt-pri">Priority</label>
              <select id="nt-pri" className="select" value={t.priority} onChange={set('priority')}>
                <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          </div>
        </div>
        <div className="field"><label htmlFor="nt-brief">Brief</label><textarea id="nt-brief" className="textarea" rows={5} value={t.brief} onChange={set('brief')} placeholder="What are we making, for whom, and what does good look like?" /></div>
        <div className="grid2">
          <div className="field"><span className="label">Assigned to</span><PersonPicker value={t.assignee_id} onChange={set('assignee_id')} label="Assigned to" requirement={REQ.submit} projectId={t.project_id} /></div>
          <div className="field"><span className="label">Delivery owner</span><PersonPicker value={t.delivery_owner_id} onChange={set('delivery_owner_id')} label="Delivery owner" requirement={REQ.deliver} projectId={t.project_id} /></div>
          <div className="field"><span className="label">Final recipient</span><PersonPicker value={t.recipient_id} onChange={set('recipient_id')} label="Final recipient" projectId={t.project_id} /></div>
          <div className="field"><label htmlFor="nt-stage">Start in</label>
            <select id="nt-stage" className="select" value={t.stage} onChange={set('stage')}>
              <option value="backlog">Backlog</option><option value="planned">Planned</option><option value="in_progress">In Progress</option>
            </select>
          </div>
        </div>
        <div className="field"><span className="label">Approval steps</span>
          <StepsEditor steps={t.steps} onChange={set('steps')} projectId={t.project_id} />
        </div>
        <div className="hint">You will be recorded as the creator. That never changes, even when the task moves into review.</div>
      </form>
    </Modal>
  );
}
