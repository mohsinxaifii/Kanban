// Invitation emails through Resend (https://resend.com), which uses HTTPS rather than
// SMTP, so it also works on hosts that block outgoing mail ports (such as Render's free plan).
// Without RESEND_API_KEY nothing is sent and admins copy the invite link themselves.
const API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails'; // override only for tests

export const emailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendInvite({ to, name, inviter, url, publicUrl }) {
  if (!emailEnabled()) return { status: 'not_configured' };
  const first = name.split(' ')[0];
  const text = `Hi ${first},

${inviter} has invited you to the Design Dimensions studio, where the team plans, reviews and delivers creative work.

Accept your invitation and choose a password:
${url}

This link is just for you (${to}) and works once. If you were not expecting it, you can ignore this email.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1f;max-width:520px">
  <img src="${esc(publicUrl)}/dd-logo.png" alt="Design Dimensions" width="120" style="display:block;margin:0 0 20px">
  <p>Hi ${esc(first)},</p>
  <p>${esc(inviter)} has invited you to the <b>Design Dimensions studio</b>, where the team plans, reviews and delivers creative work.</p>
  <p style="margin:24px 0"><a href="${esc(url)}" style="background:#111114;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Accept invitation</a></p>
  <p style="color:#7a7c85;font-size:12px">Or paste this link into your browser:<br>${esc(url)}</p>
  <p style="color:#7a7c85;font-size:12px">This link is just for you (${esc(to)}) and works once. If you were not expecting it, you can ignore this email.</p>
</div>`;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: `${inviter} invited you to the Design Dimensions studio`, text, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return { status: 'sent' };
    const body = await res.json().catch(() => ({}));
    return { status: 'failed', error: body.message || `Email service answered ${res.status}` };
  } catch (e) {
    return { status: 'failed', error: e.name === 'TimeoutError' ? 'The email service did not respond.' : 'Could not reach the email service.' };
  }
}
