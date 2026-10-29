import { useEffect, useState } from 'react';
import { api, fmtDate, ago } from '../api.js';
import { useApp, Avatar, Modal, Notice } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';
import { Appearance } from './Appearance.jsx';

// Settings: Appearance for everyone; people, projects and roles for those who manage users.
export function Settings() {
  const { can } = useApp();
  const manage = can('users.manage');
  const [tab, setTab] = useState(manage ? 'people' : 'appearance');
  const tabs = manage ? [['people', 'People'], ['projects', 'Projects'], ['roles', 'Roles and permissions'], ['appearance', 'Appearance']] : [['appearance', 'Appearance']];
  return (
    <div className="page">
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {manage && tab === 'people' && <People />}
      {manage && tab === 'projects' && <Projects />}
      {manage && tab === 'roles' && <Roles />}
      {tab === 'appearance' && <Appearance />}
    </div>
  );
}

function People() {
  const { meta, version, toast } = useApp();
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const load = () => api('/admin/users').then(setUsers).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const roleLabel = (k) => meta.roles.find((r) => r.key === k)?.label || k;
  const requests = users.filter((u) => u.status === 'pending');
  const shown = users.filter((u) => u.status !== 'pending' && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  const projectName = (id) => meta.projects.find((p) => p.id === id)?.name;
  const customised = (u) => {
    const d = meta.roles.find((r) => r.key === u.role)?.permissions || [];
    return d.length !== u.permissions.length || d.some((k) => !u.permissions.includes(k));
  };

  return (
    <>
      <SignupLink />
      {requests.length > 0 && (
        <>
          <h2 style={{ fontSize: 14, margin: '4px 0 8px' }}>Requests to join <span className="n">{requests.length}</span></h2>
          <div className="list" style={{ marginBottom: 20 }}>
            <table className="table">
              <tbody>
                {requests.map((u) => (
                  <tr key={u.id} className="click" onClick={() => setEditing(u)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(u)}>
                    <td><span className="person"><Avatar user={u} /> <b style={{ fontWeight: 550 }}>{u.name}</b></span><div className="hint" style={{ marginLeft: 26 }}>{u.title}</div></td>
                    <td>{u.email}</td>
                    <td className="hint">Asked {ago(u.requested_at || u.created_at)}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn sm primary" onClick={(e) => { e.stopPropagation(); setEditing(u); }}>Review</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setAdding(true)}><Icon.plus /> Add person</button>
      </div>
      <div className="list">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Projects</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="click" onClick={() => setEditing(u)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEditing(u)}>
                <td><span className="person"><Avatar user={u} /> <b style={{ fontWeight: 550 }}>{u.name}</b> {u.is_demo ? <span className="tag-demo" title="Fictional demo account">Demo</span> : null}</span><div className="hint" style={{ marginLeft: 26 }}>{u.title}</div></td>
                <td>{u.email}</td>
                <td>{roleLabel(u.role)}{customised(u) && <div className="hint">Custom permissions</div>}</td>
                <td>{u.project_access === 'all' ? 'All projects' : u.project_access.map(projectName).filter(Boolean).join(', ') || <span className="hint">None</span>}</td>
                <td>{u.status === 'active' ? <span className="chip ok">Active</span> : u.status === 'invited' ? <span className="chip waiting">Invited</span> : <span className="chip neutral">Deactivated</span>}</td>
                <td><button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setEditing(u); }}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Only invited people who accept, and sign-ups you approve, can sign in. Adding someone to a task never creates an account.</p>
      {adding && <PersonModal onClose={() => setAdding(false)} onSaved={(u) => { setAdding(false); load(); setEditing(u); }} />}
      {editing && <PersonModal key={`${editing.id}-${editing.status}`} user={editing} onClose={() => setEditing(null)} onSaved={(u) => { load(); setEditing(u); }} />}
    </>
  );
}


// One shared link anyone can use to ask to join. Requests wait here for approval.
function SignupLink() {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  useEffect(() => { api('/admin/signup').then(setS).catch(() => {}); }, []);
  const set = async (body, msg) => { try { setS(await api('/admin/signup', { method: 'POST', body })); toast(msg); } catch (e) { toast(e.message, 'err'); } };
  if (!s) return null;
  return (
    <div className="signup-card">
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>Team sign-up link</b>
        <div className="hint">{s.enabled
          ? 'Anyone with this link can ask to join by entering their name, email and designation. They get no access until you approve them here.'
          : 'Turn this on to get one link you can share with the whole team instead of inviting people one by one.'}</div>
        {s.enabled && (
          <div className="copy-row" style={{ marginTop: 8 }}>
            <input className="input" readOnly value={s.url} onFocus={(e) => e.target.select()} aria-label="Team sign-up link" />
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(s.url); toast('Sign-up link copied'); }}>Copy</button>
            <button className="btn" onClick={() => window.confirm('Make a new link? The current link stops working.') && set({ regenerate: true }, 'New sign-up link created')}>New link</button>
            <button className="btn" onClick={() => set({ enabled: false }, 'Sign-up link turned off')}>Turn off</button>
          </div>
        )}
      </div>
      {!s.enabled && <button className="btn primary" onClick={() => set({ enabled: true }, 'Sign-up link created')}>Create sign-up link</button>}
    </div>
  );
}

function inviteMessage(u) {
  if (u.invite_email?.status === 'sent') return `Invitation emailed to ${u.email}`;
  if (u.invite_email?.status === 'failed') return `Invitation created, but the email failed (${u.invite_email.error}). Copy the link and send it yourself.`;
  return `Invitation created for ${u.name}. Copy the link below and send it to them.`;
}

function PersonModal({ user, onClose, onSaved }) {
  const { meta, me, toast, reloadAll } = useApp();
  const isNew = !user;
  const pending = user?.status === 'pending';
  const findRole = (title) => meta.roles.find((r) => r.label.toLowerCase() === (title || '').trim().toLowerCase());
  const producer = meta.roles.find((r) => r.key === 'producer');
  const [f, setF] = useState(() => {
    if (pending) {
      const r = findRole(user.title) || producer;
      return { name: user.name, email: user.email, title: user.title, role: r.key, permissions: r.permissions, project_access: 'all' };
    }
    if (user) return { name: user.name, email: user.email, title: user.title, role: user.role, permissions: user.permissions, project_access: user.project_access };
    return { name: '', email: '', title: '', role: 'producer', permissions: producer.permissions, project_access: 'all' };
  });
  const matched = findRole(f.title);
  const roleDefaults = matched?.permissions || f.permissions;
  const setTitle = (title) => {
    const r = findRole(title);
    setF(r ? { ...f, title, role: r.key, permissions: r.permissions } : { ...f, title });
  };
  const differs = [...new Set([...roleDefaults, ...f.permissions])].some((k) => roleDefaults.includes(k) !== f.permissions.includes(k));
  const togglePerm = (k) => setF({ ...f, permissions: f.permissions.includes(k) ? f.permissions.filter((x) => x !== k) : [...f.permissions, k] });
  const toggleProject = (id) => {
    const cur = f.project_access === 'all' ? [] : f.project_access;
    setF({ ...f, project_access: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  async function save() {
    try {
      const u = isNew ? await api('/admin/users', { method: 'POST', body: f }) : await api(`/admin/users/${user.id}`, { method: 'PATCH', body: f });
      toast(isNew ? inviteMessage(u) : 'Saved', u.invite_email?.status === 'failed' ? 'err' : 'ok');
      reloadAll();
      onSaved(u);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function approve() {
    try {
      const u = await api(`/admin/users/${user.id}`, { method: 'PATCH', body: { ...f, status: 'active' } });
      toast(`${u.name} approved. They can sign in now.`); reloadAll(); onSaved(u);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function decline() {
    if (!window.confirm(`Decline ${user.name}'s request? Their sign-up is deleted.`)) return;
    try { await api(`/admin/users/${user.id}/decline`, { method: 'POST' }); toast('Request declined'); reloadAll(); onClose(); onSaved(null); } catch (e) { toast(e.message, 'err'); }
  }
  async function setStatus(status) {
    try { const u = await api(`/admin/users/${user.id}`, { method: 'PATCH', body: { status } }); toast(status === 'deactivated' ? `${u.name} deactivated` : `${u.name} reactivated`); reloadAll(); onSaved(u); } catch (e) { toast(e.message, 'err'); }
  }
  async function reinvite() {
    try {
      const u = await api(`/admin/users/${user.id}/reinvite`, { method: 'POST' });
      toast(`New invite link created; the old one no longer works. ${u.invite_email?.status === 'sent' ? `Emailed to ${u.email}.` : ''}`, u.invite_email?.status === 'failed' ? 'err' : 'ok');
      onSaved(u);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function emailAgain() {
    try { await api(`/admin/users/${user.id}/send-invite`, { method: 'POST' }); toast(`Invitation emailed to ${user.email}`); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Modal wide title={isNew ? 'Add person' : pending ? `Request to join: ${user.name}` : user.name} onClose={onClose} footer={pending ? <>
      <button className="btn danger" onClick={decline}>Decline</button>
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn primary" onClick={approve}>Approve with these permissions</button>
    </> : <>
      {!isNew && user.id !== me.id && (user.status === 'deactivated'
        ? <button className="btn" onClick={() => setStatus('active')}>Reactivate</button>
        : <button className="btn danger" onClick={() => setStatus('deactivated')}>Deactivate</button>)}
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn primary" onClick={save}>{isNew ? 'Create invitation' : 'Save changes'}</button>
    </>}>
      {pending && <Notice tone="info">{user.name} signed up with the team link as <b>{user.title}</b>. Choose their role, permissions and projects below, then approve. They cannot sign in until you do.</Notice>}
      {user?.is_demo ? <Notice tone="info">This is a fictional demo account used with the sample work.</Notice> : null}
      {user?.status === 'invited' && user.invite_url && (
        <div className="field"><span className="label">Invite link</span>
          <div className="copy-row"><input className="input" readOnly value={user.invite_url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(user.invite_url); toast('Invite link copied'); }}>Copy</button>
            {meta.emailEnabled && <button className="btn" onClick={emailAgain}>Email again</button>}
            <button className="btn" onClick={reinvite}>New link</button></div>
          <span className="hint">{meta.emailEnabled
            ? `The invitation is emailed to ${user.email}. You can also copy the link and send it yourself. They get access only after accepting it.`
            : `Email sending is not set up, so send this link to ${user.name.split(' ')[0]} yourself. They get access only after accepting it.`}</span>
        </div>
      )}
      {user?.status === 'deactivated' && <Notice>This person cannot sign in. Their name stays on past work.</Notice>}
      <div className="grid2">
        <div className="field"><label htmlFor="pm-name">Name</label><input id="pm-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="pm-email">Email</label><input id="pm-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="pm-title">Job title (role)</label>
          <input id="pm-title" className="input" list="role-names" value={f.title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Motion Designer" autoComplete="off" />
          <datalist id="role-names">{meta.roles.map((r) => <option key={r.key} value={r.label} />)}</datalist>
          <span className="hint">{!f.title.trim()
            ? 'Type a job title. Picking an existing one fills in its permissions.'
            : matched
              ? `Uses the “${matched.label}” role. Saving stores the permissions below as this role’s permissions for the next person with this title. People who already have it keep their own.`
              : `“${f.title.trim()}” is a new role. Saving creates it with the permissions below.`}</span>
        </div>
      </div>
      <div className="field">
        <span className="label">Permissions {matched && differs && <span className="chip waiting" style={{ marginLeft: 6 }}>Changes the “{matched.label}” role</span>}
          {matched && differs && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setF({ ...f, permissions: roleDefaults })}>Use the role’s current permissions</button>}</span>
        <div className="perm-grid">
          {meta.permissions.map((p) => (
            <label key={p.key} className="checkbox"><input type="checkbox" checked={f.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} />
              <span>{p.label}<small>{p.help}</small></span></label>
          ))}
        </div>
      </div>
      <div className="field"><span className="label">Project access</span>
        <label className="checkbox"><input type="radio" name="pa" checked={f.project_access === 'all'} onChange={() => setF({ ...f, project_access: 'all' })} /> All projects, including new ones</label>
        <label className="checkbox"><input type="radio" name="pa" checked={f.project_access !== 'all'} onChange={() => setF({ ...f, project_access: [] })} /> Only selected projects</label>
        {f.project_access !== 'all' && (
          <div className="perm-grid" style={{ paddingLeft: 24 }}>
            {meta.projects.map((p) => <label key={p.id} className="checkbox"><input type="checkbox" checked={f.project_access.includes(p.id)} onChange={() => toggleProject(p.id)} /> {p.client_name} · {p.name}</label>)}
          </div>
        )}
      </div>
      {!isNew && <span className="hint">Added {fmtDate(user.created_at, { year: true })}.</span>}
    </Modal>
  );
}

function Projects() {
  const { toast, reloadAll, version } = useApp();
  const [data, setData] = useState({ projects: [], clients: [] });
  const [f, setF] = useState({ client_name: '', name: '' });
  useEffect(() => { api('/admin/projects').then(setData); }, [version]);
  return (
    <>
      <form className="row" style={{ marginBottom: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        try { await api('/admin/projects', { method: 'POST', body: f }); setF({ client_name: '', name: '' }); toast('Project added'); reloadAll(); } catch (err) { toast(err.message, 'err'); }
      }}>
        <input className="input" style={{ width: 220 }} list="clients" placeholder="Client" value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} aria-label="Client" required />
        <datalist id="clients">{data.clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <input className="input" style={{ width: 260 }} placeholder="Project name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Project name" required />
        <button className="btn primary" type="submit">Add project</button>
      </form>
      <div className="list">
        <table className="table">
          <thead><tr><th>Client</th><th>Project</th><th>Tasks</th><th /></tr></thead>
          <tbody>{data.projects.map((p) => <tr key={p.id}><td>{p.client_name}</td><td>{p.name}</td><td>{p.task_count}</td><td>{p.is_demo ? <span className="tag-demo">Sample</span> : null}</td></tr>)}</tbody>
        </table>
      </div>
    </>
  );
}

function Roles() {
  const { meta, toast, reloadAll } = useApp();
  const remove = async (r) => {
    if (!window.confirm(`Delete the “${r.label}” role?`)) return;
    try { await api(`/admin/roles/${r.key}`, { method: 'DELETE' }); toast('Role deleted'); reloadAll(); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <>
      <p className="lede">Roles are job titles. When you save a person, their job title becomes a role with the permissions you chose, so the next person with that title starts with the same access. You can still adjust each person individually. Approval authority is always task-specific: a person approves only the steps they are named on.</p>
      <div className="list" style={{ overflowX: 'auto' }}>
        <table className="table matrix">
          <thead><tr><th>Permission</th>{meta.roles.map((r) => (
            <th key={r.key}>{r.label}{!r.builtin && <button className="icon-btn" style={{ marginLeft: 2, verticalAlign: 'middle' }} title={`Delete ${r.label}`} aria-label={`Delete ${r.label}`} onClick={() => remove(r)}><Icon.trash width={12} height={12} /></button>}</th>
          ))}</tr></thead>
          <tbody>
            {meta.permissions.map((p) => (
              <tr key={p.key}><td><b style={{ fontWeight: 550 }}>{p.label}</b><div className="hint">{p.help}</div></td>
                {meta.roles.map((r) => <td key={r.key}>{r.permissions.includes(p.key) ? <span className="dot-yes" aria-label="Yes">✓</span> : <span className="dot-no" aria-label="No">–</span>}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Account managers can approve only when explicitly authorised. Recipients see only work delivered to them, and review only when given approval permission and named as an approver.</p>
    </>
  );
}
