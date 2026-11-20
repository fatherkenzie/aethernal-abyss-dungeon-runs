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
 *   Overview – for reading: upcoming nights, grouped like the board. Rebuilt after
 *              every sign-up, after edits in Signups or Nights, whenever the sheet
 *              is opened, and from the "Sign-up board" menu. Don't edit it;
 *              changes are overwritten.
 *   Signups  – the data, one row per character per night. Fix or delete rows here.
 *   Nights   – optional notes per night: Night (2026-11-27), Dungeon (locks in the
 *              pick), Message (shown on the board).
 *   Archive  – past weeks, moved out of Signups automatically.
 */

const SETTINGS = {
  title: 'Explore the Abyss',  // heading of the Overview tab
  timeZone: 'Europe/Berlin',   // realm/server time
  startTime: '21:00',          // runs start here, and that night's sign-ups lock
  days: [1, 2, 3, 4, 5],       // 1 = Monday ... 7 = Sunday
  party: { tank: 1, healer: 1, dps: 3 },
  maxDaysAhead: 14,            // how far ahead people can sign up
  maxPerNight: 60              // safety limit against accidental floods (12 groups)
};

const OVERVIEW_TAB = 'Overview';
const SIGNUPS_TAB = 'Signups';
const NIGHTS_TAB = 'Nights';
const ARCHIVE_TAB = 'Archive';

// Signups columns in sheet order. The script reads them by position; labels are for people.
const SIGNUP_COLUMNS = [
  { key: 'id', label: 'ID', width: 90, hidden: true, aliases: ['id'],
    note: 'Filled in by the board. Leave it empty for rows you add by hand.' },
  { key: 'date', label: 'Night', width: 100, aliases: ['date', 'night'],
    note: 'The night of the run, written like 2026-11-27.' },
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

const NIGHT_COLUMNS = [
  { label: 'Night', width: 100, aliases: ['date', 'night'] },
  { label: 'Dungeon', width: 190, aliases: ['dungeon'] },
  { label: 'Message', width: 440, aliases: ['message', 'note'] }
];
const NIGHTS_HELP = 'Optional, one row per night. Night: 2026-11-27. Dungeon: locks in the pick, ' +
  'e.g. Scholomance. Message: shown at the top of that night on the board.';

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
  styleNights_(ss.getSheetByName(NIGHTS_TAB));
  styleSignups_(ensureArchive_());
  styleOverview_(ensureOverview_());
  maintain_();
  return 'Ready: Overview, Signups, Nights and Archive are set up.';
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

/** Redraws the Overview when someone edits Signups or Nights by hand. */
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if (name !== SIGNUPS_TAB && name !== NIGHTS_TAB) return;
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

function listPayload_(from, to, token) {
  const range = range_(from, to);
  const owner = typeof token === 'string' && token ? ownerKey_(token.slice(0, 128)) : '';
  const signups = readSignups_()
    .filter(function (r) { return r.date >= range.from && r.date <= range.to; })
    .map(function (r) {
      return {
        id: r.id, date: r.date, name: r.name, class: r.class, spec: r.spec, role: r.role,
        dungeons: r.dungeons, note: r.note, created: r.created, mine: !!owner && r.owner === owner
      };
    });
  const nights = readNights_().filter(function (n) { return n.date >= range.from && n.date <= range.to; });
  return {
    ok: true,
    now: nowKey_(),
    settings: { timeZone: SETTINGS.timeZone, startTime: SETTINGS.startTime, days: SETTINGS.days },
    signups: signups,
    nights: nights
  };
}

function signup_(body) {
  const owner = ownerKey_(requireToken_(body.token));
  const player = cleanPlayer_(body);
  const dates = Array.isArray(body.dates) ? body.dates.slice(0, LIMITS.datesPerRequest) : [];
  if (!dates.length) throw fail_('invalid', 'Pick at least one night.');

  const rows = readSignups_();
  const sheet = tab_(SIGNUPS_TAB);
  const stamp = now_().toISOString();
  const created = [];
  const skipped = [];
  const seen = {};

  dates.forEach(function (raw) {
    const date = String(raw);
    if (seen[date]) return;
    seen[date] = true;

    const problem = nightProblem_(date, false);
    if (problem) { skipped.push({ date: date, reason: problem }); return; }

    // Every upcoming night stays open. Only the exact same character twice on one night is skipped.
    const sameNight = rows.filter(function (r) { return r.date === date; });
    if (sameNight.some(function (r) { return sameCharacter_(r, player); })) {
      skipped.push({ date: date, reason: 'duplicate' });
      return;
    }
    if (sameNight.length >= SETTINGS.maxPerNight) { skipped.push({ date: date, reason: 'full' }); return; }

    const id = Utilities.getUuid();
    sheet.appendRow(rowValues_({
      id: id, date: date, name: player.name, class: CLASS_NAMES[player.class], spec: player.spec,
      role: ROLE_NAMES[player.role], dungeons: player.dungeons, note: player.note,
      created: stamp, updated: stamp, owner: owner
    }));
    created.push({ id: id, date: date });
  });

  return { created: created, skipped: skipped };
}

function update_(body) {
  const owner = ownerKey_(requireToken_(body.token));
  const player = cleanPlayer_(body);
  const rows = readSignups_();
  const row = findRow_(rows, body.id);
  if (row.owner !== owner) throw notYours_();

  const problem = nightProblem_(row.date, true);
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

  const problem = nightProblem_(row.date, true);
  if (problem) throw fail_(problem, problemMessage_(problem));

  const sheet = tab_(SIGNUPS_TAB);
  checkRowStillMatches_(sheet, row);
  sheet.deleteRow(row.row);
  return { removed: row.id };
}

/* ------------------------------------------------------------------ */
/* Rules                                                                */
/* ------------------------------------------------------------------ */

/** Returns '' when the night can take this change, otherwise a reason code. */
function nightProblem_(date, existing) {
  if (!isDate_(date)) return 'invalid';
  if (!existing && SETTINGS.days.indexOf(isoDay_(date)) === -1) return 'not_a_run_day';
  if (nowKey_() >= date + 'T' + SETTINGS.startTime) return 'locked';
  if (existing) return '';
  if (daysBetween_(nowKey_().slice(0, 10), date) > SETTINGS.maxDaysAhead) return 'too_far';
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
    lock = null; // e.g. not allowed in this context: skip the archive step, still redraw
  }
  try {
    if (lock) {
      try { archivePast_(); } catch (err) { console.error(err); }
    }
    buildOverview_();
  } finally {
    if (lock) lock.releaseLock();
  }
}

