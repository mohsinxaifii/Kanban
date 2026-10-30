import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/ui.jsx';
import { Icon } from '../components/icons.jsx';

const GOOGLE_ERRORS = {
  'no-account': 'There is no studio account for that Google email. Ask an administrator to invite you, then sign in with the invited email.',
  deactivated: 'This account has been deactivated.',
  pending: 'Your request to join is waiting for an administrator to approve it.',
  'google-off': 'Google sign-in is not set up on this server yet.',
  'google-cancelled': 'Google sign-in was cancelled.',
  'google-state': 'That sign-in link expired. Please try again.',
  'google-unverified': 'Google has not verified that email address.',
  'google-token': 'Google sign-in failed. Please try again.',
  'google-exchange': 'Google sign-in failed. Please try again.',
};
const hashError = () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('error');

// Internal sign-in: logo, one card, a quiet backdrop.
export function AuthShell({ children }) {
  return (
    <div className="auth">
      <div className="auth-wrap">
        <img className="auth-logo" src="/dd-logo.png" alt="Design Dimensions" />
        <div className="auth-card">{children}</div>
        <p className="auth-foot">Internal workspace · Design Dimensions team only</p>
      </div>
    </div>
  );
}

function GoogleButton({ label = 'Continue with Google' }) {
  return (
    <a className="btn btn-google" href="/api/auth/google" style={{ textDecoration: 'none', color: 'var(--text)' }}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
      {label}
    </a>
  );
}

export function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(() => GOOGLE_ERRORS[hashError()] || '');
  const [demo, setDemo] = useState(null);
  const [forgot, setForgot] = useState(false);
  useEffect(() => { api('/auth/demo').then(setDemo).catch(() => {}); }, []);

  async function login(e, creds) {
    e?.preventDefault();
    setError('');
    try {
      const r = await api('/auth/login', { method: 'POST', body: creds || { email, password } });
      onLogin(r.user);
    } catch (err) { setError(err.message); }
  }
  const colors = ['#7c5cff', '#0d74ce', '#d6409f', '#12a594', '#f76b15', '#4b5563'];
  if (demo?.setup) return <Setup onLogin={onLogin} />;
  if (forgot) return <Forgot initialEmail={email} onBack={() => setForgot(false)} />;

  return (
    <AuthShell>
        <div>
          <span className="team-badge"><Icon.lock width={11} height={11} /> Team only</span>
          <h1>Sign in to the studio</h1>
          <p className="hint" style={{ margin: '4px 0 0' }}>Use your work email, or ask an administrator for access.</p>
        </div>
        {demo?.google && <><GoogleButton /><div className="divider">or with email</div></>}
        <form className="stack" onSubmit={login}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><div className="row"><label htmlFor="pw" className="label" style={{ flex: 1 }}>Password</label><button type="button" className="link-btn" onClick={() => setForgot(true)}>Forgot password?</button></div><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary lg" type="submit">Sign in</button>
        </form>
        {demo?.enabled && demo.accounts.length > 0 && (
          <div className="demo-box">
            <div className="row"><span className="tag-demo">Demo</span><b>Fictional demo accounts</b></div>
            <div className="hint">Click a person to sign in as them. Password for all: <code>{demo.password}</code></div>
            <div className="demo-grid">{demo.accounts.map((a, i) => (
              <button key={a.email} className="demo-user" onClick={() => login(null, { email: a.email, password: demo.password })}>
                <Avatar user={{ name: a.name, color: colors[i % colors.length] }} size="lg" />
                <span className="ellipsis"><b>{a.name}</b><br /><span className="hint">{a.title}</span></span>
              </button>
            ))}</div>
          </div>
        )}
    </AuthShell>
  );
}

function Forgot({ initialEmail, onBack }) {
  const [email, setEmail] = useState(initialEmail || '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try { await api('/auth/forgot', { method: 'POST', body: { email } }); setSent(true); } catch (err) { setError(err.message); }
    setBusy(false);
  }
  return (
    <AuthShell>
      {sent ? (
        <div className="stack">
          <div><h1>Check your inbox</h1><p className="hint" style={{ margin: '6px 0 0' }}>If <b>{email}</b> has a studio account, a link to choose a new password is on its way. It works for one hour. Not there? Check spam, or ask an administrator to set a password for you.</p></div>
          <button className="btn lg" onClick={onBack}>Back to sign in</button>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <div><h1>Forgot your password?</h1><p className="hint" style={{ margin: '6px 0 0' }}>Enter the email you sign in with and we'll send you a link to choose a new one.</p></div>
          <div className="field"><label htmlFor="f-email">Email</label><input id="f-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary lg" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <button type="button" className="link-btn" style={{ alignSelf: 'center' }} onClick={onBack}>Back to sign in</button>
        </form>
      )}
    </AuthShell>
  );
}

