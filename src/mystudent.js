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

// --- Pages behind the dashboard, rendered in a hidden browser

/**
 * The pages this reads, with the tabs (sections) it opens on each. Only these
 * tab handles are ever clicked; no button, link or form control is touched,
 * so nothing is saved, requested or submitted.
 */
export const PAGES = {
  details: {
    fn: '$SC.STUDENTPRFL.MNT',
    title: 'My Details',
    sections: {
      summary: 'Tab_PersonalDetailsSection',
      contacts: 'Tab_StudentContactsListSection',
      education: 'Tab_EducationalBackgroundDetailsSection',
      sanctions: 'Tab_StudentSanctionListSection',
      communication: 'Tab_StudentCommunicationListSection',
      forms: 'Tab_StudentFormListSection',
    },
  },
  study: {
    fn: STUDY_HISTORY,
    title: 'My Study',
    sections: {
      course: 'Tab_StudyPlanOutlineSection',
      overview: 'Tab_StudentStudyPlanOverviewSection',
      reports: 'Tab_SelfServiceReportsSection',
      withdrawal: 'Tab_UnitWithdrawalSection',
    },
  },
  class_registrations: { fn: '$STT.STUCLASSREG.MNT', title: 'My Class Registrations' },
  finances: {
    fn: '$SFN.FINANCEPRFL.MNT',
    title: 'My Finances',
    sections: {
      summary: 'Tab_StudentFinanceAnalyticsSection',
      transactions: 'Tab_StudentTransactionManagementWrapperSection',
      receipts: 'Tab_FinancePaymentReceiptsSection',
      forms: 'Tab_FinanceProfileFormListSection',
      preferences: 'Tab_StudentFinanceOptionsSection',
    },
  },
  tasks: { fn: '$SST.STUMYTASKS.WIZ', title: 'My Tasks' },
  calendar: { fn: '$STT.STUCAL.LST', title: 'My Calendar' },
  forms: { fn: '$TB.FRM.MYFRMDEF.ENQ', title: 'Forms (available)' },
  form_responses: { fn: '$TB.FRM.MYFRMINT.ENQ', title: 'Forms (your drafts and submitted forms)', fromTile: '$TB.FRM.MYFRMDEF.ENQ' },
  applications: { fn: 'JC.APO.STU.01.DSH', title: 'My Applications and Offers' },
};

/**
 * Runs in the page: turns a part of it into lines of text. A form field
 * becomes "Label: value" (empty fields are left out), a grid becomes one
 * line per row, and filter panels, calendar grids and buttons are skipped.
 */
export function extractLines(root) {
  const ACTION =
    /^(View|Fill out|Respond|Request|Confirm|Select|Remove|Save|Edit|Show less|Show more|More|Clear|Clear all|Filters|Sort by|Additional Information|Edit Application|View Application|Respond to Offer|Pay Now|Review|Add to Cart|Previous|Finish|Help|Show Preview|Responses|Starred|Plan and enrol|Link to JCU Course and Subject Handbook|\*|Select Payment Option|Change to Accessibility Mode|No files selected)$/;
  const SKIP = '.fltrCntr, .enquiryfilters, .t1cal-background-rows, .t1cal-background-columns, .t1cal-time-grid-container .t1cal-time, .slick-header, .rowActions, .template, .screensaver';
  const out = [];
  const push = (t) => {
    t = String(t ?? '').replace(/[ \t ]+/g, ' ').trim();
    if (t && !ACTION.test(t) && out[out.length - 1] !== t) out.push(t);
  };
  const hidden = (el) => {
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };
  const label = (el) => {
    try {
      return JSON.parse(el.getAttribute('data-t1-control') || '{}').LabelText;
    } catch {
      return undefined;
    }
  };
  const value = (el) => {
    const span = el.querySelector('.readonlyTextBoxSpan');
    if (span && !hidden(span)) return span.innerText.trim();
    const box = el.querySelector('input[type=checkbox]');
    if (box) return box.checked ? 'Yes' : 'No';
    const sel = el.querySelector('select');
    if (sel) return sel.selectedOptions[0]?.text?.trim() ?? '';
    const inp = el.querySelector('input:not([type=hidden]), textarea');
    return inp ? inp.value.trim() : '';
  };
  // A field is the innermost labelled control: a section or panel is labelled
  // too, but holds labelled controls of its own.
  const isField = (el) => {
    if (!el.hasAttribute('data-t1-control') || !label(el)) return false;
    if ([...el.querySelectorAll('[data-t1-control]')].some((d) => label(d))) return false;
    const spans = el.querySelectorAll('.readonlyTextBoxSpan').length;
    const inputs = el.querySelectorAll('input:not([type=hidden]), select, textarea').length;
    return spans + inputs > 0 && spans <= 1 && inputs <= 2;
  };
  const grid = (canvas) => {
    const g = canvas.closest('.slick-viewport')?.parentElement;
    const heads = [...(g?.querySelectorAll('.slick-header-column') ?? [])].map((h) => h.innerText.trim());
    for (const row of canvas.querySelectorAll('.slick-row')) {
      const cells = [...row.querySelectorAll('.slick-cell')]
        .map((c) => {
          const i = Number(c.className.match(/\bl(\d+)\b/)?.[1]);
          const v = c.innerText.trim();
          return v && !ACTION.test(v) ? `${heads[i] || `Column ${i + 1}`}: ${v}` : null;
        })
        .filter(Boolean);
      if (cells.length) out.push(cells.join(' | '));
    }
  };
  const walk = (node) => {
    if (node.nodeType === 3) return push(node.textContent);
    if (node.nodeType !== 1) return;
    const el = node;
    if (['SCRIPT', 'STYLE', 'BUTTON', 'svg', 'NOSCRIPT'].includes(el.tagName) || el.matches(SKIP) || hidden(el)) return;
    if (el.classList.contains('grid-canvas')) return grid(el);
    if (isField(el)) {
      const v = value(el);
      if (v && v !== '-') out.push(`${label(el)}: ${v}`);
      return;
    }
    if (!el.querySelector('[data-t1-control], .grid-canvas') && !el.querySelector(SKIP)) {
      for (const l of el.innerText.split('\n')) push(l);
      return;
    }
    for (const c of el.childNodes) walk(c);
  };
  walk(root);
  return out;
}

