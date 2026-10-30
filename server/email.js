// Invitation emails through an ordinary mailbox over SMTP, such as one created in cPanel
// → Email Accounts on the same server. Without SMTP_HOST and EMAIL_FROM nothing is sent
// and admins copy the invite link themselves.
import nodemailer from 'nodemailer';

export const emailEnabled = () => !!(process.env.SMTP_HOST && process.env.EMAIL_FROM);

let transport;
function mailer() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transport;
}

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
  return sendEmail({ to, subject: `${inviter} invited you to the Design Dimensions studio`, text, html });
}

// A short notice to an administrator that someone used the sign-up link.
export async function sendSignupNotice({ to, adminName, person, publicUrl }) {
  const url = `${publicUrl}/#/settings`;
  const text = `Hi ${adminName.split(' ')[0]},

${person.name} (${person.email}) asked to join the Design Dimensions studio as "${person.title}".

They cannot sign in until you approve them. Review the request and choose their role and permissions in Settings:
${url}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1f;max-width:520px">
  <p>Hi ${esc(adminName.split(' ')[0])},</p>
  <p><b>${esc(person.name)}</b> (${esc(person.email)}) asked to join the Design Dimensions studio as <b>${esc(person.title)}</b>.</p>
  <p>They cannot sign in until you approve them.</p>
  <p style="margin:24px 0"><a href="${esc(url)}" style="background:#111114;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Review request</a></p>
</div>`;
  return sendEmail({ to, subject: `${person.name} asked to join the studio`, text, html });
}

// Tells someone their sign-up request was approved.
export async function sendApproved({ to, name, publicUrl }) {
  const text = `Hi ${name.split(' ')[0]},

Your request to join the Design Dimensions studio was approved. Sign in here:
${publicUrl}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1f;max-width:520px">
  <p>Hi ${esc(name.split(' ')[0])},</p>
  <p>Your request to join the <b>Design Dimensions studio</b> was approved.</p>
  <p style="margin:24px 0"><a href="${esc(publicUrl)}" style="background:#111114;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Sign in</a></p>
</div>`;
  return sendEmail({ to, subject: 'You can now sign in to the Design Dimensions studio', text, html });
}

async function sendEmail({ to, subject, text, html }) {
  if (!emailEnabled()) return { status: 'not_configured' };
  try {
    await mailer().sendMail({ from: process.env.EMAIL_FROM, to, subject, text, html });
    return { status: 'sent' };
  } catch (e) {
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(e.code)) return { status: 'failed', error: 'Could not reach the mail server.' };
    return { status: 'failed', error: e.response || e.message || 'The mail server refused the message.' };
  }
}
