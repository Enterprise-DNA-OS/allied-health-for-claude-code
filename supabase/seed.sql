-- Demo data for allied-health-for-claude-code.
-- Harbour Allied Health, a fictional Wellington clinic: six practitioners
-- (three physiotherapists, an osteopath, a podiatrist, a massage therapist),
-- a fourteen-name patient book, nine episodes of care across ACC and private
-- funding, sixteen weeks of visits behind and a booked week ahead.
--
-- Deliberately messy, so the attention list has something to say:
--   Grace Muller's visit six days ago has NO treatment note at all, and
--     David Chen's note from three days ago is still in draft
--   Liam Parata's ACC knee claim has 15 of 16 approved sessions used and the
--     16th booked tomorrow: the next booking needs an ACC32 outcome first
--   Amelia Ford's back case arrived from the old system with no informed
--     consent on record, and she is booked again in three days
--   Hannah Silva's appointment two days ago was never completed or marked:
--     the diary does not match what happened
--   Priya Nair is booked tomorrow morning and has not confirmed
--   Mike Tanoa did not attend yesterday, his second DNA in six months, and
--     nobody has ever asked him the marketing question
--   Ellen Baxter's invoice is 26 days past due; ACC owes Rex Morton's claim
--     $255 on an invoice 36 days past due
--   Sarah Holt, the best massage client on the book, in every 21 days for a
--     year, has been quiet 49 days with nothing booked; Mike is lapsed too
--   June Kereama's orthotics annual review falls due in two days
--   Oliver Grant is on the waitlist and fits tomorrow's empty diary
--   Te Aro Health used to refer every month and has sent nothing in 95 days
--
-- Dates are relative to current_date so the demo is coherent whatever day
-- you run it. Ids derive from names with seed_uuid, and every insert is
-- ON CONFLICT DO NOTHING, so running it twice changes nothing.
--
-- Practitioners, patients, prices and events are DEMO VALUES for a fictional
-- business. No real person or business is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Settings --------------------------------------------------------------------------

insert into settings (key, value, note) values
  ('clinic_name',        'Harbour Allied Health', 'shown on documents'),
  ('currency',           'NZD',                   'money formatting'),
  ('note_due_days',      '2',                     'a completed visit needs its note finalised within this many days'),
  ('invoice_due_days',   '14',                    'days from issue to due'),
  ('funded_warn_remaining', '2',                  'warn when a funded case has this many sessions or fewer left'),
  ('reminder_days',      '1',                     'draft reminders for bookings this many days out'),
  ('recall_horizon_days','7',                     'recalls due within this many days are raised')
on conflict (key) do nothing;

-- Practitioners ----------------------------------------------------------------------

insert into practitioners (id, name, discipline, registration_no) values
  (seed_uuid('prac:kate'),   'Kate Manaia',  'physiotherapist',   'PHY-88231'),
  (seed_uuid('prac:tom'),    'Tom Ellison',  'physiotherapist',   'PHY-90417'),
  (seed_uuid('prac:aroha'),  'Aroha Ngata',  'physiotherapist',   'PHY-93150'),
  (seed_uuid('prac:marcus'), 'Marcus Reid',  'osteopath',         'OST-30442'),
  (seed_uuid('prac:suzie'),  'Suzie Clark',  'podiatrist',        'POD-11208'),
  (seed_uuid('prac:hana'),   'Hana Ropata',  'massage therapist', null)
on conflict (id) do nothing;

insert into practitioner_hours (practitioner_id, weekday, starts_at, ends_at)
select p.id, d.weekday,
       case p.name when 'Kate Manaia' then time '08:00'
                   when 'Tom Ellison' then time '09:00'
                   when 'Aroha Ngata' then time '08:00'
                   when 'Marcus Reid' then time '10:00'
                   when 'Suzie Clark' then time '09:00'
                   else time '09:00' end,
       case p.name when 'Kate Manaia' then time '16:00'
                   when 'Tom Ellison' then time '17:00'
                   when 'Aroha Ngata' then time '14:00'
                   when 'Marcus Reid' then time '18:00'
                   when 'Suzie Clark' then time '15:00'
                   else time '17:00' end
