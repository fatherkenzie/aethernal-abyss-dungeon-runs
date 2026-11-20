/**
 * Explore the Abyss – sign-up board backend (Google Apps Script).
 *
 * This script lives inside your Google Sheet (Extensions > Apps Script) and is
 * published as a web app. The board on GitHub Pages reads and writes through it.
 *
 * First time:   run setup() once, then Deploy > New deployment > Web app,
 *               Execute as: Me, Who has access: Anyone. Copy the /exec URL.
 * After edits:  run setup() again, then Deploy > Manage deployments > Edit (pencil)
 *               > Version: New version > Deploy. The URL stays the same.
 *
 * Tabs:
 *   Overview – for reading: upcoming runs, grouped like the board. Rebuilt after
 *              every sign-up, after edits in Signups or Schedule, whenever the
 *              sheet is opened, and from the "Sign-up board" menu. Don't edit it;
 *              changes are overwritten.
 *   Signups  – the data, one row per character per run. Fix or delete rows here.
 *              "Night" is the run's regular night, which links the sign-up to its run.
 *   Schedule – one row per run, this week and next. Change Date or Time to move a
 *              run (its sign-ups move with it), set Dungeon to lock in the pick,
 *              add a Message. Delete a row to put that run back to normal.
 *   Archive  – past weeks, moved out of Signups automatically.
 */

const SETTINGS = {
  title: 'Explore the Abyss',  // heading of the Overview tab
  timeZone: 'Europe/Berlin',   // realm/server time
  startTime: '21:00',          // regular start; each run locks at its own start time
  days: [1, 2, 3, 4, 5],       // regular run days, 1 = Monday ... 7 = Sunday
  party: { tank: 1, healer: 1, dps: 3 },
  maxDaysAhead: 14,            // how far ahead people can sign up
  maxPerNight: 60              // safety limit against accidental floods (12 groups)
};

const OVERVIEW_TAB = 'Overview';
const SIGNUPS_TAB = 'Signups';
const SCHEDULE_TAB = 'Schedule';
const LEGACY_NIGHTS_TAB = 'Nights';
const ARCHIVE_TAB = 'Archive';

// Signups columns in sheet order. The script reads them by position; labels are for people.
const SIGNUP_COLUMNS = [
  { key: 'id', label: 'ID', width: 90, hidden: true, aliases: ['id'],
    note: 'Filled in by the board. Leave it empty for rows you add by hand.' },
  { key: 'date', label: 'Night', width: 100, aliases: ['date', 'night'],
    note: 'The run\'s regular night, written like 2026-11-27. If the run was moved, the Schedule tab has its new date.' },
  { key: 'name', label: 'Character', width: 140, aliases: ['name', 'character'] },
  { key: 'class', label: 'Class', width: 95, aliases: ['class'] },
  { key: 'spec', label: 'Spec', width: 120, aliases: ['spec'] },
  { key: 'role', label: 'Role', width: 85, aliases: ['role'],
    note: 'Tank, Healer, Melee or Ranged. Decides the group slot.' },
  { key: 'dungeons', label: 'Dungeons', width: 260, aliases: ['dungeon', 'dungeons'],
    note: 'Preferred dungeons, separated by commas. Empty or "Any" means any dungeon is fine.' },
  { key: 'note', label: 'Note', width: 260, aliases: ['note'] },
  { key: 'created', label: 'Signed up', width: 170, hidden: true, aliases: ['created', 'signed up'] },
  { key: 'updated', label: 'Changed', width: 170, hidden: true, aliases: ['updated', 'changed'] },
  { key: 'owner', label: 'Device', width: 120, hidden: true, aliases: ['owner', 'device'] }
];
const SIGNUP_KEYS = SIGNUP_COLUMNS.map(function (c) { return c.key; });

const SCHEDULE_COLUMNS = [
  { label: 'Run', width: 100, aliases: ['run'],
    note: 'The run\'s regular night. Sign-ups are linked to it, so leave it as it is and change Date instead.' },
  { label: 'Date', width: 150, aliases: ['date'],
    note: 'Change this to move the run to another day. Its sign-ups move with it. Double-click for a calendar. ' +
      'To put a run back to its regular night and time, delete its row.' },
  { label: 'Time', width: 80, aliases: ['time'],
    note: 'Start time in server time, 24-hour, like 20:00. Sign-ups for this run close at this time.' },
  { label: 'Dungeon', width: 190, aliases: ['dungeon'],
    note: 'Optional. Locks in the dungeon. Use the name as it appears on the board.' },
  { label: 'Message', width: 340, aliases: ['message', 'note'],
    note: 'Optional. Shown at the top of this run on the board.' }
];
const SCHEDULE_HELP = 'To move a run, change its Date or Time. Its sign-ups move with it.';

const CLASS_NAMES = {
  druid: 'Druid', hunter: 'Hunter', mage: 'Mage', paladin: 'Paladin', priest: 'Priest',
  rogue: 'Rogue', shaman: 'Shaman', warlock: 'Warlock', warrior: 'Warrior'
};
const ROLE_NAMES = { tank: 'Tank', healer: 'Healer', melee: 'Melee', ranged: 'Ranged' };
const CLASSES = Object.keys(CLASS_NAMES);
const ROLES = Object.keys(ROLE_NAMES);
const DUNGEON_TOKEN = /^[\p{L}\p{N} '’\-().&]{1,40}$/u;
const LIMITS = { name: 24, spec: 24, note: 80, message: 200, datesPerRequest: 10, rangeDays: 42, dungeons: 12 };

// Colours for the sheet: the board's dark leather and gold, on a light page.
const LOOK = {
  dark: '#2a1e14', header: '#3a2b1a', gold: '#e2b65a', parchment: '#ecdfc4', muted: '#c9b48f',
  week: '#6b5127', night: '#f6e7b8', group: '#fbf6ea', band: '#f8f3e6', alt: '#fcf9f2', white: '#ffffff',
  ink: '#2b2118', soft: '#8a7a63', ready: '#2e7d32', needs: '#b26a00', note: '#6b5127'
};
// Class colours, darkened so names stay readable on white.
const CLASS_INK = {
  druid: '#c25e00', hunter: '#4f7a24', mage: '#1d7fa6', paladin: '#b8417a', priest: '#5f5f5f',
  rogue: '#8f7c00', shaman: '#0b5fb8', warlock: '#5450c0', warrior: '#8a6a43'
};
const ROLE_INK = { tank: '#1f5fa8', healer: '#2e7d32', melee: '#b23b2e', ranged: '#7a4fb0' };

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

/** Run from the editor (or the menu): creates and styles the tabs, then builds the Overview. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTabs_();
  const signups = ss.getSheetByName(SIGNUPS_TAB);
  styleSignups_(signups);
  normalizeSignups_(signups);
  signups.setTabColor(LOOK.week);
  styleSchedule_(ss.getSheetByName(SCHEDULE_TAB));
  styleSignups_(ensureArchive_());
  styleOverview_(ensureOverview_());
  maintain_();
  return 'Ready: Overview, Signups, Schedule and Archive are set up.';
}

/** Adds the "Sign-up board" menu and refreshes the Overview whenever the sheet is opened. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Sign-up board')
    .addItem('Refresh overview', 'refreshOverview')
    .addItem('Tidy up the tabs', 'setup')
    .addToUi();
  try {
    maintain_();
  } catch (err) {
    console.error(err);
  }
}

/** Redraws the Overview when someone edits Signups or Schedule by hand, and confirms run moves. */
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (name !== SIGNUPS_TAB && name !== SCHEDULE_TAB && name !== LEGACY_NIGHTS_TAB) return;
  if (name === SCHEDULE_TAB) {
    try {
      explainScheduleEdit_(e.range);
    } catch (err) {
      console.error(err);
    }
  }
  try {
    buildOverview_();
  } catch (err) {
    console.error(err);
  }
}

