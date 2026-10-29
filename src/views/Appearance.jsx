import { useState } from 'react';
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
