---
description: The waitlist - who is waiting, for what, with whom, how long - against the empty diary, so open time becomes bookings.
---

1. Run `node scripts/clinic.mjs waitlist --json` and `gaps --json` together.
2. Match them: for each waiting patient, name the first open slot that fits their service and preference note. Offer the booking command ready to run.
3. Booked in: `waitlist remove PATIENT --booked`. Not waiting any more: `waitlist remove PATIENT`.
4. Add: `waitlist add PATIENT [--service= --practitioner= --note="lunchtimes best"]`.
