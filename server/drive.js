// Google Drive link handling. App permissions and Drive permissions are separate:
// nothing here changes sharing on a file, and nothing claims a reviewer can open it.

const PATTERNS = [
  { kind: 'file', re: /^https:\/\/drive\.google\.com\/file\/d\/([\w-]{10,})/ },
  { kind: 'folder', re: /^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]{10,})/ },
  { kind: 'file', re: /^https:\/\/drive\.google\.com\/open\?id=([\w-]{10,})/ },
  { kind: 'doc', re: /^https:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/([\w-]{10,})/ },
];

export function parseDriveLink(raw) {
  const link = String(raw || '').trim();
  for (const p of PATTERNS) {
    const m = link.match(p.re);
    if (m) return { link, kind: p.kind, driveId: m[1] };
  }
  return null;
}

export function previewUrl(sub) {
  if (!sub.drive_id) return null;
  if (sub.link_kind === 'folder') return `https://drive.google.com/embeddedfolderview?id=${sub.drive_id}#grid`;
  if (sub.link_kind === 'doc') {
    const m = sub.link.match(/docs\.google\.com\/(document|spreadsheets|presentation)\//);
    return `https://docs.google.com/${m[1]}/d/${sub.drive_id}/preview`;
  }
  return `https://drive.google.com/file/d/${sub.drive_id}/preview`;
}

export const driveIntegration = () => (process.env.GOOGLE_DRIVE_API_KEY ? 'api_key' : null);

// With an API key, Drive only answers for files shared as "anyone with the link".
// That tells us whether the link is open; it never proves a specific reviewer has access.
export async function checkLinkSharing(driveId) {
  const key = process.env.GOOGLE_DRIVE_API_KEY;
  if (!key) return { status: 'not_checked', detail: 'No Google Drive integration is configured, so access has not been checked.' };
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?fields=id,name,mimeType&supportsAllDrives=true&key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const f = await r.json();
      return { status: 'link_shared', detail: `Drive reports "${f.name}" is shared with anyone who has the link.` };
    }
    if (r.status === 404 || r.status === 403) {
      return { status: 'restricted', detail: 'Drive did not open this link anonymously. It is restricted, so each reviewer needs to be shared on it in Google Drive.' };
    }
    return { status: 'error', detail: `Drive check failed (HTTP ${r.status}). Access has not been verified.` };
  } catch (e) {
    return { status: 'error', detail: 'Drive check could not be completed. Access has not been verified.' };
  }
}
