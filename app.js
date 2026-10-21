/* gg-photo-review UI: review pairs, rate, approve/reject, export picks.
 * Pure state logic lives in logic.js (window.GGReviewLogic). */
(function () {
'use strict';
var L = window.GGReviewLogic;
var LS_KEY = 'gg_photo_review_state_v2';
var OLD_KEY = 'gg_photo_review_state';
// Manifest sheets committed to the repo. Extra sheet_NN.jpg files are
// auto-detected by probing, so new sheets work without editing this.
var SHEETS = ['sheet_00.jpg', 'sheet_01.jpg', 'sheet_02.jpg', 'sheet_03.jpg'];

function $(s) { return document.querySelector(s); }
function el(tag, cls, html) {
  var d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ---------- state ----------
var items = [];          // [{id,name,src,upload}]
var pairs = [];          // from L.pairPhotos
var state = {};          // {id:{status,rating,note,at}}
var manualPairs = [];    // [{before, after}] item ids paired by hand (persisted)
var view = 'review';
var filter = 'all';
var search = '';
var pairIdx = 0;
var focusedId = null;
var selection = new Set();
var undo = L.createUndo(50);
var gridLimit = 120;     // chunked grid rendering for large sets
var GRID_CHUNK = 120;

function readState() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch (e) {}
  // migrate v1 (old reviewed/flagged marks)
  try {
    var old = localStorage.getItem(OLD_KEY);
    if (old) return L.migrateV1(JSON.parse(old));
  } catch (e) {}
  return {};
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {}
}
function savePairs() {
  try { localStorage.setItem('gg_photo_review_manual_pairs', JSON.stringify(manualPairs)); } catch (e) {}
}
function readPairs() {
  try { return JSON.parse(localStorage.getItem('gg_photo_review_manual_pairs') || '[]'); } catch (e) { return []; }
}

function addManifestItems() {
  SHEETS.forEach(function (name) {
    items.push({ id: name, name: name, src: encodeURI(name), upload: false });
  });
}

// Auto-detect extra sheet_NN.jpg beyond the manifest (new sheets Just Work).
function probeExtraSheets() {
  var n = SHEETS.length, misses = 0;
  function pad(x) { return (x < 10 ? '0' : '') + x; }
  function next() {
    if (n > 60 || misses >= 3) { render(); return; }
    var name = 'sheet_' + pad(n) + '.jpg';
    n++;
    fetch(name, { method: 'HEAD' }).then(function (r) {
      if (r.ok) {
        misses = 0;
        items.push({ id: name, name: name, src: encodeURI(name), upload: false });
        rebuild();
      } else { misses++; }
      next();
    }).catch(function () { misses++; next(); });
  }
  next();
}

function rebuild() {
  // drop manual pairs whose photos are gone (e.g. last session's uploads)
  var ids = {};
  items.forEach(function (it) { ids[it.id] = true; });
  var before = manualPairs.length;
  manualPairs = manualPairs.filter(function (mp) { return ids[mp.before] && ids[mp.after]; });
  if (manualPairs.length !== before) savePairs();
  pairs = L.pairPhotos(items.map(function (it) { return { id: it.id, name: it.name }; }), manualPairs);
  if (pairIdx >= filteredPairs().length) pairIdx = Math.max(0, filteredPairs().length - 1);
  var fps = filteredPairs();
  if (fps.length && !fps[pairIdx]) pairIdx = 0;
  render();
}

function itemById(id) {
  for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
  return null;
}
function pairOfItem(id) {
  for (var i = 0; i < pairs.length; i++) {
    var ph = L.pairPhotosOf(pairs[i]);
    for (var j = 0; j < ph.length; j++) if (ph[j].id === id) return pairs[i];
  }
  return null;
}

// ---------- filtering ----------
var gridSort = 'name'; // name | status | rating
function itemMatches(it) {
  var st = L.getState(state, it.id).status;
  if (filter !== 'all' && st !== filter) return false;
  if (search) {
    var hay = (it.name + ' ' + L.getState(state, it.id).note).toLowerCase();
    if (hay.indexOf(search) === -1) return false;
  }
  return true;
}
function nameCompare(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
}
function filteredPairs() {
  if (filter === 'all' && !search) return pairs;
  return pairs.filter(function (p) {
    return L.pairPhotosOf(p).some(itemMatches);
  });
}
function filteredItems() {
  var list = items.filter(itemMatches);
  if (gridSort === 'rating') {
    list.sort(function (a, b) {
      return L.getState(state, b.id).rating - L.getState(state, a.id).rating || nameCompare(a, b);
    });
  } else if (gridSort === 'status') {
    list.sort(function (a, b) {
      return String(L.getState(state, a.id).status).localeCompare(String(L.getState(state, b.id).status)) || nameCompare(a, b);
    });
  } else {
    list.sort(nameCompare);
  }
  return list;
}

// ---------- mutations ----------
function applyChange(label, ids, patch) {
  undo.push(label, state, manualPairs);
  ids.forEach(function (id) {
    var r = L.setPhotoState(state, id, patch);
    state = r.state;
  });
  save(); render();
  toast(label, true);
}
function markFocused(patch, pairWide, verb) {
  var pair = filteredPairs()[pairIdx];
  if (!pair) return;
  var ids;
  if (pairWide) ids = L.pairPhotosOf(pair).map(function (p) { return p.id; });
  else {
    var f = focusedId && itemById(focusedId) ? focusedId : L.pairPhotosOf(pair)[0].id;
    ids = [f];
  }
  applyChange(verb + (ids.length > 1 ? ' (' + ids.length + ' photos)' : ''), ids, patch);
}
function doUndo() {
  var u = undo.pop();
  if (!u) return;
  state = u.state;
  if (u.mpairs !== undefined) { manualPairs = u.mpairs; savePairs(); }
  save(); rebuild();
  toast('Undid: ' + u.label, false);
}

// ---------- toasts ----------
function toast(msg, showUndo) {
  var box = $('#toasts');
  var t = el('div', 'toast', esc(msg));
  if (showUndo) {
    var b = el('button', 'ghost', 'Undo');
    b.onclick = function () { doUndo(); t.remove(); };
    t.appendChild(b);
  }
  box.appendChild(t);
  setTimeout(function () { t.remove(); }, 4500);
}

// ---------- export ----------
function download(name, content, type) {
  var blob = new Blob([content], { type: type });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function stamp() {
  var d = new Date();
  function p(x) { return (x < 10 ? '0' : '') + x; }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}
function exportJSON() {
  var payload = L.buildExport(state, items, pairs);
  download('gg-picks-' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
  toast('Exported ' + payload.picks.length + ' picks as JSON', false);
}
function exportCSV() {
  var payload = L.buildExport(state, items, pairs);
  download('gg-picks-' + stamp() + '.csv', L.exportCSV(payload), 'text/csv');
  toast('Exported picks as CSV', false);
}
function exportMarkdown() {
  var payload = L.buildExport(state, items, pairs);
  download('gg-report-' + stamp() + '.md', L.exportMarkdown(payload), 'text/markdown');
  toast('Exported review report as Markdown', false);
}
function exportContactSheet() {
  var payload = L.buildExport(state, items, pairs);
  download('gg-contact-sheet-' + stamp() + '.html', L.exportContactSheetHTML(payload), 'text/html');
  toast('Exported printable contact sheet (HTML)', false);
}
function saveSession() {
  download('gg-session-' + stamp() + '.json', L.serializeSession(state, manualPairs), 'application/json');
  toast('Session saved: marks, ratings, notes and manual pairs', false);
}
function loadSessionFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var res = L.deserializeSession(reader.result);
    if (!res.ok) { toast('Could not load session: ' + res.error, false); return; }
    var hasWork = Object.keys(state).length > 0;
    if (hasWork && !confirm('Loading this session replaces your current marks, ratings, notes and manual pairs. Continue?')) return;
    undo.push('Loaded session', state, manualPairs);
    state = res.state;
    manualPairs = res.manualPairs;
    save(); savePairs(); pairIdx = 0; focusedId = null; selection.clear();
    rebuild();
    toast('Session loaded: ' + L.reviewedCount(state, items) + ' reviewed photos restored', true);
  };
  reader.readAsText(file);
}

// ---------- render ----------
function render() {
  renderProgress();
  $('#btnUndo').disabled = !undo.canUndo();
  $('#btnUndo').title = undo.canUndo() ? 'Undo: ' + undo.peek() + ' (Ctrl+Z)' : 'Nothing to undo';
  if (view === 'review') { $('#reviewview').style.display = ''; $('#gridview').style.display = 'none'; renderViewer(); }
  else { $('#reviewview').style.display = 'none'; $('#gridview').style.display = ''; renderGrid(); }
  renderBatchBar();
}

function renderProgress() {
  var done = L.reviewedCount(state, items);
  var total = items.length;
  $('#progText').textContent = 'Reviewed ' + done + ' / ' + total + ' photos';
  var pd = pairs.filter(function (p) { return L.pairReviewed(state, p); }).length;
  $('#progPairs').textContent = pd + ' / ' + pairs.length + ' pairs';
  $('#progBar').style.width = total ? (done / total * 100) + '%' : '0';
}

function starsHTML(itemId) {
  var r = L.getState(state, itemId).rating;
  var h = '<div class="stars" data-id="' + esc(itemId) + '">';
  for (var i = 1; i <= 5; i++) {
    h += '<button class="star' + (i <= r ? ' lit' : '') + '" data-star="' + i + '" title="Rate ' + i + '">★</button>';
  }
  return h + '</div>';
}

function statusButtonsHTML(itemId) {
  var st = L.getState(state, itemId).status;
  function b(s, label) {
    return st === s ? '' : '<button data-act="' + s + '">' + label + '</button>';
  }
  return '<div class="mini-actions" data-id="' + esc(itemId) + '">' +
    '<span class="badge ' + st + '">' + st + '</span>' +
    b('approved', '✓ Approve') + b('rejected', '✕ Reject') + b('flagged', '🚩 Flag') +
    (st !== 'unreviewed' ? '<button class="ghost" data-act="unreviewed">Clear</button>' : '') +
    '</div>';
}

function photoCard(it, role) {
  var card = el('div', 'photo-card' + (it.id === focusedId ? ' focused' : ''));
  card.dataset.id = it.id;
  var tag = role === 'before' ? '<span class="tag before">Before</span>'
    : role === 'after' ? '<span class="tag after">After</span>'
    : '<span class="tag single">Single</span>';
  var st = L.getState(state, it.id);
  card.innerHTML =
    '<img src="' + it.src + '" alt="' + esc(it.name) + '" loading="lazy" draggable="false">' +
    '<div class="cap">' + tag +
    '<div class="fname">' + esc(it.name) + (it.upload ? ' <em>(uploaded)</em>' : '') + '</div>' +
    starsHTML(it.id) + statusButtonsHTML(it.id) +
    '<textarea class="note-in" data-note="' + esc(it.id) + '" placeholder="Note (for quotes / follow-up)…">' + esc(st.note) + '</textarea>' +
    '</div>';
  card.addEventListener('click', function (e) {
    if (e.target.closest('button,textarea,input,select')) return;
    focusedId = it.id; renderViewer();
  });
  card.addEventListener('dblclick', function (e) {
    if (e.target.closest('button,textarea')) return;
    openZoom(it);
  });
  // star clicks
  card.querySelectorAll('.star').forEach(function (s) {
    s.addEventListener('click', function (e) {
      e.stopPropagation();
      focusedId = it.id;
      applyChange('Rated ' + s.dataset.star + '★: ' + it.name, [it.id], { rating: +s.dataset.star });
    });
  });
  // status buttons
  card.querySelectorAll('[data-act]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      focusedId = it.id;
      var verbs = { approved: 'Approved', rejected: 'Rejected', flagged: 'Flagged', unreviewed: 'Cleared' };
      applyChange(verbs[b.dataset.act] + ': ' + it.name, [it.id], { status: b.dataset.act });
    });
  });
  // note (undo pushed once per edit via change event)
  var ta = card.querySelector('[data-note]');
  ta.addEventListener('change', function () {
    undo.push('Edited note: ' + it.name, state, manualPairs);
    var r = L.setPhotoState(state, it.id, { note: ta.value });
    state = r.state; save(); renderProgress();
  });
  return card;
}

