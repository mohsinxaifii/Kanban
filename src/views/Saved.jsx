import { useEffect, useState } from 'react';
import { api, taskKey, ago } from '../api.js';
import { useApp, StatusLine, Due } from '../components/ui.jsx';
import { Icon, StageIcon } from '../components/icons.jsx';

// Personal folders of saved tasks and links. Private to the signed-in person.
export function Saved() {
  const { toast, openTask, version } = useApp();
  const [folders, setFolders] = useState(null);
  const [current, setCurrent] = useState(null);
  const [newFolder, setNewFolder] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [link, setLink] = useState({ url: '', title: '', note: '' });

  const load = () => api('/saved').then((r) => {
    setFolders(r.folders);
    setCurrent((c) => (r.folders.some((f) => f.id === c) ? c : r.folders[0]?.id ?? null));
  });
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await load(); } catch (e) { toast(e.message, 'err'); } };
  const folder = folders?.find((f) => f.id === current);

  async function addFolder(e) {
    e.preventDefault();
    if (!newFolder.trim()) return;
    await run(async () => { const f = await api('/saved/folders', { method: 'POST', body: { name: newFolder } }); setCurrent(f.id); setNewFolder(''); }, 'Folder created');
  }
  async function addLink(e) {
    e.preventDefault();
    await run(async () => { await api('/saved/items', { method: 'POST', body: { folder_id: folder.id, kind: 'link', ...link } }); setLink({ url: '', title: '', note: '' }); }, 'Link saved');
  }

  if (!folders) return null;
  return (
    <div className="saved">
      <nav className="saved-folders" aria-label="Folders">
        <div className="menu-head">Your folders</div>
        {folders.map((f) => (
          <button key={f.id} className={`nav-item ${f.id === current ? 'active' : ''}`} onClick={() => setCurrent(f.id)} aria-current={f.id === current ? 'true' : undefined}>
            <Icon.folder /> <span className="ellipsis">{f.name}</span> <span className="count">{f.items.length}</span>
          </button>
        ))}
        <form onSubmit={addFolder} className="row" style={{ gap: 6, marginTop: 8 }}>
          <input className="input" style={{ height: 28 }} placeholder="New folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} aria-label="New folder name" />
          <button className="btn" type="submit" disabled={!newFolder.trim()}>Add</button>
        </form>
        <p className="hint" style={{ marginTop: 10 }}>Only you can see your folders. Saving a task does not share it with anyone.</p>
      </nav>

      <section className="saved-main">
        {!folder && (
          <div className="saved-empty">
            <Icon.bookmark width={22} height={22} />
            <h2>Keep tasks and links in folders</h2>
            <p className="hint">Create a folder on the left, for example “Brand guides” or “This month”. Then add links here, or open any task and press <b>Save</b>.</p>
          </div>
        )}
        {folder && (
          <>
            <div className="row" style={{ gap: 8, marginBottom: 14 }}>
              {renaming !== null
                ? <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); run(() => api(`/saved/folders/${folder.id}`, { method: 'PATCH', body: { name: renaming } }), 'Folder renamed').then(() => setRenaming(null)); }}>
                    <input className="input" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="Folder name" style={{ width: 240 }} />
                    <button className="btn primary sm" type="submit">Save</button>
                    <button className="btn ghost sm" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                : <h2 style={{ margin: 0 }}>{folder.name}</h2>}
              <span style={{ flex: 1 }} />
              {renaming === null && <button className="btn ghost sm" onClick={() => setRenaming(folder.name)}>Rename</button>}
              <button className="btn ghost sm" onClick={() => {
                if (window.confirm(`Delete “${folder.name}” and the ${folder.items.length} saved item(s) in it? Tasks themselves are not affected.`)) run(() => api(`/saved/folders/${folder.id}`, { method: 'DELETE' }), 'Folder deleted');
              }}><Icon.trash width={13} height={13} /> Delete folder</button>
            </div>

            <form className="saved-add" onSubmit={addLink}>
              <Icon.link />
              <input className="input" placeholder="Paste a link (https://…)" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} aria-label="Link" required />
              <input className="input" placeholder="Name (optional)" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} aria-label="Link name" />
              <button className="btn primary" type="submit">Save link</button>
            </form>

            <div className="list">
              {!folder.items.length && <div className="list-empty">Nothing here yet. Add a link above, or open a task and press Save.</div>}
              {folder.items.map((it) => (
                <SavedRow key={it.id} item={it} folders={folders} folderId={folder.id} openTask={openTask} run={run} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SavedRow({ item, folders, folderId, openTask, run }) {
  const t = item.task;
  const open = () => (item.kind === 'link' ? window.open(item.url, '_blank', 'noopener') : t && openTask(t.id));
  return (
    <div className="list-row saved-row" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && open()}>
      {item.kind === 'link' ? <Icon.link /> : t ? <StageIcon stage={t.stage} /> : <Icon.lock />}
      <div style={{ minWidth: 0 }}>
        {item.kind === 'link' && <><div className="t">{item.title} <Icon.external width={11} height={11} /></div><div className="c ellipsis">{item.url}</div></>}
        {item.kind === 'task' && t && <><div className="t"><span className="hint">{taskKey(t)}</span> {t.title}</div><div className="c">{t.client.name} · {t.project.name}</div></>}
        {item.kind === 'task' && !t && <><div className="t">{item.title}</div><div className="c">You no longer have access to this task, or it was removed.</div></>}
      </div>
      {item.kind === 'task' && t
        ? <span className="row" style={{ gap: 12, minWidth: 0 }}><StatusLine task={t} compact /><Due date={t.due_date} stage={t.stage} /></span>
        : <span className="hint">Saved {ago(item.created_at)}</span>}
      <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {folders.length > 1 && (
          <select className="filter" aria-label="Move to folder" value={folderId} onChange={(e) => run(() => api(`/saved/items/${item.id}`, { method: 'PATCH', body: { folder_id: Number(e.target.value) } }), 'Moved')}>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.id === folderId ? 'Move to…' : f.name}</option>)}
          </select>
        )}
        <button className="icon-btn" title="Remove from folder" aria-label="Remove from folder" onClick={() => run(() => api(`/saved/items/${item.id}`, { method: 'DELETE' }), 'Removed')}><Icon.trash /></button>
      </span>
    </div>
  );
}
