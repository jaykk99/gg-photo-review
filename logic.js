/* gg-photo-review : pure logic (no DOM).
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
  // items: [{id, name}]. manualPairs: optional [{before, after, kind}] of item
  // ids that the user paired by hand (kind 'manual') or whose before/after
  // roles they swapped (kind 'swapped'); they win over every heuristic pass.
  // Returns [{id, before, after, single, method}] where method is one of
  // 'manual', 'swapped', 'keyword', 'timestamp', 'sequence', 'single'.
  function pairPhotos(items, manualPairs) {
    var list = (items || []).slice().sort(sortByName);
    var byId = {};
    list.forEach(function (it) { byId[it.id] = it; });
    var used = {};
    var pairs = [];
    var i, g;

    // Pass 0: manual pairs / role swaps the user pinned (before id first).
    (manualPairs || []).forEach(function (mp) {
      var b = byId[mp.before], a = byId[mp.after];
      if (!b || !a || b.id === a.id || used[b.id] || used[a.id]) return;
      pairs.push(makePair(b, a, mp.kind === 'swapped' ? 'swapped' : 'manual'));
      used[b.id] = used[a.id] = true;
    });

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
        pairs.push(makePair(b, a, 'keyword'));
        used[b.id] = used[a.id] = true;
      }
    });

    // Pass 2: timestamp grouping : same date prefix, pair by ascending time.
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
        pairs.push(makePair(b2, a2, 'timestamp'));
        used[b2.id] = used[a2.id] = true;
      }
    });

    // Pass 3: numeric sequence pairing : same prefix, consecutive numbers.
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
        pairs.push(makePair(b3, a3, 'sequence'));
        used[b3.id] = used[a3.id] = true;
      }
    });

    // Pass 4: leftovers become singles.
    rest = list.filter(function (it) { return !used[it.id]; });
    rest.forEach(function (it) {
      pairs.push({ id: 'pair:' + it.id, before: null, after: null, single: it, method: 'single' });
    });

    // Stable order: manual first, then keyword, timestamp, sequence, singles.
    return pairs;
  }

  function makePair(before, after, method) {
    return {
      id: 'pair:' + before.id + '|' + after.id,
      before: before,
      after: after,
      single: null,
      method: method || 'keyword'
    };
  }

  // Human-readable caption for how a pair was formed, shown in the viewer.
  function pairMethodCaption(pair) {
    switch (pair.method) {
      case 'manual': return 'Paired by hand';
      case 'swapped': return 'Before/after swapped by hand';
      case 'keyword': return 'Auto-paired: filename keywords';
      case 'timestamp': return 'Auto-paired: photo timestamps';
      case 'sequence': return 'Auto-paired: numeric sequence';
      default: return 'Single photo';
    }
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

  // Undo stack of {label, state, mpairs} snapshots (bounded).
  // mpairs (manual pairs / swaps) is optional per entry; entries that
  // capture it restore it on undo, entries that don't leave it alone.
  function createUndo(limit) {
    var stack = [];
    limit = limit || 50;
    function deep(o) { return JSON.parse(JSON.stringify(o)); }
    return {
      push: function (label, state, mpairs) {
        stack.push({
          label: label,
          state: deep(state),
          mpairs: mpairs === undefined ? undefined : deep(mpairs)
        });
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

  // Markdown review report: one section per pair with status/rating/notes.
  // Built for pasting into quotes, job write-ups, or customer follow-ups.
  function exportMarkdown(payload) {
    var lines = [];
    lines.push('# Photo review report');
    lines.push('');
    lines.push('Exported: ' + payload.exportedAt);
    lines.push('Photos: ' + payload.totals.photos +
      ' | Pairs: ' + payload.totals.pairs +
      ' | Approved: ' + payload.totals.approved +
      ' | Rejected: ' + payload.totals.rejected +
      ' | Flagged: ' + payload.totals.flagged);
    lines.push('');
    var byPair = {};
    payload.picks.forEach(function (p) {
      (byPair[p.pair] = byPair[p.pair] || []).push(p);
    });
    Object.keys(byPair).forEach(function (pairId, n) {
      var picks = byPair[pairId];
      lines.push('## Pair ' + (n + 1));
      lines.push('');
      picks.forEach(function (p) {
        var stars = p.rating ? ' ' + repeatStars(p.rating) : '';
        lines.push('- **' + p.role + '**: `' + p.file + '`' + stars +
          ' — ' + p.status + (p.note ? ' — _' + p.note + '_' : ''));
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function repeatStars(n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '★';
    return out;
  }

  // Printable HTML contact sheet: grid of the approved picks (falling back
  // to all reviewed picks when nothing is approved yet). Standalone document
  // with inline CSS so it works from a file:// download; thumbnails are
  // referenced by filename and load when opened next to the source photos.
  function exportContactSheetHTML(payload) {
    var approved = payload.picks.filter(function (p) { return p.status === 'approved'; });
    var shown = approved.length ? approved : payload.picks.filter(function (p) { return p.status !== 'unreviewed'; });
    var title = approved.length
      ? 'Approved picks — photo review contact sheet'
      : 'Reviewed picks — photo review contact sheet';
    var cells = shown.map(function (p) {
      var stars = p.rating ? ' <span class="st">' + repeatStars(p.rating) + '</span>' : '';
      return '<figure>' +
        '<img src="' + escHtml(p.file) + '" alt="' + escHtml(p.file) + '" loading="lazy">' +
        '<figcaption><b>' + escHtml(p.role) + '</b> ' + escHtml(p.file) + stars +
        (p.note ? '<br><i>' + escHtml(p.note) + '</i>' : '') + '</figcaption>' +
        '</figure>';
    }).join('\n');
    if (!cells) {
      cells = '<p class="empty">No reviewed photos yet — approve or rate some photos first.</p>';
    }
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + escHtml(title) + '</title>' +
      '<style>body{font-family:system-ui,sans-serif;margin:0;background:#0b1f16;color:#e8f5ee}' +
      'header{padding:24px 28px;border-bottom:1px solid #1d4432}' +
      'h1{color:#4ade80;font-size:20px;margin:0 0 6px}p.meta{color:#9dc7af;font-size:13px;margin:0}' +
      '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;padding:24px 28px}' +
      'figure{margin:0;background:#0f2b1f;border:1px solid #1d4432;border-radius:12px;overflow:hidden}' +
      'img{width:100%;height:220px;object-fit:cover;display:block;background:#000}' +
      'figcaption{padding:10px 12px;font-size:12px;color:#9dc7af;word-break:break-all}' +
      'figcaption b{color:#e8f5ee;text-transform:uppercase;font-size:11px;letter-spacing:.5px}' +
      '.st{color:#fbbf24}.empty{color:#9dc7af;padding:24px 28px}' +
      '@media print{body{background:#fff;color:#000}header{border-color:#ccc}h1{color:#000}' +
      'figure{border-color:#ccc;background:#fff}figcaption{color:#333}}' +
      '</style></head><body>' +
      '<header><h1>' + escHtml(title) + '</h1>' +
      '<p class="meta">Exported ' + escHtml(payload.exportedAt) +
      ' · ' + shown.length + ' of ' + payload.picks.length + ' photos shown' +
      ' · ' + payload.totals.approved + ' approved</p></header>' +
      '<div class="grid">' + cells + '</div></body></html>';
  }

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- session save / load ----
  // Serialize the full review session (marks, ratings, notes, manual pairs)
  // for backup or moving to another device. Versioned; the loader validates
  // and ignores malformed entries instead of crashing.
  function serializeSession(st, mpairs) {
    return JSON.stringify({
      app: 'gg-photo-review',
      v: 1,
      savedAt: new Date().toISOString(),
      state: st || {},
      manualPairs: mpairs || []
    });
  }
  function deserializeSession(text) {
    var obj;
    try { obj = JSON.parse(String(text || '')); }
    catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!obj || obj.app !== 'gg-photo-review' || !obj.state || typeof obj.state !== 'object' || Array.isArray(obj.state)) {
      return { ok: false, error: 'Not a gg-photo-review session file.' };
    }
    var st = {};
    Object.keys(obj.state).forEach(function (id) {
      var s = obj.state[id] || {};
      var status = STATUSES.indexOf(s.status) !== -1 ? s.status : 'unreviewed';
      var rating = Math.max(0, Math.min(5, Math.round(Number(s.rating) || 0)));
      st[id] = {
        status: status,
        rating: rating,
        note: String(s.note == null ? '' : s.note).slice(0, 2000),
        at: s.at || null
      };
    });
    var mp = [];
    (obj.manualPairs || []).forEach(function (m) {
      if (m && typeof m.before === 'string' && typeof m.after === 'string' && m.before !== m.after) {
        mp.push({ before: m.before, after: m.after });
      }
    });
    return { ok: true, state: st, manualPairs: mp };
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
    pairMethodCaption: pairMethodCaption,
    STATUSES: STATUSES,
    defaultItemState: defaultItemState,
    getState: getState,
    setPhotoState: setPhotoState,
    reviewedCount: reviewedCount,
    pairReviewed: pairReviewed,
    createUndo: createUndo,
    buildExport: buildExport,
    exportCSV: exportCSV,
    exportMarkdown: exportMarkdown,
    exportContactSheetHTML: exportContactSheetHTML,
    serializeSession: serializeSession,
    deserializeSession: deserializeSession,
    migrateV1: migrateV1
  };
});