from practitioners p
cross join (select generate_series(0, 6) as weekday) d
on conflict (practitioner_id, weekday) do nothing;

-- Services ---------------------------------------------------------------------------

insert into services (id, name, discipline, kind, minutes, price_cents) values
  (seed_uuid('svc:physio-initial'),  'Physiotherapy initial assessment', 'physiotherapy', 'initial',  45, 11000),
  (seed_uuid('svc:physio-follow'),   'Physiotherapy follow-up',          'physiotherapy', 'followup', 30,  8500),
  (seed_uuid('svc:osteo-initial'),   'Osteopathy initial consultation',  'osteopathy',    'initial',  45, 11500),
  (seed_uuid('svc:osteo-follow'),    'Osteopathy follow-up',             'osteopathy',    'followup', 30,  9000),
  (seed_uuid('svc:pod-assess'),      'Podiatry assessment',              'podiatry',      'initial',  45, 12000),
  (seed_uuid('svc:pod-orthotics'),   'Orthotics review',                 'podiatry',      'followup', 30,  9500),
  (seed_uuid('svc:massage-60'),      'Massage therapy 60 min',           'massage',       'other',    60, 10500),
  (seed_uuid('svc:massage-30'),      'Massage therapy 30 min',           'massage',       'other',    30,  6500)
on conflict (id) do nothing;

-- Referrers --------------------------------------------------------------------------

insert into referrers (id, name, practice, kind, phone, email) values
  (seed_uuid('ref:weber'), 'Dr Alan Weber',   'Karori Medical Centre',      'gp',         '04 476 1000', 'reception@karorimedical.example.nz'),
  (seed_uuid('ref:tearo'), 'Te Aro Health',   'Te Aro Health',              'gp',         '04 385 2200', 'admin@tearohealth.example.nz'),
  (seed_uuid('ref:marsh'), 'Ms Fiona Marsh',  'Wellington Orthopaedics',    'specialist', '04 499 8800', 'rooms@wgtnortho.example.nz')
on conflict (id) do nothing;

-- Patients ---------------------------------------------------------------------------

insert into patients (id, name, date_of_birth, phone, email, referral_source, marketing_opt_in, alerts) values
  (seed_uuid('pat:liam'),   'Liam Parata',   '1994-03-18', '021 555 0141', 'liam.parata@example.com',   'Ms Fiona Marsh',       true,  null),
  (seed_uuid('pat:sarah'),  'Sarah Holt',    '1982-11-02', '021 555 0122', 'sarah.holt@example.com',    'word of mouth',        true,  null),
  (seed_uuid('pat:grace'),  'Grace Muller',  '1990-07-25', '021 555 0187', 'grace.muller@example.com',  'Google',               true,  null),
  (seed_uuid('pat:david'),  'David Chen',    '1987-01-30', '021 555 0165', 'david.chen@example.com',    'word of mouth',        true,  null),
  (seed_uuid('pat:priya'),  'Priya Nair',    '1995-09-12', '021 555 0110', 'priya.nair@example.com',    'Google',               true,  null),
  (seed_uuid('pat:mike'),   'Mike Tanoa',    '1979-05-08', '021 555 0133', null,                        'Te Aro Health',        null,  null),
  (seed_uuid('pat:ellen'),  'Ellen Baxter',  '1968-02-14', '021 555 0198', 'ellen.baxter@example.com',  'word of mouth',        false, null),
  (seed_uuid('pat:june'),   'June Kereama',  '1951-12-03', '04 555 0102',  null,                        'word of mouth',        true,  'Type 2 diabetes; reduced foot sensation'),
  (seed_uuid('pat:oliver'), 'Oliver Grant',  '1998-04-21', '021 555 0176', 'oliver.grant@example.com',  'Google',               true,  null),
  (seed_uuid('pat:hannah'), 'Hannah Silva',  '1992-08-16', '021 555 0154', 'hannah.silva@example.com',  'Instagram',            true,  null),
  (seed_uuid('pat:rex'),    'Rex Morton',    '1975-06-27', '021 555 0119', 'rex.morton@example.com',    'Dr Alan Weber',        true,  null),
  (seed_uuid('pat:amelia'), 'Amelia Ford',   '1985-10-09', '021 555 0128', 'amelia.ford@example.com',   'Te Aro Health',        true,  null),
  (seed_uuid('pat:nathan'), 'Nathan Hughes', '1989-03-05', '021 555 0147', 'nathan.hughes@example.com', 'word of mouth',        true,  null),
  (seed_uuid('pat:chloe'),  'Chloe Watts',   '1996-06-19', '021 555 0183', 'chloe.watts@example.com',   'Dr Alan Weber',        true,  null)
