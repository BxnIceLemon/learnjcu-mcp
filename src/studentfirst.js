// StudentFirst (studentfirst.jcu.edu.sg), JCU Singapore's site for class
// schedules, attendance and leave applications. It is a server-rendered
// JSF/PrimeFaces site with no API, so its pages are read as HTML. Every page
// needs the session cookie and the jakarta.faces.Token from the sign-in.
// Only GET requests are sent; nothing here submits a form.
import * as cheerio from 'cheerio';
import { STUDENTFIRST_BASE, STUDENTFIRST_HOST } from './config.js';
import { sessionFile } from './accounts.js';
import { loadSession } from './session.js';
import { SessionError } from './client.js';

const LOGIN_HINT = 'Call the studentfirst_login tool, or run `learnjcu login --service studentfirst`.';

function session() {
  const s = loadSession(sessionFile('studentfirst'));
  if (!s?.token) throw new SessionError(`Not signed in to StudentFirst. ${LOGIN_HINT}`, 'studentfirst');
  return s;
}

const PAGES = new Set(['main', 'leaveapplication', 'notification']);

/** GETs one StudentFirst page and returns its HTML; SessionError when signed out. */
export async function getPage(name) {
  if (!PAGES.has(name)) throw new Error(`Unknown StudentFirst page "${name}"`);
  const s = session();
  const u = new URL(`/faces/${name}.xhtml`, STUDENTFIRST_BASE);
  u.searchParams.set('jakarta.faces.Token', s.token);
  if (u.host !== STUDENTFIRST_HOST) throw new Error('Refusing to send the StudentFirst session elsewhere');
  const r = await fetch(u, {
    headers: { Accept: 'text/html', Cookie: s.cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
    redirect: 'manual',
  });
  const html = await r.text();
  // A lost session shows the sign-in form again, or fails on the stale token.
  if ((r.status >= 300 && r.status < 400) || r.status === 500 || isLoginPage(html)) {
    throw new SessionError(`StudentFirst session expired. ${LOGIN_HINT}`, 'studentfirst');
  }
  if (!r.ok) throw new Error(`StudentFirst returned HTTP ${r.status} for ${name}`);
  return html;
}

export function isLoginPage(html) {
  return /sf_loginform_password/.test(html) || /Welcome Back to StudentFirst/i.test(html);
}

const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

function percent(text) {
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/** Rows of a PrimeFaces data table as objects keyed by its column titles. */
function tableRows($, table) {
  const heads = $(table).find('thead th').map((_, th) => clean($(th).find('.ui-column-title').text() || $(th).text())).get();
  return $(table)
    .find('tbody tr')
    .filter((_, tr) => !$(tr).hasClass('ui-datatable-empty-message'))
    .map((_, tr) => {
      const cells = $(tr).find('td').map((__, td) => clean($(td).text())).get();
      return Object.fromEntries(heads.map((h, i) => [h, cells[i] ?? '']).filter(([h]) => h));
    })
    .get();
}

// A session's box carries a badge when attendance was taken: green with a
// tick for present, red with a cross for absent. No badge: not recorded yet.
function sessionStatus($, label) {
  const badge = $(label).find('.ui-badge').attr('class') ?? '';
  const icon = $(label).find('.ui-badge-icon').attr('class') ?? '';
  if (!badge) return 'not recorded';
  if (/success/.test(badge) || /pi-check/.test(icon)) return 'present';
  if (/danger|error/.test(badge) || /pi-times/.test(icon)) return 'absent';
  if (/warning/.test(badge)) return 'late or partial';
  return clean(badge.replace(/ui-badge|ui-widget|mr-\d|mt-\d/g, '')) || 'unknown';
}

function parseSessionBox(html) {
  const [date, time, ...where] = String(html)
    .split(/<br\s*\/?>/i)
    .map((p) => clean(cheerio.load(`<p>${p}</p>`)('p').text()))
    .filter(Boolean);
  return { date, time, location: where.join(' ') || undefined };
}

/**
 * Reads the StudentFirst home page: the welcome name, the next 8 days of
 * classes, overall class and campus attendance, and every class with each of
 * its sessions and whether attendance was recorded.
 */
export function parseHome(html) {
  const $ = cheerio.load(String(html));
  const name = clean($('body').text().match(/Welcome\s+([^\n<]+?)\s{2,}/)?.[1] ?? '');

  const upcomingTable = $('[id$="sf_datatable_sevendaychedule"] table').first();
  const upcoming = tableRows($, upcomingTable).map((r) => ({
    class: r.Classcode,
    date: r.Date,
    time: r.Time,
    location: r.Hall,
  }));

  const attendanceOf = (title) => {
    const card = $('div')
      .filter((_, d) => clean($(d).children().first().text()) === title && $(d).text().includes('attendance is'))
      .first();
    const value = card.find('span').filter((_, s) => /%/.test($(s).text())).first().text();
    return { percent: percent(value), minimum: percent(card.text().match(/Minimum of\s*\d+%/i)?.[0] ?? '') };
  };
  const updated = $('body').text().match(/last updated on:\s*([0-9-]{8,10})/i)?.[1];

  // The class list is a run of <li>: a title ("AB1001 - Example Subject -
  // Lecture"), the class code ("AB1001-LA"), then a "View Details" panel
  // with a box per session.
  const classes = [];
  let current = null;
  $('li').each((_, li) => {
    const $li = $(li);
    if ($li.parents('li').length) return;
    const text = clean($li.text());
    const boxes = $li.find('label').filter((__, l) => $(l).find('.surface-overlay').length > 0);
    if (boxes.length && current) {
      current.sessionList.push(
        ...boxes.map((__, l) => ({ ...parseSessionBox($(l).find('.surface-overlay').first().html()), status: sessionStatus($, l) })).get(),
      );
    } else if (/^[A-Z]{2}\d{4}-\w+$/.test(text) && current && !current.class) {
      current.class = text;
    } else if (/^[A-Z]{2}\d{4} - /.test(text) && !boxes.length) {
      current = { title: text, class: null, sessionList: [] };
      classes.push(current);
    }
  });
  for (const c of classes) {
    const count = (st) => c.sessionList.filter((x) => x.status === st).length;
    Object.assign(c, { total: c.sessionList.length, present: count('present'), absent: count('absent'), notRecorded: count('not recorded') });
  }
  const ordered = classes.filter((c) => c.class).map(({ class: code, title, total, present, absent, notRecorded, sessionList }) => ({ class: code, title, total, present, absent, notRecorded, sessionList }));

  return {
    name: name || undefined,
    attendance: {
      class: attendanceOf('Class Attendance'),
      campus: attendanceOf('Campus Attendance'),
      lastUpdated: updated,
      note: 'On-campus class attendance updates hourly; online class and campus attendance update weekly.',
    },
    upcoming,
    classes: ordered,
  };
}

/** Leave applications from the Leave Application page. */
export function parseLeave(html) {
  const $ = cheerio.load(String(html));
  const table = $('table')
    .filter((_, t) => /Application ID/.test($(t).find('thead').text()))
    .first();
  return tableRows($, table).map((r) => ({
    id: r['Application ID'],
    start: r['Start Date'],
    end: r['End Date'],
    details: r['Request Details'],
    status: r.Status,
    approvedStart: r['Approved Start Date'] || undefined,
    approvedEnd: r['Approved End Date'] || undefined,
  }));
}

/** The text of the Notification page (notices such as student contract updates). */
export function parseNotices(html) {
  const $ = cheerio.load(String(html));
  const panels = $('[id^="studentfirst_notification_panel"][id$="_content"]').filter((_, p) => !$(p).find('[id$="_content"]').length);
  const root = panels.length ? panels : $('body');
  root.find('script, style, form').remove();
  root.find('br').replaceWith('\n');
  root.find('p, li, tr, h1, h2, h3, h4, div').after('\n');
  root.find('td, th').after(' ');
  return root
    .text()
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// --- tools

export async function overview() {
  const home = parseHome(await getPage('main'));
  return { ...home, classes: home.classes.map(({ sessionList, ...c }) => c) };
}

export async function classAttendance({ classCode } = {}) {
  const home = parseHome(await getPage('main'));
  const q = String(classCode ?? '').trim().toUpperCase();
  const classes = q ? home.classes.filter((c) => c.class.toUpperCase().startsWith(q)) : home.classes;
  if (q && !classes.length) throw new Error(`No class matching "${classCode}". Classes: ${home.classes.map((c) => c.class).join(', ')}`);
  return { attendance: home.attendance, classes: classes.map(({ sessionList, ...c }) => ({ ...c, sessions: sessionList })) };
}

export async function leaveApplications() {
  return { applications: parseLeave(await getPage('leaveapplication')), note: 'New leave applications are made on the StudentFirst website.' };
}

export async function notices() {
  return { text: parseNotices(await getPage('notification')) };
}
