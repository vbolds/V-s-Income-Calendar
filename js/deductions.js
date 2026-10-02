// Como uma renda vira dinheiro na conta.
//
// Duas formas de entrada:
//
//   kind: 'brl'     salário e afins. Você digita o bruto em reais.
//                   dízimo = 10% do bruto; livre = bruto − dízimo − imposto.
//
//   kind: 'upwork'  a transferência mensal. Quatro números, e só:
//
//                     A  o valor que a Upwork mostra para sacar
//                     B  a subscription fee do mês (US$ 19,99 de praxe)
//                     C  o VET da Wise
//                     D  o PTAX do dia anterior
//
// Daí sai tudo, nesta ordem:
//
//     valor de contrato   = (A + B) ÷ 0,85      recompõe os 15% da Upwork
//     base da nota        = contrato × D        é o que vai na nota fiscal
//     imposto            = base da nota × 4,77%
//     enviado à Wise      = A − 2,99            a taxa de transferência
//     caiu na conta       = enviado × C
//     dízimo              = A × C × 10%
//     livre para gastar   = caiu − imposto − dízimo
//
// A recomposição é DIVIDIR por 0,85, nunca multiplicar por 1,15: US$ 1.727,97 ÷
// 0,85 = US$ 2.032,91, enquanto ×1,15 daria US$ 1.987,16 e a nota sairia menor
// do que foi.
//
// Dois câmbios, cada um no seu lugar. O PTAX do dia anterior é o que a Receita
// manda usar na nota, então é ele que dá a base do imposto; o VET é o câmbio que
// a Wise de fato aplicou (já líquido de IOF e tarifa, por isso nada é descontado
// depois dele), e é ele que converte o que cai na conta e a base do dízimo.
//
// Repare que o dízimo sai do saque CHEIO (A × C), e não do que sobrou depois da
// taxa de transferência: os US$ 2,99 saem do seu lado, não do dízimo.

import { round2 } from './money.js';

export const DEFAULT_RATES = {
  serviceFee: 0.15,   // Upwork, sobre o valor de contrato
  withdrawal: 2.99,   // US$ fixos por transferência para a Wise
  subscription: 19.99, // US$ da subscription mensal — só o padrão do campo
  wiseFee: 0.0086,    // tarifa da Wise + IOF, já embutida no VET
  tithe: 0.10,        // dízimo
  tax: 0.0477,        // imposto do CNPJ, sobre a base da nota
};

// As regras mudaram nesta data: o imposto caiu de 6% para 4,77% e o dízimo
// passou a sair do saque, não da base da nota.
export const RULE_CHANGED_ON = '2026-09-29';
export const TITHE_RULE_CHANGED_ON = RULE_CHANGED_ON;

// Cada entrada congela as taxas de quando foi criada, para que mexer numa taxa
// hoje não reescreva o passado. A mudança de 29/09 é a exceção, e vale de lá em
// diante mesmo para o que já estava gravado: lançamentos daquela data em diante
// que ainda carreguem a alíquota velha passam para a nova.
//
// Isto é uma correção pontual, com data e valor antigo escritos na mão — não é
// "usar sempre a taxa de hoje". Uma mudança de alíquota futura volta a congelar
// normalmente, e nada antes de 29/09 é tocado.
const SUPERSEDED = [{ from: RULE_CHANGED_ON, key: 'tax', old: 0.06, now: 0.0477 }];

