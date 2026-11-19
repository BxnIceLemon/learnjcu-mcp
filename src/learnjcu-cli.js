#!/usr/bin/env node
// LearnJCU command-line client for submitting to Ultra assignments. Like the
// a submission shows what it will send and asks first.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import * as mv from './learnjcu.js';
import * as mvWrite from './learnjcu-write.js';
import * as mystudent from './mystudent.js';
import * as studentfirst from './studentfirst.js';
import { SessionError } from './client.js';
import { loadSession } from './session.js';
import { listAccounts, accountInfo, selectAccount, currentAccount, AccountChoiceError, SERVICES } from './accounts.js';
import { login, LABELS } from './auth.js';
import { runLoginCli, loginOptions, loginService, chooseAccountCli, LOGIN_OPTIONS } from './login-cli.js';

const HELP = `Usage: learnjcu <command> [options]

Account
  login                                   Sign in to LearnJCU in a browser window
      [--new-account] signs in someone else and saves them as another account
      [--service mystudent|studentfirst] signs in to MyStudent or StudentFirst instead
  status                                  Show whether you are signed in
  accounts                                List saved accounts

Browse LearnJCU
  upcoming [--days N]                     Gradebook items due in the next N days (default 14)
  submissions <course> <assignment>       Settings of an assignment and your attempts on it

Browse MyStudent
  mystudent                               Dashboard: details, study plan, payments, tasks, forms
  mystudent <page> [section]              Read a page in full: details, study, class_registrations,
                                          finances, tasks, calendar, forms, form_responses, applications
  study-plan                              Your course and the status of every subject in it

Browse StudentFirst (JCU Singapore)
  classes                                 Classes in the next 8 days and overall attendance
  attendance [class]                      Every session of your classes and whether you attended
  leave                                   Your leave applications

Actions (ask for confirmation)
  submit <course> <assignment> [file...] [-m TEXT] [--dry-run] [--yes]
      Submit files (and optional text) to an Ultra assignment as a new attempt

Options
  --account NAME    Use this saved account (or set LEARNJCU_ACCOUNT); with
                    several accounts you are asked which one otherwise
  --json            Print raw JSON
  -h, --help        Show this help

<course> is a course id (_123456_1), a subject code (BU2001) or a full code. <assignment> is a
unique part of its title ("CW2"), or its content or column id.`;

