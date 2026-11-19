// MyStudent, JCU's student administration portal (TechnologyOne CiAnywhere
// at jcu.t1cloud.com). The dashboard's tiles (details, study plan, class
// registrations, finances, tasks, calendar, forms) come from two JSON calls
// that return HTML fragments. Pages behind the tiles are built by scripts, so
// the study plan is read from a hidden browser that renders it. Nothing here
// changes anything in MyStudent: the JSON calls only read the dashboard, and
// the rendered page is only looked at.
import * as cheerio from 'cheerio';
import { MYSTUDENT_BASE, MYSTUDENT_HOST } from './config.js';
import { sessionFile } from './accounts.js';
import { loadSession } from './session.js';
import { SessionError } from './client.js';
import { launchHidden } from './browser.js';

const LOGIN_HINT = 'Call the mystudent_login tool, or run `learnjcu login --service mystudent`.';
const STUDY_HISTORY = '$SST.STUSTDYHIST.MNT';

function session() {
  const s = loadSession(sessionFile('mystudent'));
  if (!s?.cookies?.length) throw new SessionError(`Not signed in to MyStudent. ${LOGIN_HINT}`, 'mystudent');
  return s;
}

const expired = () => new SessionError(`MyStudent session expired. ${LOGIN_HINT}`, 'mystudent');

// The dashboard's JSON endpoints are POSTs that only read.
async function post(path, body) {
  const s = session();
  const u = new URL(`${MYSTUDENT_BASE}${path}`);
  if (u.host !== MYSTUDENT_HOST) throw new Error('Refusing to send the MyStudent session elsewhere');
  const r = await fetch(u, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: s.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  // CiAnywhere answers a lost session with 470 (or a redirect to its log-on page).
  if ([401, 403, 440, 470].includes(r.status) || (r.status >= 300 && r.status < 400)) throw expired();
  const text = await r.text();
  if (!r.ok) throw new Error(`MyStudent returned HTTP ${r.status} for ${u.pathname}`);
  try {
    return JSON.parse(text);
  } catch {
    throw expired(); // an HTML log-on page instead of JSON
  }
}

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// Links that only open a page ("View my finances") carry no information.
const ACTION_ONLY = /^(View|Make|Manage|Go to)\b/i;

/**
 * Reads one dashboard tile's HTML: its headline (count and label) and each
 * tab with its items (a header and lines) or "No data available".
 */
export function parseTile(html) {
  const $ = cheerio.load(String(html ?? ''));
  const head = $('.activeTileHeader').first();
  const count = clean(head.find('.actCount').text());
  const headline = clean(head.find('[role=heading] span').not('.actCount').text());
  const names = $('.hTabHandle .htHandleLabel').map((_, e) => clean($(e).text())).get();
  const tabs = $('.hTabContent')
    .map((i, tab) => {
      const items = $(tab)
        .find('.hTabContentBody .hyperTextItem')
        .map((_, item) => {
          const header = clean($(item).find('.header').first().text());
          const lines = $(item).find('.lineItem').map((__, l) => clean($(l).text())).get().filter(Boolean);
          return { header, lines };
        })
        .get()
        .filter((it) => (it.header || it.lines.length) && !(ACTION_ONLY.test(it.header) && !it.lines.length));
      const empty = $(tab).find('.emptyMessage').length > 0 && !items.length;
      return { tab: names[i] ?? `Tab ${i + 1}`, ...(empty ? { empty: true } : {}), ...(items.length ? { items: items.map((it) => (it.lines.length ? it : { header: it.header })) } : {}) };
    })
    .get();
  return {
    ...(count ? { count: Number.isNaN(Number(count)) ? count : Number(count) } : {}),
    ...(headline ? { headline } : {}),
    tabs,
  };
}

async function workplace() {
  const data = (await post('/Workplace/FrontOffice/GetWorkplaceData', { CachedAt: '', RequestData: {} }))?.Data;
  const wp = data?.Workplaces?.[0];
  if (!wp) throw expired();
  return wp;
}

/** The MyStudent dashboard: every tile, read the way the page reads it. */
export async function overview() {
  const wp = await workplace();
  const tiles = [];
  for (const f of wp.Functions ?? []) {
    if (!f.Link) continue;
    const link = new URL(f.Link, MYSTUDENT_BASE);
    const item = {
      FunctionName: f.FunctionName,
      MergeFuncName: f.MergeFuncName ?? '',
      ExpiryTime: link.searchParams.get('t'),
      Hash: link.searchParams.get('h'),
      Suite: link.searchParams.get('suite'),
      Role: wp.Name,
      IsHyper: true,
    };
    const r = await post(`/Workplace/FrontOffice/GetActiveTileData?f=${encodeURIComponent(f.FunctionName)}`, { Items: [item], RequestData: {} });
    const tile = parseTile(r?.Items?.[0]?.HtmlContent);
    if (tile.tabs.length || tile.headline) tiles.push({ tile: f.LabelText, ...tile });
  }
  return { portal: wp.LabelText, tiles };
}

const SUBJECT = /^([A-Z]{2,4}\d{4}) - (.+)$/;
const SUBJECT_STATUS = /^(Core|Option|Elective|Optional|Required|[A-Z][a-z]+), (.+)$/;

/**
 * Reads the rendered text of the My Study page: the student and course line,
 * then the course structure, with each subject's status ("Enrolled in 2026,
 * Trimester 3, Singapore", "Exempt in 2026", "Not enrolled. Scheduled in
 * 2027, ...") and the credit granted as advanced standing.
 */
export function parseStudyPlan(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const student = lines.find((l) => /^\d{5,} \| /.test(l));
  const courseLine = lines.find((l) => /^\S+ - .+ \| .*Credit Points/.test(l));
  const [course, credits, campus, mode] = (courseLine ?? '').split(' | ').map((s) => s.trim());
  const start = Math.max(0, lines.findIndex((l) => /^Current Course Structure$/i.test(l)));
  const subjects = [];
  const structures = [];
  let advancedStanding = 0;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(SUBJECT);
    const next = lines[i + 1] ?? '';
    const st = next.match(SUBJECT_STATUS);
    if (m && st) {
      subjects.push({ code: m[1], name: m[2], kind: st[1], status: st[2] });
      i++;
      continue;
    }
    const credit = l.match(/advanced standing - (\d+(?:\.\d+)?) Credit Points/i);
    if (credit) {
      advancedStanding += Number(credit[1]);
      continue;
    }
    if (/^[\w-]+ - .+/.test(l) && !m) structures.push(l);
  }
  const by = (re) => subjects.filter((s) => re.test(s.status)).map((s) => s.code);
  return {
    student: student?.replace(/^\d+ \| /, '') || undefined,
    course: course || undefined,
    creditPoints: credits || undefined,
    campus: campus || undefined,
    mode: mode || undefined,
    structures,
    advancedStandingCreditPoints: advancedStanding || undefined,
    summary: {
      enrolled: by(/^Enrolled/i),
      completed: by(/^(Passed|Completed|Complete|Credit|Pass)/i),
      exempt: by(/^Exempt/i),
      planned: by(/^Not enrolled/i),
    },
    subjects,
  };
}

