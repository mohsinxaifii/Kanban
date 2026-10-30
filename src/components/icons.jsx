const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

// One quiet colour for every stage; the circle's fill shows how far along it is.
export const STAGE_COLORS = {
  backlog: 'var(--faint)', planned: 'var(--muted)', in_progress: 'var(--text-2)', in_review: 'var(--text-2)',
  changes_requested: 'var(--text-2)', ready_to_deliver: 'var(--text)', delivered: 'var(--text)',
};

// Linear-style progress circles for each workflow stage.
export function StageIcon({ stage, size = 14 }) {
  const c = STAGE_COLORS[stage] || '#999';
  const r = 5.5;
  const circ = 2 * Math.PI * 3;
  const pie = (frac) => <circle cx="7" cy="7" r="3" fill="none" stroke={c} strokeWidth="6" strokeDasharray={`${circ * frac} ${circ}`} transform="rotate(-90 7 7)" />;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" style={{ flex: 'none' }}>
      {stage === 'backlog' && <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="2 2" />}
      {stage === 'planned' && <circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />}
      {stage === 'in_progress' && <><circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />{pie(0.5)}</>}
      {stage === 'in_review' && <><circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />{pie(0.75)}</>}
      {stage === 'changes_requested' && <><circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" /><path d="M7 4v3.6M7 9.6v.2" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></>}
      {stage === 'ready_to_deliver' && <><circle cx="7" cy="7" r={r} fill="none" stroke={c} strokeWidth="1.5" />{pie(0.92)}</>}
      {stage === 'delivered' && <><circle cx="7" cy="7" r="6.2" fill={c} /><path d="M4.4 7.2l1.8 1.8 3.4-3.6" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }) {
  const label = { urgent: 'Urgent', high: 'High priority', medium: 'Medium priority', low: 'Low priority' }[priority];
  if (priority === 'urgent') {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={label}><title>{label}</title>
        <rect x="1" y="1" width="12" height="12" rx="3" style={{ fill: 'var(--blocked)' }} /><path d="M7 3.8v3.8M7 9.8v.2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  const n = { high: 3, medium: 2, low: 1 }[priority] || 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" role="img" aria-label={label}><title>{label}</title>
      {[0, 1, 2].map((i) => <rect key={i} x={2 + i * 4} y={9 - i * 3} width="2.6" height={3 + i * 3} rx="0.8" style={{ fill: i < n ? 'var(--text-2)' : 'var(--border-strong)' }} />)}
    </svg>
  );
}

export const Icon = {
  board: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><rect x="2" y="2.5" width="3.4" height="11" rx="1" /><rect x="6.3" y="2.5" width="3.4" height="7" rx="1" /><rect x="10.6" y="2.5" width="3.4" height="9" rx="1" /></svg>,
  inbox: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M2 9.5l1.6-6h8.8L14 9.5V13H2z" /><path d="M2 9.5h3.5l1 1.5h3l1-1.5H14" /></svg>,
  calendar: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.8v2.4M10.5 1.8v2.4" /></svg>,
  check: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="8" r="6" /><path d="M5.3 8.2l1.8 1.8 3.6-3.8" /></svg>,
  team: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.5c.4-2.4 2.1-3.7 4.2-3.7s3.8 1.3 4.2 3.7" /><circle cx="11.3" cy="6" r="1.8" /><path d="M11 9.8c1.7 0 3 1 3.3 3" /></svg>,
  bell: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M4 11V7.2a4 4 0 018 0V11l1 1.5H3z" /><path d="M6.6 14h2.8" /></svg>,
  plus: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M8 3v10M3 8h10" /></svg>,
  close: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M4 4l8 8M12 4l-8 8" /></svg>,
  more: (p) => <svg viewBox="0 0 16 16" {...p}><circle cx="3.5" cy="8" r="1.2" fill="currentColor" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" /></svg>,
  clock: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>,
  flag: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M3.5 14V2.5M3.5 3h8l-1.6 3 1.6 3h-8" /></svg>,
  lock: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1.3" /><path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" /></svg>,
  drive: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M5.6 2.5h4.8l4 7-2.4 4H4l-2.4-4z" /><path d="M5.6 2.5l4 7h4.8M10.4 2.5l-6.4 11M1.6 9.5h8" /></svg>,
  external: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v3a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1h3" /></svg>,
  info: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="8" r="6" /><path d="M8 7.2v3.8M8 5v.1" /></svg>,
  warn: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M8 2.2l6.2 11H1.8z" /><path d="M8 6.5v3M8 11.4v.1" /></svg>,
  send: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" /></svg>,
  user: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="5.5" r="2.6" /><path d="M3 14c.5-2.8 2.5-4.2 5-4.2s4.5 1.4 5 4.2" /></svg>,
  logout: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M6 13.5H3.5a1 1 0 01-1-1v-9a1 1 0 011-1H6M10.5 11l3-3-3-3M13.5 8H6" /></svg>,
  bookmark: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M4 2.5h8v11L8 10.8 4 13.5z" /></svg>,
  folder: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M2 4.2a1 1 0 011-1h3l1.5 1.6H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1z" /></svg>,
  link: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.8-.8" /></svg>,
  help: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3a1.8 1.8 0 013.4.7c0 1.2-1.7 1.4-1.7 2.5M8 11.4v.1" /></svg>,
  trash: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" /></svg>,
  download: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M8 2.5v8M4.8 7.5L8 10.7l3.2-3.2M2.8 13.5h10.4" /></svg>,
  settings: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></svg>,
  filter: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></svg>,
  sparkle: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M12 4l-1.8 1.8M5.8 10.2L4 12" /></svg>,
  search: (p) => <svg viewBox="0 0 16 16" {...S} {...p}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>,
};