/** Menu: Sign-up board > Refresh overview */
function refreshOverview() {
  maintain_();
  SpreadsheetApp.getActiveSpreadsheet().toast('The overview is up to date.', 'Sign-up board', 3);
}

function doGet(e) {
  return respond_(function () {
    const p = (e && e.parameter) || {};
    const action = p.action || 'list';
    if (action !== 'list') throw fail_('bad_request', 'Unknown action.');
    return listPayload_(p.from, p.to, p.token);
  });
}

function doPost(e) {
  return respond_(function () {
    let body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw fail_('bad_request', 'The request could not be read.');
    }
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw fail_('busy', 'The sheet is busy. Try again in a moment.');
    try {
      ensureTabs_();
      let result;
      if (body.action === 'signup') result = signup_(body);
      else if (body.action === 'update') result = update_(body);
      else if (body.action === 'remove') result = remove_(body);
      else throw fail_('bad_request', 'Unknown action.');
      SpreadsheetApp.flush();
      afterWrite_();
      const payload = listPayload_(body.from, body.to, body.token);
      payload.result = result;
      return payload;
    } finally {
      lock.releaseLock();
    }
  });
}

/* ------------------------------------------------------------------ */
/* Actions                                                              */
/* ------------------------------------------------------------------ */

/**
 * Runs whose (possibly moved) date falls in the range, with their sign-ups.
 * Sign-ups are linked to a run by its key: the run's regular night ("Night" in Signups).
 */
function listPayload_(from, to, token) {
  const range = range_(from, to);
  const owner = typeof token === 'string' && token ? ownerKey_(token.slice(0, 128)) : '';
  const runs = runsBetween_(range.from, range.to, readSchedule_());
  const keys = {};
  runs.forEach(function (r) { keys[r.key] = true; });
  const signups = readSignups_()
    .filter(function (r) { return keys[r.date]; })
    .map(function (r) {
      return {
        id: r.id, date: r.date, name: r.name, class: r.class, spec: r.spec, role: r.role,
        dungeons: r.dungeons, note: r.note, created: r.created, mine: !!owner && r.owner === owner
      };
    });
  return {
    ok: true,
    now: nowKey_(),
    settings: { timeZone: SETTINGS.timeZone, startTime: SETTINGS.startTime, days: SETTINGS.days },
    runs: runs,
    signups: signups,
    // for boards that don't know about runs yet
    nights: runs.map(function (r) { return { date: r.key, dungeon: r.dungeon, message: r.message }; })
  };
}

function signup_(body) {
  const owner = ownerKey_(requireToken_(body.token));
  const player = cleanPlayer_(body);
  const keys = Array.isArray(body.dates) ? body.dates.slice(0, LIMITS.datesPerRequest) : [];
  if (!keys.length) throw fail_('invalid', 'Pick at least one night.');

  const rows = readSignups_();
  const schedule = readSchedule_();
  const sheet = tab_(SIGNUPS_TAB);
  const stamp = now_().toISOString();
  const created = [];
  const skipped = [];
  const seen = {};

  keys.forEach(function (raw) {
    const key = String(raw);
    if (seen[key]) return;
    seen[key] = true;

    const problem = nightProblem_(key, false, schedule);
    if (problem) { skipped.push({ date: key, reason: problem }); return; }

    // Every upcoming run stays open. Only the exact same character twice on one run is skipped.
    const sameRun = rows.filter(function (r) { return r.date === key; });
    if (sameRun.some(function (r) { return sameCharacter_(r, player); })) {
      skipped.push({ date: key, reason: 'duplicate' });
      return;
    }
    if (sameRun.length >= SETTINGS.maxPerNight) { skipped.push({ date: key, reason: 'full' }); return; }

    const id = Utilities.getUuid();
    sheet.appendRow(rowValues_({
      id: id, date: key, name: player.name, class: CLASS_NAMES[player.class], spec: player.spec,
      role: ROLE_NAMES[player.role], dungeons: player.dungeons, note: player.note,
      created: stamp, updated: stamp, owner: owner
    }));
    created.push({ id: id, date: key });
  });

  return { created: created, skipped: skipped };
}

function update_(body) {
  const owner = ownerKey_(requireToken_(body.token));
  const player = cleanPlayer_(body);
  const rows = readSignups_();
  const row = findRow_(rows, body.id);
  if (row.owner !== owner) throw notYours_();

  const problem = nightProblem_(row.date, true, readSchedule_());
  if (problem) throw fail_(problem, problemMessage_(problem));

  const clash = rows.some(function (r) {
    return r.date === row.date && r.id !== row.id && sameCharacter_(r, player);
  });
  if (clash) throw fail_('duplicate', player.name + ' is already signed up for that night with that class.');

  const sheet = tab_(SIGNUPS_TAB);
  checkRowStillMatches_(sheet, row);
  const values = rowValues_({
    id: row.id, date: row.date, name: player.name, class: CLASS_NAMES[player.class], spec: player.spec,
    role: ROLE_NAMES[player.role], dungeons: player.dungeons, note: player.note,
    created: row.created, updated: now_().toISOString(), owner: owner
  });
  sheet.getRange(row.row, 1, 1, values.length).setValues([values]);
  return { updated: row.id };
}

