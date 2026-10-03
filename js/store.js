// Application state: the entry list, what is currently on GitHub, and the local
// draft that protects unsaved edits from a crash or a closed tab.
//
// Two very different "saves" live here:
//   * saveDraft()  — writes to this browser only, costs nothing, no commit.
//   * the Save button (see app.js) — the only thing that commits to GitHub.

import { isValidISO, todayISO } from './dates.js';
import { DEFAULT_RATES, RULE_CHANGED_ON, effectiveRates, computeEntry } from './deductions.js';
import { round2 } from './money.js';

const CONFIG_KEY = 'incomeCalendar.config';
const TOKEN_KEY = 'incomeCalendar.token';
const DRAFT_KEY = 'incomeCalendar.draft';
const FILE_VERSION = 2;

export const DEFAULT_CONFIG = {
  owner: '',
  repo: '',
  path: 'data/entries.json',
  branch: 'main',
  currency: 'BRL',
};

/* ---------------- config + token (localStorage) ---------------- */

export function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch { /* private browsing with storage disabled */ }
}

export function loadToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function saveToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* ignore */ }
}

export function clearCredentials() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CONFIG_KEY);
  } catch { /* ignore */ }
}

/* ---------------- entries ---------------- */

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// (A) o valor que a Upwork mostra para sacar. Versões anteriores guardavam o
// valor de antes da subscription (usdNet) ou só o faturado (usdBilled); as duas
// convertem para cá sem perder nada, porque é a mesma cadeia por outro ponto de
// entrada.
function withdrawnOf(partial, fallbackRates) {
  if (partial.usdWithdrawn != null) return round2(partial.usdWithdrawn);
  const charges = partial.usdCharges != null ? round2(partial.usdCharges) : 0;
  if (partial.usdNet != null) return round2(partial.usdNet - charges);
  if (partial.usdBilled == null) return null;
  const fee = { ...DEFAULT_RATES, ...fallbackRates, ...(partial.rates || {}) }.serviceFee;
  return round2(partial.usdBilled * (1 - fee) - charges);
}

// (B) a subscription do mês. Antes se chamava "outras cobranças"; é a mesma
// linha. Sem nada dito, vale o padrão vigente — é o que ela é quase sempre.
function subscriptionOf(partial, fallbackRates) {
  if (partial.usdSubscription != null) return round2(partial.usdSubscription);
  if (partial.usdCharges != null) return round2(partial.usdCharges);
  return round2({ ...DEFAULT_RATES, ...fallbackRates, ...(partial.rates || {}) }.subscription);
}

export function makeEntry(partial = {}, fallbackRates = DEFAULT_RATES) {
  const date = partial.date || '';
  const kind = partial.kind === 'upwork' ? 'upwork' : 'brl';

  const base = {
    id: partial.id || newId(),
    date,
    source: partial.source || '',
    category: partial.category || '',
    kind,
    // Digitado: em reais quando é renda daqui, em dólar mais o VET quando vem
    // da Upwork.
    gross: kind === 'brl' && partial.gross != null ? round2(partial.gross) : null,
    usdWithdrawn: kind === 'upwork' ? withdrawnOf(partial, fallbackRates) : null,
    usdSubscription: kind === 'upwork' ? subscriptionOf(partial, fallbackRates) : null,
    // Opcional, só para a nota fiscal sair no centavo certo. Vazio, o valor de
    // contrato é reconstruído do saque mais a subscription.
    usdBilled: kind === 'upwork' && partial.usdBilled != null ? round2(partial.usdBilled) : null,
    // De qual base sai o dízimo. Vai pela data, e não por quando se digitou, e
    // fica gravado junto da entrada como as taxas: a regra de um lançamento é a
    // que valia no dia dele.
    titheBase: partial.titheBase === 'gross' || partial.titheBase === 'withdrawn'
      ? partial.titheBase
      : (date && date < RULE_CHANGED_ON ? 'gross' : 'withdrawn'),
    rate: kind === 'upwork' && partial.rate != null ? Number(partial.rate) : null,
    ptax: kind === 'upwork' && partial.ptax != null ? Number(partial.ptax) : null,
    // As taxas ficam gravadas na entrada: mudar uma taxa hoje não pode
    // reescrever o que já aconteceu. A exceção é a virada de 29/09, que vale
    // dali em diante mesmo para o que já estava gravado — e aqui ela é aplicada
    // à própria entrada, para o arquivo não dizer uma alíquota e usar outra.
    rates: effectiveRates(
      { date, rates: { ...DEFAULT_RATES, ...fallbackRates, ...(partial.rates || {}) } },
      fallbackRates,
    ),
    // Fica no base, e não lá embaixo, porque derive() precisa dele para saber
    // se desconta o imposto. Não dito quer dizer sim: toda renda que passa pelo
    // CNPJ é faturamento, e é o caso das que existem hoje — assim um arquivo
    // escrito antes do flag entra tributado, que é a realidade dele.
    taxed: partial.taxed === undefined ? true : partial.taxed === true,
  };

  return {
    ...base,
    // Tudo abaixo é calculado, nunca aceito de quem chama.
    ...derive(base),
    // Unstated means "decide from the date": money dated today or earlier has
    // normally arrived, money dated ahead is still expected. This is what makes
    // entry files written before the flag existed read sensibly.
    received: partial.received === undefined ? date <= todayISO() : partial.received === true,
    notes: partial.notes || '',
  };
}

