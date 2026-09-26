---
description: One patient's whole card before they are in the room - profile, alerts, cases with their funded-session arithmetic, upcoming and recent visits, what they owe, and the conversation log.
---

1. Run `node scripts/clinic.mjs patient NAME --json` (partial name is fine; if it lists candidates, ask which).
2. Present: who they are, ALERTS first if any, marketing consent state, their rhythm (usual gap, lapsed or not), each case with used/booked/approved sessions and consent state, upcoming visits, recent visits with note states, anything owing, the last few log lines.
3. If anything on the card is a decision (case at its session limit, consent missing, invoice overdue, no marketing answer), say it and name the command.
4. Log what the patient tells the desk: `log PATIENT "..."`.
