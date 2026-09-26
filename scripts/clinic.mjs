#!/usr/bin/env node
// allied-health-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/clinic.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is an allied health clinic's operating record the way Cliniko
// sells it: the practitioners and their hours, the patient book with its
// history, referrers, episodes of care with their funding (ACC claim,
// Medicare care plan, private), the diary from booked to completed,
// treatment notes, invoices and payments, recalls and the waitlist. It sends
// nothing and connects to nothing: reminders and recalls draft to drafts/,
// and a person sends them.
//
// The gates, and there are no force flags:
//   * a funded episode of care never books past its approved sessions: an
//     ACC case stops at the approved count until an ACC32 outcome is
//     recorded (`case extend`), a Medicare care plan stops at the sessions
//     the plan holds
//   * completing a visit on a case with no informed consent on record is
//     refused (Code of Health and Disability Services Consumers' Rights
//     1996, Right 7)
//   * a finalised treatment note is never edited: corrections are addenda
//     (Physiotherapy Board of New Zealand record keeping standard; AHPRA
//     codes of conduct)
//   * nobody is double-booked, and nothing is booked outside a
//     practitioner's recorded working hours
//   * a payment never exceeds an invoice's balance
//   * no deleting records: appointments cancel with a reason, patients
//     archive, cases discharge, the clinical record stays

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'week', 'unpaid', 'lapsed', 'consent', 'booked', 'no-invoice', 'clear']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name; let value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const hhmm = (v) => String(v ?? '').slice(0, 5);

// ---------------------------------------------------------------------------
// Dates and times

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand and Australian exports write DD/MM/YYYY: the first number is
  // the day unless the second is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  throw new CliError(`Cannot read ${what} "${s}". Use YYYY-MM-DD (or today / tomorrow / DD/MM/YYYY).`);
}

function parseTime(v, what = 'time') {
  if (!v || v === true) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new CliError(`Cannot read ${what} "${s}". Use HH:MM, 24-hour (or 9:00am).`);
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) throw new CliError(`Cannot read ${what} "${s}". Use HH:MM, 24-hour.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function addMinutes(hm, minutes) {
  const [h, m] = hm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  if (total >= 24 * 60) throw new CliError(`That appointment runs past midnight (${hm} + ${minutes} minutes). Start earlier.`);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

async function setting(db, key, dflt) {
  const [row] = await db.query('select value from settings where key = $1', [key]);
  return row ? row.value : dflt;
}

// ---------------------------------------------------------------------------
// Resolvers: partial ids, case-insensitive names, list-and-exit-1 when ambiguous

async function resolvePatient(db, query, { includeArchived = false } = {}) {
  if (!query) throw new CliError('Which patient? Give a name (partial is fine).');
  const q = String(query).trim();
  const rows = await db.query(
    `select * from v_patients where name ilike $1 ${includeArchived ? '' : `and status = 'active'`} order by name`,
    [`%${q}%`],
  );
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No patient matches "${q}".`);
  throw new CliError(`"${q}" matches ${rows.length} patients:\n${rows.map((r) => `  ${r.name}${r.phone ? ` (${r.phone})` : ''}`).join('\n')}\nSay more of the name.`);
}

async function resolvePractitioner(db, query, { includeFormer = false } = {}) {
  if (!query) throw new CliError('Which practitioner? Give a name (partial is fine).');
  const q = String(query).trim();
  const rows = await db.query(
    `select * from practitioners where name ilike $1 ${includeFormer ? '' : `and status = 'active'`} order by name`,
    [`%${q}%`],
  );
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No practitioner matches "${q}".`);
  throw new CliError(`"${q}" matches ${rows.length} practitioners:\n${rows.map((r) => `  ${r.name} (${r.discipline})`).join('\n')}\nSay more of the name.`);
}

async function resolveService(db, query) {
  if (!query) throw new CliError('Which service? Give a name (partial is fine). See: services');
  const q = String(query).trim();
  const rows = await db.query('select * from services where name ilike $1 and active order by name', [`%${q}%`]);
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No service matches "${q}". See the list: services`);
  throw new CliError(`"${q}" matches ${rows.length} services: ${rows.map((r) => r.name).join(', ')}. Say more of the name.`);
}

async function resolveAppointment(db, ref) {
  if (!ref) throw new CliError('Which appointment? Give its reference (APT-...).');
  let q = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(q)) q = `APT-${q}`;
  const rows = await db.query('select * from v_appointments where upper(ref) = $1', [q]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No appointment matches "${ref}".`);
}

async function resolveCase(db, ref) {
  if (!ref) throw new CliError('Which case? Give its reference (CASE-...).');
  let q = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(q)) q = `CASE-${q}`;
  const rows = await db.query('select * from v_cases where upper(ref) = $1', [q]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No case matches "${ref}". See the list: cases`);
}

async function resolveInvoice(db, ref) {
  if (!ref) throw new CliError('Which invoice? Give its reference (INV-...).');
  let q = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(q)) q = `INV-${q}`;
  const rows = await db.query('select * from v_invoices where upper(ref) = $1', [q]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No invoice matches "${ref}".`);
}

async function resolveReferrer(db, query) {
  if (!query) return null;
  const q = String(query).trim();
  const rows = await db.query('select * from referrers where name ilike $1 or practice ilike $1 order by name', [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (rows.length === 0) throw new CliError(`No referrer matches "${q}". Add them first: referrer add "${q}"`);
  throw new CliError(`"${q}" matches ${rows.length} referrers: ${rows.map((r) => r.name).join(', ')}. Say more of the name.`);
}

async function mintRef(db, tableName, prefix, start) {
  const [row] = await db.query(
    `select coalesce(max(substring(ref from ${prefix.length + 2})::int), $1) + 1 as n
     from ${tableName} where ref like '${prefix}-%' and substring(ref from ${prefix.length + 2}) ~ '^[0-9]+$'`,
    [start - 1],
  );
  return `${prefix}-${row.n}`;
}

// ---------------------------------------------------------------------------
// The gates. One place, used by book add and complete. Violations refuse;
// there are no force flags.

const FUNDING_LABEL = { acc: 'ACC claim', epc: 'Medicare care plan', insurer: 'insurer approval', private: 'private' };

async function bookingGates(db, { patient, practitioner, service, caseRow, onDate, startsAt, endsAt }) {
  const violations = [];
  const warnings = [];

  // The funded-sessions gate. Sessions already delivered plus sessions
  // already booked ahead never exceed what the funder approved. ACC wants an
  // ACC32 before treatment continues past the approval; a Medicare care plan
  // holds a fixed number of sessions (MBS chronic disease management items).
  if (caseRow && caseRow.approved_sessions !== null && caseRow.approved_sessions !== undefined) {
    const used = num(caseRow.sessions_used);
    const booked = num(caseRow.sessions_booked);
    const committed = used + booked;
    const label = FUNDING_LABEL[caseRow.funding] || caseRow.funding;
    if (committed >= num(caseRow.approved_sessions)) {
      const fix = caseRow.funding === 'acc'
        ? `Lodge an ACC32 for more sessions, and when the outcome lands: case extend ${caseRow.ref} --sessions=N --note="ACC32 approved ..."`
        : caseRow.funding === 'epc'
          ? `The patient needs a new care plan from their GP (or books privately): case extend ${caseRow.ref} --sessions=N --note="new plan ..." or book with no --case`
          : `Record the funder's new approval: case extend ${caseRow.ref} --sessions=N`;
      violations.push(
        `${caseRow.ref} (${caseRow.title}) has ${used} of ${caseRow.approved_sessions} approved sessions used and ${booked} booked: the ${label} is fully committed. ${fix}`,
      );
    } else {
      const remainingAfter = num(caseRow.approved_sessions) - committed - 1;
      const warnAt = num(await setting(db, 'funded_warn_remaining', '2'));
      if (remainingAfter <= warnAt) {
        warnings.push(`${caseRow.ref}: ${remainingAfter} session(s) will remain on the ${label} after this one. Start the paperwork for more now if care will continue.`);
      }
    }
  }

  // Working hours: the practitioner is in the building.
  const weekday = new Date(`${onDate}T00:00:00`).getDay();
  const [hoursRow] = await db.query(
    'select * from practitioner_hours where practitioner_id = $1 and weekday = $2',
    [practitioner.id, weekday],
  );
  if (!hoursRow) {
    violations.push(`${practitioner.name} has no working hours on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday]}s. See: team`);
  } else if (startsAt < hhmm(hoursRow.starts_at) || endsAt > hhmm(hoursRow.ends_at)) {
    violations.push(`${practitioner.name} works ${hhmm(hoursRow.starts_at)} to ${hhmm(hoursRow.ends_at)} that day; ${startsAt} to ${endsAt} falls outside. Pick a time inside their hours.`);
  }

  // One practitioner, one patient, one time.
  const clashes = await db.query(
    `select ref, starts_at, ends_at, patient from v_appointments
     where practitioner_id = $1 and on_date = $2 and status in ('booked', 'confirmed')
       and starts_at < $4 and ends_at > $3`,
    [practitioner.id, onDate, startsAt, endsAt],
  );
  for (const c of clashes) {
    violations.push(`${practitioner.name} already has ${c.patient} at ${hhmm(c.starts_at)} to ${hhmm(c.ends_at)} (${c.ref}). Pick another time.`);
  }
  const patientClashes = await db.query(
    `select ref, starts_at, ends_at, practitioner from v_appointments
     where patient_id = $1 and on_date = $2 and status in ('booked', 'confirmed')
       and starts_at < $4 and ends_at > $3`,
    [patient.patient_id ?? patient.id, onDate, startsAt, endsAt],
  );
  for (const c of patientClashes) {
    violations.push(`${patient.name} is already with ${c.practitioner} at ${hhmm(c.starts_at)} (${c.ref}). One patient, one place, one time.`);
  }

  return { violations, warnings };
}

// ---------------------------------------------------------------------------
// The diary

async function cmdDay(db, flags) {
  const onDate = parseDate(flags.date) || today();
  const rows = await db.query(
    `select * from v_appointments where on_date = $1 order by practitioner, starts_at`,
    [onDate],
  );
  const noteDue = new Set((await db.query('select ref from v_notes_due')).map((r) => r.ref));
  const out = rows.map((r) => ({
    ref: r.ref,
    time: `${hhmm(r.starts_at)}-${hhmm(r.ends_at)}`,
    practitioner: r.practitioner,
    patient: r.patient,
    service: r.service,
    case_ref: r.case_ref || '',
    funding: r.funding || 'private',
    state: r.status === 'booked' ? 'UNCONFIRMED'
      : r.status === 'completed' && noteDue.has(r.ref) ? 'NOTE DUE'
        : r.status,
    alerts: r.patient_alerts || '',
  }));
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading(`The day sheet, ${onDate}`));
  console.log(table(out, [
    { key: 'time', label: 'time' },
    { key: 'practitioner', label: 'practitioner' },
    { key: 'patient', label: 'patient' },
    { key: 'service', label: 'service', width: 34 },
    { key: 'funding', label: 'funding' },
    { key: 'state', label: 'state' },
    { key: 'ref', label: 'ref' },
    { key: 'alerts', label: 'alerts', width: 36 },
  ]));
}

