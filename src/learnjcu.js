// Blackboard Learn REST calls shaped into compact results for an LLM.
import { BASE_URL } from './config.js';
import { get, getAll, download } from './client.js';
import { loadSession } from './session.js';
import { parseEmbeddedFiles } from './embedded.js';

const V1 = '/learn/api/public/v1';
const V2 = '/learn/api/public/v2';

// JCU subject sites are coded "<year>-<subject>-<campus>-<mode>-<period>",
// e.g. "26-BU2001-SIN-CAM-TR3". Other sites (orientation, modules) have free
// codes like "SMARTS".
const SUBJECT_CODE = /^\d{2}-[A-Z]{2,4}\d{4}-/i;

/** Whether a course code is a subject site (rather than an organisation-style site). */
export function isSubjectCode(code) {
  return SUBJECT_CODE.test(code ?? '');
}

/** Whether `query` names this course: its full code, or one part of it such as "BU2001". */
export function codeMatches(code, query) {
  const c = String(code ?? '').toUpperCase();
  const q = String(query ?? '').trim().toUpperCase();
  if (!q) return false;
  return c === q || c.split('-').includes(q);
}

// Accept a primary id ("_12345_1"), a full course code
// ("26-BU2001-SIN-CAM-TR3") or a subject code ("BU2001", resolved to the
// newest matching subject site).
export async function course(id) {
  const s = String(id).trim();
  if (s.startsWith('_') || s.includes(':')) return encodeURIComponent(s);
  const matches = (await listCourses({ includeUnavailable: true })).filter((c) => codeMatches(c.code, s));
  if (!matches.length) throw new Error(`No enrolled course matches "${s}". Use a code like BU2001 or the id from learnjcu_list_courses.`);
  return encodeURIComponent(matches[0].id);
}

/** Subject sites first, newest year and teaching period first; other sites after, by name. */
export function compareCourses(a, b) {
  const sa = isSubjectCode(a.code);
  const sb = isSubjectCode(b.code);
  if (sa !== sb) return sa ? -1 : 1;
  if (sa) {
    const [ya, , , , pa = ''] = a.code.toUpperCase().split('-');
    const [yb, , , , pb = ''] = b.code.toUpperCase().split('-');
    if (ya !== yb) return yb.localeCompare(ya);
    if (pa !== pb) return pb.localeCompare(pa);
  }
  return String(a.name).localeCompare(String(b.name));
}

function text(html, max = 4000) {
  if (!html) return undefined;
  const t = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function userId() {
  return loadSession()?.userId ?? 'me';
}

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]).catch((e) => ({ error: e.message }));
      }
    }),
  );
  return out;
}

export async function whoami() {
  const u = await get(`${V1}/users/me`);
  return {
    id: u.id,
    userName: u.userName,
    studentId: u.studentId,
    name: [u.name?.given, u.name?.family].filter(Boolean).join(' '),
    email: u.contact?.email,
    lastLogin: u.lastLogin,
  };
}

export async function listCourses({ search, includeUnavailable = false } = {}) {
  const rows = await getAll(`${V1}/users/${userId()}/courses`, { expand: 'course' });
  let courses = rows.map((m) => ({
    id: m.course?.id ?? m.courseId,
    code: m.course?.courseId,
    name: m.course?.name,
    role: m.courseRoleId,
    termId: m.course?.termId,
    available: m.availability?.available === 'Yes' && m.course?.availability?.available !== 'No',
    enrolled: m.created,
    url: m.course?.externalAccessUrl ?? `${BASE_URL}/ultra/courses/${m.course?.id ?? m.courseId}/outline`,
  }));
  if (!includeUnavailable) courses = courses.filter((c) => c.available);
  if (search) {
    const q = search.toLowerCase();
    courses = courses.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(q));
  }
  return courses.sort(compareCourses);
}

export async function listAnnouncements({ courseId, limit = 20 }) {
  const rows = await getAll(`${V1}/courses/${await course(courseId)}/announcements`, { sort: 'modified(desc)' }, limit);
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    posted: a.availability?.duration?.start ?? a.created,
    modified: a.modified,
    body: text(a.body, 2000),
  }));
}

function shapeContent(c, courseId) {
  const embedded = parseEmbeddedFiles(c.body);
  return {
    id: c.id,
    title: c.title,
    type: c.contentHandler?.id,
    hasChildren: c.hasChildren ?? undefined,
    available: c.availability?.available,
    created: c.created,
    modified: c.modified,
    description: text(c.description, 500),
    body: text(c.body, 800),
    embeddedFiles: embedded.length ? embedded.map((f) => f.fileName) : undefined,
    link: c.contentHandler?.url,
    gradebookColumnId: c.contentHandler?.gradeColumnId,
    url: `${BASE_URL}/ultra/courses/${courseId}/outline`,
  };
}

export async function listContents({ courseId, contentId }) {
  const cid = await course(courseId);
  const base = `${V1}/courses/${cid}/contents`;
  const rows = await getAll(contentId ? `${base}/${encodeURIComponent(contentId)}/children` : base);
  return rows.map((c) => shapeContent(c, decodeURIComponent(cid)));
}

