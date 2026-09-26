---
description: Bring the clinic across from Cliniko (or any system that exports CSV) - patients and appointments, dry-run first, idempotent, every skipped row named. Marketing consent is never assumed from the old system, and old clinical notes stay in the old export.
---

1. In Cliniko: Settings, Data exports, request patients and appointments (CSV). Any system that exports those two shapes works.
2. Dry run first, always: `node scripts/clinic.mjs import cliniko --patients=Patients.csv --appointments=Appointments.csv --dry-run`. Read out what would be created, matched, and skipped, with reasons.
3. Fix what it names (a practitioner not on the team: `practitioner add`, then re-run). Then run it without `--dry-run`. Run it twice and the second pass books nothing new.
4. Say the two honest things out loud: every imported patient arrives with the marketing question UNANSWERED (consent is asked fresh, not copied from a tickbox nobody remembers); and imported history carries no treatment notes here - the old system's notes live in its own export, kept for the retention period (docs/replace-cliniko.md).
5. Open cases are worth rebuilding by hand for active patients (`case add`), with their real funding and session counts; the importer deliberately does not guess at claims.