function remove_(body) {
  const owner = ownerKey_(requireToken_(body.token));
  const rows = readSignups_();
  const row = findRow_(rows, body.id);
  if (row.owner !== owner) throw notYours_();

  const problem = nightProblem_(row.date, true, readSchedule_());
  if (problem) throw fail_(problem, problemMessage_(problem));

  const sheet = tab_(SIGNUPS_TAB);
  checkRowStillMatches_(sheet, row);
  sheet.deleteRow(row.row);
  return { removed: row.id };
}

/* ------------------------------------------------------------------ */
/* Runs and rules                                                       */
/* ------------------------------------------------------------------ */

/** A run's actual date and time: its Schedule row if there is one, otherwise its regular night. */
function runOf_(r) {
  return {
    key: r.key,
    date: r.date || r.key,
    time: r.time || SETTINGS.startTime,
    dungeon: r.dungeon || '',
    message: r.message || ''
  };
}

/** The run with this key, or null if there's no such run. */
function runForKey_(key, schedule) {
  const row = schedule.filter(function (r) { return r.key === key; })[0];
  if (row) return runOf_(row);
  if (isDate_(key) && SETTINGS.days.indexOf(isoDay_(key)) !== -1) return runOf_({ key: key });
  return null;
}

/** Every run whose actual date falls between from and to, in start-time order. */
function runsBetween_(from, to, schedule) {
  const byKey = {};
  schedule.forEach(function (r) { if (!byKey[r.key]) byKey[r.key] = r; });
  const out = [];
  Object.keys(byKey).forEach(function (k) {
    const run = runOf_(byKey[k]);
    if (run.date >= from && run.date <= to) out.push(run);
  });
  for (let d = from; d <= to; d = addDays_(d, 1)) {
    if (SETTINGS.days.indexOf(isoDay_(d)) !== -1 && !byKey[d]) out.push(runOf_({ key: d }));
  }
  return out.sort(byRunTime_);
}

function byRunTime_(a, b) {
  const x = a.date + 'T' + a.time;
  const y = b.date + 'T' + b.time;
  if (x !== y) return x < y ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Returns '' when the run can take this change, otherwise a reason code. */
function nightProblem_(key, existing, schedule) {
  if (!isDate_(key)) return 'invalid';
  const run = runForKey_(key, schedule);
  if (!run) return existing ? '' : 'not_a_run_day';
  if (nowKey_() >= run.date + 'T' + run.time) return 'locked';
  if (existing) return '';
  if (daysBetween_(nowKey_().slice(0, 10), run.date) > SETTINGS.maxDaysAhead) return 'too_far';
  return '';
}

/** Same name and same class: the same character, whoever's device it came from. */
function sameCharacter_(row, player) {
  return row.name.toLowerCase() === player.name.toLowerCase() && row.class === player.class;
}

function problemMessage_(code) {
  const messages = {
    locked: 'That run has already started, so its sign-ups are locked.',
    too_far: 'Sign-ups open up to two weeks ahead.',
    not_a_run_day: 'There is no run on that day.',
    invalid: 'That date is not valid.'
  };
  return messages[code] || 'That night cannot be changed.';
}

/** After an officer edits the Schedule: says in the sheet what the change did, or what went wrong. */
function explainScheduleEdit_(range) {
  const top = range.getRow();
  const rows = range.getNumRows();
  if (top + rows - 1 < 2) return; // the header row
  if (top < 2 || rows > 1) {
    scheduleToast_('Schedule updated. The board shows the changes within a minute.');
    return;
  }
  const sh = range.getSheet();
  const layout = scheduleLayout_(sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]);
  if (layout.date === -1) return; // an older layout without Date and Time
  const first = range.getColumn() - 1;
  const touches = function (c) { return c !== -1 && c >= first && c < first + range.getNumColumns(); };
  if (touches(layout.key)) {
    scheduleToast_('Run is the run’s regular night and links its sign-ups. To move a run, change its Date ' +
      'instead. Ctrl+Z (⌘Z on a Mac) undoes this edit.');
    return;
  }
  if (!touches(layout.date) && !touches(layout.time)) return; // Dungeon or Message: the Overview shows it
  const row = readSchedule_().filter(function (r) { return r.row === top; })[0];
  if (!row) return;
  const run = runOf_(row);
  if (row.badDate) {
    scheduleToast_('Couldn’t read “' + row.badDate + '” as a date. Double-click the cell to pick one. ' +
      'Until then, the run stays on ' + fmtLong_(run.key) + '.');
    return;
  }
  if (row.badTime) {
    scheduleToast_('Couldn’t read “' + row.badTime + '” as a time. Type it like 20:00. ' +
      'Until then, the run starts at ' + run.time + '.');
    return;
  }

  let msg;
  if (run.date === run.key && run.time === SETTINGS.startTime) {
    msg = fmtLong_(run.key) + '’s run is back on its regular night, at ' + run.time + '.';
  } else {
    msg = fmtLong_(run.key) + '’s run is now ' + (run.date === run.key ? 'at ' : 'on ' + fmtLong_(run.date) + ' at ') +
      run.time + ' server time.';
    const n = readSignups_().filter(function (s) { return s.date === run.key; }).length;
    if (n) msg += n === 1 ? ' Its sign-up moves with it.' : ' Its ' + n + ' sign-ups move with it.';
  }
  const today = nowKey_().slice(0, 10);
  if (nowKey_() >= run.date + 'T' + run.time) {
    msg += ' That time has already passed, so sign-ups for this run are closed.';
  } else if (run.date > addDays_(addDays_(today, 1 - isoDay_(today)), 13)) {
    msg += ' The board shows this week and next, so the run appears there once its week comes up.';
  } else {
    msg += ' The board updates within a minute.';
  }
  scheduleToast_(msg);
}

function scheduleToast_(msg) {
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Schedule', 10);
}