// Ultra keeps a folder's own page text in hidden "ultraDocumentBody" children,
// so an item's readable body is its own plus theirs.
async function documentBodies(base, c) {
  const bodies = [{ contentId: c.id, body: c.body }];
  if (c.hasChildren) {
    const kids = await getAll(`${base}/children`).catch(() => []);
    for (const k of kids) if (k.title === 'ultraDocumentBody') bodies.push({ contentId: k.id, body: k.body });
  }
  return bodies;
}

const embeddedFilesOf = (bodies) =>
  bodies.flatMap((b) => parseEmbeddedFiles(b.body).map((f) => ({ ...f, contentId: b.contentId })));

export async function getContent({ courseId, contentId }) {
  const cid = await course(courseId);
  const base = `${V1}/courses/${cid}/contents/${encodeURIComponent(contentId)}`;
  const c = await get(base);
  const bodies = await documentBodies(base, c);
  const out = shapeContent(c, decodeURIComponent(cid));
  out.body = text(bodies.map((b) => b.body).filter(Boolean).join('\n'), 20000);
  delete out.embeddedFiles;
  const attached = await getAll(`${base}/attachments`)
    .then((rows) => rows.map((a) => ({ id: a.id, fileName: a.fileName, mimeType: a.mimeType })))
    .catch(() => []);
  // Signed URLs expire, so embedded files get stable ids and are re-resolved on download.
  const embedded = embeddedFilesOf(bodies).map((f, i) => ({
    id: `embedded-${i}`,
    fileName: f.fileName,
    mimeType: f.mimeType,
    embedded: true,
  }));
  out.attachments = [...attached, ...embedded];
  return out;
}

const EMBEDDED_ID = /^embedded-(\d+)$/;

export async function downloadAttachment({ courseId, contentId, attachmentId }) {
  const base = `${V1}/courses/${await course(courseId)}/contents/${encodeURIComponent(contentId)}`;
  const m = EMBEDDED_ID.exec(attachmentId);
  if (m) {
    const c = await get(base);
    const file = embeddedFilesOf(await documentBodies(base, c))[Number(m[1])];
    if (!file) throw new Error(`No embedded file ${attachmentId} in this content item. Call learnjcu_get_content to list its files.`);
    return download(file.url, file.fileName);
  }
  const att = `${base}/attachments/${encodeURIComponent(attachmentId)}`;
  const meta = await get(att).catch(() => null);
  return download(`${att}/download`, meta?.fileName);
}

async function gradebook(courseId) {
  const cid = await course(courseId);
  const [columns, grades] = await Promise.all([
    getAll(`${V2}/courses/${cid}/gradebook/columns`),
    getAll(`${V1}/courses/${cid}/gradebook/users/${userId()}`).catch(() => []),
  ]);
  const byColumn = new Map(grades.map((g) => [g.columnId, g]));
  return columns.map((col) => {
    const g = byColumn.get(col.id);
    return {
      columnId: col.id,
      name: col.name,
      contentId: col.contentId,
      due: col.grading?.due,
      pointsPossible: col.score?.possible,
      visibleToStudents: col.availability?.available,
      graded: Boolean(g),
      status: g?.status,
      score: g?.score,
      grade: g?.displayGrade?.text ?? g?.text,
      feedback: text(g?.feedback, 1000),
    };
  });
}

export async function myGrades({ courseId }) {
  return gradebook(courseId);
}

export async function upcomingDeadlines({ days = 14, includePast = 0 } = {}) {
  const now = Date.now();
  const from = now - includePast * 86400000;
  const until = now + days * 86400000;
  const courses = await listCourses();
  const results = await pool(courses, 4, async (c) => ({ c, cols: await gradebook(c.id) }));
  const items = [];
  for (const r of results) {
    if (!r?.cols) continue;
    for (const col of r.cols) {
      const due = col.due ? Date.parse(col.due) : NaN;
      if (Number.isNaN(due) || due < from || due > until) continue;
      items.push({
        due: col.due,
        course: r.c.name,
        courseId: r.c.id,
        item: col.name,
        columnId: col.columnId,
        contentId: col.contentId,
        status: col.status,
        grade: col.grade,
      });
    }
  }
  const failed = results.filter((r) => r?.error).length;
  return {
    window: { from: new Date(from).toISOString(), until: new Date(until).toISOString() },
    coursesChecked: courses.length,
    coursesFailed: failed,
    items: items.sort((a, b) => a.due.localeCompare(b.due)),
  };
}

export async function calendar({ since, until }) {
  const s = since ? new Date(since) : new Date();
  const u = until ? new Date(until) : new Date(s.getTime() + 28 * 86400000);
  const rows = await getAll(`${V1}/calendars/items`, { since: s.toISOString(), until: u.toISOString() });
  return rows.map((i) => ({
    title: i.title,
    type: i.type,
    calendarId: i.calendarId,
    calendarName: i.calendarName,
    start: i.start,
    end: i.end,
    location: i.location,
    description: text(i.description, 500),
  }));
}

export async function rawGet({ path, params }) {
  const p = new URL(path, BASE_URL).pathname;
  if (!p.startsWith('/learn/api/public/')) {
    throw new Error('Only /learn/api/public/ endpoints are allowed');
  }
  return get(path, params);
}