function renderViewer() {
  var v = $('#viewer');
  v.innerHTML = '';
  var fps = filteredPairs();
  if (!fps.length) {
    v.innerHTML = '<p class="hint" style="grid-column:1/-1">No pairs match this filter. Add photos or clear the filter.</p>';
    $('#pairPos').textContent = '';
    return;
  }
  if (pairIdx >= fps.length) pairIdx = fps.length - 1;
  var pair = fps[pairIdx];
  var photos = L.pairPhotosOf(pair);
  if (!focusedId || !photos.some(function (p) { return p.id === focusedId; })) {
    focusedId = photos[0].id;
  }
  v.classList.toggle('single-col', photos.length === 1);
  photos.forEach(function (p) {
    var role = pair.single ? 'single' : (pair.before && pair.before.id === p.id ? 'before' : 'after');
    v.appendChild(photoCard(itemById(p.id), role));
  });
  $('#pairPos').textContent = 'Pair ' + (pairIdx + 1) + ' of ' + fps.length;
  $('#pairMethod').textContent = L.pairMethodCaption(pair);
  var isPinned = pair.method === 'manual' || pair.method === 'swapped';
  $('#btnUnpair').hidden = !isPinned;
  $('#btnUnpair').textContent = pair.method === 'swapped' ? '↩ Unswap' : '🔗 Unpair';
  $('#btnSwap').hidden = !!pair.single;
  $('#btnSwap').textContent = pair.method === 'swapped' ? '↩ Unswap (S)' : '⇄ Swap before/after (S)';
}

