---
description: The service list - what the clinic offers, how long each takes, what each costs. Bookings and invoices read from here.
---

1. Run `node scripts/clinic.mjs services --json`.
2. Present grouped by discipline with minutes and price.
3. Add: `service add NAME --minutes=30 --price=85 [--discipline= --kind=initial|followup|other]`. Price changes are a new conversation with the operator, not a silent edit.
