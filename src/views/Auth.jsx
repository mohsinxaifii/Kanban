import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/ui.jsx';

const GOOGLE_ERRORS = {
  'no-account': 'There is no studio account for that Google email. Ask an administrator to invite you, then sign in with the invited email.',
  deactivated: 'This account has been deactivated.',
  'google-off': 'Google sign-in is not set up on this server yet.',
  'google-cancelled': 'Google sign-in was cancelled.',
  'google-state': 'That sign-in link expired. Please try again.',
  'google-unverified': 'Google has not verified that email address.',
  'google-token': 'Google sign-in failed. Please try again.',
  'google-exchange': 'Google sign-in failed. Please try again.',
};
const hashError = () => new URLSearchParams(window.location.hash.split('?')[1] || '').get('error');

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

  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/dd-logo.png" alt="Design Dimensions" />
        <h1>Sign in to the studio</h1>
        {demo?.google && <><GoogleButton /><div className="divider">or with email</div></>}
        <form className="stack" onSubmit={login}>
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary" type="submit" style={{ height: 32 }}>Sign in</button>
        </form>
        {demo?.enabled && demo.accounts.length > 0 && (
          <div className="demo-box">
            <div className="row"><span className="tag-demo">Demo</span><b>Fictional demo accounts</b></div>
            <div className="hint">Sample people and sample work for trying the workflow. They are not real accounts and can be removed in Team settings. Password for all: <code>{demo.password}</code></div>
            {demo.accounts.map((a, i) => (
              <button key={a.email} className="demo-user" onClick={() => login(null, { email: a.email, password: demo.password })}>
                <Avatar user={{ name: a.name, color: colors[i % colors.length] }} size="lg" />
                <span><b>{a.name}</b><br /><span className="hint">{a.title}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
    <div className="auth">
      <div className="auth-card">
        <img src="/dd-logo.png" alt="Design Dimensions" />
        {!info && error && <><h1>Invitation unavailable</h1><p className="hint">{error}</p><a href="#/board">Go to sign in</a></>}
        {info && (
          <form className="stack" onSubmit={submit}>
            <h1>Welcome, {info.name.split(' ')[0]}</h1>
            <p className="hint" style={{ margin: 0 }}>You were invited to the Design Dimensions studio as <b>{info.email}</b>. Choose a password to activate your account.</p>
            {google && <><GoogleButton label={`Continue with Google as ${info.email}`} /><div className="divider">or choose a password</div></>}
            <div className="field"><label htmlFor="npw">Password</label><input id="npw" className="input" type="password" minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /><span className="hint">At least 10 characters.</span></div>
            {error && <div className="error-text" role="alert">{error}</div>}
            <button className="btn primary" type="submit">Activate account</button>
          </form>
        )}
      </div>
    </div>
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
    <div className="auth">
      <div className="auth-card">
        <img src="/dd-logo.png" alt="Design Dimensions" />
        <form className="stack" onSubmit={submit}>
          <h1>Set up your studio</h1>
          <p className="hint" style={{ margin: 0 }}>The workspace is empty. Create the first administrator account. You can invite everyone else from Team Settings afterwards.</p>
          <div className="field"><label htmlFor="s-name">Your name</label><input id="s-name" className="input" autoComplete="name" value={f.name} onChange={set('name')} required /></div>
          <div className="field"><label htmlFor="s-email">Email</label><input id="s-email" className="input" type="email" autoComplete="username" value={f.email} onChange={set('email')} required /><span className="hint">Use your Google email if you want to sign in with Google later.</span></div>
          <div className="field"><label htmlFor="s-pw">Password</label><input id="s-pw" className="input" type="password" minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} required /><span className="hint">At least 10 characters.</span></div>
          <div className="field"><label htmlFor="s-code">Setup phrase</label><input id="s-code" className="input" autoComplete="off" value={f.code} onChange={set('code')} required /><span className="hint">The RESET_WORKSPACE value you entered in Render. It stops anyone else from claiming the workspace first.</span></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <button className="btn primary" type="submit" style={{ height: 32 }}>Create administrator</button>
        </form>
      </div>
    </div>
  );
}
