// Wiring: connection setup, loading from GitHub, the two synced views, the
// rolling-window summary, local draft autosave, and the one-commit Save button.

import { CalendarView, escapeHtml } from './calendar.js';
import { DEFAULT_RATES, statement } from './deductions.js';
import { hueStyle } from './palette.js';
import { MONTH_NAMES, addMonths, formatLong, todayISO } from './dates.js';
import { GitHubError, getFile, putFile, verifyAccess } from './github.js';
import { formatAmount, formatUsd, parseAmount, parseAmountSum, parseRate } from './money.js';
import {
  Store,
  categoriesOf,
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
import {
  NO_CATEGORY,
  NO_CATEGORY_LABEL,
  breakdownByCategory,
  computeRange,
  describeRange,
  matchesCategory,
  matchesFlag,
  presetRange,
} from './summary.js';
import { TableView } from './table.js';

const DRAFT_DEBOUNCE_MS = 800;

const el = (id) => document.getElementById(id);

const store = new Store();
let config = loadConfig();
let token = loadToken();
let calendar;
let table;
let range = { from: addMonths(todayISO(), -1), to: todayISO() };
let categoryFilter = '';
let flagFilter = '';
let rates = { ...DEFAULT_RATES };
let editingId = null;
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
      foot: {
        gross: el('foot-gross'),
        landed: el('foot-landed'),
        net: el('foot-net'),
      },
      store,
      onDuplicate: duplicateEntry,
      onEdit: (entry) => openDayDialog(entry.date, entry),
    });
    store.subscribe(() => {
      renderAll();
      scheduleDraftSave();
    });
  }

  calendar.setCurrency(config.currency);
  table.setCurrency(config.currency);
  table.setCategoryFilter(categoryFilter);
  syncRangeInputs();
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
    const parsed = text ? parseFile(text) : { entries: [], dropped: 0, rates: { ...DEFAULT_RATES } };
    const { entries, dropped } = parsed;
    rates = parsed.rates;
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
      text: serializeFile(store.entries, rates),
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
      text: serializeFile(store.entries, rates),
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

  el('range-from').addEventListener('change', () => applyRangeInput('from'));
  el('range-to').addEventListener('change', () => applyRangeInput('to'));

  for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
      range = presetRange(button.dataset.preset, range);
      syncRangeInputs();
      renderAll();
    });
  }

  el('category-filter').addEventListener('change', () => setCategoryFilter(el('category-filter').value));

  // Clicking a category in the breakdown filters by it; clicking it again clears.
  el('category-breakdown').addEventListener('click', (event) => {
    const pill = event.target.closest('[data-category]');
    if (!pill) return;
    setCategoryFilter(pill.dataset.category === categoryFilter ? '' : pill.dataset.category);
  });

  // Same for the three headline cards: Received, Expected and Dízimo.
  for (const card of document.querySelectorAll('[data-flag]')) {
    card.addEventListener('click', () => {
      setFlagFilter(card.dataset.flag === flagFilter ? '' : card.dataset.flag);
    });
  }

  el('add-row-btn').addEventListener('click', () => {
    const entry = store.add({ date: todayISO() });
    table.render();
    table.focusEntry(entry.id, 'source');
  });

  wireDayDialog();
  wireRatesDialog();

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

// Copying an entry forward a month is how a recurring income gets planned: copy
// the salary, then keep copying the newest one to walk down the year.
function duplicateEntry(entry) {
  const date = addMonths(entry.date, 1);
  const copy = store.add({
    ...entry,
    id: undefined,
    date,
    // Uma cópia que cai no futuro é plano, não dinheiro recebido.
    received: date <= todayISO(),
  });

  // A filter that hides the new row would make the copy look like it failed.
  if (!matchesFlag(copy, flagFilter)) flagFilter = '';
  if (!matchesCategory(copy, categoryFilter)) categoryFilter = '';
  if (table.filter) {
    table.filter = '';
    el('table-filter').value = '';
  }
  table.setFlagFilter(flagFilter);
  table.setCategoryFilter(categoryFilter);

  calendar.setMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
  syncMonthControls();
  table.render();
  table.focusEntry(copy.id, 'date');
  renderAll();
  toast(`Copied to ${formatLong(date)}.`);
}

