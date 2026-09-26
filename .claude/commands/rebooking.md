---
description: Who leaves holding their next appointment, per practitioner, last 28 days. The number that decides whether the diary fills itself or the desk fills it.
---

1. Run `node scripts/clinic.mjs rebooking --json`.
2. Present per practitioner: visits, how many left rebooked, the percentage. Name the gap between the best and the rest; that gap is coaching, not luck.
3. A patient who leaves without their next visit is a discharge nobody decided: cross-check `lapsed --json` for where they end up.
