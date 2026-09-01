# Income Calendar

A private log of your income, in a calendar and a table, that you can open from
any browser — Mac, Windows, phone — and that keeps every change forever.

- **Calendar view** — one month at a time, navigate back through years of
  payment history or forward to plan what is coming.
- **Table view** — the same entries as a spreadsheet, side by side with the
  calendar. Edit in either one; both always show the same data.
- **Any period you like** — pick a first day and a last day, both counted, and
  get the gross and net totals for it. Presets cover the common ones, including
  *Month back* (e.g. last day August 2nd → July 2nd to August 2nd).
- **Net is calculated, never typed** — you enter the gross; the app takes off
  10% dízimo, plus 15% more when the work was billed through **Upwork**.
- **Received vs expected** — plan income for months ahead and flag each one as
  **Recebido** once it actually lands. The totals show both, split apart, and
  either one can be clicked to show just those entries.
- **Categories** — tag each income and filter the totals by category, with a
  per-category breakdown of the chosen period.
- **Save button** — edit as much as you like; pressing Save writes everything to
  GitHub as a single commit. Unsaved edits are kept safe in your browser in the
  meantime.

Everything runs for free: a public repo for the app, a **private** repo for your
data, GitHub Pages for hosting.

---

## How it works

There is no server and no database service. The app is a plain web page, and
your income entries live as one JSON file in a private GitHub repository that
only you can read. The page talks to GitHub directly from your browser.

```
Your browser  ──►  github.com/you/income-calendar-data (private)
   the app              data/entries.json  ← one commit per Save
```

Because every Save is a git commit, you get a complete, permanent history of
every change you ever make — for free, with no extra work.

---

## Setup

You need two repositories: **this one** (the app — public, so GitHub Pages is
free) and **a new private one** (your data). Your income numbers only ever live
in the private one.

### 1. Create the private data repository

1. Go to <https://github.com/new>.
2. Repository name: `income-calendar-data`
3. Select **Private**. ← important
4. Tick **Add a README file** (a repo needs at least one file to have a branch).
5. Click **Create repository**.

You don't need to add anything else — the app creates the data file on your
first Save.

### 2. Create an access token

This is the key that lets the app read and write that one repository. It is like
a hotel key card: it opens only that room, not your whole GitHub account.

1. Go to <https://github.com/settings/personal-access-tokens/new>
   (Settings → Developer settings → Personal access tokens → Fine-grained tokens).
2. **Token name**: `income-calendar`
3. **Expiration**: 1 year (you will make a new one when it expires).
4. **Repository access**: choose **Only select repositories**, then pick
   `income-calendar-data`.
5. **Permissions** → **Repository permissions** → find **Contents** and set it to
   **Read and write**. (Leave everything else alone.)
6. Click **Generate token** and **copy the token**. GitHub shows it only once —
   if you lose it, just make another one.

### 3. Turn on GitHub Pages for this repo

1. In **this** repository: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Wait a minute, then your app is live at
   `https://<your-username>.github.io/V-s-Income-Calendar/`.

> This repository is public so that Pages is free, which means someone with the
> link can load the page — but not your data. Without your token the page shows
> nothing but the empty connection screen.

### 4. Connect

Open the Pages address, then fill in:

| Field | Value |
| --- | --- |
| GitHub username | your username |
| Data repository | `income-calendar-data` |
| File path | `data/entries.json` |
| Branch | `main` |
| Token | the token you copied |
| Currency | your currency |

Press **Connect**. That's it.

Repeat this step once per device (Mac, phone, work computer) — the token is
stored in that browser only and never leaves it except to talk to github.com.

---

## Using it

**Add income** — click any day on the calendar, or press **+ Add entry** in the
table. Several incomes can land on the same day; each is its own entry.
<kbd>Enter</kbd> in the dialog adds the entry.

**Edit fast** — the table is built for speed: type straight into any cell, and
press <kbd>Enter</kbd> to jump down the same column. Amounts accept whatever you
type: `1.234,56`, `1234.56`, or `1000`. Only the **gross** is typed — the net is
calculated beside it, and hovering it shows the arithmetic.

**Copy an income** — press **⧉** on any row to copy it to the same day of the
next month, keeping the source, category, gross, notes and the Upwork flag. Copy
the copy to keep walking forward, month by month — that is how a recurring
salary gets planned across the year. A copy that lands in the future starts as
not received. Copying jumps the calendar to the new month so you can see it land.

**Categories** — type a category on any entry; it is remembered and suggested
the next time. Filter by one with the **Category** dropdown, or by clicking a
category in the breakdown strip (click it again to clear). The filter narrows
both the totals and the table.

