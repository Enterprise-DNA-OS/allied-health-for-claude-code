-- allied-health-for-claude-code: core schema.
-- An allied health clinic's operating record the way Cliniko sells it: the
-- practitioners and their hours, the patient book with its history, referrers,
-- episodes of care with their funding (ACC claim, Medicare care plan, private),
-- the diary from booked to completed, treatment notes, invoices and payments,
-- recalls and the waitlist.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is in cents, NZD by default. GST and payroll stay in accounting and
-- payroll, deliberately.
--
-- Deliberately NOT here: payments processing, online booking pages, SMS
-- sending, claiming APIs. Reminders and recalls draft to drafts/ and a person
-- sends them; claims go through the channel the funder requires.
--
-- The sharp edges are deliberate:
--   * a treatment note is written for every completed appointment, and once
--     finalised it is never edited: corrections are addenda (Physiotherapy
--     Board of New Zealand, Physiotherapy standards: record keeping; AHPRA
--     codes of conduct, health records)
--   * a funded episode of care never books past its approved sessions: an
--     ACC case stops at the approved count until an ACC32 outcome is
--     recorded, a Medicare care plan stops at the sessions the plan holds
--   * completing a visit on a case with no informed consent on record is
--     refused (Code of Health and Disability Services Consumers' Rights
--     1996, Right 7)
--   * nobody is double-booked, and nothing is booked outside a
--     practitioner's recorded working hours
--   * recall and marketing drafts only ever address patients who opted in
--     (Unsolicited Electronic Messages Act 2007; Spam Act 2003 (Cth));
--     reminders about a booked appointment are not marketing
--   * no deleting records: appointments cancel with a reason, patients
--     archive, cases discharge, the clinical record stays

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Settings ------------------------------------------------------------------------
-- The handful of numbers the rules and views read. Change them with
-- `settings set`.

create table if not exists settings (
  key         text primary key,
  value       text not null,
  note        text,
  updated_at  timestamptz not null default now()
);

-- Practitioners ---------------------------------------------------------------------
-- The clinical team. Working hours live in practitioner_hours; the booking
-- gate reads them.

