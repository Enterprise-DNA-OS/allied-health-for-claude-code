<h1 align="center">Allied Health for Claude Code</h1>

<p align="center">
  <strong>The open-source allied health practice management system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Cliniko data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=cliniko">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/cliniko?utm_source=github&utm_medium=readme&utm_campaign=cliniko">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-cliniko">Instead of Cliniko</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Allied Health for Claude Code does the job you pay Cliniko for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Cliniko dashboard cannot.

The bill this replaces is priced per practitioner band, per month, forever: Cliniko runs from $45 a month for a sole practitioner to $395 a month for a large group ([cliniko.com/pricing](https://www.cliniko.com/pricing/)), so a 10-practitioner clinic pays around $2,340 a year and a multi-site group north of $4,700, before SMS charges, for a diary and a notes screen over a database.

Want the same thing with a web front end, an online booking page, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=cliniko).

This one covers the operating record of an allied health clinic: physio, osteo, chiro, podiatry, massage and the rest. The practitioners and their hours, the patient book with its history and alerts, referrers, episodes of care with their funding (ACC claim, Medicare care plan, insurer, private), the diary from booked to completed, SOAP treatment notes, invoices and payments, recalls and the waitlist. The rules of the trade are built in as gates with their sources cited: a funded case never books past its approved sessions (the ACC32 conversation happens before session 16, not after), nothing completes without informed consent on the case, a finalised note is never edited (corrections are dated addenda), nobody is double-booked, and marketing drafts only ever address patients who opted in. Claiming APIs and payment processing stay where they are, deliberately.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No per-practitioner bands, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/allied-health-for-claude-code.git
cd allied-health-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo clinic has a completed visit with no treatment note at all and another with a note still in draft, an ACC knee claim with 15 of 16 approved sessions used and the 16th booked tomorrow, a case treated three times with no informed consent on record, a visit two days ago nobody closed out, an unconfirmed booking tomorrow morning, a fresh DNA from a repeat offender, a patient invoice 26 days past due and $255 of ACC money 36 days past due, the best massage regular quietly lapsed, an orthotics annual review falling due, a waitlisted patient who fits tomorrow's empty diary, and a GP practice that used to refer every month gone silent; the answer shows you exactly how this system thinks.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-practitioner fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. An unwritten treatment note outranks everything |
| `/day` | The day sheet per practitioner: alerts, funding and confirmation state before it walks in |
| `/book` | The diary: the week, one day, one practitioner, every state loud |
| `/new-appointment` | Book a patient in; the gates speak and their refusals carry the fix |
| `/complete` | Close out a visit: completed, invoiced to the right payer, then the note while it is fresh |
| `/note` | The SOAP note: draft, finalise, and after that addenda only |
| `/notes-due` | Every clinical record not finalised, oldest first |
| `/dna` | Mark the no-show, count the habit, draft the follow-up |
| `/patient` | One patient's whole card before they are in the room |
| `/case` | Episodes of care: funding, consent, the ACC32 extension, discharge |
| `/acc` | The ACC position: claims running down, ACC32s to lodge, what ACC owes |
| `/invoices` `/debtors` | What is billed, what is owing, patients and funders separately |
| `/takings` | Visits and dollars by practitioner |
| `/rebooking` | Who leaves holding their next appointment. The number that decides the year |
| `/gaps` | The empty diary, next 7 days, and who fills it |
| `/dnas` | The 180-day record with each patient's habit counted |
| `/recalls` | Clinical follow-up due, consent line drawn |
| `/waitlist` | Who is waiting, matched against the open time |
| `/referrers` | Who sends patients, and who has gone quiet |
| `/team` `/services` | The practitioners, their hours, the menu of services |
| `/compliance` | The rule book run against the records, sources cited |
| `/weekly-review` | The Monday review written from four commands |
| `/log` | The conversation onto the patient's record |
| `/draft-reminders` `/draft-recall` `/draft-gp-letter` | Drafts to `drafts/`; a person sends them |
| `/import` | Bring the clinic across from Cliniko, dry-run first |
| `/customise` | Change a field, a rule, a session count, in plain language |
| `/new-view` | A new read-only dashboard page, described in plain language |

## Instead of Cliniko

Export your patients and appointments from Cliniko (or Nookal, Zanda, coreplus, Jane, or any clinic system that exports CSV), then:

```bash
node scripts/clinic.mjs import cliniko --patients=Patients.csv --appointments=Appointments.csv --dry-run
node scripts/clinic.mjs import cliniko --patients=Patients.csv --appointments=Appointments.csv
```

The importer matches common column-name variants, is idempotent (re-running books nothing twice), and names every row it skips. Two things are deliberate: every imported patient arrives with the marketing question unanswered (consent gets asked fresh, not copied from a tickbox nobody remembers), and old clinical notes stay in Cliniko's own export as your retention copy rather than being re-typed into a new system. [docs/replace-cliniko.md](docs/replace-cliniko.md) covers exactly what carries over, what starts fresh, and why.

### Ten questions your practice dashboard cannot answer

Each of these is one plain-language ask away in Claude Code, because the record is a database you own:

1. Which ACC claims will run out of approved sessions inside the visits already booked, and which need the ACC32 lodged this week?
2. Which completed visits this month still have no finalised treatment note, and in whose room did they happen?
3. Which patients are past their usual visit rhythm with nothing booked, ranked by what they spent this year?
4. Which referrers used to send a patient a month and have gone quiet, and which shared patient would a progress letter go on?
5. How much money does ACC owe us right now, on which invoices, and how many days past the schedule is each one?
6. Which care plans hit their five-session Medicare cap before the treatment plan says the patient is done?
7. Which patients DNA'd twice or more in six months, and what was each empty room worth?
8. What does tomorrow's open diary time cost at list prices, and who on the waitlist fits each hole?
9. Which treated cases have no informed consent recorded, before an auditor asks the same question?
10. What share of each practitioner's patients leave holding their next appointment, and whose number slipped this month?

## Your first hour: ten things to ask for

1. "Walk me through everything on the attention list and what clears each one."
2. "Who is in tomorrow, and what should each practitioner know before they arrive?"
3. "Book Oliver in with Aroha for a follow-up tomorrow at noon on his calf case."
4. "Complete APT-1116, invoice it to ACC, and take Kate's note: pain 2 out of 10, full squat, discharge planning next visit."
5. "Which ACC claims need an ACC32 this week?"
6. "The ACC32 came back approved for 4 more sessions on Liam's knee. Record it."
7. "Draft the recall messages for the lapsed patients who opted in, and give me the call list for the rest."
8. "Our treatment notes are due same-day, not two days." (a one-line settings change)
9. "Import our patients and appointments from Cliniko, dry run first."
10. "Add a page that shows every open ACC claim with its sessions and days since the last visit."

## Architecture

```
allied-health-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis, the rule book and the migration guide
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Allied Health for Claude Code for your clinic, migrates your Cliniko data, rebuilds your open cases with their real funding, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=cliniko)
- Read more: [enterprisedna.co/omni/instead-of/cliniko](https://enterprisedna.co/omni/instead-of/cliniko?utm_source=github&utm_medium=readme&utm_campaign=cliniko)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
