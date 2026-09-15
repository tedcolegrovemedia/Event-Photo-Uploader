/** Olive from the gallery design — the only colour on the page besides photos. */
export const DEFAULT_BUTTON_COLOR = '#8a9a2b';

/** "#abc", "abc", "#aabbcc" → "#aabbcc"; anything else → null. */
export function normalizeHexColor(input: string): string | null {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return '#' + raw.split('').map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(raw)) return '#' + raw;
  return null;
}

/**
 * Dark or light text for a given background, by WCAG relative luminance, so a
 * pale button gets dark text and a deep one gets white without the operator
 * having to think about it.
 */
export function contrastingText(hex: string): '#101010' | '#ffffff' {
  const n = parseInt(hex.slice(1), 16);
  const chan = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255);
  // Contrast against black is (l+0.05)/0.05; against white is 1.05/(l+0.05).
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#101010' : '#ffffff';
}
