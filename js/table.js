// The spreadsheet-style view. Every cell is a real input so entries can be typed
// quickly; edits go straight into the same store the calendar reads from.

import { escapeHtml } from './calendar.js';
import { isValidISO } from './dates.js';
import { formatAmount, parseAmount, sum, toInputString } from './money.js';
import { matchesCategory, matchesFlag } from './summary.js';

export class TableView {
  constructor({ bodyEl, filterEl, footGrossEl, footNetEl, store, onChange, onDuplicate }) {
    this.bodyEl = bodyEl;
    this.filterEl = filterEl;
    this.footGrossEl = footGrossEl;
    this.footNetEl = footNetEl;
    this.store = store;
    this.onChange = onChange || (() => {});
    this.onDuplicate = onDuplicate || (() => {});
    this.currency = 'BRL';
    this.filter = '';
    this.categoryFilter = '';
    this.flagFilter = '';
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

  // The category dropdown in the summary panel narrows this table too, so the
  // numbers on screen always belong to the same set of entries.
  setCategoryFilter(category) {
    this.categoryFilter = category;
  }

  // Received / Expected / Dízimo, driven by the headline cards.
  setFlagFilter(flag) {
    this.flagFilter = flag;
  }

  visibleEntries() {
    return this.store.entries.filter((e) => {
      if (!matchesCategory(e, this.categoryFilter)) return false;
      if (!matchesFlag(e, this.flagFilter)) return false;
      if (!this.filter) return true;
      return `${e.date} ${e.source} ${e.category} ${e.notes}`.toLowerCase().includes(this.filter);
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
      : `<tr class="empty-row"><td colspan="9">${this.emptyMessage()}</td></tr>`;

    this.renderTotals(rows);
  }

  // Distinguishes "nothing recorded yet" from "the filters hide everything".
  emptyMessage() {
    if (this.store.entries.length) return 'No entries match the current filters.';
    return 'No entries yet — click a day on the calendar, or press “+ Add entry”.';
  }

  renderTotals(rows = this.visibleEntries()) {
    this.footGrossEl.textContent = formatAmount(sum(rows.map((e) => e.gross ?? 0)), this.currency);
    this.footNetEl.textContent = formatAmount(sum(rows.map((e) => e.net ?? 0)), this.currency);
  }

  row(entry) {
    return `
      <tr data-id="${entry.id}" class="${entry.tithe ? 'is-tithe ' : ''}${entry.received ? '' : 'is-pending'}">
        <td class="col-date"><input type="date" data-field="date" value="${entry.date}"></td>
        <td class="col-source"><input type="text" data-field="source" value="${escapeHtml(entry.source)}" placeholder="Source"></td>
        <td class="col-category"><input type="text" data-field="category" list="category-list" value="${escapeHtml(entry.category)}" placeholder="—"></td>
        <td class="col-amount"><input type="text" inputmode="decimal" data-field="gross" value="${toInputString(entry.gross, this.currency)}" placeholder="0,00"></td>
        <td class="col-amount"><input type="text" inputmode="decimal" data-field="net" value="${toInputString(entry.net, this.currency)}" placeholder="0,00"></td>
        <td class="col-flag col-received"><input type="checkbox" data-field="received" title="Já recebido?"${entry.received ? ' checked' : ''}></td>
        <td class="col-flag col-tithe"><input type="checkbox" data-field="tithe" title="Dízimo"${entry.tithe ? ' checked' : ''}></td>
        <td class="col-notes"><input type="text" data-field="notes" value="${escapeHtml(entry.notes)}" placeholder="—"></td>
        <td class="col-actions">
          <button type="button" class="row-action" data-action="duplicate" title="Copy to next month">⧉</button>
          <button type="button" class="row-action row-del" data-action="delete" title="Delete entry">✕</button>
        </td>
      </tr>`;
  }

  handleInput(event) {
    const input = event.target.closest('input[data-field]');
    if (!input) return;
    const id = input.closest('tr').dataset.id;
    const field = input.dataset.field;

    if (field === 'gross' || field === 'net') {
      this.store.update(id, { [field]: parseAmount(input.value) });
    } else if (field === 'tithe') {
      this.store.update(id, { tithe: input.checked });
      input.closest('tr').classList.toggle('is-tithe', input.checked);
    } else if (field === 'received') {
      this.store.update(id, { received: input.checked });
      input.closest('tr').classList.toggle('is-pending', !input.checked);
    } else if (field === 'source' || field === 'notes' || field === 'category') {
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
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.closest('tr').dataset.id;
    const entry = this.store.entries.find((e) => e.id === id);
    if (!entry) return;

    if (button.dataset.action === 'duplicate') {
      this.onDuplicate(entry);
      return;
    }

    const hasData = entry.gross != null || entry.net != null || entry.source || entry.notes;
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
