// Theme preference: 'system' | 'light' | 'dark'. The resolved theme is written to
// <html data-theme>, which the CSS tokens key off.
const KEY = 'dd-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getPreference() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}
export function applyTheme(pref = getPreference()) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
export function setPreference(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable */ }
  applyTheme(pref);
}
media.addEventListener('change', () => applyTheme());