// The link from the "forgot password" email: #/reset/<token>
export function ResetPassword({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  useEffect(() => { api(`/reset/${token}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
  async function submit(e) {
    e.preventDefault();
    if (pw !== pw2) { setError('The two passwords do not match.'); return; }
    try { const r = await api(`/reset/${token}`, { method: 'POST', body: { password: pw } }); onDone(r.user); } catch (err) { setError(err.message); }
  }
  return (
    <AuthShell>
      {!info && error && <><h1>Link expired</h1><p className="hint">{error}</p><a className="btn lg" href="#/board" style={{ textDecoration: 'none' }}>Go to sign in</a></>}
      {info && (
        <form className="stack" onSubmit={submit}>
          <div><h1>Choose a new password</h1><p className="hint" style={{ margin: '6px 0 0' }}>For <b>{info.email}</b>. You'll be signed out on other devices.</p></div>
          <div className="field"><label htmlFor="r-pw">New password</label><input id="r-pw" className="input" type="password" minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /><span className="hint">At least 10 characters.</span></div>
          <div className="field"><label htmlFor="r-pw2">Repeat it</label><input id="r-pw2" className="input" type="password" minLength={10} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary lg" type="submit">Save and sign in</button>
        </form>
      )}
    </AuthShell>
  );
}

export function AcceptInvite({ token, onDone }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [google, setGoogle] = useState(false);
  useEffect(() => { api(`/invite/${token}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
  useEffect(() => { api('/auth/demo').then((d) => setGoogle(!!d.google)).catch(() => {}); }, []);
  async function submit(e) {
    e.preventDefault();
    try { const r = await api(`/invite/${token}`, { method: 'POST', body: { password: pw } }); onDone(r.user); } catch (err) { setError(err.message); }
  }
  return (
    <AuthShell>
        {!info && error && <><h1>Invitation unavailable</h1><p className="hint">{error}</p><a href="#/board">Go to sign in</a></>}
        {info && (
          <form className="stack" onSubmit={submit}>
            <h1>Welcome, {info.name.split(' ')[0]}</h1>
            <p className="hint" style={{ margin: 0 }}>You were invited to the Design Dimensions studio as <b>{info.email}</b>. Choose a password to activate your account.</p>
            {google && <><GoogleButton label={`Continue with Google as ${info.email}`} /><div className="divider">or choose a password</div></>}
            <div className="field"><label htmlFor="npw">Password</label><input id="npw" className="input" type="password" minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /><span className="hint">At least 10 characters.</span></div>
            {error && <div className="error-text" role="alert">{error}</div>}
            <button className="btn primary lg" type="submit">Activate account</button>
          </form>
        )}
    </AuthShell>
  );
}

// Shown only after RESET_WORKSPACE has emptied the workspace and nobody exists yet.
function Setup({ onLogin }) {
  const [f, setF] = useState({ name: '', email: '', password: '', code: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setError('');
    try { const r = await api('/auth/setup', { method: 'POST', body: f }); onLogin(r.user); } catch (err) { setError(err.message); }
  }
  return (
    <AuthShell>
        <form className="stack" onSubmit={submit}>
          <h1>Set up your studio</h1>
          <p className="hint" style={{ margin: 0 }}>The workspace is empty. Create the first administrator account. You can invite everyone else from Settings afterwards.</p>
          <div className="field"><label htmlFor="s-name">Your name</label><input id="s-name" className="input" autoComplete="name" value={f.name} onChange={set('name')} required /></div>
          <div className="field"><label htmlFor="s-email">Email</label><input id="s-email" className="input" type="email" autoComplete="username" value={f.email} onChange={set('email')} required /><span className="hint">Use your Google email if you want to sign in with Google later.</span></div>
          <div className="field"><label htmlFor="s-pw">Password</label><input id="s-pw" className="input" type="password" minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} required /><span className="hint">At least 10 characters.</span></div>
          <div className="field"><label htmlFor="s-code">Setup phrase</label><input id="s-code" className="input" autoComplete="off" value={f.code} onChange={set('code')} required /><span className="hint">The RESET_WORKSPACE value you entered in the server settings. It stops anyone else from claiming the workspace first.</span></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary lg" type="submit">Create administrator</button>
        </form>
    </AuthShell>
  );
}

// The shared team sign-up link. Creates a request only; an administrator approves it.
export function Join({ token }) {
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', email: '', title: '', password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { api(`/join/${token}`).then(() => setState('form')).catch((e) => { setError(e.message); setState('invalid'); }); }, [token]);
  async function submit(e) {
    e.preventDefault();
    setError('');
    try { await api(`/join/${token}`, { method: 'POST', body: f }); setState('sent'); } catch (err) { setError(err.message); }
  }
  return (
    <AuthShell>
        {state === 'invalid' && <><h1>Link not valid</h1><p className="hint">{error}</p><a href="#/board">Go to sign in</a></>}
        {state === 'sent' && (
          <div className="stack">
            <h1>Request sent</h1>
            <p className="hint" style={{ margin: 0 }}>Thanks, {f.name.split(' ')[0]}. An administrator will review your request and choose what you can access. Once they approve it you can sign in with <b>{f.email}</b> and the password you chose.</p>
            <a className="btn" href="#/board" style={{ textDecoration: 'none', justifyContent: 'center' }}>Go to sign in</a>
          </div>
        )}
        {state === 'form' && (
          <form className="stack" onSubmit={submit}>
            <h1>Join the Design Dimensions studio</h1>
            <p className="hint" style={{ margin: 0 }}>Tell us who you are. An administrator approves each request before you can sign in.</p>
            <div className="field"><label htmlFor="j-name">Full name</label><input id="j-name" className="input" autoComplete="name" value={f.name} onChange={set('name')} required /></div>
            <div className="field"><label htmlFor="j-email">Work email</label><input id="j-email" className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} required /><span className="hint">Use your Google email if you want to sign in with Google later.</span></div>
            <div className="field"><label htmlFor="j-title">Designation</label><input id="j-title" className="input" value={f.title} onChange={set('title')} placeholder="e.g. Video Editor, Graphic Designer" required /></div>
            <div className="field"><label htmlFor="j-pw">Password</label><input id="j-pw" className="input" type="password" minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} required /><span className="hint">At least 10 characters.</span></div>
            {error && <div className="error-text" role="alert">{error}</div>}
            <button className="btn primary lg" type="submit">Ask to join</button>
          </form>
        )}
    </AuthShell>
  );
}
