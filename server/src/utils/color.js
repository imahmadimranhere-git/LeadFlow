// WCAG contrast helpers — used to make sure a tenant's brand colour stays readable.

function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 0;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';
const APP_BACKGROUND = '#0b0f0c'; // ink-900
export const MIN_CONTRAST = 3; // WCAG minimum for buttons, icons and large text

/** The accent is used for white button text AND for coloured text on the dark background → both must be readable. */
export function isReadableAccent(hex) {
  return contrastRatio(hex, WHITE) >= MIN_CONTRAST && contrastRatio(hex, APP_BACKGROUND) >= MIN_CONTRAST;
}