async function cmdBook(db, flags) {
  const from = parseDate(flags.day) || today();
  const to = flags.day ? from : addDays(from, 6);
  const params = [from, to];
  let where = 'on_date between $1 and $2';
  if (flags.practitioner) {
    const pr = await resolvePractitioner(db, flags.practitioner);
    params.push(pr.id);
    where += ` and practitioner_id = $3`;
  }
  const rows = await db.query(
    `select * from v_appointments where ${where} order by on_date, starts_at, practitioner`,
    params,
  );
  const out = rows.map((r) => ({
    ref: r.ref,
    on_date: isoDate(r.on_date),
    time: hhmm(r.starts_at),
    practitioner: r.practitioner,
    patient: r.patient,
    service: r.service,
    case_ref: r.case_ref || '',
    state: r.status === 'booked' ? 'UNCONFIRMED' : r.status,
  }));
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading(flags.day ? `The diary, ${from}` : `The diary, ${from} to ${to}`));
  console.log(table(out, [
    { key: 'on_date', label: 'date' },
    { key: 'time', label: 'time' },
    { key: 'practitioner', label: 'practitioner' },
    { key: 'patient', label: 'patient' },
    { key: 'service', label: 'service', width: 34 },
    { key: 'case_ref', label: 'case' },
    { key: 'state', label: 'state' },
    { key: 'ref', label: 'ref' },
  ]));
}

async function cmdBookAdd(db, args, flags) {
  const [patientQ, practitionerQ] = args;
  const patient = await resolvePatient(db, patientQ);
  const practitioner = await resolvePractitioner(db, practitionerQ);
  const service = await resolveService(db, flags.service);
  const onDate = parseDate(flags.date, '--date');
  const startsAt = parseTime(flags.at, '--at');
  if (!onDate || !startsAt) throw new CliError('A booking needs --date= and --at=.');
  const endsAt = addMinutes(startsAt, num(service.minutes));
  const caseRow = flags.case ? await resolveCase(db, flags.case) : null;
  if (caseRow && caseRow.patient_id !== (patient.patient_id ?? patient.id)) {
    throw new CliError(`${caseRow.ref} belongs to ${caseRow.patient}, not ${patient.name}.`);
  }
  if (caseRow && caseRow.status !== 'open') {
    throw new CliError(`${caseRow.ref} was discharged ${isoDate(caseRow.discharged_on)}. Open a new case: case add "${patient.name}" --title="..."`);
  }

  const { violations, warnings } = await bookingGates(db, { patient, practitioner, service, caseRow, onDate, startsAt, endsAt });
  if (violations.length) throw new CliError(`Not booked:\n  ${violations.join('\n  ')}`);

  const ref = await mintRef(db, 'appointments', 'APT', 1001);
  await db.query(
    `insert into appointments (ref, patient_id, practitioner_id, case_id, service_id, on_date, starts_at, ends_at, status, price_cents, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'booked', $9, $10)`,
    [ref, patient.patient_id ?? patient.id, practitioner.id, caseRow ? caseRow.id : null, service.id,
      onDate, startsAt, endsAt, num(service.price_cents), str(flags.note) || null],
  );
  const result = { ref, patient: patient.name, practitioner: practitioner.name, service: service.name, on_date: onDate, at: startsAt, case: caseRow ? caseRow.ref : null, warnings };
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`Booked ${ref}: ${patient.name} with ${practitioner.name}, ${service.name}, ${onDate} ${startsAt}${caseRow ? ` on ${caseRow.ref}` : ''}.`);
  for (const w of warnings) console.log(`  NOTE: ${w}`);
}

async function cmdConfirm(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  if (apt.status !== 'booked') throw new CliError(`${apt.ref} is ${apt.status}; only a booked appointment confirms.`);
  await db.query(`update appointments set status = 'confirmed' where id = $1`, [apt.id]);
  const out = { ref: apt.ref, status: 'confirmed' };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`${apt.ref} confirmed: ${apt.patient} with ${apt.practitioner}, ${isoDate(apt.on_date)} ${hhmm(apt.starts_at)}.`);
}

async function cmdCancel(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  const reason = str(flags.reason);
  if (!reason) throw new CliError('A cancellation carries its reason: cancel REF --reason="..."');
  if (!['booked', 'confirmed'].includes(apt.status)) throw new CliError(`${apt.ref} is ${apt.status}; there is nothing to cancel.`);
  await db.query(`update appointments set status = 'cancelled', cancel_reason = $2 where id = $1`, [apt.id, reason]);
  if (flags.json) return console.log(JSON.stringify({ ref: apt.ref, status: 'cancelled', reason }, null, 2));
  console.log(`${apt.ref} cancelled (${reason}). The slot is open again; check the waitlist: waitlist`);
}

async function cmdDna(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  if (!['booked', 'confirmed'].includes(apt.status)) throw new CliError(`${apt.ref} is ${apt.status}; only an open booking can be marked DNA.`);
  if (isoDate(apt.on_date) > today()) throw new CliError(`${apt.ref} is on ${isoDate(apt.on_date)}, in the future. Mark DNA on the day, not before.`);
  await db.query(`update appointments set status = 'dna' where id = $1`, [apt.id]);
  const [habit] = await db.query(
    `select count(*) as n from appointments where patient_id = $1 and status = 'dna' and on_date > current_date - 180`,
    [apt.patient_id],
  );
  const out = { ref: apt.ref, patient: apt.patient, dnas_180: num(habit.n) };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`${apt.ref} marked DNA: ${apt.patient}, ${apt.service} with ${apt.practitioner}.`);
  console.log(`  That is ${habit.n} DNA(s) in six months. Call while it is fresh; rebook, and if this is a habit, a cancellation policy conversation is fair.`);
}

async function cmdComplete(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  if (!['booked', 'confirmed'].includes(apt.status)) throw new CliError(`${apt.ref} is ${apt.status}; there is nothing to complete.`);
  if (isoDate(apt.on_date) > today()) throw new CliError(`${apt.ref} is on ${isoDate(apt.on_date)}, in the future. Complete it on the day.`);

  // Informed consent, per episode of care (Code of Health and Disability
  // Services Consumers' Rights 1996, Right 7). No consent on the case, no
  // completed visit.
  if (apt.case_id) {
    const [caseRow] = await db.query('select * from cases where id = $1', [apt.case_id]);
    if (caseRow && !caseRow.consent_recorded_on) {
      throw new CliError(
        `Not completed: ${apt.case_ref} (${apt.case_title}) has no informed consent on record. Record it first: case consent ${apt.case_ref} --on=${isoDate(apt.on_date)}`,
      );
    }
  }

  await db.query(`update appointments set status = 'completed' where id = $1`, [apt.id]);

  let invoice = null;
  if (!flags['no-invoice'] && num(apt.price_cents) > 0) {
    const payer = apt.funding === 'acc' ? 'acc' : apt.funding === 'insurer' ? 'insurer' : 'patient';
    const dueDays = num(await setting(db, 'invoice_due_days', '14'));
    const ref = await mintRef(db, 'invoices', 'INV', 2001);
    const [inv] = await db.query(
      `insert into invoices (ref, patient_id, case_id, payer, issued_on, due_on, status)
       values ($1, $2, $3, $4, current_date, current_date + ${dueDays}, 'sent') returning id`,
      [ref, apt.patient_id, apt.case_id, payer],
    );
    await db.query(
      `insert into invoice_items (invoice_id, description, qty, unit_cents) values ($1, $2, 1, $3)`,
      [inv.id, `${apt.service}${apt.claim_number ? `, claim ${apt.claim_number}` : ''}`, num(apt.price_cents)],
    );
    invoice = { ref, payer, total_cents: num(apt.price_cents) };
  }

  const out = { ref: apt.ref, status: 'completed', invoice };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`${apt.ref} completed: ${apt.patient}, ${apt.service} with ${apt.practitioner}.`);
  if (invoice) console.log(`  Invoiced ${invoice.ref} to ${invoice.payer === 'patient' ? apt.patient : invoice.payer.toUpperCase()}: ${money(invoice.total_cents)}.`);
  console.log(`  Now the note, while it is fresh: note add ${apt.ref} --s="..." --o="..." --a="..." --p="..." then note final ${apt.ref}`);
}

// ---------------------------------------------------------------------------
// Treatment notes

async function cmdNoteAdd(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  if (apt.status !== 'completed') throw new CliError(`${apt.ref} is ${apt.status}; notes attach to completed visits. Complete it first: complete ${apt.ref}`);
  const [existing] = await db.query('select * from treatment_notes where appointment_id = $1', [apt.id]);
  if (existing && existing.status === 'final') {
    throw new CliError(`${apt.ref}'s note is finalised and the record does not change. Add a correction instead: note addendum ${apt.ref} "..."`);
  }
  const fields = {
    subjective: str(flags.s) || str(flags.subjective) || null,
    objective: str(flags.o) || str(flags.objective) || null,
    assessment: str(flags.a) || str(flags.assessment) || null,
    plan: str(flags.p) || str(flags.plan) || null,
  };
  if (existing) {
    await db.query(
      `update treatment_notes set subjective = coalesce($2, subjective), objective = coalesce($3, objective),
       assessment = coalesce($4, assessment), plan = coalesce($5, plan) where id = $1`,
      [existing.id, fields.subjective, fields.objective, fields.assessment, fields.plan],
    );
  } else {
    await db.query(
      `insert into treatment_notes (appointment_id, patient_id, practitioner_id, case_id, on_date, subjective, objective, assessment, plan, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')`,
      [apt.id, apt.patient_id, apt.practitioner_id, apt.case_id, isoDate(apt.on_date),
        fields.subjective, fields.objective, fields.assessment, fields.plan],
    );
  }
  if (flags.json) return console.log(JSON.stringify({ ref: apt.ref, note: 'draft' }, null, 2));
  console.log(`${apt.ref}: note saved as draft. Finalise it when it is complete: note final ${apt.ref}`);
}

async function cmdNoteFinal(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  const [note] = await db.query('select * from treatment_notes where appointment_id = $1', [apt.id]);
  if (!note) throw new CliError(`${apt.ref} has no note yet: note add ${apt.ref} --s="..." --o="..."`);
  if (note.status === 'final') throw new CliError(`${apt.ref}'s note is already finalised.`);
  if (!note.subjective && !note.objective && !note.assessment && !note.plan) {
    throw new CliError(`${apt.ref}'s note is empty. Write it before finalising: note add ${apt.ref} --s="..." --o="..."`);
  }
  await db.query(`update treatment_notes set status = 'final', finalised_at = now() where id = $1`, [note.id]);
  if (flags.json) return console.log(JSON.stringify({ ref: apt.ref, note: 'final' }, null, 2));
  console.log(`${apt.ref}: note finalised. It does not change from here; corrections are addenda (note addendum ${apt.ref} "...").`);
}

async function cmdNoteAddendum(db, args, flags) {
  const apt = await resolveAppointment(db, args[0]);
  const text = args.slice(1).join(' ').trim();
  if (!text) throw new CliError(`What is the addendum? note addendum ${apt.ref} "..."`);
  const [note] = await db.query('select * from treatment_notes where appointment_id = $1', [apt.id]);
  if (!note) throw new CliError(`${apt.ref} has no note to correct: note add ${apt.ref} ...`);
  const stamp = `[${today()}] ${text}`;
  await db.query(
    `update treatment_notes set addendum = case when addendum is null then $2 else addendum || E'\\n' || $2 end where id = $1`,
    [note.id, stamp],
  );
  if (flags.json) return console.log(JSON.stringify({ ref: apt.ref, addendum: stamp }, null, 2));
  console.log(`${apt.ref}: addendum recorded, dated, under the original note.`);
}

async function cmdNotes(db, args, flags) {
  const patient = await resolvePatient(db, args[0], { includeArchived: true });
  const rows = await db.query(
    `select tn.on_date, a.ref, pr.name as practitioner, s.name as service, tn.status,
            tn.subjective, tn.objective, tn.assessment, tn.plan, tn.addendum, c.ref as case_ref
     from treatment_notes tn
     join appointments a on a.id = tn.appointment_id
     join practitioners pr on pr.id = tn.practitioner_id
     join services s on s.id = a.service_id
     left join cases c on c.id = tn.case_id
     where tn.patient_id = $1 order by tn.on_date desc`,
    [patient.patient_id],
  );
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading(`Treatment notes: ${patient.name}`));
  if (!rows.length) return console.log('  (none)');
  for (const r of rows) {
    console.log(`\n  ${isoDate(r.on_date)}  ${r.ref}  ${r.service} with ${r.practitioner}${r.case_ref ? `  (${r.case_ref})` : ''}  [${r.status.toUpperCase()}]`);
    if (r.subjective) console.log(`    S: ${truncate(r.subjective, 100)}`);
    if (r.objective) console.log(`    O: ${truncate(r.objective, 100)}`);
    if (r.assessment) console.log(`    A: ${truncate(r.assessment, 100)}`);
    if (r.plan) console.log(`    P: ${truncate(r.plan, 100)}`);
    if (r.addendum) console.log(`    Addendum: ${truncate(r.addendum, 100)}`);
  }
}

