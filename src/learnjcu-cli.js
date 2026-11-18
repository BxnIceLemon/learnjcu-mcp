#!/usr/bin/env node
// LearnJCU command-line client for submitting to Ultra assignments. Like the
// a submission shows what it will send and asks first.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import * as mv from './learnjcu.js';
import * as mvWrite from './learnjcu-write.js';
import { SessionError } from './client.js';
import { loadSession } from './session.js';
import { listAccounts, accountInfo, selectAccount, currentAccount, AccountChoiceError } from './accounts.js';
import { login } from './auth.js';
import { runLoginCli, loginOptions, chooseAccountCli, LOGIN_OPTIONS } from './login-cli.js';

const HELP = `Usage: learnjcu <command> [options]

Account
  login                                   Sign in to LearnJCU in a browser window
      [--new-account] signs in someone else and saves them as another account
  status                                  Show whether you are signed in
  accounts                                List saved accounts

Browse
  upcoming [--days N]                     Gradebook items due in the next N days (default 14)
  submissions <course> <assignment>       Settings of an assignment and your attempts on it

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
    const opts = { ...loginOptions(o), ...(await chooseAccountCli(o, { login: true })) };
    if ((await runLoginCli('learnjcu', opts)) !== 0) throw new Error('Login was not completed');
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
      const m = a.learnjcu.signedIn ? `LearnJCU until ${fmtDate(a.learnjcu.expiresAt)}` : 'LearnJCU not signed in';
      console.log(`${a.account}${a.displayName && a.displayName !== a.account ? `  ${a.displayName}` : ''}  ${m}`);
    }
  },

  async upcoming(_, o) {
    const r = await mv.upcomingDeadlines({ days: o.days ? Number(o.days) : 14 });
    if (o.json) return r;
    if (!r.items.length) return console.log('Nothing due.');
    for (const i of r.items) console.log(`${fmtDate(i.due)}  ${i.item}  (${i.course})${i.status ? `  [${i.status}]` : ''}`);
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
      if (!(e instanceof SessionError) || cmd === 'login' || !(await recoverSession(parsed.values))) throw e;
      return await runOnce();
    }
  } catch (e) {
    console.error(e instanceof SessionError ? `${e.message.replace(/Call the learnjcu_login tool, or run `npm run login` in the learnjcu-mcp folder\./, 'Run: learnjcu login')}` : e.message);
    return e instanceof UsageError ? 2 : 1;
  }
}

// On an expired session: refresh silently, and if that isn't enough and we're
// in a terminal, offer to sign in again. Returns true to retry.
async function recoverSession(o) {
  if (process.env.LEARNJCU_NO_AUTO_LOGIN === '1') return false;
  process.stderr.write('LearnJCU session expired; refreshing…\n');
  const quiet = await login('learnjcu', { interactive: false }).catch(() => ({ signedIn: false }));
  if (quiet.signedIn) return true;
  if (!process.stdin.isTTY) return false;
  const opts = { ...loginOptions(o), silent: false };
  if (!(await confirm('Sign in to LearnJCU again in your browser?', false))) return false;
  return (await runLoginCli('learnjcu', opts)) === 0;
}

process.exitCode = await main(process.argv.slice(2));
