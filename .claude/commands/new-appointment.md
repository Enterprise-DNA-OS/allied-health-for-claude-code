---
description: Book a patient in. The gates speak - a funded case with no sessions left refuses (with the ACC32 or care-plan fix named), so does a double-booking or a time outside the practitioner's hours. Their refusals carry the fix.
---

1. Resolve the patient (`patient NAME --json`): read their card first. Alerts, open cases and funded-session arithmetic change the conversation.
2. If the visit belongs to an episode of care, pass it: `--case=CASE-1`. A funded visit without its case is a session the funder never sees.
3. Run `node scripts/clinic.mjs book add PATIENT PRACTITIONER --service="..." --date= --at= [--case=]`.
4. If a gate refuses, read the message aloud and do what it says: `case extend` once the approval lands, another time, another practitioner. Never look for a force flag; there are none.
5. If it books with a warning (last sessions on a plan), tell the operator now, not at session zero.
