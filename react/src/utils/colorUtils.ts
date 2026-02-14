// Team color utilities

/**
 * Generates a random saturated team color.
 * Avoids very dark or very light colors for good visibility.
 */
export function generateRandomTeamColor(): string {
  // Use HSL for better control over saturation and lightness
  const hue = Math.floor(Math.random() * 360);
  const saturation = 65 + Math.floor(Math.random() * 25); // 65-90%
  const lightness = 45 + Math.floor(Math.random() * 15);  // 45-60%

  return hslToHex(hue, saturation, lightness);
}

/**
 * Converts HSL values to a hex color string.
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generates a stroke color (darker version) from a fill color.
 */
export function generateStrokeColor(fillColor: string): string {
  // Parse hex color
  const r = parseInt(fillColor.slice(1, 3), 16);
  const g = parseInt(fillColor.slice(3, 5), 16);
  const b = parseInt(fillColor.slice(5, 7), 16);

  // Darken by 30%
  const darken = (c: number) => Math.max(0, Math.floor(c * 0.7));

  const toHex = (n: number) => {
    const hex = n.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(darken(r))}${toHex(darken(g))}${toHex(darken(b))}`;
}
