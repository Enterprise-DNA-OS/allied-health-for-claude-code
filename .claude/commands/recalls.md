---
description: The recall list - who is due for clinical follow-up (annual reviews, rechecks), worth the most first, with the consent line drawn - opted-in patients get drafts, everyone else gets a call list.
---

1. Run `node scripts/clinic.mjs recalls --json`.
2. Present by due date: overdue first, then due this week. Each row says whether they are contactable by message (opted in) or a phone call (not opted in, or never asked).
3. Book them in, then close: `recall done PATIENT`. New cycle: `recall add PATIENT --due= --reason=`.
4. Messages are /draft-recall's job and only ever address the opted-in. A recall is clinical follow-up, but the message about it still respects the consent line.
