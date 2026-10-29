import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useApp, Avatar, Modal, Notice } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

export function Team() {
  const [tab, setTab] = useState('people');
  return (
    <div className="page">
      <div className="tabs">
        {[['people', 'People'], ['projects', 'Projects'], ['roles', 'Roles and permissions'], ['demo', 'Demo data']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'people' && <People />}
      {tab === 'projects' && <Projects />}
      {tab === 'roles' && <Roles />}
      {tab === 'demo' && <DemoData />}
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
  const shown = users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
  const projectName = (id) => meta.projects.find((p) => p.id === id)?.name;
  const customised = (u) => {
    const d = meta.roles.find((r) => r.key === u.role)?.permissions || [];
    return d.length !== u.permissions.length || d.some((k) => !u.permissions.includes(k));
  };

  return (
    <>
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
      <p className="hint">People marked Demo are fictional sample accounts. Only invited people who accept their invitation can sign in; adding someone to a task never creates an account.</p>
      {adding && <PersonModal onClose={() => setAdding(false)} onSaved={(u) => { setAdding(false); load(); setEditing(u); }} />}
      {editing && <PersonModal user={editing} onClose={() => setEditing(null)} onSaved={(u) => { load(); setEditing(u); }} />}
    </>
  );
}


function PersonModal({ user, onClose, onSaved }) {
  const { meta, me, toast, reloadAll } = useApp();
  const isNew = !user;
  const [f, setF] = useState(() => user
    ? { name: user.name, email: user.email, title: user.title, role: user.role, permissions: user.permissions, project_access: user.project_access }
    : { name: '', email: '', title: '', role: 'producer', permissions: meta.roles.find((r) => r.key === 'producer').permissions, project_access: 'all' });
  const roleDefaults = meta.roles.find((r) => r.key === f.role)?.permissions || [];
  const differs = [...new Set([...roleDefaults, ...f.permissions])].some((k) => roleDefaults.includes(k) !== f.permissions.includes(k));
  const togglePerm = (k) => setF({ ...f, permissions: f.permissions.includes(k) ? f.permissions.filter((x) => x !== k) : [...f.permissions, k] });
  const toggleProject = (id) => {
    const cur = f.project_access === 'all' ? [] : f.project_access;
    setF({ ...f, project_access: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  async function save() {
    try {
      const u = isNew ? await api('/admin/users', { method: 'POST', body: f }) : await api(`/admin/users/${user.id}`, { method: 'PATCH', body: f });
      toast(isNew ? `Invitation created for ${u.name}` : 'Saved');
      reloadAll();
      onSaved(u);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function setStatus(status) {
    try { const u = await api(`/admin/users/${user.id}`, { method: 'PATCH', body: { status } }); toast(status === 'deactivated' ? `${u.name} deactivated` : `${u.name} reactivated`); reloadAll(); onSaved(u); } catch (e) { toast(e.message, 'err'); }
  }
  async function reinvite() {
    try { const u = await api(`/admin/users/${user.id}/reinvite`, { method: 'POST' }); toast('New invite link created; the old one no longer works.'); onSaved(u); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Modal wide title={isNew ? 'Add person' : user.name} onClose={onClose} footer={<>
      {!isNew && user.id !== me.id && (user.status === 'deactivated'
        ? <button className="btn" onClick={() => setStatus('active')}>Reactivate</button>
        : <button className="btn danger" onClick={() => setStatus('deactivated')}>Deactivate</button>)}
      <span style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn primary" onClick={save}>{isNew ? 'Create invitation' : 'Save changes'}</button>
    </>}>
      {user?.is_demo ? <Notice tone="info">This is a fictional demo account used with the sample work.</Notice> : null}
      {user?.status === 'invited' && user.invite_url && (
        <div className="field"><span className="label">Invite link</span>
          <div className="copy-row"><input className="input" readOnly value={user.invite_url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button className="btn" onClick={() => { navigator.clipboard?.writeText(user.invite_url); toast('Invite link copied'); }}>Copy</button>
            <button className="btn" onClick={reinvite}>New link</button></div>
          <span className="hint">Email sending is not configured yet, so send this link to {user.name.split(' ')[0]} yourself. They get access only after accepting it.</span>
        </div>
      )}
      {user?.status === 'deactivated' && <Notice>This person cannot sign in. Their name stays on past work.</Notice>}
      <div className="grid2">
        <div className="field"><label htmlFor="pm-name">Name</label><input id="pm-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="pm-email">Email</label><input id="pm-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label htmlFor="pm-title">Job title</label><input id="pm-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Motion Designer" /></div>
        <div className="field"><label htmlFor="pm-role">Role</label>
          <div className="row">
            <select id="pm-role" className="select" value={f.role} onChange={(e) => { const role = e.target.value; setF({ ...f, role, permissions: meta.roles.find((r) => r.key === role).permissions }); }}>
              {meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <span className="hint">Changing the role resets permissions to that role’s defaults.</span>
        </div>
      </div>
      <div className="field">
        <span className="label">Permissions {differs && <span className="chip waiting" style={{ marginLeft: 6 }}>Differs from role defaults</span>}
          {differs && <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setF({ ...f, permissions: roleDefaults })}>Reset to defaults</button>}</span>
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
  const { meta } = useApp();
  return (
    <>
      <p className="lede">Role defaults are a starting point. Each person’s permissions can be adjusted individually. Approval authority is always task-specific: a person approves only the steps they are named on.</p>
      <div className="list">
        <table className="table matrix">
          <thead><tr><th>Permission</th>{meta.roles.map((r) => <th key={r.key}>{r.label}</th>)}</tr></thead>
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

function DemoData() {
  const { me, toast, reloadAll } = useApp();
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <Notice tone="info">
        The demo workspace contains fictional people (Aanya Shah, Rohan Mehta, Meera Kapoor, Kabir Sethi, Nisha Rao and Studio Admin, all on the reserved <code>demo.designdimensions.test</code> domain)
        and sample tasks for fictional clients. They are marked “Demo” and “Sample” throughout the app.
      </Notice>
      <p style={{ margin: 0 }}>Removing demo data deletes every sample task and the demo accounts. Demo people who appear on real work are deactivated instead of deleted, so history stays intact. This cannot be undone.</p>
      {me.is_demo
        ? <Notice>You are signed in with a demo account. Create a real administrator (see the setup guide) and sign in as them to remove demo data.</Notice>
        : <div><button className="btn danger" onClick={async () => {
          if (!window.confirm('Remove all demo people and sample work? This cannot be undone.')) return;
          try { await api('/admin/demo/remove', { method: 'POST' }); toast('Demo data removed'); reloadAll(); } catch (e) { toast(e.message, 'err'); }
        }}>Remove demo data</button></div>}
    </div>
  );
}
