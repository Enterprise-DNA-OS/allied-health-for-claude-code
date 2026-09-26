---
description: The empty diary, next 7 days, per practitioner - window, booked and open minutes - and who on the waitlist or recall list fits it.
---

1. Run `node scripts/clinic.mjs gaps --json`.
2. Present the open time per practitioner per day, biggest holes first.
3. Then fill it: `waitlist --json` (who is waiting, what for), `recalls --json` (who is due anyway). Offer the bookings: `book add PATIENT PRACTITIONER --service= --date= --at=`.
4. Open time named with a person who fits it is a booking; open time alone is just a report.
