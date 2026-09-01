// Application state: the entry list, what is currently on GitHub, and the local
// draft that protects unsaved edits from a crash or a closed tab.
//
// Two very different "saves" live here:
//   * saveDraft()  — writes to this browser only, costs nothing, no commit.
//   * the Save button (see app.js) — the only thing that commits to GitHub.

import { isValidISO, todayISO } from './dates.js';
import { netOf } from './deductions.js';
import { round2 } from './money.js';

const CONFIG_KEY = 'incomeCalendar.config';
const TOKEN_KEY = 'incomeCalendar.token';
const DRAFT_KEY = 'incomeCalendar.draft';
const FILE_VERSION = 1;

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

export function makeEntry(partial = {}) {
  const date = partial.date || '';
  const gross = partial.gross == null ? null : round2(partial.gross);
  const upwork = partial.upwork === true;
  return {
    id: partial.id || newId(),
    date,
    source: partial.source || '',
    category: partial.category || '',
    gross,
    upwork,
    // Never taken from the caller: the net is always the gross minus the
    // deductions, so it cannot drift away from the numbers it is made of.
    net: netOf({ gross, upwork }),
    // Unstated means "decide from the date": money dated today or earlier has
    // normally arrived, money dated ahead is still expected. This is what makes
    // entry files written before the flag existed read sensibly.
    received: partial.received === undefined ? date <= todayISO() : partial.received === true,
    notes: partial.notes || '',
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
export function parseFile(text) {
  if (!text || !text.trim()) return { entries: [], dropped: 0 };

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The data file on GitHub is not valid JSON. Fix it on GitHub, then press Reload.');
  }

  const raw = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : null;
  if (!raw) throw new Error('The data file does not contain an "entries" list.');

  const entries = [];
  let dropped = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !isValidISO(item.date)) {
      dropped += 1;
      continue;
    }
    // Fields added over time simply default when missing. A stored net is
    // deliberately ignored: it is recalculated from the gross on every load, so
    // the rules are the single source of truth. Files that still carry the old
    // per-entry "tithe" flag load fine — every income is tithed now.
    entries.push(makeEntry({
      id: typeof item.id === 'string' ? item.id : undefined,
      date: item.date,
      source: typeof item.source === 'string' ? item.source : '',
      category: typeof item.category === 'string' ? item.category : '',
      gross: Number.isFinite(item.gross) ? item.gross : null,
      upwork: item.upwork === true,
      received: typeof item.received === 'boolean' ? item.received : undefined,
      notes: typeof item.notes === 'string' ? item.notes : '',
    }));
  }
  return { entries: sortEntries(entries), dropped };
}

export function serializeFile(entries) {
  const payload = {
    version: FILE_VERSION,
    updatedAt: new Date().toISOString(),
    entries: sortEntries(entries).map((e) => ({
      id: e.id,
      date: e.date,
      source: e.source,
      category: e.category,
      gross: e.gross,
      upwork: e.upwork,
      // Written out for readability elsewhere (a spreadsheet, a glance at the
      // file on GitHub); on load it is recalculated rather than trusted.
      net: e.net,
      received: e.received,
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

// Only the entries decide whether there is something to save — the file's
// updatedAt stamp changes on every write and must not count as a change.
// The net is left out on purpose: it is derived from the gross and the Upwork
// flag, so recalculating it on load must never look like an unsaved edit.
function fingerprint(entries) {
  return JSON.stringify(sortEntries(entries)
    .map((e) => [e.date, e.source, e.category, e.gross, e.upwork, e.received, e.notes]));
}

/* ---------------- store ---------------- */

export class Store {
  constructor() {
    this.entries = [];
    this.sha = null;
    this.savedFingerprint = fingerprint([]);
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
  setRemote(entries, sha) {
    this.entries = sortEntries(entries);
    this.sha = sha;
    this.savedFingerprint = fingerprint(entries);
    this.emit();
  }

  markSaved(sha) {
    this.sha = sha;
    this.savedFingerprint = fingerprint(this.entries);
    this.emit();
  }

  isDirty() {
    return fingerprint(this.entries) !== this.savedFingerprint;
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
      // Recalculated on every edit, so changing the gross or the Upwork flag
      // moves the net with it.
      const merged = { ...e, ...patch };
      return { ...merged, net: netOf(merged) };
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
