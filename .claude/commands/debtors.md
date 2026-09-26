---
description: Who owes the clinic, patients and funders separately, aged. The ACC and insurer lines everyone forgets to chase sit at the top, not the bottom.
---

1. Run `node scripts/clinic.mjs debtors --json`.
2. Two tables: patients owing (with days overdue and bucket), then funders owing (ACC, insurers). Give both totals.
3. The actions: patient lines get a polite nudge drafted (`/draft-reminders`); funder lines past 30 days get the schedule queried, by invoice ref and claim number.
4. `npm run view -- money` renders this page branded for the Monday meeting.