function cleanPlayer_(b) {
  const name = clean_(b.name, LIMITS.name);
  if (name.length < 2) throw fail_('invalid', 'Enter a character name.');
  const cls = String(b.class || '').toLowerCase();
  if (CLASSES.indexOf(cls) === -1) throw fail_('invalid', 'Pick a class.');
  const spec = clean_(b.spec, LIMITS.spec);
  const role = String(b.role || '').toLowerCase();
  if (!spec || ROLES.indexOf(role) === -1) throw fail_('invalid', 'Pick a spec.');
  // Preferred dungeons, stored by name so the sheet reads well. None means any dungeon.
  const source = Array.isArray(b.dungeonNames) ? b.dungeonNames : b.dungeons !== undefined ? b.dungeons : b.dungeon;
  const picks = dungeonTokens_(source);
  return {
    name: name, class: cls, spec: spec, role: role,
    dungeons: picks.length ? picks.join(', ') : 'Any',
    note: clean_(b.note, LIMITS.note)
  };
}

/** Splits a list or comma-separated text into dungeon names, without "any" or repeats. */
function dungeonTokens_(value) {
  const list = Array.isArray(value) ? value : String(value === undefined || value === null ? '' : value).split(',');
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length && out.length < LIMITS.dungeons; i++) {
    const token = clean_(list[i], 40);
    const key = token.toLowerCase();
    if (!token || key === 'any' || seen[key] || !DUNGEON_TOKEN.test(token)) continue;
    seen[key] = true;
    out.push(token);
  }
  return out;
}

function requireToken_(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    throw fail_('invalid', 'This browser has no device key. Reload the page and try again.');
  }
  return token;
}

function notYours_() {
  return fail_('not_yours', 'This sign-up was made on another device. Change it there, or ask the organiser to fix it in the sheet.');
}

/* ------------------------------------------------------------------ */
/* The Overview tab: a grouped, read-only view for people              */
/* ------------------------------------------------------------------ */

/** After a sign-up changes: tidy and redraw. A problem here never fails the sign-up itself. */
function afterWrite_() {
  try { ensureSchedule_(); } catch (err) { console.error(err); }
  try { archivePast_(); } catch (err) { console.error(err); }
  try { buildOverview_(); } catch (err) { console.error(err); }
}

/** Same as afterWrite_, for the menu and onOpen, which don't hold the lock yet. */
function maintain_() {
  let lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) lock = null;
  } catch (err) {
    lock = null; // e.g. not allowed in this context: skip the steps that rewrite rows, still redraw
  }
  try {
    if (lock) {
      // Opening the Sheet after pasting in a new version is enough: missing tabs appear on their own.
      try { announceTabs_(ensureTabs_()); } catch (err) { console.error(err); }
      try { ensureSchedule_(); } catch (err) { console.error(err); }
      try { archivePast_(); } catch (err) { console.error(err); }
    }
    buildOverview_();
  } finally {
    if (lock) lock.releaseLock();
  }
}

function announceTabs_(change) {
  const what = {
    migrated: 'Nights is now the Schedule tab, with a row for every run this week and next.',
    created: 'New Schedule tab, with a row for every run this week and next.'
  }[change];
  if (what) {
    SpreadsheetApp.getActiveSpreadsheet().toast(what + ' To move a run, change its Date or Time.', 'Sign-up board', 15);
  }
}

function buildOverview_() {
  const sh = ensureOverview_();
  const today = nowKey_().slice(0, 10);
  const monday = addDays_(today, 1 - isoDay_(today));
  const last = addDays_(monday, 13);
  const signups = readSignups_();
  const schedule = readSchedule_();
  const runs = runsBetween_(today, last, schedule);

  const rows = [];
  const add = function (kind, cells, extra) {
    const r = (cells || []).slice(0, 6);
    while (r.length < 6) r.push('');
    rows.push({ kind: kind, cells: r, extra: extra || {} });
  };

  add('title', [SETTINGS.title + ' sign-ups']);
  add('subtitle', ['Upcoming runs, grouped like the board. Updated ' + fmtStamp_(now_()) +
    '. To change a sign-up, edit Signups. To move a run, edit Schedule.']);
  add('columns', ['Role', 'Character', 'Class', 'Preferred dungeons', 'Note', 'Signed up']);

  let week = '';
  runs.forEach(function (run) {
    const weekStart = addDays_(run.date, 1 - isoDay_(run.date));
    if (weekStart !== week) {
      week = weekStart;
      const all = runsBetween_(weekStart, addDays_(weekStart, 6), schedule); // the label spans the whole week's runs
      add('spacer');
      add('week', [(weekStart === monday ? 'This week' : 'Next week') + ', ' +
        fmtRange_(all[0].date, all[all.length - 1].date)]);
    }

    const entries = signups.filter(function (r) { return r.date === run.key; }).sort(byCreated_);
    const groups = buildGroups_(entries);
    const count = entries.length
      ? entries.length + ' going' + (groups.length > 1 ? ', ' + groups.length + ' groups' : '')
      : 'No sign-ups yet';
    const pick = run.dungeon ? 'Organiser’s pick: ' + run.dungeon : topPick_(entries);
    const row = schedule.filter(function (r) { return r.key === run.key; })[0];
    const notes = [];
    if (run.date !== run.key) notes.push('Moved from ' + fmtShort_(run.key) + '.');
    if (row && row.badDate) notes.push('Check Schedule: “' + row.badDate + '” isn’t a date.');
    if (row && row.badTime) notes.push('Check Schedule: “' + row.badTime + '” isn’t a time.');
    if (run.message) notes.push(run.message);
    add('night', [fmtLong_(run.date), run.time + (run.date === today ? ', tonight' : ''), count, pick, notes.join(' ')],
      { empty: !entries.length });

    if (entries.length) {
      groups.forEach(function (g, i) {
        const needs = needsText_(g.needs);
        add('group', ['Group ' + (i + 1), needs || 'Ready'], { ready: !needs });
        let n = 0;
        ['tank', 'healer', 'dps'].forEach(function (slot) {
          g[slot].forEach(function (e) {
            add('member', [
              ROLE_NAMES[e.role] || 'DPS',
              e.name,
              (e.spec + ' ' + (CLASS_NAMES[e.class] || capitalize_(e.class))).trim(),
              prefText_(e.dungeons),
              e.note,
              fmtCreated_(e.created)
            ], { role: e.role, cls: e.class, alt: n++ % 2 === 1 });
          });
        });
      });
    }
    add('spacer');
  });
  paint_(sh, rows);
}

