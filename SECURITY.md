# Security Policy

This project handles University login sessions, so security reports are taken seriously.

## Reporting a vulnerability

Please **do not** open a public issue. Report it privately through the repository's
GitHub private vulnerability reporting (Security → Report a vulnerability) with:

- what the problem is and what an attacker could do with it
- steps to reproduce
- the version or commit you tested

You should get a reply within 7 days.

## What counts

- A way for session cookies to leave `learn.jcu.edu.au`
- The update check sending anything to `api.github.com` beyond the commit id, or updating without the user's confirmation
- A way to send a non-GET request other than the assignment submission in `src/learnjcu-write.js`
- A way for a submission to send without confirmation: skipping the CLI prompt, or the MCP tool sending without `confirm: true`
- A way for a submission to include files the user didn't name
- Session files or browser profiles being readable by other users, or being written into the project folder
- One saved account's session or browser profile being used for, or saved into, another account
- Path traversal in attachment downloads

## Please never share

Do not include your session files (`~/.learnjcu-mcp/accounts/*/session.json`), cookies, passwords or student ID in a report.
