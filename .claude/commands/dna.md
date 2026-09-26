---
description: Mark a did-not-attend, see the habit (how many in six months), draft the follow-up, and decide whether the cancellation-policy conversation is due. Never erases the appointment.
---

1. Run `node scripts/clinic.mjs dna REF --json`. It reports the patient's DNA count for six months.
2. Call while it is fresh: draft `drafts/dna-<name>.md` in two friendly lines offering two concrete times to rebook (from `gaps --json`). A person sends it.
3. Two or more in six months: say plainly that the cancellation policy conversation is due, and log the call when it happens (`log PATIENT "..."`).
4. `dnas --json` any time for the 180-day record, habit counted per patient.
