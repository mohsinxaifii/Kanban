import { useMemo, useState } from 'react';
import { api, weekBucket, taskKey, first } from '../api.js';
import { useApp, Avatar, StatusLine, Due, StatusMenu } from '../components/ui.jsx';
import { Icon, StageIcon, PriorityIcon } from '../components/icons.jsx';

export function useMove() {
  const { toast, reloadTasks } = useApp();
  return async (task, stage) => {
    try {
      await api(`/tasks/${task.id}/move`, { method: 'POST', body: { stage } });
      await reloadTasks();
    } catch (e) { toast(e.message, 'err'); }
  };
}

export function TaskCard({ task, selected, draggable, onDragStart, onDragEnd, dragging, thumbs }) {
  const { openTask, meta } = useApp();
  const move = useMove();
  return (
    <div className={`card ${task.blocked ? 'is-blocked' : ''} ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onClick={() => openTask(task.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openTask(task.id); }}
      aria-label={`${task.title}, ${meta.stages.find((s) => s.key === task.stage)?.label}`}>
      <div className="card-top">
        <span className="key">{taskKey(task)}</span>
        {task.priority && <PriorityIcon priority={task.priority} size={13} />}
        {task.current_submission && <span title={`Current version ${task.current_submission.version}`}>· {task.current_submission.version}</span>}
        {task.is_demo && <span className="tag-demo" title="Sample work for the demo">Sample</span>}
        {task.view === 'full' && (
          <span className="menu-btn" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <StatusMenu task={task} onMove={(s) => move(task, s)} align="right">
              {({ toggle, open }) => <button className="icon-btn" aria-label={`Change status of ${task.title}`} aria-expanded={open} onClick={toggle}><Icon.more /></button>}
            </StatusMenu>
          </span>
        )}
      </div>
      {thumbs && task.current_submission?.thumbnail_url && (
        <img className="thumb" src={task.current_submission.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      )}
      <div className="card-title">{task.title}</div>
      <div className="card-client">{task.client.name} · {task.project.name}</div>
      <StatusLine task={task} compact />
      <div className="card-foot">
        <Avatar user={task.creator} size="xs" />
        <span className="grow">Created by {first(task.creator)}</span>
        <Due date={task.due_date} stage={task.stage} />
      </div>
    </div>
  );
}

const WEEKS = [['overdue', 'Overdue'], ['this', 'This week'], ['next', 'Next week'], ['later', 'Later'], ['none', 'No deadline']];

export function Board() {
  const { tasks, meta, people } = useApp();
  const move = useMove();
  const [f, setF] = useState({ client: '', project: '', week: '', creator: '', approver: '', owner: '', priority: '', blocked: false, q: '', hideSample: false });
  const [thumbs, setThumbs] = useState(false);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const clients = useMemo(() => [...new Map(tasks.map((t) => [t.client.id, t.client])).values()], [tasks]);
  const projects = meta.projects.filter((p) => !f.client || p.client_id === Number(f.client));
  const filtered = tasks.filter((t) => {
    if (f.client && t.client.id !== Number(f.client)) return false;
    if (f.project && t.project.id !== Number(f.project)) return false;
    if (f.week && weekBucket(t.due_date) !== f.week) return false;
    if (f.creator && t.creator?.id !== Number(f.creator)) return false;
    if (f.approver && !(t.steps || []).some((s) => s.approver_id === Number(f.approver))) return false;
    if (f.owner && t.next_action?.user?.id !== Number(f.owner)) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.blocked && !t.blocked) return false;
    if (f.hideSample && t.is_demo) return false;
    if (f.q && !`${t.title} ${t.client.name} ${t.project.name} ${taskKey(t)}`.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
  const active = Object.entries(f).filter(([k, v]) => v && k !== 'q').length;
  const sel = (k, label, opts) => (
    <select className={`filter ${f[k] ? 'on' : ''}`} value={f[k]} onChange={set(k)} aria-label={label}>
      <option value="">{label}</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  const peopleOpts = people.map((p) => [p.id, p.name]);
  const canDrop = (stage) => drag && meta.manualTargets.includes(stage) && drag.stage !== 'in_review' && drag.stage !== 'delivered';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="filters" role="search">
        <input className="search" placeholder="Search tasks" value={f.q} onChange={set('q')} aria-label="Search tasks" />
        {sel('client', 'Client', clients.map((c) => [c.id, c.name]))}
        {sel('project', 'Project', projects.map((p) => [p.id, p.name]))}
        {sel('week', 'Week', WEEKS)}
        {sel('creator', 'Creator', peopleOpts)}
        {sel('approver', 'Approver', peopleOpts)}
        {sel('owner', 'Action owner', peopleOpts)}
        {sel('priority', 'Priority', [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']])}
        <label className={`toggle ${f.blocked ? 'on' : ''}`}><input type="checkbox" checked={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.checked })} /> Blocked only</label>
        <label className={`toggle ${f.hideSample ? 'on' : ''}`} style={f.hideSample ? { borderColor: 'var(--ink)', color: 'var(--text)', background: '#f7f7f8' } : undefined}><input type="checkbox" checked={f.hideSample} onChange={(e) => setF({ ...f, hideSample: e.target.checked })} /> Hide sample work</label>
        <label className={`toggle ${thumbs ? 'on' : ''}`} style={thumbs ? { borderColor: 'var(--ink)', color: 'var(--text)', background: '#f7f7f8' } : undefined} title="Small Drive thumbnails load with your own Google account"><input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} /> Thumbnails</label>
        {active > 0 && <button className="btn ghost sm" onClick={() => setF({ client: '', project: '', week: '', creator: '', approver: '', owner: '', priority: '', blocked: false, q: '', hideSample: false })}>Clear filters</button>}
        <span style={{ flex: 1 }} />
        <span className="hint">{filtered.length} of {tasks.length} tasks</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowX: 'auto' }}>
        <div className="board">
          {meta.stages.map((s) => {
            const items = filtered.filter((t) => t.stage === s.key);
            const locked = !meta.manualTargets.includes(s.key);
            const cls = drag ? (canDrop(s.key) ? (over === s.key ? 'drop-ok' : '') : (s.key !== drag.stage ? 'drop-no' : '')) : '';
            return (
              <section key={s.key} className={`column ${cls}`} aria-label={`${s.label}, ${items.length} tasks`}
                onDragOver={(e) => { if (canDrop(s.key)) { e.preventDefault(); setOver(s.key); } }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); if (drag && drag.stage !== s.key) move(drag, s.key); setDrag(null); }}>
                <div className="column-head">
                  <StageIcon stage={s.key} /> {s.label} <span className="n">{items.length}</span>
                  {locked && <span className="lock" title={lockHelp[s.key]}><Icon.lock width={11} height={11} />{lockShort[s.key]}</span>}
                </div>
                <div className="column-body">
                  {items.map((t) => (
                    <TaskCard key={t.id} task={t} thumbs={thumbs} draggable={t.view === 'full'} dragging={drag?.id === t.id}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag(t); }} onDragEnd={() => { setDrag(null); setOver(null); }} />
                  ))}
                  {!items.length && <div className="empty-col">{drag && locked ? lockHelp[s.key] : 'No tasks'}</div>}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const lockShort = { in_review: 'Via submit', changes_requested: 'Via review', ready_to_deliver: 'Via approval', delivered: 'Via delivery' };
const lockHelp = {
  in_review: 'Cards enter In Review only when a version is submitted.',
  changes_requested: 'Only the assigned reviewer can request changes.',
  ready_to_deliver: 'Cards become Ready to Deliver when every approval step approves the current version.',
  delivered: 'Cards are Delivered when the delivery owner records the delivery.',
};