on conflict (id) do nothing;

-- Cases ------------------------------------------------------------------------------

insert into cases (id, ref, patient_id, title, funding, claim_number, injury_date, approved_sessions,
                   referrer_id, referral_date, consent_recorded_on, status, opened_on, discharged_on, note) values
  (seed_uuid('case:090'), 'CASE-090', seed_uuid('pat:mike'),   'Left ankle sprain rehab',      'acc',     'ZZ00111', current_date - 175, 10,
   seed_uuid('ref:tearo'), current_date - 170, current_date - 170, 'discharged', current_date - 170, current_date - 70, 'Discharged at full function.'),
  (seed_uuid('case:101'), 'CASE-101', seed_uuid('pat:liam'),   'Right knee ACL rehab',         'acc',     'AB12345', current_date - 125, 16,
   seed_uuid('ref:marsh'), current_date - 120, current_date - 112, 'open', current_date - 112, null, 'Post-reconstruction protocol, week-by-week loading plan.'),
  (seed_uuid('case:102'), 'CASE-102', seed_uuid('pat:amelia'), 'Chronic low back pain',        'private', null,      null,               null,
   seed_uuid('ref:tearo'), current_date - 95,  null,               'open', current_date - 95,  null, 'Transferred from the old system; consent form not located.'),
  (seed_uuid('case:103'), 'CASE-103', seed_uuid('pat:nathan'), 'Cervicogenic headache',        'private', null,      null,               null,
   null, null, current_date - 32, 'open', current_date - 32, null, null),
  (seed_uuid('case:104'), 'CASE-104', seed_uuid('pat:rex'),    'Right shoulder impingement',   'acc',     'CD67890', current_date - 65,  12,
   seed_uuid('ref:weber'), current_date - 60,  current_date - 58,  'open', current_date - 58,  null, null),
  (seed_uuid('case:105'), 'CASE-105', seed_uuid('pat:june'),   'Orthotics and diabetic foot care', 'private', null,  null,               null,
   null, null, current_date - 370, 'open', current_date - 370, null, 'Annual orthotics review cycle; high-risk foot, see alerts.'),
  (seed_uuid('case:106'), 'CASE-106', seed_uuid('pat:david'),  'Left ankle sprain',            'private', null,      current_date - 18,  null,
   null, null, current_date - 17, 'open', current_date - 17, null, null),
  (seed_uuid('case:107'), 'CASE-107', seed_uuid('pat:grace'),  'Right tennis elbow',           'private', null,      null,               null,
   null, null, current_date - 20, 'open', current_date - 20, null, null),
  (seed_uuid('case:108'), 'CASE-108', seed_uuid('pat:chloe'),  'Plantar fasciitis',            'private', null,      null,               null,
   seed_uuid('ref:weber'), current_date - 5,   null,               'open', current_date - 5,   null, 'First visit booked; record consent at the initial assessment.')
on conflict (id) do nothing;

