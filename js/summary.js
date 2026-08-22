// The rolling pay-cycle window: pick a date, get the month that ends on it.
//
// "August 2nd" means July 2nd → August 2nd, with both end days counted. When the
// anchor day does not exist in the previous month (March 31st → February) the
// start clamps to that month's last day.

import { addMonths, formatLong } from './dates.js';
import { sum } from './money.js';

export function windowRange(anchorISO) {
  return { start: addMonths(anchorISO, -1), end: anchorISO };
}

export function computeWindow(store, anchorISO) {
  const { start, end } = windowRange(anchorISO);
  const entries = store.entriesBetween(start, end);
  return {
    start,
    end,
    entries,
    count: entries.length,
    gross: sum(entries.map((e) => e.gross ?? 0)),
    net: sum(entries.map((e) => e.net ?? 0)),
  };
}

export function describeRange({ start, end }) {
  return `${formatLong(start)} → ${formatLong(end)} (both days included)`;
}
