---
description: The conversation onto the patient's record - phone calls, front-desk conversations, family messages. Admin memory, kept separate from the clinical note.
---

1. Run `node scripts/clinic.mjs log PATIENT "what was said" [--author="who took it"]`.
2. Clinical content does not go here: findings, treatment and plans belong in the treatment note (`note add REF`). This is "daughter rang, mornings suit" territory.
3. Read back: the patient card (`patient NAME`) shows the last five lines.
