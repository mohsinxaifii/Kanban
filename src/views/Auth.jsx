import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/ui.jsx';

export function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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

  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/dd-logo.png" alt="Design Dimensions" />
        <h1>Sign in to the studio</h1>
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
  useEffect(() => { api(`/invite/${token}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);
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
            <div className="field"><label htmlFor="npw">Password</label><input id="npw" className="input" type="password" minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /><span className="hint">At least 10 characters.</span></div>
            {error && <div className="error-text" role="alert">{error}</div>}
            <button className="btn primary" type="submit">Activate account</button>
          </form>
        )}
      </div>
    </div>
  );
}
