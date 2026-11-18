// Saved accounts. Each account has its own folder with its LearnJCU session
// and its own browser profile (which holds the "Stay signed in" state), so two
// people's sign-ins never mix:
//
//   ~/.learnjcu-mcp/accounts/<LearnJCU username>/session.json
//                                             /browser-profile[-<browser>]
//
// Which account a call uses: the one passed explicitly (withAccount), else the
// one chosen for this process (selectAccount, or LEARNJCU_ACCOUNT), else the
// only saved account. With several accounts and no choice, AccountChoiceError
// tells the caller to ask the user.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DATA_DIR } from './config.js';

export const ACCOUNTS_DIR = path.join(DATA_DIR, 'accounts');
const FILES = { learnjcu: 'session.json' };
const PROFILE = 'browser-profile';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
const PENDING = '.new-';

export class AccountChoiceError extends Error {
  constructor(accounts) {
    super(
      `Several accounts are saved (${accounts.join(', ')}). Ask the user which account to use, ` +
        'then pass it as `account` (MCP), `--account NAME` (CLI) or LEARNJCU_ACCOUNT.',
    );
    this.accounts = accounts;
  }
}

export function isValidName(name) {
  return typeof name === 'string' && NAME.test(name) && !name.includes('..');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function mkdirPrivate(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Names of the saved accounts, sorted. */
export function listAccounts() {
  if (!fs.existsSync(ACCOUNTS_DIR)) return [];
  return fs
    .readdirSync(ACCOUNTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isValidName(d.name))
    .map((d) => d.name)
    .sort();
}

export function accountExists(name) {
  return isValidName(name) && listAccounts().includes(name);
}

const scope = new AsyncLocalStorage();
let selected = process.env.LEARNJCU_ACCOUNT || null;

/** Runs fn with `name` as the account for everything it calls (undefined: no override). */
export function withAccount(name, fn) {
  return name ? scope.run({ name }, fn) : fn();
}

/** Chooses the account for the rest of this process. null clears the choice. */
export function selectAccount(name) {
  if (name && !accountExists(name)) throw new Error(`No saved account "${name}". Saved: ${listAccounts().join(', ') || 'none'}`);
  selected = name || null;
  return selected;
}

export function selectedAccount() {
  return selected;
}

/**
 * The account in effect, or null when none is saved yet. Throws
 * AccountChoiceError when several are saved and none was chosen.
 */
export function currentAccount() {
  const s = scope.getStore();
  if (s?.name) return s.name;
  if (selected) {
    if (!accountExists(selected)) throw new Error(`No saved account "${selected}" (from LEARNJCU_ACCOUNT or an earlier choice). Saved: ${listAccounts().join(', ') || 'none'}`);
    return selected;
  }
  const all = listAccounts();
  if (all.length === 1) return all[0];
  if (all.length === 0) return null;
  throw new AccountChoiceError(all);
}

function dirOf(name) {
  return path.join(ACCOUNTS_DIR, name);
}

/** Session file of `service` for an account (default: the current one), or null with no account. */
export function sessionFile(service, name = currentAccount()) {
  if (!FILES[service]) throw new Error(`Unknown service "${service}"`);
  return name ? path.join(dirOf(name), FILES[service]) : null;
}

/** Browser profile folder for an account and browser id. */
export function profileDir(browserId, name = currentAccount()) {
  if (!name) throw new Error('No account to sign in with');
  mkdirPrivate(dirOf(name));
  return path.join(dirOf(name), browserId === 'msedge' ? PROFILE : `${PROFILE}-${browserId}`);
}

/** Whether an account has a browser profile, which a silent refresh needs. */
export function hasBrowserProfile(name) {
  if (!name) return false;
  try {
    return fs.readdirSync(dirOf(name)).some((e) => e === PROFILE || e.startsWith(`${PROFILE}-`));
  } catch {
    return false;
  }
}

/** What is saved for one account, without any secrets. */
export function accountInfo(name) {
  const m = readJson(path.join(dirOf(name), FILES.learnjcu));
  return {
    account: name,
    userName: m?.userName,
    displayName: m?.displayName,
    learnjcu: m ? { signedIn: true, expiresAt: m.expiresAt } : { signedIn: false },
    selected: name === selected || undefined,
  };
}

/** A temporary account folder to sign a new account in with. */
export function startNewAccount() {
  const name = `${PENDING}${crypto.randomBytes(6).toString('hex')}`;
  mkdirPrivate(dirOf(name));
  return name;
}

/**
 * Gives a temporary account its real name (the LearnJCU username). Signing in
 * again as an existing account replaces that account's session and profile.
 */
export function finishNewAccount(pending, userName) {
  if (!pending.startsWith(PENDING)) throw new Error('Not a new account');
  if (!isValidName(userName)) throw new Error(`Can't name an account "${userName}"`);
  const from = dirOf(pending);
  const to = dirOf(userName);
  if (!fs.existsSync(to)) {
    fs.renameSync(from, to);
    return userName;
  }
  for (const e of fs.readdirSync(from)) {
    fs.rmSync(path.join(to, e), { recursive: true, force: true });
    fs.renameSync(path.join(from, e), path.join(to, e));
  }
  fs.rmSync(from, { recursive: true, force: true });
  return userName;
}

export function discardNewAccount(pending) {
  if (pending?.startsWith(PENDING)) fs.rmSync(dirOf(pending), { recursive: true, force: true });
}

export function isPending(name) {
  return Boolean(name?.startsWith(PENDING));
}
