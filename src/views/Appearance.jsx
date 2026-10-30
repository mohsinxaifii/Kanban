import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../components/ui.jsx';
import { getPref, setPref, TEXT_SIZES, FONTS } from '../theme.js';

// Personal look of the app. Saved on this device and browser only.
export function Appearance() {
  const [v, setV] = useState(() => ({ theme: getPref('theme'), size: getPref('size'), font: getPref('font') }));
  const choose = (name, value) => { setPref(name, value); setV({ ...v, [name]: value }); };
  const Choice = ({ name, value, children }) => (
    <button className="choice" aria-pressed={v[name] === value} onClick={() => choose(name, value)}>{children}</button>
  );
  return (
    <div className="appearance">
      <section>
        <h3>Theme</h3>
        <div className="hint">System follows your device's light or dark setting.</div>
        <div className="choice-row" role="group" aria-label="Theme">
          <Choice name="theme" value="light"><b>Light</b><small>Bright workspace</small></Choice>
          <Choice name="theme" value="dark"><b>Dark</b><small>Easier on the eyes at night</small></Choice>
          <Choice name="theme" value="system"><b>System</b><small>Match this device</small></Choice>
        </div>
      </section>
      <section>
        <h3>Text size</h3>
        <div className="choice-row" role="group" aria-label="Text size">
          {TEXT_SIZES.map((s) => <Choice key={s.key} name="size" value={s.key}><b style={{ fontSize: 13 * s.scale }}>{s.label}</b><small>{Math.round(s.scale * 100)}%</small></Choice>)}
        </div>
      </section>
      <section>
        <h3>Text style</h3>
        <div className="choice-row" role="group" aria-label="Text style">
          {FONTS.map((f) => (
            <Choice key={f.key} name="font" value={f.key}>
              <span className="sample" data-font-sample={f.key}>Aa</span><b>{f.label}</b><small>{f.note}</small>
            </Choice>
          ))}
        </div>
      </section>
      <section>
        <h3>Preview</h3>
        <div className="appearance-preview">
          <b>Aurora teaser cut-downs (15s and 6s)</b>
          <div className="hint">Halden Audio · Aurora headphones launch</div>
          <p style={{ margin: '8px 0 0' }}>Cut the 45s hero film into a 15s and a 6s version for paid social. End card: “Aurora. Hear the room.”</p>
        </div>
        <p className="hint">These settings are saved on this device and browser only.</p>
      </section>
    </div>
  );
}

// Settings → Your account: change your own password.
export function Account() {
  const { me, toast } = useApp();
  const [f, setF] = useState({ current: '', password: '', again: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setError('');
    if (f.password !== f.again) { setError('The two new passwords do not match.'); return; }
    try {
      await api('/me/password', { method: 'POST', body: { current: f.current, password: f.password } });
      setF({ current: '', password: '', again: '' });
      toast('Password changed. Other devices were signed out.');
    } catch (err) { setError(err.message); }
  }
  return (
    <div className="appearance">
      <section>
        <h3>{me.name}</h3>
        <div className="hint">{me.email} · {me.title || 'No job title'}</div>
      </section>
      <section>
        <h3>Change password</h3>
        <div className="hint">Forgot your current one? Sign out and use “Forgot password?”, or ask an administrator.</div>
        <form className="stack" style={{ maxWidth: 380, marginTop: 12 }} onSubmit={save}>
          <div className="field"><label htmlFor="a-cur">Current password</label><input id="a-cur" className="input" type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required /></div>
          <div className="field"><label htmlFor="a-new">New password</label><input id="a-new" className="input" type="password" minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} required /><span className="hint">At least 10 characters.</span></div>
          <div className="field"><label htmlFor="a-again">Repeat new password</label><input id="a-again" className="input" type="password" minLength={10} autoComplete="new-password" value={f.again} onChange={set('again')} required /></div>
          {error && <div className="error-text" role="alert">{error}</div>}
          <div><button className="btn primary" type="submit">Change password</button></div>
        </form>
      </section>
    </div>
  );
}