-- Appointments -------------------------------------------------------------------------
-- Liam's ACC knee: the initial assessment, then 14 weekly follow-ups, then
-- the 16th and last approved session booked tomorrow.

insert into appointments (id, ref, patient_id, practitioner_id, case_id, service_id, on_date, starts_at, ends_at, status, price_cents)
values (seed_uuid('apt:1101'), 'APT-1101', seed_uuid('pat:liam'), seed_uuid('prac:kate'), seed_uuid('case:101'),
        seed_uuid('svc:physio-initial'), current_date - 105, time '09:00', time '09:45', 'completed', 11000)
on conflict (id) do nothing;

insert into appointments (id, ref, patient_id, practitioner_id, case_id, service_id, on_date, starts_at, ends_at, status, price_cents)
select seed_uuid('apt:liam:' || i), 'APT-' || (1101 + i),
       seed_uuid('pat:liam'), seed_uuid('prac:kate'), seed_uuid('case:101'),
       seed_uuid('svc:physio-follow'), current_date - 105 + (i * 7), time '09:00', time '09:30', 'completed', 8500
from generate_series(1, 14) as i
on conflict (id) do nothing;

insert into appointments (id, ref, patient_id, practitioner_id, case_id, service_id, on_date, starts_at, ends_at, status, price_cents) values
  -- Liam, session 16 of 16, tomorrow, confirmed
  (seed_uuid('apt:1116'), 'APT-1116', seed_uuid('pat:liam'),   seed_uuid('prac:kate'),   seed_uuid('case:101'), seed_uuid('svc:physio-follow'),  current_date + 1,   time '09:00', time '09:30', 'confirmed', 8500),
  -- Mike's discharged ACC ankle case, months back, plus his DNA habit
  (seed_uuid('apt:1201'), 'APT-1201', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   seed_uuid('case:090'), seed_uuid('svc:physio-initial'), current_date - 170, time '10:00', time '10:45', 'completed', 11000),
  (seed_uuid('apt:1202'), 'APT-1202', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   seed_uuid('case:090'), seed_uuid('svc:physio-follow'),  current_date - 140, time '10:00', time '10:30', 'completed', 8500),
  (seed_uuid('apt:1203'), 'APT-1203', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   seed_uuid('case:090'), seed_uuid('svc:physio-follow'),  current_date - 110, time '10:00', time '10:30', 'completed', 8500),
  (seed_uuid('apt:1204'), 'APT-1204', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   seed_uuid('case:090'), seed_uuid('svc:physio-follow'),  current_date - 80,  time '10:00', time '10:30', 'completed', 8500),
  (seed_uuid('apt:1205'), 'APT-1205', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   seed_uuid('case:090'), seed_uuid('svc:physio-follow'),  current_date - 100, time '14:00', time '14:30', 'dna', 8500),
  (seed_uuid('apt:1206'), 'APT-1206', seed_uuid('pat:mike'),   seed_uuid('prac:kate'),   null,                  seed_uuid('svc:physio-follow'),  current_date - 1,   time '14:00', time '14:30', 'dna', 8500),
  -- Sarah's massage rhythm: every 21 days for a year, then silence
  (seed_uuid('apt:1301'), 'APT-1301', seed_uuid('pat:sarah'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date - 112, time '12:00', time '13:00', 'completed', 10500),
  (seed_uuid('apt:1302'), 'APT-1302', seed_uuid('pat:sarah'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date - 91,  time '12:00', time '13:00', 'completed', 10500),
  (seed_uuid('apt:1303'), 'APT-1303', seed_uuid('pat:sarah'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date - 70,  time '12:00', time '13:00', 'completed', 10500),
  (seed_uuid('apt:1304'), 'APT-1304', seed_uuid('pat:sarah'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date - 49,  time '12:00', time '13:00', 'completed', 10500),
  -- Amelia's back: three visits, consent never recorded, booked again in three days
  (seed_uuid('apt:1401'), 'APT-1401', seed_uuid('pat:amelia'), seed_uuid('prac:marcus'), seed_uuid('case:102'), seed_uuid('svc:osteo-follow'), current_date - 40, time '11:00', time '11:30', 'completed', 9000),
  (seed_uuid('apt:1402'), 'APT-1402', seed_uuid('pat:amelia'), seed_uuid('prac:marcus'), seed_uuid('case:102'), seed_uuid('svc:osteo-follow'), current_date - 33, time '11:00', time '11:30', 'completed', 9000),
  (seed_uuid('apt:1403'), 'APT-1403', seed_uuid('pat:amelia'), seed_uuid('prac:marcus'), seed_uuid('case:102'), seed_uuid('svc:osteo-follow'), current_date - 26, time '11:00', time '11:30', 'completed', 9000),
  (seed_uuid('apt:1404'), 'APT-1404', seed_uuid('pat:amelia'), seed_uuid('prac:marcus'), seed_uuid('case:102'), seed_uuid('svc:osteo-follow'), current_date + 3,  time '11:00', time '11:30', 'booked', 9000),
  -- Nathan's headaches
  (seed_uuid('apt:1501'), 'APT-1501', seed_uuid('pat:nathan'), seed_uuid('prac:marcus'), seed_uuid('case:103'), seed_uuid('svc:osteo-initial'), current_date - 32, time '15:00', time '15:45', 'completed', 11500),
  (seed_uuid('apt:1502'), 'APT-1502', seed_uuid('pat:nathan'), seed_uuid('prac:marcus'), seed_uuid('case:103'), seed_uuid('svc:osteo-follow'),  current_date - 4,  time '15:00', time '15:30', 'completed', 9000),
  (seed_uuid('apt:1503'), 'APT-1503', seed_uuid('pat:nathan'), seed_uuid('prac:marcus'), seed_uuid('case:103'), seed_uuid('svc:osteo-follow'),  current_date + 5,  time '15:00', time '15:30', 'confirmed', 9000),
  -- Rex's ACC shoulder: six of twelve used, ACC's invoice sitting unpaid
  (seed_uuid('apt:1601'), 'APT-1601', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-initial'), current_date - 58, time '13:00', time '13:45', 'completed', 11000),
  (seed_uuid('apt:1602'), 'APT-1602', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-follow'),  current_date - 47, time '13:00', time '13:30', 'completed', 8500),
  (seed_uuid('apt:1603'), 'APT-1603', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-follow'),  current_date - 40, time '13:00', time '13:30', 'completed', 8500),
  (seed_uuid('apt:1604'), 'APT-1604', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-follow'),  current_date - 26, time '13:00', time '13:30', 'completed', 8500),
  (seed_uuid('apt:1605'), 'APT-1605', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-follow'),  current_date - 12, time '13:00', time '13:30', 'completed', 8500),
  (seed_uuid('apt:1606'), 'APT-1606', seed_uuid('pat:rex'),    seed_uuid('prac:tom'),    seed_uuid('case:104'), seed_uuid('svc:physio-follow'),  current_date - 5,  time '13:00', time '13:30', 'completed', 8500),
  -- June's podiatry, a year back
  (seed_uuid('apt:1701'), 'APT-1701', seed_uuid('pat:june'),   seed_uuid('prac:suzie'),  seed_uuid('case:105'), seed_uuid('svc:pod-assess'), current_date - 370, time '10:00', time '10:45', 'completed', 12000),
  -- David's ankle: the note from three days ago is still in draft
  (seed_uuid('apt:1801'), 'APT-1801', seed_uuid('pat:david'),  seed_uuid('prac:kate'),   seed_uuid('case:106'), seed_uuid('svc:physio-initial'), current_date - 17, time '11:00', time '11:45', 'completed', 11000),
  (seed_uuid('apt:1802'), 'APT-1802', seed_uuid('pat:david'),  seed_uuid('prac:kate'),   seed_uuid('case:106'), seed_uuid('svc:physio-follow'),  current_date - 10, time '11:00', time '11:30', 'completed', 8500),
  (seed_uuid('apt:1803'), 'APT-1803', seed_uuid('pat:david'),  seed_uuid('prac:kate'),   seed_uuid('case:106'), seed_uuid('svc:physio-follow'),  current_date - 3,  time '11:00', time '11:30', 'completed', 8500),
  (seed_uuid('apt:1804'), 'APT-1804', seed_uuid('pat:david'),  seed_uuid('prac:kate'),   seed_uuid('case:106'), seed_uuid('svc:physio-follow'),  current_date + 7,  time '11:00', time '11:30', 'booked', 8500),
  -- Grace's elbow: the visit six days ago has no note at all
  (seed_uuid('apt:1901'), 'APT-1901', seed_uuid('pat:grace'),  seed_uuid('prac:tom'),    seed_uuid('case:107'), seed_uuid('svc:physio-initial'), current_date - 20, time '14:00', time '14:45', 'completed', 11000),
  (seed_uuid('apt:1902'), 'APT-1902', seed_uuid('pat:grace'),  seed_uuid('prac:tom'),    seed_uuid('case:107'), seed_uuid('svc:physio-follow'),  current_date - 13, time '14:00', time '14:30', 'completed', 8500),
  (seed_uuid('apt:1903'), 'APT-1903', seed_uuid('pat:grace'),  seed_uuid('prac:tom'),    seed_uuid('case:107'), seed_uuid('svc:physio-follow'),  current_date - 6,  time '14:00', time '14:30', 'completed', 8500),
  -- Ellen's massages, one yesterday, one booked next week, an invoice long past due
  (seed_uuid('apt:1951'), 'APT-1951', seed_uuid('pat:ellen'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date - 1, time '10:00', time '11:00', 'completed', 10500),
  (seed_uuid('apt:1952'), 'APT-1952', seed_uuid('pat:ellen'),  seed_uuid('prac:hana'),   null, seed_uuid('svc:massage-60'), current_date + 8, time '10:00', time '11:00', 'booked', 10500),
  -- Priya, tomorrow, still unconfirmed
  (seed_uuid('apt:1961'), 'APT-1961', seed_uuid('pat:priya'),  seed_uuid('prac:tom'),    null, seed_uuid('svc:physio-follow'), current_date + 1, time '10:00', time '10:30', 'booked', 8500),
  -- Hannah, two days ago, never completed or marked
  (seed_uuid('apt:1971'), 'APT-1971', seed_uuid('pat:hannah'), seed_uuid('prac:aroha'),  null, seed_uuid('svc:physio-follow'), current_date - 2, time '09:00', time '09:30', 'booked', 8500),
  -- Chloe's first visit, next week
  (seed_uuid('apt:1981'), 'APT-1981', seed_uuid('pat:chloe'),  seed_uuid('prac:kate'),   seed_uuid('case:108'), seed_uuid('svc:physio-initial'), current_date + 6, time '13:00', time '13:45', 'booked', 11000)
on conflict (id) do nothing;

-- Treatment notes ------------------------------------------------------------------------
-- Every completed visit has a finalised SOAP note, except the two deliberate
-- gaps: APT-1903 (no note at all) and APT-1803 (still in draft).

insert into treatment_notes (id, appointment_id, patient_id, practitioner_id, case_id, on_date,
                             subjective, objective, assessment, plan, status, finalised_at)
select seed_uuid('note:' || a.ref), a.id, a.patient_id, a.practitioner_id, a.case_id, a.on_date,
       'Progressing as expected; symptoms settling between sessions.',
       'Objective measures on file for this visit.',
       'Tracking to plan for this episode of care.',
       'Continue current programme; review next visit.',
       'final', a.on_date::timestamptz + interval '18 hours'
from appointments a
where a.status = 'completed' and a.ref not in ('APT-1903', 'APT-1803')
on conflict (appointment_id) do nothing;

insert into treatment_notes (id, appointment_id, patient_id, practitioner_id, case_id, on_date,
                             subjective, objective, assessment, plan, status)
select seed_uuid('note:APT-1803'), a.id, a.patient_id, a.practitioner_id, a.case_id, a.on_date,
       'Ankle much improved, ran 5 km pain free on Saturday.',
       'Single-leg hop symmetrical; mild swelling post run.',
       null, null, 'draft'
from appointments a where a.ref = 'APT-1803'
on conflict (appointment_id) do nothing;

-- Invoices and payments ---------------------------------------------------------------------

insert into invoices (id, ref, patient_id, case_id, payer, issued_on, due_on, status) values
  (seed_uuid('inv:2001'), 'INV-2001', seed_uuid('pat:ellen'),  null,                  'patient', current_date - 40, current_date - 26, 'sent'),
  (seed_uuid('inv:2002'), 'INV-2002', seed_uuid('pat:rex'),    seed_uuid('case:104'), 'acc',     current_date - 50, current_date - 36, 'sent'),
  (seed_uuid('inv:2003'), 'INV-2003', seed_uuid('pat:nathan'), seed_uuid('case:103'), 'patient', current_date - 4,  current_date + 10, 'paid'),
  (seed_uuid('inv:2004'), 'INV-2004', seed_uuid('pat:david'),  seed_uuid('case:106'), 'patient', current_date - 3,  current_date + 11, 'sent')
on conflict (id) do nothing;

insert into invoice_items (id, invoice_id, description, qty, unit_cents) values
  (seed_uuid('item:2001a'), seed_uuid('inv:2001'), 'Massage therapy 60 min', 2, 10500),
  (seed_uuid('item:2002a'), seed_uuid('inv:2002'), 'Physiotherapy consult, ACC schedule, claim CD67890', 3, 8500),
  (seed_uuid('item:2003a'), seed_uuid('inv:2003'), 'Osteopathy follow-up', 1, 9000),
  (seed_uuid('item:2004a'), seed_uuid('inv:2004'), 'Physiotherapy follow-up', 1, 8500)
on conflict (id) do nothing;

insert into payments (id, invoice_id, on_date, amount_cents, method) values
  (seed_uuid('pay:2003a'), seed_uuid('inv:2003'), current_date - 2, 9000, 'card')
on conflict (id) do nothing;

-- Recalls and the waitlist ---------------------------------------------------------------------

insert into recalls (id, patient_id, due_on, reason, status) values
  (seed_uuid('recall:june'),  seed_uuid('pat:june'),  current_date + 2,  'Orthotics annual review; high-risk foot check', 'open'),
  (seed_uuid('recall:done'),  seed_uuid('pat:rex'),   current_date - 30, 'Post-discharge check-in call',                  'done')
on conflict (id) do nothing;

insert into waitlist (id, patient_id, service_id, practitioner_id, added_on, note) values
  (seed_uuid('wait:oliver'), seed_uuid('pat:oliver'), seed_uuid('svc:physio-follow'), null, current_date - 6, 'Calf strain, wants the first free slot; lunchtimes best, can come at short notice')
on conflict (id) do nothing;

-- Conversation log -------------------------------------------------------------------------------

insert into patient_notes (id, patient_id, on_date, author, body) values
  (seed_uuid('pnote:liam'),  seed_uuid('pat:liam'),  current_date - 7, 'Kate Manaia',  'Told Liam we are at session 15 of 16 on the claim; ACC32 to go in this week if we want to continue past next session.'),
  (seed_uuid('pnote:ellen'), seed_uuid('pat:ellen'), current_date - 12, 'Front desk',  'Left a voicemail about the outstanding invoice; asked for a call back.'),
  (seed_uuid('pnote:june'),  seed_uuid('pat:june'),  current_date - 10, 'Suzie Clark', 'Daughter rang: June happy to come in for the annual review, mornings suit.')
on conflict (id) do nothing;
