/**
 * Explore the Abyss – sign-up board backend (Google Apps Script).
 *
 * This script lives inside your Google Sheet (Extensions > Apps Script) and is
 * published as a web app. The board on GitHub Pages reads and writes through it.
 *
 * First time:   run setup() once, then Deploy > New deployment > Web app,
 *               Execute as: Me, Who has access: Anyone. Copy the /exec URL.
 * After edits:  Deploy > Manage deployments > Edit (pencil) > Version: New version
 *               > Deploy. The URL stays the same.
 *
 * Tabs it uses:
 *   Signups – one row per character per night. You can fix or delete rows here.
 *             "dungeons" holds the preferred dungeons, comma-separated (empty or "any" = any).
 *   Nights  – optional, one row per night you want to add something to:
 *             date (2026-11-27), dungeon (locks in the pick), message (shown on the board).
 */

const SETTINGS = {
  timeZone: 'Europe/Berlin', // realm/server time
  startTime: '21:00',        // runs start here, and that night's sign-ups lock
  days: [1, 2, 3, 4, 5],     // 1 = Monday ... 7 = Sunday
  maxDaysAhead: 14,          // how far ahead people can sign up
  maxPerNight: 60            // safety limit against accidental floods (12 groups)
};

const SIGNUPS_TAB = 'Signups';
const NIGHTS_TAB = 'Nights';
const SIGNUP_COLS = ['id', 'date', 'name', 'class', 'spec', 'role', 'dungeons', 'note', 'created', 'updated', 'owner'];
const NIGHT_COLS = ['date', 'dungeon', 'message'];
const CLASSES = ['druid', 'hunter', 'mage', 'paladin', 'priest', 'rogue', 'shaman', 'warlock', 'warrior'];
const ROLES = ['tank', 'healer', 'melee', 'ranged'];
const LIMITS = { name: 24, spec: 24, note: 80, message: 200, datesPerRequest: 10, rangeDays: 42, dungeons: 12 };

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

/** Run once from the editor: creates the tabs and asks for permission. */
function setup() {
  ensureTabs_();
  return 'Ready: the Signups and Nights tabs exist.';
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
      id: id, date: date, name: player.name, class: player.class, spec: player.spec, role: player.role,
      dungeons: player.dungeons, note: player.note, created: stamp, updated: stamp, owner: owner
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
    id: row.id, date: row.date, name: player.name, class: player.class, spec: player.spec, role: player.role,
    dungeons: player.dungeons, note: player.note, created: row.created, updated: now_().toISOString(), owner: owner
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
  // Several preferred dungeons, stored as ids separated by commas. None means any dungeon.
  const ids = dungeonTokens_(b.dungeons !== undefined ? b.dungeons : b.dungeon, /^[a-z0-9-]{1,40}$/);
  return {
    name: name, class: cls, spec: spec, role: role,
    dungeons: ids.length ? ids.join(',') : 'any',
    note: clean_(b.note, LIMITS.note)
  };
}

/** Splits a list or a comma-separated text into lower-case tokens, without "any" or repeats. */
function dungeonTokens_(value, pattern) {
  const list = Array.isArray(value) ? value : String(value === undefined || value === null ? '' : value).split(',');
  const out = [];
  for (let i = 0; i < list.length && out.length < LIMITS.dungeons; i++) {
    const token = clean_(list[i], 40).toLowerCase();
    if (token && token !== 'any' && pattern.test(token) && out.indexOf(token) === -1) out.push(token);
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
/* Sheet access                                                         */
/* ------------------------------------------------------------------ */

function ensureTabs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SIGNUPS_TAB)) {
    const sheets = ss.getSheets();
    const blank = sheets.length === 1 && sheets[0].getLastRow() === 0 ? sheets[0] : null;
    const sh = blank ? blank.setName(SIGNUPS_TAB) : ss.insertSheet(SIGNUPS_TAB);
    sh.getRange('A:K').setNumberFormat('@'); // keep dates and names as plain text
    sh.getRange(1, 1, 1, SIGNUP_COLS.length).setValues([SIGNUP_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(NIGHTS_TAB)) {
    const nh = ss.insertSheet(NIGHTS_TAB);
    nh.getRange('A:C').setNumberFormat('@');
    nh.getRange(1, 1, 1, NIGHT_COLS.length).setValues([NIGHT_COLS]).setFontWeight('bold');
    nh.setFrozenRows(1);
    nh.getRange('E1').setValue(
      'Optional, one row per night. date: 2026-11-27. dungeon: locks in the pick, e.g. Scholomance. ' +
      'message: shown at the top of that night.'
    );
  }
}

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
      role: toText_(v[5]).toLowerCase(),
      // Hand-typed rows may use names ("Scholomance, BRD"); the board matches names and ids.
      dungeons: dungeonTokens_(toText_(v[6]), /^[a-z0-9 '\-]{1,40}$/),
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
  // Columns are found by their header, so you can reorder or add your own.
  const head = values[0].map(function (h) { return toText_(h).toLowerCase(); });
  const col = function (name, fallback) {
    const i = head.indexOf(name);
    return i === -1 ? fallback : i;
  };
  const cDate = col('date', 0);
  const cDungeon = col('dungeon', 1);
  const cMessage = col('message', 2);
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
  return SIGNUP_COLS.map(function (key) { return safe_(obj[key] === undefined ? '' : obj[key]); });
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