function setCategoryFilter(category) {
  categoryFilter = category;
  table.setCategoryFilter(category);
  table.render();
  renderAll();
}

function setFlagFilter(flag) {
  flagFilter = flag;
  table.setFlagFilter(flag);
  table.render();
  renderAll();
}

// Keeps the two dates in order: dragging one past the other pushes the other
// along, the way a date-range picker behaves, instead of showing a broken range.
function applyRangeInput(which) {
  const input = el(which === 'from' ? 'range-from' : 'range-to');
  if (!input.value) {
    syncRangeInputs();
    return;
  }
  range = { ...range, [which]: input.value };
  if (range.from > range.to) {
    if (which === 'from') range.to = range.from;
    else range.from = range.to;
  }
  syncRangeInputs();
  renderAll();
}

function syncRangeInputs() {
  el('range-from').value = range.from;
  el('range-to').value = range.to;
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

// Clicar num income abre a mesma janela do lançamento, já preenchida; clicar em
// qualquer outro lugar do dia abre em branco para lançar naquela data.
function handleDayClick(iso, entryId) {
  const entry = entryId && store.entries.find((e) => e.id === entryId);
  if (entry) openDayDialog(entry.date, entry);
  else openDayDialog(iso);
}

// Serve para criar e para editar: passando uma entrada, os campos vêm dela.
function openDayDialog(iso, entry = null) {
  editingId = entry ? entry.id : null;
  const kind = entry ? entry.kind : 'brl';

  el('day-dialog-title').textContent = entry
    ? `Editar — ${formatLong(entry.date)}`
    : `Nova renda — ${formatLong(iso)}`;
  el('day-save').textContent = entry ? 'Salvar' : 'Adicionar';

  el('day-date').value = entry ? entry.date : iso;
  el('day-source').value = entry ? entry.source : '';
  el('day-category').value = entry
    ? entry.category
    : (categoryFilter && categoryFilter !== NO_CATEGORY ? categoryFilter : '');
  el('day-gross').value = entry && entry.kind === 'brl' && entry.gross != null
    ? String(entry.gross).replace('.', ',') : '';
  el('day-usd').value = entry && entry.usdNet != null ? String(entry.usdNet).replace('.', ',') : '';
  el('day-rate').value = entry && entry.rate != null ? String(entry.rate).replace('.', ',') : '';
  el('day-notes').value = entry ? entry.notes : '';
  // Renda datada de hoje ou antes normalmente já caiu; o que está à frente é
  // plano. De qualquer forma a caixa está logo ali para mudar.
  el('day-received').checked = entry ? entry.received : iso <= todayISO();

  for (const radio of document.querySelectorAll('input[name="day-kind"]')) {
    radio.checked = radio.value === kind;
  }
  syncKindFields();
  updateStatement();

  el('day-dialog').showModal();
  // Foco síncrono: um focus() adiado tiraria o cursor do campo em que a pessoa
  // já começou a digitar.
  el('day-source').focus();
}

function currentKind() {
  const checked = document.querySelector('input[name="day-kind"]:checked');
  return checked ? checked.value : 'brl';
}

function syncKindFields() {
  const upwork = currentKind() === 'upwork';
  el('field-gross').classList.toggle('hidden', upwork);
  el('fields-upwork').classList.toggle('hidden', !upwork);
}

// Monta a entrada a partir do que está no diálogo, sem gravar nada.
function dialogEntry() {
  const kind = currentKind();
  return {
    kind,
    gross: kind === 'brl' ? parseAmount(el('day-gross').value) : null,
    usdNet: kind === 'upwork' ? parseAmountSum(el('day-usd').value) : null,
    rate: kind === 'upwork' ? parseRate(el('day-rate').value) : null,
    rates,
  };
}

// O extrato ao vivo: é ele que faz as vezes da calculadora, e some a dúvida
// sobre que número vai parar na tabela.
function updateStatement() {
  const lines = statement(dialogEntry(), rates);
  const box = el('day-statement');

  if (!lines.length) {
    box.innerHTML = '<p class="statement-empty">Preencha os valores para ver a conta.</p>';
    return;
  }

  box.innerHTML = lines.map((line) => `
    <div class="statement-line${line.total ? ' total' : ''}${line.muted ? ' muted-line' : ''}">
      <span>${escapeHtml(line.label)}</span>
      <b>${line.usd != null ? formatUsd(line.usd) : formatAmount(line.brl, config.currency)}</b>
    </div>`).join('');
}

function wireDayDialog() {
  const dialog = el('day-dialog');
  el('day-cancel').addEventListener('click', () => dialog.close('cancel'));

  for (const id of ['day-gross', 'day-usd', 'day-rate']) {
    el(id).addEventListener('input', updateStatement);
  }
  for (const radio of document.querySelectorAll('input[name="day-kind"]')) {
    radio.addEventListener('change', () => { syncKindFields(); updateStatement(); });
  }

  dialog.addEventListener('close', () => {
    const id = editingId;
    editingId = null;
    if (dialog.returnValue !== 'save') return;

    const date = el('day-date').value;
    if (!date) return;

    const fields = {
      date,
      source: el('day-source').value.trim(),
      category: el('day-category').value.trim(),
      received: el('day-received').checked,
      notes: el('day-notes').value.trim(),
      ...dialogEntry(),
    };

    if (id) {
      store.update(id, fields);
      table.render();
      table.focusEntry(id, 'source');
      return;
    }

    const entry = store.add(fields);
    table.render();
    table.focusEntry(entry.id, 'source');
  });
}

/* ---------------- taxas ---------------- */

function wireRatesDialog() {
  const dialog = el('rates-dialog');
  el('rates-btn').addEventListener('click', () => {
    el('rate-service').value = String(round1(rates.serviceFee * 100)).replace('.', ',');
    el('rate-withdrawal').value = String(rates.withdrawal).replace('.', ',');
    el('rate-wise').value = String(round2pct(rates.wiseFee * 100)).replace('.', ',');
    el('rate-tithe').value = String(round1(rates.tithe * 100)).replace('.', ',');
    dialog.showModal();
  });
  el('rates-cancel').addEventListener('click', () => dialog.close('cancel'));

  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'save') return;
    const service = parseAmount(el('rate-service').value);
    const withdrawal = parseAmount(el('rate-withdrawal').value);
    const wise = parseRate(el('rate-wise').value);
    const tithe = parseAmount(el('rate-tithe').value);

    rates = {
      serviceFee: service == null ? rates.serviceFee : service / 100,
      withdrawal: withdrawal == null ? rates.withdrawal : withdrawal,
      wiseFee: wise == null ? rates.wiseFee : wise / 100,
      tithe: tithe == null ? rates.tithe : tithe / 100,
    };
    // Só entradas novas usam as taxas novas; as que existem guardam as suas.
    store.emit();
    toast('Taxas atualizadas. Valem para entradas novas.');
  });
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// A tarifa da Wise tem duas casas (0,86%), então não pode ser arredondada como
// as outras.
function round2pct(n) {
  return Math.round(n * 100) / 100;
}

