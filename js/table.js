// The spreadsheet-style view. Every cell is a real input so entries can be typed
// quickly; edits go straight into the same store the calendar reads from.

import { MONTH_NAMES, escapeHtml } from './calendar.js';
import { isValidISO } from './dates.js';
import { statement } from './deductions.js';
import { formatAmount, formatUsd as usd, parseAmount, sum, toInputString } from './money.js';
import { categoryHue, hueStyle } from './palette.js';
import { matchesCategory, matchesFlag } from './summary.js';

export class TableView {
  constructor({ bodyEl, filterEl, foot, store, onChange, onDuplicate, onEdit }) {
    this.bodyEl = bodyEl;
    this.filterEl = filterEl;
    this.foot = foot;
    this.store = store;
    this.onChange = onChange || (() => {});
    this.onDuplicate = onDuplicate || (() => {});
    this.onEdit = onEdit || (() => {});
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
      ? this.groupByMonth(rows)
      : `<tr class="empty-row"><td colspan="8">${this.emptyMessage()}</td></tr>`;

    this.renderTotals(rows);
  }

  // Entries are sorted by date, so each change of month starts a new group. The
  // heading carries that month's net, which is the number you would otherwise be
  // adding up by eye.
  groupByMonth(rows) {
    const html = [];
    let current = null;

    for (let i = 0; i < rows.length; i += 1) {
      const month = rows[i].date.slice(0, 7);
      if (month !== current) {
        current = month;
        const inMonth = rows.filter((e) => e.date.startsWith(month));
        html.push(this.monthHeading(month, inMonth));
      }
      html.push(this.row(rows[i]));
    }
    return html.join('');
  }

  monthHeading(month, entries) {
    const [year, m] = month.split('-');
    const net = sum(entries.map((e) => e.net ?? 0));
    return `
      <tr class="month-row">
        <td colspan="5">
          <span class="month-name">${MONTH_NAMES[Number(m) - 1]} ${year}</span>
          <span class="month-count">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span>
        </td>
        <td class="month-total">${formatAmount(net, this.currency)}</td>
        <td colspan="2"></td>
      </tr>`;
  }

  // Distinguishes "nothing recorded yet" from "the filters hide everything".
  emptyMessage() {
    if (this.store.entries.length) return 'No entries match the current filters.';
    return 'No entries yet — click a day on the calendar, or press “+ Add entry”.';
  }

  renderTotals(rows = this.visibleEntries()) {
    const money = (v) => formatAmount(v, this.currency);
    this.foot.gross.textContent = money(sum(rows.map((e) => e.gross ?? 0)));
    this.foot.landed.textContent = money(sum(rows.map((e) => e.landed ?? 0)));
    this.foot.net.textContent = money(sum(rows.map((e) => e.net ?? 0)));
  }

  row(entry) {
    const money = (v) => (v == null ? '—' : formatAmount(v, this.currency));
    const isUpwork = entry.kind === 'upwork';

    // O bruto é digitado quando a renda é em reais; quando vem da Upwork ele é
    // recomposto do dólar, então aparece como texto e se edita no diálogo.
    const grossCell = isUpwork
      ? `<span class="derived" title="${escapeHtml(this.tip(entry))}">${money(entry.gross)}</span>`
      : `<input type="text" inputmode="decimal" data-field="gross" value="${toInputString(entry.gross, this.currency)}" placeholder="0,00">`;

    return `
      <tr data-id="${entry.id}" class="${isUpwork ? 'is-upwork ' : ''}${entry.received ? '' : 'is-pending'}">
        <td class="col-date"><input type="date" data-field="date" value="${entry.date}"></td>
        <td class="col-source"><input type="text" data-field="source" value="${escapeHtml(entry.source)}" placeholder="Fonte"></td>
        <td class="col-category"${hueStyle(entry.category)}><input type="text" data-field="category" list="category-list" value="${escapeHtml(entry.category)}" placeholder="—"></td>
        <td class="col-amount col-gross">${grossCell}</td>
        <td class="col-amount col-landed" title="${escapeHtml(this.tip(entry))}">${money(entry.landed)}</td>
        <td class="col-amount col-net" title="${escapeHtml(this.tip(entry))}">${money(entry.net)}</td>
        <td class="col-flag col-received"><input type="checkbox" data-field="received" title="Já recebido?"${entry.received ? ' checked' : ''}></td>
        <td class="col-actions">
          <button type="button" class="row-action" data-action="edit" title="Abrir e editar">✎</button>
          <button type="button" class="row-action" data-action="duplicate" title="Copiar para o mês seguinte">⧉</button>
          <button type="button" class="row-action row-del" data-action="delete" title="Excluir">✕</button>
        </td>
      </tr>`;
  }

  // A conta inteira em uma linha, para a dica das células calculadas.
  tip(entry) {
    const money = (v) => formatAmount(v, this.currency);
    return statement(entry)
      .map((line) => `${line.label}: ${line.usd != null ? usd(line.usd) : money(line.brl)}`)
      .join('  ·  ');
  }

  handleInput(event) {
    const input = event.target.closest('input[data-field]');
    if (!input) return;
    const id = input.closest('tr').dataset.id;
    const field = input.dataset.field;

    if (field === 'gross') {
      this.store.update(id, { gross: parseAmount(input.value) });
      this.refreshNetCell(input.closest('tr'), id);
    } else if (field === 'received') {
      this.store.update(id, { received: input.checked });
      input.closest('tr').classList.toggle('is-pending', !input.checked);
    } else if (field === 'source' || field === 'notes' || field === 'category') {
      this.store.update(id, { [field]: input.value });
      if (field === 'category') {
        // The colour follows what is being typed, without rebuilding the table
        // underneath the cursor.
        const cell = input.closest('td');
        const hue = categoryHue(input.value);
        if (hue == null) cell.style.removeProperty('--cat-hue');
        else cell.style.setProperty('--cat-hue', String(hue));
      }
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

    if (field === 'gross') {
      const value = parseAmount(input.value);
      this.store.update(id, { gross: value });
      input.value = toInputString(value, this.currency);
      this.refreshNetCell(row, id);
      this.onChange();
    }
  }

  // As colunas calculadas não são campos, então são repintadas no lugar enquanto
  // a linha está sendo editada e a tabela de propósito não é reconstruída.
  refreshNetCell(row, id) {
    const entry = this.store.entries.find((e) => e.id === id);
    if (!entry) return;
    const money = (v) => (v == null ? '—' : formatAmount(v, this.currency));
    const tip = this.tip(entry);

    for (const [selector, value] of [['.col-landed', entry.landed], ['.col-net', entry.net]]) {
      const cell = row.querySelector(selector);
      if (!cell) continue;
      cell.textContent = money(value);
      cell.title = tip;
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
    if (button.dataset.action === 'edit') {
      this.onEdit(entry);
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

    // Step over the month headings sitting between entries.
    let next = input.closest('tr').nextElementSibling;
    while (next && !next.dataset.id) next = next.nextElementSibling;

    const target = next && next.querySelector(`input[data-field="${field}"]`);
    if (target) {
      target.focus();
      target.select?.();
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
