// Offline tests: no LearnJCU account needed. They start the real
// server over stdio with an empty session folder and check the guards.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'learnjcu-mcp-test-'));
const client = new Client({ name: 'test', version: '0' });

before(async () => {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['src/server.js'],
      env: { ...process.env, LEARNJCU_MCP_HOME: home, TMPDIR: home, LEARNJCU_NO_UPDATE_CHECK: '1', LEARNJCU_NO_AUTO_LOGIN: '1' },
    }),
  );
});

after(async () => {
  await client.close();
  fs.rmSync(home, { recursive: true, force: true });
});

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), text: r.content[0].text };
}

const WRITE_TOOLS = ['learnjcu_submit', 'learnjcu_update'];

test('registers every read and write tool by default', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.equal(names.length, 18);
  assert.ok(names.every((n) => n.startsWith('learnjcu_')), 'every tool is a learnjcu_ tool');
  for (const n of ['learnjcu_login', 'learnjcu_list_submissions', ...WRITE_TOOLS]) {
    assert.ok(names.includes(n), n);
  }
  // Only the write tools are marked as changing anything.
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint === false && t.name !== 'learnjcu_download_attachment', WRITE_TOOLS.includes(t.name), t.name);
  }
  assert.equal(tools.find((t) => t.name === 'learnjcu_submit').annotations.destructiveHint, true);
});

test('write tools refuse to send without confirm: true', async () => {
  const cases = [
    ['learnjcu_submit', { courseId: 'BU2001', assignment: 'Essay', files: ['x.pdf'] }],
    ['learnjcu_update', {}],
  ];
  for (const [name, args] of cases) {
    for (const extra of [{}, { confirm: false }]) {
      const r = await call(name, { ...args, ...extra });
      assert.ok(r.isError, name);
      assert.match(r.text, /Not sent/, name);
    }
  }
});

test('reports not signed in when no session is saved', async () => {
  assert.equal(JSON.parse((await call('learnjcu_status')).text).signedIn, false);
});

test('tools fail with a login hint instead of crashing', async () => {
  const m = await call('learnjcu_list_courses');
  assert.ok(m.isError);
  assert.match(m.text, /learnjcu_login tool/);
  assert.match(m.text, /npm run login/);
});

test('raw API tool refuses other hosts and non-public paths', async () => {
  fs.mkdirSync(path.join(home, 'accounts', 'ab12cd'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'accounts', 'ab12cd', 'session.json'),
    JSON.stringify({ cookies: [{ name: 'x', value: 'y', domain: 'learn.jcu.edu.au', path: '/' }], userId: '_1_1' }),
  );
  const evil = await call('learnjcu_api_get', { path: 'https://evil.example.com/learn/api/public/v1/users/me' });
  assert.ok(evil.isError);
  assert.match(evil.text, /Refusing to send the LearnJCU session/);
  const internal = await call('learnjcu_api_get', { path: '/webapps/blackboard/execute' });
  assert.ok(internal.isError);
  assert.match(internal.text, /Only \/learn\/api\/public\//);
});
