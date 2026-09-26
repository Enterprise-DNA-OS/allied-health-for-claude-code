#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.
//
// The seed anchors everything to current_date offsets, so every assertion
// here holds whatever day you run it.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'clinic-smoke-'));
const scratch = mkdtempSync(path.join(tmpdir(), 'clinic-smoke-files-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json && !expectFail ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const iso = (d) => {
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (base, days) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
const now = new Date();
const day = (offset) => iso(addDays(now, offset));

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the numbers, before anything moves ------------------------------------

  const stats = run('stats', ['clinic.mjs', 'stats']);
  assert(n(stats.active_patients) === 14, `fourteen patients on the book (${stats.active_patients})`);
  assert(n(stats.practitioners) === 6, `six on the team (${stats.practitioners})`);
  assert(n(stats.open_cases) === 8, `eight open cases (${stats.open_cases})`);
  assert(n(stats.booked_ahead) === 7, `seven bookings ahead (${stats.booked_ahead})`);
  assert(n(stats.unconfirmed_soon) === 1, `one unconfirmed inside the window (${stats.unconfirmed_soon})`);
  assert(n(stats.not_completed) === 1, `one visit left open past its day (${stats.not_completed})`);
  assert(n(stats.notes_missing) === 2, `two clinical records not finalised (${stats.notes_missing})`);
  assert(n(stats.funded_at_limit) === 1, `one funded case fully committed (${stats.funded_at_limit})`);
  assert(n(stats.consent_missing) === 1, `one treated case with no consent (${stats.consent_missing})`);
  assert(n(stats.dnas_30) === 1, `one DNA this month (${stats.dnas_30})`);
  assert(n(stats.lapsed) === 2, `two lapsed patients (${stats.lapsed})`);
  assert(n(stats.recalls_due) === 1, `one recall due (${stats.recalls_due})`);
  assert(n(stats.waitlist) === 1, `one patient waiting (${stats.waitlist})`);
  assert(n(stats.referrers_quiet) === 1, `one referrer gone quiet (${stats.referrers_quiet})`);
  assert(n(stats.debtors_cents) === 21000, `patients owe $210 past due (${stats.debtors_cents})`);
  assert(n(stats.funder_unpaid_cents) === 25500, `ACC owes $255 (${stats.funder_unpaid_cents})`);
  assert(n(stats.takings_7d_cents) === 45000, `the week took $450 (${stats.takings_7d_cents})`);
  assert(n(stats.rebooking_pct_28) === 87, `thirteen of fifteen visits left rebooked (${stats.rebooking_pct_28})`);

  // ---- attention: every deliberate mess in the seed fires ---------------------

  const attention = run('attention', ['clinic.mjs', 'attention']);
  const reasons = new Set(attention.map((r) => r.reason));
  for (const expected of ['note_missing', 'funded_sessions', 'consent_missing', 'not_completed', 'unconfirmed',
    'dna', 'overdue_invoice', 'funder_unpaid', 'lapsed', 'recall_due', 'waitlist', 'referrer_quiet']) {
    assert(reasons.has(expected), `attention includes ${expected} (${[...reasons].join(', ')})`);
  }
  assert(attention[0].reason === 'note_missing', 'the unwritten clinical record outranks everything');
  assert(attention.filter((r) => r.reason === 'note_missing').length === 2, 'Grace and David both flagged');
  assert(attention.filter((r) => r.reason === 'lapsed').length === 2, 'Sarah and Mike both raised');
  assert(attention.length === 14, `fourteen decisions on the list (${attention.length})`);

  // ---- the diary ----------------------------------------------------------------

  const tomorrow = run('the day sheet, tomorrow', ['clinic.mjs', 'day', `--date=${day(1)}`]);
  assert(tomorrow.length === 2, `two visits tomorrow (${tomorrow.length})`);
  assert(tomorrow.find((a) => a.ref === 'APT-1961').state === 'UNCONFIRMED', `Priya's silence is loud`);
  assert(tomorrow.find((a) => a.ref === 'APT-1116').state === 'confirmed', `Liam's last approved session is quiet`);
  assert(tomorrow.find((a) => a.ref === 'APT-1116').funding === 'acc', `and carries its funding`);

  const week = run('the diary, the week', ['clinic.mjs', 'book']);
  assert(week.length === 5, `the week holds five of the seven bookings ahead (${week.length})`);

  const gaps = run('the empty diary', ['clinic.mjs', 'gaps']);
  const tomorrowGaps = gaps.filter((g) => g.on_date === day(1));
  assert(tomorrowGaps.length === 6, `six practitioners have windows tomorrow (${tomorrowGaps.length})`);
  assert(n(tomorrowGaps.find((g) => g.practitioner === 'Kate Manaia').booked_minutes) === 30, `Kate holds Liam's session 16`);

  // ---- patients -------------------------------------------------------------------

  const patients = run('the patient book', ['clinic.mjs', 'patients']);
  assert(patients.length === 14, `fourteen patients (${patients.length})`);

  const sarah = run('patient card by partial name', ['clinic.mjs', 'patient', 'sar']);
  assert(sarah.patient.name === 'Sarah Holt', 'resolved by partial name');
  assert(sarah.patient.lapsed === true, 'Sarah reads as lapsed');
  assert(n(sarah.patient.usual_gap_days) === 21, `her rhythm is 21 days (${sarah.patient.usual_gap_days})`);
  assert(n(sarah.patient.spend_cents_12m) === 42000, `she spent $420 this year (${sarah.patient.spend_cents_12m})`);

  const liam = run('the ACC case on the patient card', ['clinic.mjs', 'patient', 'liam']);
  assert(liam.cases.length === 1 && liam.cases[0].ref === 'CASE-101', `Liam carries CASE-101`);
  assert(n(liam.cases[0].sessions_used) === 15 && n(liam.cases[0].approved_sessions) === 16, `15 of 16 used`);

  run('an unknown patient exits 1', ['clinic.mjs', 'patient', 'nobody at all'], { json: false, expectFail: true });
  run('an ambiguous name lists and exits 1', ['clinic.mjs', 'confirm', 'not-a-ref'], { json: false, expectFail: true });

  // ---- the gates refuse, and say why ------------------------------------------------

  run('ACC gate: session 17 of 16 refuses', ['clinic.mjs', 'book', 'add', 'Liam', 'Kate',
    '--service=Physiotherapy follow-up', `--date=${day(2)}`, '--at=9:00', '--case=CASE-101'], { json: false, expectFail: true });
  run('hours gate: 6am refuses', ['clinic.mjs', 'book', 'add', 'Oliver', 'Kate',
    '--service=Physiotherapy follow-up', `--date=${day(1)}`, '--at=6:00'], { json: false, expectFail: true });
  run('double-book gate refuses', ['clinic.mjs', 'book', 'add', 'Oliver', 'Kate',
    '--service=Physiotherapy follow-up', `--date=${day(1)}`, '--at=9:00'], { json: false, expectFail: true });

  const extended = run('the ACC32 outcome lands', ['clinic.mjs', 'case', 'extend', 'CASE-101', '--sessions=4', '--note=ACC32 approved']);
  assert(n(extended.approved_sessions) === 20, `approval is now 20 (${extended.approved_sessions})`);
  const booked17 = run('and session 17 books', ['clinic.mjs', 'book', 'add', 'Liam', 'Kate',
    '--service=Physiotherapy follow-up', `--date=${day(2)}`, '--at=9:00', '--case=CASE-101']);
  assert(booked17.ref === 'APT-1982', `refs mint in order (${booked17.ref})`);

  // A Medicare care plan is a hard line too.
  run('an EPC case with no session count refuses', ['clinic.mjs', 'case', 'add', 'Priya', '--title=Neck pain', '--funding=epc'],
    { json: false, expectFail: true });
  run('open the care plan case', ['clinic.mjs', 'case', 'add', 'Priya', '--title=Neck pain, GP care plan', '--funding=epc', '--sessions=1', '--claim=EPC 2026', '--consent'], { json: false });
  const epcBook = run('the plan\'s one session books, with a warning', ['clinic.mjs', 'book', 'add', 'Priya', 'Tom',
    '--service=Physiotherapy follow-up', `--date=${day(3)}`, '--at=9:00', '--case=CASE-109']);
  assert(epcBook.warnings.length === 1, `the last-session warning fires (${JSON.stringify(epcBook.warnings)})`);
  run('the plan\'s second session refuses', ['clinic.mjs', 'book', 'add', 'Priya', 'Tom',
    '--service=Physiotherapy follow-up', `--date=${day(4)}`, '--at=9:00', '--case=CASE-109'], { json: false, expectFail: true });

  // ---- consent, complete, the note lifecycle -----------------------------------------

  run('a case opens for the walk-in', ['clinic.mjs', 'case', 'add', 'Oliver', '--title=Right calf strain'], { json: false });
  const oliverApt = run('the walk-in books today', ['clinic.mjs', 'book', 'add', 'Oliver', 'Aroha',
    '--service=Physiotherapy follow-up', `--date=${day(0)}`, '--at=12:00', '--case=CASE-110']);
  run('completing without consent refuses', ['clinic.mjs', 'complete', oliverApt.ref], { json: false, expectFail: true });
  run('consent recorded', ['clinic.mjs', 'case', 'consent', 'CASE-110'], { json: false });
  const completed = run('the visit completes and invoices', ['clinic.mjs', 'complete', oliverApt.ref]);
  assert(completed.invoice && completed.invoice.ref === 'INV-2005', `the invoice minted (${JSON.stringify(completed.invoice)})`);
  assert(completed.invoice.payer === 'patient', 'a private case bills the patient');

  run('finalising an empty note refuses', ['clinic.mjs', 'note', 'final', oliverApt.ref], { json: false, expectFail: true });
  run('the note drafts', ['clinic.mjs', 'note', 'add', oliverApt.ref,
    '--s=Calf tight after football', '--o=Single leg raise 15 reps', '--a=Grade 1 strain resolving', '--p=Progress loading next week'], { json: false });
  run('the note finalises', ['clinic.mjs', 'note', 'final', oliverApt.ref], { json: false });
  run('editing a final note refuses', ['clinic.mjs', 'note', 'add', oliverApt.ref, '--s=quiet edit'], { json: false, expectFail: true });
  run('the addendum is the only door', ['clinic.mjs', 'note', 'addendum', oliverApt.ref, 'Patient rang: mild soreness next day, settled.'], { json: false });
  const oliverNotes = run('the record shows it', ['clinic.mjs', 'notes', 'Oliver']);
  assert(oliverNotes.length === 1 && oliverNotes[0].status === 'final' && /settled/.test(oliverNotes[0].addendum), 'final note with dated addendum');

  // Grace's missing note gets written, and the attention list heals.
  run('Grace\'s note, written late but written', ['clinic.mjs', 'note', 'add', 'APT-1903',
    '--s=Elbow settling, gripping better', '--o=Pain-free grip 28kg', '--a=Improving', '--p=Two more sessions'], { json: false });
  run('and finalised', ['clinic.mjs', 'note', 'final', 'APT-1903'], { json: false });
  const notesDue = run('one record still owing', ['clinic.mjs', 'notes-due']);
  assert(notesDue.length === 1 && notesDue[0].ref === 'APT-1803', `only David's draft remains (${JSON.stringify(notesDue.map((r) => r.ref))})`);

  // ---- DNA, cancel, confirm -----------------------------------------------------------

  run('confirm', ['clinic.mjs', 'confirm', 'APT-1961'], { json: false });
  run('a future DNA refuses', ['clinic.mjs', 'dna', 'APT-1404'], { json: false, expectFail: true });
  run('a cancellation without a reason refuses', ['clinic.mjs', 'cancel', 'APT-1404'], { json: false, expectFail: true });
  run('a cancellation with its reason lands', ['clinic.mjs', 'cancel', 'APT-1404', '--reason=Patient away for work'], { json: false });
  const hannah = run('the open visit resolves as DNA', ['clinic.mjs', 'dna', 'APT-1971']);
  assert(n(hannah.dnas_180) === 1, `Hannah's first (${hannah.dnas_180})`);

  // ---- money ---------------------------------------------------------------------------

  run('overpaying refuses', ['clinic.mjs', 'pay', 'INV-2001', '--amount=500'], { json: false, expectFail: true });
  const part = run('a part payment lands', ['clinic.mjs', 'pay', 'INV-2001', '--amount=110']);
  assert(n(part.balance_cents) === 10000, `$100 still owing (${part.balance_cents})`);
  const paid = run('the rest pays it off', ['clinic.mjs', 'pay', 'INV-2001', '--amount=100']);
  assert(paid.status === 'paid', 'INV-2001 is done');
  const debtors = run('debtors', ['clinic.mjs', 'debtors']);
  assert(n(debtors.funder_cents) === 25500, `ACC still owes $255 (${debtors.funder_cents})`);
  assert(debtors.owing.every((r) => r.ref !== 'INV-2001'), 'Ellen is off the list');

  const takings = run('takings', ['clinic.mjs', 'takings']);
  assert(n(takings.total_cents) === 45000 + 8500, `the week's takings moved with Oliver's visit (${takings.total_cents})`);

  // ---- recalls, waitlist, referrers ------------------------------------------------------

  const recalls = run('recalls', ['clinic.mjs', 'recalls']);
  assert(recalls.length === 1 && recalls[0].patient === 'June Kereama', 'June is due');
  run('recall done', ['clinic.mjs', 'recall', 'done', 'June'], { json: false });
  run('recall add', ['clinic.mjs', 'recall', 'add', 'June', `--due=${day(365)}`, '--reason=Orthotics annual review'], { json: false });

  run('waitlist remove --booked', ['clinic.mjs', 'waitlist', 'remove', 'Oliver', '--booked'], { json: false });
  const waitlist = run('the waitlist is clear', ['clinic.mjs', 'waitlist']);
  assert(waitlist.length === 0, `nobody waiting (${waitlist.length})`);

  const referrers = run('referrers', ['clinic.mjs', 'referrers']);
  const teAro = referrers.find((r) => r.name === 'Te Aro Health');
  assert(teAro.state === 'GONE QUIET' && n(teAro.days_quiet) === 95, `Te Aro Health has gone quiet (${teAro.days_quiet})`);

  // ---- compliance -----------------------------------------------------------------------

  const compliance = run('compliance', ['clinic.mjs', 'compliance']);
  assert(compliance.length === 6, `six rules (${compliance.length})`);
  const byRule = Object.fromEntries(compliance.map((c) => [c.rule, c]));
  assert(byRule.records.ok === false, 'the records rule fails while David\'s draft stands');
  assert(byRule.consent.ok === false, 'the consent rule fails while Amelia\'s case stands');
  assert(byRule['funded-sessions'].ok === true, 'no funded case is past its approval');
  assert(byRule.retention.ok === true, 'nothing has been deleted');
  assert(compliance.every((c) => /docs\/compliance\.md/.test(c.source)), 'every rule cites its source');

  // Fix the two failures the way the rule book says, and watch it heal.
  run('David\'s draft finalises', ['clinic.mjs', 'note', 'final', 'APT-1803'], { json: false });
  run('Amelia\'s consent is recorded', ['clinic.mjs', 'case', 'consent', 'CASE-102'], { json: false });
  const healed = run('compliance heals', ['clinic.mjs', 'compliance']);
  assert(healed.filter((c) => !c.ok).length === 0, `every rule passes (${healed.filter((c) => !c.ok).map((c) => c.rule).join(', ')})`);

  // ---- team, services, settings -----------------------------------------------------------

  const team = run('the team', ['clinic.mjs', 'team']);
  assert(team.length === 6, `six practitioners (${team.length})`);
  run('practitioner add', ['clinic.mjs', 'practitioner', 'add', 'Sam Field', '--discipline=physiotherapist'], { json: false });
  run('practitioner hours', ['clinic.mjs', 'practitioner', 'hours', 'Sam Field', 'mon', '--start=8:00', '--end=12:00'], { json: false });
  const services = run('services', ['clinic.mjs', 'services']);
  assert(services.length === 8, `eight services (${services.length})`);
  run('settings set', ['clinic.mjs', 'settings', 'set', 'note_due_days', '3'], { json: false });

  // ---- import from Cliniko, dry run first ---------------------------------------------------

  const patientsCsv = path.join(scratch, 'patients.csv');
  writeFileSync(patientsCsv, [
    'First name,Last name,Date of birth,Email,Phone number,Referral source',
    'Zoe,Adams,14/02/1991,zoe.adams@example.com,021 555 0999,Google',
    'Sarah,Holt,,sarah.holt@example.com,,word of mouth',
    ',,,no-name@example.com,,',
  ].join('\n'));
  const apptsCsv = path.join(scratch, 'appointments.csv');
  writeFileSync(apptsCsv, [
    'Patient name,Starts at,Appointment type,Practitioner name,Duration (mins),Price',
    `Zoe Adams,${day(-30)} 10:00,Initial physiotherapy consult,Kate Manaia,45,110`,
    `Zoe Adams,${day(9)} 10:00,Physiotherapy follow-up,Kate Manaia,30,85`,
    `Zoe Adams,,Physiotherapy follow-up,Kate Manaia,30,85`,
    `Zoe Adams,${day(11)} 14:00,Physiotherapy follow-up,Somebody Unknown,30,85`,
  ].join('\n'));

  const dry = run('import: dry run first', ['clinic.mjs', 'import', 'cliniko', `--patients=${patientsCsv}`, `--appointments=${apptsCsv}`, '--dry-run']);
  assert(dry.dry_run === true && dry.created.some((c) => c.what === 'patient' && c.name === 'Zoe Adams'), 'the dry run names who would land');
  assert(dry.skipped.some((s) => /missing date/.test(s.why)), `and names the row with no date (${JSON.stringify(dry.skipped.map((s) => s.why))})`);
  assert(dry.skipped.some((s) => /Somebody Unknown/.test(s.why)), 'and the practitioner nobody knows');

  const before = run('nothing was written', ['clinic.mjs', 'stats']);
  assert(n(before.active_patients) === 14, `still fourteen after the dry run (${before.active_patients})`);

  const imported = run('import for real', ['clinic.mjs', 'import', 'cliniko', `--patients=${patientsCsv}`, `--appointments=${apptsCsv}`]);
  assert(imported.created.some((c) => c.what === 'patient' && c.name === 'Zoe Adams'), 'Zoe Adams arrived');
  assert(imported.created.some((c) => c.what === 'service' && c.name === 'Initial physiotherapy consult'), 'her old service arrived with her');
  assert(imported.updated.some((u) => u.what === 'patient' && u.name === 'Sarah Holt'), 'Sarah matched, not duplicated');

  const again = run('import again (idempotent)', ['clinic.mjs', 'import', 'cliniko', `--patients=${patientsCsv}`, `--appointments=${apptsCsv}`]);
  assert(!again.created.some((c) => c.what === 'appointment'), `the second pass books nothing new (${JSON.stringify(again.created.filter((c) => c.what === 'appointment'))})`);

  const zoe = run('and Zoe was never opted in by a spreadsheet', ['clinic.mjs', 'patient', 'Zoe']);
  assert(zoe.patient.marketing_opt_in === null, 'the marketing question gets asked fresh, not assumed');
  const afterImport = run('imported history does not owe notes', ['clinic.mjs', 'notes-due']);
  assert(afterImport.every((r) => !/Zoe/.test(r.patient)), 'the old system\'s notes live in its own export');

  // ---- export -------------------------------------------------------------------------------

  const exported = run('export', ['clinic.mjs', 'export', `--out=${path.join(scratch, 'out')}`]);
  assert(exported.written.length === 6, `six files (${exported.written.length})`);
  for (const w of exported.written) {
    assert(existsSync(path.join(scratch, 'out', w.file)), `${w.file} exists`);
    assert(readFileSync(path.join(scratch, 'out', w.file), 'utf8').split('\n').length > 2, `${w.file} has rows`);
  }

  console.log(`\nPASS: ${step} steps.`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}
