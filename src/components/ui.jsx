import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { initials, statusLine, dueState, fmtDate } from '../api.js';
import { Icon, StageIcon } from './icons.jsx';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function Avatar({ user, size = '' }) {
  if (!user) return <span className={`avatar empty ${size}`} aria-hidden="true">?</span>;
  return (
    <span className={`avatar ${size}`} style={{ background: user.color }} title={user.name} aria-hidden="true">
      {initials(user.name)}
    </span>
  );
}

export function Person({ user, size = 'xs', empty = 'Unassigned', demoTag = false }) {
  if (!user) return <span className="person" style={{ color: 'var(--faint)' }}><Avatar size={size} /> <span>{empty}</span></span>;
  return (
    <span className="person">
      <Avatar user={user} size={size} />
      <span>{user.name}</span>
      {user.status === 'invited' && <span className="chip outline" style={{ height: 16, fontSize: 10.5 }}>Invited</span>}
      {demoTag && user.is_demo && <span className="tag-demo">Demo</span>}
    </span>
  );
}

export function StatusLine({ task, compact }) {
  const s = statusLine(task);
  const na = task.next_action;
  return (
    <div className={`status-line ${s.tone}`}>
      {s.tone === 'blocked' ? <Icon.flag width={12} height={12} /> : s.tone === 'waiting' ? <Icon.clock width={12} height={12} /> : na?.user && s.tone !== 'done' ? <Avatar user={na.user} size="xs" /> : null}
      <span style={compact ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>{s.text}</span>
    </div>
  );
}

export function Due({ date, stage }) {
  if (!date) return null;
  const st = dueState(date, stage);
  const label = st === 'overdue' ? `Overdue · ${fmtDate(date)}` : st === 'today' ? 'Due today' : fmtDate(date);
  return <span className={`due ${st}`} title={`Deadline ${date}`}><Icon.calendar />{label}</span>;
}

// Closes when clicking outside or pressing Escape.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);
  return { open, setOpen, ref };
}

const LOCK_REASONS = {
  in_review: 'Submit a version',
  changes_requested: 'Reviewer only',
  ready_to_deliver: 'After approval',
  delivered: 'Record delivery',
};

// Accessible alternative to drag-and-drop. Locked stages say how they are reached.
export function StatusMenu({ task, onMove, allowedTargets, children, align = 'left' }) {
  const { meta } = useApp();
  const pop = usePopover();
  const targets = allowedTargets ?? meta.manualTargets;
  return (
    <div className="picker" ref={pop.ref} style={{ display: 'inline-block' }}>
      {children({ toggle: () => pop.setOpen((o) => !o), open: pop.open })}
      {pop.open && (
        <div className="pop" role="menu" style={{ top: 'calc(100% + 4px)', [align]: 0 }}>
          <div className="menu-head">Move to…</div>
          {meta.stages.map((s) => {
            const current = s.key === task.stage;
            const ok = !current && targets.includes(s.key);
            const why = current ? 'Current' : !ok ? (LOCK_REASONS[s.key] || 'Not permitted') : '';
            return (
              <button key={s.key} role="menuitem" className="menu-item" disabled={!ok}
                onClick={() => { pop.setOpen(false); onMove(s.key); }}>
                <StageIcon stage={s.key} /> {s.label}
                {why && <span className="why">{why}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><span className="grow">{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.close /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Notice({ children, tone = 'warn' }) {
  return (
    <div className={`notice ${tone === 'info' ? 'info' : ''}`} role="note">
      {tone === 'info' ? <Icon.info /> : <Icon.warn />}<div>{children}</div>
    </div>
  );
}