// Grid renders in chunks so large photo sets (500+) stay smooth.
// filteredItems() is sliced to gridLimit; a "Load more" button grows it.
function renderGrid() {
  var g = $('#grid');
  g.innerHTML = '';
  var all = filteredItems();
  if (!all.length) {
    g.innerHTML = '<p class="hint">Nothing here. Add photos or change the filter.</p>';
    return;
  }
  var shown = all.slice(0, gridLimit);
  shown.forEach(function (it) {
    var st = L.getState(state, it.id);
    var card = el('div', 'sheet' + (selection.has(it.id) ? ' sel' : ''));
    card.innerHTML =
      '<input type="checkbox" class="pickbox"' + (selection.has(it.id) ? ' checked' : '') + ' title="Select for batch">' +
      '<img src="' + it.src + '" alt="' + esc(it.name) + '" loading="lazy">' +
      '<div class="meta"><div class="fname">' + esc(it.name) + '</div>' +
      '<div class="row"><span class="badge ' + st.status + '">' + st.status + '</span>' +
      (st.rating ? '<span style="color:var(--star);font-size:13px">' + '★'.repeat(st.rating) + '</span>' : '') +
      '</div></div>';
    card.querySelector('.pickbox').addEventListener('click', function (e) {
      e.stopPropagation();
      if (this.checked) selection.add(it.id); else selection.delete(it.id);
      renderGrid(); renderBatchBar();
    });
    card.addEventListener('click', function () {
      var fps = filteredPairs();
      for (var i = 0; i < fps.length; i++) {
        var ph = L.pairPhotosOf(fps[i]);
        if (ph.some(function (p) { return p.id === it.id; })) { pairIdx = i; break; }
      }
      focusedId = it.id;
      setView('review');
    });
    g.appendChild(card);
  });
  if (all.length > shown.length) {
    var more = el('button', 'loadmore', 'Load ' + Math.min(GRID_CHUNK * 2, all.length - shown.length) + ' more (' + (all.length - shown.length) + ' left)');
    more.addEventListener('click', function () { gridLimit += GRID_CHUNK * 2; renderGrid(); });
    g.appendChild(more);
  }
}
function resetGridLimit() { gridLimit = GRID_CHUNK; }

