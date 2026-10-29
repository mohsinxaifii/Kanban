import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ago } from './api.js';
import { AppCtx, Avatar, usePopover } from './components/ui.jsx';
import { Icon } from './components/icons.jsx';
import { Login, AcceptInvite, Join } from './views/Auth.jsx';
import { Board } from './views/Board.jsx';
import { MyWork } from './views/MyWork.jsx';
import { Planner } from './views/Planner.jsx';
import { Approvals } from './views/Approvals.jsx';
import { Settings } from './views/Team.jsx';
import { TaskPanel } from './views/TaskPanel.jsx';
import { NewTask } from './views/NewTask.jsx';
import { Saved } from './views/Saved.jsx';
import { Tour } from './components/Tour.jsx';

// Hash routes: #/join/<token> (team sign-up link), #/board, #/my-work, #/planner, #/approvals, #/saved, #/settings (old #/team still works), #/invite/<token>; ?task=<id> opens the panel.
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

  if (route.path.startsWith('/join/')) return <Join token={route.path.split('/')[2]} />;
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
  const [touring, setTouring] = useState(!me.tour_done);

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
  const requests = meta.pendingRequests || 0;
  const myApprovals = tasks.filter((t) => t.next_action?.kind === 'approve' && t.next_action.user?.id === me.id).length;

  const views = {
    '/board': { title: 'Team Board', el: <Board /> },
    '/my-work': { title: 'My Work', el: <MyWork /> },
    '/planner': { title: 'Weekly Planner', el: <Planner /> },
    '/approvals': { title: 'Approvals', el: <Approvals /> },
    '/saved': { title: 'Saved', el: <Saved /> },
    '/settings': { title: 'Settings', el: <Settings /> },
  };
  const view = views[route.path === '/team' ? '/settings' : route.path] || views['/board'];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img src="/dd-logo.png" alt="Design Dimensions" />
            <span className="workspace-label">Creative production{me.is_demo ? ' · Demo workspace' : ''}</span>
          </div>
          {ctx.can('tasks.create') && (
            <button className="btn" data-tour="new-task" style={{ justifyContent: 'flex-start', margin: '0 0 8px' }} onClick={() => setCreating(true)}><Icon.plus /> New task</button>
          )}
          <NavItem tour="my-work" path="/my-work" route={route} icon={Icon.inbox} label="My Work" count={myActions} hot={myActions > 0} />
          <NavItem tour="approvals" path="/approvals" route={route} icon={Icon.check} label="Approvals" count={myApprovals} hot={myApprovals > 0} />
          <div className="nav-section">Workspace</div>
          <NavItem tour="board" path="/board" route={route} icon={Icon.board} label="Team Board" />
          <NavItem tour="planner" path="/planner" route={route} icon={Icon.calendar} label="Weekly Planner" />
          <NavItem tour="saved" path="/saved" route={route} icon={Icon.bookmark} label="Saved" />
          <div className="sidebar-spacer" />
          <button className="nav-item" data-tour="help" onClick={() => setTouring(true)}><Icon.help /> Take the tour</button>
          <NavItem tour="settings" path="/settings" route={route} icon={Icon.settings} label="Settings" count={requests} hot={requests > 0} />
          <Notifications items={notifications} reload={reloadNotifications} openTask={openTask} canManage={ctx.can('users.manage')} />
          <div className="me">
            <Avatar user={me} size="lg" />
            <div className="who"><b>{me.name}</b><span>{me.title}{me.is_demo ? ' · demo account' : ''}</span></div>
            <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setMe(null); }}><Icon.logout /></button>
          </div>
        </aside>
        <main className="main">
          <div className="topbar">
            <h1>{view.title}</h1>
            <select className="mobile-nav select" aria-label="Go to view" value={route.path === '/team' ? '/settings' : route.path} onChange={(e) => go(e.target.value)}>
              {Object.entries(views).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
            </select>
            <span className="grow" />
            {ctx.can('work.oversee') && <ExportReport />}
            <LiveDot />
          </div>
          <div className="content">{view.el}</div>
        </main>
      </div>
      {taskId && <TaskPanel id={taskId} onClose={() => openTask(null)} />}
      {touring && <Tour onDone={() => { setTouring(false); setMe((m) => ({ ...m, tour_done: 1 })); }} />}
      {creating && <NewTask onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); openTask(t.id); }} />}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>)}</div>
    </AppCtx.Provider>
  );
}

function NavItem({ path, route, icon: I, label, count, hot, tour }) {
  const active = route.path === path || (path === '/settings' && route.path === '/team') || (path === '/board' && !['/my-work', '/planner', '/approvals', '/saved', '/team', '/settings'].includes(route.path));
  return (
    <a data-tour={tour} className={`nav-item ${active ? 'active' : ''}`} href={`#${path}`} aria-current={active ? 'page' : undefined}>
      <I /> {label} {count > 0 && <span className={`count ${hot ? 'hot' : ''}`}>{count}</span>}
    </a>
  );
}

// Status report for people who oversee the team: a spreadsheet of where every task is,
// who it is waiting on and for how long, and how it stands against its deadline.
function ExportReport() {
  const pop = usePopover();
  const link = (delivered) => `/api/reports/status.csv${delivered ? '?delivered=1' : ''}`;
  return (
    <div className="picker" ref={pop.ref} style={{ display: 'inline-block', marginRight: 12 }}>
      <button className="btn sm" data-tour="export" onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open} aria-haspopup="menu"><Icon.download width={13} height={13} /> Export report</button>
      {pop.open && (
        <div className="pop" role="menu" style={{ top: 'calc(100% + 4px)', right: 0, width: 300 }}>
          <div className="menu-head">Status report (spreadsheet)</div>
          <a className="menu-item" role="menuitem" href={link(false)} download onClick={() => pop.setOpen(false)} style={{ textDecoration: 'none', color: 'inherit' }}>Open tasks</a>
          <a className="menu-item" role="menuitem" href={link(true)} download onClick={() => pop.setOpen(false)} style={{ textDecoration: 'none', color: 'inherit' }}>Open and delivered tasks</a>
          <div className="hint" style={{ padding: '6px 8px 4px' }}>Each task's stage, who it is waiting on and for how many days, and its deadline status. Opens in Excel, Numbers or Google Sheets.</div>
        </div>
      )}
    </div>
  );
}

function LiveDot() {
  return <span className="hint" title="Changes from teammates appear automatically" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 3, background: '#30a46c' }} />Live</span>;
}

function Notifications({ items, reload, openTask, canManage }) {
  const pop = usePopover();
  const unread = items.filter((n) => !n.read).length;
  return (
    <div ref={pop.ref}>
      <button className="nav-item" data-tour="notifications" onClick={() => pop.setOpen((o) => !o)} aria-expanded={pop.open}>
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
              onClick={async () => { await api('/notifications/read', { method: 'POST', body: { id: n.id } }); reload(); pop.setOpen(false); if (n.task_id) openTask(n.task_id); else if (canManage && n.message.includes('asked to join')) go('/settings'); }}>
              <span>{n.message}</span><time>{ago(n.created_at)}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
