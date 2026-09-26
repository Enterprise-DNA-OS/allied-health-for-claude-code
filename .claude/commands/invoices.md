---
description: Invoices and payments - what has been billed, to whom (patient, ACC, insurer), what is owing, record a payment. A payment never exceeds the balance.
---

1. The list: `node scripts/clinic.mjs invoices --json` (add `--unpaid` for the open ones). Who owes: `debtors --json`.
2. Record money: `pay INV-1 --amount=85 [--method=card|cash|transfer|acc --on=DATE]`. Paid in full flips the invoice to paid on its own.
3. On paper: `npm run docs -- invoice` renders each invoice branded from `brand.json`; `patient-statement` renders one page per patient with a balance.
4. Chasing is drafting, never sending: /draft-reminders covers the overdue lines.