function renderBatchBar() {
  var bar = $('#batchbar');
  if (view === 'grid' && selection.size) {
    bar.classList.add('show');
    $('#batchCount').textContent = selection.size + ' selected';
    // manual pairing only makes sense with exactly 2 photos selected
    $('#bPair').style.display = selection.size === 2 ? '' : 'none';
  } else bar.classList.remove('show');
}

function batch(patch, verb) {
  var ids = Array.from(selection);
  if (!ids.length) return;
  applyChange('Batch ' + verb + ' (' + ids.length + ')', ids, patch);
  selection.clear();
}

function setView(v) {
  view = v;
  $('#tabReview').classList.toggle('on', v === 'review');
  $('#tabGrid').classList.toggle('on', v === 'grid');
  if (v === 'grid') resetGridLimit();
  render();
}

// ---------- overlays / fullscreen ----------
// Focus is moved into a dialog when it opens and restored when it closes,
// so keyboard and screen-reader users don't get lost.
var lastFocus = null;
var zoomList = [];   // item objects of the pair being zoomed
var zoomIdx = 0;
function stashFocus() { lastFocus = document.activeElement; }
function restoreFocus() {
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}
function openZoom(it) {
  stashFocus();
  var pair = filteredPairs()[pairIdx];
  zoomList = pair ? L.pairPhotosOf(pair) : [it];
  zoomIdx = 0;
  for (var i = 0; i < zoomList.length; i++) {
    if (zoomList[i].id === it.id) { zoomIdx = i; break; }
  }
  showZoom();
}
function showZoom() {
  var raw = zoomList[zoomIdx];
  var it = (raw && itemById(raw.id)) || raw;
  if (!it) return;
  $('#zoomImg').src = it.src;
  $('#zoomCap').textContent = it.name + ' (' + (zoomIdx + 1) + ' of ' + zoomList.length + ')';
  $('#zoomOv').classList.add('show');
  $('#zoomX').focus();
}
function stepZoom(d) {
  if (zoomList.length < 2) return;
  zoomIdx = (zoomIdx + d + zoomList.length) % zoomList.length;
  showZoom();
}
function closeZoom() {
  $('#zoomOv').classList.remove('show');
  zoomList = [];
  restoreFocus();
}
function toggleHelp(force) {
  var o = $('#helpOv');
  var show = force != null ? force : !o.classList.contains('show');
  if (show && !o.classList.contains('show')) stashFocus();
  o.classList.toggle('show', show);
  if (show) $('#helpClose').focus();
  else restoreFocus();
}
function toggleFs() {
  var v = $('#viewer');
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  if (v.requestFullscreen) {
    v.requestFullscreen().catch(function () { v.classList.add('fs-fallback'); });
  } else v.classList.toggle('fs-fallback');
}
document.addEventListener('fullscreenchange', function () {
  if (!document.fullscreenElement) $('#viewer').classList.remove('fs-fallback');
});

