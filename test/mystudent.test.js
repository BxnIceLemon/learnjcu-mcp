// MyStudent dashboard tiles and the My Study page, parsed from made-up HTML
// and text shaped like the real portal. No account needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTile, parseStudyPlan } from '../src/mystudent.js';

const item = (header, lines = []) =>
  `<div class="hyperTextItem"><div class="content"><span class="header fontLabel"><span class="leftContent">${header}</span></span>${lines
    .map((l) => `<span class="lineItem"><span class="leftContent">${l}</span></span>`)
    .join('')}</div></div>`;

const tile = ({ count = '', headline = '', tabs }) => `
<div class="activeTileHeader"><div role="heading"><span class="actCount marginR5">${count}</span><span>${headline}</span></div></div>
<div class="activeTileBody"><div class="hyperTabHandles">${tabs.map((t) => `<div class="hTabHandle"><span class="htHandleLabel fontLabel">${t.name}</span></div>`).join('')}</div>
<div class="hyperTabsContent">${tabs
  .map(
    (t) =>
      `<div class="hTabContent"><div class="hTabContentBody">${t.body}</div><div class="hTabContentActions"><a class="dataItem" href="#"><span>View all</span></a></div></div>`,
  )
  .join('')}</div></div>`;

test('reads a tile with a count, tabs, items and an empty tab', () => {
  const r = parseTile(
    tile({
      count: '1',
      headline: 'Awaiting response',
      tabs: [
        { name: 'Summary', body: item('Confirm your details', ['2 tasks completed', '1 task outstanding']) },
        { name: 'Due Soon', body: '<div class="emptyMessage">No data available</div>' },
      ],
    }),
  );
  assert.deepEqual(r, {
    count: 1,
    headline: 'Awaiting response',
    tabs: [
      { tab: 'Summary', items: [{ header: 'Confirm your details', lines: ['2 tasks completed', '1 task outstanding'] }] },
      { tab: 'Due Soon', empty: true },
    ],
  });
});

test('drops links that only open a page, keeps a zero count', () => {
  const r = parseTile(
    tile({ count: '0', headline: 'Activities Today', tabs: [{ name: 'My Finances', body: item('View my finances') + item('Make a general payment') + item('Balance', ['$0.00']) }] }),
  );
  assert.equal(r.count, 0);
  assert.deepEqual(r.tabs[0].items, [{ header: 'Balance', lines: ['$0.00'] }]);
  assert.deepEqual(parseTile(''), { tabs: [] });
});

const STUDY_PAGE = `Change to Accessibility Mode
JCU MyStudent
My Study
10000001 | Mx Alex Example
12345 - Bachelor of Examples | 72 Credit Points | Townsville | Standard
Manage My Course
Current Course Structure
Bachelor of Examples
12345-OPT1 - BEx - Option 1 (Electives)
View
Select one Level 2 subject
Selection Made
View
General advanced standing - 3 Credit Points
You have been granted credits towards your plan.
AB1001 - Example Subject
Core, Enrolled in 2026, Trimester 1, Townsville
View
AB1002 - Another Subject
Core, Exempt in 2026, Not entered, Not entered
View
AB2001 - Later Subject
Option, Not enrolled. Scheduled in 2027, Trimester 2, Townsville
View
AB1003 - Finished Subject
Core, Passed in 2025, Trimester 2, Townsville
View
General advanced standing - 6 Credit Points
JCU Student Support`;

test('reads the course and every subject with its status from the My Study page', () => {
  const r = parseStudyPlan(STUDY_PAGE);
  assert.equal(r.student, 'Mx Alex Example');
  assert.equal(r.course, '12345 - Bachelor of Examples');
  assert.equal(r.campus, 'Townsville');
  assert.equal(r.advancedStandingCreditPoints, 9);
  assert.deepEqual(r.structures, ['12345-OPT1 - BEx - Option 1 (Electives)']);
  assert.deepEqual(r.subjects[0], { code: 'AB1001', name: 'Example Subject', kind: 'Core', status: 'Enrolled in 2026, Trimester 1, Townsville' });
  assert.deepEqual(r.summary, { enrolled: ['AB1001'], completed: ['AB1003'], exempt: ['AB1002'], planned: ['AB2001'] });
});

test('reads only the pages and sections it knows, before touching the network', async () => {
  const { readPage, PAGES } = await import('../src/mystudent.js');
  assert.deepEqual(Object.keys(PAGES.details.sections), ['summary', 'contacts', 'education', 'sanctions', 'communication', 'forms']);
  await assert.rejects(readPage({ page: 'payments' }), /Unknown MyStudent page "payments"/);
  await assert.rejects(readPage({ page: 'details', section: 'bank' }), /has the sections summary, contacts/);
  await assert.rejects(readPage({ page: 'tasks', section: 'x' }), /has no sections/);
  // Every section is a tab handle id; nothing else on a page is ever clicked.
  for (const p of Object.values(PAGES)) for (const id of Object.values(p.sections ?? {})) assert.match(id, /^Tab_\w+Section$/);
});
