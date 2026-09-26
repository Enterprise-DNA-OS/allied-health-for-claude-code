---
description: Draft the recall and win-back messages for lapsed patients and due recalls who opted in to marketing - one personal message each, worth the most first, in drafts/. The not-opted-in get a call list instead, never a message. Never sends.
---

1. Run `node scripts/clinic.mjs lapsed --json` and `recalls --json`.
2. Split on `marketing_opt_in`. Only the opted-in get drafts (Unsolicited Electronic Messages Act 2007 / Spam Act 2003: consent first). Everyone else goes on a call list with their number and the one line about why they are worth the call.
3. For each opted-in patient, write `drafts/recall-<name>.md`: two or three lines from their own practitioner's room, naming what they were last in for and how long it has been, offering two concrete times this week (`gaps --json`). Read their card first (`patient NAME --json`): an open case, an alert or a log line changes the message.
4. One extra file, `drafts/recall-summary.md`: who got a draft, who is on the call list, and the open hours this fills. A person sends these; this system never does.