// ---------- uploads ----------
function addFiles(files) {
  var added = 0;
  Array.from(files || []).forEach(function (f) {
    if (!f.type || f.type.indexOf('image/') !== 0) return;
    var id = 'upload:' + f.name + ':' + f.size + ':' + f.lastModified;
    if (itemById(id)) return;
    items.push({ id: id, name: f.name, src: URL.createObjectURL(f), upload: true });
    added++;
  });
  if (added) {
    rebuild();
    toast(added + ' photo(s) added. Uploads are session-only, export before closing.', false);
  }
}

// ---------- events ----------
function bind() {
  $('#tabReview').onclick = function () { setView('review'); };
  $('#tabGrid').onclick = function () { setView('grid'); };
  $('#filters').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    filter = c.dataset.f;
    document.querySelectorAll('#filters .chip').forEach(function (x) { x.classList.toggle('on', x === c); });
    pairIdx = 0; resetGridLimit(); render();
  });
  $('#search').addEventListener('input', function (e) {
    search = e.target.value.trim().toLowerCase(); pairIdx = 0; resetGridLimit(); render();
  });
  $('#btnPrev').onclick = function () { step(-1); };
  $('#btnNext').onclick = function () { step(1); };
  $('#btnSkip').onclick = nextUnreviewed;
  $('#btnApprovePair').onclick = function () { markFocused({ status: 'approved' }, true, 'Approved pair'); };
  $('#btnRejectPair').onclick = function () { markFocused({ status: 'rejected' }, true, 'Rejected pair'); };
  $('#btnFlagPair').onclick = function () { markFocused({ status: 'flagged' }, true, 'Flagged pair'); };
  $('#btnClearPair').onclick = function () { markFocused({ status: 'unreviewed', rating: 0 }, true, 'Cleared pair'); };
  $('#btnFs').onclick = toggleFs;
  $('#btnUndo').onclick = doUndo;
  $('#btnJSON').onclick = exportJSON;
  $('#btnCSV').onclick = exportCSV;
  $('#btnMD').onclick = exportMarkdown;
  $('#btnSheet').onclick = exportContactSheet;
  $('#btnSave').onclick = saveSession;
  $('#btnLoad').onclick = function () { $('#sessionInput').click(); };
  $('#sessionInput').addEventListener('change', function (e) { loadSessionFile(e.target.files[0]); e.target.value = ''; });
  $('#btnUnpair').onclick = unpairManual;
  $('#btnSwap').onclick = swapPair;
  $('#btnHelp').onclick = function () { toggleHelp(true); };
  $('#helpClose').onclick = function () { toggleHelp(false); };
  $('#helpOv').addEventListener('click', function (e) { if (e.target === this) toggleHelp(false); });
  $('#zoomX').onclick = closeZoom;
  $('#zoomOv').addEventListener('click', function (e) { if (e.target !== $('#zoomImg')) closeZoom(); });
  $('#btnReset').onclick = function () {
    if (!confirm('Clear all review marks, ratings and notes?')) return;
    undo.push('Reset all marks', state, manualPairs);
    state = {}; save(); selection.clear(); render();
    toast('All marks cleared', true);
  };
  $('#btnAdd').onclick = function () { $('#fileInput').click(); };
  $('#fileInput').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });

  // batch bar
  $('#bApprove').onclick = function () { batch({ status: 'approved' }, 'approve'); };
  $('#bReject').onclick = function () { batch({ status: 'rejected' }, 'reject'); };
  $('#bFlag').onclick = function () { batch({ status: 'flagged' }, 'flag'); };
  $('#bRate').addEventListener('change', function (e) {
    if (e.target.value === '') return;
    batch({ rating: +e.target.value }, 'rate ' + e.target.value + '★');
    e.target.value = '';
  });
  $('#bClear').onclick = function () { selection.clear(); render(); };
  $('#bPair').onclick = pairSelected;

  // grid sort
  $('#gridSort').addEventListener('change', function (e) {
    gridSort = e.target.value; resetGridLimit(); renderGrid();
  });

  // drag & drop anywhere
  var dzT = null;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); document.body.classList.add('dz'); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragleave', function (e) {
    if (e.relatedTarget) return;
    document.body.classList.remove('dz');
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); document.body.classList.remove('dz');
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // swipe on the viewer (mobile)
  var tx = null, ty = null;
  var viewer = $('#viewer');
  viewer.addEventListener('touchstart', function (e) {
    var t = e.changedTouches[0]; tx = t.clientX; ty = t.clientY;
  }, { passive: true });
  viewer.addEventListener('touchend', function (e) {
    if (tx == null) return;
    var t = e.changedTouches[0];
    var dx = t.clientX - tx, dy = t.clientY - ty;
    tx = ty = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // keyboard
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape') {
      if ($('#helpOv').classList.contains('show')) toggleHelp(false);
      else if ($('#zoomOv').classList.contains('show')) closeZoom();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    // zoomed lightbox: arrows move between the pair's photos
    if ($('#zoomOv').classList.contains('show')) {
      if (e.key === 'ArrowLeft') stepZoom(-1);
      else if (e.key === 'ArrowRight') stepZoom(1);
      return;
    }
    if (view !== 'review') return;
    var k = e.key;
    if (k === 'ArrowLeft') { step(-1); }
    else if (k === 'ArrowRight') { step(1); }
    else if (k >= '1' && k <= '5') { rateFocused(+k); }
    else if (k === '0') { rateFocused(0); }
    else if (k === '?') { toggleHelp(); }
    else if (k === 'f' || k === 'F') { toggleFs(); }
    else {
      var lk = k.toLowerCase();
      var wide = e.shiftKey;
      if (lk === 'a') markFocused({ status: 'approved' }, wide, wide ? 'Approved pair' : 'Approved');
      else if (lk === 'r') markFocused({ status: 'rejected' }, wide, wide ? 'Rejected pair' : 'Rejected');
      else if (lk === 'x') markFocused({ status: 'flagged' }, wide, wide ? 'Flagged pair' : 'Flagged');
      else if (lk === 's') swapPair();
      else if (lk === 'c' && wide) markFocused({ status: 'unreviewed', rating: 0 }, true, 'Cleared pair');
    }
  });
}

