/* gg-photo-review — pure logic (no DOM).
 * Loaded in the browser as a plain script (window.GGReviewLogic) and in
 * Node for tests (module.exports). Keep it dependency-free. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GGReviewLogic = api;
})(typeof self !== 'undefined' ? self : global, function () {
  'use strict';

  var BEFORE_TOKENS = ['before', 'pre', 'dirty', 'clogged', 'old', 'start', 'b4'];
  var AFTER_TOKENS = ['after', 'post', 'clean', 'done', 'finished', 'new', 'end'];

  function basename(path) {
    return String(path || '').split(/[\\/]/).pop();
  }

  function stem(name) {
    var b = basename(name);
    var i = b.lastIndexOf('.');
    return (i > 0 ? b.slice(0, i) : b).toLowerCase();
  }

  // Split a filename stem into alphanumeric tokens.
  function tokens(name) {
    return stem(name).split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Role of a photo in a before/after pair, by filename keywords.
  // Returns 'before', 'after', or null.
  function detectRole(name) {
    var toks = tokens(name);
    // trailing single-letter suffixes like _b / _a
    var last = toks[toks.length - 1];
    if (last === 'b' || last === 'bef') return 'before';
    if (last === 'a' || last === 'aft') return 'after';
    for (var i = 0; i < toks.length; i++) {
      if (BEFORE_TOKENS.indexOf(toks[i]) !== -1) return 'before';
      if (AFTER_TOKENS.indexOf(toks[i]) !== -1) return 'after';
    }
    return null;
  }

  // Remove before/after tokens (and trailing _b/_a) to get the pair key.
  function baseKey(name) {
    var toks = tokens(name).filter(function (t) {
      return BEFORE_TOKENS.indexOf(t) === -1 && AFTER_TOKENS.indexOf(t) === -1 &&
        t !== 'b' && t !== 'a' && t !== 'bef' && t !== 'aft';
    });
    return toks.join('_');
  }

  // Parse an embedded timestamp: 20260930_120501, 2026-09-30-120501,
  // IMG_20260930_120501, 20260930120501, etc. Returns ms epoch or null.
  function parseTimestamp(name) {
    var s = stem(name);
    var m = s.match(/(\d{4})-?(\d{2})-?(\d{2})[ _\-T]?(\d{2})(\d{2})(\d{2})/);
    if (m) {
      var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
      if (!isNaN(d.getTime())) return d.getTime();
    }
    return null;
  }

  // Parse a trailing numeric sequence: sheet_03 -> {prefix:'sheet_', num:3}.
  function parseSequence(name) {
    var s = stem(name);
    var m = s.match(/^(.*?)(\d+)$/);
    if (m && m[2].length >= 1) return { prefix: m[1], num: parseInt(m[2], 10) };
    return null;
  }

  function sortByName(a, b) {
    return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  }

  // Pair photos into before/after pairs using filename heuristics.
  // items: [{id, name}]. Returns [{id, before, after, single}]
  // where before/after/single are item objects or null.
  function pairPhotos(items) {
    var list = (items || []).slice().sort(sortByName);
    var used = {};
    var pairs = [];
    var i, g;

    // Pass 1: explicit before/after keyword groups sharing a base key.
    var groups = {};
    list.forEach(function (it) {
      if (used[it.id]) return;
      var role = detectRole(it.name);
      if (!role) return;
      var key = baseKey(it.name) || '__norole__';
      (groups[key] = groups[key] || []).push({ it: it, role: role });
    });
    Object.keys(groups).forEach(function (key) {
      g = groups[key];
      var befores = g.filter(function (x) { return x.role === 'before'; });
      var afters = g.filter(function (x) { return x.role === 'after'; });
      while (befores.length && afters.length) {
        var b = befores.shift().it, a = afters.shift().it;
        pairs.push(makePair(b, a));
        used[b.id] = used[a.id] = true;
      }
    });

    // Pass 2: timestamp grouping — same date prefix, pair by ascending time.
    var rest = list.filter(function (it) { return !used[it.id]; });
    var byDate = {};
    rest.forEach(function (it) {
      var ts = parseTimestamp(it.name);
      if (ts == null) return;
      var day = new Date(ts).toISOString().slice(0, 10);
      (byDate[day] = byDate[day] || []).push({ it: it, ts: ts });
    });
    Object.keys(byDate).forEach(function (day) {
      g = byDate[day].sort(function (x, y) { return x.ts - y.ts; });
      for (i = 0; i + 1 < g.length; i += 2) {
        var b2 = g[i].it, a2 = g[i + 1].it;
        pairs.push(makePair(b2, a2));
        used[b2.id] = used[a2.id] = true;
      }
    });

    // Pass 3: numeric sequence pairing — same prefix, consecutive numbers.
    rest = list.filter(function (it) { return !used[it.id]; });
    var byPrefix = {};
    rest.forEach(function (it) {
      var seq = parseSequence(it.name);
      if (!seq) return;
      (byPrefix[seq.prefix] = byPrefix[seq.prefix] || []).push({ it: it, num: seq.num });
    });
    Object.keys(byPrefix).forEach(function (prefix) {
      g = byPrefix[prefix].sort(function (x, y) { return x.num - y.num; });
      for (i = 0; i + 1 < g.length; i += 2) {
        var b3 = g[i].it, a3 = g[i + 1].it;
        pairs.push(makePair(b3, a3));
        used[b3.id] = used[a3.id] = true;
      }
    });

    // Pass 4: leftovers become singles.
    rest = list.filter(function (it) { return !used[it.id]; });
    rest.forEach(function (it) {
      pairs.push({ id: 'pair:' + it.id, before: null, after: null, single: it });
    });

    // Stable order: keyword pairs first (in list order), then timestamp,
    // then sequence, then singles.
    return pairs;
  }

  function makePair(before, after) {
    return {
      id: 'pair:' + before.id + '|' + after.id,
      before: before,
      after: after,
      single: null
    };
  }

  function pairPhotosOf(pair) {
    if (pair.single) return [pair.single];
    return [pair.before, pair.after].filter(Boolean);
  }

  var STATUSES = ['unreviewed', 'approved', 'rejected', 'flagged'];

  function defaultItemState() {
    return { status: 'unreviewed', rating: 0, note: '', at: null };
  }

  function getState(state, itemId) {
    return state[itemId] || defaultItemState();
  }

  // Set state for one photo; returns {state, prev} for undo.
  function setPhotoState(state, itemId, patch) {
    var prev = getState(state, itemId);
    var next = Object.assign({}, prev, patch, { at: new Date().toISOString() });
    var ns = Object.assign({}, state);
    ns[itemId] = next;
    return { state: ns, prev: prev };
  }

  function reviewedCount(state, items) {
    return items.filter(function (it) {
      return getState(state, it.id).status !== 'unreviewed';
    }).length;
  }

  function pairReviewed(state, pair) {
    return pairPhotosOf(pair).every(function (it) {
      return getState(state, it.id).status !== 'unreviewed';
    });
  }

  // Undo stack of {label, state} snapshots (bounded).
  function createUndo(limit) {
    var stack = [];
    limit = limit || 50;
    return {
      push: function (label, state) {
        stack.push({ label: label, state: JSON.parse(JSON.stringify(state)) });
        if (stack.length > limit) stack.shift();
      },
      pop: function () { return stack.pop() || null; },
      canUndo: function () { return stack.length > 0; },
      peek: function () { return stack.length ? stack[stack.length - 1].label : null; },
      depth: function () { return stack.length; }
    };
  }

  // Build the export payload: picks = reviewed photos with rating/status.
  function buildExport(state, items, pairs) {
    var picks = [];
    pairs.forEach(function (pair) {
      pairPhotosOf(pair).forEach(function (it) {
        var st = getState(state, it.id);
        picks.push({
          file: it.name,
          id: it.id,
          pair: pair.id,
          role: pair.single ? 'single' : (pair.before === it ? 'before' : 'after'),
          status: st.status,
          rating: st.rating,
          note: st.note || '',
          reviewedAt: st.at
        });
      });
    });
    return {
      app: 'gg-photo-review',
      exportedAt: new Date().toISOString(),
      totals: {
        photos: items.length,
        reviewed: reviewedCount(state, items),
        pairs: pairs.length,
        approved: picks.filter(function (p) { return p.status === 'approved'; }).length,
        rejected: picks.filter(function (p) { return p.status === 'rejected'; }).length,
        flagged: picks.filter(function (p) { return p.status === 'flagged'; }).length
      },
      picks: picks
    };
  }

  function escapeCsv(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  function exportCSV(payload) {
    var rows = [['file', 'pair', 'role', 'status', 'rating', 'note', 'reviewedAt']];
    payload.picks.forEach(function (p) {
      rows.push([p.file, p.pair, p.role, p.status, p.rating, p.note, p.reviewedAt || '']);
    });
    return rows.map(function (r) { return r.map(escapeCsv).join(','); }).join('\n');
  }

  // Migrate the old v1 localStorage shape {name:{status:'reviewed'|'flagged', at}}
  // to v2 {id:{status,rating,note,at}}.
  function migrateV1(v1) {
    var out = {};
    Object.keys(v1 || {}).forEach(function (name) {
      var old = v1[name] || {};
      var status = old.status === 'reviewed' ? 'approved'
        : old.status === 'flagged' ? 'flagged' : 'unreviewed';
      out[name] = { status: status, rating: 0, note: '', at: old.at || null };
    });
    return out;
  }

  return {
    basename: basename,
    stem: stem,
    detectRole: detectRole,
    baseKey: baseKey,
    parseTimestamp: parseTimestamp,
    parseSequence: parseSequence,
    pairPhotos: pairPhotos,
    pairPhotosOf: pairPhotosOf,
    STATUSES: STATUSES,
    defaultItemState: defaultItemState,
    getState: getState,
    setPhotoState: setPhotoState,
    reviewedCount: reviewedCount,
    pairReviewed: pairReviewed,
    createUndo: createUndo,
    buildExport: buildExport,
    exportCSV: exportCSV,
    migrateV1: migrateV1
  };
});