async function cmdNotesDue(db, flags) {
  const rows = await db.query('select * from v_notes_due order by on_date');
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Clinical records not finalised'));
  console.log(table(rows, [
    { key: 'on_date', label: 'visit', format: isoDate },
    { key: 'days_since', label: 'days ago', align: 'right' },
    { key: 'patient', label: 'patient' },
    { key: 'practitioner', label: 'practitioner' },
    { key: 'service', label: 'service', width: 34 },
    { key: 'note_state', label: 'note' },
    { key: 'ref', label: 'ref' },
  ]));
  if (rows.length) console.log(`\n  Write them while they are fresh: note add REF --s="..." then note final REF`);
}

// ---------------------------------------------------------------------------
// Patients

async function cmdPatients(db, flags) {
  const rows = await db.query(
    `select * from v_patients where status = 'active' ${flags.lapsed ? 'and lapsed' : ''} order by name`,
  );
  const out = rows.map((r) => ({
    name: r.name,
    phone: r.phone || '',
    last_visit: isoDate(r.last_visit_on),
    rhythm: r.usual_gap_days ? `${r.usual_gap_days}d` : '',
    next: isoDate(r.next_appt_on),
    spend_12m: num(r.spend_cents_12m),
    lapsed: r.lapsed ? 'LAPSED' : '',
    opt_in: r.marketing_opt_in === true ? 'yes' : r.marketing_opt_in === false ? 'no' : 'never asked',
  }));
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading(flags.lapsed ? 'Lapsed patients, worth the most first' : 'The patient book'));
  if (flags.lapsed) out.sort((a, b) => b.spend_12m - a.spend_12m);
  console.log(table(out, [
    { key: 'name', label: 'patient' },
    { key: 'phone', label: 'phone' },
    { key: 'last_visit', label: 'last visit' },
    { key: 'rhythm', label: 'rhythm' },
    { key: 'next', label: 'next appt' },
    { key: 'spend_12m', label: 'spend 12m', align: 'right', format: (v) => money(v) },
    { key: 'lapsed', label: '' },
    { key: 'opt_in', label: 'marketing' },
  ]));
}

async function cmdPatient(db, args, flags) {
  const patient = await resolvePatient(db, args.join(' '), { includeArchived: true });
  const cases = await db.query('select * from v_cases where patient_id = $1 order by opened_on desc', [patient.patient_id]);
  const upcoming = await db.query(
    `select * from v_appointments where patient_id = $1 and on_date >= current_date and status in ('booked','confirmed') order by on_date`,
    [patient.patient_id],
  );
  const recent = await db.query(
    `select * from v_appointments where patient_id = $1 and status in ('completed','dna','cancelled') order by on_date desc limit 10`,
    [patient.patient_id],
  );
  const invoices = await db.query(
    `select * from v_invoices where patient_id = $1 and balance_cents > 0 order by due_on`,
    [patient.patient_id],
  );
  const log = await db.query('select * from patient_notes where patient_id = $1 order by on_date desc limit 5', [patient.patient_id]);

  const out = {
    patient: {
      name: patient.name,
      date_of_birth: isoDate(patient.date_of_birth),
      phone: patient.phone,
      email: patient.email,
      nhi: patient.nhi,
      alerts: patient.alerts,
      referral_source: patient.referral_source,
      marketing_opt_in: patient.marketing_opt_in,
      status: patient.status,
      last_visit_on: isoDate(patient.last_visit_on),
      usual_gap_days: patient.usual_gap_days ? num(patient.usual_gap_days) : null,
      spend_cents_12m: num(patient.spend_cents_12m),
      lapsed: patient.lapsed === true,
    },
    cases: cases.map((c) => ({
      ref: c.ref, title: c.title, funding: c.funding, claim_number: c.claim_number, status: c.status,
      sessions_used: num(c.sessions_used), sessions_booked: num(c.sessions_booked),
      approved_sessions: c.approved_sessions === null ? null : num(c.approved_sessions),
      consent_recorded_on: isoDate(c.consent_recorded_on) || null,
    })),
    upcoming: upcoming.map((a) => ({ ref: a.ref, on_date: isoDate(a.on_date), at: hhmm(a.starts_at), practitioner: a.practitioner, service: a.service, status: a.status })),
    recent: recent.map((a) => ({ ref: a.ref, on_date: isoDate(a.on_date), service: a.service, status: a.status, note: a.note_status || 'missing' })),
    owing: invoices.map((i) => ({ ref: i.ref, payer: i.payer, balance_cents: num(i.balance_cents), days_overdue: num(i.days_overdue) })),
    log: log.map((l) => ({ on_date: isoDate(l.on_date), author: l.author, body: l.body })),
  };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));

  const p = out.patient;
  console.log(heading(p.name + (p.status === 'archived' ? '  [ARCHIVED]' : '')));
  console.log(`  born ${p.date_of_birth || '?'}  ${p.phone || ''}  ${p.email || ''}${p.nhi ? `  NHI ${p.nhi}` : ''}`);
  if (p.alerts) console.log(`  ALERTS: ${p.alerts}`);
  console.log(`  referred by: ${p.referral_source || 'unknown'}  marketing: ${p.marketing_opt_in === true ? 'opted in' : p.marketing_opt_in === false ? 'opted out' : 'NEVER ASKED'}`);
  console.log(`  last visit ${p.last_visit_on || 'never'}${p.usual_gap_days ? `, usually in every ${p.usual_gap_days} days` : ''}${p.lapsed ? '  LAPSED' : ''}  spend 12m ${money(p.spend_cents_12m)}`);
  if (out.cases.length) {
    console.log('\n  Cases');
    for (const c of out.cases) {
      const sessions = c.approved_sessions ? `${c.sessions_used} of ${c.approved_sessions} used, ${c.sessions_booked} booked` : `${c.sessions_used} visits`;
      console.log(`    ${c.ref}  ${c.title}  [${c.funding}${c.claim_number ? ` ${c.claim_number}` : ''}]  ${sessions}  ${c.status}${c.consent_recorded_on ? '' : '  NO CONSENT RECORDED'}`);
    }
  }
  if (out.upcoming.length) {
    console.log('\n  Upcoming');
    for (const a of out.upcoming) console.log(`    ${a.on_date} ${a.at}  ${a.service} with ${a.practitioner}  (${a.status}, ${a.ref})`);
  }
  if (out.recent.length) {
    console.log('\n  Recent');
    for (const a of out.recent) console.log(`    ${a.on_date}  ${a.service}  ${a.status}${a.status === 'completed' ? `, note ${a.note}` : ''}  (${a.ref})`);
  }
  if (out.owing.length) {
    console.log('\n  Owing');
    for (const i of out.owing) console.log(`    ${i.ref}  ${money(i.balance_cents)} from ${i.payer}${i.days_overdue ? `, ${i.days_overdue} days overdue` : ''}`);
  }
  if (out.log.length) {
    console.log('\n  Conversation log');
    for (const l of out.log) console.log(`    ${l.on_date}  ${l.author || ''}: ${truncate(l.body, 90)}`);
  }
}

async function cmdPatientAdd(db, args, flags) {
  const name = args.join(' ').trim();
  if (!name) throw new CliError('patient add NAME [--phone= --email= --dob= --nhi= --alerts= --opt-in=yes|no]');
  const existing = await db.query('select name from patients where lower(name) = lower($1)', [name]);
  if (existing.length) throw new CliError(`${existing[0].name} is already on the book. Update them instead: patient set "${name}" ...`);
  const optIn = flags['opt-in'] === undefined ? null : ['yes', 'true', true].includes(flags['opt-in']);
  await db.query(
    `insert into patients (name, phone, email, date_of_birth, nhi, alerts, referral_source, marketing_opt_in)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [name, str(flags.phone) || null, str(flags.email) || null, parseDate(flags.dob, '--dob'),
      str(flags.nhi) || null, str(flags.alerts) || null, str(flags.referral) || null, optIn],
  );
  if (flags.json) return console.log(JSON.stringify({ name, created: true }, null, 2));
  console.log(`${name} is on the book.${optIn === null ? ' Ask the marketing question when they are in: patient set "' + name + '" --opt-in=yes|no' : ''}`);
}

async function cmdPatientSet(db, args, flags) {
  const patient = await resolvePatient(db, args.join(' '), { includeArchived: true });
  const sets = [];
  const params = [patient.patient_id];
  const add = (sql, v) => { params.push(v); sets.push(`${sql} = $${params.length}`); };
  if (flags.phone !== undefined) add('phone', str(flags.phone) || null);
  if (flags.email !== undefined) add('email', str(flags.email) || null);
  if (flags.nhi !== undefined) add('nhi', str(flags.nhi) || null);
  if (flags.alerts !== undefined) add('alerts', str(flags.alerts) || null);
  if (flags.dob !== undefined) add('date_of_birth', parseDate(flags.dob, '--dob'));
  if (flags['opt-in'] !== undefined) add('marketing_opt_in', ['yes', 'true', true].includes(flags['opt-in']));
  if (flags.archive) add('status', 'archived');
  if (!sets.length) throw new CliError('Nothing to change. Flags: --phone --email --dob --nhi --alerts --opt-in=yes|no --archive');
  await db.query(`update patients set ${sets.join(', ')} where id = $1`, params);
  if (flags.json) return console.log(JSON.stringify({ name: patient.name, updated: sets.length }, null, 2));
  console.log(`${patient.name} updated.${flags.archive ? ' Archived, not deleted: the clinical record stays (Health (Retention of Health Information) Regulations 1996).' : ''}`);
}

async function cmdLog(db, args, flags) {
  const patient = await resolvePatient(db, args[0], { includeArchived: true });
  const text = args.slice(1).join(' ').trim();
  if (!text) throw new CliError('log PATIENT "what was said" [--author=]');
  await db.query(
    'insert into patient_notes (patient_id, author, body) values ($1, $2, $3)',
    [patient.patient_id, str(flags.author) || null, text],
  );
  if (flags.json) return console.log(JSON.stringify({ patient: patient.name, logged: true }, null, 2));
  console.log(`Logged on ${patient.name}'s record.`);
}

// ---------------------------------------------------------------------------
// Cases

async function cmdCases(db, flags) {
  const rows = await db.query(
    `select * from v_cases where ${flags.all ? 'true' : `status = 'open'`} order by opened_on desc`,
  );
  const out = rows.map((c) => ({
    ref: c.ref,
    patient: c.patient,
    title: c.title,
    funding: c.funding + (c.claim_number ? ` ${c.claim_number}` : ''),
    sessions: c.approved_sessions
      ? `${num(c.sessions_used)}+${num(c.sessions_booked)} of ${num(c.approved_sessions)}`
      : `${num(c.sessions_used)}`,
    remaining: c.sessions_remaining === null || c.sessions_remaining === undefined ? '' : String(num(c.sessions_remaining)),
    consent: c.consent_recorded_on ? 'yes' : 'NONE',
    status: c.status,
  }));
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading(flags.all ? 'All cases' : 'Open cases'));
  console.log(table(out, [
    { key: 'ref', label: 'case' },
    { key: 'patient', label: 'patient' },
    { key: 'title', label: 'condition', width: 32 },
    { key: 'funding', label: 'funding' },
    { key: 'sessions', label: 'used+booked' },
    { key: 'remaining', label: 'left', align: 'right' },
    { key: 'consent', label: 'consent' },
    { key: 'status', label: 'status' },
  ]));
}

