import { useEffect, useState } from 'react';
import { useApp, Avatar, StatusLine, Due } from '../components/ui.jsx';
import { StageIcon } from '../components/icons.jsx';
import { taskKey, first } from '../api.js';

export function TaskRow({ task }) {
  const { openTask } = useApp();
  return (
    <div className="list-row" role="button" tabIndex={0} onClick={() => openTask(task.id)} onKeyDown={(e) => e.key === 'Enter' && openTask(task.id)}>
      <StageIcon stage={task.stage} />
      <span className="hint">{taskKey(task)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t">{task.title} {task.is_demo && <span className="tag-demo">Sample</span>}</div>
        <div className="c">{task.client.name} · {task.project.name}</div>
      </div>
      <StatusLine task={task} compact />
      <span className="person" style={{ fontSize: 12, color: 'var(--muted)' }}><Avatar user={task.creator} size="xs" /><span>by {first(task.creator)}</span></span>
      <Due date={task.due_date} stage={task.stage} />
    </div>
  );
}

// Counts up from 0 on first show, then eases to new values.
function CountUp({ value }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return undefined; }
    let raf; const start = performance.now(); const from = n;
    const step = (t) => {
      const p = Math.min(1, (t - start) / 700);
      setN(Math.round(from + (value - from) * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}

// The single most urgent thing, so there is always one obvious place to start.
function NextUp({ task }) {
  const { openTask } = useApp();
  return (
    <button className="next-up" onClick={() => openTask(task.id)}>
      <span className="eyebrow">Start here</span>
      <span className="next-up-title">{task.title}</span>
      <span className="next-up-meta"><StatusLine task={task} compact /><Due date={task.due_date} stage={task.stage} /></span>
    </button>
  );
}

function Section({ title, items, empty, hint }) {
  return (
    <>
      <h2>{title} <span className="n">{items.length}</span></h2>
      {hint && <p className="lede">{hint}</p>}
      <div className="list">
        {items.map((t) => <TaskRow key={t.id} task={t} />)}
        {!items.length && <div className="list-empty">{empty}</div>}
      </div>
    </>
  );
}

const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999');

export function MyWork() {
  const { tasks, me, can } = useApp();
  const mine = (t) => t.next_action?.user?.id === me.id;
  const open = tasks.filter((t) => t.stage !== 'delivered');
  const approvals = open.filter((t) => mine(t) && t.next_action.kind === 'approve').sort(byDue);
  const actions = open.filter((t) => mine(t) && t.next_action.kind !== 'approve').sort(byDue);
  const created = tasks.filter((t) => t.creator?.id === me.id).sort(byDue);
  const involved = (t) => [t.creator?.id, t.assignee?.id, t.delivery_owner?.id].includes(me.id) || (t.steps || []).some((s) => s.approver_id === me.id);
  const waiting = open.filter((t) => involved(t) && !mine(t)).sort(byDue);
  const deliveredToMe = tasks.filter((t) => t.stage === 'delivered' && t.recipient?.id === me.id);

  const today = new Date().toISOString().slice(0, 10);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const minePlus = [...approvals, ...actions];
  const overdue = minePlus.filter((t) => t.due_date && t.due_date < today).length;
  const dueWeek = minePlus.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekEnd).length;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const next = minePlus.slice().sort(byDue)[0];
  return (
    <div className="page">
      <header className="hero">
        <div>
          <h2 className="hero-title">{hello}, {me.name.split(' ')[0]}.</h2>
          <p className="lede">{minePlus.length ? `${minePlus.length} ${minePlus.length === 1 ? 'thing needs' : 'things need'} you today.` : 'You’re all caught up. Nice.'}</p>
        </div>
        <div className="stats">
          <div className={`stat ${minePlus.length ? 'hot' : ''}`}><b><CountUp value={minePlus.length} /></b><span>Your turn</span></div>
          <div className="stat"><b><CountUp value={approvals.length} /></b><span>To approve</span></div>
          <div className={`stat ${overdue ? 'bad' : ''}`}><b><CountUp value={overdue} /></b><span>Overdue</span></div>
          <div className="stat"><b><CountUp value={dueWeek} /></b><span>Due in 7 days</span></div>
        </div>
      </header>
      {next && <NextUp task={next} />}
      {me.role === 'recipient' && <Section title="Delivered to me" items={deliveredToMe} empty="Nothing has been delivered to you yet." />}
      {(can('review.approve') || approvals.length > 0) && <Section title="Approvals waiting for me" items={approvals} empty="No submissions are waiting for your approval." />}
      {(me.role !== 'recipient' || actions.length > 0) && <Section title="Needs my action" items={actions} empty="Nothing needs your action right now." />}
      {(me.role !== 'recipient' || waiting.length > 0) && <Section title="Waiting on others" items={waiting} empty="Nothing you are involved in is waiting on someone else." hint="Work you created, own or approve where someone else must act next." />}
      {(can('tasks.create') || created.length > 0) && <Section title="Work I created" items={created} empty="You have not created any tasks." />}
      {me.role !== 'recipient' && deliveredToMe.length > 0 && <Section title="Delivered to me" items={deliveredToMe} empty="" />}
    </div>
  );
}
