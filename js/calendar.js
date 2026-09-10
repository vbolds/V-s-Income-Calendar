// Month grid. Reads straight from the store, so any edit made in the table shows
// up here on the next render without a second copy of the data.

import { MONTH_NAMES, WEEKDAY_SHORT, daysInMonth, toISO, weekdayOf, todayISO } from './dates.js';
import { formatCompact, sum } from './money.js';

const MAX_CHIPS = 2;

export class CalendarView {
  constructor({ gridEl, weekdayEl, store, onDayClick }) {
    this.gridEl = gridEl;
    this.weekdayEl = weekdayEl;
    this.store = store;
    this.onDayClick = onDayClick;
    this.currency = 'BRL';
    this.window = null; // { start, end } — highlighted range

    const today = todayISO();
    this.year = Number(today.slice(0, 4));
    this.month = Number(today.slice(5, 7));

    this.weekdayEl.innerHTML = WEEKDAY_SHORT
      .map((d) => `<span class="weekday">${d}</span>`)
      .join('');

    this.gridEl.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-date]');
      if (!cell) return;
      // Clicar num income abre ele para editar; clicar em qualquer outro lugar
      // do dia abre um lançamento novo naquela data.
      const chip = event.target.closest('[data-entry-id]');
      this.onDayClick(cell.dataset.date, chip ? chip.dataset.entryId : null);
    });
  }

  setMonth(year, month) {
    this.year = year;
    this.month = month;
    this.render();
  }

  goToToday() {
    const today = todayISO();
    this.setMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  }

  shiftMonth(delta) {
    const total = this.year * 12 + (this.month - 1) + delta;
    this.setMonth(Math.floor(total / 12), (total % 12 + 12) % 12 + 1);
  }

  setCurrency(currency) {
    this.currency = currency;
  }

  setWindow(range) {
    this.window = range;
  }

  render() {
    const { year, month } = this;
    const today = todayISO();
    const total = daysInMonth(year, month);
    const leading = weekdayOf(toISO(year, month, 1));

    // Group this month's entries once instead of filtering per day.
    const byDate = new Map();
    for (const entry of this.store.entries) {
      if (!entry.date.startsWith(`${year}-${String(month).padStart(2, '0')}`)) continue;
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    }

    const cells = [];

    // Trailing days of the previous month keep the grid rectangular; clicking one
    // still adds income on that real date.
    const prevTotal = daysInMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
    for (let i = leading - 1; i >= 0; i -= 1) {
      const y = month === 1 ? year - 1 : year;
      const m = month === 1 ? 12 : month - 1;
      cells.push(this.cell(toISO(y, m, prevTotal - i), [], today, true));
    }

    for (let day = 1; day <= total; day += 1) {
      const iso = toISO(year, month, day);
      cells.push(this.cell(iso, byDate.get(iso) || [], today, false));
    }

    const trailing = (7 - (cells.length % 7)) % 7;
    for (let day = 1; day <= trailing; day += 1) {
      const y = month === 12 ? year + 1 : year;
      const m = month === 12 ? 1 : month + 1;
      cells.push(this.cell(toISO(y, m, day), [], today, true));
    }

    this.gridEl.innerHTML = cells.join('');
  }

  cell(iso, entries, today, outside) {
    const day = Number(iso.slice(8, 10));
    const inWindow = this.window && iso >= this.window.start && iso <= this.window.end;

    const classes = ['day'];
    if (outside) classes.push('outside');
    if (iso === today) classes.push('today');
    if (inWindow) classes.push('in-window');
    if (entries.length) classes.push('has-entries');

    let body = '';
    if (entries.length) {
      const chips = entries.slice(0, MAX_CHIPS).map((e) => `
        <span class="chip${e.kind === 'upwork' ? ' upwork' : ''}${e.received ? '' : ' pending'}" data-entry-id="${e.id}"
          title="${chipTitle(e)}">
          <em>${escapeHtml(e.source || 'Income')}</em>
          <b>${formatCompact(e.net ?? e.gross ?? 0, this.currency)}</b>
        </span>`).join('');

      const more = entries.length > MAX_CHIPS
        ? `<span class="chip more">+${entries.length - MAX_CHIPS} more</span>`
        : '';

      const dayTotal = entries.length > 1
        ? `<span class="day-total">${formatCompact(sum(entries.map((e) => e.net ?? 0)), this.currency)}</span>`
        : '';

      body = `<span class="chips">${chips}${more}</span>${dayTotal}`;
    }

    return `
      <button type="button" class="${classes.join(' ')}" data-date="${iso}" aria-label="${iso}">
        <span class="day-num">${day}</span>
        ${body}
      </button>`;
  }
}

function chipTitle(entry) {
  const parts = [entry.received ? 'Recebido' : 'Ainda não recebido'];
  if (entry.kind === 'upwork') parts.push('Upwork');
  if (entry.category) parts.push(entry.category);
  return escapeHtml(parts.join(' · '));
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { MONTH_NAMES };
