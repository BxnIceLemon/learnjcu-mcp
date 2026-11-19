import os from 'node:os';
import path from 'node:path';

export const BASE_URL = 'https://learn.jcu.edu.au';
export const HOST = 'learn.jcu.edu.au';

// Sessions and browser profiles live outside the project so the project folder
// can be shared or committed without leaking a login. Each account has its own
// folder under DATA_DIR/accounts (see accounts.js).
export const DATA_DIR = process.env.LEARNJCU_MCP_HOME || path.join(os.homedir(), '.learnjcu-mcp');
export const DOWNLOAD_DIR = process.env.LEARNJCU_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'learnjcu');

// MyStudent (TechnologyOne CiAnywhere) and StudentFirst (JCU Singapore's
// timetable and attendance site) use their own sessions, saved next to the
// LearnJCU one in each account's folder.
export const MYSTUDENT_HOST = 'jcu.t1cloud.com';
export const MYSTUDENT_BASE = `https://${MYSTUDENT_HOST}/T1Default/CiAnywhere/Web/JCU`;
export const MYSTUDENT_LOGON_URL = `${MYSTUDENT_BASE}/LogOn/%24S1_STU`;
export const STUDENTFIRST_HOST = 'studentfirst.jcu.edu.sg';
export const STUDENTFIRST_BASE = `https://${STUDENTFIRST_HOST}`;
