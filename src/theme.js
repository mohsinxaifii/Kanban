// Appearance preferences, kept per device: theme ('system' | 'light' | 'dark'),
// text size and typeface. They are written to <html> as data attributes and a CSS
// variable, which the stylesheet keys off.
const KEYS = { theme: 'dd-theme', size: 'dd-text-size', font: 'dd-font' };
const DEFAULTS = { theme: 'system', size: 'default', font: 'inter' };
export const TEXT_SIZES = [
  { key: 'small', label: 'Small', scale: 0.92 },
  { key: 'default', label: 'Default', scale: 1 },
  { key: 'large', label: 'Large', scale: 1.1 },
  { key: 'xlarge', label: 'Extra large', scale: 1.22 },
];
export const FONTS = [
  { key: 'inter', label: 'Inter', note: 'Clean and compact (default)' },
  { key: 'system', label: 'System', note: 'Your device’s own font' },
  { key: 'rounded', label: 'Rounded', note: 'Softer, friendlier letters' },
  { key: 'serif', label: 'Serif', note: 'Classic, like print' },
];
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getPref(name) {
  try { return localStorage.getItem(KEYS[name]) || DEFAULTS[name]; } catch { return DEFAULTS[name]; }
}
export function applyAppearance() {
  const root = document.documentElement;
  const theme = getPref('theme');
  root.dataset.theme = theme === 'dark' || (theme === 'system' && media.matches) ? 'dark' : 'light';
  root.style.setProperty('--text-scale', String((TEXT_SIZES.find((s) => s.key === getPref('size')) || TEXT_SIZES[1]).scale));
  root.dataset.font = getPref('font');
}
export function setPref(name, value) {
  try { localStorage.setItem(KEYS[name], value); } catch { /* storage unavailable */ }
  applyAppearance();
}
media.addEventListener('change', () => applyAppearance());
