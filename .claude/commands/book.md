---
description: The diary - the week ahead by default, one day with --day, one practitioner with --practitioner. Every state loud - UNCONFIRMED bookings named so the desk can chase them.
---

1. Run `node scripts/clinic.mjs book --json` (add `--day=DATE` or `--practitioner=NAME` as asked).
2. Present it day by day, each visit with its time, practitioner, patient, service and case. UNCONFIRMED in capitals; those are calls to make.
3. If the operator asks how full the week is, run `gaps --json` too and give minutes booked against minutes open per practitioner.
