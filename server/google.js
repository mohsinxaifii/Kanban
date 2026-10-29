// "Continue with Google" (OAuth 2.0 authorization code flow, OpenID Connect).
// Google only proves who someone is. It never creates an account or grants access:
// the email must already belong to an invited or active person in Team settings.
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token'; // override only for tests

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const redirectUri = (publicUrl) => `${publicUrl}/api/auth/google/callback`;

export function startUrl(publicUrl) {
  const state = crypto.randomBytes(16).toString('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(publicUrl),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${params}`, state, nonce };
}

// Exchanges the code and returns the verified email. The ID token comes straight
// from Google's token endpoint over TLS, authenticated with our client secret,
// so its claims can be trusted without a separate signature check.
export async function finish(code, publicUrl, expectedNonce) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(publicUrl),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('google-exchange');
  const { id_token: idToken } = await r.json();
  const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString('utf8'));
  const issuerOk = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  if (!issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.nonce !== expectedNonce || claims.exp * 1000 < Date.now()) {
    throw new Error('google-token');
  }
  if (!claims.email || claims.email_verified !== true) throw new Error('google-unverified');
  return { email: String(claims.email).toLowerCase(), name: claims.name || '' };
}