async function cmdCaseShow(db, args, flags) {
  const c = await resolveCase(db, args[0]);
  const appts = await db.query(
    'select * from v_appointments where case_id = $1 order by on_date',
    [c.id],
  );
  const out = { ...c, appointments: appts.map((a) => ({ ref: a.ref, on_date: isoDate(a.on_date), service: a.service, status: a.status, note: a.note_status || 'missing' })) };
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading(`${c.ref}: ${c.patient}, ${c.title}`));
  console.log(`  funding ${c.funding}${c.claim_number ? ` (${c.claim_number})` : ''}${c.injury_date ? `, injury ${isoDate(c.injury_date)}` : ''}`);
  if (c.approved_sessions) console.log(`  sessions: ${num(c.sessions_used)} used, ${num(c.sessions_booked)} booked, ${num(c.sessions_remaining)} left of ${num(c.approved_sessions)} approved`);
  console.log(`  consent: ${c.consent_recorded_on ? isoDate(c.consent_recorded_on) : 'NOT RECORDED (Right 7): case consent ' + c.ref}`);
  if (c.referrer) console.log(`  referred by ${c.referrer}${c.referrer_practice && c.referrer_practice !== c.referrer ? `, ${c.referrer_practice}` : ''}${c.referral_date ? `, ${isoDate(c.referral_date)}` : ''}`);
  console.log(`  ${c.status}${c.discharged_on ? ` ${isoDate(c.discharged_on)}` : ''}${c.note ? `  ${truncate(c.note, 70)}` : ''}`);
  for (const a of out.appointments) console.log(`    ${a.on_date}  ${a.service}  ${a.status}${a.status === 'completed' ? `, note ${a.note}` : ''}  (${a.ref})`);
}

async function cmdCaseAdd(db, args, flags) {
  const patient = await resolvePatient(db, args[0]);
  const title = str(flags.title);
  if (!title) throw new CliError('case add PATIENT --title="Right knee ACL rehab" [--funding=acc|epc|insurer|private --claim= --sessions= --injury= --referrer= --consent]');
  const funding = str(flags.funding) || 'private';
  if (!['acc', 'epc', 'insurer', 'private'].includes(funding)) throw new CliError('--funding is acc, epc, insurer or private.');
  const sessions = flags.sessions === undefined ? null : num(flags.sessions);
  if ((funding === 'acc' || funding === 'epc') && !sessions) {
    throw new CliError(`A funded case carries its approved sessions: --sessions=N (what the ${FUNDING_LABEL[funding]} approved).`);
  }
  const referrer = flags.referrer ? await resolveReferrer(db, flags.referrer) : null;
  const ref = await mintRef(db, 'cases', 'CASE', 101);
  await db.query(
    `insert into cases (ref, patient_id, title, funding, claim_number, injury_date, approved_sessions,
                        referrer_id, referral_date, consent_recorded_on, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [ref, patient.patient_id, title, funding, str(flags.claim) || null, parseDate(flags.injury, '--injury'),
      sessions, referrer ? referrer.id : null, referrer ? (parseDate(flags['referral-date'], '--referral-date') || today()) : null,
      flags.consent ? today() : null, str(flags.note) || null],
  );
  if (flags.json) return console.log(JSON.stringify({ ref, patient: patient.name, title, funding }, null, 2));
  console.log(`${ref} opened: ${patient.name}, ${title} [${funding}${flags.claim ? ` ${flags.claim}` : ''}${sessions ? `, ${sessions} sessions approved` : ''}].`);
  if (!flags.consent) console.log(`  Record informed consent at the first visit: case consent ${ref} (Right 7; nothing completes without it).`);
}

async function cmdCaseConsent(db, args, flags) {
  const c = await resolveCase(db, args[0]);
  const on = parseDate(flags.on) || today();
  await db.query('update cases set consent_recorded_on = $2 where id = $1', [c.id, on]);
  if (flags.json) return console.log(JSON.stringify({ ref: c.ref, consent_recorded_on: on }, null, 2));
  console.log(`${c.ref}: informed consent recorded ${on}.`);
}

async function cmdCaseExtend(db, args, flags) {
  const c = await resolveCase(db, args[0]);
  const extra = num(flags.sessions);
  if (!extra || extra < 1) throw new CliError(`How many more sessions did the funder approve? case extend ${c.ref} --sessions=N --note="ACC32 approved ..."`);
  if (c.approved_sessions === null || c.approved_sessions === undefined) throw new CliError(`${c.ref} is ${c.funding} with no session cap; there is nothing to extend.`);
  const newTotal = num(c.approved_sessions) + extra;
  await db.query('update cases set approved_sessions = $2 where id = $1', [c.id, newTotal]);
  await db.query(
    'insert into patient_notes (patient_id, author, body) values ($1, $2, $3)',
    [c.patient_id, null, `${c.ref}: approval extended by ${extra} to ${newTotal} sessions.${flags.note ? ` ${str(flags.note)}` : ''}`],
  );
  if (flags.json) return console.log(JSON.stringify({ ref: c.ref, approved_sessions: newTotal }, null, 2));
  console.log(`${c.ref}: approval now ${newTotal} sessions (${num(c.sessions_used)} used, ${num(c.sessions_booked)} booked). The extension is on ${c.patient}'s record.`);
}

async function cmdCaseDischarge(db, args, flags) {
  const c = await resolveCase(db, args[0]);
  if (c.status !== 'open') throw new CliError(`${c.ref} is already discharged.`);
  const open = await db.query(
    `select ref from appointments where case_id = $1 and status in ('booked','confirmed') and on_date >= current_date`,
    [c.id],
  );
  if (open.length) throw new CliError(`${c.ref} still has bookings ahead (${open.map((r) => r.ref).join(', ')}). Complete or cancel them first.`);
  await db.query(`update cases set status = 'discharged', discharged_on = current_date, note = coalesce($2, note) where id = $1`, [c.id, str(flags.note) || null]);
  if (flags.json) return console.log(JSON.stringify({ ref: c.ref, status: 'discharged' }, null, 2));
  console.log(`${c.ref} discharged. The clinical record stays, and a discharge letter to the referrer is good manners: /draft-gp-letter ${c.ref}`);
}

// ---------------------------------------------------------------------------
// Money

async function cmdInvoices(db, flags) {
  const rows = await db.query(
    `select * from v_invoices where ${flags.unpaid ? `status = 'sent' and balance_cents > 0` : 'true'} order by due_on`,
  );
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading(flags.unpaid ? 'Unpaid invoices' : 'Invoices'));
  console.log(table(rows, [
    { key: 'ref', label: 'invoice' },
    { key: 'patient', label: 'patient' },
    { key: 'payer', label: 'payer' },
    { key: 'issued_on', label: 'issued', format: isoDate },
    { key: 'due_on', label: 'due', format: isoDate },
    { key: 'total_cents', label: 'total', align: 'right', format: (v) => money(v) },
    { key: 'balance_cents', label: 'owing', align: 'right', format: (v) => money(v) },
    { key: 'days_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) ? `${v}d` : '') },
    { key: 'status', label: 'status' },
  ]));
}

async function cmdDebtors(db, flags) {
  const rows = await db.query(
    `select * from v_invoices where status = 'sent' and balance_cents > 0 order by days_overdue desc`,
  );
  const bucket = (d) => (d <= 0 ? 'current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : '60+');
  const out = rows.map((r) => ({
    ref: r.ref, patient: r.patient, payer: r.payer, balance_cents: num(r.balance_cents),
    days_overdue: num(r.days_overdue), bucket: bucket(num(r.days_overdue)),
  }));
  const patientTotal = out.filter((r) => r.payer === 'patient').reduce((s, r) => s + r.balance_cents, 0);
  const funderTotal = out.filter((r) => r.payer !== 'patient').reduce((s, r) => s + r.balance_cents, 0);
  const result = { owing: out, patient_cents: patientTotal, funder_cents: funderTotal };
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(heading('Who owes the clinic'));
  console.log(table(out, [
    { key: 'ref', label: 'invoice' },
    { key: 'patient', label: 'patient' },
    { key: 'payer', label: 'payer' },
    { key: 'balance_cents', label: 'owing', align: 'right', format: (v) => money(v) },
    { key: 'days_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) ? `${v}d` : 'not yet') },
    { key: 'bucket', label: 'bucket' },
  ]));
  console.log(`\n  patients owe ${money(patientTotal)}, funders owe ${money(funderTotal)}. Chase the funder lines too: ACC and insurers pay on queried schedules, not goodwill.`);
}

async function cmdPay(db, args, flags) {
  const inv = await resolveInvoice(db, args[0]);
  const cents = Math.round(Number(flags.amount) * 100);
  if (!flags.amount || !Number.isFinite(cents) || cents <= 0) throw new CliError('pay INV-... --amount=85 (dollars) [--method=card|cash|transfer|acc --on=DATE]');
  if (cents > num(inv.balance_cents)) {
    throw new CliError(`${inv.ref} has ${money(inv.balance_cents)} owing; a payment of ${money(cents)} exceeds it. Record what was actually paid.`);
  }
  const method = str(flags.method) || (inv.payer === 'acc' ? 'acc' : 'card');
  await db.query(
    'insert into payments (invoice_id, on_date, amount_cents, method) values ($1, $2, $3, $4)',
    [inv.id, parseDate(flags.on) || today(), cents, method],
  );
  const remaining = num(inv.balance_cents) - cents;
  if (remaining === 0) await db.query(`update invoices set status = 'paid' where id = $1`, [inv.id]);
  if (flags.json) return console.log(JSON.stringify({ ref: inv.ref, paid_cents: cents, balance_cents: remaining, status: remaining === 0 ? 'paid' : 'sent' }, null, 2));
  console.log(`${inv.ref}: ${money(cents)} received (${method}). ${remaining === 0 ? 'Paid in full.' : `${money(remaining)} still owing.`}`);
}

async function cmdTakings(db, flags) {
  const days = num(flags.days) || 7;
  const rows = await db.query(
    `select practitioner, sum(visits) as visits, sum(takings_cents) as takings_cents
     from v_takings where on_date > current_date - ${days} and on_date <= current_date
     group by practitioner order by takings_cents desc`,
  );
  const total = rows.reduce((s, r) => s + num(r.takings_cents), 0);
  if (flags.json) return console.log(JSON.stringify({ days, rows, total_cents: total }, null, 2));
  console.log(heading(`Takings, last ${days} days`));
  console.log(table(rows, [
    { key: 'practitioner', label: 'practitioner' },
    { key: 'visits', label: 'visits', align: 'right' },
    { key: 'takings_cents', label: 'takings', align: 'right', format: (v) => money(v) },
  ]));
  console.log(`\n  total ${money(total)}`);
}

// ---------------------------------------------------------------------------
// The numbers

async function cmdRebooking(db, flags) {
  const rows = await db.query('select * from v_rebooking order by practitioner');
  const out = rows.map((r) => ({
    practitioner: r.practitioner,
    visits: num(r.visits),
    rebooked: num(r.rebooked),
    pct: num(r.visits) ? Math.round((100 * num(r.rebooked)) / num(r.visits)) : null,
  }));
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading('Rebooking, last 28 days'));
  console.log(table(out, [
    { key: 'practitioner', label: 'practitioner' },
    { key: 'visits', label: 'visits', align: 'right' },
    { key: 'rebooked', label: 'left with next appt', align: 'right' },
    { key: 'pct', label: '%', align: 'right', format: (v) => (v === null ? '' : `${v}%`) },
  ]));
  console.log('\n  A patient who leaves without their next appointment is a discharge nobody decided.');
}

async function cmdGaps(db, flags) {
  const days = num(flags.days) || 7;
  const out = [];
  for (let i = 1; i <= days; i++) {
    const onDate = addDays(today(), i);
    const weekday = new Date(`${onDate}T00:00:00`).getDay();
    const rows = await db.query(
      `select pr.name as practitioner, h.starts_at, h.ends_at,
              coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60), 0) as booked_minutes
       from practitioners pr
       join practitioner_hours h on h.practitioner_id = pr.id and h.weekday = $2
       left join appointments a on a.practitioner_id = pr.id and a.on_date = $1 and a.status in ('booked', 'confirmed')
       where pr.status = 'active'
       group by pr.name, h.starts_at, h.ends_at order by pr.name`,
      [onDate, weekday],
    );
    for (const r of rows) {
      const [sh, sm] = hhmm(r.starts_at).split(':').map(Number);
      const [eh, em] = hhmm(r.ends_at).split(':').map(Number);
      const window = eh * 60 + em - (sh * 60 + sm);
      out.push({
        on_date: onDate,
        practitioner: r.practitioner,
        window_minutes: window,
        booked_minutes: Math.round(num(r.booked_minutes)),
        open_minutes: Math.max(0, window - Math.round(num(r.booked_minutes))),
      });
    }
  }
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading(`The empty diary, next ${days} days`));
  console.log(table(out.filter((r) => r.open_minutes > 0), [
    { key: 'on_date', label: 'date' },
    { key: 'practitioner', label: 'practitioner' },
    { key: 'window_minutes', label: 'window', align: 'right', format: (v) => `${v}m` },
    { key: 'booked_minutes', label: 'booked', align: 'right', format: (v) => `${v}m` },
    { key: 'open_minutes', label: 'open', align: 'right', format: (v) => `${v}m` },
  ]));
  const waiting = await db.query(`select count(*) as n from waitlist where status = 'waiting'`);
  if (num(waiting[0].n)) console.log(`\n  ${waiting[0].n} patient(s) on the waitlist could fill this: waitlist`);
}

async function cmdDnas(db, flags) {
  const rows = await db.query('select * from v_dnas order by on_date desc');
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Did not attend, last 180 days'));
  console.log(table(rows, [
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'patient', label: 'patient' },
    { key: 'phone', label: 'phone' },
    { key: 'practitioner', label: 'practitioner' },
    { key: 'service', label: 'service', width: 30 },
    { key: 'price_cents', label: 'worth', align: 'right', format: (v) => money(v) },
    { key: 'dnas_180', label: 'habit', align: 'right', format: (v) => `${v} in 180d` },
  ]));
}

