// learnjcu CLI tests that need no account: help, usage errors and sign-in hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'learnjcu-cli2-test-'));

function cli(...args) {
  const r = spawnSync(process.execPath, ['src/learnjcu-cli.js', ...args], {
    encoding: 'utf8',
    env: { ...process.env, LEARNJCU_MCP_HOME: home, LEARNJCU_NO_AUTO_LOGIN: '1' },
    input: '',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('prints help', () => {
  const r = cli('--help');
  assert.equal(r.code, 0);
  assert.match(r.out, /learnjcu <command>/);
  assert.match(r.out, /submit <course> <assignment> \[file\.\.\.\]/);
});

test('unknown commands and missing arguments are usage errors', () => {
  assert.equal(cli('frobnicate').code, 2);
  const r = cli('submit', 'COMP1');
  assert.equal(r.code, 2);
  assert.match(r.err, /Usage: learnjcu submit/);
  assert.equal(cli('submissions').code, 2);
});

test('commands explain how to sign in when there is no session', () => {
  const r = cli('submit', 'COMP1', 'CW1', 'x.zip', '--dry-run');
  assert.equal(r.code, 1);
  assert.match(r.err, /learnjcu login/);
  assert.match(cli('status').out, /Not signed in/);
});

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('with several accounts, commands need --account when there is no terminal to ask in', () => {
  const multi = fs.mkdtempSync(path.join(os.tmpdir(), 'learnjcu-cli-accounts-'));
  try {
    for (const a of ['ab12cd', 'ef34gh']) fs.mkdirSync(path.join(multi, 'accounts', a), { recursive: true });
    const run = (bin, ...args) => {
      const env = { ...process.env, LEARNJCU_MCP_HOME: multi, LEARNJCU_NO_AUTO_LOGIN: '1' };
      delete env.LEARNJCU_ACCOUNT;
      const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env, input: '' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };

    for (const cmd of ['upcoming', 'submissions']) {
      const r = run('src/learnjcu-cli.js', cmd, ...(cmd === 'submissions' ? ['BU2001', 'Essay'] : []));
      assert.equal(r.code, 2, cmd);
      assert.match(r.err, /Several accounts are saved: ab12cd, ef34gh/);
      assert.match(r.err, /--account NAME/);
    }
    assert.match(run('src/learnjcu-cli.js', 'upcoming', '--account', 'ab12cd').err, /Not signed in to LearnJCU/);
    assert.equal(run('src/learnjcu-cli.js', 'upcoming', '--account', 'zz99zz').code, 2);

    const listed = run('src/learnjcu-cli.js', 'accounts');
    assert.equal(listed.code, 0);
    assert.match(listed.out, /ab12cd/);
    assert.match(listed.out, /ef34gh/);
    assert.equal(run('src/learnjcu-cli.js', 'status').code, 0);
    assert.match(run('src/learnjcu-cli.js', 'status', '--account', 'ab12cd').out, /Not signed in/);
  } finally {
    fs.rmSync(multi, { recursive: true, force: true });
  }
});
