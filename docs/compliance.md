# The rules this clinic lives under

`/compliance` (the CLI's `compliance` command) checks the records against these rules. Each rule names its source. Nothing here is legal advice: this doc records the rules the operator has told the system to enforce, and the check reports what the data says.

The demo clinic is a New Zealand allied health practice, so the NZ instruments lead; the Australian equivalents are beside them because Cliniko's home market is Australia and the schema supports both (the `epc` funding type is the Medicare care plan).

## records: treatment notes finalised promptly

Every completed visit gets a treatment note, and the note is finalised within the window in settings (`note_due_days`, default 2 days). Once final, a note is never edited: corrections are dated addenda.

- Physiotherapy Board of New Zealand, *Physiotherapy standards*: record keeping (records made at the time of care or as soon as practicable after).
- Ahpra National Boards, *Codes of conduct*, health records section (clear, accurate, contemporaneous records).
- What a breach looks like in the data: a row in `v_notes_due` older than `note_due_days`.

## consent: informed consent per episode of care

Every case with treatment on it carries a consent date. The `complete` command refuses a visit on a case with no consent recorded; there is no force flag.

- Code of Health and Disability Services Consumers' Rights 1996 (NZ), Right 7: services only with informed consent.
- Ahpra National Boards, *Codes of conduct*, informed consent sections (AU).
- Breach: an open case with `sessions_used > 0` and `consent_recorded_on` null.

## funded-sessions: funded care stays inside its approval

An ACC claim treats up to its approved sessions; continuing needs an ACC32 (request for prior approval of further treatment) and the outcome recorded with `case extend`. A Medicare chronic disease management (care plan / EPC) referral holds at most five allied health services per patient per calendar year across MBS items 10950 to 10970. The booking gate enforces both; the check reports any case already committed past its approval.

- ACC treatment provider requirements: prior approval for treatment beyond the initial allocation (ACC32).
- Medicare Benefits Schedule, chronic disease management allied health items 10950 to 10970: five services per calendar year.
- Breach: an open funded case with `sessions_used + sessions_booked > approved_sessions`.

## retention: the clinical record survives discharge and archive

Nothing deletes here. Patients archive, cases discharge, appointments cancel with a reason, and the notes stay.

- Health (Retention of Health Information) Regulations 1996 (NZ): health information kept at least 10 years from the last care event.
- State health records Acts (AU, e.g. Health Records Act 2001 (Vic)): 7 years from last entry for adults, or until age 25 for children.
- Breach: a discharged case with completed (non-imported) visits and no notes.

## marketing-consent: marketing only ever addresses patients who opted in

`marketing_opt_in` is three-state: yes, no, never asked. Recall and win-back drafts only ever address the opted-in; everyone else lands on a call list. Reminders about a booked appointment are not marketing and go to anyone with a booking.

- Unsolicited Electronic Messages Act 2007 (NZ); Spam Act 2003 (Cth): consent before commercial electronic messages.
- Privacy Act 2020 (NZ) / Privacy Act 1988 (Cth): health information used for the purpose it was collected.
- The check reports how many active patients have never been asked, so the desk asks.

## cancellations: every cancellation and DNA keeps its record and reason

The `cancel` command requires a reason; `dna` marks, never erases. The appointment record is part of the health record.

- Professional record-keeping standards, as above: the appointment history is evidence of the care pathway.
- Breach: a cancelled appointment with no reason on it.

## Changing a rule

Rules move (session counts, retention periods, board standards). When one does: the operator confirms the new rule and its source, then the doc and the check in `scripts/clinic.mjs` change together, in the same commit. `/customise` handles the plain-language ask.