// ---------------------------------------------------------------------------
// Recalls, waitlist, referrers

async function cmdRecalls(db, flags) {
  const rows = await db.query('select * from v_recalls order by due_on');
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Open recalls'));
  console.log(table(rows, [
    { key: 'due_on', label: 'due', format: isoDate },
    { key: 'days_until', label: 'in', align: 'right', format: (v) => (num(v) < 0 ? `${-v}d overdue` : `${v}d`) },
    { key: 'patient', label: 'patient' },
    { key: 'phone', label: 'phone' },
    { key: 'reason', label: 'reason', width: 44 },
    { key: 'marketing_opt_in', label: 'contactable', format: (v) => (v === true ? 'yes' : v === false ? 'CALL ONLY' : 'ASK FIRST') },
  ]));
  if (rows.length) console.log('\n  A recall is clinical follow-up, not marketing; but recall MESSAGES still only draft to patients who opted in. The rest get a phone call.');
}

async function cmdRecallAdd(db, args, flags) {
  const patient = await resolvePatient(db, args[0]);
  const due = parseDate(flags.due, '--due');
  const reason = str(flags.reason);
  if (!due || !reason) throw new CliError('recall add PATIENT --due=DATE --reason="Orthotics annual review"');
  await db.query('insert into recalls (patient_id, due_on, reason) values ($1, $2, $3)', [patient.patient_id, due, reason]);
  if (flags.json) return console.log(JSON.stringify({ patient: patient.name, due_on: due, reason }, null, 2));
  console.log(`Recall set: ${patient.name}, ${due}, ${reason}.`);
}

async function cmdRecallDone(db, args, flags) {
  const patient = await resolvePatient(db, args[0]);
  const rows = await db.query(
    `update recalls set status = 'done' where id in (
       select id from recalls where patient_id = $1 and status = 'open' order by due_on limit 1
     ) returning reason`,
    [patient.patient_id],
  );
  if (!rows.length) throw new CliError(`${patient.name} has no open recall.`);
  if (flags.json) return console.log(JSON.stringify({ patient: patient.name, done: rows[0].reason }, null, 2));
  console.log(`Recall closed: ${patient.name}, ${rows[0].reason}.`);
}

async function cmdWaitlist(db, flags) {
  const rows = await db.query(
    `select w.id, w.added_on, (current_date - w.added_on) as waiting_days, w.note, w.status,
            p.name as patient, p.phone, s.name as service, pr.name as practitioner
     from waitlist w
     join patients p on p.id = w.patient_id
     left join services s on s.id = w.service_id
     left join practitioners pr on pr.id = w.practitioner_id
     where w.status = 'waiting' order by w.added_on`,
  );
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('The waitlist'));
  console.log(table(rows, [
    { key: 'patient', label: 'patient' },
    { key: 'phone', label: 'phone' },
    { key: 'service', label: 'wants', width: 30 },
    { key: 'practitioner', label: 'with', format: (v) => v || 'anyone' },
    { key: 'waiting_days', label: 'waiting', align: 'right', format: (v) => `${v}d` },
    { key: 'note', label: 'note', width: 40 },
  ]));
  if (rows.length) console.log('\n  Cross-check the empty diary: gaps');
}

async function cmdWaitlistAdd(db, args, flags) {
  const patient = await resolvePatient(db, args[0]);
  const service = flags.service ? await resolveService(db, flags.service) : null;
  const practitioner = flags.practitioner ? await resolvePractitioner(db, flags.practitioner) : null;
  await db.query(
    'insert into waitlist (patient_id, service_id, practitioner_id, note) values ($1, $2, $3, $4)',
    [patient.patient_id, service ? service.id : null, practitioner ? practitioner.id : null, str(flags.note) || null],
  );
  if (flags.json) return console.log(JSON.stringify({ patient: patient.name, waitlisted: true }, null, 2));
  console.log(`${patient.name} is on the waitlist${service ? ` for ${service.name}` : ''}${practitioner ? ` with ${practitioner.name}` : ''}.`);
}

async function cmdWaitlistRemove(db, args, flags) {
  const patient = await resolvePatient(db, args[0]);
  const rows = await db.query(
    `update waitlist set status = $2 where patient_id = $1 and status = 'waiting' returning id`,
    [patient.patient_id, flags.booked ? 'booked' : 'removed'],
  );
  if (!rows.length) throw new CliError(`${patient.name} is not on the waitlist.`);
  if (flags.json) return console.log(JSON.stringify({ patient: patient.name, status: flags.booked ? 'booked' : 'removed' }, null, 2));
  console.log(`${patient.name} off the waitlist${flags.booked ? ' (booked in)' : ''}.`);
}

async function cmdReferrers(db, flags) {
  const rows = await db.query('select * from v_referrers order by cases_referred desc, name');
  const out = rows.map((r) => ({
    name: r.name,
    practice: r.practice === r.name ? '' : r.practice || '',
    kind: r.kind,
    cases_referred: num(r.cases_referred),
    last_referral_on: isoDate(r.last_referral_on),
    days_quiet: r.days_quiet === null ? '' : num(r.days_quiet),
    state: num(r.cases_referred) >= 2 && num(r.days_quiet) > 60 ? 'GONE QUIET' : '',
  }));
  if (flags.json) return console.log(JSON.stringify(out, null, 2));
  console.log(heading('Referrers'));
  console.log(table(out, [
    { key: 'name', label: 'referrer' },
    { key: 'practice', label: 'practice' },
    { key: 'kind', label: 'kind' },
    { key: 'cases_referred', label: 'cases', align: 'right' },
    { key: 'last_referral_on', label: 'last referral' },
    { key: 'days_quiet', label: 'days ago', align: 'right' },
    { key: 'state', label: '' },
  ]));
  console.log('\n  A referrer who has gone quiet is a relationship, not a report line. A progress letter on a shared patient restarts most of them.');
}

async function cmdReferrerAdd(db, args, flags) {
  const name = args.join(' ').trim();
  if (!name) throw new CliError('referrer add NAME [--practice= --kind=gp|specialist|insurer|other --phone= --email=]');
  await db.query(
    'insert into referrers (name, practice, kind, phone, email) values ($1, $2, $3, $4, $5)',
    [name, str(flags.practice) || null, str(flags.kind) || 'gp', str(flags.phone) || null, str(flags.email) || null],
  );
  if (flags.json) return console.log(JSON.stringify({ name, created: true }, null, 2));
  console.log(`${name} added as a referrer.`);
}

// ---------------------------------------------------------------------------
// Team and services

async function cmdTeam(db, flags) {
  const rows = await db.query(
    `select p.*, (select string_agg(distinct h.starts_at || '-' || h.ends_at, ', ') from practitioner_hours h where h.practitioner_id = p.id) as hours
     from practitioners p ${flags.all ? '' : `where p.status = 'active'`} order by p.name`,
  );
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('The team'));
  console.log(table(rows, [
    { key: 'name', label: 'practitioner' },
    { key: 'discipline', label: 'discipline' },
    { key: 'registration_no', label: 'registration' },
    { key: 'hours', label: 'hours', width: 30, format: (v) => (v ? String(v).replace(/:00(?=[-,]|$)/g, '') : '') },
    { key: 'status', label: 'status' },
  ]));
}

async function cmdPractitionerAdd(db, args, flags) {
  const name = args.join(' ').trim();
  if (!name) throw new CliError('practitioner add NAME [--discipline= --registration=]');
  await db.query(
    'insert into practitioners (name, discipline, registration_no) values ($1, $2, $3)',
    [name, str(flags.discipline) || 'physiotherapist', str(flags.registration) || null],
  );
  if (flags.json) return console.log(JSON.stringify({ name, created: true }, null, 2));
  console.log(`${name} is on the team. Set their hours: practitioner hours "${name}" mon --start=8:00 --end=16:00`);
}

async function cmdPractitionerHours(db, args, flags) {
  const practitioner = await resolvePractitioner(db, args[0]);
  const dayArg = (args[1] || '').toLowerCase().slice(0, 3);
  if (!(dayArg in WEEKDAYS)) throw new CliError('Which day? practitioner hours NAME mon --start=8:00 --end=16:00 (or --clear)');
  const weekday = WEEKDAYS[dayArg];
  if (flags.clear) {
    await db.query('delete from practitioner_hours where practitioner_id = $1 and weekday = $2', [practitioner.id, weekday]);
    if (flags.json) return console.log(JSON.stringify({ practitioner: practitioner.name, weekday, cleared: true }, null, 2));
    return console.log(`${practitioner.name} no longer works ${args[1]}s.`);
  }
  const start = parseTime(flags.start, '--start');
  const end = parseTime(flags.end, '--end');
  if (!start || !end) throw new CliError('practitioner hours NAME DAY --start=8:00 --end=16:00');
  await db.query(
    `insert into practitioner_hours (practitioner_id, weekday, starts_at, ends_at) values ($1, $2, $3, $4)
     on conflict (practitioner_id, weekday) do update set starts_at = $3, ends_at = $4`,
    [practitioner.id, weekday, start, end],
  );
  if (flags.json) return console.log(JSON.stringify({ practitioner: practitioner.name, weekday, start, end }, null, 2));
  console.log(`${practitioner.name}: ${args[1]} ${start} to ${end}.`);
}

