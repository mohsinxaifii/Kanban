import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, usePopover } from './ui.jsx';
import { Icon } from './icons.jsx';

// "Save" on a task: pick one of your folders, or make a new one on the spot.
export function SaveButton({ taskId }) {
  const { toast } = useApp();
  const pop = usePopover();
  const [folders, setFolders] = useState(null);
  const [name, setName] = useState('');
  const load = () => api('/saved').then((r) => setFolders(r.folders)).catch(() => setFolders([]));
  useEffect(() => { if (pop.open) load(); }, [pop.open]);

  const inFolder = (f) => f.items.find((x) => x.kind === 'task' && x.task_id === taskId);
  async function toggle(f) {
    try {
      const existing = inFolder(f);
      if (existing) { await api(`/saved/items/${existing.id}`, { method: 'DELETE' }); toast(`Removed from ${f.name}`); }
      else { await api('/saved/items', { method: 'POST', body: { folder_id: f.id, kind: 'task', task_id: taskId } }); toast(`Saved to ${f.name}`); }
      load();
    } catch (e) { toast(e.message, 'err'); }
  }
  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const f = await api('/saved/folders', { method: 'POST', body: { name } });
      await api('/saved/items', { method: 'POST', body: { folder_id: f.id, kind: 'task', task_id: taskId } });
      toast(`Saved to ${f.name}`); setName(''); load();
    } catch (err) { toast(err.message, 'err'); }
  }
  const saved = folders?.some(inFolder);

  return (
    <div className="picker" ref={pop.ref} style={{ display: 'inline-block' }}>
      <button className={`btn sm ${saved ? '' : 'ghost'}`} onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open} aria-haspopup="menu">
        <Icon.bookmark width={13} height={13} /> {saved ? 'Saved' : 'Save'}
      </button>
      {pop.open && (
        <div className="pop" role="menu" style={{ top: 'calc(100% + 4px)', right: 0, width: 250 }}>
          <div className="menu-head">Save to folder</div>
          {folders === null && <div className="picker-empty">Loading…</div>}
          {folders?.length === 0 && <div className="picker-empty">No folders yet. Name one below.</div>}
          {folders?.map((f) => (
            <button key={f.id} className="menu-item" role="menuitemcheckbox" aria-checked={!!inFolder(f)} onClick={() => toggle(f)}>
              <span className="check-box">{inFolder(f) ? '✓' : ''}</span>{f.name}<span className="why">{f.items.length}</span>
            </button>
          ))}
          <form onSubmit={create} className="row" style={{ padding: '6px 4px 2px', gap: 6 }}>
            <input className="input" style={{ height: 26, fontSize: 12 }} placeholder="New folder name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New folder name" />
            <button className="btn sm" type="submit" disabled={!name.trim()}>Add</button>
          </form>
        </div>
      )}
    </div>
  );
}
