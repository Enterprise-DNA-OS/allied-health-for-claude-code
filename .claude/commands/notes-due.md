---
description: Every completed visit whose clinical record is not finalised - no note at all, or a note still in draft - oldest first. The first list a funder audit asks for.
---

1. Run `node scripts/clinic.mjs notes-due --json`.
2. Present oldest first, grouped by practitioner: each row is that practitioner's job today, not the desk's.
3. For each, the fix is two commands: `note add REF --s= --o= --a= --p=` then `note final REF`.
4. If the list is empty, one line, and say what the streak is worth: a clean record is the audit that never happens.
