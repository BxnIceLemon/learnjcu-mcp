// Browser selection without launching anything.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chooseBrowser, defaultBrowser, macHttpsHandler } from '../src/browser.js';

const saved = process.env.LEARNJCU_BROWSER;
afterEach(() => {
  if (saved === undefined) delete process.env.LEARNJCU_BROWSER;
  else process.env.LEARNJCU_BROWSER = saved;
});

test('LEARNJCU_BROWSER channel overrides the default browser', () => {
  process.env.LEARNJCU_BROWSER = 'chrome';
  const b = chooseBrowser();
  assert.equal(b.channel, 'chrome');
  assert.equal(b.source, 'LEARNJCU_BROWSER');
});

test('without an override, a Chromium default is used, else Edge/Chrome', () => {
  delete process.env.LEARNJCU_BROWSER;
  const def = defaultBrowser();
  const b = chooseBrowser();
  assert.ok(b.chromium);
  if (b.source === 'system default') {
    assert.equal(b.executablePath, def.executablePath);
  } else {
    assert.equal(b.source, 'fallback');
    assert.deepEqual(b.fallbackChannels, ['msedge', 'chrome']);
  }
});

test('reads the https handler from macOS settings, ignoring nested version blocks', () => {
  const plist = `(
        {
        LSHandlerContentType = "public.html";
        LSHandlerRoleAll = "com.apple.safari";
    },
        {
        LSHandlerModificationDate = 0;
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.microsoft.edgemac";
        LSHandlerURLScheme = https;
    }
)`;
  assert.equal(macHttpsHandler(plist), 'com.microsoft.edgemac');
  assert.equal(macHttpsHandler('{ LSHandlerRoleAll = "com.google.chrome"; LSHandlerURLScheme = https; }'), 'com.google.chrome');
  assert.equal(macHttpsHandler('{ LSHandlerRoleAll = "-"; LSHandlerURLScheme = https; }'), null);
  assert.equal(macHttpsHandler(''), null);
});

test('a hidden window sends the browser\'s own user agent, without "Headless"', async () => {
  const { visibleUserAgent } = await import('../src/browser.js');
  assert.equal(
    visibleUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0'),
    'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  );
  assert.equal(visibleUserAgent('Mozilla/5.0 Chrome/1.0'), 'Mozilla/5.0 Chrome/1.0');
});
