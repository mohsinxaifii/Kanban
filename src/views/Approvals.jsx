import { useState } from 'react';
import { useApp, Person } from '../components/ui.jsx';
import { ago, fmtDate, todayISO, taskKey } from '../api.js';

// Most urgent first: overdue review deadlines, then nearest deadline, then longest waiting.
function urgency(t) {
  const d = t.current_submission?.review_deadline || t.due_date;
  const overdue = d && d < todayISO() ? 0 : 1;
  return [overdue, d || '9999-12-31', t.waiting_since];
}
const cmp = (a, b) => {
  const x = urgency(a); const y = urgency(b);
  for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; }
  return 0;
};

export function Approvals() {
  const { tasks, me, can, openTask } = useApp();
  const [scope, setScope] = useState('mine');
  const pending = tasks.filter((t) => t.stage === 'in_review' && t.current_submission?.status === 'in_review');
  const mine = pending.filter((t) => t.next_action?.user?.id === me.id);
  const rows = (scope === 'mine' ? mine : pending).slice().sort(cmp);

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={`tab ${scope === 'mine' ? 'on' : ''}`} onClick={() => setScope('mine')}>Waiting for me ({mine.length})</button>
          {can('work.oversee') && <button className={`tab ${scope === 'all' ? 'on' : ''}`} onClick={() => setScope('all')}>All pending reviews ({pending.length})</button>}
        </div>
      </div>
      <div className="list">
        <table className="table">
          <thead><tr><th>Task</th><th>Version</th><th>Step</th><th>Reviewer</th><th>Submitted by</th><th>Waiting</th><th>Review deadline</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const sub = t.current_submission;
              const d = sub.review_deadline;
              const overdue = d && d < todayISO();
              return (
                <tr key={t.id} className="click" onClick={() => openTask(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}>
                  <td><div style={{ fontWeight: 550 }}>{t.title} {t.is_demo && <span className="tag-demo">Sample</span>}</div><div className="hint">{taskKey(t)} · {t.client.name}</div></td>
                  <td><b>{sub.version}</b>{sub.access_issue && <div><span className="chip blocked">Cannot access file</span></div>}</td>
                  <td>{t.next_action?.step_label || '—'}{t.steps?.length > 1 && <div className="hint">Step {(t.next_action?.step_position ?? 0) + 1} of {t.steps.length}</div>}</td>
                  <td><Person user={sub.access_issue ? t.steps.find((s) => s.state === 'current')?.approver : t.next_action?.user} /></td>
                  <td><Person user={sub.submitted_by} /></td>
                  <td>{ago(t.waiting_since)}</td>
                  <td>{d ? <span className={overdue ? 'chip blocked' : d === todayISO() ? 'chip waiting' : ''}>{overdue ? 'Overdue · ' : ''}{fmtDate(d)}</span> : <span className="hint">None</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="list-empty">{scope === 'mine' ? 'No submissions are waiting for your approval.' : 'No reviews are pending.'}</div>}
      </div>
    </div>
  );
}
