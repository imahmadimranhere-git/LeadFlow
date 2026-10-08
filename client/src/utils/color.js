// Brand colour helpers (white-label). The server makes the final readability check.
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Mix a colour with another: mix('#16a34a', '#000000', 0.15) = 15% darker */
export function mix(hex, other, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  if (!a || !b) return hex;
  return toHex(a.map((c, i) => c + (b[i] - c) * amount));
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isReadableAccent = (hex) => contrast(hex, '#ffffff') >= 3 && contrast(hex, '#0b0f0c') >= 3;

const VARS = ['--color-brand-50', '--color-brand-500', '--color-brand-600'];

/** Overrides the Tailwind brand colour variables for the whole app. null = back to default green. */
export function applyAccent(hex) {
  const root = document.documentElement;
  if (!hex || !hexToRgb(hex)) {
    VARS.forEach((v) => root.style.removeProperty(v));
    return;
  }
  root.style.setProperty('--color-brand-500', hex);
  root.style.setProperty('--color-brand-600', mix(hex, '#000000', 0.15));
  root.style.setProperty('--color-brand-50', mix(hex, '#ffffff', 0.9));
}
