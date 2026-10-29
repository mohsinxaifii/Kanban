export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dd-studio' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- formatting helpers ----------
const DAY = 864e5;
export const todayISO = () => toISODate(new Date());
export function toISODate(d) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function startOfWeek(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  return x;
}
export function weekBucket(iso) {
  if (!iso) return 'none';
  const d = parseDate(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d < today) return 'overdue';
  const w0 = startOfWeek();
  const w1 = new Date(w0.getTime() + 7 * DAY);
  const w2 = new Date(w0.getTime() + 14 * DAY);
  if (d < w1) return 'this';
  if (d < w2) return 'next';
  return 'later';
}
export function fmtDate(iso, opts = {}) {
  if (!iso) return '';
  const d = iso.length === 10 ? parseDate(iso) : new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(opts.year ? { year: 'numeric' } : {}) });
}
export function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
export function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
export function dueState(iso, stage) {
  if (!iso || stage === 'delivered') return 'normal';
  const b = weekBucket(iso);
  if (b === 'overdue') return 'overdue';
  if (iso === todayISO()) return 'today';
  const d = parseDate(iso);
  if ((d - new Date()) / DAY < 2) return 'soon';
  return 'normal';
}
export const first = (u) => (u ? u.name.split(' ')[0] : '');
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const taskKey = (t) => `DD-${t.id}`;

// Plain-language status line used on cards, rows and the panel header.
export function statusLine(t) {
  const na = t.next_action || {};
  const who = first(na.user);
  switch (na.kind) {
    case 'blocked': return { tone: 'blocked', text: `Blocked · needs ${who || 'someone'}` };
    case 'approve': return { tone: 'waiting', text: `Waiting for ${who}'s approval` };
    case 'fix_access': return { tone: 'blocked', text: `Drive access problem · Next action: ${who}` };
    case 'deliver': return { tone: 'ready', text: t.recipient ? `Next action: ${who || 'unassigned'} · Deliver to ${first(t.recipient)}` : `Next action: ${who || 'unassigned'} · Recipient not set` };
    case 'revise': return { tone: 'changes', text: `Changes requested · Next action: ${who}` };
    case 'done': return { tone: 'done', text: t.recipient ? `Delivered to ${first(t.recipient)}` : 'Delivered' };
    default: return { tone: 'neutral', text: who ? `Next action: ${who}` : 'No one assigned' };
  }
}
