---
description: The treatment note - SOAP, draft until finalised, immutable after. Corrections are dated addenda, never edits. This is the record that defends the visit in an audit, a funder review or a court.
---

1. Draft: `node scripts/clinic.mjs note add REF --s="subjective" --o="objective" --a="assessment" --p="plan"`. Run it again to fill gaps while it is a draft.
2. Finalise: `note final REF`. From here the note never changes (Physiotherapy Board record-keeping standard; Ahpra codes of conduct).
3. Correction after finalising: `note addendum REF "..."`. It lands dated, under the original.
4. Read back: `notes PATIENT --json`. What is owed: `notes-due --json`.
5. Take the practitioner's words as they said them. Tidy grammar, never invent clinical content. If a field was not said, leave it empty and say so.
