---
description: Everything that wants a decision this morning, worst first. An unwritten treatment note outranks everything, then a funded case out of sessions, missing consent, visits left open in the diary, unconfirmed bookings, fresh DNAs, overdue money (patients and ACC), lapsed regulars, recalls due, the waitlist against the empty diary, and referrers gone quiet.
---

1. Run `node scripts/clinic.mjs attention --json`.
2. Present it worst first, grouped by reason, in the clinic's words. Lead with anything rank 1 (a clinical record not finalised, a funded case at its limit, consent missing): those are today's first jobs, say so plainly.
3. For each group, say the one action that clears it: `note add REF` then `note final REF`, `case extend CASE-1 --sessions=N` once the ACC32 lands, `case consent CASE-1`, `complete REF` or `dna REF`, `confirm REF`, `pay INV-1 --amount=`, `/draft-recall`, book the recall, fill the gap from the waitlist, `/draft-gp-letter` for the quiet referrer.
4. If the list is empty, say so in one line and stop.