// gross/tithe/landed/net saem sempre das regras, para não descolarem dos
// números de que são feitos.
function derive(entry) {
  const c = computeEntry(entry, entry.rates);
  return {
    gross: entry.kind === 'upwork' ? c.gross : entry.gross,
    usdGross: c.usdGross,
    usdSent: c.usdSent,
    tithe: c.tithe,
    tax: c.tax,
    landed: c.landed,
    net: c.net,
  };
}

// Every category currently in use, for the filter dropdown and the type-ahead
// suggestions, so categories never need a management screen of their own.
export function categoriesOf(entries) {
  const names = new Set();
  for (const entry of entries) {
    if (entry.category) names.add(entry.category);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// Entries with a bad shape are dropped rather than allowed to break the views;
// the count of what was dropped is reported so nothing disappears silently.
// Um período salvo é só um nome e duas datas. Nome vazio ou datas inválidas
// saem fora em silêncio: é uma conveniência, não pode quebrar a carga.
function parsePeriods(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name || !isValidISO(item.from) || !isValidISO(item.to)) continue;
    out.push({
      id: typeof item.id === 'string' ? item.id : newId(),
      name,
      from: item.from <= item.to ? item.from : item.to,
      to: item.from <= item.to ? item.to : item.from,
    });
  }
  return out;
}

export function parseFile(text) {
  if (!text || !text.trim()) {
    return { entries: [], dropped: 0, rates: { ...DEFAULT_RATES }, periods: [] };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The data file on GitHub is not valid JSON. Fix it on GitHub, then press Reload.');
  }

  const raw = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : null;
  if (!raw) throw new Error('The data file does not contain an "entries" list.');

  // As taxas vigentes moram no arquivo, não no navegador, para valerem em todos
  // os aparelhos. Elas só servem de padrão para entradas novas.
  const rates = { ...DEFAULT_RATES, ...(data.settings && data.settings.rates) };
  const periods = parsePeriods(data.settings && data.settings.periods);
  const entries = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !isValidISO(item.date)) {
      dropped += 1;
      continue;
    }
    // Campos calculados no arquivo são ignorados de propósito: tudo é refeito
    // pelas regras a cada carga. Arquivos antigos, que só tinham um bruto em
    // reais e um flag "upwork", entram como renda em reais — o formato Upwork
    // precisa do valor em dólar e do VET, que eles não têm.
    const kind = item.kind === 'upwork' ? 'upwork' : 'brl';
    entries.push(makeEntry({
      id: typeof item.id === 'string' ? item.id : undefined,
      date: item.date,
      source: typeof item.source === 'string' ? item.source : '',
      category: typeof item.category === 'string' ? item.category : '',
      kind,
      gross: Number.isFinite(item.gross) ? item.gross : null,
      usdWithdrawn: Number.isFinite(item.usdWithdrawn) ? item.usdWithdrawn : null,
      usdSubscription: Number.isFinite(item.usdSubscription) ? item.usdSubscription : null,
      usdNet: Number.isFinite(item.usdNet) ? item.usdNet : null,
      usdBilled: Number.isFinite(item.usdBilled) ? item.usdBilled : null,
      usdCharges: Number.isFinite(item.usdCharges) ? item.usdCharges : null,
      titheBase: typeof item.titheBase === 'string' ? item.titheBase : undefined,
      rate: Number.isFinite(item.rate) ? item.rate : null,
      ptax: Number.isFinite(item.ptax) ? item.ptax : null,
      rates: item.rates && typeof item.rates === 'object' ? item.rates : undefined,
      received: typeof item.received === 'boolean' ? item.received : undefined,
      taxed: typeof item.taxed === 'boolean' ? item.taxed : undefined,
      notes: typeof item.notes === 'string' ? item.notes : '',
    }, rates));
  }
  return { entries: sortEntries(entries), dropped, rates, periods };
}

