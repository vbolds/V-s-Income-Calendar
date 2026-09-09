// Money helpers. Amounts are stored in the JSON file as plain decimal numbers
// (readable in git diffs), but every sum is done in integer cents so repeated
// additions never drift.

const LOCALE_BY_CURRENCY = {
  BRL: 'pt-BR',
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
};

// Accepts "1234.56", "1234,56", "1.234,56", "1,234.56", "R$ 1.234,56", "".
// Returns a number rounded to 2 decimals, or null when there is nothing usable.
export function parseAmount(input) {
  const n = parseNumber(input);
  return n == null ? null : round2(n);
}

// O câmbio não é dinheiro: 5,0588 tem quatro casas e arredondar para 5,06 erraria
// alguns reais no bruto. Mesma leitura de separadores, sem arredondar.
export function parseRate(input) {
  const n = parseNumber(input);
  return n == null || n <= 0 ? null : n;
}

function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input == null) return null;

  let s = String(input).trim().replace(/[^\d.,+-]/g, '');
  if (s === '' || s === '-' || s === '+') return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    // Both separators present: the right-most one is the decimal separator.
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    s = s.split(thousandsSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else {
    // One separator only, so it is ambiguous: "1.000" is a thousand in pt-BR but
    // one-point-nought in en-US. Money carries two decimals, so a group of
    // exactly three digits after the separator means thousands either way.
    const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
    if (sep) {
      const index = s.lastIndexOf(sep);
      const decimals = s.length - index - 1;
      const hasIntegerPart = /\d/.test(s.slice(0, index));
      if (decimals === 3 && hasIntegerPart) s = s.split(sep).join('');
      else if (sep === ',') s = s.replace(',', '.');
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Aceita uma soma escrita à mão — "393,89 + 393,89 + 393,89" — que é como as
// semanas da Upwork chegam. Um valor sozinho continua funcionando igual.
export function parseAmountSum(input) {
  if (input == null) return null;
  const parts = String(input).split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  let total = 0;
  let any = false;
  for (const part of parts) {
    const value = parseAmount(part);
    if (value == null) continue;
    total += value;
    any = true;
  }
  return any ? round2(total) : null;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function toCents(n) {
  return Math.round((Number(n) || 0) * 100);
}

export function sum(values) {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return cents / 100;
}

export function formatAmount(n, currency = 'BRL') {
  const value = Number(n) || 0;
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] || 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

// Dólares, para as linhas do extrato da Upwork.
export function formatUsd(n) {
  const value = Number(n) || 0;
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' }).format(value);
  } catch {
    return `US$ ${value.toFixed(2)}`;
  }
}

// Compact form for calendar day cells, e.g. "4,2 mil". The currency symbol is
// left out on purpose: day cells are narrow, especially on a phone, and the
// currency is already obvious from the totals and the table.
export function formatCompact(n, currency = 'BRL') {
  const value = Number(n) || 0;
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] || 'en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toFixed(0);
  }
}

// What goes into the editable table cells: plain digits with the locale's
// decimal separator, no currency symbol.
export function toInputString(n, currency = 'BRL') {
  if (n == null || n === '') return '';
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] || 'en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(Number(n) || 0);
  } catch {
    return (Number(n) || 0).toFixed(2);
  }
}