// The link to a page, with the hash MyStudent signs it with: from the
// dashboard's function list, or from inside a tile for pages that only a
// tile links to.
async function pageLink(def) {
  const wp = await workplace();
  const f = (wp.Functions ?? []).find((x) => x.FunctionName === (def.fromTile ?? def.fn));
  if (!f?.Link) throw new Error(`MyStudent does not offer "${def.title}" to this account.`);
  if (!def.fromTile) return new URL(f.Link, MYSTUDENT_BASE).toString();
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
  const $ = cheerio.load(String(r?.Items?.[0]?.HtmlContent ?? ''));
  const href = $('a[href]')
    .map((_, a) => $(a).attr('href'))
    .get()
    .find((h) => new URL(h, MYSTUDENT_BASE).searchParams.get('f') === def.fn);
  if (!href) throw new Error(`MyStudent did not link to "${def.title}".`);
  return new URL(href, MYSTUDENT_BASE).toString();
}

// Waits until no request is in flight and the text stopped changing.
async function settle(page, { max = 20000, min = 800 } = {}) {
  const t0 = Date.now();
  let quiet = 0;
  let last = -1;
  while (Date.now() - t0 < max) {
    await page.waitForTimeout(250);
    const [n, len] = await page.evaluate(() => [window.__learnjcuInflight ?? 0, document.body?.innerText.length ?? 0]);
    quiet = n === 0 && len === last ? quiet + 250 : 0;
    last = len;
    if (quiet >= 1500 && Date.now() - t0 > min) return;
  }
}

/**
 * Opens one MyStudent page in a hidden browser and reads it: the page itself,
 * then each of its sections (or only `section`). Resolves to
 * { page, title, header, sections: [{ section, lines }] } or, for a page
 * without sections, { page, title, lines }.
 */
export async function readPage({ page: key, section } = {}) {
  const def = PAGES[key];
  if (!def) throw new Error(`Unknown MyStudent page "${key}". Pages: ${Object.keys(PAGES).join(', ')}`);
  const names = def.sections ? Object.keys(def.sections) : [];
  if (section && !def.sections?.[section]) {
    throw new Error(names.length ? `"${key}" has the sections ${names.join(', ')}` : `"${key}" has no sections`);
  }
  const url = await pageLink(def);
  const s = session();
  const { context, close } = await launchHidden();
  try {
    await context.addCookies(
      s.cookies.map(({ name, value, domain, path, expires }) => ({ name, value, domain, path: path || '/', expires: expires > 0 ? expires : -1, secure: true })),
    );
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__learnjcuInflight = 0;
      const send = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (...a) {
        window.__learnjcuInflight++;
        this.addEventListener('loadend', () => window.__learnjcuInflight--);
        return send.apply(this, a);
      };
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/\/LogOn\b/i.test(page.url()) || new URL(page.url()).host !== MYSTUDENT_HOST) throw expired();
    // The page builds itself after loading: wait for its first section, or a list.
    await page
      .waitForFunction(() => document.querySelector('[id^="Tab_"]') || /No records found|records?\.|forms\.|INFORMATION MESSAGE/.test(document.body?.innerText ?? ''), null, {
        timeout: 25000,
      })
      .catch(() => {});
    await settle(page);
    if (/Unable to Access the Requested Function/i.test(await page.evaluate(() => document.body?.innerText ?? ''))) {
      throw new Error(`MyStudent refused to open "${def.title}" for this account.`);
    }
    const area = () => document.querySelector('.mainContent') ?? document.querySelector('form') ?? document.body;
    if (!def.sections) {
      const lines = await page.evaluate(`(${extractLines})((${area})())`);
      return { page: key, title: def.title, lines };
    }
    // The header above the sections (student and course), without the tab list.
    const header = (
      await page.evaluate(() => {
        const h = document.querySelector('.formTitleContainer');
        return h ? h.innerText : '';
      })
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const sections = [];
    for (const name of section ? [section] : names) {
      const id = def.sections[name];
      await page.evaluate((tab) => document.getElementById(`${tab}_Handle`)?.click(), id);
      await page.waitForFunction((tab) => (document.getElementById(tab)?.innerText.trim().length ?? 0) > 0, id, { timeout: 20000 }).catch(() => {});
      await settle(page, { max: 15000, min: 300 });
      const lines = await page.evaluate(`(${extractLines})(document.getElementById(${JSON.stringify(id)}))`);
      sections.push({ section: name, lines: lines ?? [] });
    }
    return { page: key, title: def.title, ...(header.length ? { header } : {}), sections };
  } finally {
    await close().catch(() => {});
  }
}

/** Your course and every subject in its structure, with its status. */
export async function studyPlan() {
  const r = await readPage({ page: 'study', section: 'course' });
  const plan = parseStudyPlan([...(r.header ?? []), ...r.sections[0].lines].join('\n'));
  if (!plan.subjects.length) throw new Error('MyStudent did not show the course structure in time. Try again in a moment.');
  return plan;
}