async function cmdServices(db, flags) {
  const rows = await db.query('select * from services where active order by discipline, price_cents desc');
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Services'));
  console.log(table(rows, [
    { key: 'name', label: 'service', width: 36 },
    { key: 'discipline', label: 'discipline' },
    { key: 'kind', label: 'kind' },
    { key: 'minutes', label: 'mins', align: 'right' },
    { key: 'price_cents', label: 'price', align: 'right', format: (v) => money(v) },
  ]));
}

async function cmdServiceAdd(db, args, flags) {
  const name = args.join(' ').trim();
  if (!name) throw new CliError('service add NAME --minutes=30 --price=85 [--discipline= --kind=initial|followup|other]');
  const minutes = num(flags.minutes);
  const priceCents = Math.round(Number(flags.price || 0) * 100);
  if (!minutes || !priceCents) throw new CliError('A service needs --minutes= and --price= (dollars).');
  await db.query(
    'insert into services (name, discipline, kind, minutes, price_cents) values ($1, $2, $3, $4, $5)',
    [name, str(flags.discipline) || null, str(flags.kind) || 'followup', minutes, priceCents],
  );
  if (flags.json) return console.log(JSON.stringify({ name, minutes, price_cents: priceCents }, null, 2));
  console.log(`${name} on the list: ${minutes} minutes, ${money(priceCents)}.`);
}

// ---------------------------------------------------------------------------
// Attention: everything that wants a decision, worst first

