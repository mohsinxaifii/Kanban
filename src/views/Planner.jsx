import { useState } from 'react';
import { useApp, Person, Due } from '../components/ui.jsx';
import { StageIcon } from '../components/icons.jsx';
import { weekBucket, startOfWeek, fmtDate, statusLine } from '../api.js';

const DAY = 864e5;

export function Planner() {
  const { tasks, people, openTask } = useApp();
  const [showDone, setShowDone] = useState(false);
  const [by, setBy] = useState('assignee');
  const w0 = startOfWeek();
  const cols = [
    { key: 'overdue', label: 'Overdue', sub: 'Past deadline' },
    { key: 'this', label: 'This week', sub: `${fmtDate(w0.toISOString())} – ${fmtDate(new Date(w0.getTime() + 6 * DAY).toISOString())}` },
    { key: 'next', label: 'Next week', sub: `${fmtDate(new Date(w0.getTime() + 7 * DAY).toISOString())} – ${fmtDate(new Date(w0.getTime() + 13 * DAY).toISOString())}` },
    { key: 'later', label: 'Future weeks', sub: `From ${fmtDate(new Date(w0.getTime() + 14 * DAY).toISOString())}` },
    { key: 'none', label: 'No deadline', sub: '' },
  ];
  const list = tasks.filter((t) => t.view === 'full' && (showDone || t.stage !== 'delivered'));
  const personOf = (t) => (by === 'assignee' ? t.assignee : t.next_action?.user);
  const rowIds = [...new Set(list.map((t) => personOf(t)?.id ?? 0))];
  const rows = rowIds.map((id) => people.find((p) => p.id === id) || null)
    .sort((a, b) => (a ? a.name : 'zzz').localeCompare(b ? b.name : 'zzz'));

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="hint">Group by</span>
        <select className="filter on" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Group by">
          <option value="assignee">Assigned person</option>
          <option value="owner">Current action owner</option>
        </select>
        <label className="toggle"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show delivered</label>
      </div>
      <div className="planner" style={{ gridTemplateColumns: `180px repeat(${cols.length}, minmax(180px, 1fr))` }}>
        <div className="planner-cell planner-head">Person</div>
        {cols.map((c) => <div key={c.key} className="planner-cell planner-head">{c.label}<div className="sub">{c.sub}</div></div>)}
        {rows.map((p) => {
          const theirs = list.filter((t) => (personOf(t)?.id ?? 0) === (p?.id ?? 0));
          return [
            <div key={`p${p?.id ?? 0}`} className="planner-cell planner-person">
              <Person user={p} empty="Unassigned" />
              <span className="hint">{theirs.length} task{theirs.length === 1 ? '' : 's'}</span>
            </div>,
            ...cols.map((c) => (
              <div key={`${p?.id ?? 0}-${c.key}`} className="planner-cell">
                {theirs.filter((t) => weekBucket(t.due_date) === c.key).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).map((t) => (
                  <div key={t.id} className={`mini ${t.blocked ? 'is-blocked' : ''}`} role="button" tabIndex={0} onClick={() => openTask(t.id)} onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}>
                    <div className="t">{t.title}</div>
                    <div className="m"><StageIcon stage={t.stage} size={11} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{statusLine(t).text}</span></div>
                    <div className="m"><span style={{ flex: 1 }}>{t.client.name}</span><Due date={t.due_date} stage={t.stage} /></div>
                  </div>
                ))}
              </div>
            )),
          ];
        })}
      </div>
      {!rows.length && <p className="hint">No scheduled work.</p>}
      <p className="hint" style={{ marginTop: 10 }}>Weeks run Monday to Sunday and are based on each task's deadline.</p>
    </div>
  );
}
