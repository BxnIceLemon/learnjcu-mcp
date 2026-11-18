# Contributing

Thanks for helping. A few rules keep this project safe for everyone who signs in with it.

## Workflow

1. Create a branch from `main`.
2. Make your change and run `npm test`.
3. Open a pull request. CI must pass before it can be merged. PRs are squash-merged.

## Ground rules

- **Writes stay narrow.** The only action that changes anything is submitting to an Ultra assignment, in `src/learnjcu-write.js`. A new write action needs a strong reason, and it must:
  - support a dry run
  - ask for confirmation in the CLI
  - in MCP, require `confirm: true` (and send nothing without it)
- **Never test writes against real coursework.** Use dry runs.
- **Stay on one host.** Session cookies must only ever go to `learn.jcu.edu.au`.
- **No personal data in the repo.** Never commit session files, cookies, saved HTML pages, screenshots or tool output from your account. Build test fixtures by hand with fake names and IDs.
- **Match the existing style.** Plain ES modules, no build step, small focused files.

## Testing against a real account

`npm test` runs offline. To check your change against LearnJCU, run `npm run login` and `npm run check`, then try the tools from an MCP client or the `learnjcu` CLI. Describe what you tested in the PR, without pasting personal data.
