import { useEffect, useState } from 'react';
import { api, fmtDate, fmtDateTime, ago, taskKey, first, statusLine, todayISO } from '../api.js';
import { useApp, Avatar, Person, StatusLine, Due, StatusMenu, Modal, Notice } from '../components/ui.jsx';
import { PersonPicker, REQ } from '../components/PersonPicker.jsx';
import { StepsEditor } from './NewTask.jsx';
import { Icon, StageIcon, PriorityIcon } from '../components/icons.jsx';

const SUB_STATUS = {
  in_review: ['waiting', 'In review'],
  approved: ['ok', 'Approved'],
  changes_requested: ['changes', 'Changes requested'],
  superseded: ['neutral', 'Superseded by a newer version'],
};
const DECISION = {
  approved: ['ok', 'Approved'],
  changes_requested: ['changes', 'Requested changes'],
  cannot_access: ['blocked', 'Cannot access file'],
  access_restored: ['neutral', 'Sharing updated'],
};
const ACCESS_CHECK = {
  not_checked: ['neutral', 'Access not verified'],
  link_shared: ['ok', 'Link-shared (anyone with the link)'],
  restricted: ['waiting', 'Restricted in Drive'],
  error: ['neutral', 'Access check failed'],
};

export function TaskPanel({ id, onClose }) {
  const { version, toast, reloadTasks } = useApp();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api(`/tasks/${id}`).then((t) => { if (live) { setTask(t); setError(''); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [id, version]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal-wrap, .pop')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Every mutation returns the fresh task detail.
  const act = async (path, body, okMsg) => {
    try {
      const t = await api(path, { method: 'POST', body });
      setTask(t); reloadTasks();
      if (okMsg) toast(okMsg);
      return true;
    } catch (e) { toast(e.message, 'err'); return false; }
  };
  const patch = async (body) => {
    try { const t = await api(`/tasks/${id}`, { method: 'PATCH', body }); setTask(t); reloadTasks(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={task ? task.title : 'Task'}>
        {!task && <div className="panel-head"><span className="grow">{error || 'Loading…'}</span><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.close /></button></div>}
        {task && (task.view === 'deliverable'
          ? <DeliverableView task={task} onClose={onClose} />
          : <FullView task={task} act={act} patch={patch} onClose={onClose} setTask={setTask} />)}
      </aside>
    </>
  );
}

function PanelHead({ task, onClose, children }) {
  return (
    <div className="panel-head">
      <span className="key">{taskKey(task)}</span>
      {task.is_demo && <span className="tag-demo" title="Sample work for the demo">Sample</span>}
      {children}
      <span style={{ flex: 1 }} />
      <button className="icon-btn" onClick={onClose} aria-label="Close panel"><Icon.close /></button>
    </div>
  );
}

function DeliverableView({ task, onClose }) {
  return (
    <>
      <PanelHead task={task} onClose={onClose}><span className="chip done"><StageIcon stage="delivered" size={11} /> Delivered</span></PanelHead>
      <div className="panel-main" style={{ maxWidth: 760 }}>
        <div><div className="title-input" style={{ fontSize: 20 }}>{task.title}</div><div className="meta-line">{task.client.name} · {task.project.name}</div></div>
        <Notice tone="info">You can see this task because it was delivered to you. Internal drafts, comments and reviews are not shared with recipients.</Notice>
        {task.deliveries.map((d) => <DeliveryRecord key={d.id} d={d} />)}
      </div>
    </>
  );
}

function FullView({ task, act, patch, onClose, setTask }) {
  const { me } = useApp();
  const a = task.allowed;
  const sub = task.submissions.find((s) => s.status !== 'superseded') || null;
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);

  return (
    <>
      <PanelHead task={task} onClose={onClose}>
        <StatusMenu task={task} allowedTargets={a.move_to} onMove={(s) => act(`/tasks/${task.id}/move`, { stage: s })}>
          {({ toggle, open }) => (
            <button className="btn sm" onClick={toggle} aria-expanded={open} aria-label={`Status: ${stageName(task.stage)}. Change status`}>
              <StageIcon stage={task.stage} /> {stageName(task.stage)}
            </button>
          )}
        </StatusMenu>
        {task.blocked && <span className="chip blocked"><Icon.flag /> Blocked</span>}
      </PanelHead>
      <div className="panel-body">
        <div className="panel-main">
          <div>
            {a.edit
              ? <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== task.title && patch({ title })} aria-label="Title" />
              : <div className="title-input">{task.title}</div>}
            <div className="meta-line">
              <span>{task.client.name} · {task.project.name}</span><span>·</span>
              <span className="person"><Avatar user={task.creator} size="xs" /> Created by {first(task.creator)} on {fmtDate(task.created_at)}</span>
            </div>
          </div>

          <ActionBanner task={task} sub={sub} me={me} />
          {a.review && sub && <ReviewBox task={task} sub={sub} act={act} />}
          {a.fix_access && sub && <FixAccessBox sub={sub} act={act} />}
          {a.deliver && sub && <DeliverBox task={task} sub={sub} act={act} />}

          <Brief task={task} patch={patch} />
          {a.submit && <SubmitBox task={task} act={act} />}
          <Versions task={task} />
          {task.deliveries.length > 0 && (
            <section><h3 className="section-title">Delivery</h3>{task.deliveries.map((d) => <DeliveryRecord key={d.id} d={d} />)}</section>
          )}
          <Discussion task={task} act={act} />
        </div>
        <Sidebar task={task} patch={patch} act={act} setTask={setTask} />
      </div>
    </>
  );
}

const stageName = (k) => ({ backlog: 'Backlog', planned: 'Planned', in_progress: 'In Progress', in_review: 'In Review', changes_requested: 'Changes Requested', ready_to_deliver: 'Ready to Deliver', delivered: 'Delivered' }[k]);

const MINE = {
  approve: (t, sub) => `Your approval is needed on ${sub?.version}`,
  blocked: () => 'You are needed to unblock this task',
  fix_access: () => 'Your turn: fix Google Drive sharing',
  deliver: (t) => `Your turn: deliver to ${t.recipient ? first(t.recipient) : 'the recipient'} and record it`,
  revise: () => 'Your turn: revise and submit a new version',
  start: () => 'Your turn: start work',
  work: () => 'Your turn: produce and submit for review',
};

function ActionBanner({ task, sub, me }) {
  const na = task.next_action;
  const mine = na.user?.id === me.id;
  const s = statusLine(task);
  let detail = '';
  if (na.kind === 'approve') detail = `${na.step_label} review of ${sub?.version}${task.steps.length > 1 ? `, step ${na.step_position + 1} of ${task.steps.length}` : ''}. Submitted by ${sub?.submitted_by?.name} ${ago(sub?.submitted_at)} ago.`;
  if (na.kind === 'blocked') detail = `${task.blocked.reason} Raised by ${task.blocked.by?.name}.`;
  if (na.kind === 'revise') detail = 'The reviewer requested changes. Submit a new version when ready; it will need fresh approval.';
  if (na.kind === 'fix_access') detail = 'The reviewer cannot open the Drive file. Update sharing in Google Drive, then confirm below.';
  if (na.kind === 'deliver') detail = `${sub?.version} is fully approved. Approval does not mean delivered: the delivery owner sends it and records the handoff.`;
  if (na.kind === 'done') detail = task.deliveries.length ? `${task.deliveries.at(-1).version} delivered ${fmtDateTime(task.deliveries.at(-1).delivered_at)}.` : '';
  if (na.kind === 'start' || na.kind === 'work') detail = task.assignee ? `${task.assignee.name} is producing this. Submit a Drive link for review when a version is ready.` : 'No one is assigned yet.';
  return (
    <div className={`action-banner ${na.kind === 'blocked' || na.kind === 'fix_access' ? 'blocked' : mine ? 'mine' : ''}`}>
      {na.user ? <Avatar user={na.user} size="lg" /> : <StageIcon stage={task.stage} size={22} />}
      <div style={{ flex: 1 }}>
        <div className="big">{mine ? (MINE[na.kind]?.(task, sub) ?? s.text) : s.text}</div>
        {detail && <div className="hint" style={{ marginTop: 2 }}>{detail}</div>}
      </div>
      <Due date={task.due_date} stage={task.stage} />
    </div>
  );
}

function Brief({ task, patch }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.brief);
  useEffect(() => setText(task.brief), [task.brief]);
  return (
    <section>
      <h3 className="section-title">Brief <span className="grow" />{task.allowed.edit && !editing && <button className="btn ghost sm" onClick={() => setEditing(true)}>Edit</button>}</h3>
      {editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <textarea className="textarea" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Brief" autoFocus />
          <div className="row"><button className="btn primary sm" onClick={async () => { await patch({ brief: text }); setEditing(false); }}>Save brief</button><button className="btn ghost sm" onClick={() => { setText(task.brief); setEditing(false); }}>Cancel</button></div>
        </div>
      ) : <div className="brief">{task.brief || <span className="hint">No brief yet.</span>}</div>}
    </section>
  );
}

function SubmitBox({ task, act }) {
  const { me } = useApp();
  const count = task.submissions.length;
  const [open, setOpen] = useState(task.assignee?.id === me.id && ['planned', 'in_progress', 'changes_requested', 'backlog'].includes(task.stage));
  const [f, setF] = useState({ link: '', version: `v${count + 1}`, note: '', review_deadline: '' });
  useEffect(() => setF((x) => ({ ...x, version: `v${count + 1}` })), [count]);
  const first = task.steps[0];
  const replacing = task.stage === 'in_review' || task.stage === 'ready_to_deliver';
  if (!open) return <div><button className="btn" onClick={() => setOpen(true)}><Icon.drive /> {replacing ? 'Submit a new version' : 'Add Drive link and submit for review'}</button></div>;
  return (
    <section className="box">
      <h3 className="section-title"><Icon.drive width={14} height={14} /> Submit a version for review</h3>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await act(`/tasks/${task.id}/submissions`, f, `Submitted ${f.version} for review`)) { setOpen(false); setF({ link: '', version: '', note: '', review_deadline: '' }); } }}>
        <div className="field"><label htmlFor="sb-link">Google Drive file or folder link</label>
          <input id="sb-link" className="input" type="url" placeholder="https://drive.google.com/file/d/…" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} required /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="sb-v">Version label</label><input id="sb-v" className="input" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} required /></div>
          <div className="field"><label htmlFor="sb-d">Review deadline</label><input id="sb-d" className="input" type="date" min={todayISO()} value={f.review_deadline} onChange={(e) => setF({ ...f, review_deadline: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="sb-n">Submission note</label><textarea id="sb-n" className="textarea" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What changed, what to look at" /></div>
        <Notice>
          <b>Drive sharing is separate from this app.</b> Assigning {first ? first.approver?.name : 'a reviewer'} here does not give them access to the file.
          Make sure the file is shared with them in Google Drive. This app does not change sharing or make files public{' '}
          and has not checked whether they can open it. Reviewers can report “Cannot access file” if they can’t.
        </Notice>
        {replacing && <Notice tone="info">This replaces the version currently {task.stage === 'in_review' ? 'in review' : 'approved'}. The new version needs fresh approval from every step.</Notice>}
        <div className="row"><button className="btn primary" type="submit"><Icon.send /> Submit for review</button><button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <span className="hint">Goes to {first?.approver?.name} ({first?.label}) first.</span></div>
      </form>
    </section>
  );
}

function ReviewBox({ task, sub, act }) {
  const [mode, setMode] = useState(null);
  const [feedback, setFeedback] = useState('');
  const step = task.steps[sub.current_step];
  const send = async (decision) => {
    const ok = await act(`/submissions/${sub.id}/review`, { decision, feedback }, decision === 'approved' ? `Approved ${sub.version}` : decision === 'changes_requested' ? 'Changes requested' : 'Access problem reported');
    if (ok) { setMode(null); setFeedback(''); }
  };
  return (
    <section className="box" style={{ borderColor: 'var(--ink)' }}>
      <h3 className="section-title">Your review · {step?.label} · {sub.version}</h3>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        <a className="btn" href={sub.link} target="_blank" rel="noreferrer noopener"><Icon.external /> Open in Google Drive</a>
        <span className="hint">You are reviewing <b>{sub.version}</b> exactly. Your decision is recorded against this version only.</span>
      </div>
      {sub.note && <div className="brief" style={{ marginBottom: 10 }}><span className="hint">Note from {first(sub.submitted_by)}: </span>{sub.note}</div>}
      {!mode && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn approve" onClick={() => send('approved')}>Approve {sub.version}</button>
          <button className="btn" onClick={() => setMode('changes_requested')}>Request changes</button>
          <button className="btn danger" onClick={() => setMode('cannot_access')}>Cannot access file</button>
        </div>
      )}
      {mode && (
        <div className="stack" style={{ gap: 8 }}>
          <label className="label" htmlFor="rv-fb">{mode === 'changes_requested' ? 'What needs to change? (required)' : 'What happens when you open the link? (required)'}</label>
          <textarea id="rv-fb" className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} autoFocus
            placeholder={mode === 'changes_requested' ? 'Be specific: timecodes, layers, copy…' : 'For example: “Drive says I need access”'} />
          <div className="row">
            <button className={`btn ${mode === 'changes_requested' ? 'primary' : 'danger'}`} disabled={!feedback.trim()} onClick={() => send(mode)}>{mode === 'changes_requested' ? 'Send change request' : 'Report access problem'}</button>
            <button className="btn ghost" onClick={() => { setMode(null); setFeedback(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function FixAccessBox({ sub, act }) {
  const [note, setNote] = useState('');
  const last = [...sub.reviews].reverse().find((r) => r.decision === 'cannot_access');
  return (
    <section className="box" style={{ borderColor: 'var(--blocked-border)', background: 'var(--blocked-bg)' }}>
      <h3 className="section-title">{last?.reviewer?.name} cannot open {sub.version}</h3>
      {last && <div className="brief" style={{ marginBottom: 8 }}>“{last.feedback}”</div>}
      <div className="hint" style={{ marginBottom: 8 }}>Share the file with them in Google Drive (this app cannot do it for you), then confirm here so they are asked to try again.</div>
      <div className="row">
        <input className="input" placeholder="Optional note, e.g. Shared with Aanya as viewer" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <button className="btn primary" onClick={() => act(`/submissions/${sub.id}/access-restored`, { note }, 'Reviewer notified')}>I’ve updated sharing</button>
      </div>
    </section>
  );
}

const METHODS = ['Google Drive share', 'Email', 'WeTransfer', 'Client portal', 'Other'];
function DeliverBox({ task, sub, act }) {
  const [method, setMethod] = useState(METHODS[0]);
  const [note, setNote] = useState('');
  return (
    <section className="box" style={{ borderColor: 'var(--ready)' }}>
      <h3 className="section-title">Record delivery of {sub.version}</h3>
      <div className="kv" style={{ marginBottom: 10 }}>
        <span className="k">Approved version</span><span><b>{sub.version}</b> · <a href={sub.link} target="_blank" rel="noreferrer noopener">Open in Google Drive</a></span>
        <span className="k">Recipient</span><span>{task.recipient ? <Person user={task.recipient} /> : <span className="error-text">Set a final recipient first</span>}</span>
        <span className="k">Sender</span><span>You</span>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="dl-m">How was it sent?</label><select id="dl-m" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor="dl-n">Note</label><input id="dl-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></div>
      </div>
      <p className="hint">Send the files yourself first. This records a manual delivery; it does not send anything and will be labelled as a manual record, not a verified automated send.</p>
      <button className="btn primary" disabled={!task.recipient} onClick={() => act(`/tasks/${task.id}/deliver`, { method, note }, 'Delivery recorded')}>Record delivery to {first(task.recipient) || 'recipient'}</button>
    </section>
  );
}

function DeliveryRecord({ d }) {
  return (
    <div className="version" style={{ marginBottom: 8 }}>
      <div className="version-head">
        <StageIcon stage="delivered" /> <span className="v">{d.version}</span> delivered to <b>{d.recipient?.name}</b>
        <span style={{ flex: 1 }} />
        {d.verified ? <span className="chip ok">Verified automated send</span> : <span className="chip outline">Manual record</span>}
      </div>
      <div className="version-body">
        <div className="kv">
          <span className="k">Recipient</span><span>{d.recipient?.name}</span>
          <span className="k">Approved version</span><span>{d.version} · <a href={d.link} target="_blank" rel="noreferrer noopener">Open in Google Drive</a></span>
          <span className="k">Sent by</span><span>{d.sender?.name}</span>
          <span className="k">Delivered</span><span>{fmtDateTime(d.delivered_at)}</span>
          <span className="k">Method</span><span>{d.method}</span>
          {d.note && <><span className="k">Note</span><span>{d.note}</span></>}
        </div>
        {!d.verified && <span className="hint">Recorded by {d.sender?.name}. The app did not send or confirm receipt of this delivery.</span>}
      </div>
    </div>
  );
}

function Versions({ task }) {
  const [preview, setPreview] = useState(null);
  if (!task.submissions.length) return null;
  return (
    <section>
      <h3 className="section-title">Versions and decisions <span className="hint" style={{ fontWeight: 400 }}>{task.submissions.length}</span></h3>
      <div className="stack" style={{ gap: 10 }}>
        {task.submissions.map((s) => {
          const [tone, label] = SUB_STATUS[s.status];
          const [atone, alabel] = ACCESS_CHECK[s.access_check] || ACCESS_CHECK.not_checked;
          const demo = s.drive_id?.startsWith('DEMO-');
          return (
            <div key={s.id} className={`version ${s.status === 'superseded' ? 'superseded' : ''}`}>
              <div className="version-head">
                <span className="v">{s.version}</span>
                <span className={`chip ${tone}`}>{label}</span>
                {s.access_issue && <span className="chip blocked">Reviewer cannot access file</span>}
                <span style={{ flex: 1 }} />
                <a className="btn sm" href={s.link} target="_blank" rel="noreferrer noopener"><Icon.external /> Open in Google Drive</a>
                {s.preview_url && !demo && <button className="btn sm ghost" onClick={() => setPreview(preview === s.id ? null : s.id)}>{preview === s.id ? 'Hide preview' : 'Preview'}</button>}
              </div>
              <div className="version-body">
                <div className="kv">
                  <span className="k">Submitted by</span><span>{s.submitted_by?.name}</span>
                  <span className="k">Submitted</span><span>{fmtDateTime(s.submitted_at)}</span>
                  <span className="k">Assigned reviewer</span><span>{task.steps.map((st) => `${st.approver?.name} (${st.label})`).join(' → ') || '—'}</span>
                  <span className="k">Review deadline</span><span>{s.review_deadline ? fmtDate(s.review_deadline, { year: true }) : 'None'}</span>
                  <span className="k">Link</span><span style={{ wordBreak: 'break-all' }}>{s.link} <span className="hint">({s.link_kind})</span></span>
                  <span className="k">Drive access</span><span><span className={`chip ${atone}`} title={s.access_check_detail || 'No Google Drive integration is configured, so the app has not checked who can open this file.'}>{alabel}</span>{demo && <span className="hint"> · sample link, not a real Drive file</span>}</span>
                </div>
                {s.note && <div className="brief"><span className="hint">Note: </span>{s.note}</div>}
                {preview === s.id && (
                  <>
                    <iframe className="preview" src={s.preview_url} title={`Preview of ${s.version}`} allow="autoplay" />
                    <span className="hint">The preview loads with your own Google account. It shows whether <i>you</i> can open the file, not whether reviewers can.</span>
                  </>
                )}
                {s.reviews.length > 0 && (
                  <div>
                    {s.reviews.map((r) => {
                      const [dt, dl] = DECISION[r.decision];
                      return (
                        <div key={r.id} className="decision">
                          <Avatar user={r.reviewer} size="xs" />
                          <div style={{ flex: 1 }}>
                            <b>{r.reviewer?.name}</b> <span className={`chip ${dt}`}>{dl}</span> <span className="hint">{r.step_label} · {s.version} · {fmtDateTime(r.created_at)}</span>
                            {r.feedback && <div className="brief" style={{ marginTop: 3 }}>{r.feedback}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Discussion({ task, act }) {
  const [tab, setTab] = useState('comments');
  const [body, setBody] = useState('');
  return (
    <section>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'comments'} className={`tab ${tab === 'comments' ? 'on' : ''}`} onClick={() => setTab('comments')}>Comments ({task.comments.length})</button>
        <button role="tab" aria-selected={tab === 'activity'} className={`tab ${tab === 'activity' ? 'on' : ''}`} onClick={() => setTab('activity')}>Activity history</button>
      </div>
      {tab === 'comments' && (
        <div>
          {task.comments.map((c) => (
            <div className="comment" key={c.id}><Avatar user={c.author} />
              <div style={{ flex: 1 }}><b>{c.author?.name}</b> <span className="hint">{fmtDateTime(c.created_at)}</span><div className="body">{c.body}</div></div>
            </div>
          ))}
          {!task.comments.length && <p className="hint">No comments yet.</p>}
          {task.allowed.comment && (
            <form className="stack" style={{ gap: 8, marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await act(`/tasks/${task.id}/comments`, { body })) setBody(''); }}>
              <textarea className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Leave a comment…" aria-label="Comment" />
              <div><button className="btn sm" disabled={!body.trim()}>Comment</button></div>
            </form>
          )}
        </div>
      )}
      {tab === 'activity' && (
        <div className="timeline">
          {task.activity.map((a) => (
            <div className="timeline-item" key={a.id}><Avatar user={a.actor} size="xs" /><span><b>{a.actor?.name}</b> {a.message}</span><time>{fmtDateTime(a.created_at)}</time></div>
          ))}
        </div>
      )}
    </section>
  );
}

function Sidebar({ task, patch, act }) {
  const { meta } = useApp();
  const a = task.allowed;
  const [editSteps, setEditSteps] = useState(false);
  const [blocking, setBlocking] = useState(false);
  return (
    <div className="panel-side">
      <div className="prop"><span className="k">Status</span><span className="row"><StageIcon stage={task.stage} /> {stageName(task.stage)}</span></div>
      <div className="prop"><span className="k">Priority</span>
        {a.edit ? (
          <select className="select" style={{ height: 28 }} value={task.priority} onChange={(e) => patch({ priority: e.target.value })} aria-label="Priority">
            <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select>
        ) : <span className="row" style={{ textTransform: 'capitalize' }}><PriorityIcon priority={task.priority} /> {task.priority}</span>}
      </div>
      <div className="prop"><span className="k">Deadline</span>
        {a.edit ? <input type="date" className="input" style={{ height: 28 }} value={task.due_date || ''} onChange={(e) => patch({ due_date: e.target.value })} aria-label="Deadline" /> : <Due date={task.due_date} stage={task.stage} />}
      </div>
      <div className="prop"><span className="k">Project</span>
        {a.assign ? (
          <select className="select" style={{ height: 28 }} value={task.project.id} onChange={(e) => patch({ project_id: Number(e.target.value) })} aria-label="Project">
            {meta.projects.map((p) => <option key={p.id} value={p.id}>{p.client_name} · {p.name}</option>)}
          </select>
        ) : <span>{task.client.name} · {task.project.name}</span>}
      </div>
      <div className="prop-sep" />
      <div className="prop"><span className="k">Creator</span><Person user={task.creator} /></div>
      <div className="prop"><span className="k">Next action</span><StatusLine task={task} /></div>
      <div className="prop"><span className="k">Assigned to</span>
        {a.assign ? <PersonPicker plain value={task.assignee?.id ?? null} onChange={(id) => patch({ assignee_id: id })} label="Assigned to" requirement={REQ.submit} projectId={task.project.id} /> : <Person user={task.assignee} />}
      </div>
      <div className="prop" style={{ alignItems: 'start', paddingTop: 7 }}><span className="k">Approvers</span>
        <div className="steps">
          {task.steps.map((s) => (
            <div key={s.id} className={`step ${s.state}`}>
              <span className="n">{s.state === 'approved' ? '✓' : s.position + 1}</span>
              <span><Person user={s.approver} /><div className="hint">{s.label}{s.state === 'current' ? ' · now' : ''}</div></span>
            </div>
          ))}
          {!task.steps.length && <span className="hint">No approval steps</span>}
          {a.edit_steps && <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginLeft: -8 }} onClick={() => setEditSteps(true)}>Edit approval steps</button>}
          {!a.edit_steps && task.stage === 'in_review' && <span className="hint">Locked while in review</span>}
        </div>
      </div>
      <div className="prop"><span className="k">Delivery owner</span>
        {a.assign ? <PersonPicker plain value={task.delivery_owner?.id ?? null} onChange={(id) => patch({ delivery_owner_id: id })} label="Delivery owner" requirement={REQ.deliver} projectId={task.project.id} /> : <Person user={task.delivery_owner} />}
      </div>
      <div className="prop"><span className="k">Final recipient</span>
        {a.assign ? <PersonPicker plain value={task.recipient?.id ?? null} onChange={(id) => patch({ recipient_id: id })} label="Final recipient" projectId={task.project.id} /> : <Person user={task.recipient} />}
      </div>
      <div className="prop-sep" />
      <div className="prop" style={{ alignItems: 'start', paddingTop: 6 }}><span className="k">Blocked</span>
        <div>
          {task.blocked ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="chip blocked" style={{ alignSelf: 'flex-start' }}><Icon.flag /> Needs {task.blocked.resolver?.name}</span>
              <span style={{ fontSize: 12.5 }}>{task.blocked.reason}</span>
              <span className="hint">Raised by {task.blocked.by?.name} · {ago(task.blocked.at)} ago</span>
              {a.unblock && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => act(`/tasks/${task.id}/unblock`, {}, 'Block cleared')}>Clear block</button>}
            </div>
          ) : a.block ? <button className="btn sm" onClick={() => setBlocking(true)}><Icon.flag /> Flag as blocked</button> : <span className="hint">No</span>}
        </div>
      </div>
      {editSteps && <EditStepsModal task={task} onClose={() => setEditSteps(false)} />}
      {blocking && <BlockModal task={task} act={act} onClose={() => setBlocking(false)} />}
    </div>
  );
}

function EditStepsModal({ task, onClose }) {
  const { toast, reloadAll } = useApp();
  const [steps, setSteps] = useState(task.steps.map((s) => ({ label: s.label, approver_id: s.approver_id })));
  return (
    <Modal title="Approval steps" onClose={onClose} wide footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={async () => {
        try { await api(`/tasks/${task.id}/steps`, { method: 'PUT', body: { steps: steps.filter((s) => s.approver_id) } }); reloadAll(); onClose(); } catch (e) { toast(e.message, 'err'); }
      }}>Save steps</button>
    </>}>
      <p className="hint" style={{ margin: 0 }}>Each version must pass every step in order, for example Creative Head → Account Manager. Approval authority applies only to this task.</p>
      <StepsEditor steps={steps} onChange={setSteps} projectId={task.project.id} />
    </Modal>
  );
}

function BlockModal({ task, act, onClose }) {
  const [reason, setReason] = useState('');
  const [resolver, setResolver] = useState(null);
  return (
    <Modal title="Flag as blocked" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!reason.trim() || !resolver} onClick={async () => { if (await act(`/tasks/${task.id}/block`, { reason, resolver_id: resolver }, 'Flagged as blocked')) onClose(); }}>Flag as blocked</button>
    </>}>
      <div className="field"><label htmlFor="bl-r">What is blocking this? (required)</label><textarea id="bl-r" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
      <div className="field"><span className="label">Who is needed to resolve it? (required)</span><PersonPicker value={resolver} onChange={setResolver} label="Person needed" projectId={task.project.id} /></div>
      <span className="hint">The task keeps its stage. The person you choose becomes the next action and is notified.</span>
    </Modal>
  );
}
