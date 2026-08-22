// Wiring: connection setup, loading from GitHub, the two synced views, the
// rolling-window summary, local draft autosave, and the one-commit Save button.

import { CalendarView } from './calendar.js';
import { MONTH_NAMES, formatLong, todayISO } from './dates.js';
import { GitHubError, getFile, putFile, verifyAccess } from './github.js';
import { formatAmount, parseAmount } from './money.js';
import {
  Store,
  clearCredentials,
  clearDraft,
  draftDiffers,
  loadConfig,
  loadDraft,
  loadToken,
  makeEntry,
  parseFile,
  saveConfig,
  saveDraft,
  saveToken,
  serializeFile,
  sortEntries,
} from './store.js';
import { computeWindow, describeRange, windowRange } from './summary.js';
import { TableView } from './table.js';

const DRAFT_DEBOUNCE_MS = 800;

const el = (id) => document.getElementById(id);

const store = new Store();
let config = loadConfig();
let token = loadToken();
let calendar;
let table;
let anchorDate = todayISO();
let draftTimer = null;
let saving = false;

/* ---------------- boot ---------------- */

function boot() {
  buildMonthOptions();
  wireSetup();
  wireApp();

  if (config.owner && config.repo && token) {
    showApp();
    loadFromGitHub();
  } else {
    showSetup();
  }
}

function showSetup() {
  fillSetupForm();
  el('setup-screen').classList.remove('hidden');
  el('app-screen').classList.add('hidden');
}

function showApp() {
  el('setup-screen').classList.add('hidden');
  el('app-screen').classList.remove('hidden');

  if (!calendar) {
    calendar = new CalendarView({
      gridEl: el('calendar-grid'),
      weekdayEl: el('weekday-row'),
      store,
      onDayClick: handleDayClick,
    });
    table = new TableView({
      bodyEl: el('entries-body'),
      filterEl: el('table-filter'),
      footGrossEl: el('foot-gross'),
      footNetEl: el('foot-net'),
      store,
    });
    store.subscribe(() => {
      renderAll();
      scheduleDraftSave();
    });
  }

  calendar.setCurrency(config.currency);
  table.setCurrency(config.currency);
  el('anchor-date').value = anchorDate;
  syncMonthControls();
  renderAll();
}

/* ---------------- setup screen ---------------- */

function fillSetupForm() {
  el('cfg-owner').value = config.owner;
  el('cfg-repo').value = config.repo;
  el('cfg-path').value = config.path;
  el('cfg-branch').value = config.branch;
  el('cfg-token').value = token;
  el('cfg-currency').value = config.currency;
}

function wireSetup() {
  el('connect-btn').addEventListener('click', async () => {
    const next = {
      owner: el('cfg-owner').value.trim(),
      repo: el('cfg-repo').value.trim(),
      path: el('cfg-path').value.trim() || 'data/entries.json',
      branch: el('cfg-branch').value.trim() || 'main',
      currency: el('cfg-currency').value,
    };
    const nextToken = el('cfg-token').value.trim();

    if (!next.owner || !next.repo || !nextToken) {
      return setupError('Fill in the owner, repository and token.');
    }

    setupError('');
    el('connect-btn').disabled = true;
    el('connect-btn').textContent = 'Checking…';
    try {
      await verifyAccess({ owner: next.owner, repo: next.repo, token: nextToken });
      config = next;
      token = nextToken;
      saveConfig(config);
      saveToken(token);
      showApp();
      await loadFromGitHub();
    } catch (error) {
      setupError(error.message);
    } finally {
      el('connect-btn').disabled = false;
      el('connect-btn').textContent = 'Connect';
    }
  });
}

function setupError(message) {
  const box = el('setup-error');
  box.textContent = message;
  box.classList.toggle('hidden', !message);
}

/* ---------------- loading and saving ---------------- */

