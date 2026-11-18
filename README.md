# learnJCU MCP

**English** | [简体中文](README_zh.md)

An unofficial MCP server and command-line tool for LearnJCU, James Cook University's Blackboard Learn Ultra site (`learn.jcu.edu.au`). You sign in yourself in a real browser window, and the tools reuse that session. Data comes from Blackboard's REST API.

It reads your subjects, announcements, content, grades, deadlines and calendar. The only action that changes anything is submitting files or text to an Ultra assignment.

## Security

- Sign-in happens in your system default browser (Edge, Chrome, Brave and other Chromium browsers), on JCU's own sign-in page. You type your password there yourself; the code never sees it.
- Each saved account has its own browser profile (`~/.learnjcu-mcp/accounts/<account>/browser-profile`), separate from your everyday profile. The tools never read your normal browser's cookies or saved passwords.
- Sessions are saved per account in `~/.learnjcu-mcp/accounts/<account>/session.json`, so several people's sign-ins never mix. None of this is inside the project folder.
- Requests only go to `learn.jcu.edu.au`. When a file download redirects to Blackboard's file host, the session cookie is dropped. The one exception is the update check: a single request to `api.github.com` per start, with no cookies or account data (see [Updates](#updates)).
- Only GET requests, except submitting to an assignment:
  - In the CLI, `submit` shows what it will send and asks `[y/N]` first. `--dry-run` only shows the plan.
  - In MCP, `learnjcu_submit` needs `confirm: true`, and the agent is told to show you a dry run and get your yes first. Without `confirm: true` nothing is sent.
- There is no telemetry.

## Usage

Run these commands inside this folder:

```bash
npm install
npm run login     # opens a browser; sign in to LearnJCU and the window closes itself
npm run check     # prints your name and current subjects
```

The login opens your default browser at LearnJCU, which sends you to JCU's sign-in page.

Sessions expire after a few hours, but you rarely need to sign in again:

- **Silent refresh.** Every login first tries a hidden window. If the sign-in page still remembers you, the session is renewed in a few seconds with no window.
- **CLI.** When a `learnjcu` command finds its session expired, it refreshes silently and retries. If you have to sign in, it asks whether to open the sign-in page.
- **Agent.** When an MCP tool finds its session expired, the server first renews it silently with that account's browser profile and runs the call again, so you usually notice nothing. A submission is not re-run by itself; the agent calls it again. Only if that doesn't work does the tool report the expired session, and the agent (any MCP client) then calls `learnjcu_login`, which opens the sign-in page and asks you to finish.

### Several accounts

Each account is saved apart from the others: its session and its own browser profile live in `~/.learnjcu-mcp/accounts/<username>/`.

```bash
npm run login                              # first account (named after your LearnJCU username)
npm run login -- --new-account             # sign in someone else and save them as another account
learnjcu accounts                          # list saved accounts
learnjcu upcoming --account jc123456       # use one account for a command (or set LEARNJCU_ACCOUNT)
```

- With one saved account, everything uses it.
- With several and none chosen, a command in a terminal asks which one to use; without a terminal it stops and asks for `--account`.
- In MCP, the server asks you through your client's prompt (if the client supports MCP elicitation) and keeps your answer for the session. Otherwise the agent is told to ask you, then passes `account`. `learnjcu_list_accounts` and `learnjcu_select_account` list and switch accounts.
- A sign-in for an existing account that turns out to be a different person is refused, so one account's folder never holds someone else's session.

## LearnJCU CLI

`npm link` makes the `learnjcu` command available everywhere. Or run `node src/learnjcu-cli.js`.

```bash
learnjcu login                                     # sign in (same as npm run login)
learnjcu upcoming --days 14                        # gradebook items due soon, across your subjects
learnjcu submissions BU2001 Essay                  # an assignment's settings and your attempts on it
learnjcu submit BU2001 Essay report.pdf --dry-run  # show what would be sent
learnjcu submit BU2001 Essay report.pdf            # submit as a new attempt (asks first)
learnjcu submit BU2001 Reflection -m "My answer"   # text only
```

- `<course>` can be a subject code like `BU2001` (matched to your newest subject site with that code), a full code like `26-BU2001-SIN-CAM-TR3`, or a course id like `_123456_1`.
- `<assignment>` is a unique part of its title, or its content or column id.
- `submit` works on Ultra assignments without questions (the ones where you add files or text and press Submit). Each run is a new attempt, so check how many attempts the assignment allows: `submissions` shows it.
- Files are uploaded as they are. Assignments with questions, group assignments, and ones that need a password or a secure browser are refused; use the browser for those. So are items that link to an external tool (such as Turnitin).
- After submitting, the command checks that the receipt lists the uploaded files.

