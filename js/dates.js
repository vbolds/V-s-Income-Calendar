// Date helpers. Dates are plain "YYYY-MM-DD" strings everywhere in this app so
// that nothing depends on the browser's timezone.

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function todayISO() {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function isValidISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { y, m, d } = parseISO(iso);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 0 = Sunday … 6 = Saturday
export function weekdayOf(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Shifts by whole months, clamping the day to the target month's length so that
// e.g. 2026-03-31 minus one month lands on 2026-02-28.
export function addMonths(iso, n) {
  const { y, m, d } = parseISO(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// ISO date strings compare correctly with plain string comparison.
export function isBetweenInclusive(iso, startISO, endISO) {
  return iso >= startISO && iso <= endISO;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatLong(iso) {
  const { y, m, d } = parseISO(iso);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}
