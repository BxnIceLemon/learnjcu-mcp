// Terminal front end for `npm run login` and `learnjcu login`.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { loginAccount, LABELS } from './auth.js';
import { sessionFile, currentAccount, accountExists, accountInfo, listAccounts, AccountChoiceError } from './accounts.js';

export const LOGIN_OPTIONS = {
  'no-silent': { type: 'boolean' },
  service: { type: 'string' },
  account: { type: 'string' },
  'new-account': { type: 'boolean' },
};

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Options for runLoginCli from command-line flags. */
export function loginOptions(values) {
  return { silent: !values['no-silent'] };
}

function describeAccount(name) {
  const a = accountInfo(name);
  const who = a.displayName && a.displayName !== name ? `  ${a.displayName}` : '';
  const signedIn = a.learnjcu.signedIn ? 'signed in' : '';
  return `${name}${who}${signedIn ? `  (${signedIn})` : ''}`;
}

/**
 * Picks the account a command works on, from --account, --new-account (login
 * only), LEARNJCU_ACCOUNT, or the only saved account. With several accounts it
 * asks in the terminal, and refuses without one. Returns { account, newAccount }.
 */
export async function chooseAccountCli(values = {}, { login = false } = {}) {
  if (values['new-account']) {
    if (!login) throw new Error('--new-account only works with login');
    return { newAccount: true };
  }
  if (values.account) {
    if (!accountExists(values.account)) {
      throw new Error(
        `No saved account "${values.account}". Saved: ${listAccounts().join(', ') || 'none'}.${login ? ' To add one, use --new-account.' : ''}`,
      );
    }
    return { account: values.account };
  }
  let choices;
  try {
    const a = currentAccount();
    if (a) return { account: a };
    return login ? { newAccount: true } : { account: null };
  } catch (e) {
    if (!(e instanceof AccountChoiceError)) throw e;
    choices = e.accounts;
  }
  if (!process.stdin.isTTY) {
    throw new Error(`Several accounts are saved: ${choices.join(', ')}. Choose one with --account NAME or LEARNJCU_ACCOUNT.`);
  }
  console.error('Saved accounts:');
  choices.forEach((c, i) => console.error(`  ${i + 1}) ${describeAccount(c)}`));
  if (login) console.error('  n) a new account');
  for (;;) {
    const answer = (await ask(`Which account? [1-${choices.length}${login ? ', n' : ''}] `)).trim();
    if (login && /^n(ew)?$/i.test(answer)) return { newAccount: true };
    const pick = choices[Number(answer) - 1] ?? choices.find((c) => c === answer);
    if (pick) return { account: pick };
  }
}

/** The service named by --service (default LearnJCU). */
export function loginService(values = {}) {
  const service = values.service ?? 'learnjcu';
  if (!LABELS[service]) throw new Error(`Unknown --service "${service}". Use one of: ${Object.keys(LABELS).join(', ')}`);
  return service;
}

export async function runLoginCli(service, opts) {
  let label = LABELS[service];
  try {
    let o = opts;
    if (!o) {
      const values = parseArgs({ args: process.argv.slice(2), options: LOGIN_OPTIONS }).values;
      service = loginService(values);
      label = LABELS[service];
      o = { ...loginOptions(values), ...(await chooseAccountCli(values, { login: service === 'learnjcu' })) };
    } else if (o.account === undefined && !o.newAccount) {
      o = { ...o, ...(await chooseAccountCli({}, { login: true })) };
    }
    const { silent = true, account, newAccount } = o;
    console.log(newAccount ? `Signing in to ${label} as a new account…` : `Signing in to ${label}${account ? ` (account ${account})` : ''}…`);
    const r = await loginAccount(service, {
      account: account ?? undefined,
      newAccount,
      silent,
      onOpen: (b) =>
        console.log(
          `Opened ${b.name}${b.source === 'system default' ? ' (your default browser)' : ''}. ` +
            `Sign in there; the window closes by itself when you're done.${b.note ? `\nNote: ${b.note}.` : ''}`,
        ),
    });
    if (!r.signedIn) {
      console.error(r.reason ?? 'Sign-in was not completed.');
      return 1;
    }
    const how = r.mode === 'silent' ? `Refreshed the ${label} session silently` : `Signed in to ${label}`;
    const who = r.userName ?? r.displayName;
    console.log(`${how}${who ? ` as ${who}` : ''} (account ${r.account}). Session saved to ${sessionFile(service, r.account)}`);
    if (r.expiresAt) console.log(`Valid until about ${new Date(r.expiresAt).toLocaleString()}.`);
    return 0;
  } catch (e) {
    console.error(e.message);
    return 1;
  }
}
