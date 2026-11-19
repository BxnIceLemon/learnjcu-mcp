## What changed

<!-- One or two sentences on what this PR does and why. -->

## How it was tested

- [ ] `npm test` passes
- [ ] Tried against a real JCU account (say which tools)

## Checklist

- [ ] No new non-GET requests outside `src/learnjcu-write.js` (apart from the read-only dashboard POSTs in `src/mystudent.js`)
- [ ] Any write is dry-runnable, confirmed in the CLI, and needs `confirm: true` in MCP
- [ ] Writes were tested only as dry runs, not on real coursework
- [ ] Session cookies still only go to their own site (`learn.jcu.edu.au`, `jcu.t1cloud.com`, `studentfirst.jcu.edu.sg`)
- [ ] No personal data (cookies, session files, saved pages, real names or IDs) in the diff