**Recebido** — tick it once the money actually arrives. Income you have not
received yet is drawn hollow with a dashed outline on the calendar, and in
italics in the table, so a plan never looks like cash in hand. New entries start
ticked when dated today or earlier, unticked when dated ahead.

**Upwork** — tick it when the work was billed through Upwork, and a further 15%
comes off the gross. Those entries carry a coloured bar on their calendar chip.

**See a period's income** — set **From** and **To**; both days are counted. The
headline is the net for that period, with three figures under it:

| Card | What it totals |
| --- | --- |
| **✓ Received** | Net already in hand |
| **◷ Expected** | Net still to come |
| **◈ Dízimo** | 10% of all the gross in the period — the amount owed |

**Click Received or Expected** to show only those entries — the headline, the table
and the category breakdown all follow it, and the card reads as pressed. Click it
again to go back to everything. Those two cards keep showing their own totals
while a filter is on, so you can click straight from one to the other. The
Dízimo figure and the arithmetic line below the cards describe whatever is on
screen, so they follow every filter. Category and card filters combine.

The calendar highlights the days the period covers, and the breakdown strip shows
the net per category. The presets are:

| Preset | What it does |
| --- | --- |
| **Month back** | Keeps the last day, sets the first day one month earlier |
| **This month** | The current calendar month, 1st to last day |
| **This year** | January 1st to December 31st |

**Save** — nothing reaches GitHub until you press **Save**
(<kbd>Ctrl</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> also works). One press = one
commit, no matter how many edits it contains.

**Unsaved work is safe** — as you type, a draft is kept in your browser. If the
tab crashes or the phone dies, the draft is offered back the next time you open
the app. Drafts are local only and never create commits.

---

## Good to know

- **The period is inclusive on both ends.** From July 2nd to August 2nd counts
  income on July 2nd *and* on August 2nd. If you check two periods back to back,
  a payment landing exactly on a shared boundary day is counted in both.
- **Short months clamp.** *Month back* from March 31st starts on February 28th
  (or 29th), because February has no 31st.
- **Categories are free text.** There is no list to maintain: type a new one and
  it joins the suggestions; stop using it and it disappears on its own.
- **Editing from two devices at once.** If the file changed on GitHub since the
  page loaded, GitHub refuses the write and the app asks whether to overwrite or
  reload — nothing is silently lost.
- **Your data file** is readable and editable directly on GitHub if you ever
  want to fix something by hand, or feed it into a spreadsheet.
- **Costs nothing.** Private repos, GitHub Pages, and the API calls this app
  makes are all free. The only thing that would ever cost money is an optional
  custom domain.

### Data format

```json
{
  "version": 1,
  "updatedAt": "2026-08-22T12:00:00.000Z",
  "entries": [
    {
      "id": "9f0c…",
      "date": "2026-08-05",
      "source": "Salary",
      "category": "Employment",
      "gross": 8000,
      "upwork": false,
      "net": 7200,
      "received": true,
      "notes": ""
    }
  ]
}
```

`net` is written out so the file reads well on its own, but it is always
recalculated from `gross` and `upwork` when loaded — the rules decide it, never
the stored number.

Older files still load fine. A missing category or Upwork flag defaults to empty
and `false`; the retired per-entry `tithe` flag is ignored, since every income is
tithed now; a missing **received** flag is read from the date — dated today or
earlier counts as received, dated ahead counts as expected — so entries written
before the flag existed land on the right side of the split. Once you save, the
flag is written out explicitly and the date no longer decides it.

### How the net is worked out

Both percentages come off the **full gross** and never compound on each other:

| | Plain income | Upwork income |
| --- | --- | --- |
| Gross | R$ 1.000,00 | R$ 1.000,00 |
| Dízimo (10% of gross) | − R$ 100,00 | − R$ 100,00 |
| Upwork (15% of gross) | — | − R$ 150,00 |
| **Net** | **R$ 900,00** | **R$ 750,00** |

The rates live in `js/deductions.js`, in one place, if they ever change.

Expenses are not part of this version. When they are added, they will slot into
the same file as entries with a type, so this history stays intact.

### Signing out of a device

Open the browser console on that device and run:

```js
incomeCalendarSignOut()
```

That erases the token, the settings and any local draft from that browser.

---

## Running it locally

The app uses JavaScript modules, so it needs a web server rather than opening
the file directly:

```bash
python3 -m http.server 8899
# then open http://127.0.0.1:8899
```