function buildOverview_() {
  const sh = ensureOverview_();
  const today = nowKey_().slice(0, 10);
  const monday = addDays_(today, 1 - isoDay_(today));
  const last = addDays_(monday, 13);
  const signups = readSignups_();
  const notes = {};
  readNights_().forEach(function (n) { notes[n.date] = n; });

  const rows = [];
  const add = function (kind, cells, extra) {
    const r = (cells || []).slice(0, 6);
    while (r.length < 6) r.push('');
    rows.push({ kind: kind, cells: r, extra: extra || {} });
  };

  add('title', [SETTINGS.title + ' sign-ups']);
  add('subtitle', ['Upcoming nights, grouped like the board. Updated ' + fmtStamp_(now_()) +
    '. To change a sign-up, edit its row in the Signups tab.']);
  add('columns', ['Role', 'Character', 'Class', 'Preferred dungeons', 'Note', 'Signed up']);

  let week = '';
  for (let d = today; d <= last; d = addDays_(d, 1)) {
    if (SETTINGS.days.indexOf(isoDay_(d)) === -1) continue;
    const weekStart = addDays_(d, 1 - isoDay_(d));
    if (weekStart !== week) {
      week = weekStart;
      const runDays = SETTINGS.days.map(function (n) { return addDays_(weekStart, n - 1); });
      add('spacer');
      add('week', [(weekStart === monday ? 'This week' : 'Next week') + ', ' +
        fmtRange_(runDays[0], runDays[runDays.length - 1])]);
    }

    const entries = signups.filter(function (r) { return r.date === d; }).sort(byCreated_);
    const groups = buildGroups_(entries);
    const note = notes[d] || {};
    const count = entries.length
      ? entries.length + ' going' + (groups.length > 1 ? ', ' + groups.length + ' groups' : '')
      : 'No sign-ups yet';
    const pick = note.dungeon ? 'Organiser’s pick: ' + note.dungeon : topPick_(entries);
    add('night', [fmtLong_(d), SETTINGS.startTime + (d === today ? ', tonight' : ''), count, pick, note.message || ''],
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
  }
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
/* Tidying: archive, tabs, styles                                       */
/* ------------------------------------------------------------------ */

/** Moves sign-ups from before this week's Monday into the Archive tab. */
function archivePast_() {
  const sh = tab_(SIGNUPS_TAB);
  if (!sh) return 0;
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return 0;
  const tz = sheetTimeZone_();
  const today = nowKey_().slice(0, 10);
  const cutoff = addDays_(today, 1 - isoDay_(today));
  const keep = [];
  const old = [];
  for (let i = 1; i < values.length; i++) {
    const d = toDate_(values[i][1], tz);
    if (d && d < cutoff) old.push(values[i]);
    else keep.push(values[i]);
  }
  if (!old.length) return 0;
  const width = values[0].length;
  const ar = ensureArchive_();
  ar.getRange(ar.getLastRow() + 1, 1, old.length, width).setValues(old.map(cleanRow_));
  sh.getRange(2, 1, values.length - 1, width).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep.map(cleanRow_));
  return old.length;
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
  if (!ss.getSheetByName(NIGHTS_TAB)) {
    const nh = ss.insertSheet(NIGHTS_TAB);
    nh.getRange('A:C').setNumberFormat('@');
    nh.getRange(1, 1, 1, NIGHT_COLUMNS.length).setValues([labels_(NIGHT_COLUMNS)]).setFontWeight('bold');
    nh.setFrozenRows(1);
    nh.getRange('E1').setValue(NIGHTS_HELP);
  }
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

function styleNights_(nh) {
  if (!nh) return;
  if (headerMatches_(nh, NIGHT_COLUMNS)) {
    nh.getRange(1, 1, 1, NIGHT_COLUMNS.length).setValues([labels_(NIGHT_COLUMNS)]);
  }
  styleHeader_(nh, NIGHT_COLUMNS);
  nh.getRange('E1').setValue(NIGHTS_HELP).setFontColor(LOOK.soft).setWrap(true);
  nh.setColumnWidth(5, 340);
  nh.setTabColor(LOOK.gold);
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

function readNights_() {
  const sheet = tab_(NIGHTS_TAB);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const tz = sheetTimeZone_();
  // Columns are found by their header, so you can reorder them or add your own.
  const head = values[0].map(function (h) { return toText_(h).toLowerCase(); });
  const col = function (names, fallback) {
    for (let i = 0; i < names.length; i++) {
      const at = head.indexOf(names[i]);
      if (at !== -1) return at;
    }
    return fallback;
  };
  const cDate = col(NIGHT_COLUMNS[0].aliases, 0);
  const cDungeon = col(NIGHT_COLUMNS[1].aliases, 1);
  const cMessage = col(NIGHT_COLUMNS[2].aliases, 2);
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const date = toDate_(v[cDate], tz);
    if (!date) continue;
    out.push({ date: date, dungeon: toText_(v[cDungeon]), message: toText_(v[cMessage]).slice(0, LIMITS.message) });
  }
  return out;
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

function fmtRange_(a, b) {
  const ma = Number(a.slice(5, 7)) - 1;
  const mb = Number(b.slice(5, 7)) - 1;
  return ma === mb
    ? Number(a.slice(8, 10)) + '–' + Number(b.slice(8, 10)) + ' ' + MONTH_SHORT[mb]
    : Number(a.slice(8, 10)) + ' ' + MONTH_SHORT[ma] + ' – ' + Number(b.slice(8, 10)) + ' ' + MONTH_SHORT[mb];
}

/** "Fri 20 Nov, 14:02" in server time. */
function fmtStamp_(date) {
  const k = Utilities.formatDate(date, SETTINGS.timeZone, "yyyy-MM-dd'T'HH:mm");
  return DAY_SHORT[isoDay_(k.slice(0, 10)) - 1] + ' ' + Number(k.slice(8, 10)) + ' ' +
    MONTH_SHORT[Number(k.slice(5, 7)) - 1] + ', ' + k.slice(11);
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

/** Accepts real date cells, 2026-11-27 and 27.11.2026. Returns 'yyyy-MM-dd' or ''. */
function toDate_(v, tz) {
  if (v === null || v === undefined || v === '') return '';
  if (isDateObject_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return normDate_(m[1], m[2], m[3]);
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return normDate_(m[3], m[2], m[1]);
  return '';
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
