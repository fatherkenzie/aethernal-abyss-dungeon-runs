/* Explore the Abyss – sign-up board. Plain JavaScript, no build step. */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- */
  /* Settings and lookups                                               */
  /* ---------------------------------------------------------------- */

  const CFG = window.BOARD_CONFIG || {};
  const isDemo = !CFG.apiUrl;
  const party = Object.assign({ tank: 1, healer: 1, dps: 3 }, CFG.party || {});
  const partySize = party.tank + party.healer + party.dps;
  const settings = {
    timeZone: CFG.timeZone || 'Europe/Berlin',
    startTime: CFG.startTime || '21:00',
    days: sortDays(CFG.days && CFG.days.length ? CFG.days : [1, 2, 3, 4, 5]),
  };
  const DUNGEONS = CFG.dungeons || [];
  const CLASSES = (CFG.classes || []).map(function (c) {
    return Object.assign({}, c, { specs: c.specs.map(function (s) { return { name: s[0], role: s[1] }; }) });
  });
  const ROLE_LABEL = { tank: 'Tank', healer: 'Healer', melee: 'Melee DPS', ranged: 'Ranged DPS' };
  const ROLE_ICON = { tank: 'i-tank', healer: 'i-healer', melee: 'i-melee', ranged: 'i-ranged' };
  const SLOT_WORD = { tank: 'tank', healer: 'healer', dps: 'DPS' };
  const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SKIP_REASON = {
    locked: 'already started',
    too_far: 'too far ahead',
    full: 'night is full',
    not_a_run_day: 'no run that day',
    invalid: 'not a valid night',
  };

  function sortDays(days) { return days.slice().sort(function (a, b) { return a - b; }); }

  function classById(id) {
    return CLASSES.find(function (c) { return c.id === id; }) ||
      { id: id, name: id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Unknown', color: '#b6a283', specs: [] };
  }

  function roleFor(entry) {
    if (ROLE_ICON[entry.role]) return entry.role;
    const spec = classById(entry.class).specs.find(function (s) {
      return s.name.toLowerCase() === String(entry.spec || '').toLowerCase();
    });
    return spec ? spec.role : 'melee';
  }

  function slotOf(role) { return role === 'tank' ? 'tank' : role === 'healer' ? 'healer' : 'dps'; }

  function prettify(text) {
    return String(text).replace(/-/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function dungeonById(id) {
    return DUNGEONS.find(function (d) { return d.id === id; }) || { id: id, name: prettify(id), short: prettify(id) };
  }

  /** Matches an id, a name or a short name ("Scholomance", "Scholo", "scholo"). */
  function resolveDungeon(text) {
    const raw = String(text || '').trim();
    const t = raw.toLowerCase();
    if (!t) return null;
    return DUNGEONS.find(function (d) {
      return d.id === t || d.name.toLowerCase() === t || d.short.toLowerCase() === t;
    }) || { id: t, name: prettify(raw), short: prettify(raw) };
  }

  /** Preferred dungeons as a clean list of ids. An empty list means any dungeon is fine. */
  function parseDungeons(value) {
    const list = Array.isArray(value) ? value : String(value || '').split(',');
    const out = [];
    list.forEach(function (x) {
      const t = String(x || '').trim();
      if (!t || t.toLowerCase() === 'any') return;
      const id = resolveDungeon(t).id;
      if (out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Storage (may be unavailable, e.g. in some embedded previews)      */
  /* ---------------------------------------------------------------- */

  const PREFIX = 'abyss-board:';
  const memory = {};
  const store = {
    get: function (key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) { /* fall through to memory */ }
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    },
    set: function (key, value) {
      memory[key] = value;
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* memory only */ }
    },
  };

  /** A random key that marks sign-ups made in this browser as editable here. */
  function deviceToken() {
    let t = store.get('token', '');
    if (typeof t !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(t)) {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      t = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      store.set('token', t);
    }
    return t;
  }

  /* ---------------------------------------------------------------- */
  /* Time (everything runs on server time)                              */
  /* ---------------------------------------------------------------- */

  const formatters = {};
  function zoneParts(ms, tz) {
    const f = formatters[tz] || (formatters[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
    const o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { date: o.year + '-' + o.month + '-' + o.day, time: o.hour + ':' + o.minute };
  }

  function nowKey() {
    const p = zoneParts(Date.now(), settings.timeZone);
    return p.date + 'T' + p.time;
  }
  function todayStr() { return nowKey().slice(0, 10); }
  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function isoDay(date) {
    const d = new Date(date + 'T12:00:00Z').getUTCDay();
    return d === 0 ? 7 : d;
  }
  function mondayOf(date) { return addDays(date, 1 - isoDay(date)); }
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
  }
  /** A run locks when it starts, at its own date and time. */
  function isLocked(run) { return nowKey() >= run.date + 'T' + run.time; }

  /** Milliseconds timestamp of a start in server time, daylight saving included. */
  function startMs(date, time) {
    const d = date.split('-').map(Number);
    const t = time.split(':').map(Number);
    const target = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const p = zoneParts(guess, settings.timeZone);
      const pd = p.date.split('-').map(Number);
      const pt = p.time.split(':').map(Number);
      const seen = Date.UTC(pd[0], pd[1] - 1, pd[2], pt[0], pt[1]);
      if (seen === target) break;
      guess += target - seen;
    }
    return guess;
  }

  const viewerTz = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  })();

  /** "20:00 your time" for guildies outside the server's time zone. */
  function localStartHint(run) {
    if (!viewerTz || viewerTz === settings.timeZone) return '';
    const local = zoneParts(startMs(run.date, run.time), viewerTz);
    if (local.date === run.date && local.time === run.time) return '';
    const day = local.date === run.date ? '' : ' ' + DOW_SHORT[isoDay(local.date) - 1];
    return local.time + day + ' your time';
  }

  function zoneAbbrev(run) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, timeZoneName: 'short' })
        .formatToParts(new Date(startMs(run.date, run.time)));
      const name = parts.find(function (p) { return p.type === 'timeZoneName'; });
      return name ? name.value : '';
    } catch (e) { return ''; }
  }

  function dom(date) { return Number(date.slice(8, 10)); }
  function mon(date) { return Number(date.slice(5, 7)) - 1; }
  function dayName(date) { return DOW_LONG[isoDay(date) - 1]; }
  function fmtShort(date) { return DOW_SHORT[isoDay(date) - 1] + ' ' + dom(date) + ' ' + MON_SHORT[mon(date)]; }
  function fmtLong(date) { return dayName(date) + ' ' + dom(date) + ' ' + MON_LONG[mon(date)]; }
  function fmtRange(a, b) {
    if (a === b) return dom(a) + ' ' + MON_SHORT[mon(a)];
    return mon(a) === mon(b)
      ? dom(a) + '–' + dom(b) + ' ' + MON_SHORT[mon(b)]
      : dom(a) + ' ' + MON_SHORT[mon(a)] + ' – ' + dom(b) + ' ' + MON_SHORT[mon(b)];
  }

  // Durations use no-break spaces so "in 9 h 45 min" never splits across lines.
  function untilText(run) {
    const S = ' ';
    const today = todayStr();
    if (run.date !== today) {
      const days = daysBetween(today, run.date);
      return days === 1 ? 'tomorrow' : 'in' + S + days + S + 'days';
    }
    const ms = startMs(run.date, run.time) - Date.now();
    if (ms <= 30000) return 'starting' + S + 'now';
    const min = Math.ceil(ms / 60000);
    if (min < 60) return 'in' + S + min + S + 'min';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? 'in' + S + h + S + 'h' + S + m + S + 'min' : 'in' + S + h + S + 'h';
  }

  function agoText(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 15) return 'just now';
    if (s < 60) return s + ' seconds ago';
    const m = Math.round(s / 60);
    if (m < 60) return m === 1 ? '1 minute ago' : m + ' minutes ago';
    return 'at ' + zoneParts(ms, viewerTz || settings.timeZone).time;
  }

  /* ---------------------------------------------------------------- */
  /* Runs                                                               */
  /* ---------------------------------------------------------------- */

  // A run is known by its key, its regular night: sign-ups point at the key. Officers can move a
  // run to another date and time in the sheet, and its sign-ups move with it.
  function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function isTimeStr(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }

  function makeRun(key, extra) {
    const r = extra || {};
    return {
      key: key,
      date: isDateStr(r.date) ? r.date : key,
      time: isTimeStr(r.time) ? r.time : settings.startTime,
      dungeon: r.dungeon ? String(r.dungeon) : '',
      message: r.message ? String(r.message) : '',
    };
  }

  function byRunTime(a, b) {
    const x = a.date + 'T' + a.time;
    const y = b.date + 'T' + b.time;
    if (x !== y) return x < y ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }

  /** The regular runs in a range: before the first load, and for older sheet scripts. */
  function defaultRuns(range, notes) {
    const out = [];
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      if (settings.days.indexOf(isoDay(d)) !== -1) out.push(makeRun(d, notes && notes[d]));
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  /* Talking to the sheet (or the demo)                                 */
  /* ---------------------------------------------------------------- */

  function apiError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function liveApi(url) {
    async function call(method, payload) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
      try {
        let res;
        if (method === 'GET') {
          const q = new URLSearchParams(Object.assign({}, payload, { _: String(Date.now()) }));
          res = await fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + q.toString(), { signal: ctrl && ctrl.signal });
        } else {
          // text/plain keeps this a "simple" request, which Apps Script can answer across origins.
          res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            signal: ctrl && ctrl.signal,
          });
        }
        if (!res.ok) throw apiError('network', 'The sheet answered with an error (' + res.status + ').');
        let data;
        try { data = await res.json(); } catch (e) {
          throw apiError('network', "The sheet's answer couldn't be read. Check the web app URL in config.js.");
        }
        if (!data || data.ok !== true) {
          throw apiError((data && data.code) || 'server', (data && data.error) || 'The sheet refused the request.');
        }
        return data;
      } catch (e) {
        if (e && e.code) throw e;
        throw apiError('network', e && e.name === 'AbortError'
          ? 'The sheet took too long to answer. Try again.'
          : "Can't reach the guild sheet. Check your connection, then try again.");
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return {
      list: function (range) {
        return call('GET', { action: 'list', from: range.from, to: range.to, token: deviceToken() });
      },
      write: function (action, body, range) {
        return call('POST', Object.assign({ action: action, token: deviceToken(), from: range.from, to: range.to }, body));
      },
    };
  }

  /** Same answers as the sheet, kept in this browser. Used while config.js has no apiUrl. */
  function demoApi() {
    const KEY = 'demo-v3';
    const monday = mondayOf(todayStr());
    let db = store.get(KEY, null);
    if (!db || db.monday !== monday || !Array.isArray(db.signups) || !Array.isArray(db.schedule)) {
      db = seedDemo(monday);
      store.set(KEY, db);
    }
    function save() { store.set(KEY, db); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function sameCharacter(a, b) { return a.name.toLowerCase() === b.name.toLowerCase() && a.class === b.class; }
    /** Like the sheet: Schedule rows move runs; regular nights without a row keep their date and time. */
    function runsIn(range) {
      const rows = {};
      db.schedule.forEach(function (r) { if (!rows[r.key]) rows[r.key] = makeRun(r.key, r); });
      const out = Object.keys(rows).map(function (k) { return rows[k]; })
        .filter(function (r) { return r.date >= range.from && r.date <= range.to; });
      defaultRuns(range).forEach(function (r) { if (!rows[r.key]) out.push(r); });
      return out.sort(byRunTime);
    }
    function runForKey(key) {
      const row = db.schedule.find(function (r) { return r.key === key; });
      if (row) return makeRun(key, row);
      return settings.days.indexOf(isoDay(key)) !== -1 ? makeRun(key) : null;
    }
    function payload(range) {
      const me = deviceToken();
      const runs = runsIn(range);
      const keys = {};
      runs.forEach(function (r) { keys[r.key] = true; });
      return {
        ok: true,
        now: nowKey(),
        settings: { timeZone: settings.timeZone, startTime: settings.startTime, days: settings.days },
        runs: runs,
        signups: db.signups
          .filter(function (s) { return keys[s.date]; })
          .map(function (s) {
            const o = Object.assign({}, s, { mine: s.owner === me });
            delete o.owner;
            return o;
          }),
      };
    }
    function problem(key, existing) {
      if (!isDateStr(key)) return 'invalid';
      const run = runForKey(key);
      if (!run) return existing ? '' : 'not_a_run_day';
      if (isLocked(run)) return 'locked';
      if (!existing && daysBetween(todayStr(), run.date) > 14) return 'too_far';
      return '';
    }
    function find(id) {
      const s = db.signups.find(function (x) { return x.id === id; });
      if (!s) throw apiError('not_found', 'That sign-up no longer exists.');
      if (s.owner !== deviceToken()) throw apiError('not_yours', 'This sign-up was made on another device.');
      if (problem(s.date, true)) throw apiError('locked', 'That run has already started, so its sign-ups are locked.');
      return s;
    }
    return {
      list: async function (range) {
        await sleep(300);
        return payload(range);
      },
      write: async function (action, body, range) {
        await sleep(450);
        let result;
        if (action === 'signup') {
          const created = [];
          const skipped = [];
          Array.from(new Set(body.dates || [])).forEach(function (date) {
            const p = problem(date, false);
            if (p) { skipped.push({ date: date, reason: p }); return; }
            if (db.signups.some(function (s) { return s.date === date && sameCharacter(s, body); })) {
              skipped.push({ date: date, reason: 'duplicate' });
              return;
            }
            const id = 'demo-' + Math.random().toString(36).slice(2, 10);
            db.signups.push({
              id: id, date: date, name: body.name, class: body.class, spec: body.spec, role: body.role,
              dungeons: body.dungeons, note: body.note, created: new Date().toISOString(), owner: deviceToken(),
            });
            created.push({ id: id, date: date });
          });
          result = { created: created, skipped: skipped };
        } else if (action === 'update') {
          const s = find(body.id);
          const clash = db.signups.some(function (x) { return x.date === s.date && x.id !== s.id && sameCharacter(x, body); });
          if (clash) throw apiError('duplicate', body.name + ' is already signed up for that night with that class.');
          Object.assign(s, {
            name: body.name, class: body.class, spec: body.spec, role: body.role, dungeons: body.dungeons, note: body.note,
          });
          result = { updated: s.id };
        } else if (action === 'remove') {
          const s = find(body.id);
          db.signups = db.signups.filter(function (x) { return x.id !== s.id; });
          result = { removed: s.id };
        }
        save();
        return Object.assign(payload(range), { result: result });
      },
      reset: function () {
        db = seedDemo(monday);
        save();
      },
    };
  }

  /** Sample sign-ups placed around the current week: one to four groups a night. */
  function seedDemo(monday) {
    let t = Date.parse(monday + 'T08:00:00Z') - 3 * 86400000;
    function d(n) { return addDays(monday, n); }
    const ROSTER = {
      Grokmar: ['warrior', 'Protection'], Thunderhoof: ['druid', 'Feral (Bear)'], Bonecrusher: ['paladin', 'Protection'],
      Ironhide: ['warrior', 'Protection'], Zaljira: ['shaman', 'Restoration'], Ashenveil: ['priest', 'Holy'],
      Mossbloom: ['druid', 'Restoration'], Kaja: ['rogue', 'Combat'], Vexley: ['mage', 'Frost'],
      Mortivane: ['warlock', 'Destruction'], Sylvra: ['hunter', 'Marksmanship'], Morrok: ['warrior', 'Fury'],
      Nyxa: ['mage', 'Fire'], Rekka: ['rogue', 'Assassination'], Tazgrim: ['shaman', 'Enhancement'],
      Velka: ['hunter', 'Beast Mastery'], Drogath: ['warlock', 'Affliction'],
    };
    function night(n, list) {
      return list.map(function (row) {
        const who = ROSTER[row[0]];
        const role = classById(who[0]).specs.find(function (s) { return s.name === who[1]; }).role;
        t += 23 * 60000;
        return {
          id: 'seed-' + row[0].toLowerCase() + '-' + d(n), date: d(n), name: row[0], class: who[0], spec: who[1], role: role,
          dungeons: row[1] || [], note: row[2] || '', created: new Date(t).toISOString(), owner: 'seed',
        };
      });
    }
    const signups = [].concat(
      night(0, [['Grokmar', ['brd']], ['Zaljira', ['brd', 'lbrs']], ['Kaja', ['brd']], ['Vexley', ['lbrs']], ['Sylvra', []]]),
      night(1, [
        ['Thunderhoof', ['scholo']], ['Ashenveil', ['strat-ud']], ['Morrok', ['scholo', 'brd']], ['Mortivane', ['strat-ud']],
        ['Nyxa', ['scholo']], ['Bonecrusher', ['strat-ud', 'scholo']], ['Zaljira', ['strat-ud']], ['Rekka', ['scholo'], 'Late by 10 min'],
        ['Kaja', ['strat-ud']], ['Sylvra', ['scholo']], ['Grokmar', ['strat-ud']], ['Mossbloom', []], ['Velka', ['scholo', 'strat-ud']],
        ['Tazgrim', []],
      ]),
      night(2, [['Kaja', ['dme']], ['Sylvra', ['dme', 'dmw']], ['Vexley', []]]),
      night(3, [
        ['Grokmar', ['bmh']], ['Zaljira', ['bmh', 'terrace']], ['Mortivane', ['bmh']], ['Nyxa', ['terrace']], ['Morrok', ['bmh']],
        ['Bonecrusher', ['bmh']], ['Rekka', ['terrace']], ['Velka', []],
      ]),
      night(4, [
        ['Thunderhoof', ['strat-live', 'scholo'], 'Have the Key to the City'], ['Zaljira', ['strat-live', 'strat-ud']],
        ['Kaja', ['strat-live'], 'Can stay about an hour'], ['Mortivane', ['strat-live', 'terrace']], ['Vexley', []],
        ['Grokmar', ['brd', 'strat-live']], ['Ashenveil', ['scholo', 'strat-live']], ['Morrok', ['brd']],
        ['Nyxa', ['scholo', 'terrace']], ['Sylvra', ['strat-live', 'bmh']], ['Bonecrusher', ['scholo']],
        ['Mossbloom', ['strat-live', 'dmn']], ['Rekka', ['strat-ud']], ['Tazgrim', ['strat-live', 'brd']], ['Velka', ['terrace']],
        ['Ironhide', ['scholo', 'strat-live'], 'First time tanking Strat'], ['Drogath', ['strat-live']],
      ]),
      night(7, [['Grokmar', ['dmn']], ['Ashenveil', ['dmn', 'scholo']]]),
      night(8, [['Nyxa', ['scholo']]]),
      night(10, [
        ['Thunderhoof', ['strat-ud']], ['Mossbloom', ['strat-ud', 'scholo']], ['Kaja', ['scholo']], ['Vexley', []],
        ['Rekka', ['strat-ud']], ['Ironhide', ['scholo']],
      ]),
      night(11, [['Sylvra', ['terrace']], ['Morrok', ['terrace', 'bmh']], ['Zaljira', ['bmh']]])
    );
    return {
      monday: monday,
      signups: signups,
      // What officers set in the Schedule tab: notes, a locked-in dungeon, a new start time, a moved run.
      schedule: [
        { key: d(4), message: 'Meet at the Stratholme gate at 20:50.' },
        { key: d(7), dungeon: 'Dire Maul North', message: 'Tribute run, bring your Crescent Keys.' },
        { key: d(8), time: '20:30' },
        { key: d(10), date: d(12), time: '20:00', message: 'Thursday clashes with the realm maintenance.' },
      ],
    };
  }

  const api = isDemo ? demoApi() : liveApi(CFG.apiUrl);

  /* ---------------------------------------------------------------- */
  /* State and derived data                                             */
  /* ---------------------------------------------------------------- */

  const state = {
    signups: [],
    runs: [],
    runByKey: {},
    loaded: false,
    loading: false,
    error: null,
    lastSync: 0,
    week: 0,
    selected: null,
    touched: false,
    confirm: null,
    pending: {},
  };

  function loadRange() {
    const m0 = mondayOf(todayStr());
    return { from: m0, to: addDays(m0, 13) };
  }

  /** The runs on show: the sheet's once loaded, the regular nights until then. */
  function currentRuns() { return state.loaded ? state.runs : defaultRuns(loadRange()); }

  function findRun(key) {
    return state.runByKey[key] || currentRuns().find(function (r) { return r.key === key; }) || null;
  }
  function runFor(key) { return findRun(key) || makeRun(key); }

  /** This week and next, each with the runs that fall in it (by their actual date). */
  function weeks() {
    const m0 = mondayOf(todayStr());
    const runs = currentRuns();
    return [0, 1].map(function (i) {
      const monday = addDays(m0, i * 7);
      const sunday = addDays(monday, 6);
      return {
        index: i,
        monday: monday,
        runs: runs.filter(function (r) { return r.date >= monday && r.date <= sunday; }),
      };
    });
  }

  function weekOf(key) {
    return weeks().findIndex(function (w) { return w.runs.some(function (r) { return r.key === key; }); });
  }

  function defaultWeek() { return weeks()[0].runs.every(isLocked) ? 1 : 0; }
  function firstOpen(runs) {
    const run = runs.find(function (r) { return !isLocked(r); });
    return run ? run.key : null;
  }

  /** Keys in start order, for the sign-up request and the button label. */
  function sortedKeys(keys) {
    return Array.from(keys).map(runFor).sort(byRunTime).map(function (r) { return r.key; });
  }

  // Sign-up time first; ties keep the sheet's row order (the sort is stable).
  function byOrder(a, b) {
    if (a.created === b.created) return 0;
    return a.created < b.created ? -1 : 1;
  }

  /** First come, first served per role: once a slot type is full, a new group opens. */
  function buildGroups(entries) {
    const groups = [];
    entries.forEach(function (e) {
      const slot = slotOf(e.role);
      let g = groups.find(function (x) { return x[slot].length < party[slot]; });
      if (!g) {
        g = { tank: [], healer: [], dps: [] };
        groups.push(g);
      }
      g[slot].push(e);
    });
    if (!groups.length) groups.push({ tank: [], healer: [], dps: [] });
    return groups.map(function (g, i) {
      return Object.assign(g, {
        index: i,
        size: g.tank.length + g.healer.length + g.dps.length,
        needs: {
          tank: Math.max(0, party.tank - g.tank.length),
          healer: Math.max(0, party.healer - g.healer.length),
          dps: Math.max(0, party.dps - g.dps.length),
        },
      });
    });
  }

  function needsText(needs) {
    const parts = [];
    if (needs.tank) parts.push(needs.tank === 1 ? 'a tank' : needs.tank + ' tanks');
    if (needs.healer) parts.push(needs.healer === 1 ? 'a healer' : needs.healer + ' healers');
    if (needs.dps) parts.push(needs.dps + ' DPS');
    if (!parts.length) return '';
    const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
    return 'Needs ' + list;
  }

  /** Every preferred dungeon counts once for that person. */
  function tally(entries) {
    const counts = {};
    let any = 0;
    entries.forEach(function (e) {
      if (!e.dungeons.length) { any++; return; }
      e.dungeons.forEach(function (id) { counts[id] = (counts[id] || 0) + 1; });
    });
    const list = Object.keys(counts)
      .map(function (id) { return { d: dungeonById(id), n: counts[id] }; })
      .sort(function (a, b) { return b.n - a.n || a.d.name.localeCompare(b.d.name); });
    const max = list.length ? list[0].n : 0;
    return { list: list, any: any, max: max, leaders: list.filter(function (x) { return x.n === max && max > 0; }) };
  }

  function nightModel(run) {
    const entries = state.signups.filter(function (s) { return s.date === run.key; }).sort(byOrder);
    const locked = isLocked(run);
    return {
      key: run.key,
      date: run.date,
      time: run.time,
      moved: run.date !== run.key,
      retimed: run.time !== settings.startTime,
      message: run.message,
      entries: entries,
      phase: !locked ? 'open' : run.date === todayStr() ? 'started' : 'done',
      groups: buildGroups(entries),
      prefs: tally(entries),
      fixed: run.dungeon ? resolveDungeon(run.dungeon) : null,
      mine: entries.filter(function (e) { return e.mine; }),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                          */
  /* ---------------------------------------------------------------- */

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const wide = window.matchMedia('(min-width: 960px)');

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(id, cls) {
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }

  function slotHtml(member, slot) {
    if (!member) return '<span class="slot">' + icon(slot === 'dps' ? 'i-melee' : ROLE_ICON[slot]) + '</span>';
    return '<span class="slot is-filled" style="--c:' + esc(classById(member.class).color) + '">' + icon(ROLE_ICON[member.role]) + '</span>';
  }

  function nameList(entries) {
    const names = entries.map(function (e) {
      return '<span class="name" style="color:' + esc(classById(e.class).color) + '">' + esc(e.name) + '</span>';
    });
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  }

  function pickInfo(n) {
    if (n.fixed) return { name: n.fixed.name, meta: 'Picked by the organiser', icon: 'i-lock' };
    const p = n.prefs;
    if (!n.entries.length) return { name: n.phase === 'open' ? 'No sign-ups yet' : 'No sign-ups', meta: '', cls: 'is-empty' };
    if (!p.leaders.length) return { name: 'Any dungeon', meta: 'No preference yet' };
    if (p.leaders.length === 1) return { name: p.leaders[0].d.name, meta: 'Preferred by ' + p.max };
    const names = p.leaders.slice(0, 2).map(function (x) { return x.d.short; }).join(' or ');
    const extra = p.leaders.length > 2 ? ' +' + (p.leaders.length - 2) : '';
    return { name: names + extra, meta: 'Tied, ' + p.max + ' each' };
  }

  function whenHtml(n) {
    if (n.phase === 'open') return '<span class="when">' + esc(untilText(n)) + '</span>';
    if (n.phase === 'started') return '<span class="when">' + icon('i-lock') + 'Started</span>';
    return '<span class="when">Done</span>';
  }

  /** "Moved from Thu 26", "Starts 20:00" or both, when officers changed the run in the sheet. */
  function changeFlag(n) {
    const S = '\u00a0'; // each part stays on one line; a narrow tile breaks after the comma
    const parts = [];
    if (n.moved) parts.push(['Moved', 'from', DOW_SHORT[isoDay(n.key) - 1], dom(n.key)].join(S));
    if (n.retimed) parts.push((parts.length ? 'starts' : 'Starts') + S + n.time);
    return parts.join(', ');
  }

  /** The same change, spelled out at the top of the run's details. */
  function changeNotice(n) {
    const from = n.moved ? 'Moved from ' + fmtLong(n.key) : '';
    const at = n.retimed ? 'starts at ' + n.time + ' instead of ' + settings.startTime : '';
    if (from && at) return from + ', and ' + at + '.';
    if (from) return from + '.';
    return at ? 'This run ' + at + '.' : '';
  }

  /** The overview stays lean: dungeon, headcount, when, any change to the run, and whether you're in. */
  function tile(n, selected) {
    const today = n.date === todayStr();
    const chev = icon('i-chevron', 'chev');
    let inner;
    if (!state.loaded) {
      inner = '<span class="pick"><span class="pick-name is-placeholder">Loading</span></span><span class="when"></span>' + chev;
    } else {
      const p = pickInfo(n);
      inner = '<span class="pick"><span class="pick-name ' + (p.cls || '') + '">' + (p.icon ? icon(p.icon) : '') + esc(p.name) + '</span>' +
        (p.meta ? '<span class="pick-meta">' + esc(p.meta) + '</span>' : '') + '</span>' + whenHtml(n) + chev;
      let line = '';
      const change = n.phase === 'done' ? '' : changeFlag(n);
      if (change) line += '<span class="flag is-change">' + icon('i-clock') + esc(change) + '</span>';
      if (n.entries.length) {
        line += '<span class="count"><b>' + n.entries.length + '</b> ' + (n.phase === 'done' ? 'went' : 'going') +
          (n.groups.length > 1 ? ' in ' + n.groups.length + ' groups' : '') + '</span>';
      }
      if (n.mine.length && n.phase !== 'done') line += '<span class="flag">' + icon('i-check') + 'You’re in</span>';
      if (line) inner += '<span class="line">' + line + '</span>';
    }
    return '<button class="night-head" type="button" data-action="toggle" data-key="' + n.key + '" data-focus="night-' + n.key +
      '" aria-expanded="' + selected + '" aria-controls="panel-' + n.key + '">' +
      '<span class="date"><span class="dow">' + (today ? 'Today' : DOW_SHORT[isoDay(n.date) - 1]) + '</span><span class="dom">' + dom(n.date) +
      '</span><span class="vh"> ' + MON_LONG[mon(n.date)] + '</span></span>' + inner + '</button>';
  }

  function startLine(n) {
    const extra = [zoneAbbrev(n), localStartHint(n)].filter(Boolean).join(', ');
    return 'Starts at ' + n.time + ' server time' + (extra ? ' (' + extra + ')' : '') +
      (n.date === todayStr() ? ', ' + untilText(n) : '') + '.';
  }

  function mineRow(n, e) {
    const cls = classById(e.class);
    const who = '<span class="mine-who"><span class="mine-name" style="color:' + esc(cls.color) + '">' + esc(e.name) + '</span>' +
      '<span class="mine-spec">' + esc(e.spec) + ' ' + esc(cls.name) + '</span></span>';
    if (state.confirm === e.id) {
      const busy = !!state.pending[e.id];
      return '<li class="mine">' + who + '<span class="mine-confirm"><span>Un-sign ' + esc(e.name) + ' from ' + dayName(n.date) + '?</span>' +
        '<span class="mine-actions"><button class="btn btn-danger btn-sm" type="button" data-action="unsign-yes" data-id="' + esc(e.id) +
        '" data-focus="unsign-yes-' + esc(e.id) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Un-signing…' : 'Un-sign') + '</button>' +
        '<button class="link-btn" type="button" data-action="unsign-no" data-id="' + esc(e.id) + '"' + (busy ? ' disabled' : '') + '>Keep</button></span></span></li>';
    }
    return '<li class="mine">' + who + '<span class="mine-actions">' +
      '<button class="link-btn" type="button" data-action="edit" data-id="' + esc(e.id) + '" data-focus="edit-' + esc(e.id) + '">' + icon('i-quill') + 'Edit</button>' +
      '<button class="link-btn is-danger" type="button" data-action="unsign" data-id="' + esc(e.id) + '" data-focus="unsign-' + esc(e.id) + '">Un-sign</button>' +
      '</span></li>';
  }

  /** The highlighted card: when it starts, your status and the main action. */
  function cardHtml(n) {
    if (n.phase === 'done') return '<div class="card is-quiet"><p class="card-line">This run is over.</p></div>';
    if (n.phase === 'started') {
      return '<div class="card is-quiet"><p class="card-line">' + icon('i-lock') + '<span>Started at ' + n.time +
        ' server time. Sign-ups are closed.</span></p>' +
        (n.mine.length ? '<p class="card-line is-in">' + icon('i-check') + '<span>You’re in as ' + nameList(n.mine) + '.</span></p>' : '') + '</div>';
    }
    let html = '<div class="card"><p class="card-line">' + icon('i-clock') + '<span>' + esc(startLine(n)) + '</span></p>';
    if (n.mine.length) {
      html += '<p class="card-line is-in">' + icon('i-check') + '<span>You’re signed up</span></p>' +
        '<ul class="mine-list">' + n.mine.map(function (e) { return mineRow(n, e); }).join('') + '</ul>' +
        '<button class="btn btn-secondary" type="button" data-action="signup" data-key="' + n.key + '" data-focus="signup-' + n.key +
        '">Sign up another character</button>';
    } else {
      html += '<button class="btn btn-primary" type="button" data-action="signup" data-key="' + n.key + '" data-focus="signup-' + n.key +
        '">Sign up for ' + dayName(n.date) + '</button>';
    }
    return html + '</div>';
  }

  function memberRow(e) {
    const cls = classById(e.class);
    return '<li class="member' + (e.mine ? ' is-mine' : '') + '" style="--c:' + esc(cls.color) + '">' + slotHtml(e) +
      '<span class="member-main"><span class="member-line"><span class="member-name">' + esc(e.name) + '</span>' +
      '<span class="member-spec">' + esc(e.spec) + ' ' + esc(cls.name) + '</span>' + (e.mine ? '<span class="you">you</span>' : '') + '</span>' +
      (e.note ? '<span class="member-note">' + esc(e.note) + '</span>' : '') + '</span></li>';
  }

  /** An empty slot is a shortcut: it opens the sign-up for that role. */
  function openSlotRow(n, g, slot, i) {
    return '<li class="member is-open"><button class="slot-btn" type="button" data-action="slot" data-key="' + n.key + '" data-role="' + slot +
      '" data-focus="slot-' + n.key + '-' + g.index + '-' + slot + '-' + i + '">' + slotHtml(null, slot) +
      '<span class="member-main">Open ' + SLOT_WORD[slot] + ' slot<span class="vh">, sign up</span></span>' + icon('i-plus', 'slot-plus') + '</button></li>';
  }

  function groupHtml(n, g) {
    let head = '<header class="group-head"><h3 class="group-title">Group ' + (g.index + 1) + '</h3>' +
      '<span class="group-count">' + g.size + ' of ' + partySize + '</span>';
    if (n.phase === 'open') {
      const needs = needsText(g.needs);
      head += needs ? '<span class="group-needs is-needs">' + needs + '</span>' : '<span class="group-needs is-ready">' + icon('i-check') + 'Ready</span>';
    }
    head += '</header>';
    let rows = '';
    ['tank', 'healer', 'dps'].forEach(function (slot) {
      for (let i = 0; i < party[slot]; i++) {
        const e = g[slot][i];
        if (e) rows += memberRow(e);
        else if (n.phase === 'open') rows += openSlotRow(n, g, slot, i);
      }
    });
    if (!rows) rows = '<li class="member is-empty"><span class="member-main">Nobody signed up.</span></li>';
    return '<section class="group">' + head + '<ul class="roster">' + rows + '</ul></section>';
  }

  function prefsHtml(n) {
    const p = n.prefs;
    let html = '<section class="prefs"><h3 class="prefs-title">Dungeon preference</h3>';
    if (n.fixed) {
      html += '<p class="prefs-note">' + icon('i-lock') + '<span>The organiser picked <b>' + esc(n.fixed.name) + '</b>.</span></p>';
    }
    if (!p.list.length) {
      html += '<p class="prefs-note">' + (n.entries.length
        ? 'Everyone is happy with any dungeon so far.'
        : 'No preferences yet. They come in with sign-ups.') + '</p>';
    } else {
      html += '<ol class="tally">' + p.list.map(function (x) {
        const pct = Math.max(6, Math.round((x.n / n.entries.length) * 100));
        return '<li class="' + (x.n === p.max ? 'is-lead' : '') + '"><span class="tally-name">' + esc(x.d.name) + '</span>' +
          '<span class="tally-n">' + x.n + '</span><span class="tally-bar"><span style="width:' + pct + '%"></span></span></li>';
      }).join('') + '</ol>';
      if (p.any) html += '<p class="prefs-note">' + p.any + (p.any === 1 ? ' is' : ' are') + ' happy with any dungeon.</p>';
    }
    return html + '</section>';
  }

  function panelHtml(n) {
    let html = '<section class="panel" id="panel-' + n.key + '" aria-label="' + fmtLong(n.date) + '">' +
      '<h2 class="panel-title">' + fmtLong(n.date) + '</h2>';
    const notes = [];
    const change = n.phase === 'done' ? '' : changeNotice(n);
    if (change) notes.push('<p class="notice">' + icon('i-clock') + '<span>' + esc(change) + '</span></p>');
    if (n.message) {
      notes.push('<p class="notice">' + icon('i-flag') + '<span><span class="vh">Organiser note: </span>' + esc(n.message) + '</span></p>');
    }
    if (notes.length) html += '<div class="notices">' + notes.join('') + '</div>';
    if (state.loaded) {
      html += '<div class="panel-grid">' + cardHtml(n) +
        '<div class="groups' + (n.groups.length > 1 ? ' is-multi' : '') + '">' +
        n.groups.map(function (g) { return groupHtml(n, g); }).join('') + '</div>' + prefsHtml(n) + '</div>';
    }
    return html + '</section>';
  }

  /** A week's dates run from its first run to its last, so a run moved to Saturday widens it. */
  function weekRange(w) {
    if (!w.runs.length) return fmtRange(w.monday, addDays(w.monday, 6));
    return fmtRange(w.runs[0].date, w.runs[w.runs.length - 1].date);
  }

  function renderWeeks() {
    $('#weeks').innerHTML = weeks().map(function (w) {
      return '<button type="button" class="week-btn" aria-pressed="' + (state.week === w.index) + '" data-action="week" data-week="' + w.index +
        '" data-focus="week-' + w.index + '"><span class="week-name">' + (w.index === 0 ? 'This week' : 'Next week') + '</span>' +
        '<span class="week-dates">' + weekRange(w) + '</span></button>';
    }).join('');
  }

  function renderBoard() {
    const board = $('#board');
    const week = weeks()[state.week];
    const nights = week.runs.map(nightModel);
    const isWide = wide.matches;
    let html = '';
    if (!state.loaded && state.error) {
      html += '<div class="board-error"><p>' + esc(state.error.message) + '</p>' +
        '<button class="btn btn-secondary" type="button" data-action="retry" data-focus="retry">Try again</button></div>';
    }
    if (!nights.length) html += '<p class="board-empty">No runs are scheduled for this week.</p>';
    else html += '<ol class="nights" style="--cols:' + nights.length + '">';
    nights.forEach(function (n) {
      const selected = state.selected === n.key;
      const cls = ['night', 'is-' + n.phase];
      if (n.date === todayStr()) cls.push('is-today');
      if (selected) cls.push('is-selected');
      html += '<li class="' + cls.join(' ') + '">' + tile(n, selected) + (selected && !isWide ? panelHtml(n) : '') + '</li>';
    });
    if (nights.length) html += '</ol>';
    const sel = nights.find(function (n) { return n.key === state.selected; });
    if (sel && isWide) html += panelHtml(sel);
    board.innerHTML = html;
    board.setAttribute('aria-busy', state.loaded ? 'false' : 'true');
  }

  function renderFooter() {
    let sync;
    if (isDemo) {
      sync = '<p class="sync is-demo">Demo mode: sample sign-ups, saved in this browser only. Add the sheet URL to config.js to go live. ' +
        '<button class="link-btn" type="button" data-action="reset-demo">Reset the demo</button></p>';
    } else if (state.error && state.loaded) {
      sync = '<p class="sync is-error">Couldn’t sync with the guild sheet. Showing sign-ups from ' + agoText(state.lastSync) + '. ' +
        '<button class="link-btn" type="button" data-action="retry">Try again</button></p>';
    } else if (state.loaded) {
      sync = '<p class="sync"><span class="dot" aria-hidden="true"></span>Synced with the guild sheet ' + agoText(state.lastSync) + '.</p>';
    } else {
      sync = '<p class="sync">Loading sign-ups…</p>';
    }
    $('#footer').innerHTML = sync +
      '<p>Sign-ups close when a run starts. You can edit or un-sign your own sign-ups from the device you used.</p>';
  }

  function render() {
    const active = document.activeElement;
    const key = active && active.getAttribute ? active.getAttribute('data-focus') : null;
    renderWeeks();
    renderBoard();
    renderFooter();
    $('#refresh').classList.toggle('is-spinning', state.loading);
    if (key) {
      const el = document.querySelector('[data-focus="' + key + '"]');
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Loading and saving                                                 */
  /* ---------------------------------------------------------------- */

  function apply(data) {
    if (data.settings) {
      settings.timeZone = data.settings.timeZone || settings.timeZone;
      settings.startTime = data.settings.startTime || settings.startTime;
      if (Array.isArray(data.settings.days) && data.settings.days.length) settings.days = sortDays(data.settings.days);
    }
    state.signups = (data.signups || []).map(function (s) {
      return Object.assign({}, s, {
        role: roleFor(s),
        dungeons: parseDungeons(s.dungeons !== undefined ? s.dungeons : s.dungeon),
        created: s.created || '',
      });
    });
    if (Array.isArray(data.runs)) {
      state.runs = data.runs
        .filter(function (r) { return r && isDateStr(r.key); })
        .map(function (r) { return makeRun(r.key, r); })
        .sort(byRunTime);
    } else {
      // An older sheet script: regular nights only, with its notes.
      const notes = {};
      (data.nights || []).forEach(function (n) {
        if (n && isDateStr(n.date)) notes[n.date] = { dungeon: n.dungeon, message: n.message };
      });
      state.runs = defaultRuns(loadRange(), notes);
    }
    state.runByKey = {};
    state.runs.forEach(function (r) { state.runByKey[r.key] = r; });
    const first = !state.loaded;
    state.loaded = true;
    state.lastSync = Date.now();
    state.error = null;
    if (first) {
      // A link (or a click before the first load) may point at a run that has moved to another week.
      const wi = state.touched && state.selected ? weekOf(state.selected) : -1;
      if (wi !== -1) state.week = wi;
      else if (!state.touched || state.selected) {
        state.week = defaultWeek();
        state.selected = firstOpen(weeks()[state.week].runs);
      }
    }
    if (state.week > weeks().length - 1) state.week = 0;
  }

  let inflight = null;
  function refresh() {
    if (inflight) return inflight;
    state.loading = true;
    $('#refresh').classList.add('is-spinning');
    inflight = api.list(loadRange())
      .then(apply)
      .catch(function (err) { state.error = err; })
      .then(function () {
        inflight = null;
        state.loading = false;
        render();
      });
    return inflight;
  }

  function errorText(err) {
    const known = {
      locked: 'That run has already started, so its sign-ups are closed.',
      not_yours: 'This sign-up was made on another device. Change it there, or ask the organiser to fix it in the sheet.',
      not_found: 'That sign-up no longer exists. The board has been refreshed.',
      busy: 'The sheet is busy. Try again in a moment.',
    };
    return known[err && err.code] || (err && err.message) || 'Something went wrong. Try again.';
  }

  function toast(text, kind) {
    const host = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () { el.remove(); }, 300);
    }, kind === 'error' ? 7000 : 4200);
  }

  async function removeSignup(id) {
    const entry = state.signups.find(function (s) { return s.id === id; });
    if (!entry) return false;
    state.pending[id] = true;
    render();
    try {
      apply(await api.write('remove', { id: id }, loadRange()));
      state.confirm = null;
      toast('Un-signed ' + entry.name + ' from ' + fmtShort(runFor(entry.date).date) + '.');
      return true;
    } catch (err) {
      toast(errorText(err), 'error');
      if (err.code === 'not_found' || err.code === 'locked') refresh();
      return false;
    } finally {
      delete state.pending[id];
      render();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Sign-up sheet                                                      */
  /* ---------------------------------------------------------------- */

  const sheet = $('#sheet');
  const form = $('#sheet-form');
  const sheetState = {
    mode: 'signup', id: null, key: null, role: null, cls: null, spec: null,
    nights: new Set(), dungeons: new Set(), busy: false, confirming: false, returnFocus: null,
  };

  /** With a role picked (from an open slot), only that role's specs are offered. */
  function specsFor(c) {
    return sheetState.role ? c.specs.filter(function (s) { return slotOf(s.role) === sheetState.role; }) : c.specs;
  }

  function renderSheetSub() {
    const sub = $('#sheet-sub');
    if (sheetState.mode === 'edit') sub.textContent = fmtLong(runFor(sheetState.key).date);
    else if (sheetState.role) {
      sub.innerHTML = 'Showing ' + SLOT_WORD[sheetState.role] + ' specs. ' +
        '<button type="button" class="link-btn" data-sheet="all-roles">Show all roles</button>';
    } else sub.textContent = '';
  }

  function renderClassGrid() {
    const shown = CLASSES.filter(function (c) { return specsFor(c).length; });
    if (sheetState.cls && !shown.some(function (c) { return c.id === sheetState.cls; })) {
      sheetState.cls = null;
      sheetState.spec = null;
    }
    $('#f-class').innerHTML = shown.map(function (c) {
      return '<label class="chip chip-class" style="--c:' + esc(c.color) + '"><input type="radio" name="class" value="' + esc(c.id) + '"' +
        (sheetState.cls === c.id ? ' checked' : '') + '><span class="chip-face"><span class="chip-swatch" aria-hidden="true"></span>' +
        esc(c.name) + '</span></label>';
    }).join('');
  }

  function renderSpecGrid() {
    const c = CLASSES.find(function (x) { return x.id === sheetState.cls; });
    $('#spec-field').hidden = !c;
    if (!c) {
      $('#f-spec').innerHTML = '';
      return;
    }
    const specs = specsFor(c);
    if (!specs.some(function (s) { return s.name === sheetState.spec; })) sheetState.spec = specs.length === 1 ? specs[0].name : null;
    $('#f-spec').innerHTML = specs.map(function (s) {
      return '<label class="chip chip-spec"><input type="radio" name="spec" value="' + esc(s.name) + '"' +
        (sheetState.spec === s.name ? ' checked' : '') + '><span class="chip-face">' + icon(ROLE_ICON[s.role]) +
        '<span class="chip-text"><span>' + esc(s.name) + '</span><small>' + ROLE_LABEL[s.role] + '</small></span></span></label>';
    }).join('');
  }

  /** Every upcoming run is open, by its actual date and time. Past runs simply aren't listed. */
  function renderNights() {
    Array.from(sheetState.nights).forEach(function (k) {
      const run = findRun(k);
      if (!run || isLocked(run)) sheetState.nights.delete(k);
    });
    const html = weeks().map(function (w) {
      const open = w.runs.filter(function (r) { return !isLocked(r); });
      if (!open.length) return '';
      return '<div class="nights-week"><p class="nights-week-name">' + (w.index === 0 ? 'This week' : 'Next week') + '</p>' +
        '<div class="nights-grid">' + open.map(function (r) {
          const mine = state.signups.some(function (s) { return s.date === r.key && s.mine; });
          const tonight = r.date === todayStr();
          const retimed = r.time !== settings.startTime;
          const note = mine ? 'You’re in' : retimed ? r.time : tonight ? 'Tonight' : r.date !== r.key ? 'Moved' : '';
          const label = [fmtLong(r.date) + (retimed ? ' at ' + r.time : '')];
          if (r.date !== r.key) label.push('moved from ' + dayName(r.key));
          if (mine) label.push('You’re in');
          else if (tonight) label.push('Tonight');
          return '<label class="chip chip-night"><input type="checkbox" name="night" value="' + r.key + '"' +
            (sheetState.nights.has(r.key) ? ' checked' : '') + ' aria-label="' + esc(label.join(', ')) + '">' +
            '<span class="chip-face">' + icon('i-check', 'n-check') + '<span class="n-dow">' + DOW_SHORT[isoDay(r.date) - 1] + '</span>' +
            '<span class="n-dom">' + dom(r.date) + '</span><span class="n-note">' + (note || '&nbsp;') + '</span></span></label>';
        }).join('') + '</div></div>';
    }).join('');
    $('#f-nights').innerHTML = html || '<p class="field-hint">No nights are open for sign-ups right now.</p>';
  }

  function renderDungeonGrid() {
    const extra = Array.from(sheetState.dungeons)
      .filter(function (id) { return !DUNGEONS.some(function (d) { return d.id === id; }); })
      .map(dungeonById);
    $('#f-dungeons').innerHTML = DUNGEONS.concat(extra).map(function (d) {
      return '<label class="chip chip-dungeon"><input type="checkbox" name="dungeon" value="' + esc(d.id) + '"' +
        (sheetState.dungeons.has(d.id) ? ' checked' : '') + '><span class="chip-face"><span class="box">' + icon('i-check') + '</span>' +
        '<span>' + esc(d.name) + '</span></span></label>';
    }).join('');
  }

  function renderSheetFoot() {
    const busy = sheetState.busy;
    let html = '<p class="sheet-error" id="sheet-error" role="alert" hidden></p>';
    if (sheetState.mode === 'signup') {
      const picked = sortedKeys(sheetState.nights);
      const label = busy ? 'Signing up…' : picked.length === 1 ? 'Sign up for ' + fmtShort(runFor(picked[0]).date)
        : picked.length > 1 ? 'Sign up for ' + picked.length + ' nights' : 'Sign up';
      html += '<button type="submit" class="btn btn-primary"' + (busy ? ' disabled' : '') + '>' + label + '</button>' +
        '<button type="button" class="btn btn-ghost" data-close>Cancel</button>';
    } else if (sheetState.confirming) {
      html += '<p class="confirm-text">Un-sign ' + esc($('#f-name').value || 'this character') + ' from ' + dayName(runFor(sheetState.key).date) + '?</p>' +
        '<button type="button" class="btn btn-danger" data-sheet="unsign-yes"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Un-signing…' : 'Un-sign') + '</button>' +
        '<button type="button" class="btn btn-ghost" data-sheet="unsign-no"' + (busy ? ' disabled' : '') + '>Keep</button>';
    } else {
      html += '<button type="submit" class="btn btn-primary"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Saving…' : 'Save changes') + '</button>' +
        '<button type="button" class="btn btn-danger-ghost" data-sheet="unsign">Un-sign</button>' +
        '<button type="button" class="btn btn-ghost" data-close>Cancel</button>';
    }
    $('#sheet-foot').innerHTML = html;
  }

  function sheetError(text) {
    const el = $('#sheet-error');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function updateCounter() {
    $('#c-note').textContent = $('#f-note').value.length + ' / 80';
  }

  function setFieldError(field, text) {
    const el = $('#e-' + field);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function clearErrors() { ['name', 'class', 'spec', 'nights'].forEach(function (f) { setFieldError(f, ''); }); }

  function renderSheet() {
    renderSheetSub();
    renderClassGrid();
    renderSpecGrid();
    if (sheetState.mode === 'signup') renderNights();
    renderDungeonGrid();
    renderSheetFoot();
    updateCounter();
  }

  function showSheet() {
    sheetState.returnFocus = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-focus') : null;
    if (!sheet.open) {
      if (typeof sheet.showModal === 'function') sheet.showModal();
      else sheet.setAttribute('open', '');
    }
    document.documentElement.classList.add('has-sheet');
    $('.sheet-body', sheet).scrollTop = 0;
    if (!$('#f-name').value) $('#f-name').focus();
  }

  function closeSheet() {
    if (sheet.open) {
      if (typeof sheet.close === 'function') sheet.close();
      else { sheet.removeAttribute('open'); onSheetClosed(); }
    }
  }

  function onSheetClosed() {
    document.documentElement.classList.remove('has-sheet');
    sheetState.busy = false;
    sheetState.confirming = false;
    const key = sheetState.returnFocus;
    const target = (key && document.querySelector('[data-focus="' + key + '"]')) ||
      (sheetState.key && document.querySelector('[data-focus="night-' + sheetState.key + '"]'));
    if (target) target.focus({ preventScroll: true });
  }

  function openSignup(key, role) {
    const profile = store.get('profile', {}) || {};
    const run = key ? findRun(key) : null;
    Object.assign(sheetState, { mode: 'signup', id: null, key: key || null, role: role || null, busy: false, confirming: false });
    $('#sheet-title').textContent = 'Sign up';
    $('#f-name').value = profile.name || '';
    $('#f-note').value = '';
    sheetState.cls = profile.class && classById(profile.class).specs.length ? profile.class : null;
    sheetState.spec = profile.spec || null;
    sheetState.dungeons = new Set(parseDungeons(profile.dungeons || []));
    sheetState.nights = new Set(run && !isLocked(run) ? [key] : []);
    $('#nights-field').hidden = false;
    clearErrors();
    renderSheet();
    showSheet();
  }

  function openEdit(id) {
    const e = state.signups.find(function (s) { return s.id === id; });
    if (!e) return;
    Object.assign(sheetState, {
      mode: 'edit', id: id, key: e.date, role: null, busy: false, confirming: false,
      cls: e.class, spec: e.spec, nights: new Set(), dungeons: new Set(e.dungeons),
    });
    $('#sheet-title').textContent = 'Edit sign-up';
    $('#f-name').value = e.name;
    $('#f-note').value = e.note || '';
    $('#nights-field').hidden = true;
    clearErrors();
    renderSheet();
    showSheet();
  }

  function readForm() {
    const c = CLASSES.find(function (x) { return x.id === sheetState.cls; });
    const spec = c && c.specs.find(function (s) { return s.name === sheetState.spec; });
    const picked = DUNGEONS.map(function (d) { return d.id; })
      .filter(function (id) { return sheetState.dungeons.has(id); })
      .concat(Array.from(sheetState.dungeons).filter(function (id) { return !DUNGEONS.some(function (d) { return d.id === id; }); }));
    return {
      name: $('#f-name').value.replace(/\s+/g, ' ').trim(),
      class: c ? c.id : '',
      spec: spec ? spec.name : '',
      role: spec ? spec.role : '',
      dungeons: picked,
      note: $('#f-note').value.replace(/\s+/g, ' ').trim(),
    };
  }

  function validate(data) {
    const errors = [];
    if (data.name.length < 2) errors.push(['name', 'Enter your character name.', '#f-name']);
    if (!data.class) errors.push(['class', 'Pick your class.', '#f-class input']);
    else if (!data.spec) errors.push(['spec', 'Pick your spec.', '#f-spec input']);
    if (sheetState.mode === 'signup' && !sheetState.nights.size) {
      errors.push(['nights', 'Pick at least one night.', '#f-nights input']);
    }
    clearErrors();
    errors.forEach(function (e) { setFieldError(e[0], e[1]); });
    if (errors.length) {
      const first = $(errors[0][2]);
      if (first) first.focus();
      return false;
    }
    return true;
  }

  function skippedText(skipped, data) {
    return skipped.map(function (s) {
      const why = s.reason === 'duplicate'
        ? data.name + ' is already in as ' + classById(data.class).name
        : SKIP_REASON[s.reason] || 'not available';
      return fmtShort(runFor(s.date).date) + ' (' + why + ')';
    }).join(', ');
  }

  /** The sheet stores dungeon names so people can read it; the ids stay for older sheet scripts. */
  function withNames(data) {
    return Object.assign({}, data, { dungeonNames: data.dungeons.map(function (id) { return dungeonById(id).name; }) });
  }

  async function submitSheet() {
    if (sheetState.busy) return;
    const data = readForm();
    if (!validate(data)) return;
    sheetState.busy = true;
    renderSheetFoot();
    try {
      if (sheetState.mode === 'signup') {
        // Sign-ups name runs by their key, wherever the run is now.
        const dates = sortedKeys(sheetState.nights);
        const res = await api.write('signup', Object.assign({ dates: dates }, withNames(data)), loadRange());
        apply(res);
        const created = (res.result && res.result.created) || [];
        const skipped = (res.result && res.result.skipped) || [];
        if (!created.length) {
          sheetState.busy = false;
          renderNights();
          renderSheetFoot();
          sheetError('Nothing was added: ' + skippedText(skipped, data) + '.');
          render();
          return;
        }
        store.set('profile', { name: data.name, class: data.class, spec: data.spec, dungeons: data.dungeons });
        closeSheet();
        let msg = created.length === 1 ? 'Signed up for ' + fmtShort(runFor(created[0].date).date) + '.'
          : 'Signed up for ' + created.length + ' nights.';
        if (skipped.length) msg += ' Skipped ' + skippedText(skipped, data) + '.';
        toast(msg);
      } else {
        apply(await api.write('update', Object.assign({ id: sheetState.id }, withNames(data)), loadRange()));
        store.set('profile', { name: data.name, class: data.class, spec: data.spec, dungeons: data.dungeons });
        closeSheet();
        toast('Changes saved.');
      }
      render();
    } catch (err) {
      sheetState.busy = false;
      renderSheetFoot();
      sheetError(errorText(err));
      if (err.code === 'locked' || err.code === 'not_found') refresh();
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitSheet();
  });

  form.addEventListener('change', function (e) {
    const t = e.target;
    if (t.name === 'class') {
      sheetState.cls = t.value;
      const remembered = store.get('profile', {}) || {};
      sheetState.spec = remembered.class === t.value ? remembered.spec : null;
      renderSpecGrid();
      setFieldError('class', '');
    } else if (t.name === 'spec') {
      sheetState.spec = t.value;
      setFieldError('spec', '');
    } else if (t.name === 'night') {
      if (t.checked) sheetState.nights.add(t.value);
      else sheetState.nights.delete(t.value);
      setFieldError('nights', '');
      renderSheetFoot();
    } else if (t.name === 'dungeon') {
      if (t.checked) sheetState.dungeons.add(t.value);
      else sheetState.dungeons.delete(t.value);
    }
  });

  $('#f-name').addEventListener('input', function () { setFieldError('name', ''); });
  $('#f-note').addEventListener('input', updateCounter);

  sheet.addEventListener('click', async function (e) {
    if (e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    const btn = e.target.closest('[data-sheet]');
    if (btn) {
      const what = btn.getAttribute('data-sheet');
      if (what === 'all-roles') {
        sheetState.role = null;
        renderSheetSub();
        renderClassGrid();
        renderSpecGrid();
        const first = $('#f-class input:checked') || $('#f-class input');
        if (first) first.focus();
      } else if (what === 'unsign') {
        sheetState.confirming = true;
        renderSheetFoot();
        const yes = $('[data-sheet="unsign-yes"]', sheet);
        if (yes) yes.focus();
      } else if (what === 'unsign-no') {
        sheetState.confirming = false;
        renderSheetFoot();
      } else if (what === 'unsign-yes') {
        sheetState.busy = true;
        renderSheetFoot();
        const ok = await removeSignup(sheetState.id);
        sheetState.busy = false;
        if (ok) closeSheet();
        else renderSheetFoot();
      }
      return;
    }
    if (e.target === sheet) {
      const r = sheet.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside && !sheetState.busy) closeSheet();
    }
  });
  sheet.addEventListener('cancel', function (e) { if (sheetState.busy) e.preventDefault(); });
  sheet.addEventListener('close', onSheetClosed);

  /* ---------------------------------------------------------------- */
  /* Board interactions                                                 */
  /* ---------------------------------------------------------------- */

  function setHash(date) {
    try {
      history.replaceState(null, '', date ? '#' + date : location.pathname + location.search);
    } catch (e) { /* not allowed in some embeds */ }
  }

  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-action]');
    if (!t || sheet.contains(t)) return;
    const action = t.getAttribute('data-action');
    if (action === 'toggle') {
      const key = t.getAttribute('data-key');
      state.selected = state.selected === key ? null : key;
      state.touched = true;
      state.confirm = null;
      setHash(state.selected);
      render();
      if (state.selected && !wide.matches) {
        const li = t.closest('.night');
        if (li && li.getBoundingClientRect().top < 0) li.scrollIntoView({ block: 'start' });
      }
    } else if (action === 'week') {
      const i = Number(t.getAttribute('data-week'));
      if (state.week !== i) {
        state.week = i;
        state.selected = firstOpen(weeks()[i].runs);
        state.touched = true;
        state.confirm = null;
        setHash(state.selected);
        render();
      }
    } else if (action === 'signup') {
      openSignup(t.getAttribute('data-key'), null);
    } else if (action === 'slot') {
      openSignup(t.getAttribute('data-key'), t.getAttribute('data-role'));
    } else if (action === 'edit') {
      state.confirm = null;
      openEdit(t.getAttribute('data-id'));
    } else if (action === 'unsign') {
      state.confirm = t.getAttribute('data-id');
      render();
      const yes = document.querySelector('[data-focus="unsign-yes-' + state.confirm + '"]');
      if (yes) yes.focus();
    } else if (action === 'unsign-no') {
      const id = t.getAttribute('data-id');
      state.confirm = null;
      render();
      const back = document.querySelector('[data-focus="unsign-' + id + '"]');
      if (back) back.focus();
    } else if (action === 'unsign-yes') {
      removeSignup(t.getAttribute('data-id'));
    } else if (action === 'retry') {
      refresh();
    } else if (action === 'reset-demo' && api.reset) {
      api.reset();
      state.touched = false;
      state.loaded = false;
      refresh().then(function () { toast('Demo reset.'); });
    }
  });

  $('#refresh').addEventListener('click', function () { refresh(); });

  if (typeof wide.addEventListener === 'function') wide.addEventListener('change', render);
  else if (typeof wide.addListener === 'function') wide.addListener(render);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 20000) refresh();
  });

  /* ---------------------------------------------------------------- */
  /* Start                                                              */
  /* ---------------------------------------------------------------- */

  function init() {
    if (CFG.title) {
      $('#title').textContent = CFG.title;
      document.title = CFG.title + ' sign-ups';
    }
    if (CFG.tagline !== undefined) $('#tagline').textContent = CFG.tagline;

    // Links name a run by its key (#2026-11-26); where it is now is settled once the sheet answers.
    const hash = /^#(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    const wi = hash ? weekOf(hash[1]) : -1;
    if (hash) {
      state.selected = hash[1];
      state.touched = true;
      state.week = wi !== -1 ? wi : defaultWeek();
    } else {
      state.week = defaultWeek();
      state.selected = firstOpen(weeks()[state.week].runs);
    }
    render();
    refresh();

    // Keep countdowns and locks current, and pick up other people's sign-ups.
    setInterval(function () { if (!sheet.open) render(); }, 30000);
    const every = Math.max(15, Number(CFG.refreshSeconds) || 45) * 1000;
    setInterval(function () {
      if (document.visibilityState === 'visible' && !sheet.open) refresh();
    }, every);
  }

  init();
})();
