import { useEffect, useLayoutEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from './ui.jsx';

// First-run walkthrough. Each step points at an element marked data-tour="…";
// steps whose element is not on screen (for example on a phone) are skipped.
function buildSteps(me, can) {
  const first = me.name.split(' ')[0];
  return [
    { title: `Welcome to the studio, ${first}`, body: 'This is where Design Dimensions plans, reviews and delivers creative work. This short tour shows where everything is. It takes about a minute.' },
    can('tasks.create') && { target: 'new-task', title: 'Start a task', body: 'Create a task with a brief, a deadline and the people involved: who makes it, who approves it, who delivers it and who receives it. You can set an approval chain, for example Creative Head then Account Manager.' },
    { target: 'my-work', title: 'My Work', body: 'Everything waiting on you, in one list: things to make, files to fix, reviews to give and deliveries to send. Start your day here.' },
    { target: 'approvals', title: 'Approvals', body: 'Work waiting for your decision. Open the file in Google Drive, then Approve, Request changes, or say you Cannot access the file. Each decision is tied to the exact version you saw.' },
    { target: 'board', title: 'Team Board', body: 'Every task by stage, from Backlog to Delivered. Each card says who has to act next. Drag cards between the early stages; review and delivery stages are reached by submitting, approving and recording delivery, so approval can never be skipped.' },
    { target: 'planner', title: 'Weekly Planner', body: 'See what each person has this week, next week and later, so nobody is overloaded and deadlines are visible.' },
    { target: 'saved', title: 'Saved', body: 'Your own folders for tasks and useful links, such as briefs, references or brand guides. Save a task from its panel with the Save button. Only you can see your folders.' },
    can('users.manage') && { target: 'team', title: 'Team Settings', body: 'Invite people, choose their role, permissions and project access, and deactivate anyone who leaves. Each invitation gives you a link to send to the person.' },
    { target: 'notifications', title: 'Notifications', body: 'You are told when something needs you: a file to review, changes requested, or a task handed to you. The board also updates live as teammates work.' },
    { target: 'help', title: 'Need this again?', body: 'Replay the tour any time from here. You can switch between light and dark mode just above.' },
  ].filter(Boolean);
}

export function Tour({ onDone }) {
  const { me, can } = useApp();
  const steps = buildSteps(me, can);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[i];

  // Skip steps whose element is hidden.
  const visible = (s) => {
    if (!s.target) return true;
    const el = document.querySelector(`[data-tour="${s.target}"]`);
    return !!el && el.getClientRects().length > 0 && el.offsetParent !== null;
  };
  const move = (dir) => {
    let n = i + dir;
    while (n >= 0 && n < steps.length && !visible(steps[n])) n += dir;
    if (n >= steps.length) return finish();
    if (n >= 0) setI(n);
  };
  async function finish() {
    try { await api('/me/tour', { method: 'POST', body: { done: true } }); } catch { /* still close */ }
    onDone();
  }

  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target && document.querySelector(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [i, step.target]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') move(1);
      if (e.key === 'ArrowLeft') move(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const pad = 4;
  const bubble = rect
    ? { top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 260)), left: Math.min(rect.right + 16, window.innerWidth - 352) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const shown = steps.filter(visible);
  const pos = shown.indexOf(step);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
        : <div className="tour-dim" />}
      <div className={`tour-card ${rect ? 'pointed' : ''}`} style={bubble}>
        <div className="tour-step">{pos + 1} of {shown.length}</div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-foot">
          <button className="btn ghost sm" onClick={finish}>Skip tour</button>
          <span style={{ flex: 1 }} />
          {pos > 0 && <button className="btn sm" onClick={() => move(-1)}>Back</button>}
          <button className="btn primary sm" autoFocus onClick={() => move(1)}>{pos === shown.length - 1 ? 'Get started' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
