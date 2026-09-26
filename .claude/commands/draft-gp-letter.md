---
description: Draft a progress or discharge letter to the referrer, written from the case's own record - visits, the latest finalised note, the plan - into drafts/. The letter that keeps referrers referring. Never sends.
---

1. Run `node scripts/clinic.mjs case CASE-1 --json` and `notes PATIENT --json`. Only finalised notes feed a letter; a draft note is not a source.
2. Write `drafts/gp-letter-<case>.md` addressed to the referrer on the case (or ask which referrer if the case has none): two short paragraphs - what was found and done (visit count, the objective markers from the latest final note), and what happens next (plan, discharge or continued care). Plain clinical English, no invented findings.
3. `npm run docs -- case-summary` renders the branded episode-of-care summary to attach.
4. Leave sending to a person. Log it when it goes: `log PATIENT "progress letter sent to Dr ..."`.
