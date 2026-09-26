---
description: Episodes of care - open one per condition with its funding (ACC claim, Medicare care plan, insurer, private), record consent, extend the approval when the ACC32 or new plan lands, discharge when done. The session arithmetic lives here.
---

1. The list: `node scripts/clinic.mjs cases --json`. One case: `case CASE-1 --json`.
2. New condition, new case: `case add PATIENT --title="..." --funding=acc|epc|insurer|private [--claim= --sessions= --injury= --referrer=]`. A funded case must carry its approved session count; the booking gate lives on it.
3. Consent at the first visit, every episode: `case consent CASE-1` (Right 7; nothing completes without it).
4. Approval moved: `case extend CASE-1 --sessions=N --note="ACC32 approved DATE"`. The note lands on the patient's record.
5. Done: `case discharge CASE-1`. Then offer `/draft-gp-letter CASE-1`; a discharge letter is how referrers keep referring.
