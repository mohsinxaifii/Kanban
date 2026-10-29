import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ago } from './api.js';
import { AppCtx, Avatar, usePopover } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { Login, AcceptInvite } from './views/Auth.jsx';
import { Board } from './views/Board.jsx';
import { MyWork } from './views/MyWork.jsx';
import { Planner } from './views/Planner.jsx';
import { Approvals } from './views/Approvals.jsx';
import { Team } from './views/Team.jsx';
import { TaskPanel } from './views/TaskPanel.jsx';
import { NewTask } from './views/NewTask.jsx';

// Hash routes: #/board, #/my-work, #/planner, #/approvals, #/team, #/invite/<token>; ?task=<id> opens the panel.
function parseHash() {
  const h = window.location.hash.replace(/^#/, '') || '/board';
  const [path, query = ''] = h.split('?');
  return { path, params: new URLSearchParams(query) };
}
function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export function go(path, params) {
  const q = params && [...params.keys()].length ? `?${params}` : '';
  window.location.hash = `${path}${q}`;
}

export function App() {
  const route = useRoute();
  const [me, setMe] = useState(undefined);
  useEffect(() => { api('/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null)); }, []);

  if (route.path.startsWith('/invite/')) return <AcceptInvite token={route.path.split('/')[2]} onDone={(u) => { setMe(u); go('/my-work'); }} />;
  if (me === undefined) return null;
  if (!me) return <Login onLogin={(u) => { setMe(u); }} />;
  return <Workspace me={me} setMe={setMe} route={route} />;
}

function Workspace({ me, setMe, route }) {
  const [meta, setMeta] = useState(null);
  const [people, setPeople] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [version, setVersion] = useState(0); // bumps on every live update
  const [creating, setCreating] = useState(false);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6500 : 3500);
  }, []);
  const reloadPeople = useCallback(() => api('/people').then(setPeople), []);
  const reloadTasks = useCallback(() => api('/tasks').then(setTasks), []);
  const reloadNotifications = useCallback(() => api('/notifications').then(setNotifications), []);
  const reloadAll = useCallback(async () => {
    try {
      const [m, u] = await Promise.all([api('/meta'), api('/auth/me')]);
      setMeta(m); setMe(u.user);
      await Promise.all([reloadPeople(), reloadTasks(), reloadNotifications()]);
      setVersion((v) => v + 1);
    } catch (e) {
      if (e.status === 401) setMe(null);
    }
  }, [reloadPeople, reloadTasks, reloadNotifications, setMe]);

  useEffect(() => { reloadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates: the server only signals "something changed"; we refetch through the API.
  const timer = useRef(null);
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'notification') reloadNotifications();
      clearTimeout(timer.current);
      timer.current = setTimeout(reloadAll, 120);
    };
    return () => es.close();
  }, [reloadAll, reloadNotifications]);

  const openTask = useCallback((id) => {
    const p = new URLSearchParams(route.params);
    if (id) p.set('task', id); else p.delete('task');
    go(route.path, p);
  }, [route]);

  const ctx = useMemo(() => ({
    me, meta, people, tasks, version, toast, reloadAll, reloadPeople, reloadTasks, openTask,
    can: (perm) => me.permissions.includes(perm),
  }), [me, meta, people, tasks, version, toast, reloadAll, reloadPeople, reloadTasks, openTask]);

  if (!meta) return null;
  const taskId = Number(route.params.get('task')) || null;
  const myActions = tasks.filter((t) => t.next_action?.user?.id === me.id && t.view === 'full').length;
  const myApprovals = tasks.filter((t) => t.next_action?.kind === 'approve' && t.next_action.user?.id === me.id).length;

  const views = {
    '/board': { title: 'Team Board', el: <Board /> },
    '/my-work': { title: 'My Work', el: <MyWork /> },
    '/planner': { title: 'Weekly Planner', el: <Planner /> },
    '/approvals': { title: 'Approvals', el: <Approvals /> },
    '/team': { title: 'Team Settings', el: <Team /> },
  };
  const view = views[route.path] || views['/board'];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img src="/dd-logo.png" alt="Design Dimensions" />
            <span className="workspace-label">Creative production{me.is_demo ? ' · Demo workspace' : ''}</span>
          </div>
          {ctx.can('tasks.create') && (
            <button className="btn" style={{ justifyContent: 'flex-start', margin: '0 0 8px' }} onClick={() => setCreating(true)}><Icon.plus /> New task</button>
          )}
          <NavItem path="/my-work" route={route} icon={Icon.inbox} label="My Work" count={myActions} hot={myActions > 0} />
          <NavItem path="/approvals" route={route} icon={Icon.check} label="Approvals" count={myApprovals} hot={myApprovals > 0} />
          <div className="nav-section">Workspace</div>
          <NavItem path="/board" route={route} icon={Icon.board} label="Team Board" />
          <NavItem path="/planner" route={route} icon={Icon.calendar} label="Weekly Planner" />
          {ctx.can('users.manage') && <NavItem path="/team" route={route} icon={Icon.team} label="Team Settings" />}
          <div className="sidebar-spacer" />
          <Notifications items={notifications} reload={reloadNotifications} openTask={openTask} />
          <div className="me">
            <Avatar user={me} size="lg" />
            <div className="who"><b>{me.name}</b><span>{me.title}{me.is_demo ? ' · demo account' : ''}</span></div>
            <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); }}><Icon.logout /></button>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <h1>{view.title}</h1>
            <select className="mobile-nav select" aria-label="Go to view" value={route.path} onChange={(e) => go(e.target.value)}>
              {Object.entries(views).filter(([k]) => k !== '/team' || ctx.can('users.manage')).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
            </select>
            <span className="grow" />
            <LiveDot />
          </div>
          <div className="content">{route.path === '/team' && !ctx.can('users.manage') ? <div className="page">You do not have access to Team settings.</div> : view.el}</div>
        </main>
      </div>
      {taskId && <TaskPanel id={taskId} onClose={() => openTask(null)} />}
      {creating && <NewTask onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); openTask(t.id); }} />}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>)}</div>
    </AppCtx.Provider>
  );
}

