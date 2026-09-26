---
description: The did-not-attend record, last 180 days, with each patient's habit counted and what each miss was worth.
---

1. Run `node scripts/clinic.mjs dnas --json`.
2. Present newest first: patient, phone, what was missed, worth, and the habit count.
3. Group the repeat offenders (two or more in six months): those are the cancellation-policy conversations, and the operator decides, not the system.
