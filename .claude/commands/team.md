---
description: The practitioners and their working hours (the booking gate reads them), registrations on file, and the services and prices the diary books from.
---

1. The team: `node scripts/clinic.mjs team --json`. Services and prices: `services --json`.
2. New practitioner: `practitioner add NAME [--discipline= --registration=]`, then set every working day: `practitioner hours NAME mon --start=8:00 --end=16:00`. A day with no hours is a day nothing books.
3. Stop a day: `practitioner hours NAME DAY --clear`. New service: `service add NAME --minutes=30 --price=85 [--discipline= --kind=initial|followup]`.
4. Registration numbers live here because the paperwork asks for them; keep them current.