async function loadFromGitHub() {
  setStatus('Loading…');
  try {
    const { text, sha } = await getFile({ ...config, token });
    const { entries, dropped } = text ? parseFile(text) : { entries: [], dropped: 0 };
    store.setRemote(entries, sha);

    if (dropped) toast(`${dropped} entr${dropped === 1 ? 'y was' : 'ies were'} skipped — no valid date.`, 'warn');
    if (!text) toast('No data file yet — it will be created on your first Save.');

    restoreDraftIfAny();
    renderAll();
  } catch (error) {
    setStatus('Could not load');
    if (error instanceof GitHubError && error.kind === 'auth') {
      toast(error.message, 'error');
      showSetup();
      setupError(error.message);
    } else {
      toast(error.message, 'error');
    }
  }
}

// The draft is a local crash-guard, never a commit. It only matters when it
// still holds edits that were never saved to GitHub.
function restoreDraftIfAny() {
  const draft = loadDraft();
  if (!draft || !draft.entries.length && !store.entries.length) return;
  if (!draftDiffers(draft.entries, store.entries)) return clearDraft();

  const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString() : 'earlier';

  if (draft.baseSha === store.sha) {
    applyDraft(draft.entries);
    toast(`Restored unsaved changes from ${when}.`, 'warn');
    return;
  }

  const keep = confirm(
    `You have unsaved changes from ${when}, but the data on GitHub has changed since then.\n\n`
    + 'OK — keep your unsaved changes (they replace the GitHub version when you press Save)\n'
    + 'Cancel — discard them and use what is on GitHub',
  );
  if (keep) applyDraft(draft.entries);
  else clearDraft();
}

function applyDraft(entries) {
  store.entries = sortEntries(entries.map(makeEntry));
  store.emit();
}

async function save() {
  if (saving || !store.isDirty()) return;
  saving = true;
  el('save-btn').disabled = true;
  setStatus('Saving…');

  try {
    const result = await putFile({
      ...config,
      token,
      text: serializeFile(store.entries),
      sha: store.sha,
      message: commitMessage(),
    });
    store.markSaved(result.sha);
    clearDraft();
    toast('Saved to GitHub.', 'ok');
  } catch (error) {
    if (error instanceof GitHubError && error.kind === 'conflict') {
      await handleConflict();
    } else {
      toast(error.message, 'error');
    }
  } finally {
    saving = false;
    renderAll();
  }
}

// GitHub refuses a write when the file moved on since we loaded it — which can
// only happen here if the same data was saved from another device.
async function handleConflict() {
  const overwrite = confirm(
    'The data on GitHub changed since this page loaded (saved from another device?).\n\n'
    + 'OK — overwrite GitHub with what is on this screen\n'
    + 'Cancel — discard these edits and load the GitHub version',
  );

  if (!overwrite) {
    clearDraft();
    await loadFromGitHub();
    return;
  }

  try {
    const fresh = await getFile({ ...config, token });
    const result = await putFile({
      ...config,
      token,
      text: serializeFile(store.entries),
      sha: fresh.sha,
      message: commitMessage(),
    });
    store.markSaved(result.sha);
    clearDraft();
    toast('Saved to GitHub (overwrote the other version).', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function commitMessage() {
  const count = store.entries.length;
  return `Update income entries (${count} total) — ${new Date().toISOString().slice(0, 10)}`;
}

/* ---------------- draft autosave (local only) ---------------- */

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (store.isDirty()) saveDraft(store.entries, store.sha);
    else clearDraft();
  }, DRAFT_DEBOUNCE_MS);
}

/* ---------------- app chrome ---------------- */

