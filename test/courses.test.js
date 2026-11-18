// JCU course codes: matching a subject code and ordering the course list.
// Made-up codes; no account needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSubjectCode, codeMatches, compareCourses } from '../src/learnjcu.js';

test('recognises subject sites by their code', () => {
  assert.equal(isSubjectCode('26-BU2001-SIN-CAM-TR3'), true);
  assert.equal(isSubjectCode('25-CP1404-TSV-EXT-SP2'), true);
  assert.equal(isSubjectCode('SMARTS'), false);
  assert.equal(isSubjectCode('academic_integrity_student'), false);
  assert.equal(isSubjectCode(undefined), false);
});

test('a subject code, or the full code, names a course; partial text does not', () => {
  const code = '26-BU2001-SIN-CAM-TR3';
  assert.equal(codeMatches(code, 'BU2001'), true);
  assert.equal(codeMatches(code, 'bu2001'), true);
  assert.equal(codeMatches(code, ' 26-BU2001-SIN-CAM-TR3 '), true);
  assert.equal(codeMatches(code, 'BU200'), false);
  assert.equal(codeMatches(code, 'BU2001-SIN'), false);
  assert.equal(codeMatches('SMARTS', 'smarts'), true);
  assert.equal(codeMatches(code, ''), false);
});

test('lists subject sites first, newest year and period first, then other sites by name', () => {
  const courses = [
    { code: 'SMARTS', name: 'Student Modules' },
    { code: '25-BU1112-SIN-MML-TR3', name: 'Business Law' },
    { code: '26-TO2051-SIN-CAM-TR1', name: 'Tourism' },
    { code: 'EMP-WIL-JCUS', name: 'Employability' },
    { code: '26-BU2001-SIN-CAM-TR3', name: 'Future of Work' },
  ];
  assert.deepEqual(courses.sort(compareCourses).map((c) => c.code), [
    '26-BU2001-SIN-CAM-TR3',
    '26-TO2051-SIN-CAM-TR1',
    '25-BU1112-SIN-MML-TR3',
    'EMP-WIL-JCUS',
    'SMARTS',
  ]);
});
