---
description: Draft tomorrow's appointment reminders and the overdue-invoice nudges into drafts/ - a person sends them. Appointment reminders go to anyone booked (they are not marketing); money nudges stay polite and specific.
---

1. Run `node scripts/clinic.mjs day --date=tomorrow --json` and `debtors --json`.
2. For each UNCONFIRMED visit tomorrow, write `drafts/reminder-<name>.md`: two lines with the time, the practitioner and a reply-to-confirm ask, plus the patient's phone number on top. A reminder about a booked appointment is not marketing and needs no opt-in.
3. For each patient invoice past due, write `drafts/nudge-<name>.md`: friendly, names the invoice ref and amount, offers the card link or the front desk. Read the card first (`patient NAME --json`); an open case or a recent DNA changes the tone.
4. One extra file, `drafts/reminders-summary.md`: who got which draft and who needs a phone call instead (no number, or the operator prefers it). This system never sends anything.