/* ---------------- rendering ---------------- */

function renderAll() {
  calendar.setWindow({ start: range.from, end: range.to });
  calendar.setCurrency(config.currency);
  table.setCurrency(config.currency);
  calendar.render();
  table.requestRender();
  renderCategoryOptions();
  renderSummary();
  updateSaveStatus();
}

const HERO_LABELS = {
  '': 'Net in this period',
  received: 'Net received in this period',
  pending: 'Net still expected in this period',
  tithe: 'Net flagged for dízimo in this period',
};

function renderSummary() {
  const result = computeRange(store, range.from, range.to, categoryFilter, flagFilter);

  el('window-range').textContent = describeRange(result);
  el('hero-label').textContent = HERO_LABELS[flagFilter];
  el('total-gross').textContent = formatAmount(result.gross, config.currency);
  el('total-net').textContent = formatAmount(result.net, config.currency);
  el('total-count').textContent = String(result.count);

  el('total-received').textContent = formatAmount(result.receivedNet, config.currency);
  el('count-received').textContent = entryCount(result.receivedCount);
  el('total-pending').textContent = formatAmount(result.pendingNet, config.currency);
  el('count-pending').textContent = entryCount(result.pendingCount);
  el('total-tithe').textContent = formatAmount(result.titheTotal, config.currency);
  renderDeductionLine(result);

  for (const card of document.querySelectorAll('[data-flag]')) {
    card.classList.toggle('active', card.dataset.flag === flagFilter);
  }
  el('hero-hint').textContent = flagFilter
    ? 'Showing only these entries — click the card again to show everything.'
    : 'Click a card to show only those entries.';

  // The breakdown ignores the category filter so its pills stay put and the
  // active one can be clicked again to clear, but it does follow the flag filter.
  renderBreakdown(computeRange(store, range.from, range.to, '', flagFilter).entries);
}

