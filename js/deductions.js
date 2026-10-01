// Como uma renda vira dinheiro na conta.
//
// Duas formas de entrada:
//
//   kind: 'brl'     salário e afins. Você digita o bruto em reais.
//                   dízimo = 10% do bruto; livre = bruto − dízimo − imposto.
//
//   kind: 'upwork'  a transferência mensal. Você digita o que foi FATURADO na
//                   Upwork (o billed, antes de qualquer desconto), o que ela
//                   cobrou à parte no mês, o VET da Wise e o PTAX do dia
//                   anterior.
//
// A ordem dos descontos em dólar é a do extrato da Upwork, e ela importa porque
// a service fee é percentual e as outras duas são fixas:
//
//     faturado            2.032,90
//     − service fee 15%     304,94
//     = na Upwork         1.727,96
//     − outras cobranças     19,99   (subscription renewal, por exemplo)
//     = sacado            1.707,97
//     − withdrawal fee        2,99
//     = enviado à Wise    1.704,98
//
// Dois câmbios, cada um no seu lugar: o VET converte o que de fato cai na conta
// (ele já é líquido de IOF e tarifa, por isso nada mais é descontado depois), e
// o PTAX do dia anterior — o que a Receita manda usar na nota — converte o
// faturado para dar a base em reais do dízimo e do imposto.
//
// Dízimo e imposto saem do MESMO bruto, cada um sobre os 100%, nunca um sobre o
// outro: o imposto do CNPJ é sobre o faturamento, que é o valor da nota, e não
// sobre o que sobrou depois das taxas do caminho.

import { round2 } from './money.js';

export const DEFAULT_RATES = {
  serviceFee: 0.15,   // Upwork, sobre o bruto
  withdrawal: 2.99,   // US$ fixos por transferência para a Wise
  wiseFee: 0.0086,    // tarifa da Wise + IOF, já embutida no VET
  tithe: 0.10,        // dízimo, sobre o bruto
  tax: 0.06,          // imposto do CNPJ, sobre o faturamento — o mesmo bruto
};

// Só serve de reserva para entradas antigas, de antes do campo de PTAX: o VET é
// o câmbio já descontado da tarifa e do IOF (5,1028 vira 5,0588), então desfazer
// o desconto dá uma aproximação da cotação do dia.
export function nominalRate(vet, rates = DEFAULT_RATES) {
  if (!Number.isFinite(Number(vet))) return null;
  return Number(vet) / (1 - rates.wiseFee);
}

export function ratesFor(entry, fallback = DEFAULT_RATES) {
  return { ...DEFAULT_RATES, ...fallback, ...(entry && entry.rates) };
}

const EMPTY = {
  usdGross: null, usdFee: 0, usdCharges: 0, usdWithdrawn: null,
  usdWithdrawal: 0, usdSent: null, nominal: null, notaRate: null, ptaxUsed: false,
  gross: null, tithe: 0, tax: 0, landed: null, net: null,
};

// O imposto do CNPJ sai do faturamento, que é o valor da nota — o mesmo bruto
// que serve de base para o dízimo, e não o que sobra depois das taxas. Os dois
// percentuais mordem os mesmos 100%: nunca um sobre o outro.
function taxOn(gross, entry, rates) {
  return entry.taxed === false ? 0 : round2(gross * rates.tax);
}

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
  const tax = taxOn(gross, entry, rates);
  return {
    ...EMPTY,
    gross,
    tithe,
    tax,
    landed: gross,
    net: round2(gross - tithe - tax),
  };
}

function computeUpwork(entry, rates) {
  const usdBilled = entry.usdBilled == null ? null : round2(entry.usdBilled);
  const rate = entry.rate == null ? null : Number(entry.rate);
  if (usdBilled == null || !Number.isFinite(rate)) return { ...EMPTY };

  // Em dólar, na ordem do extrato: a fee percentual primeiro, depois as fixas.
  const usdFee = round2(usdBilled * rates.serviceFee);
  const usdCharges = entry.usdCharges == null ? 0 : round2(entry.usdCharges);
  const usdWithdrawn = round2(usdBilled - usdFee - usdCharges);
  const usdSent = round2(usdWithdrawn - rates.withdrawal);

  // A base da nota é o faturado pelo PTAX do dia anterior. Sem PTAX — entradas
  // de antes do campo existir — sobra recompor o VET, que é só uma aproximação.
  const ptax = entry.ptax == null ? null : Number(entry.ptax);
  const ptaxUsed = Number.isFinite(ptax) && ptax > 0;
  const nominal = nominalRate(rate, rates);
  const notaRate = ptaxUsed ? ptax : nominal;

  const gross = round2(usdBilled * notaRate);
  const tithe = round2(gross * rates.tithe);
  const tax = taxOn(gross, entry, rates);
  // O que entra na conta, esse sim, é convertido pelo VET.
  const landed = round2(usdSent * rate);

  return {
    usdGross: usdBilled,
    usdFee,
    usdCharges,
    usdWithdrawn,
    usdWithdrawal: rates.withdrawal,
    usdSent,
    nominal,
    notaRate,
    ptaxUsed,
    gross,
    tithe,
    tax,
    landed,
    net: round2(landed - tithe - tax),
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
      ...(c.tax ? [{ label: `Imposto ${pct(rates.tax)} do faturamento`, brl: -c.tax }] : []),
      { label: 'Livre para gastar', brl: c.net, total: true },
    ];
  }

  return [
    { label: 'Faturado na Upwork', usd: c.usdGross },
    { label: `Service fee ${pct(rates.serviceFee)}`, usd: -c.usdFee },
    ...(c.usdCharges ? [{ label: 'Outras cobranças', usd: -c.usdCharges }] : []),
    { label: 'Sacado da Upwork', usd: c.usdWithdrawn, muted: true },
    { label: 'Withdrawal fee', usd: -c.usdWithdrawal },
    { label: 'Enviado para a Wise', usd: c.usdSent },
    { label: `Caiu na conta (VET ${formatRate(entry.rate)})`, brl: c.landed },
    {
      label: c.ptaxUsed
        ? `Base da nota (PTAX ${formatRate(c.notaRate)})`
        : `Base da nota (VET recomposto ${formatRate(c.notaRate)} — falta o PTAX)`,
      brl: c.gross,
      muted: true,
    },
    { label: `Dízimo ${pct(rates.tithe)} do faturado`, brl: -c.tithe },
    ...(c.tax ? [{ label: `Imposto ${pct(rates.tax)} do faturamento`, brl: -c.tax }] : []),
    { label: 'Livre para gastar', brl: c.net, total: true },
  ];
}

function pct(rate) {
  return `${String(round2(rate * 100)).replace('.', ',')}%`;
}

export function formatRate(rate) {
  return Number.isFinite(Number(rate)) ? Number(rate).toFixed(4).replace('.', ',') : '—';
}