export function serializeFile(entries, rates = DEFAULT_RATES, periods = []) {
  const payload = {
    version: FILE_VERSION,
    updatedAt: new Date().toISOString(),
    settings: {
      rates: { ...DEFAULT_RATES, ...rates },
      // No arquivo, e não no navegador, para os períodos salvos aparecerem
      // iguais no computador e no celular — como as taxas.
      periods: periods.map((p) => ({ id: p.id, name: p.name, from: p.from, to: p.to })),
    },
    entries: sortEntries(entries).map((e) => ({
      id: e.id,
      date: e.date,
      source: e.source,
      category: e.category,
      kind: e.kind,
      // O que foi digitado.
      ...(e.kind === 'upwork'
        ? {
          usdWithdrawn: e.usdWithdrawn,
          usdSubscription: e.usdSubscription,
          usdBilled: e.usdBilled,
          rate: e.rate,
          ptax: e.ptax,
          titheBase: e.titheBase,
        }
        : { gross: e.gross }),
      rates: e.rates,
      // Calculados. Gravados para o arquivo se ler sozinho (numa planilha, ou
      // olhando no GitHub); na carga são refeitos, nunca lidos daqui.
      grossBRL: e.gross,
      ...(e.kind === 'upwork' ? { usdGross: e.usdGross, usdSent: e.usdSent } : {}),
      tithe: e.tithe,
      tax: e.tax,
      landed: e.landed,
      net: e.net,
      received: e.received,
      taxed: e.taxed,
      notes: e.notes,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Só o que foi digitado conta como mudança: gross/tithe/landed/net saem das
// regras, então recalculá-los ao carregar não pode parecer uma edição pendente.
// (Para renda em reais o próprio gross é digitado, por isso ele entra.)
function fingerprint(entries, settings = null) {
  const shape = sortEntries(entries).map((e) => [
    e.date, e.source, e.category, e.kind,
    e.kind === 'upwork' ? [e.usdWithdrawn, e.usdSubscription, e.usdBilled, e.rate, e.ptax, e.titheBase] : e.gross,
    e.rates.serviceFee, e.rates.withdrawal, e.rates.tithe, e.rates.tax,
    e.received, e.taxed, e.notes,
  ]);
  // As taxas e os períodos moram no mesmo arquivo, então mexer neles também é
  // uma mudança por salvar — antes só as entradas acendiam o botão Save.
  return JSON.stringify(settings ? [shape, settings.rates, settings.periods] : [shape]);
}

/* ---------------- store ---------------- */

export class Store {
  constructor() {
    this.entries = [];
    this.settings = { rates: { ...DEFAULT_RATES }, periods: [] };
    this.sha = null;
    this.savedFingerprint = fingerprint([], this.settings);
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  // Called after a successful load or save: this is now the state on GitHub.
  setRemote(entries, sha, settings = null) {
    this.entries = sortEntries(entries);
    if (settings) this.settings = settings;
    this.sha = sha;
    this.savedFingerprint = fingerprint(this.entries, this.settings);
    this.emit();
  }

  markSaved(sha) {
    this.sha = sha;
    this.savedFingerprint = fingerprint(this.entries, this.settings);
    this.emit();
  }

  isDirty() {
    return fingerprint(this.entries, this.settings) !== this.savedFingerprint;
  }

  setRates(rates) {
    this.settings = { ...this.settings, rates };
    this.emit();
  }

  // Guarda o período com o nome dado. Reusar um nome sobrescreve, em vez de
  // deixar dois botões iguais lado a lado.
  savePeriod(name, from, to) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const existing = this.settings.periods.find((p) => p.name.toLowerCase() === clean.toLowerCase());
    const period = { id: existing ? existing.id : newId(), name: clean, from, to };
    this.settings = {
      ...this.settings,
      periods: existing
        ? this.settings.periods.map((p) => (p.id === existing.id ? period : p))
        : [...this.settings.periods, period],
    };
    this.emit();
    return period;
  }

  removePeriod(id) {
    const before = this.settings.periods.length;
    this.settings = { ...this.settings, periods: this.settings.periods.filter((p) => p.id !== id) };
    if (this.settings.periods.length !== before) this.emit();
  }

  add(partial) {
    const entry = makeEntry(partial);
    this.entries = sortEntries([...this.entries, entry]);
    this.emit();
    return entry;
  }

  update(id, patch) {
    let changed = false;
    this.entries = this.entries.map((e) => {
      if (e.id !== id) return e;
      changed = true;
      // Refeito a cada edição: mexer no bruto, no dólar ou no VET move tudo o
      // que vem depois.
      const merged = { ...e, ...patch };
      return { ...merged, ...derive(merged) };
    });
    if (changed) {
      this.entries = sortEntries(this.entries);
      this.emit();
    }
  }

  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) this.emit();
  }

  entriesOn(iso) {
    return this.entries.filter((e) => e.date === iso);
  }

  entriesBetween(startISO, endISO) {
    return this.entries.filter((e) => e.date >= startISO && e.date <= endISO);
  }
}

/* ---------------- local draft (never a commit) ---------------- */

export function saveDraft(entries, baseSha) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      baseSha,
      savedAt: new Date().toISOString(),
      entries,
    }));
  } catch { /* storage full or disabled */ }
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || !Array.isArray(draft.entries)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}

export function draftDiffers(draftEntries, entries) {
  return fingerprint(draftEntries) !== fingerprint(entries);
}