## Updates

Each time the MCP server starts, it checks once whether GitHub's `main` branch has a newer version than the copy it runs from. If it does, the first tool answer tells the agent which changes are new; the agent explains them and asks whether you want to update. It only updates after your yes: `learnjcu_update` shows a dry run, then fetches `main`, switches to it and runs `npm install`. Restart your MCP client afterwards.

- The check is one request to `api.github.com` with the commit id this copy runs. No cookies or account data are sent.
- It needs a git checkout of the GitHub repository. Other copies are never flagged.
- Set `LEARNJCU_NO_UPDATE_CHECK=1` to turn it off.

## Add to an MCP client

Most MCP clients accept a stdio server in this JSON form (in the client's MCP settings file, or a project's `.mcp.json`):

```json
{
  "mcpServers": {
    "learnjcu": {
      "command": "node",
      "args": ["<absolute path to this folder>/src/server.js"]
    }
  }
}
```

Restart the client afterwards.

## Add to Codex

```bash
codex mcp add learnjcu -- node "<absolute path to this folder>/src/server.js"
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.learnjcu]
command = "node"
args = ["<absolute path>/src/server.js"]
tool_timeout_sec = 300   # waiting for a sign-in can take longer than Codex's 60 s default
```

## MCP tools

| Tool | What it does |
| --- | --- |
| `learnjcu_list_accounts` | List saved accounts and which one this session uses |
| `learnjcu_select_account` | Choose the account for the rest of the session (after asking the user) |
| `learnjcu_status` | Check whether you're signed in and when the session expires (lists every account when none is chosen) |
| `learnjcu_login` | Refresh or start a sign-in; opens your default browser if you need to act |
| `learnjcu_whoami` | Show the signed-in user |
| `learnjcu_list_courses` | List your subjects and other sites, subject sites first |
| `learnjcu_list_announcements` | Announcements for a subject |
| `learnjcu_list_contents` | Subject outline and folder contents |
| `learnjcu_get_content` | Full text of one content item, plus its attachments and files embedded in the page |
| `learnjcu_download_attachment` | Download an attachment or embedded file to `~/Downloads/learnjcu` |
| `learnjcu_my_grades` | Gradebook: due dates, submission status, scores and feedback |
| `learnjcu_upcoming_deadlines` | Items due in the next N days across all current subjects |
| `learnjcu_calendar` | Calendar events |
| `learnjcu_list_submissions` | An assignment's submission settings and your attempts, with receipts and files |
| `learnjcu_submit` | Submit files or text to an Ultra assignment (needs `confirm: true`) |
| `learnjcu_api_get` | GET any `/learn/api/public/` endpoint directly |
| `learnjcu_check_update` | Check GitHub for a newer version and list what it adds |
| `learnjcu_update` | Update this copy to the latest version (needs `confirm: true`) |

## Environment variables

- `LEARNJCU_BROWSER`: the browser for sign-in, as a path to its executable or a channel (`msedge`, `chrome`). Defaults to your system default browser. If that is Firefox or Safari, which can't be automated, an installed Edge or Chrome is used instead.
- `LEARNJCU_MCP_HOME`: the session folder. Defaults to `~/.learnjcu-mcp`.
- `LEARNJCU_DOWNLOAD_DIR`: the download folder. Defaults to `~/Downloads/learnjcu`.
- `LEARNJCU_ACCOUNT`: the saved account to use, instead of being asked. Same as `--account`.
- `LEARNJCU_NO_AUTO_LOGIN`: set to `1` to stop the CLI and the MCP server from refreshing an expired session by themselves.
- `LEARNJCU_NO_UPDATE_CHECK`: set to `1` to stop the MCP server from checking GitHub for a newer version when it starts.

## Known limitations

- Adapted from [minerva-mcp](https://github.com/BxnIceLemon/minerva-mcp), which works with the same Blackboard Learn Ultra platform at the University of Leeds. The LearnJCU API was checked with a student account: profile, enrolled subjects, gradebook columns, content, announcements and calendar all answer the same way.
- Sign-in needs a computer with a screen; there is no terminal-only sign-in.
- Submitting has not been sent for real on LearnJCU yet. It sends the requests the Blackboard Ultra web page sends on Minerva, where it was tested; LearnJCU runs the same Ultra version family, but check with a dry run first.
- Content inside third-party LTI tools such as Turnitin and Echo360 is not available.
- Please use this responsibly and follow JCU's IT and academic integrity policies.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security problems go through [SECURITY.md](SECURITY.md).

## License

[ISC](LICENSE)
