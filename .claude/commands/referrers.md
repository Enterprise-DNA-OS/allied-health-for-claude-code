---
description: The referrer book - who sends patients, how many, when the last one landed, and who has gone quiet. An allied health clinic lives on these relationships.
---

1. Run `node scripts/clinic.mjs referrers --json`.
2. Present by volume: each referrer with cases sent and days since the last. GONE QUIET rows (2+ referrals, nothing in 60 days) lead.
3. The action for a quiet referrer is a progress letter on a shared patient (`/draft-gp-letter`), not a marketing email.
4. Add: `referrer add NAME [--practice= --kind=gp|specialist|insurer --phone= --email=]`. Point cases at them with `case add ... --referrer=`.
