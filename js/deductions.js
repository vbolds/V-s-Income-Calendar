// What comes off an income before it is money in hand.
//
// Every income is tithed at 10% of its gross — the dízimo is not something you
// tick per entry, it applies to all of them. Work billed through Upwork carries
// a further 15%. Both percentages are taken on the full gross and never
// compound on each other:
//
//   net = gross − 10% of gross − (15% of gross when it is Upwork)
//
// So a plain R$ 1.000 nets R$ 900, and R$ 1.000 through Upwork nets R$ 750.

import { round2 } from './money.js';

export const TITHE_RATE = 0.10;
export const UPWORK_RATE = 0.15;

// Each deduction is rounded to cents on its own, so the figures on screen always
// add up to the net beside them.
export function deductionsFor(entry) {
  const gross = entry && entry.gross != null ? round2(entry.gross) : null;
  if (gross == null) return { gross: null, tithe: 0, upwork: 0, net: null };

  const tithe = round2(gross * TITHE_RATE);
  const upwork = entry.upwork ? round2(gross * UPWORK_RATE) : 0;
  return { gross, tithe, upwork, net: round2(gross - tithe - upwork) };
}

export function netOf(entry) {
  return deductionsFor(entry).net;
}

// "R$ 1.000,00 − 10% dízimo R$ 100,00 − 15% Upwork R$ 150,00 = R$ 750,00"
export function describeDeductions(entry, formatAmount) {
  const d = deductionsFor(entry);
  if (d.gross == null) return 'No gross amount yet';
  const parts = [`${formatAmount(d.gross)} bruto`, `− dízimo 10% ${formatAmount(d.tithe)}`];
  if (d.upwork) parts.push(`− Upwork 15% ${formatAmount(d.upwork)}`);
  parts.push(`= ${formatAmount(d.net)}`);
  return parts.join(' ');
}
