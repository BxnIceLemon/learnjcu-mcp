#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ElicitResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as learnjcu from './learnjcu.js';
import * as learnjcuWrite from './learnjcu-write.js';
import * as mystudent from './mystudent.js';
import * as studentfirst from './studentfirst.js';
import { loadSession } from './session.js';
import { agentLogin, pendingLogin, withSessionRefresh } from './login-manager.js';
import { checkForUpdate, applyUpdate } from './update.js';
import {
  listAccounts,
  accountInfo,
  accountExists,
  currentAccount,
  selectAccount,
  selectedAccount,
  withAccount,
  sessionFile,
  AccountChoiceError,
} from './accounts.js';

const server = new McpServer({ name: 'learnjcu', version: '0.1.0' });

const courseId = z
  .string()
  .describe('Course primary id like "_123456_1" (from learnjcu_list_courses), a subject code like "BU2001", or the full course code');

const accountParam = z
  .string()
  .optional()
  .describe('Saved account to use (see learnjcu_list_accounts). Only needed when several accounts are saved and the user has not chosen one yet.');

function accountLabel(name) {
  const a = accountInfo(name);
  return a.displayName && a.displayName !== name ? `${name} (${a.displayName})` : name;
}

const NEW_ACCOUNT = '+new';

// Asks the user, through the MCP client's own prompt (elicitation), which saved
// account to use. Returns the account, NEW_ACCOUNT, or null when the client
// can't ask or the user dismissed it.
async function askUser(accounts, { purpose, allowNew = false }) {
  if (!server.server.getClientCapabilities()?.elicitation) return null;
  const options = [...accounts, ...(allowNew ? [NEW_ACCOUNT] : [])];
  try {
    const r = await server.server.request(
      {
        method: 'elicitation/create',
        params: {
          message:
            `Several University accounts are saved: ${accounts.map(accountLabel).join(', ')}. Which one should ${purpose}?` +
            (allowNew ? ` Choose "${NEW_ACCOUNT}" to sign in with another account.` : ''),
          requestedSchema: {
            type: 'object',
            properties: { account: { type: 'string', title: 'Account', enum: options } },
            required: ['account'],
          },
        },
      },
      ElicitResultSchema,
    );
    const pick = r.action === 'accept' ? r.content?.account : null;
    return options.includes(pick) ? pick : null;
  } catch {
    return null;
  }
}

function choiceNeeded(accounts, { allowNew = false } = {}) {
  return new Error(
    `Several accounts are saved: ${accounts.map(accountLabel).join(', ')}. Ask the user which account to use, then call this tool again with ` +
      `account set to it${allowNew ? ' (or newAccount: true to add another account)' : ''}. ` +
      'To use it for the rest of the session, call learnjcu_select_account.',
  );
}

// The account a tool call works on: `account` if given, else the chosen or
// only saved account. With several accounts, the user is asked, and their
// answer is kept for the rest of the session. null when none is saved yet.
async function resolveAccount(account, purpose) {
  if (account) {
    if (!accountExists(account)) throw new Error(`No saved account "${account}". Saved: ${listAccounts().join(', ') || 'none'}`);
    return account;
  }
  try {
    return currentAccount();
  } catch (e) {
    if (!(e instanceof AccountChoiceError)) throw e;
    const pick = await askUser(e.accounts, { purpose });
    if (!pick) throw choiceNeeded(e.accounts);
    selectAccount(pick);
    return pick;
  }
}

// The update check starts with the server. Its result is added once, to the
// first tool call that comes after it is ready, so the agent can tell the user.
const updateCheck = checkForUpdate();
let updateReady = false;
let updateShown = false;
updateCheck.then(() => (updateReady = true));

