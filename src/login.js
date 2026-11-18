#!/usr/bin/env node
// Signs in to LearnJCU: `node src/login.js` (or `npm run login`). Tries a silent
// refresh first, then opens your default browser for you to sign in.
import { runLoginCli } from './login-cli.js';

process.exitCode = await runLoginCli('learnjcu');