function entryCount(n) {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

// Spells out where the headline net comes from, so the deductions are never a
// black box: bruto − dízimo − Upwork = líquido.
function renderDeductionLine(result) {
  const money = (v) => formatAmount(v, config.currency);
  const line = el('deduction-line');

  if (!result.count) {
    line.textContent = '';
    return;
  }

  const parts = [`Bruto ${money(result.gross)}`];
  if (result.feesTotal) parts.push(`− taxas ${money(result.feesTotal)}`);
  parts.push(`− dízimo ${money(result.titheTotal)}`, `= ${money(result.net)}`);
  line.textContent = parts.join('  ');
}

// Net per category for the chosen period. Hidden when there is nothing to
// compare — a single category tells you no more than the totals above already do.
function renderBreakdown(entries) {
  const box = el('category-breakdown');
  const groups = breakdownByCategory(entries);

  if (groups.length < 2 && !categoryFilter) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = groups.map((group) => {
    const value = group.category || NO_CATEGORY;
    const active = value === categoryFilter;
    return `
      <button type="button" class="cat-pill${active ? ' active' : ''}" data-category="${escapeHtml(value)}"${hueStyle(group.category)}
        title="${active ? 'Click to clear this filter' : 'Click to show only this category'}">
        <span class="cat-dot"></span>
        <span class="cat-name">${escapeHtml(group.category || NO_CATEGORY_LABEL)}</span>
        <span class="cat-net">${formatAmount(group.net, config.currency)}</span>
        <span class="cat-count">${group.count}</span>
      </button>`;
  }).join('');
}

// The dropdown lists every category in use, plus whichever one is selected even
// if the last entry using it was just deleted, so the filter never resets itself.
function renderCategoryOptions() {
  const names = categoriesOf(store.entries);
  const hasUncategorised = store.entries.some((e) => !e.category);
  const options = ['<option value="">All categories</option>'];

  for (const name of names) {
    options.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
  }
  if (hasUncategorised) options.push(`<option value="${NO_CATEGORY}">${NO_CATEGORY_LABEL}</option>`);
  if (categoryFilter && categoryFilter !== NO_CATEGORY && !names.includes(categoryFilter)) {
    options.push(`<option value="${escapeHtml(categoryFilter)}">${escapeHtml(categoryFilter)}</option>`);
  }

  const select = el('category-filter');
  const markup = options.join('');
  if (select.innerHTML !== markup) select.innerHTML = markup;
  select.value = categoryFilter;

  el('category-list').innerHTML = names
    .map((name) => `<option value="${escapeHtml(name)}"></option>`)
    .join('');
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
