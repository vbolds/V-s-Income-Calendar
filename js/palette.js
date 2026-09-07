// A stable colour per category, worked out from its name rather than stored, so
// categories never need a colour picker and a category keeps its colour across
// devices and reloads.
//
// Only the hue varies. Saturation and lightness are fixed in the stylesheet, one
// pair per theme, which keeps every category legible in light and dark without
// hand-picking anything.

// Ten hues spaced an even 36° apart, so no two categories can land on shades of
// the same colour, listed out of order so that names hashing to neighbouring
// slots still come out far apart.
const HUES = [192, 12, 264, 84, 336, 156, 48, 228, 120, 300];

export function categoryHue(name) {
  if (!name) return null;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return HUES[hash % HUES.length];
}

// Ready to drop into a style attribute; empty for entries with no category.
export function hueStyle(name) {
  const hue = categoryHue(name);
  return hue == null ? '' : ` style="--cat-hue: ${hue}"`;
}