export function effectiveRates(entry, fallback = DEFAULT_RATES) {
  const rates = ratesFor(entry, fallback);
  if (!entry || !entry.date) return rates;

  let out = rates;
  for (const rule of SUPERSEDED) {
    if (entry.date < rule.from) continue;
    if (out[rule.key] !== rule.old) continue;
    out = { ...out, [rule.key]: rule.now };
  }
  return out;
}

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
  usdGross: null, billedUsed: false, usdFee: 0, usdSubscription: 0, usdWithdrawn: null,
  usdWithdrawal: 0, usdSent: null, nominal: null, notaRate: null, ptaxUsed: false,
  titheBase: null, gross: null, tithe: 0, tax: 0, landed: null, net: null,
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
  const rates = effectiveRates(entry, fallbackRates);
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
  // (A) o valor que a Upwork mostra para sacar, já sem os 15% e sem a
  // subscription. É daqui que sai tudo o que vira dinheiro na conta.
  const usdWithdrawn = entry.usdWithdrawn == null ? null : round2(entry.usdWithdrawn);
  const rate = entry.rate == null ? null : Number(entry.rate);
  if (usdWithdrawn == null || !Number.isFinite(rate)) return { ...EMPTY };

  // (B) a subscription do mês, que a Upwork já tirou antes de mostrar o saque.
  const usdSubscription = entry.usdSubscription == null ? 0 : round2(entry.usdSubscription);

  // (1) o valor de contrato: devolve a subscription e recompõe os 15%.
  // Um faturado informado à mão manda na frente da recomposição.
  const typed = entry.usdBilled == null ? null : round2(entry.usdBilled);
  const reconstructed = round2((usdWithdrawn + usdSubscription) / (1 - rates.serviceFee));
  const billedUsed = typed != null && typed > usdWithdrawn + usdSubscription;
  const usdGross = billedUsed ? typed : reconstructed;
  // Da subtração, para fechar sempre com as duas pontas que estão na tela.
  const usdFee = round2(usdGross - usdWithdrawn - usdSubscription);

  // (4) o que sai da Upwork rumo à Wise.
  const usdSent = round2(usdWithdrawn - rates.withdrawal);

  // (2) a base da nota, pelo PTAX do dia anterior. Sem PTAX — entradas de antes
  // do campo existir — sobra recompor o VET, que é só uma aproximação.
  const ptax = entry.ptax == null ? null : Number(entry.ptax);
  const ptaxUsed = Number.isFinite(ptax) && ptax > 0;
  const nominal = nominalRate(rate, rates);
  const notaRate = ptaxUsed ? ptax : nominal;
  const gross = round2(usdGross * notaRate);

  // (3) o imposto, da base da nota. (5) o que cai, pelo VET.
  const tax = taxOn(gross, entry, rates);
  const landed = round2(usdSent * rate);

  // (6) o dízimo. Pela regra de hoje sai do saque cheio convertido pelo VET —
  // os US$ 2,99 da transferência saem do seu lado, não do dízimo. Entradas
  // anteriores à mudança continuam tirando da base da nota.
  const fromGross = entry.titheBase === 'gross';
  const titheBase = fromGross ? gross : round2(usdWithdrawn * rate);
  const tithe = round2(titheBase * rates.tithe);

  return {
    usdGross,
    billedUsed,
    usdFee,
    usdSubscription,
    usdWithdrawn,
    usdWithdrawal: rates.withdrawal,
    usdSent,
    nominal,
    notaRate,
    ptaxUsed,
    titheBase,
    gross,
    tithe,
    tax,
    landed,
    // (7) livre para gastar.
    net: round2(landed - tax - tithe),
  };
}

// As linhas do extrato, para o preview no diálogo e para a dica na tabela.
export function statement(entry, fallbackRates = DEFAULT_RATES) {
  const c = computeEntry(entry, fallbackRates);
  const rates = effectiveRates(entry, fallbackRates);
  if (c.gross == null) return [];

  if (entry.kind !== 'upwork') {
    return [
      { label: 'Bruto', brl: c.gross },
      ...(c.tax ? [{ label: `Imposto ${pct(rates.tax)} do faturamento`, brl: -c.tax }] : []),
      { label: `Dízimo ${pct(rates.tithe)}`, brl: -c.tithe },
      { label: 'Livre para gastar', brl: c.net, total: true },
    ];
  }

  return [
    { label: 'Valor do saque', usd: entry.usdWithdrawn },
    ...(c.usdSubscription ? [{ label: 'Subscription fee', usd: c.usdSubscription }] : []),
    {
      label: c.billedUsed
        ? 'Valor de contrato (informado)'
        : `Valor de contrato (÷ ${(1 - rates.serviceFee).toFixed(2).replace('.', ',')})`,
      usd: c.usdGross,
      muted: true,
    },
    { label: `Service fee ${pct(rates.serviceFee)}`, usd: -c.usdFee, muted: true },
    { label: 'Taxa de transferência', usd: -c.usdWithdrawal },
    { label: 'Enviado para a Wise', usd: c.usdSent },
    { label: `Caiu na conta (VET ${formatRate(entry.rate)})`, brl: c.landed },
    {
      label: c.ptaxUsed
        ? `Base da nota (PTAX ${formatRate(c.notaRate)})`
        : `Base da nota (VET recomposto ${formatRate(c.notaRate)} — falta o PTAX)`,
      brl: c.gross,
      muted: true,
    },
    ...(c.tax ? [{ label: `Imposto ${pct(rates.tax)} da nota`, brl: -c.tax }] : []),
    {
      label: entry.titheBase === 'gross'
        ? `Dízimo ${pct(rates.tithe)} da nota`
        : `Dízimo ${pct(rates.tithe)} do saque`,
      brl: -c.tithe,
    },
    { label: 'Livre para gastar', brl: c.net, total: true },
  ];
}

function pct(rate) {
  return `${String(round2(rate * 100)).replace('.', ',')}%`;
}

export function formatRate(rate) {
  return Number.isFinite(Number(rate)) ? Number(rate).toFixed(4).replace('.', ',') : '—';
}
