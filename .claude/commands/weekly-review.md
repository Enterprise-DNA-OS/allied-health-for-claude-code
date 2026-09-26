---
description: The Monday review, written from four commands - what needs a decision, the week's diary, the money (takings, debtors, ACC), and the clinical risks (notes owing, funded cases running down, consent gaps, lapsed patients).
---

1. Run four commands, `--json` each: `node scripts/clinic.mjs attention`, `book`, `takings --days=7`, `debtors`. Add `rebooking`, `lapsed` and `gaps` when the week looks quiet.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. An unwritten treatment note or a funded case at its limit is the first line of the whole review.
   - **The week's diary.** Day by day: how full each practitioner is, what is unconfirmed, where the gaps are and who on the waitlist fits them.
   - **The money.** Last week's takings by practitioner, the rebooking rate, patients owing, and the funder lines with days overdue.
   - **The clinical record.** Notes not finalised (by practitioner), ACC claims needing an ACC32 this week, consent gaps, and the lapsed regulars worth a call.
3. End with at most five actions for the week, each doable with a single command or phone call.
4. On paper: `npm run view` renders the week, clinical and money pages in the clinic's brand.
