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
- **Net is calculated, never typed** — for income in reais you enter the gross;
  for an Upwork transfer you enter the weekly net in dollars and the Wise VET,
  and the app works the whole chain out.
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

**Add income** — click an empty part of any day on the calendar, or press
**+ Add entry** in the table. Several incomes can land on the same day; each is
its own entry. <kbd>Enter</kbd> in the dialog adds the entry.

**Edit an income** — click it on the calendar and the same dialog opens with
everything filled in, ready to change. The **✎** button on a table row does the
same. It is the only way to edit an Upwork entry, since its amounts are worked
out from the dollars and the VET rather than typed in the table.

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
the next time. Each one gets its own colour, worked out from its name, shown as
a bar on the category cell and matched by the dot on its breakdown pill, so the
pills double as the legend. Filter by one with the **Category** dropdown, or by
clicking a category in the breakdown strip (click it again to clear). The filter
narrows both the totals and the table.

**Reading the table** — entries are grouped by month, and each month's heading
carries its own net for the rows shown, so the periods separate themselves
without any counting by eye. The headings follow the filters too.

**Recebido** — tick it once the money actually arrives. Income you have not
received yet is drawn hollow with a dashed outline on the calendar, and in
italics in the table, so a plan never looks like cash in hand. New entries start
ticked when dated today or earlier, unticked when dated ahead.

**Upwork** — pick *Upwork (US$)* in the dialog and enter two things: the **net
of the weeks** as Upwork shows it (you can add them up with `+`, e.g.
`393,89 + 393,89`) and the **VET** of the Wise transfer. The dialog shows the
whole chain as you type, so the number that lands in the table is never a
surprise — it is the calculator and the form at the same time.

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
      "kind": "brl",
      "gross": 8000,
      "rates": { "serviceFee": 0.15, "withdrawal": 2.99, "tithe": 0.1 },
      "grossBRL": 8000,
      "tithe": 800,
      "landed": 8000,
      "net": 7200,
      "received": true,
      "notes": ""
    }
  ]
}
```

An Upwork entry carries `"kind": "upwork"` with `usdNet` and `rate` instead of
`gross`. The calculated fields (`grossBRL`, `tithe`, `landed`, `net`) are written
out so the file reads well on its own — in a spreadsheet, or at a glance on
GitHub — but on load they are always recalculated from what you typed. The rules
decide them, never the stored numbers.

Older files still load fine, as income in reais keeping their gross — the Upwork
format needs the dollar amount and the VET, which they do not have, so an Upwork
transfer recorded under the old rules is worth entering again. A missing category
defaults to empty; the retired per-entry `tithe` and `upwork` flags are ignored; a missing **received** flag is read from the date — dated today or
earlier counts as received, dated ahead counts as expected — so entries written
before the flag existed land on the right side of the split. Once you save, the
flag is written out explicitly and the date no longer decides it.

### How the net is worked out

**Income in reais** — you type the gross; the dízimo is a tenth of it.

    Bruto R$ 8.000,00  − dízimo R$ 800,00  = R$ 7.200,00 livre

**Upwork** — you type the net of the weeks and the VET; everything else follows.
The gross is recomposed by **dividing by 0,85**, never by multiplying by 1,15:
US$ 393,89 ÷ 0,85 = US$ 463,40, which is what the Upwork statement shows.

    Net das semanas       US$ 1.575,56
    Bruto recomposto      US$ 1.853,60   (÷ 0,85)
      service fee 15%     US$   278,04
    − withdrawal fee      US$     2,99
    = enviado à Wise      US$ 1.572,57
    × VET 5,0588
    = caiu na conta        R$ 7.955,32
    − dízimo               R$   945,83
    = livre para gastar    R$ 7.009,49

The **VET already includes IOF and Wise's fee** (5,1028 becomes 5,0588 — the
0,86%), so nothing is taken off again after the conversion.

The dízimo, though, is worked out at **the day's rate**, not at the one net of
those fees: the VET is put back to 5,1027 before converting the gross, so the
base is US$ 1.853,60 × 5,1027 = R$ 9.458,33 and a tenth of that is R$ 945,83.
What lands in the account still converts at the VET itself.

Because the dízimo is a tenth of the **gross**, it comes to about 11,9% of what
actually reaches the account: the fees come out of your side, not the tithe's.

The rates — service fee, withdrawal fee, Wise + IOF, dízimo — live under the **%** button and
are stored in the data file, so they are the same on every device. Each entry
keeps the rates it was created with, so changing one today never rewrites what
already happened.

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