// Manual pairing: pin two photos as a before/after pair (first selected = before).
function pairSelected() {
  var ids = Array.from(selection);
  if (ids.length !== 2) return;
  var exists = manualPairs.some(function (mp) {
    return (mp.before === ids[0] && mp.after === ids[1]) ||
           (mp.before === ids[1] && mp.after === ids[0]);
  });
  if (!exists) {
    undo.push('Manual pair', state, manualPairs);
    manualPairs.push({ before: ids[0], after: ids[1] });
    savePairs();
    var names = ids.map(function (id) { var it = itemById(id); return it ? it.name : id; });
    toast('Paired by hand: ' + names[0] + ' (before) / ' + names[1] + ' (after)', true);
  }
  selection.clear();
  rebuild();
}
// Swap which photo of the current pair is "before" vs "after".
// Stored as a pinned entry so it survives rebuilds; toggling again removes
// it and lets the heuristics (or the manual pair) take over.
function swapPair() {
  var pair = filteredPairs()[pairIdx];
  if (!pair || pair.single) return;
  var b = pair.before.id, a = pair.after.id;
  function covers(mp) {
    return (mp.before === b && mp.after === a) || (mp.before === a && mp.after === b);
  }
  if (pair.method === 'swapped') {
    undo.push('Unswapped pair', state, manualPairs);
    manualPairs = manualPairs.filter(function (mp) { return !covers(mp); });
    savePairs(); rebuild();
    toast('Swap removed', false);
    return;
  }
  undo.push('Swapped before/after', state, manualPairs);
  manualPairs = manualPairs.filter(function (mp) { return !covers(mp); });
  manualPairs.push({ before: a, after: b, kind: 'swapped' });
  savePairs();
  rebuild();
  toast('Before/after swapped', true);
}
function unpairManual() {
  var pair = filteredPairs()[pairIdx];
  if (!pair || (pair.method !== 'manual' && pair.method !== 'swapped')) return;
  var wasSwapped = pair.method === 'swapped';
  var b = pair.before.id, a = pair.after.id;
  undo.push(wasSwapped ? 'Unswapped pair' : 'Unpaired manual pair', state, manualPairs);
  manualPairs = manualPairs.filter(function (mp) {
    return !((mp.before === b && mp.after === a) || (mp.before === a && mp.after === b));
  });
  savePairs();
  rebuild();
  toast(wasSwapped ? 'Swap removed' : 'Manual pair removed, heuristics re-applied', false);
}
function step(d) {
  var fps = filteredPairs();
  if (!fps.length) return;
  pairIdx = (pairIdx + d + fps.length) % fps.length;
  focusedId = null;
  renderViewer();
  renderProgress();
}
// Jump to the next pair that still has unreviewed photos (wraps around).
function nextUnreviewed() {
  var fps = filteredPairs();
  if (!fps.length) return;
  for (var n = 1; n <= fps.length; n++) {
    var i = (pairIdx + n) % fps.length;
    if (!L.pairReviewed(state, fps[i])) {
      pairIdx = i; focusedId = null;
      renderViewer(); renderProgress();
      return;
    }
  }
  toast('All pairs reviewed', false);
}
function rateFocused(n) {
  var pair = filteredPairs()[pairIdx];
  if (!pair) return;
  var id = focusedId && itemById(focusedId) ? focusedId : L.pairPhotosOf(pair)[0].id;
  var it = itemById(id);
  applyChange((n ? 'Rated ' + n + '★' : 'Cleared rating') + ': ' + it.name, [id], { rating: n });
}

// ---------- boot ----------
function boot() {
  addManifestItems();
  state = readState();
  manualPairs = readPairs();
  bind();
  rebuild();          // renders once
  probeExtraSheets(); // finds more sheet_NN.jpg in the background
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