create table if not exists practitioners (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  discipline       text not null default 'physiotherapist',
  registration_no  text,
  status           text not null default 'active' check (status in ('active', 'former')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_practitioners_updated on practitioners;
create trigger trg_practitioners_updated before update on practitioners
  for each row execute function set_updated_at();

create table if not exists practitioner_hours (
  practitioner_id  uuid not null references practitioners(id),
  weekday          int  not null check (weekday between 0 and 6),  -- 0 = Sunday
  starts_at        time not null,
  ends_at          time not null,
  primary key (practitioner_id, weekday)
);

-- Referrers -------------------------------------------------------------------------
-- The GPs, specialists and practices that send patients. An allied health
-- clinic lives on these relationships; the view says who has gone quiet.

create table if not exists referrers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  practice    text,
  kind        text not null default 'gp' check (kind in ('gp', 'specialist', 'insurer', 'other')),
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);

-- Patients --------------------------------------------------------------------------
-- marketing_opt_in three-state: true opted in, false opted out, null never
-- asked. Recall and marketing drafts read it; appointment reminders do not.

create table if not exists patients (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  date_of_birth     date,
  phone             text,
  email             text,
  nhi               text,           -- NZ National Health Index, if known
  address           text,
  referral_source   text,
  marketing_opt_in  boolean,
  alerts            text,           -- medical alerts: allergies, red flags, falls risk
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists trg_patients_updated on patients;
create trigger trg_patients_updated before update on patients
  for each row execute function set_updated_at();

-- Cases ----------------------------------------------------------------------------
-- An episode of care: one condition, one funding arrangement. ACC cases carry
-- the claim number and approved sessions; Medicare care plans (EPC / CDM)
-- carry the sessions the plan holds; private cases carry neither.

create table if not exists cases (
  id                   uuid primary key default gen_random_uuid(),
  ref                  text not null unique,       -- CASE-101
  patient_id           uuid not null references patients(id),
  title                text not null,              -- "Right knee ACL rehab"
  funding              text not null default 'private'
                       check (funding in ('acc', 'epc', 'insurer', 'private')),
  claim_number         text,                       -- ACC45 claim number, plan reference
  injury_date          date,
  approved_sessions    int,                        -- null = uncapped (private)
  referrer_id          uuid references referrers(id),
  referral_date        date,
  consent_recorded_on  date,                       -- informed consent, Right 7
  status               text not null default 'open' check (status in ('open', 'discharged')),
  opened_on            date not null default current_date,
  discharged_on        date,
  note                 text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
drop trigger if exists trg_cases_updated on cases;
create trigger trg_cases_updated before update on cases
  for each row execute function set_updated_at();

-- Services --------------------------------------------------------------------------

create table if not exists services (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  discipline   text,
  kind         text not null default 'followup' check (kind in ('initial', 'followup', 'other')),
  minutes      int not null default 30,
  price_cents  int not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Appointments ----------------------------------------------------------------------

create table if not exists appointments (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,            -- APT-1001
  patient_id       uuid not null references patients(id),
  practitioner_id  uuid not null references practitioners(id),
  case_id          uuid references cases(id),
  service_id       uuid not null references services(id),
  on_date          date not null,
  starts_at        time not null,
  ends_at          time not null,
  status           text not null default 'booked'
                   check (status in ('booked', 'confirmed', 'completed', 'dna', 'cancelled')),
  cancel_reason    text,
  imported         boolean not null default false,  -- history from the old system; its notes live in that system's export
  price_cents      int not null default 0,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_appointments_updated on appointments;
create trigger trg_appointments_updated before update on appointments
  for each row execute function set_updated_at();

-- Treatment notes --------------------------------------------------------------------
-- One per completed appointment, SOAP shape. Draft until finalised; after
-- that the record is immutable and corrections are addenda.

create table if not exists treatment_notes (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid not null unique references appointments(id),
  patient_id       uuid not null references patients(id),
  practitioner_id  uuid not null references practitioners(id),
  case_id          uuid references cases(id),
  on_date          date not null,
  subjective       text,
  objective        text,
  assessment       text,
  plan             text,
  addendum         text,
  status           text not null default 'draft' check (status in ('draft', 'final')),
  finalised_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_treatment_notes_updated on treatment_notes;
create trigger trg_treatment_notes_updated before update on treatment_notes
  for each row execute function set_updated_at();

-- Conversation log --------------------------------------------------------------------
-- Phone calls, front desk conversations, admin notes. Not the clinical record.

create table if not exists patient_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id),
  on_date     date not null default current_date,
  author      text,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Invoices and payments ----------------------------------------------------------------
-- payer says who owes it: the patient at the desk, ACC on the schedule, or an
-- insurer. The card terminal keeps taking the money; this is the record.

create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,                 -- INV-2001
  patient_id  uuid not null references patients(id),
  case_id     uuid references cases(id),
  payer       text not null default 'patient' check (payer in ('patient', 'acc', 'insurer')),
  issued_on   date not null default current_date,
  due_on      date not null,
  status      text not null default 'sent' check (status in ('draft', 'sent', 'paid', 'written_off')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_invoices_updated on invoices;
create trigger trg_invoices_updated before update on invoices
  for each row execute function set_updated_at();

create table if not exists invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id),
  description  text not null,
  qty          int not null default 1,
  unit_cents   int not null default 0
);

create table if not exists payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id),
  on_date     date not null default current_date,
  amount_cents int not null check (amount_cents > 0),
  method      text not null default 'card' check (method in ('card', 'cash', 'transfer', 'acc', 'other')),
  created_at  timestamptz not null default now()
);

-- Recalls and the waitlist ----------------------------------------------------------------

create table if not exists recalls (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id),
  due_on      date not null,
  reason      text not null,
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_recalls_updated on recalls;
create trigger trg_recalls_updated before update on recalls
  for each row execute function set_updated_at();

create table if not exists waitlist (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references patients(id),
  service_id       uuid references services(id),
  practitioner_id  uuid references practitioners(id),   -- null = anyone
  added_on         date not null default current_date,
  note             text,
  status           text not null default 'waiting' check (status in ('waiting', 'booked', 'removed')),
  updated_at       timestamptz not null default now()
);
drop trigger if exists trg_waitlist_updated on waitlist;
create trigger trg_waitlist_updated before update on waitlist
  for each row execute function set_updated_at();

-- Views ===============================================================================
-- The reads the weekly commands live on.

-- Patients with their rhythm: last visit, spend, the usual gap between
-- visits (needs 3+ completed visits to mean anything), and the lapsed flag.
create or replace view v_patients as
with visits as (
  select patient_id, on_date,
         lag(on_date) over (partition by patient_id order by on_date) as prev_date
  from appointments
  where status = 'completed'
),
rhythm as (
  select patient_id,
         count(*) + 1 as visit_count,   -- gaps + 1
         avg(on_date - prev_date) as usual_gap_days
  from visits
  where prev_date is not null
  group by patient_id
  having count(*) >= 2                  -- a rhythm needs three visits to mean anything
),
last_visit as (
  select patient_id, max(on_date) as last_visit_on
  from appointments where status = 'completed' group by patient_id
),
next_appt as (
  select patient_id, min(on_date) as next_appt_on
  from appointments
  where status in ('booked', 'confirmed') and on_date >= current_date
  group by patient_id
),
spend as (
  select patient_id, sum(price_cents) as spend_cents_12m
  from appointments
  where status = 'completed' and on_date > current_date - 365
  group by patient_id
)
select p.id as patient_id, p.name, p.date_of_birth, p.phone, p.email, p.nhi,
       p.referral_source, p.marketing_opt_in, p.alerts, p.status,
       lv.last_visit_on,
       (current_date - lv.last_visit_on) as days_since_visit,
       na.next_appt_on,
       coalesce(s.spend_cents_12m, 0) as spend_cents_12m,
       round(r.usual_gap_days) as usual_gap_days,
       (r.usual_gap_days is not null
        and lv.last_visit_on is not null
        and (current_date - lv.last_visit_on) > r.usual_gap_days * 1.5
        and na.next_appt_on is null) as lapsed
from patients p
left join rhythm r on r.patient_id = p.id
left join last_visit lv on lv.patient_id = p.id
left join next_appt na on na.patient_id = p.id
left join spend s on s.patient_id = p.id;

create or replace view v_appointments as
select a.id, a.ref, a.on_date, a.starts_at, a.ends_at, a.status, a.cancel_reason,
       a.price_cents, a.note,
       a.patient_id, p.name as patient, p.phone as patient_phone, p.alerts as patient_alerts,
       a.practitioner_id, pr.name as practitioner, pr.discipline,
       a.service_id, s.name as service, s.kind as service_kind,
       a.case_id, c.ref as case_ref, c.title as case_title, c.funding, c.claim_number,
       tn.status as note_status
from appointments a
join patients p on p.id = a.patient_id
join practitioners pr on pr.id = a.practitioner_id
join services s on s.id = a.service_id
left join cases c on c.id = a.case_id
left join treatment_notes tn on tn.appointment_id = a.id;

-- Cases with their session arithmetic: completed sessions used, sessions
-- booked ahead, and what is left of the approval.
create or replace view v_cases as
select c.id, c.ref, c.title, c.funding, c.claim_number, c.injury_date,
       c.approved_sessions, c.consent_recorded_on, c.status, c.opened_on,
       c.discharged_on, c.note,
       c.patient_id, p.name as patient,
       c.referrer_id, r.name as referrer, r.practice as referrer_practice,
       coalesce(u.used, 0) as sessions_used,
       coalesce(b.booked, 0) as sessions_booked,
       case when c.approved_sessions is null then null
            else c.approved_sessions - coalesce(u.used, 0) - coalesce(b.booked, 0)
       end as sessions_remaining
from cases c
join patients p on p.id = c.patient_id
left join referrers r on r.id = c.referrer_id
left join (
  select case_id, count(*) as used from appointments
  where status = 'completed' group by case_id
) u on u.case_id = c.id
left join (
  select case_id, count(*) as booked from appointments
  where status in ('booked', 'confirmed') and on_date >= current_date group by case_id
) b on b.case_id = c.id;

-- Completed appointments whose clinical record is not finalised: no note at
-- all, or a note still in draft. The first thing /attention raises.
create or replace view v_notes_due as
select a.id as appointment_id, a.ref, a.on_date,
       (current_date - a.on_date) as days_since,
       p.name as patient, pr.name as practitioner,
       s.name as service, c.ref as case_ref,
       coalesce(tn.status, 'missing') as note_state
from appointments a
join patients p on p.id = a.patient_id
join practitioners pr on pr.id = a.practitioner_id
join services s on s.id = a.service_id
left join cases c on c.id = a.case_id
left join treatment_notes tn on tn.appointment_id = a.id
where a.status = 'completed'
  and not a.imported
  and (tn.id is null or tn.status = 'draft');

create or replace view v_invoices as
select i.id, i.ref, i.payer, i.issued_on, i.due_on, i.status,
       i.patient_id, p.name as patient, i.case_id, c.ref as case_ref,
       coalesce(t.total_cents, 0) as total_cents,
       coalesce(pay.paid_cents, 0) as paid_cents,
       coalesce(t.total_cents, 0) - coalesce(pay.paid_cents, 0) as balance_cents,
       greatest(0, current_date - i.due_on) as days_overdue
from invoices i
join patients p on p.id = i.patient_id
left join cases c on c.id = i.case_id
left join (
  select invoice_id, sum(qty * unit_cents) as total_cents
  from invoice_items group by invoice_id
) t on t.invoice_id = i.id
left join (
  select invoice_id, sum(amount_cents) as paid_cents
  from payments group by invoice_id
) pay on pay.invoice_id = i.id;

-- Rebooking, last 28 days: of the visits each practitioner completed, how
-- many walked out holding (or later made) another appointment.
create or replace view v_rebooking as
select pr.id as practitioner_id, pr.name as practitioner,
       count(*) as visits,
       count(*) filter (where exists (
         select 1 from appointments later
         where later.patient_id = a.patient_id
           and later.status in ('booked', 'confirmed', 'completed')
           and later.on_date > a.on_date
       )) as rebooked
from appointments a
join practitioners pr on pr.id = a.practitioner_id
where a.status = 'completed' and a.on_date > current_date - 28
group by pr.id, pr.name;

create or replace view v_takings as
select a.on_date, pr.name as practitioner,
       count(*) as visits,
       sum(a.price_cents) as takings_cents
from appointments a
join practitioners pr on pr.id = a.practitioner_id
where a.status = 'completed'
group by a.on_date, pr.name;

-- DNA record, last 180 days, with the habit counted per patient.
create or replace view v_dnas as
select a.id, a.ref, a.on_date, p.name as patient, p.phone,
       pr.name as practitioner, s.name as service, a.price_cents,
       (select count(*) from appointments h
        where h.patient_id = a.patient_id and h.status = 'dna'
          and h.on_date > current_date - 180) as dnas_180
from appointments a
join patients p on p.id = a.patient_id
join practitioners pr on pr.id = a.practitioner_id
join services s on s.id = a.service_id
where a.status = 'dna' and a.on_date > current_date - 180;

create or replace view v_recalls as
select r.id, r.due_on, r.reason, r.status,
       (r.due_on - current_date) as days_until,
       p.name as patient, p.phone, p.marketing_opt_in,
       v.next_appt_on, v.spend_cents_12m
from recalls r
join patients p on p.id = r.patient_id
join v_patients v on v.patient_id = p.id
where r.status = 'open';

-- Referrers with the relationship state: how many cases each has sent, when
-- the last one landed, and who has gone quiet.
create or replace view v_referrers as
select r.id, r.name, r.practice, r.kind, r.phone, r.email,
       count(c.id) as cases_referred,
       max(c.referral_date) as last_referral_on,
       (current_date - max(c.referral_date)) as days_quiet
from referrers r
left join cases c on c.referrer_id = r.id
group by r.id, r.name, r.practice, r.kind, r.phone, r.email;
