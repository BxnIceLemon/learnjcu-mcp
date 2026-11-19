// Sign-in flows shared by the CLIs and the MCP server. Each login first tries
// a silent refresh in a hidden window (the browser profile usually still has
// the JCU sign-in state, and for StudentFirst the password the user let the
// browser save), and only opens a visible window in the default browser when
// the user has to act. Passwords and MFA are typed by the user in the browser.
import { BASE_URL, MYSTUDENT_BASE, MYSTUDENT_HOST, MYSTUDENT_LOGON_URL, STUDENTFIRST_BASE, STUDENTFIRST_HOST } from './config.js';
import { saveSession, loadSession, siteCookies, cookiesFor, bbRouterField } from './session.js';
import {
  sessionFile,
  currentAccount,
  accountExists,
  listAccounts,
  withAccount,
  isPending,
  startNewAccount,
  finishNewAccount,
  discardNewAccount,
} from './accounts.js';
import { launch, waitFor, plainCookies, chooseBrowser, hasDisplay, LOGIN_TIMEOUT_MS } from './browser.js';

const SILENT_TIMEOUT_MS = 20 * 1000;
const FALLBACK_TTL_MS = 3 * 60 * 60 * 1000;

const sameName = (a, b) => String(a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// A cookie's expiry as an ISO date, or `fallbackMs` from now for a session cookie.
function cookieExpiry(cookies, name, fallbackMs) {
  const c = cookies.find((k) => k.name === name);
  return new Date(c?.expires > 0 ? c.expires * 1000 : Date.now() + fallbackMs).toISOString();
}

const services = {
  learnjcu: {
    label: 'LearnJCU',
    startUrl: `${BASE_URL}/ultra`,
    async check(context) {
      const r = await context.request.get(`${BASE_URL}/learn/api/public/v1/users/me`, {
        headers: { Accept: 'application/json' },
        failOnStatusCode: false,
      });
      return r.ok() ? r.json() : null;
    },
    async save(context, user) {
      // An account's folder only ever holds that person's sign-in.
      const account = currentAccount();
      const before = loadSession()?.userName;
      if (!isPending(account) && before && user.userName && before !== user.userName) {
        throw new Error(
          `Signed in as ${user.userName}, but this is the sign-in for account ${account}. ` +
            `Nothing was saved. To add ${user.userName}, sign in as a new account (--new-account, or newAccount: true).`,
        );
      }
      const cookies = siteCookies(await context.cookies());
      const expiresSec = Number(bbRouterField(cookies, 'expires'));
      const expiresAt = new Date(expiresSec > 0 ? expiresSec * 1000 : Date.now() + FALLBACK_TTL_MS).toISOString();
      saveSession(
        {
          cookies: plainCookies(cookies),
          xsrf: bbRouterField(cookies, 'xsrf') ?? null,
          userId: user.id,
          userName: user.userName,
          displayName: [user.name?.given, user.name?.family].filter(Boolean).join(' ') || user.userName,
          savedAt: new Date().toISOString(),
          expiresAt,
        },
        sessionFile('learnjcu'),
      );
      return { userName: user.userName, expiresAt };
    },
  },

  // MyStudent signs in through JCU's single sign-on. Its CiAnywhere.Auth
  // cookie lasts several days, and the browser profile usually still has the
  // single sign-on session after that.
  mystudent: {
    label: 'MyStudent',
    startUrl: MYSTUDENT_LOGON_URL,
    async prepare(page) {
      // The log-on page offers "Log on using JCU SSO"; take it.
      await page.click('#BtnSaml', { timeout: 8000 });
    },
    async check(context) {
      const r = await context.request.post(`${MYSTUDENT_BASE}/Workplace/FrontOffice/GetWorkplaceData`, {
        data: { CachedAt: '', RequestData: {} },
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        failOnStatusCode: false,
        maxRedirects: 0,
      });
      if (!r.ok()) return null;
      const body = await r.json().catch(() => null);
      return body?.Data?.Workplaces?.length ? body.Data : null;
    },
    async save(context) {
      const cookies = cookiesFor(await context.cookies(), MYSTUDENT_HOST);
      const expiresAt = cookieExpiry(cookies, 'CiAnywhere.Auth', 8 * 60 * 60 * 1000);
      saveSession({ cookies: plainCookies(cookies), savedAt: new Date().toISOString(), expiresAt }, sessionFile('mystudent'));
      return { expiresAt };
    },
  },

  // StudentFirst has its own user name and password, not JCU's single sign-on.
  // When the user lets the browser save the password, the hidden window finds
  // it filled in and signs in again by itself.
  studentfirst: {
    label: 'StudentFirst',
    startUrl: `${STUDENTFIRST_BASE}/`,
    async prepare(page) {
      const password = page.locator('input[type=password]');
      await password.waitFor({ timeout: 10000 });
      await page.waitForTimeout(1500); // the browser fills saved passwords in shortly after load
      const filled = await page.evaluate(() => [...document.querySelectorAll('form input[type=text], form input[type=password]')].every((i) => i.value));
      if (filled) await page.locator('form [type=submit]').first().click();
    },
    async check(context) {
      for (const page of context.pages()) {
        const u = new URL(page.url());
        if (u.host !== STUDENTFIRST_HOST || !/\/faces\/main\.xhtml$/.test(u.pathname) || !u.searchParams.get('jakarta.faces.Token')) continue;
        const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        const name = text.match(/Welcome\s+([^\n]+)/)?.[1]?.trim();
        if (name) return { token: u.searchParams.get('jakarta.faces.Token'), name };
      }
      return null;
    },
    async save(context, found) {
      // An account's folder only ever holds that person's sign-in.
      const learn = loadSession();
      if (learn?.displayName && !sameName(learn.displayName, found.name)) {
        throw new Error(
          `Signed in to StudentFirst as ${found.name}, but account ${currentAccount()} belongs to ${learn.displayName}. Nothing was saved.`,
        );
      }
      const cookies = cookiesFor(await context.cookies(), STUDENTFIRST_HOST);
      saveSession(
        { cookies: plainCookies(cookies), token: found.token, displayName: found.name, savedAt: new Date().toISOString() },
        sessionFile('studentfirst'),
      );
      return { displayName: found.name };
    },
  },
};

async function attempt(svc, { headless, timeoutMs, onOpen }) {
  const { context, browser } = await launch({ headless });
  const stop = new AbortController();
  let failed;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(svc.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    svc.prepare?.(page).catch(() => {});
    if (!headless) onOpen?.(browser);
    const result = await waitFor(context, () => svc.check(context), timeoutMs, () => failed);
    if (failed) throw failed;
    if (!result) return { ok: false, browser };
    return { ok: true, browser, saved: await svc.save(context, result) };
  } finally {
    stop.abort();
    await context.close().catch(() => {});
  }
}

/**
 * Signs in to "learnjcu".
 * - silent: try a hidden window first (default true)
 * - interactive: open a visible window if silent fails (default true)
 * Resolves to { signedIn, mode, browser, ... }; never throws for a login that
 * simply wasn't completed.
 */
export async function login(service, { silent = true, interactive = true, timeoutMs = LOGIN_TIMEOUT_MS, onOpen } = {}) {
  const svc = services[service];
  if (!svc) throw new Error(`Unknown service "${service}"`);
  const chosen = chooseBrowser();
  const browserInfo = { name: chosen.name, source: chosen.source, note: chosen.note };

  if (silent) {
    const r = await attempt(svc, { headless: true, timeoutMs: SILENT_TIMEOUT_MS }).catch(() => ({ ok: false }));
    if (r.ok) return { signedIn: true, service, mode: 'silent', browser: browserInfo, ...r.saved };
  }
  if (!interactive) {
    return { signedIn: false, service, needsUser: true, browser: browserInfo };
  }
  if (!hasDisplay()) {
    return {
      signedIn: false,
      service,
      needsUser: true,
      browser: browserInfo,
      reason: 'There is no display to open a sign-in window on. Sign in on a computer with a screen, then copy the account folder (~/.learnjcu-mcp/accounts/<name>) here.',
    };
  }
  const r = await attempt(svc, { headless: false, timeoutMs, onOpen });
  if (r.ok) return { signedIn: true, service, mode: 'interactive', browser: browserInfo, ...r.saved };
  return { signedIn: false, service, mode: 'interactive', browser: browserInfo, reason: 'Sign-in was not completed (timed out or the window was closed).' };
}

/**
 * Signs in for one account. Without `account`, the current account is used
 * (AccountChoiceError when several are saved and none was chosen). With
 * `newAccount`, or when no account is saved yet, a new person signs in to
 * LearnJCU with a fresh browser profile and the account is named after their
 * LearnJCU username. Resolves like login(), plus `account`.
 */
export async function loginAccount(service, { account, newAccount = false, ...opts } = {}) {
  if (account && !accountExists(account)) {
    throw new Error(`No saved account "${account}". Saved: ${listAccounts().join(', ') || 'none'}. To add one, sign in as a new account.`);
  }
  if (service !== 'learnjcu' && (newAccount || (!account && listAccounts().length === 0))) {
    // Accounts are named after the LearnJCU user, so they start there.
    throw new Error(`Sign in to LearnJCU first (learnjcu_login, or \`npm run login\`); that saves the account, then sign in to ${LABELS[service]} for it.`);
  }
  if (newAccount || (!account && listAccounts().length === 0)) {
    const pending = startNewAccount();
    try {
      // A fresh profile has nothing to refresh silently.
      const r = await withAccount(pending, () => login('learnjcu', { ...opts, silent: false }));
      if (!r.signedIn) {
        discardNewAccount(pending);
        return r;
      }
      return { ...r, account: finishNewAccount(pending, r.userName), newAccount: true };
    } catch (e) {
      discardNewAccount(pending);
      throw e;
    }
  }
  const name = account ?? currentAccount();
  const r = await withAccount(name, () => login(service, opts));
  return { ...r, account: name };
}

export const LABELS = Object.fromEntries(Object.entries(services).map(([k, v]) => [k, v.label]));