const options = {
  ...LOGIN_OPTIONS,
  days: { type: 'string' },
  message: { type: 'string', short: 'm' },
  'dry-run': { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

class UsageError extends Error {}

const REPORT_ONLY = new Set(['status', 'accounts']);

function need(args, n, usage) {
  if (args.length < n) throw new UsageError(`Usage: learnjcu ${usage}`);
}

function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) throw new UsageError('Refusing to continue without a terminal to confirm in; pass --yes');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const commands = {
  async login(_, o) {
    const service = loginService(o);
    const opts = { ...loginOptions(o), ...(await chooseAccountCli(o, { login: service === 'learnjcu' })) };
    if ((await runLoginCli(service, opts)) !== 0) throw new Error('Login was not completed');
  },

  async status(_, o) {
    let account;
    try {
      account = currentAccount();
    } catch (e) {
      if (!(e instanceof AccountChoiceError)) throw e;
      return commands.accounts(_, o);
    }
    const s = loadSession();
    if (o.json) return s ? { account, signedIn: true, userName: s.userName, expiresAt: s.expiresAt } : { account, signedIn: false };
    console.log(s ? `Signed in as ${s.userName ?? 'unknown'} (account ${account}); session valid until about ${fmtDate(s.expiresAt)}` : 'Not signed in. Run: learnjcu login');
  },

  async accounts(_, o) {
    const all = listAccounts().map(accountInfo);
    if (o.json) return all;
    if (!all.length) return console.log('No saved accounts. Run: learnjcu login');
    for (const a of all) {
      const m = SERVICES.map((s) => {
        const x = a[s];
        if (!x.signedIn) return `${LABELS[s]} not signed in`;
        return x.expiresAt ? `${LABELS[s]} until ${fmtDate(x.expiresAt)}` : `${LABELS[s]} signed in`;
      }).join(';  ');
      console.log(`${a.account}${a.displayName && a.displayName !== a.account ? `  ${a.displayName}` : ''}  ${m}`);
    }
  },

  async upcoming(_, o) {
    const r = await mv.upcomingDeadlines({ days: o.days ? Number(o.days) : 14 });
    if (o.json) return r;
    if (!r.items.length) return console.log('Nothing due.');
    for (const i of r.items) console.log(`${fmtDate(i.due)}  ${i.item}  (${i.course})${i.status ? `  [${i.status}]` : ''}`);
  },

  async mystudent(args, o) {
    if (args.length) {
      const r = await mystudent.readPage({ page: args[0], section: args[1] });
      if (o.json) return r;
      console.log(r.title);
      for (const l of r.header ?? []) console.log(l);
      for (const l of r.lines ?? []) console.log(`  ${l}`);
      for (const sec of r.sections ?? []) {
        console.log(`\n[${sec.section}]`);
        for (const l of sec.lines) console.log(`  ${l}`);
      }
      return;
    }
    const r = await mystudent.overview();
    if (o.json) return r;
    for (const t of r.tiles) {
      console.log(`${t.tile}${t.headline ? `: ${t.count !== undefined ? `${t.count} ` : ''}${t.headline}` : ''}`);
      for (const tab of t.tabs) {
        if (!tab.items) continue;
        if (t.tabs.length > 1) console.log(`  ${tab.tab}`);
        for (const it of tab.items) console.log(`    ${[it.header, ...(it.lines ?? [])].filter(Boolean).join(' — ')}`);
      }
    }
  },

  async 'study-plan'(_, o) {
    const r = await mystudent.studyPlan();
    if (o.json) return r;
    console.log(`${r.course} (${[r.creditPoints, r.campus].filter(Boolean).join(', ')})`);
    if (r.advancedStandingCreditPoints) console.log(`Advanced standing: ${r.advancedStandingCreditPoints} credit points`);
    for (const s of r.subjects) console.log(`  ${s.code}  ${s.name}  [${s.kind}] ${s.status}`);
  },

  async classes(_, o) {
    const r = await studentfirst.overview();
    if (o.json) return r;
    const a = r.attendance;
    console.log(`Class attendance ${a.class.percent}%, campus attendance ${a.campus.percent}% (minimum ${a.class.minimum ?? 90}%; updated ${a.lastUpdated ?? '?'})`);
    if (!r.upcoming.length) return console.log('No classes in the next 8 days.');
    for (const c of r.upcoming) console.log(`  ${c.date}  ${c.time}  ${c.class}  ${c.location}`);
  },

  async attendance(args, o) {
    const r = await studentfirst.classAttendance({ classCode: args[0] });
    if (o.json) return r;
    for (const c of r.classes) {
      console.log(`${c.class}  ${c.title}: ${c.present}/${c.total - c.notRecorded} recorded sessions attended${c.absent ? `, ${c.absent} absent` : ''}`);
      for (const s of c.sessions) if (s.status === 'absent') console.log(`    absent ${s.date} ${s.time} ${s.location ?? ''}`);
    }
  },

  async leave(_, o) {
    const r = await studentfirst.leaveApplications();
    if (o.json) return r;
    if (!r.applications.length) return console.log('No leave applications.');
    for (const l of r.applications) console.log(`  ${l.id}  ${l.start} – ${l.end}  ${l.status}  ${l.details}`);
  },

  async submissions(args, o) {
    need(args, 2, 'submissions <course> <assignment>');
    const r = await mvWrite.listSubmissions({ courseId: args[0], assignment: args[1] });
    if (o.json) return r;
    console.log(`${r.title}  due ${fmtDate(r.due)}`);
    console.log(`Attempts allowed: ${r.attemptsAllowed > 0 ? r.attemptsAllowed : 'unlimited'}; files ${r.allowFiles ? 'allowed' : 'not allowed'}, text ${r.allowText ? 'allowed' : 'not allowed'}`);
    if (!r.attempts.length) return console.log('No attempts yet.');
    for (const a of r.attempts) {
      const files = a.files?.length ? `  ${a.files.join(', ')}` : '';
      console.log(`  ${a.attemptId}  ${a.status}  ${fmtDate(a.submittedAt ?? a.started)}${a.grade ? `  grade ${a.grade}` : ''}${files}`);
    }
  },

  async submit(args, o) {
    need(args, 2, 'submit <course> <assignment> [file...] [-m TEXT]');
    const [courseId, assignment, ...files] = args;
    const req = { courseId, assignment, files, text: o.message };
    const plan = await mvWrite.submit({ ...req, dryRun: true });
    if (o.json && o['dry-run']) return plan;
    if (!o.json) {
      console.log(`Submit to "${plan.assignment}" (due ${fmtDate(plan.due)})${plan.late ? ' — LATE' : ''}`);
      console.log(`Attempt ${plan.attempt} of ${plan.attemptsAllowed}${plan.continuesDraft ? `, continuing draft ${plan.continuesDraft}` : ''}`);
      for (const f of plan.files) console.log(`  ${f.name}  ${fmtBytes(f.bytes)}`);
      if (plan.text) console.log(`  text: ${plan.text.length > 80 ? `${plan.text.slice(0, 80)}…` : plan.text}`);
    }
    if (o['dry-run']) return;
    if (!(await confirm('Submit this? Course staff will see it.', o.yes))) return console.log('Cancelled.');
    const r = await mvWrite.submit(req);
    if (o.json) return r;
    console.log(`Submitted attempt ${r.attemptId} at ${fmtDate(r.submittedAt)}${r.receiptId ? ` (receipt ${r.receiptId})` : ''}`);
  },
};

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const [cmd, ...rest] = parsed.positionals;
  if (parsed.values.help || !cmd || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  const fn = commands[cmd];
  if (!fn) {
    console.error(`Unknown command "${cmd}". Run learnjcu --help.`);
    return 2;
  }
  // Every command works on one saved account. login picks its own (it can
  // add a new one); status and accounts only report.
  if (cmd !== 'login' && (!REPORT_ONLY.has(cmd) || parsed.values.account)) {
    try {
      const { account } = await chooseAccountCli(parsed.values);
      if (account) selectAccount(account);
    } catch (e) {
      console.error(e.message);
      return 2;
    }
  }
  const runOnce = async () => {
    const out = await fn(rest, parsed.values);
    if (parsed.values.json && out !== undefined) console.log(JSON.stringify(out, null, 2));
    return 0;
  };
  try {
    try {
      return await runOnce();
    } catch (e) {
      if (!(e instanceof SessionError) || cmd === 'login' || !(await recoverSession(parsed.values, e.service))) throw e;
      return await runOnce();
    }
  } catch (e) {
    console.error(
      e instanceof SessionError
        ? e.message
            .replace(/Call the learnjcu_login tool, or run `npm run login` in the learnjcu-mcp folder\./, 'Run: learnjcu login')
            .replace(/Call the \w+_login tool, or run `([^`]+)`\./, 'Run: $1')
        : e.message,
    );
    return e instanceof UsageError ? 2 : 1;
  }
}

// On an expired session: refresh silently, and if that isn't enough and we're
// in a terminal, offer to sign in again. Returns true to retry.
async function recoverSession(o, service = 'learnjcu') {
  if (process.env.LEARNJCU_NO_AUTO_LOGIN === '1') return false;
  const label = LABELS[service] ?? service;
  let account;
  try {
    account = currentAccount();
  } catch {
    return false;
  }
  // MyStudent and StudentFirst sign in for an account LearnJCU created.
  if (!account && service !== 'learnjcu') return false;
  process.stderr.write(`${label} session expired or missing; refreshing…\n`);
  const quiet = await login(service, { interactive: false }).catch(() => ({ signedIn: false }));
  if (quiet.signedIn) return true;
  if (!process.stdin.isTTY) return false;
  const opts = { ...loginOptions(o), silent: false, ...(account ? { account } : {}) };
  if (!(await confirm(`Sign in to ${label} in your browser?`, false))) return false;
  return (await runLoginCli(service, opts)) === 0;
}

process.exitCode = await main(process.argv.slice(2));