function describeUpdate(u) {
  return (
    `learnjcu-mcp update available: this copy (${u.current.commit}, ${u.current.date}) is ${u.behindBy} commit(s) behind ` +
    `the latest version on GitHub (${u.latest.commit}, ${u.latest.date}).\n` +
    'After you handle the request below, tell the user that an update is available, explain in plain words what the new ' +
    'version adds compared with theirs (use the titles and details of the changes listed here), and ask whether they want ' +
    'to update. Only if they say yes: call learnjcu_update with dryRun: true, show them the plan, then call it with ' +
    'confirm: true. Never update without their yes. They must restart the MCP client afterwards.' +
    (u.note ? `\nNote: ${u.note}` : '') +
    `\n${JSON.stringify({ current: u.current, latest: u.latest, changes: u.changes, compareUrl: u.compareUrl }, null, 2)}`
  );
}

async function updateNotice() {
  if (updateShown) return null;
  // Wait briefly on the first call; if GitHub is slow, a later call shows it.
  const u = await Promise.race([updateCheck, new Promise((r) => setTimeout(() => r(undefined), 3000))]);
  if (u === undefined && !updateReady) return null;
  updateShown = true;
  return u?.updateAvailable ? describeUpdate(u) : null;
}

/**
 * Registers a tool. Unless `accounts: false`, it takes an optional `account`
 * and runs as that account (see resolveAccount); fn gets (args, account).
 */