/** Renders the My Study page in a hidden browser and returns its text. */
async function renderStudyPage() {
  const s = session();
  const { context, close } = await launchHidden();
  try {
    await context.addCookies(
      s.cookies.map(({ name, value, domain, path, expires }) => ({ name, value, domain, path: path || '/', expires: expires > 0 ? expires : -1, secure: true })),
    );
    const page = await context.newPage();
    const url = `${MYSTUDENT_BASE}/Workplace/FrontOffice/RedirectToFunction?f=${encodeURIComponent(STUDY_HISTORY)}&suite=SM`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/\/LogOn\b/i.test(page.url()) || new URL(page.url()).host !== MYSTUDENT_HOST) throw expired();
    // The course structure loads after the page; wait for its first subject.
    await page
      .waitForFunction(() => /\n[A-Z]{2,4}\d{4} - .+\n(Core|Option|Elective)/.test(document.body?.innerText ?? ''), null, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    return await page.evaluate(() => document.body?.innerText ?? '');
  } finally {
    await close().catch(() => {});
  }
}

/** Your course and every subject in its structure, with its status. */
export async function studyPlan() {
  const plan = parseStudyPlan(await renderStudyPage());
  if (!plan.subjects.length) throw new Error('MyStudent did not show the course structure in time. Try again in a moment.');
  return plan;
}
