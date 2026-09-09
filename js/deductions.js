// Como uma renda vira dinheiro na conta.
//
// Duas formas de entrada:
//
//   kind: 'brl'     salário e afins. Você digita o bruto em reais.
//                   dízimo = 10% do bruto; livre = bruto − dízimo.
//
//   kind: 'upwork'  a transferência mensal. Você digita o que a Upwork mostra
//                   como net das semanas (já sem a service fee) e o VET da Wise.
//                   O bruto é recomposto de trás pra frente para servir de base
//                   do dízimo.
//
// A recomposição é DIVIDIR por (1 − taxa), nunca multiplicar por (1 + taxa):
// US$ 393,89 ÷ 0,85 = US$ 463,40, que é o bruto do extrato. Multiplicar por 1,15
// daria US$ 452,97 e o dízimo sairia menor do que deveria.
//
// O VET da Wise já é líquido de IOF e tarifa (5,1028 vira 5,0588, os 0,86%), por
// isso nada mais é descontado depois da conversão.

import { round2 } from './money.js';

export const DEFAULT_RATES = {
  serviceFee: 0.15,   // Upwork, sobre o bruto
  withdrawal: 2.99,   // US$ fixos por transferência para a Wise
  tithe: 0.10,        // dízimo, sobre o bruto
};

export function ratesFor(entry, fallback = DEFAULT_RATES) {
  return { ...DEFAULT_RATES, ...fallback, ...(entry && entry.rates) };
}

const EMPTY = {
  usdGross: null, usdFee: 0, usdWithdrawal: 0, usdSent: null,
  gross: null, tithe: 0, landed: null, net: null,
};

// Devolve a conta inteira, arredondada centavo a centavo em cada etapa para que
// os números na tela sempre fechem com o total ao lado deles.
export function computeEntry(entry, fallbackRates = DEFAULT_RATES) {
  if (!entry) return { ...EMPTY };
  const rates = ratesFor(entry, fallbackRates);
  return entry.kind === 'upwork' ? computeUpwork(entry, rates) : computeBrl(entry, rates);
}

function computeBrl(entry, rates) {
  const gross = entry.gross == null ? null : round2(entry.gross);
  if (gross == null) return { ...EMPTY };

  const tithe = round2(gross * rates.tithe);
  return {
    ...EMPTY,
    gross,
    tithe,
    landed: gross,
    net: round2(gross - tithe),
  };
}

function computeUpwork(entry, rates) {
  const usdNet = entry.usdNet == null ? null : round2(entry.usdNet);
  const rate = entry.rate == null ? null : Number(entry.rate);
  if (usdNet == null || !Number.isFinite(rate)) return { ...EMPTY };

  const usdGross = round2(usdNet / (1 - rates.serviceFee));
  const usdSent = round2(usdNet - rates.withdrawal);
  const gross = round2(usdGross * rate);
  const tithe = round2(gross * rates.tithe);
  const landed = round2(usdSent * rate);

  return {
    usdGross,
    usdFee: round2(usdGross - usdNet),
    usdWithdrawal: rates.withdrawal,
    usdSent,
    gross,
    tithe,
    landed,
    net: round2(landed - tithe),
  };
}

// As linhas do extrato, para o preview no diálogo e para a dica na tabela.
export function statement(entry, fallbackRates = DEFAULT_RATES) {
  const c = computeEntry(entry, fallbackRates);
  const rates = ratesFor(entry, fallbackRates);
  if (c.gross == null) return [];

  if (entry.kind !== 'upwork') {
    return [
      { label: 'Bruto', brl: c.gross },
      { label: `Dízimo ${pct(rates.tithe)}`, brl: -c.tithe },
      { label: 'Livre para gastar', brl: c.net, total: true },
    ];
  }

  return [
    { label: 'Net na Upwork (semanas)', usd: entry.usdNet },
    { label: `Bruto recomposto (÷ ${(1 - rates.serviceFee).toFixed(2)})`, usd: c.usdGross, muted: true },
    { label: `Service fee ${pct(rates.serviceFee)}`, usd: -c.usdFee, muted: true },
    { label: 'Withdrawal fee', usd: -c.usdWithdrawal },
    { label: 'Enviado para a Wise', usd: c.usdSent },
    { label: `Caiu na conta (VET ${formatRate(entry.rate)})`, brl: c.landed },
    { label: `Dízimo ${pct(rates.tithe)} do bruto`, brl: -c.tithe },
    { label: 'Livre para gastar', brl: c.net, total: true },
  ];
}

function pct(rate) {
  return `${round2(rate * 100)}%`;
}

export function formatRate(rate) {
  return Number.isFinite(Number(rate)) ? Number(rate).toFixed(4).replace('.', ',') : '—';
}
