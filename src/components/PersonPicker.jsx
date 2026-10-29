import { useMemo, useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { useApp, usePopover, Person, Avatar } from './ui.jsx';

// Searchable people field. Selecting only ever picks an existing account.
// A new person needs an explicit invite (name + email + role) by someone who can
// manage users; typing a name alone never creates an account or grants access.
export function PersonPicker({
  value, onChange, label, placeholder = 'Select person', requirement, projectId, plain, allowClear = true, disabled, id,
}) {
  const { people, me, meta, reloadPeople, toast } = useApp();
  const pop = usePopover();
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const [inviting, setInviting] = useState(null);
  const inputRef = useRef(null);
  const selected = people.find((p) => p.id === value) || null;
  const canInvite = me.permissions.includes('users.manage');

  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    return people
      .filter((p) => !term || p.name.toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term))
      .map((p) => {
        let blocked = null;
        if (requirement && !p[requirement.key]) blocked = requirement.reason;
        else if (projectId && p.project_access !== 'all' && !p.project_access.includes(Number(projectId))) blocked = 'No access to this project';
        return { ...p, blocked };
      })
      .sort((a, b) => (!!a.blocked - !!b.blocked) || a.name.localeCompare(b.name));
  }, [people, q, requirement, projectId]);

  useEffect(() => { if (pop.open) { setQ(''); setHl(0); setInviting(null); } }, [pop.open]);

  const choose = (p) => { if (p.blocked) return; onChange(p.id); pop.setOpen(false); };
  const onKey = (e) => {
    const enabled = options.filter((o) => !o.blocked);
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, enabled.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); if (enabled[hl]) choose(enabled[hl]); }
  };
  const noExactMatch = q.trim().length > 1 && !people.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());

  async function sendInvite(e) {
    e.preventDefault();
    try {
      const u = await api('/admin/users', { method: 'POST', body: { ...inviting, project_access: projectId ? [Number(projectId)] : 'all' } });
      await reloadPeople();
      toast(`Invitation created for ${u.name}. Share the invite link from Settings.`);
      onChange(u.id);
      pop.setOpen(false);
    } catch (err) { toast(err.message, 'err'); }
  }

  let enabledIndex = -1;
  return (
    <div className="picker" ref={pop.ref}>
      <button type="button" id={id} className={`picker-btn ${plain ? 'plain' : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={pop.open} aria-label={label ? `${label}: ${selected?.name || 'none'}` : undefined}
        onClick={() => !disabled && pop.setOpen((o) => !o)}>
        {selected ? <Person user={selected} /> : <span className="placeholder">{placeholder}</span>}
      </button>
      {pop.open && (
        <div className="pop picker-pop">
          <input ref={inputRef} autoFocus value={q} onChange={(e) => { setQ(e.target.value); setHl(0); }} onKeyDown={onKey}
            placeholder="Type a name…" aria-label={`Search people${label ? ` for ${label}` : ''}`} role="combobox" aria-expanded="true" />
          <div className="picker-list" role="listbox">
            {allowClear && value && <button type="button" className="menu-item" onClick={() => { onChange(null); pop.setOpen(false); }}><Avatar /> <span style={{ color: 'var(--muted)' }}>Clear</span></button>}
            {options.map((p) => {
              if (!p.blocked) enabledIndex += 1;
              const isHl = !p.blocked && enabledIndex === hl;
              return (
                <button type="button" key={p.id} role="option" aria-selected={p.id === value} disabled={!!p.blocked}
                  className={`menu-item ${isHl ? 'hl' : ''}`} onClick={() => choose(p)} title={p.blocked || ''}>
                  <Avatar user={p} size="xs" /> <span>{p.name}</span>
                  {p.is_demo && <span className="tag-demo">Demo</span>}
                  {p.status === 'invited' && <span className="chip outline" style={{ height: 16, fontSize: 10.5 }}>Invited</span>}
                  <span className="sub">{p.blocked || p.title}</span>
                </button>
              );
            })}
            {!options.length && <div className="picker-empty">No one matches “{q}”.</div>}
          </div>
          {noExactMatch && !inviting && (
            canInvite ? (
              <div className="invite-box">
                <button type="button" className="btn sm" onClick={() => setInviting({ name: q.trim(), email: '', role: 'producer', title: '' })}>
                  Invite “{q.trim()}” as a new person…
                </button>
              </div>
            ) : (
              <div className="picker-empty" style={{ borderTop: '1px solid var(--border)' }}>
                Not in the team yet? Ask an administrator to invite them in Settings.
              </div>
            )
          )}
          {inviting && (
            <form className="invite-box" onSubmit={sendInvite}>
              <div className="hint">Inviting creates a pending account. They get access only after accepting the invitation.</div>
              <input className="input" value={inviting.name} onChange={(e) => setInviting({ ...inviting, name: e.target.value })} placeholder="Full name" required aria-label="Full name" />
              <input className="input" type="email" value={inviting.email} onChange={(e) => setInviting({ ...inviting, email: e.target.value })} placeholder="Email" required aria-label="Email" />
              <select className="select" value={inviting.role} onChange={(e) => setInviting({ ...inviting, role: e.target.value })} aria-label="Role">
                {meta.roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <div className="row"><button className="btn primary sm" type="submit">Send invite</button><button type="button" className="btn ghost sm" onClick={() => setInviting(null)}>Cancel</button></div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export const REQ = {
  submit: { key: 'can_submit', reason: 'Cannot submit assets' },
  approve: { key: 'can_approve', reason: 'Not authorised to approve' },
  deliver: { key: 'can_deliver', reason: 'Cannot record delivery' },
};