/** Writes the Overview in a handful of bulk calls, so it stays quick. */
function paint_(sh, rows) {
  const values = [];
  const bg = [];
  const color = [];
  const weight = [];
  const size = [];
  const style = [];
  rows.forEach(function (r) {
    const s = rowStyle_(r);
    values.push(r.cells.map(function (v) { return safe_(String(v === undefined || v === null ? '' : v)); }));
    bg.push(s.bg);
    color.push(s.color);
    weight.push(s.weight);
    size.push(s.size);
    style.push(s.style);
  });
  sh.clear();
  const range = sh.getRange(1, 1, rows.length, 6);
  range.setNumberFormat('@');
  range.setValues(values);
  range.setBackgrounds(bg).setFontColors(color).setFontWeights(weight).setFontSizes(size).setFontStyles(style);
  range.setVerticalAlignment('middle');
  sh.getRange(1, 5, rows.length, 1).setWrap(true);
  sh.setFrozenRows(3);
}

function rowStyle_(r) {
  const all = function (v) { return [v, v, v, v, v, v]; };
  const x = r.extra;
  switch (r.kind) {
    case 'title':
      return { bg: all(LOOK.dark), color: all(LOOK.gold), weight: all('bold'), size: all(15), style: all('normal') };
    case 'subtitle':
      return { bg: all(LOOK.dark), color: all(LOOK.muted), weight: all('normal'), size: all(9), style: all('normal') };
    case 'columns':
      return { bg: all(LOOK.header), color: all(LOOK.parchment), weight: all('bold'), size: all(9), style: all('normal') };
    case 'week':
      return { bg: all(LOOK.week), color: all(LOOK.white), weight: all('bold'), size: all(11), style: all('normal') };
    case 'night':
      return {
        bg: all(LOOK.night),
        color: [LOOK.ink, LOOK.ink, x.empty ? LOOK.soft : LOOK.ink, LOOK.ink, LOOK.note, LOOK.ink],
        weight: ['bold', 'normal', 'normal', 'bold', 'normal', 'normal'],
        size: [12, 10, 10, 10, 10, 10],
        style: ['normal', 'normal', 'normal', 'normal', 'italic', 'normal']
      };
    case 'group':
      return {
        bg: all(LOOK.group),
        color: [LOOK.ink, x.ready ? LOOK.ready : LOOK.needs, LOOK.ink, LOOK.ink, LOOK.ink, LOOK.ink],
        weight: ['bold', 'normal', 'normal', 'normal', 'normal', 'normal'],
        size: all(10),
        style: all('normal')
      };
    case 'member':
      return {
        bg: all(x.alt ? LOOK.alt : LOOK.white),
        color: [ROLE_INK[x.role] || LOOK.ink, CLASS_INK[x.cls] || LOOK.ink, LOOK.ink, LOOK.ink, LOOK.ink, LOOK.soft],
        weight: ['normal', 'bold', 'normal', 'normal', 'normal', 'normal'],
        size: [10, 10, 10, 10, 10, 9],
        style: all('normal')
      };
    default:
      return { bg: all(LOOK.white), color: all(LOOK.ink), weight: all('normal'), size: all(10), style: all('normal') };
  }
}

/** First come, first served per role, exactly like the board. */
function buildGroups_(entries) {
  const groups = [];
  entries.forEach(function (e) {
    const slot = e.role === 'tank' ? 'tank' : e.role === 'healer' ? 'healer' : 'dps';
    let g = groups.filter(function (x) { return x[slot].length < SETTINGS.party[slot]; })[0];
    if (!g) {
      g = { tank: [], healer: [], dps: [] };
      groups.push(g);
    }
    g[slot].push(e);
  });
  if (!groups.length) groups.push({ tank: [], healer: [], dps: [] });
  return groups.map(function (g) {
    g.needs = {
      tank: Math.max(0, SETTINGS.party.tank - g.tank.length),
      healer: Math.max(0, SETTINGS.party.healer - g.healer.length),
      dps: Math.max(0, SETTINGS.party.dps - g.dps.length)
    };
    return g;
  });
}

function needsText_(needs) {
  const parts = [];
  if (needs.tank) parts.push(needs.tank === 1 ? 'a tank' : needs.tank + ' tanks');
  if (needs.healer) parts.push(needs.healer === 1 ? 'a healer' : needs.healer + ' healers');
  if (needs.dps) parts.push(needs.dps + ' DPS');
  if (!parts.length) return '';
  return 'Needs ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]);
}

function topPick_(entries) {
  if (!entries.length) return '';
  const counts = {};
  const label = {};
  entries.forEach(function (e) {
    e.dungeons.forEach(function (t) {
      const k = t.toLowerCase();
      counts[k] = (counts[k] || 0) + 1;
      if (!label[k]) label[k] = dungeonLabel_(t);
    });
  });
  const keys = Object.keys(counts);
  if (!keys.length) return 'Any dungeon';
  let max = 0;
  keys.forEach(function (k) { if (counts[k] > max) max = counts[k]; });
  const lead = keys.filter(function (k) { return counts[k] === max; }).map(function (k) { return label[k]; }).sort();
  return lead.length === 1
    ? 'Top pick: ' + lead[0] + ' (' + max + ')'
    : 'Tied: ' + lead.join(' / ') + ' (' + max + ' each)';
}

/** Older sign-ups stored ids like "strat-live"; show them readably. */
function dungeonLabel_(t) {
  return /^[a-z0-9-]+$/.test(t) ? capitalize_(t.replace(/-/g, ' ')) : t;
}

function prefText_(list) {
  return list.length ? list.map(dungeonLabel_).join(', ') : 'Any';
}

function byCreated_(a, b) {
  if (a.created === b.created) return 0;
  return a.created < b.created ? -1 : 1;
}

/* ------------------------------------------------------------------ */
/* Tidying: schedule, archive, tabs, styles                             */
/* ------------------------------------------------------------------ */

/** Adds a Schedule row for every regular run this week and next, so officers can just edit it. */
function ensureSchedule_() {
  const sh = tab_(SCHEDULE_TAB);
  if (!sh) return 0;
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  const layout = scheduleLayout_(head);
  if (!layout.hasRun) return 0;
  const have = {};
  readSchedule_().forEach(function (r) { have[r.key] = true; });
  const today = nowKey_().slice(0, 10);
  const monday = addDays_(today, 1 - isoDay_(today));
  const width = Math.max(head.length, SCHEDULE_COLUMNS.length);
  const add = [];
  for (let d = monday; d <= addDays_(monday, 13); d = addDays_(d, 1)) {
    if (SETTINGS.days.indexOf(isoDay_(d)) === -1 || have[d]) continue;
    const row = [];
    for (let i = 0; i < width; i++) row.push('');
    row[layout.key] = d; // Run and Time are plain-text columns, so these stay as typed
    if (layout.date !== -1) row[layout.date] = dateCell_(d);
    if (layout.time !== -1) row[layout.time] = SETTINGS.startTime;
    add.push(row);
  }
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, width).setValues(add);
  return add.length;
}