function tool(name, description, inputSchema, fn, annotations, { accounts = true } = {}) {
  // Tools registered with readOnlyHint: false change something; the rest are
  // safe to run again (downloads included).
  const rerun = annotations?.readOnlyHint !== false;
  server.registerTool(
    name,
    {
      description,
      inputSchema: accounts ? { ...inputSchema, account: accountParam } : inputSchema,
      annotations: annotations ?? { readOnlyHint: name !== 'learnjcu_download_attachment', openWorldHint: true },
    },
    async (args) => {
      let response;
      try {
        let result;
        if (accounts) {
          const { account, ...rest } = args ?? {};
          const acct = await resolveAccount(account, `be used for ${name}`);
          result = await withSessionRefresh(() => withAccount(acct, () => fn(rest, acct)), acct, { rerun });
        } else {
          result = await fn(args ?? {});
        }
        response = { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        response = { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      }
      const notice = name === 'learnjcu_check_update' || name === 'learnjcu_update' ? null : await updateNotice();
      if (notice) response.content.unshift({ type: 'text', text: notice });
      return response;
    },
  );
}

tool(
  'learnjcu_list_accounts',
  'List the saved University accounts (each has its own sign-in) and which one is chosen for this session. ' +
    'Use when the user asks which accounts are saved, or before asking them which account to use.',
  {},
  () => ({ selected: selectedAccount(), accounts: listAccounts().map(accountInfo) }),
  { readOnlyHint: true, openWorldHint: false },
  { accounts: false },
);

tool(
  'learnjcu_select_account',
  'Choose which saved account the other tools use for the rest of this session. ' +
    'Call it after the user has said which account they mean; never pick one for them.',
  { account: z.string().describe('A saved account name from learnjcu_list_accounts') },
  ({ account }) => {
    selectAccount(account);
    return accountInfo(account);
  },
  { readOnlyHint: true, openWorldHint: false },
  { accounts: false },
);

// Status tools report on every account instead of asking which one.
function statusOf(service, account, fn) {
  if (account && !accountExists(account)) throw new Error(`No saved account "${account}". Saved: ${listAccounts().join(', ') || 'none'}`);
  let name = account;
  if (!name) {
    try {
      name = currentAccount();
    } catch (e) {
      if (!(e instanceof AccountChoiceError)) throw e;
      return {
        accounts: e.accounts.map((a) => ({ account: a, ...accountInfo(a)[service], loginInProgress: pendingLogin(service, a) })),
        note: 'Several accounts are saved and none is chosen. Ask the user which one they mean before using the other tools.',
      };
    }
  }
  if (!name) return { signedIn: false, fix: `Call the ${service}_login tool to sign in.` };
  return withAccount(name, () => ({ account: name, ...fn(), loginInProgress: pendingLogin(service, name) }));
}

const SERVICES = [
  ['learnjcu', 'LearnJCU'],
  ['mystudent', 'MyStudent'],
  ['studentfirst', 'StudentFirst'],
];

for (const [service, label] of SERVICES) {
  tool(
    `${service}_status`,
    `Check whether a ${label} session is saved${service === 'studentfirst' ? '' : ' and when it expires'}. With several saved accounts and none chosen, it lists them all.`,
    { account: accountParam },
    ({ account }) =>
      statusOf(service, account, () => {
        const s = loadSession(sessionFile(service));
        if (!s) return { signedIn: false, fix: `Call the ${service}_login tool.` };
        return {
          signedIn: true,
          userName: s.userName,
          displayName: s.displayName,
          savedAt: s.savedAt,
          expiresAt: s.expiresAt,
          ...(service === 'studentfirst' ? { note: 'StudentFirst sessions end after a while without use; the tools refresh them by themselves when they can.' } : {}),
        };
      }),
    undefined,
    { accounts: false },
  );
}

const waitSeconds = z
  .number()
  .int()
  .min(0)
  .max(240)
  .optional()
  .describe('How long to wait for the sign-in to finish before returning (default 45, which fits the 60 s default tool timeout of Codex)');

const LOGIN_NOTES = {
  learnjcu: '',
  mystudent: 'MyStudent uses the same JCU single sign-on as LearnJCU, so this is usually silent. ',
  studentfirst:
    'StudentFirst (JCU Singapore) has its own user name and password, not the JCU single sign-on. When a window opens, ask the user to sign in there ' +
    'and to let the browser save the password, so later refreshes need nothing from them. ',
};

for (const [service, label] of SERVICES) {
  tool(
    `${service}_login`,
    `Sign in to ${label} or refresh an expired session. Call this whenever a ${label} tool says the session expired or you are not signed in. ` +
      LOGIN_NOTES[service] +
      'Each saved account has its own sign-in; with several, pass account (the user is asked when you leave it out). ' +
      (service === 'learnjcu' ? '' : 'Accounts are created by learnjcu_login; sign in to LearnJCU first if none is saved. ') +
      'It first refreshes silently (a few seconds, no window). If the user has to sign in, it opens the sign-in page in their default browser: ' +
      'tell the user a browser window opened and ask them to sign in there. If the result says waitingForUser, call again after the user says they are done. ' +
      'Never ask the user for their password; they type it in the browser.',
    {
      waitSeconds,
      account: accountParam,
      ...(service === 'learnjcu'
        ? { newAccount: z.boolean().optional().describe('Sign in someone else and save them as another account') }
        : {}),
    },
    async ({ waitSeconds: w, account, newAccount }) => {
      if (newAccount) return agentLogin(service, { account: null, waitSeconds: w });
      if (account && !accountExists(account)) {
        throw new Error(`No saved account "${account}". Saved: ${listAccounts().join(', ') || 'none'}.${service === 'learnjcu' ? ' Use newAccount: true to add one.' : ''}`);
      }
      let name = account;
      if (!name) {
        try {
          name = currentAccount();
        } catch (e) {
          if (!(e instanceof AccountChoiceError)) throw e;
          const allowNew = service === 'learnjcu';
          const pick = await askUser(e.accounts, { purpose: `sign in to ${label}`, allowNew });
          if (!pick) throw choiceNeeded(e.accounts, { allowNew });
          if (pick === NEW_ACCOUNT) return agentLogin(service, { account: null, waitSeconds: w });
          selectAccount(pick);
          name = pick;
        }
      }
      return agentLogin(service, { account: name, waitSeconds: w });
    },
    { readOnlyHint: true, openWorldHint: true },
    { accounts: false },
  );
}

tool('learnjcu_whoami', 'Show the signed-in LearnJCU user.', {}, () => learnjcu.whoami());

tool(
  'learnjcu_list_courses',
  'List the modules/courses you are enrolled in on LearnJCU, most recently accessed first. Use when the user asks about their courses or modules, or you need a course id for another LearnJCU tool.',
  {
    search: z.string().optional().describe('Filter by text in the course code or name, e.g. "BU2001"'),
    includeUnavailable: z.boolean().optional().describe('Include hidden or past courses (default false)'),
  },
  learnjcu.listCourses,
);

tool(
  'learnjcu_list_announcements',
  'List recent announcements for a course, newest first.',
  { courseId, limit: z.number().int().min(1).max(100).optional() },
  learnjcu.listAnnouncements,
);

tool(
  'learnjcu_list_contents',
  'List items in a course outline. Omit contentId for the top level; pass a folder/learning module id to list its children. Use when the user asks what is in a course, or to find an assignment or other item in it.',
  { courseId, contentId: z.string().optional().describe('Folder id like "_987654_1"') },
  learnjcu.listContents,
);

tool(
  'learnjcu_get_content',
  'Get one content item with its full text and the list of its files, including files embedded in the page (ids like "embedded-0"). Use when the user asks for the details of an assignment or other item: its brief, instructions and attached files.',
  { courseId, contentId: z.string() },
  learnjcu.getContent,
);

tool(
  'learnjcu_download_attachment',
  'Download a file from a content item (an attachment id, or an "embedded-N" id from learnjcu_get_content) into the local Downloads/learnjcu folder and return its path.',
  { courseId, contentId: z.string(), attachmentId: z.string() },
  learnjcu.downloadAttachment,
);

tool(
  'learnjcu_my_grades',
  'Show the gradebook for a course: each assessment with due date, your submission status, grade and feedback. Use when the user asks about a course\'s assignments, their grades or feedback.',
  { courseId },
  learnjcu.myGrades,
);

tool(
  'learnjcu_upcoming_deadlines',
  'Scan all current courses for gradebook items due in the next N days (default 14), with your submission status.',
  {
    days: z.number().int().min(1).max(180).optional(),
    includePast: z.number().int().min(0).max(60).optional().describe('Also include items due in the past N days'),
  },
  learnjcu.upcomingDeadlines,
);

tool(
  'learnjcu_calendar',
  'List LearnJCU calendar items (course events, due dates, personal events) between two dates. Default: next 4 weeks.',
  {
    since: z.string().optional().describe('ISO date, default now'),
    until: z.string().optional().describe('ISO date, default since + 28 days'),
  },
  learnjcu.calendar,
);

// --- MyStudent

tool(
  'mystudent_overview',
  'Show the MyStudent dashboard (JCU\'s student administration portal): your contact details, study plan, class registrations, ' +
    'outstanding payments, tasks to complete, today\'s calendar, and forms in progress or available. ' +
    'Use when the user asks about their enrolment, fees, tasks or forms in MyStudent, or their student record.',
  {},
  () => mystudent.overview(),
);

tool(
  'mystudent_study_plan',
  'Show your course in MyStudent and every subject in its structure with its status: enrolled (and in which study period), completed, ' +
    'exempt or credited, or planned for a later period, plus advanced standing. Takes about 10 seconds (the page is rendered in a hidden browser). ' +
    'Use when the user asks about their degree progress, which subjects are left, or what they are enrolled in.',
  {},
  () => mystudent.studyPlan(),
);

// --- StudentFirst

tool(
  'studentfirst_overview',
  'Show StudentFirst (JCU Singapore): classes in the next 8 days with time and room, overall class and campus attendance against the 90% minimum, ' +
    'and each class with how many sessions were attended. Use when the user asks about their timetable, next classes, rooms or attendance at JCU Singapore.',
  {},
  () => studentfirst.overview(),
);

tool(
  'studentfirst_class_attendance',
  'List every session of your StudentFirst classes with date, time, room and whether attendance was recorded as present, absent or not yet recorded. ' +
    'Use when the user asks which classes they missed or the attendance of one subject.',
  { classCode: z.string().optional().describe('A subject code ("AB1001") or class code ("AB1001-TA"); omit for all classes') },
  studentfirst.classAttendance,
);

tool(
  'studentfirst_leave_applications',
  'List your StudentFirst leave applications with dates and status. Use when the user asks about leave they applied for. ' +
    'This tool does not apply for leave; the user does that on the StudentFirst website.',
  {},
  () => studentfirst.leaveApplications(),
);

tool(
  'studentfirst_notices',
  'Show the StudentFirst notices, such as updates to the JCU Singapore student contract and public holidays.',
  {},
  () => studentfirst.notices(),
);

const mvAssignment = z
  .string()
  .describe('A unique part of the assignment title (e.g. "CW2"), or its content or gradebook column id');

tool(
  'learnjcu_list_submissions',
  'Show a LearnJCU assignment\'s submission settings (due date, attempts allowed, file/text allowed) and every attempt you have made, newest first, with status, receipt and files. Use when the user asks for an assignment\'s details (due date, attempts left, what can be submitted) or what they have already submitted, and before submitting.',
  { courseId, assignment: mvAssignment },
  learnjcuWrite.listSubmissions,
);

tool(
  'learnjcu_api_get',
  'Read-only escape hatch: GET any Blackboard Learn public REST endpoint under /learn/api/public/.',
  {
    path: z.string().describe('e.g. /learn/api/public/v1/courses/_123_1/contents'),
    params: z.record(z.string(), z.string()).optional().describe('Query parameters'),
  },
  learnjcu.rawGet,
);

// Write tools. Each call needs confirm: true, and dryRun shows the plan first.
const confirm = z
  .boolean()
  .optional()
  .describe('Must be true to actually send. Only set it after showing the user the dryRun plan and getting their explicit yes.');
const guarded = (fn) => (args) => {
  const { confirm: ok, dryRun, ...rest } = args;
  if (!dryRun && ok !== true) {
    throw new Error('Not sent. Call again with dryRun: true, show the plan to the user, and only then call with confirm: true.');
  }
  return fn({ ...rest, dryRun: Boolean(dryRun) });
};

tool(
  'learnjcu_check_update',
  'Check whether a newer version of learnjcu-mcp is on GitHub, and list what it adds. Use when the user asks about updates or what is new.',
  {},
  async () => {
    const u = await checkForUpdate();
    return u.updateAvailable ? { ...u, next: 'Explain the changes to the user and ask whether to update; only then call learnjcu_update.' } : u;
  },
  { readOnlyHint: true, openWorldHint: true },
  { accounts: false },
);

tool(
  'learnjcu_update',
  'Update this copy of learnjcu-mcp to the latest version from GitHub (git fetch, switch to main and fast-forward, npm install). ' +
    'Only use after the user has said yes to updating. Always call with dryRun: true first, show the plan, then call with confirm: true. ' +
    'The user must restart the MCP client afterwards.',
  {
    dryRun: z.boolean().optional().describe('Show the plan without changing anything'),
    confirm,
  },
  guarded(applyUpdate),
  { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  { accounts: false },
);

tool(
  'learnjcu_submit',
  'Submit files (and optional text) to a LearnJCU Ultra assignment as a new attempt. Course staff see it at once, and it may count as your graded attempt. Use when the user asks to submit an assignment on LearnJCU. If the item links to an external tool, submit there instead. Always call with dryRun: true first, show the plan, and wait for the user to confirm.',
  {
    courseId,
    assignment: mvAssignment,
    files: z.array(z.string()).optional().describe('Absolute paths of the files to upload'),
    text: z.string().optional().describe('Text to put in the submission box'),
    dryRun: z.boolean().optional().describe('Validate and return the plan without sending'),
    confirm,
  },
  guarded(learnjcuWrite.submit),
  { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
);

await server.connect(new StdioServerTransport());
