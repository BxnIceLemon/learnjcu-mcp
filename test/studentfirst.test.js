// StudentFirst pages parsed from made-up HTML shaped like the real site
// (PrimeFaces tables, accordions and session boxes). No account needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHome, parseLeave, parseNotices, isLoginPage } from '../src/studentfirst.js';

const box = (date, time, where, badge) =>
  `<label class="ui-outputlabel ui-widget">${
    badge ? `<div class="ui-overlay-badge"><span class="ui-badge ui-widget mr-3 mt-2 ui-badge-${badge[0]}"><span class="ui-badge-icon pi pi-${badge[1]}"></span></span>` : ''
  }<div class="border-dashed surface-overlay flex">${date}<br />${time}<br />${where}</div>${badge ? '</div>' : ''}</label>`;

const HOME = `<html><body>
<div class="layout-topbar">Home Timetable Logout</div>
<div>Welcome Alex Example  </div>
<div id="j_idt47:sf_datatable_sevendaychedule" class="ui-datatable"><div class="ui-datatable-tablewrapper"><table role="grid">
<thead><tr><th><span class="ui-column-title">Classcode</span></th><th><span class="ui-column-title">Date</span></th><th><span class="ui-column-title">Time</span></th><th><span class="ui-column-title">Hall</span></th></tr></thead>
<tbody><tr><td role="gridcell">AB1001-TA</td><td role="gridcell">02 Mar 2026</td><td role="gridcell">09:00:00-11:00:00</td><td role="gridcell">C1-01</td></tr>
<tr><td role="gridcell">AB1001-LA</td><td role="gridcell">03 Mar 2026</td><td role="gridcell">10:00:00-11:00:00</td><td role="gridcell">Online Class</td></tr></tbody></table></div></div>
<ul class="list-none">
  <li><img src="lecture.png" /><span>AB1001 - Example Subject - Lecture</span></li>
  <li><span>AB1001-LA</span></li>
  <li><div class="ui-accordion"><div class="ui-accordion-header">View Details</div><div class="ui-accordion-content">
    <div class="flex flex-wrap">${box('02-Feb', '1000-1100', 'Online Class', ['success', 'check'])}${box('09-Feb', '1000-1100', 'Online Class', ['danger', 'times'])}${box('16-Feb', '1000-1100', 'Online Class')}</div>
  </div></div></li>
  <li><img src="tutorial.png" /><span>AB1001 - Example Subject - Tutorial</span></li>
  <li><span>AB1001-TA</span></li>
  <li><div class="ui-accordion"><div class="ui-accordion-header">View Details</div><div class="ui-accordion-content">
    <div class="flex flex-wrap">${box('03-Feb', '0900-1100', 'C1-01', ['success', 'check'])}</div>
  </div></div></li>
</ul>
<div class="shadow-2"><div class="text-900">Class Attendance</div><div class="text-600">A Minimum of 90% attendance is mandatory for classes.</div>
  <div><label><span>Your overall class attendance is</span><span class="font-bold">87.5%</span></label></div></div>
<div class="shadow-2"><div class="text-900">Campus Attendance</div><label><div class="text-600">A Minimum of 90% campus attendance is mandatory.</div>
  <div><label><span>Your overall campus attendance is</span><span class="font-bold">95.0%</span></label></div></label></div>
<label>Online classes and Campus Attendance last updated on: <strong>2026-03-01</strong>.</label>
</body></html>`;

test('reads the next classes, overall attendance and each session', () => {
  const r = parseHome(HOME);
  assert.equal(r.name, 'Alex Example');
  assert.deepEqual(r.upcoming[0], { class: 'AB1001-TA', date: '02 Mar 2026', time: '09:00:00-11:00:00', location: 'C1-01' });
  assert.equal(r.upcoming.length, 2);
  assert.deepEqual(r.attendance.class, { percent: 87.5, minimum: 90 });
  assert.deepEqual(r.attendance.campus, { percent: 95, minimum: 90 });
  assert.equal(r.attendance.lastUpdated, '2026-03-01');

  assert.deepEqual(r.classes.map((c) => c.class), ['AB1001-LA', 'AB1001-TA']);
  const lecture = r.classes[0];
  assert.equal(lecture.title, 'AB1001 - Example Subject - Lecture');
  assert.deepEqual([lecture.total, lecture.present, lecture.absent, lecture.notRecorded], [3, 1, 1, 1]);
  assert.deepEqual(lecture.sessionList[1], { date: '09-Feb', time: '1000-1100', location: 'Online Class', status: 'absent' });
  assert.equal(lecture.sessionList[2].status, 'not recorded');
  assert.equal(r.classes[1].sessionList[0].location, 'C1-01');
});

test('reads leave applications, and an empty table as none', () => {
  const table = (rows) => `<table><thead><tr>${['Application ID', 'Start Date', 'End Date', 'Request Details', 'Status', 'Approved Start Date', 'Approved End Date']
    .map((h) => `<th><span class="ui-column-title">${h}</span></th>`)
    .join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  assert.deepEqual(parseLeave(table('<tr class="ui-widget-content ui-datatable-empty-message"><td colspan="7">No records found.</td></tr>')), []);
  const r = parseLeave(table('<tr><td>L-1</td><td>01/03/2026</td><td>02/03/2026</td><td>Medical</td><td>Approved</td><td>01/03/2026</td><td></td></tr>'));
  assert.deepEqual(r, [{ id: 'L-1', start: '01/03/2026', end: '02/03/2026', details: 'Medical', status: 'Approved', approvedStart: '01/03/2026', approvedEnd: undefined }]);
});

test('turns the notice panel into lines of text', () => {
  const html = `<div id="studentfirst_notification_panel1_content"><form><button>Export to PDF</button></form>
    <div id="studentfirst_notification_panel2_content"><p>First paragraph.</p><table><tr><td>2026</td><td>Holiday A<br/>Holiday B</td></tr></table></div></div>`;
  assert.equal(parseNotices(html), 'First paragraph.\n2026 Holiday A\nHoliday B');
});

test('recognises the sign-in page', () => {
  assert.equal(isLoginPage('<input name="j_idt21:sf_loginform_password" type="password">'), true);
  assert.equal(isLoginPage(HOME), false);
});