/**
 * Moves sign-ups of runs from before this week's Monday into Archive, and drops old Schedule rows.
 * A run counts as past only when both its regular night and its date are, so a mistyped date
 * (say, last year) can't archive a run's sign-ups.
 */
function archivePast_() {
  const today = nowKey_().slice(0, 10);
  const cutoff = addDays_(today, 1 - isoDay_(today));
  const schedule = readSchedule_();
  const actual = {};
  schedule.forEach(function (r) { if (!actual[r.key]) actual[r.key] = r.date; });
  let moved = 0;

  const sh = tab_(SIGNUPS_TAB);
  if (sh) {
    const values = sh.getDataRange().getValues();
    if (values.length > 1) {
      const tz = sheetTimeZone_();
      const keep = [];
      const old = [];
      for (let i = 1; i < values.length; i++) {
        const key = toDate_(values[i][1], tz);
        const date = key ? actual[key] || key : '';
        if (key && key < cutoff && date < cutoff) old.push(values[i]);
        else keep.push(values[i]);
      }
      if (old.length) {
        const width = values[0].length;
        const ar = ensureArchive_();
        ar.getRange(ar.getLastRow() + 1, 1, old.length, width).setValues(old.map(cleanRow_));
        sh.getRange(2, 1, values.length - 1, width).clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep.map(cleanRow_));
        moved = old.length;
      }
    }
  }

  const sched = tab_(SCHEDULE_TAB);
  if (sched) {
    const values = sched.getDataRange().getValues();
    const gone = scheduleLayout_(values[0]).hasRun
      ? schedule.filter(function (r) { return r.key < cutoff && r.date < cutoff; }).map(function (r) { return r.row; })
      : [];
    if (gone.length) {
      const keep = values.slice(1).filter(function (v, i) { return gone.indexOf(i + 2) === -1; });
      const width = values[0].length;
      sched.getRange(2, 1, values.length - 1, width).clearContent();
      if (keep.length) sched.getRange(2, 1, keep.length, width).setValues(keep.map(cleanRow_));
    }
  }
  return moved;
}

function cleanRow_(row) {
  return row.map(function (v) { return isDateObject_(v) ? v : safe_(v === null || v === undefined ? '' : v); });
}

function ensureTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SIGNUPS_TAB)) {
    const sheets = ss.getSheets();
    const blank = sheets.length === 1 && sheets[0].getLastRow() === 0 ? sheets[0] : null;
    const sh = blank ? blank.setName(SIGNUPS_TAB) : ss.insertSheet(SIGNUPS_TAB);
    sh.getRange('A:K').setNumberFormat('@'); // keep dates and names as plain text
    sh.getRange(1, 1, 1, SIGNUP_COLUMNS.length).setValues([labels_(SIGNUP_COLUMNS)]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  let change = '';
  if (!ss.getSheetByName(SCHEDULE_TAB)) {
    change = migrateNights_(ss) ? 'migrated' : 'created';
    if (change === 'created') {
      const sc = ss.insertSheet(SCHEDULE_TAB);
      sc.getRange('A:A').setNumberFormat('@');
      sc.getRange('C:C').setNumberFormat('@');
      sc.getRange(1, 1, 1, SCHEDULE_COLUMNS.length).setValues([labels_(SCHEDULE_COLUMNS)]);
    }
    styleSchedule_(ss.getSheetByName(SCHEDULE_TAB));
  }
  // An older deployment that's still live re-creates an empty Nights tab. The Schedule replaced it.
  const stray = ss.getSheetByName(LEGACY_NIGHTS_TAB);
  if (stray && stray.getLastRow() <= 1) ss.deleteSheet(stray);
  return change;
}

/** Earlier versions had a "Nights" tab (Night, Dungeon, Message). It becomes the Schedule. */
function migrateNights_(ss) {
  const old = ss.getSheetByName(LEGACY_NIGHTS_TAB);
  if (!old) return false;
  const notes = readSchedule_(); // reads the Nights tab while there is no Schedule yet
  old.setName(SCHEDULE_TAB);
  old.clear();
  old.getRange('A:A').setNumberFormat('@');
  old.getRange('C:C').setNumberFormat('@');
  const rows = [labels_(SCHEDULE_COLUMNS)].concat(notes.map(function (n) {
    return [n.key, dateCell_(n.key), SETTINGS.startTime, safe_(n.dungeon), safe_(n.message)];
  }));
  old.getRange(1, 1, rows.length, SCHEDULE_COLUMNS.length).setValues(rows);
  return true;
}

function ensureOverview_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(OVERVIEW_TAB);
  if (!sh) {
    sh = ss.insertSheet(OVERVIEW_TAB, 0);
    styleOverview_(sh);
  }
  return sh;
}

function ensureArchive_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ar = ss.getSheetByName(ARCHIVE_TAB);
  if (!ar) {
    ar = ss.insertSheet(ARCHIVE_TAB);
    ar.getRange('A:K').setNumberFormat('@');
    ar.getRange(1, 1, 1, SIGNUP_COLUMNS.length).setValues([labels_(SIGNUP_COLUMNS)]);
    styleHeader_(ar, SIGNUP_COLUMNS);
    hideColumns_(ar);
    ar.setTabColor('#9e9e9e');
  }
  return ar;
}

function styleOverview_(sh) {
  [210, 150, 190, 270, 300, 140].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (sh.getMaxColumns() > 6) sh.deleteColumns(7, sh.getMaxColumns() - 6);
  sh.setHiddenGridlines(true);
  sh.setTabColor(LOOK.gold);
}

