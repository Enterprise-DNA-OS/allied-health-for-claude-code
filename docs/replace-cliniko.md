# Moving off Cliniko

The whole move is: export two files from Cliniko, run one command twice (dry run, then real), rebuild the open cases by hand, keep the old export for the retention period. A quiet afternoon for a typical clinic.

## 1. Export from Cliniko

Settings, then **Data exports**. Request:

- **Patients** (CSV): names, dates of birth, contact details, referral source.
- **Appointments** (CSV): patient, practitioner, appointment type, start, duration.
- **Everything else it offers** (treatment notes as PDF/HTML, invoices, letters): download and keep. See "what stays behind" below; this archive IS your retention copy.

## 2. Import

```bash
node scripts/clinic.mjs import cliniko --patients=Patients.csv --appointments=Appointments.csv --dry-run
node scripts/clinic.mjs import cliniko --patients=Patients.csv --appointments=Appointments.csv
```

The dry run writes nothing and names everything: who would be created, who matched an existing record, and every skipped row with its reason (a missing date, a practitioner not on the team). Fix what it names (`practitioner add`, then re-run). The real run is idempotent: run it five times, the book is the same.

Column names are matched loosely (`First name`/`Last name` or a single `Name`, `Starts at` or `Date` plus `Start time`, `Appointment type` or `Service`, DD/MM/YYYY dates handled). Appointment types not on your service list are created as they arrive, with the row's duration and price.

## What carries over

- **Patients**: name, date of birth, phone, email, referral source. Matching is by name: an existing patient is updated (empty fields filled), never duplicated.
- **Appointment history**: imported as completed visits, so rhythms, lapsed detection and the patient card's history work from day one.
- **The booked future**: rows dated today or later arrive as bookings.
- **Services**: created from the appointment types in the export.

## What starts fresh, deliberately

- **Marketing consent.** Every imported patient arrives with the marketing question UNANSWERED. A tickbox nobody remembers from the old system is not consent (Unsolicited Electronic Messages Act 2007; Spam Act 2003). The desk asks at the next visit: `patient set NAME --opt-in=yes|no`. Until then they are on call lists, not message lists.
- **Cases and funding.** The importer does not guess at ACC claims or care plans. For each active patient, open the real case with the real numbers: `case add PATIENT --title="..." --funding=acc --claim=AB12345 --sessions=16 --referrer="Dr ..."`. Ten minutes of front-desk truth beats an afternoon of unwinding guessed claims.
- **Informed consent.** Recorded per case, at the next visit (`case consent CASE-1`). The complete gate will insist anyway.

## What stays behind, honestly

- **Old treatment notes.** Cliniko's notes export as documents, not structured data, and a clinical note re-typed into a new system is a transcription risk with no clinical value. They stay in the export you downloaded, which you keep for the retention period (10 years NZ; 7 years or age 25 AU). Imported visits are marked so this system never nags for notes it was never owed. New visits get new notes here, from day one.
- **Letters and attachments.** Same story: they live in the archive folder.
- **Online bookings and SMS.** The free version drafts reminders and a person sends them. A booking page and wired-up SMS are exactly what Enterprise DNA builds into a customised version.

## The first week after

1. `/attention` every morning: it will surface what the import could not know (recalls to set, cases to open).
2. Set the recalls that matter: `recall add PATIENT --due= --reason=`.
3. Add the referrers you live on: `referrer add`, and point cases at them.
4. `npm test` any time you want proof the machine still holds.

Rather have all of this done for you, including the case rebuild? That is the installed version: https://enterprisedna.co/omni/instead-of/cliniko