function wireApp() {
  el('save-btn').addEventListener('click', save);

  el('reload-btn').addEventListener('click', async () => {
    if (store.isDirty() && !confirm('Discard your unsaved changes and reload from GitHub?')) return;
    clearDraft();
    await loadFromGitHub();
  });

  el('settings-btn').addEventListener('click', () => {
    if (store.isDirty() && !confirm('You have unsaved changes. Leave them and open settings?')) return;
    showSetup();
  });

  el('prev-month').addEventListener('click', () => { calendar.shiftMonth(-1); syncMonthControls(); });
  el('next-month').addEventListener('click', () => { calendar.shiftMonth(1); syncMonthControls(); });
  el('today-btn').addEventListener('click', () => { calendar.goToToday(); syncMonthControls(); });

  el('month-select').addEventListener('change', () => {
    calendar.setMonth(Number(el('year-input').value), Number(el('month-select').value));
  });
  el('year-input').addEventListener('change', () => {
    const year = Number(el('year-input').value);
    if (year >= 1970 && year <= 2200) calendar.setMonth(year, Number(el('month-select').value));
    else el('year-input').value = calendar.year;
  });

  el('anchor-date').addEventListener('change', () => {
    if (!el('anchor-date').value) {
      el('anchor-date').value = anchorDate;
      return;
    }
    anchorDate = el('anchor-date').value;
    renderAll();
  });

  el('add-row-btn').addEventListener('click', () => {
    const entry = store.add({ date: todayISO() });
    table.render();
    table.focusEntry(entry.id, 'source');
  });

  wireDayDialog();

  window.addEventListener('beforeunload', (event) => {
    if (!store.isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
  });
}

function buildMonthOptions() {
  el('month-select').innerHTML = MONTH_NAMES
    .map((name, i) => `<option value="${i + 1}">${name}</option>`)
    .join('');
}

function syncMonthControls() {
  el('month-select').value = String(calendar.month);
  el('year-input').value = String(calendar.year);
}

/* ---------------- day dialog ---------------- */

function handleDayClick(iso, entryId) {
  if (entryId) {
    el('table-filter').value = '';
    table.filter = '';
    table.render();
    table.focusEntry(entryId, 'source');
    return;
  }
  openDayDialog(iso);
}

function openDayDialog(iso) {
  el('day-dialog-title').textContent = `Add income — ${formatLong(iso)}`;
  el('day-date').value = iso;
  el('day-source').value = '';
  el('day-gross').value = '';
  el('day-net').value = '';
  el('day-notes').value = '';
  el('day-dialog').showModal();
  // Focus synchronously: a deferred focus() would jump the caret out of whatever
  // field the user had already started typing in.
  el('day-source').focus();
}

function wireDayDialog() {
  const dialog = el('day-dialog');
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'save') return;
    const date = el('day-date').value;
    if (!date) return;
    const entry = store.add({
      date,
      source: el('day-source').value.trim(),
      gross: parseAmount(el('day-gross').value),
      net: parseAmount(el('day-net').value),
      notes: el('day-notes').value.trim(),
    });
    table.render();
    table.focusEntry(entry.id, 'source');
  });
}

/* ---------------- rendering ---------------- */

function renderAll() {
  const range = windowRange(anchorDate);
  calendar.setWindow(range);
  calendar.setCurrency(config.currency);
  table.setCurrency(config.currency);
  calendar.render();
  table.requestRender();
  renderSummary();
  updateSaveStatus();
}

function renderSummary() {
  const result = computeWindow(store, anchorDate);
  el('window-range').textContent = describeRange(result);
  el('total-gross').textContent = formatAmount(result.gross, config.currency);
  el('total-net').textContent = formatAmount(result.net, config.currency);
  el('total-count').textContent = String(result.count);
}

function updateSaveStatus() {
  const dirty = store.isDirty();
  el('save-btn').disabled = !dirty || saving;
  if (saving) return setStatus('Saving…');
  setStatus(dirty ? 'Unsaved changes' : 'All changes saved', dirty ? 'dirty' : 'clean');
}

function setStatus(text, kind = '') {
  const node = el('save-status');
  node.textContent = text;
  node.className = `save-status ${kind}`;
}

let toastTimer = null;
function toast(message, kind = '') {
  const node = el('toast');
  node.textContent = message;
  node.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), kind === 'error' ? 8000 : 4000);
}

// Exposed for the browser console when a token needs to be wiped from a device.
window.incomeCalendarSignOut = () => {
  clearCredentials();
  clearDraft();
  location.reload();
};

boot();