function styleSignups_(sh) {
  if (!sh) return;
  if (headerMatches_(sh, SIGNUP_COLUMNS)) {
    sh.getRange(1, 1, 1, SIGNUP_COLUMNS.length).setValues([labels_(SIGNUP_COLUMNS)]);
  }
  styleHeader_(sh, SIGNUP_COLUMNS);
  hideColumns_(sh);
  SIGNUP_COLUMNS.forEach(function (c, i) {
    if (c.note) sh.getRange(1, i + 1).setNote(c.note);
  });
  const rows = Math.max(1, sh.getMaxRows() - 1);
  const body = sh.getRange(2, 1, rows, SIGNUP_COLUMNS.length);
  sh.getBandings().forEach(function (b) { b.remove(); });
  body.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(LOOK.white)
    .setSecondRowColor(LOOK.band);
  body.setVerticalAlignment('middle');
  sh.getRange(2, 4, rows, 1).setDataValidation(listRule_(CLASSES.map(function (k) { return CLASS_NAMES[k]; })));
  sh.getRange(2, 6, rows, 1).setDataValidation(listRule_(ROLES.map(function (k) { return ROLE_NAMES[k]; })));
  if (!sh.getFilter()) sh.getRange(1, 1, sh.getMaxRows(), SIGNUP_COLUMNS.length).createFilter();
}

/** Only styles the standard layout (Run, Date, Time, Dungeon, Message), so a hand-made one is left alone. */
function styleSchedule_(sh) {
  if (!sh || !headerMatches_(sh, SCHEDULE_COLUMNS)) return;
  sh.getRange(1, 1, 1, SCHEDULE_COLUMNS.length).setValues([labels_(SCHEDULE_COLUMNS)]);
  styleHeader_(sh, SCHEDULE_COLUMNS);
  SCHEDULE_COLUMNS.forEach(function (c, i) { sh.getRange(1, i + 1).setNote(c.note); });
  const rows = Math.max(1, sh.getMaxRows() - 1);
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('C:C').setNumberFormat('@');
  sh.getBandings().forEach(function (b) { b.remove(); });
  sh.getRange(2, 1, rows, SCHEDULE_COLUMNS.length).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false)
    .setFirstRowColor(LOOK.white)
    .setSecondRowColor(LOOK.band);
  sh.getRange(2, 1, rows, 1).setFontColor(LOOK.soft); // Run: for the script, not for editing
  sh.getRange(2, 2, rows, 1)
    .setNumberFormat('ddd d mmm yyyy')
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true)
      .setHelpText('Pick a date: double-click the cell for a calendar.').build());
  sh.getRange('F1').setValue(SCHEDULE_HELP).setFontColor(LOOK.soft).setVerticalAlignment('middle');
  sh.setColumnWidth(6, 400);
  sh.setTabColor(LOOK.gold);
}

/** Older sign-ups stored "warrior"/"tank"; give them the same spelling as the dropdowns. */
function normalizeSignups_(sh) {
  if (!sh || sh.getLastRow() < 2) return;
  const range = sh.getRange(2, 4, sh.getLastRow() - 1, 3); // Class, Spec, Role
  const values = range.getValues();
  let changed = false;
  values.forEach(function (row) {
    const cls = CLASS_NAMES[toText_(row[0]).toLowerCase()];
    if (cls && row[0] !== cls) { row[0] = cls; changed = true; }
    const role = ROLE_NAMES[toText_(row[2]).toLowerCase().split(/\s+/)[0]];
    if (role && row[2] !== role) { row[2] = role; changed = true; }
  });
  if (changed) range.setValues(values.map(cleanRow_));
}

function styleHeader_(sh, columns) {
  sh.getRange(1, 1, 1, columns.length)
    .setBackground(LOOK.dark)
    .setFontColor(LOOK.gold)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 30);
  columns.forEach(function (c, i) { sh.setColumnWidth(i + 1, c.width); });
}

function hideColumns_(sh) {
  SIGNUP_COLUMNS.forEach(function (c, i) {
    if (c.hidden) sh.hideColumns(i + 1);
  });
}

/** Only relabel a header row we recognise, so hand-made layouts are left alone. */
function headerMatches_(sh, columns) {
  const head = sh.getRange(1, 1, 1, columns.length).getValues()[0];
  return columns.every(function (c, i) {
    const h = toText_(head[i]).toLowerCase();
    return c.aliases.indexOf(h) !== -1 || h === c.label.toLowerCase();
  });
}

function labels_(columns) {
  return columns.map(function (c) { return c.label; });
}

function listRule_(list) {
  return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
}

/** A real date cell at noon, so time zones can't shift it to another day. */
function dateCell_(key) {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12));
}

/* ------------------------------------------------------------------ */
/* Sheet access                                                         */
/* ------------------------------------------------------------------ */

function readSignups_() {
  const sheet = tab_(SIGNUPS_TAB);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const tz = sheetTimeZone_();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const date = toDate_(v[1], tz);
    const name = toText_(v[2]);
    if (!date || !name) continue;
    rows.push({
      row: i + 1,
      id: toText_(v[0]) || 'row-' + (i + 1),
      date: date,
      name: name,
      class: toText_(v[3]).toLowerCase(),
      spec: toText_(v[4]),
      role: toText_(v[5]).toLowerCase().split(/\s+/)[0],
      dungeons: dungeonTokens_(toText_(v[6])),
      note: toText_(v[7]),
      // Rows typed in by hand have no timestamp: keep them after the others, in sheet order.
      created: toText_(v[8]) || '~' + String(i + 1).padStart(6, '0'),
      updated: toText_(v[9]),
      owner: toText_(v[10])
    });
  }
  return rows;
}

/**
 * Schedule rows: { row, key, date, time, dungeon, message, badDate, badTime }. Empty Date and Time
 * cells mean the run's regular night and start time; so do unreadable ones, which are kept in
 * badDate and badTime so officers can be told. Also reads the older Nights tab.
 */
function readSchedule_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SCHEDULE_TAB) || ss.getSheetByName(LEGACY_NIGHTS_TAB);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const tz = sheetTimeZone_();
  const c = scheduleLayout_(values[0]);
  const cell = function (v, at) { return at === -1 || v[at] === null || v[at] === undefined ? '' : v[at]; };
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const key = toDate_(cell(v, c.key), tz);
    if (!key) continue;
    const rawDate = cell(v, c.date);
    const rawTime = cell(v, c.time);
    const date = toDate_(rawDate, tz);
    const time = toTime_(rawTime, tz);
    out.push({
      row: i + 1,
      key: key,
      date: date || key,
      time: time || SETTINGS.startTime,
      dungeon: toText_(cell(v, c.dungeon)),
      message: toText_(cell(v, c.message)).slice(0, LIMITS.message),
      badDate: rawDate !== '' && !date ? toText_(rawDate).slice(0, 40) : '',
      badTime: rawTime !== '' && !time ? toText_(rawTime).slice(0, 40) : ''
    });
  }
  return out;
}