async function cmdAttention(db, flags) {
  const rows = [];
  const noteDueDays = num(await setting(db, 'note_due_days', '2'));
  const warnAt = num(await setting(db, 'funded_warn_remaining', '2'));
  const recallHorizon = num(await setting(db, 'recall_horizon_days', '7'));

  // [1] The clinical record. A completed visit without a finalised note is
  // the first thing a review, a funder audit or a court asks for.
  for (const r of await db.query('select * from v_notes_due order by on_date')) {
    rows.push({
      rank: 1, reason: 'note_missing', who: r.patient, ref: r.ref,
      detail: `${r.patient}'s ${r.service} with ${r.practitioner} on ${isoDate(r.on_date)} has ${r.note_state === 'missing' ? 'no treatment note at all' : 'a note still in draft'}${num(r.days_since) > noteDueDays ? `, ${r.days_since} days on` : ''}: the record standard is notes completed promptly, and an unwritten note is a visit that cannot be defended. Write it now: note add ${r.ref} then note final ${r.ref}`,
    });
  }

  // [1] Funded sessions at the line.
  for (const c of await db.query(
    `select * from v_cases where status = 'open' and approved_sessions is not null and sessions_remaining <= $1`,
    [warnAt <= 0 ? 0 : warnAt - 1],
  )) {
    const label = FUNDING_LABEL[c.funding] || c.funding;
    const fix = c.funding === 'acc' ? `lodge the ACC32 now, then: case extend ${c.ref} --sessions=N` : `arrange the next approval, then: case extend ${c.ref} --sessions=N`;
    rows.push({
      rank: 1, reason: 'funded_sessions', who: c.patient, ref: c.ref,
      detail: `${c.patient}'s ${label} (${c.ref}, ${c.title}) has ${num(c.sessions_used)} of ${num(c.approved_sessions)} sessions used and ${num(c.sessions_booked)} booked: ${num(c.sessions_remaining) <= 0 ? 'it is fully committed and nothing more books until the approval moves' : `${c.sessions_remaining} left`}. If care continues, ${fix}`,
    });
  }

  // [1] Consent missing on a case that has already been treated.
  for (const c of await db.query(
    `select * from v_cases where status = 'open' and consent_recorded_on is null and sessions_used > 0`,
  )) {
    rows.push({
      rank: 1, reason: 'consent_missing', who: c.patient, ref: c.ref,
      detail: `${c.patient}'s ${c.ref} (${c.title}) has ${c.sessions_used} completed visit(s) and no informed consent on record (Right 7, Code of Health and Disability Services Consumers' Rights). Nothing else completes on this case until it is recorded: case consent ${c.ref}`,
    });
  }

  // [2] The diary does not match what happened.
  for (const a of await db.query(
    `select * from v_appointments where status in ('booked', 'confirmed') and on_date < current_date order by on_date`,
  )) {
    rows.push({
      rank: 2, reason: 'not_completed', who: a.patient, ref: a.ref,
      detail: `${a.patient}'s ${a.service} with ${a.practitioner} on ${isoDate(a.on_date)} is still open in the diary: if they came, complete it (complete ${a.ref}); if they did not, mark it (dna ${a.ref}). An open visit is a note nobody wrote and money nobody billed.`,
    });
  }

  // [3] Unconfirmed inside the reminder window.
  const reminderDays = num(await setting(db, 'reminder_days', '1'));
  for (const a of await db.query(
    `select * from v_appointments where status = 'booked' and on_date between current_date and current_date + ${reminderDays} order by on_date, starts_at`,
  )) {
    rows.push({
      rank: 3, reason: 'unconfirmed', who: a.patient, ref: a.ref,
      detail: `${a.patient} is booked ${isoDate(a.on_date)} ${hhmm(a.starts_at)} for ${a.service} with ${a.practitioner} and has not confirmed: an unanswered reminder is how a DNA starts. Call, or draft the reminder: /draft-reminders`,
    });
  }

  // [4] Fresh DNAs.
  for (const d of await db.query('select * from v_dnas where on_date > current_date - 7 order by on_date desc')) {
    rows.push({
      rank: 4, reason: 'dna', who: d.patient, ref: d.ref,
      detail: `${d.patient} did not attend ${d.service} with ${d.practitioner} on ${isoDate(d.on_date)} (${d.dnas_180} DNA(s) in six months, this one worth ${money(d.price_cents)}). Call while it is fresh and rebook; if it is a habit, the cancellation policy conversation is fair.`,
    });
  }

  // [5] Money past due: patients first, then the funder lines everyone forgets.
  for (const i of await db.query(
    `select * from v_invoices where status = 'sent' and balance_cents > 0 and days_overdue > 0 order by days_overdue desc`,
  )) {
    rows.push({
      rank: 5, reason: i.payer === 'patient' ? 'overdue_invoice' : 'funder_unpaid', who: i.patient, ref: i.ref,
      detail: i.payer === 'patient'
        ? `${i.patient} owes ${money(i.balance_cents)} on ${i.ref}, ${i.days_overdue} days past due. A polite nudge now beats an awkward one later: /draft-reminders`
        : `${i.payer.toUpperCase()} owes ${money(i.balance_cents)} on ${i.ref} (${i.patient}${i.case_ref ? `, ${i.case_ref}` : ''}), ${i.days_overdue} days past due. Query the schedule; funder invoices do not pay themselves.`,
    });
  }

  // [6] Lapsed patients, worth the most first.
  for (const p of await db.query(
    `select * from v_patients where status = 'active' and lapsed order by spend_cents_12m desc`,
  )) {
    rows.push({
      rank: 6, reason: 'lapsed', who: p.name, ref: null,
      detail: `${p.name} is usually in every ${num(p.usual_gap_days)} days and has been quiet ${num(p.days_since_visit)} with nothing booked (${money(p.spend_cents_12m)} this year). ${p.marketing_opt_in === true ? 'Draft the recall: /draft-recall' : 'They have not opted in to messages: this one is a phone call.'}`,
    });
  }

  // [6] Recalls due.
  for (const r of await db.query(
    `select * from v_recalls where due_on <= current_date + ${recallHorizon} order by due_on`,
  )) {
    rows.push({
      rank: 6, reason: 'recall_due', who: r.patient, ref: null,
      detail: `${r.patient}'s recall is due ${isoDate(r.due_on)}: ${r.reason}. ${r.next_appt_on ? `Already booked ${isoDate(r.next_appt_on)}; close it: recall done "${r.patient}"` : 'Nothing booked yet. Book them in, then: recall done "' + r.patient + '"'}`,
    });
  }

  // [7] The waitlist against the empty diary.
  for (const w of await db.query(
    `select w.*, p.name as patient, s.name as service from waitlist w
     join patients p on p.id = w.patient_id left join services s on s.id = w.service_id
     where w.status = 'waiting' order by w.added_on`,
  )) {
    rows.push({
      rank: 7, reason: 'waitlist', who: w.patient, ref: null,
      detail: `${w.patient} has waited ${Math.max(0, Math.round((Date.parse(today()) - Date.parse(isoDate(w.added_on))) / 86400000))} days${w.service ? ` for ${w.service}` : ''}${w.note ? ` (${w.note})` : ''}. The diary has open time this week: gaps, then book add.`,
    });
  }

  // [7] Referrers gone quiet.
  for (const r of await db.query(
    `select * from v_referrers where cases_referred >= 2 and days_quiet > 60 order by days_quiet desc`,
  )) {
    rows.push({
      rank: 7, reason: 'referrer_quiet', who: r.name, ref: null,
      detail: `${r.name}${r.practice && r.practice !== r.name ? ` (${r.practice})` : ''} has referred ${r.cases_referred} cases and sent nothing in ${r.days_quiet} days. A progress letter on a shared patient restarts most referrers: /draft-gp-letter`,
    });
  }

  rows.sort((a, b) => a.rank - b.rank);
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Needs a decision, worst first'));
  if (!rows.length) return console.log('  Nothing. A quiet list is the system working.');
  for (const r of rows) {
    console.log(`\n  [${r.rank}] ${r.reason}  ${r.who}${r.ref ? `  ${r.ref}` : ''}`);
    console.log(`      ${r.detail}`);
  }
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records, sources cited

async function cmdCompliance(db, args, flags) {
  const noteDueDays = num(await setting(db, 'note_due_days', '2'));
  const checks = [];

  const notesLate = await db.query(`select * from v_notes_due where days_since > ${noteDueDays}`);
  checks.push({
    rule: 'records',
    name: 'Treatment notes finalised promptly',
    source: 'Physiotherapy Board of New Zealand, Physiotherapy standards (record keeping); Ahpra boards\' codes of conduct s 10.5 (health records); docs/compliance.md',
    ok: notesLate.length === 0,
    found: notesLate.length ? `${notesLate.length} completed visit(s) past the ${noteDueDays}-day line: ${notesLate.map((r) => `${r.ref} (${r.patient}, ${r.note_state})`).join(', ')}` : 'every completed visit has a finalised note inside the window',
  });

  const noConsent = await db.query(`select * from v_cases where status = 'open' and consent_recorded_on is null and sessions_used > 0`);
  checks.push({
    rule: 'consent',
    name: 'Informed consent recorded per episode of care',
    source: 'Code of Health and Disability Services Consumers\' Rights 1996, Right 7 (NZ); Ahpra codes of conduct (informed consent); docs/compliance.md',
    ok: noConsent.length === 0,
    found: noConsent.length ? `${noConsent.length} treated case(s) with no consent on record: ${noConsent.map((c) => c.ref).join(', ')}` : 'every treated case has consent recorded',
  });

  const overFunded = await db.query(
    `select * from v_cases where status = 'open' and approved_sessions is not null and sessions_used + sessions_booked > approved_sessions`,
  );
  const atLine = await db.query(
    `select * from v_cases where status = 'open' and approved_sessions is not null and sessions_used + sessions_booked = approved_sessions`,
  );
  checks.push({
    rule: 'funded-sessions',
    name: 'Funded care stays inside its approval',
    source: 'ACC treatment provider requirements (ACC32 for further treatment); MBS chronic disease management items 10950 to 10970, five allied health services per calendar year; docs/compliance.md',
    ok: overFunded.length === 0,
    found: overFunded.length
      ? `${overFunded.length} case(s) committed past their approval: ${overFunded.map((c) => `${c.ref} (${num(c.sessions_used) + num(c.sessions_booked)} of ${c.approved_sessions})`).join(', ')}`
      : atLine.length
        ? `no case is past its approval; ${atLine.map((c) => `${c.ref} is fully committed (${c.approved_sessions} of ${c.approved_sessions})`).join(', ')}: start the next approval now if care continues`
        : 'every funded case has sessions in hand',
  });

  const emptyDischarge = await db.query(
    `select c.ref from cases c where c.status = 'discharged'
     and not exists (select 1 from treatment_notes tn where tn.case_id = c.id)
     and exists (select 1 from appointments a where a.case_id = c.id and a.status = 'completed' and not a.imported)`,
  );
  checks.push({
    rule: 'retention',
    name: 'The clinical record survives discharge and archive',
    source: 'Health (Retention of Health Information) Regulations 1996 (NZ): minimum 10 years; state health records Acts (AU): 7 years, or age 25 for children; docs/compliance.md',
    ok: emptyDischarge.length === 0,
    found: emptyDischarge.length ? `${emptyDischarge.length} discharged case(s) hold no notes: ${emptyDischarge.map((c) => c.ref).join(', ')}` : 'nothing deletes here: discharged cases and archived patients keep their notes',
  });

  const neverAsked = await db.query(
    `select count(*) as n from v_patients where status = 'active' and marketing_opt_in is null and last_visit_on is not null`,
  );
  checks.push({
    rule: 'marketing-consent',
    name: 'Marketing only ever addresses patients who opted in',
    source: 'Unsolicited Electronic Messages Act 2007 (NZ); Spam Act 2003 (Cth); Privacy Act 2020 (NZ) / Privacy Act 1988 (Cth); docs/compliance.md',
    ok: true,
    found: `recall and marketing drafts filter on the opt-in; ${num(neverAsked[0].n)} active patient(s) with visits have never been asked: ask at the desk, then patient set NAME --opt-in=yes|no`,
  });

  const noReason = await db.query(`select count(*) as n from appointments where status = 'cancelled' and (cancel_reason is null or cancel_reason = '')`);
  checks.push({
    rule: 'cancellations',
    name: 'Every cancellation and DNA keeps its record and reason',
    source: 'Professional record-keeping standards (the appointment record is part of the health record); docs/compliance.md',
    ok: num(noReason[0].n) === 0,
    found: num(noReason[0].n) ? `${noReason[0].n} cancellation(s) carry no reason` : 'every cancellation carries its reason; DNAs are marked, never erased',
  });

  const wanted = args[0] ? checks.filter((c) => c.rule === args[0]) : checks;
  if (!wanted.length) throw new CliError(`No rule "${args[0]}". Rules: ${checks.map((c) => c.rule).join(', ')}`);
  if (flags.json) return console.log(JSON.stringify(wanted, null, 2));
  console.log(heading('The rule book, run against the records'));
  for (const c of wanted) {
    console.log(`\n  ${c.ok ? 'PASS' : 'FAIL'}  ${c.rule}: ${c.name}`);
    console.log(`        ${c.found}`);
    console.log(`        source: ${c.source}`);
  }
}

// ---------------------------------------------------------------------------
// Settings

async function cmdSettings(db, args, flags) {
  if ((args[0] || '').toLowerCase() === 'set') {
    const [, key, ...valueParts] = args;
    const value = valueParts.join(' ');
    if (!key || !value) throw new CliError('settings set KEY VALUE');
    const updated = await db.query('update settings set value = $2 where key = $1 returning key', [key, value]);
    if (!updated.length) throw new CliError(`No setting "${key}". See: settings`);
    if (flags.json) return console.log(JSON.stringify({ key, value }, null, 2));
    return console.log(`${key} = ${value}`);
  }
  const rows = await db.query('select key, value, note from settings order by key');
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  console.log(heading('Settings'));
  console.log(table(rows, [
    { key: 'key', label: 'key' },
    { key: 'value', label: 'value' },
    { key: 'note', label: 'what it does', width: 60 },
  ]));
}

// ---------------------------------------------------------------------------
// Import from Cliniko (or any clinic system that exports CSV)

async function cmdImport(db, args, flags) {
  const source = (args[0] || 'cliniko').toLowerCase();
  const patientsFile = str(flags.patients);
  const apptsFile = str(flags.appointments);
  if (!patientsFile && !apptsFile) {
    throw new CliError(`import ${source} --patients=Patients.csv [--appointments=Appointments.csv] [--dry-run]\nExport both from ${source === 'cliniko' ? 'Cliniko: Settings, Data exports' : 'the old system'} first.`);
  }
  const dryRun = Boolean(flags['dry-run']);
  const created = [];
  const updated = [];
  const skipped = [];

  const patientIds = new Map(); // lower(name) -> id
  for (const r of await db.query('select id, name from patients')) patientIds.set(r.name.toLowerCase(), r.id);
  const practitionerIds = new Map();
  for (const r of await db.query(`select id, name from practitioners where status = 'active'`)) practitionerIds.set(r.name.toLowerCase(), r.id);
  const services = new Map();
  for (const r of await db.query('select id, name, minutes, price_cents from services where active')) services.set(r.name.toLowerCase(), r);

  if (patientsFile) {
    if (!existsSync(patientsFile)) throw new CliError(`No file at ${patientsFile}.`);
    const rows = parseCsv(readFileSync(patientsFile, 'utf8'));
    for (const row of rows) {
      const first = pick(row, 'first name', 'firstname', 'given name');
      const last = pick(row, 'last name', 'lastname', 'surname', 'family name');
      const name = (first || last ? `${first || ''} ${last || ''}` : pick(row, 'name', 'patient name', 'full name') || '').trim().replace(/\s+/g, ' ');
      if (!name) { skipped.push({ what: 'patient', why: 'row with no name' }); continue; }
      const phone = pick(row, 'phone number', 'phone', 'mobile', 'mobile phone', 'phone numbers') || null;
      const email = pick(row, 'email', 'email address') || null;
      let dob = null;
      const dobRaw = pick(row, 'date of birth', 'dob', 'birthday');
      if (dobRaw) { try { dob = parseDate(dobRaw, 'date of birth'); } catch { skipped.push({ what: 'patient', why: `${name}: unreadable date of birth "${dobRaw}" (kept the rest)` }); } }
      const referral = pick(row, 'referral source', 'referrer', 'source') || null;
      const existingId = patientIds.get(name.toLowerCase());
      if (existingId) {
        if (!dryRun) {
          await db.query(
            `update patients set phone = coalesce(phone, $2), email = coalesce(email, $3),
             date_of_birth = coalesce(date_of_birth, $4), referral_source = coalesce(referral_source, $5) where id = $1`,
            [existingId, phone, email, dob, referral],
          );
        }
        updated.push({ what: 'patient', name });
      } else {
        if (!dryRun) {
          const [ins] = await db.query(
            `insert into patients (name, phone, email, date_of_birth, referral_source, marketing_opt_in)
             values ($1, $2, $3, $4, $5, null) returning id`,
            [name, phone, email, dob, referral],
          );
          patientIds.set(name.toLowerCase(), ins.id);
        } else {
          patientIds.set(name.toLowerCase(), 'dry-run');
        }
        created.push({ what: 'patient', name });
      }
    }
  }

  if (apptsFile) {
    if (!existsSync(apptsFile)) throw new CliError(`No file at ${apptsFile}.`);
    const rows = parseCsv(readFileSync(apptsFile, 'utf8'));
    for (const row of rows) {
      const patientName = (pick(row, 'patient name', 'patient', 'client name', 'name') || '').trim();
      if (!patientName) { skipped.push({ what: 'appointment', why: 'row with no patient name' }); continue; }
      const startsRaw = pick(row, 'starts at', 'appointment start', 'start', 'date') || '';
      const dateOnly = startsRaw.match(/^(\d{4}-\d{2}-\d{2})[T ]?(\d{2}:\d{2})?/);
      let onDate = null;
      let atTime = null;
      try {
        if (dateOnly) { onDate = dateOnly[1]; atTime = dateOnly[2] || null; }
        else if (startsRaw) onDate = parseDate(startsRaw, 'appointment date');
      } catch { /* named below */ }
      if (!atTime) atTime = parseTime(pick(row, 'start time', 'time'), 'start time') || '09:00';
      if (!onDate) { skipped.push({ what: 'appointment', why: `${patientName}: missing date (start column empty or unreadable)` }); continue; }
      const practitionerName = (pick(row, 'practitioner name', 'practitioner', 'staff member') || '').trim();
      const practitionerId = practitionerIds.get(practitionerName.toLowerCase());
      if (!practitionerId) { skipped.push({ what: 'appointment', why: `${patientName} ${onDate}: practitioner "${practitionerName || '(blank)'}" is not on the team (practitioner add, then re-run)` }); continue; }

      let patientId = patientIds.get(patientName.toLowerCase());
      if (!patientId) {
        if (!dryRun) {
          const [ins] = await db.query('insert into patients (name, marketing_opt_in) values ($1, null) returning id', [patientName]);
          patientId = ins.id;
        } else patientId = 'dry-run';
        patientIds.set(patientName.toLowerCase(), patientId);
        created.push({ what: 'patient', name: patientName });
      }

      const serviceName = (pick(row, 'appointment type', 'service', 'type') || 'Consultation').trim();
      let service = services.get(serviceName.toLowerCase());
      if (!service) {
        const minutes = num(pick(row, 'duration (mins)', 'duration', 'minutes')) || 30;
        const priceCents = Math.round(Number(pick(row, 'price', 'amount') || 0) * 100);
        if (!dryRun) {
          const [ins] = await db.query(
            'insert into services (name, minutes, price_cents, kind) values ($1, $2, $3, $4) returning id, name, minutes, price_cents',
            [serviceName, minutes, priceCents, 'other'],
          );
          service = ins;
        } else service = { id: 'dry-run', name: serviceName, minutes, price_cents: priceCents };
        services.set(serviceName.toLowerCase(), service);
        created.push({ what: 'service', name: serviceName });
      }

      if (patientId !== 'dry-run') {
        const dupe = await db.query(
          'select 1 from appointments where patient_id = $1 and practitioner_id = $2 and on_date = $3 and starts_at = $4',
          [patientId, practitionerId, onDate, atTime],
        );
        if (dupe.length) { continue; } // already here from a previous run
      }
      const status = onDate < today() ? 'completed' : 'booked';
      if (!dryRun) {
        const ref = await mintRef(db, 'appointments', 'APT', 1001);
        await db.query(
          `insert into appointments (ref, patient_id, practitioner_id, service_id, on_date, starts_at, ends_at, status, price_cents, imported)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
          [ref, patientId, practitionerId, service.id, onDate, atTime, addMinutes(atTime, num(service.minutes) || 30), status, num(service.price_cents)],
        );
      }
      created.push({ what: 'appointment', name: `${patientName} ${onDate} ${atTime} (${status})` });
    }
  }

  const result = { source, dry_run: dryRun, created, updated, skipped };
  if (flags.json) return console.log(JSON.stringify(result, null, 2));
  console.log(heading(dryRun ? `Import from ${source} (dry run, nothing written)` : `Imported from ${source}`));
  console.log(`  created: ${created.length}  matched and updated: ${updated.length}  skipped: ${skipped.length}`);
  for (const s of skipped) console.log(`    skipped ${s.what}: ${s.why}`);
  console.log(`\n  Imported patients arrive with the marketing question UNANSWERED, and imported history carries no notes here:`);
  console.log(`  the old system's clinical notes live in its own export, kept for the retention period. docs/replace-cliniko.md has the whole story.`);
  if (dryRun) console.log('\n  Run it again without --dry-run to write.');
}

// ---------------------------------------------------------------------------
// Export: your data, out, any time

async function cmdExport(db, flags) {
  const outDir = path.resolve(str(flags.out) || path.join(REPO_ROOT, 'export'));
  mkdirSync(outDir, { recursive: true });
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? isoDate(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => {
    if (!rows.length) return '\n';
    const cols = Object.keys(rows[0]);
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  };
  const files = [
    ['patients.csv', `select name, date_of_birth, phone, email, nhi, referral_source, marketing_opt_in, alerts, status from patients order by name`],
    ['appointments.csv', `select ref, on_date, starts_at, ends_at, patient, practitioner, service, case_ref, status, cancel_reason, price_cents from v_appointments order by on_date, starts_at`],
    ['cases.csv', `select ref, patient, title, funding, claim_number, injury_date, approved_sessions, sessions_used, consent_recorded_on, status, opened_on, discharged_on from v_cases order by ref`],
    ['treatment-notes.csv', `select a.ref as appointment, tn.on_date, p.name as patient, pr.name as practitioner, tn.subjective, tn.objective, tn.assessment, tn.plan, tn.addendum, tn.status from treatment_notes tn join appointments a on a.id = tn.appointment_id join patients p on p.id = tn.patient_id join practitioners pr on pr.id = tn.practitioner_id order by tn.on_date`],
    ['invoices.csv', `select ref, patient, payer, issued_on, due_on, total_cents, paid_cents, balance_cents, status from v_invoices order by issued_on`],
    ['payments.csv', `select i.ref as invoice, pm.on_date, pm.amount_cents, pm.method from payments pm join invoices i on i.id = pm.invoice_id order by pm.on_date`],
  ];
  const written = [];
  for (const [file, sql] of files) {
    const rows = await db.query(sql);
    writeFileSync(path.join(outDir, file), toCsv(rows));
    written.push({ file, rows: rows.length });
  }
  if (flags.json) return console.log(JSON.stringify({ out: outDir, written }, null, 2));
  console.log(heading('Exported'));
  for (const w of written) console.log(`  ${w.file}  ${w.rows} rows`);
  console.log(`\n  ${outDir}\n  Your data was never locked in; this just proves it.`);
}

// ---------------------------------------------------------------------------
// Stats: one JSON of the numbers the smoke test and the weekly review lean on

async function cmdStats(db, flags) {
  const one = async (sql) => (await db.query(sql))[0];
  const s = {
    active_patients: num((await one(`select count(*) as n from patients where status = 'active'`)).n),
    practitioners: num((await one(`select count(*) as n from practitioners where status = 'active'`)).n),
    open_cases: num((await one(`select count(*) as n from cases where status = 'open'`)).n),
    booked_ahead: num((await one(`select count(*) as n from appointments where status in ('booked','confirmed') and on_date >= current_date`)).n),
    unconfirmed_soon: num((await one(`select count(*) as n from appointments where status = 'booked' and on_date between current_date and current_date + 1`)).n),
    not_completed: num((await one(`select count(*) as n from appointments where status in ('booked','confirmed') and on_date < current_date`)).n),
    notes_missing: num((await one(`select count(*) as n from v_notes_due`)).n),
    funded_at_limit: num((await one(`select count(*) as n from v_cases where status = 'open' and approved_sessions is not null and sessions_remaining <= 0`)).n),
    consent_missing: num((await one(`select count(*) as n from v_cases where status = 'open' and consent_recorded_on is null and sessions_used > 0`)).n),
    dnas_30: num((await one(`select count(*) as n from appointments where status = 'dna' and on_date > current_date - 30`)).n),
    lapsed: num((await one(`select count(*) as n from v_patients where status = 'active' and lapsed`)).n),
    recalls_due: num((await one(`select count(*) as n from v_recalls where due_on <= current_date + 7`)).n),
    waitlist: num((await one(`select count(*) as n from waitlist where status = 'waiting'`)).n),
    referrers_quiet: num((await one(`select count(*) as n from v_referrers where cases_referred >= 2 and days_quiet > 60`)).n),
    debtors_cents: num((await one(`select coalesce(sum(balance_cents), 0) as n from v_invoices where payer = 'patient' and status = 'sent' and balance_cents > 0 and days_overdue > 0`)).n),
    funder_unpaid_cents: num((await one(`select coalesce(sum(balance_cents), 0) as n from v_invoices where payer in ('acc','insurer') and status = 'sent' and balance_cents > 0`)).n),
    takings_7d_cents: num((await one(`select coalesce(sum(takings_cents), 0) as n from v_takings where on_date > current_date - 7 and on_date <= current_date`)).n),
  };
  const rb = await db.query('select sum(visits) as v, sum(rebooked) as r from v_rebooking');
  s.rebooking_pct_28 = num(rb[0]?.v) ? Math.round((100 * num(rb[0].r)) / num(rb[0].v)) : null;
  if (flags.json) return console.log(JSON.stringify(s, null, 2));
  console.log(heading('The clinic at a glance'));
  for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(22)} ${k.endsWith('_cents') ? money(v) : v}`);
}

// ---------------------------------------------------------------------------
// Help

function help() {
  console.log(`allied-health-for-claude-code: the clinic's operating record as one CLI.

  the diary
    day [--date=]                            the day sheet, per practitioner
    book [--day=DATE] [--practitioner=]      the diary, the week ahead by default
    book add PATIENT PRACTITIONER --service= --date= --at= [--case=CASE-1 --note=]
    confirm REF        cancel REF --reason=        dna REF
    complete REF [--no-invoice]              completed visit + invoice, then the note

  the clinical record
    note add REF [--s= --o= --a= --p=]       the SOAP note, draft until final
    note final REF                           after this it never changes
    note addendum REF "..."                  the only way to touch a final note
    notes PATIENT      notes-due             what is not finalised, oldest first

  patients and cases
    patients [--lapsed]    patient NAME      lapsed
    patient add NAME [--phone= --email= --dob= --nhi= --alerts= --opt-in=yes|no]
    patient set NAME [--phone= --opt-in=yes|no --alerts= --archive]
    log PATIENT "what was said" [--author=]
    cases [--all]      case CASE-1
    case add PATIENT --title= [--funding=acc|epc|insurer|private --claim= --sessions= --injury= --referrer= --consent]
    case consent CASE-1 [--on=]              informed consent, Right 7
    case extend CASE-1 --sessions=N [--note=]   the ACC32 outcome / new care plan
    case discharge CASE-1 [--note=]

  money
    invoices [--unpaid]    debtors           who owes, patients and funders
    pay INV-1 --amount=85 [--method= --on=]
    takings [--days=7]

  the numbers
    rebooking          who leaves holding their next appointment
    gaps [--days=7]    the empty diary
    dnas               the habit, named

  recalls, waitlist, referrers
    recalls            recall add PATIENT --due= --reason=      recall done PATIENT
    waitlist           waitlist add PATIENT [--service= --practitioner= --note=]
    waitlist remove PATIENT [--booked]
    referrers          referrer add NAME [--practice= --kind= --phone= --email=]

  team and services
    team [--all]       practitioner add NAME [--discipline= --registration=]
    practitioner hours NAME DAY --start= --end= | DAY --clear
    services           service add NAME --minutes= --price= [--discipline= --kind=]

  the rules
    attention          everything that wants a decision, worst first
    compliance [RULE]  the rule book, run against the records, sources cited
    settings [set KEY VALUE]

  moving in and out
    import cliniko --patients=FILE [--appointments=FILE] [--dry-run]
    export [--out=DIR]           stats

Any read command takes --json. Money in NZD. There are no force flags.`);
}

// ---------------------------------------------------------------------------
// Main

const { args: argv, flags } = parseArgv(process.argv.slice(2));
const [cmd, ...rest] = argv;

const db = await getDb();
try {
  switch ((cmd || 'help').toLowerCase()) {
    case 'help': help(); break;
    case 'day': await cmdDay(db, flags); break;
    case 'book': {
      if ((rest[0] || '').toLowerCase() === 'add') await cmdBookAdd(db, rest.slice(1), flags);
      else await cmdBook(db, flags);
      break;
    }
    case 'confirm': await cmdConfirm(db, rest, flags); break;
    case 'cancel': await cmdCancel(db, rest, flags); break;
    case 'dna': await cmdDna(db, rest, flags); break;
    case 'complete': await cmdComplete(db, rest, flags); break;
    case 'note': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdNoteAdd(db, rest.slice(1), flags);
      else if (sub === 'final') await cmdNoteFinal(db, rest.slice(1), flags);
      else if (sub === 'addendum') await cmdNoteAddendum(db, rest.slice(1), flags);
      else throw new CliError('note add|final|addendum REF (lists: notes PATIENT, notes-due)');
      break;
    }
    case 'notes': await cmdNotes(db, rest, flags); break;
    case 'notes-due': await cmdNotesDue(db, flags); break;
    case 'patients': await cmdPatients(db, flags); break;
    case 'lapsed': await cmdPatients(db, { ...flags, lapsed: true }); break;
    case 'patient': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdPatientAdd(db, rest.slice(1), flags);
      else if (sub === 'set') await cmdPatientSet(db, rest.slice(1), flags);
      else await cmdPatient(db, rest, flags);
      break;
    }
    case 'log': await cmdLog(db, rest, flags); break;
    case 'cases': await cmdCases(db, flags); break;
    case 'case': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdCaseAdd(db, rest.slice(1), flags);
      else if (sub === 'consent') await cmdCaseConsent(db, rest.slice(1), flags);
      else if (sub === 'extend') await cmdCaseExtend(db, rest.slice(1), flags);
      else if (sub === 'discharge') await cmdCaseDischarge(db, rest.slice(1), flags);
      else await cmdCaseShow(db, rest, flags);
      break;
    }
    case 'invoices': await cmdInvoices(db, flags); break;
    case 'debtors': await cmdDebtors(db, flags); break;
    case 'pay': await cmdPay(db, rest, flags); break;
    case 'takings': await cmdTakings(db, flags); break;
    case 'rebooking': await cmdRebooking(db, flags); break;
    case 'gaps': await cmdGaps(db, flags); break;
    case 'dnas': await cmdDnas(db, flags); break;
    case 'recalls': await cmdRecalls(db, flags); break;
    case 'recall': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdRecallAdd(db, rest.slice(1), flags);
      else if (sub === 'done') await cmdRecallDone(db, rest.slice(1), flags);
      else throw new CliError('recall add|done PATIENT (list: recalls)');
      break;
    }
    case 'waitlist': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdWaitlistAdd(db, rest.slice(1), flags);
      else if (sub === 'remove') await cmdWaitlistRemove(db, rest.slice(1), flags);
      else await cmdWaitlist(db, flags);
      break;
    }
    case 'referrers': await cmdReferrers(db, flags); break;
    case 'referrer': {
      if ((rest[0] || '').toLowerCase() !== 'add') throw new CliError('referrer add NAME [--practice= --kind=] (list: referrers)');
      await cmdReferrerAdd(db, rest.slice(1), flags);
      break;
    }
    case 'team': await cmdTeam(db, flags); break;
    case 'practitioner': {
      const sub = (rest[0] || '').toLowerCase();
      if (sub === 'add') await cmdPractitionerAdd(db, rest.slice(1), flags);
      else if (sub === 'hours') await cmdPractitionerHours(db, rest.slice(1), flags);
      else throw new CliError('practitioner add|hours (list: team)');
      break;
    }
    case 'services': await cmdServices(db, flags); break;
    case 'service': {
      if ((rest[0] || '').toLowerCase() !== 'add') throw new CliError('service add NAME --minutes= --price= (list: services)');
      await cmdServiceAdd(db, rest.slice(1), flags);
      break;
    }
    case 'attention': await cmdAttention(db, flags); break;
    case 'compliance': await cmdCompliance(db, rest, flags); break;
    case 'settings': await cmdSettings(db, rest, flags); break;
    case 'import': await cmdImport(db, rest, flags); break;
    case 'export': await cmdExport(db, flags); break;
    case 'stats': await cmdStats(db, flags); break;
    default:
      throw new CliError(`Unknown command "${cmd}". Run with no arguments for the list.`);
  }
} catch (e) {
  if (e instanceof CliError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    throw e;
  }
} finally {
  await db.close();
}
