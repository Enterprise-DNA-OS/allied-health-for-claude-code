---
description: The day sheet - today's (or any day's) visits per practitioner, with each patient's alerts, funding and confirmation state, so the desk knows what is walking in before it does.
---

1. Run `node scripts/clinic.mjs day --json` (add `--date=` for another day).
2. Present it per practitioner, in time order. Call out loudly: UNCONFIRMED visits (call them this morning), medical alerts (the practitioner reads these before the patient sits down), and any funded case on its last approved sessions (`patient NAME --json` shows the arithmetic).
3. For tomorrow's sheet, offer `/draft-reminders` for the unconfirmed.
4. End with the day's open time (`gaps --json`) and whether anyone on the waitlist fits it.