/**
 * Where each Schedule column is (0-based, -1 if missing), found by header so columns can be moved.
 * The older Nights tab had no Run column: its first column was the night itself.
 */
function scheduleLayout_(headRow) {
  const head = (headRow || []).map(function (h) { return toText_(h).toLowerCase(); });
  const find = function (names, fallback) {
    for (let i = 0; i < names.length; i++) {
      const at = head.indexOf(names[i]);
      if (at !== -1) return at;
    }
    return fallback;
  };
  const run = head.indexOf('run');
  if (run === -1) {
    return { hasRun: false, key: find(['night', 'date'], 0), date: -1, time: -1,
      dungeon: find(['dungeon'], 1), message: find(['message', 'note'], 2) };
  }
  return { hasRun: true, key: run, date: find(['date'], -1), time: find(['time'], -1),
    dungeon: find(['dungeon'], -1), message: find(['message', 'note'], -1) };
}

function findRow_(rows, id) {
  const match = rows.filter(function (r) { return r.id === String(id || ''); })[0];
  if (!match) throw fail_('not_found', 'That sign-up no longer exists. It may have been removed in the sheet.');
  return match;
}

/** Guards against someone editing the sheet by hand at the same moment. */
function checkRowStillMatches_(sheet, row) {
  const current = toText_(sheet.getRange(row.row, 1).getValue());
  if (current !== row.id) throw fail_('busy', 'The sheet changed while saving. Try again.');
}

function rowValues_(obj) {
  return SIGNUP_KEYS.map(function (key) { return safe_(obj[key] === undefined ? '' : obj[key]); });
}

function tab_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function sheetTimeZone_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || SETTINGS.timeZone;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function respond_(fn) {
  let out;
  try {
    out = fn();
  } catch (err) {
    if (err && err.code) {
      out = { ok: false, code: err.code, error: err.message };
    } else {
      console.error(err);
      out = { ok: false, code: 'server', error: 'Something went wrong in the sheet script.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function now_() {
  return new Date();
}

/** Current server time as 'yyyy-MM-ddTHH:mm' in SETTINGS.timeZone. */
function nowKey_() {
  return Utilities.formatDate(now_(), SETTINGS.timeZone, "yyyy-MM-dd'T'HH:mm");
}

function range_(from, to) {
  const today = nowKey_().slice(0, 10);
  const monday = addDays_(today, 1 - isoDay_(today));
  const f = isDate_(from) ? from : monday;
  let t = isDate_(to) ? to : addDays_(monday, 13);
  if (t < f) t = f;
  if (daysBetween_(f, t) > LIMITS.rangeDays) t = addDays_(f, LIMITS.rangeDays);
  return { from: f, to: t };
}

function isDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isoDay_(date) {
  const d = new Date(date + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays_(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween_(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

function fmtLong_(date) {
  return DAY_NAMES[isoDay_(date) - 1] + ' ' + Number(date.slice(8, 10)) + ' ' + MONTH_NAMES[Number(date.slice(5, 7)) - 1];
}

function fmtShort_(date) {
  return DAY_SHORT[isoDay_(date) - 1] + ' ' + Number(date.slice(8, 10)) + ' ' + MONTH_SHORT[Number(date.slice(5, 7)) - 1];
}

function fmtRange_(a, b) {
  if (a === b) return Number(a.slice(8, 10)) + ' ' + MONTH_SHORT[Number(a.slice(5, 7)) - 1];
  const ma = Number(a.slice(5, 7)) - 1;
  const mb = Number(b.slice(5, 7)) - 1;
  return ma === mb
    ? Number(a.slice(8, 10)) + '–' + Number(b.slice(8, 10)) + ' ' + MONTH_SHORT[mb]
    : Number(a.slice(8, 10)) + ' ' + MONTH_SHORT[ma] + ' – ' + Number(b.slice(8, 10)) + ' ' + MONTH_SHORT[mb];
}

/** "Fri 20 Nov, 14:02" in server time. */
function fmtStamp_(date) {
  const k = Utilities.formatDate(date, SETTINGS.timeZone, "yyyy-MM-dd'T'HH:mm");
  return fmtShort_(k.slice(0, 10)) + ', ' + k.slice(11);
}

function fmtCreated_(iso) {
  if (!iso || iso.charAt(0) === '~') return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : fmtStamp_(d);
}

function capitalize_(s) {
  return String(s || '').replace(/(^|\s)([a-z])/g, function (m, sp, c) { return sp + c.toUpperCase(); });
}

function isDateObject_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function toText_(v) {
  if (v === null || v === undefined) return '';
  if (isDateObject_(v)) return isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).replace(/^'(?=[=+\-@])/, '').trim();
}

/** Accepts real date cells, 2026-11-27, 27.11.2026 and 27/11/2026. Returns 'yyyy-MM-dd' or ''. */
function toDate_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDateObject_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 20000 && v < 100000) { // a date serial number, days since 1899-12-30
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim().replace(/^'/, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return normDate_(m[1], m[2], m[3]);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return normDate_(m[3], m[2], m[1]);
  return '';
}

/** Accepts 20:00, 20.30, 8:05, 20, 20h, "20 Uhr", 8pm, 8:30 pm and time cells. Returns 'HH:mm' or ''. */
function toTime_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDateObject_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'HH:mm');
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440) % 1440;
    return pad2_(Math.floor(mins / 60)) + ':' + pad2_(mins % 60);
  }
  const s = String(v).trim().toLowerCase().replace(/^'/, '');
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(uhr|h|am|pm|a\.m\.|p\.m\.)?$/.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const half = m[3] ? m[3].charAt(0) : '';
  if (half === 'a' || half === 'p') {
    if (h < 1 || h > 12) return '';
    h = (h % 12) + (half === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59) return '';
  return pad2_(h) + ':' + pad2_(min);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function normDate_(y, mo, d) {
  const s = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return isDate_(s) ? s : '';
}

function clean_(v, max) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Stops the sheet from treating text like "=..." as a formula. */
function safe_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** The sheet only ever stores a hash of the device key, never the key itself. */
function ownerKey_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token), Utilities.Charset.UTF_8);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return 'h' + hex;
}