function NavItem({ path, route, icon: I, label, count, hot }) {
  const active = route.path === path || (path === '/board' && !['/my-work', '/planner', '/approvals', '/team'].includes(route.path));
  return (
    <a className={`nav-item ${active ? 'active' : ''}`} href={`#${path}`} aria-current={active ? 'page' : undefined}>
      <I /> {label} {count > 0 && <span className={`count ${hot ? 'hot' : ''}`}>{count}</span>}
    </a>
  );
}

function LiveDot() {
  return <span className="hint" title="Changes from teammates appear automatically" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 3, background: '#30a46c' }} />Live</span>;
}

function Notifications({ items, reload, openTask }) {
  const pop = usePopover();
  const unread = items.filter((n) => !n.read).length;
  return (
    <div ref={pop.ref}>
      <button className="nav-item" onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open}>
        <Icon.bell /> Notifications {unread > 0 && <span className="count hot">{unread}</span>}
      </button>
      {pop.open && (
        <div className="pop notif-pop" role="dialog" aria-label="Notifications">
          <div className="row" style={{ padding: '4px 8px 6px' }}>
            <b style={{ flex: 1 }}>Notifications</b>
            {unread > 0 && <button className="btn ghost sm" onClick={async () => { await api('/notifications/read', { method: 'POST', body: { all: true } }); reload(); }}>Mark all read</button>}
          </div>
          {!items.length && <div className="picker-empty">Nothing yet.</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif ${n.read ? 'read' : 'unread'}`} role="button" tabIndex={0}
              onClick={async () => { await api('/notifications/read', { method: 'POST', body: { id: n.id } }); reload(); pop.setOpen(false); if (n.task_id) openTask(n.task_id); }}>
              <span>{n.message}</span><time>{ago(n.created_at)}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
