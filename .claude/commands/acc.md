---
description: The ACC position in one look - every ACC case with sessions used, booked and remaining, which claims need an ACC32 now, and what ACC owes the clinic on unpaid invoices.
---

1. Run `node scripts/clinic.mjs cases --json` and keep the `funding = "acc"` rows; then `debtors --json` for the funder lines.
2. Present three short tables: claims running down (remaining <= 2, worst first, with the patient and claim number), claims fine, and ACC invoices unpaid with days overdue.
3. For every claim at or near its limit: the action is the ACC32 now, then `case extend CASE-1 --sessions=N` when the outcome lands. Say which patients have sessions booked that depend on it.
4. For unpaid ACC invoices past 30 days: query the schedule; name the invoice refs.
