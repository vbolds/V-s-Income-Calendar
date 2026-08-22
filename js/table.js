// The spreadsheet-style view. Every cell is a real input so entries can be typed
// quickly; edits go straight into the same store the calendar reads from.

import { escapeHtml } from './calendar.js';
import { isValidISO } from './dates.js';
import { formatAmount, parseAmount, sum, toInputString } from './money.js';

export class TableView {
  constructor({ bodyEl, filterEl, footGrossEl, footNetEl, store, onChange }) {
    this.bodyEl = bodyEl;
    this.filterEl = filterEl;
    this.footGrossEl = footGrossEl;
    this.footNetEl = footNetEl;
    this.store = store;
    this.onChange = onChange || (() => {});
    this.currency = 'BRL';
    this.filter = '';
    this.pendingRender = false;
    this.renderQueued = false;

    this.bodyEl.addEventListener('input', (e) => this.handleInput(e));
    this.bodyEl.addEventListener('change', (e) => this.handleChange(e));
    this.bodyEl.addEventListener('click', (e) => this.handleClick(e));
    this.bodyEl.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Moving between cells briefly leaves document.activeElement on <body>. Wait
    // for focus to settle before deciding whether a rebuild is safe, otherwise a
    // pending render can rip out the cell the user is moving into.
    this.bodyEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (this.pendingRender && !this.isEditing()) this.render();
      }, 0);
    });
    this.filterEl.addEventListener('input', () => {
      this.filter = this.filterEl.value.trim().toLowerCase();
      this.render();
    });
  }

  setCurrency(currency) {
    this.currency = currency;
  }

  // While a cell has focus the table must not be rebuilt underneath the cursor.
  isEditing() {
    return this.bodyEl.contains(document.activeElement);
  }

  visibleEntries() {
    if (!this.filter) return this.store.entries;
    return this.store.entries.filter((e) => {
      const haystack = `${e.date} ${e.source} ${e.notes}`.toLowerCase();
      return haystack.includes(this.filter);
    });
  }

  // Asks for a rebuild without forcing one: while a cell is being edited the
  // rows already show what was typed, so only the totals need refreshing.
  requestRender() {
    this.pendingRender = true;
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (this.isEditing()) this.renderTotals();
      else this.render();
    });
  }

  render() {
    const rows = this.visibleEntries();
    this.pendingRender = false;

    this.bodyEl.innerHTML = rows.length
      ? rows.map((e) => this.row(e)).join('')
      : `<tr class="empty-row"><td colspan="6">No entries yet — click a day on the calendar, or press “+ Add entry”.</td></tr>`;

    this.renderTotals(rows);
  }

  renderTotals(rows = this.visibleEntries()) {
    this.footGrossEl.textContent = formatAmount(sum(rows.map((e) => e.gross ?? 0)), this.currency);
    this.footNetEl.textContent = formatAmount(sum(rows.map((e) => e.net ?? 0)), this.currency);
  }

  row(entry) {
    return `
      <tr data-id="${entry.id}">
        <td class="col-date"><input type="date" data-field="date" value="${entry.date}"></td>
        <td class="col-source"><input type="text" data-field="source" value="${escapeHtml(entry.source)}" placeholder="Source"></td>
        <td class="col-amount"><input type="text" inputmode="decimal" data-field="gross" value="${toInputString(entry.gross, this.currency)}" placeholder="0,00"></td>
        <td class="col-amount"><input type="text" inputmode="decimal" data-field="net" value="${toInputString(entry.net, this.currency)}" placeholder="0,00"></td>
        <td class="col-notes"><input type="text" data-field="notes" value="${escapeHtml(entry.notes)}" placeholder="—"></td>
        <td class="col-del"><button type="button" class="row-del" data-action="delete" title="Delete entry">✕</button></td>
      </tr>`;
  }

  handleInput(event) {
    const input = event.target.closest('input[data-field]');
    if (!input) return;
    const id = input.closest('tr').dataset.id;
    const field = input.dataset.field;

    if (field === 'gross' || field === 'net') {
      this.store.update(id, { [field]: parseAmount(input.value) });
    } else if (field === 'source' || field === 'notes') {
      this.store.update(id, { [field]: input.value });
    }
    this.onChange();
  }

  handleChange(event) {
    const input = event.target.closest('input[data-field]');
    if (!input) return;
    const row = input.closest('tr');
    const id = row.dataset.id;
    const field = input.dataset.field;

    if (field === 'date') {
      if (!isValidISO(input.value)) {
        // An empty or half-typed date would drop the row out of every view.
        const current = this.store.entries.find((e) => e.id === id);
        input.value = current ? current.date : '';
        return;
      }
      this.store.update(id, { date: input.value });
      this.onChange();
      this.renderKeepingFocus(id, 'date');
      return;
    }

    if (field === 'gross' || field === 'net') {
      const value = parseAmount(input.value);
      this.store.update(id, { [field]: value });
      input.value = toInputString(value, this.currency);
      this.onChange();
    }
  }

  handleClick(event) {
    const button = event.target.closest('[data-action="delete"]');
    if (!button) return;
    const row = button.closest('tr');
    const id = row.dataset.id;
    const entry = this.store.entries.find((e) => e.id === id);
    const hasData = entry && (entry.gross != null || entry.net != null || entry.source || entry.notes);
    if (hasData && !confirm(`Delete the entry on ${entry.date}?`)) return;
    this.store.remove(id);
    this.onChange();
    this.render();
  }

  // Enter moves down the same column, which is how a spreadsheet behaves.
  handleKeydown(event) {
    if (event.key !== 'Enter') return;
    const input = event.target.closest('input[data-field]');
    if (!input) return;
    event.preventDefault();
    const field = input.dataset.field;
    const row = input.closest('tr');
    const next = row.nextElementSibling;
    if (next && next.dataset.id) {
      const target = next.querySelector(`input[data-field="${field}"]`);
      if (target) {
        target.focus();
        target.select?.();
      }
    } else {
      input.blur();
    }
  }

  renderKeepingFocus(id, field) {
    this.render();
    const target = this.bodyEl.querySelector(`tr[data-id="${id}"] input[data-field="${field}"]`);
    if (target) target.focus();
  }

  focusEntry(id, field = 'source') {
    const target = this.bodyEl.querySelector(`tr[data-id="${id}"] input[data-field="${field}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.focus();
    target.select?.();
  }
}
