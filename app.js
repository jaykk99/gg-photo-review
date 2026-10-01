/* gg-photo-review UI — review pairs, rate, approve/reject, export picks.
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
var view = 'review';
var filter = 'all';
var search = '';
var pairIdx = 0;
var focusedId = null;
var selection = new Set();
var undo = L.createUndo(50);

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
  pairs = L.pairPhotos(items.map(function (it) { return { id: it.id, name: it.name }; }));
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
function itemMatches(it) {
  var st = L.getState(state, it.id).status;
  if (filter !== 'all' && st !== filter) return false;
  if (search && it.name.toLowerCase().indexOf(search) === -1) return false;
  return true;
}
function filteredPairs() {
  if (filter === 'all' && !search) return pairs;
  return pairs.filter(function (p) {
    return L.pairPhotosOf(p).some(itemMatches);
  });
}
function filteredItems() { return items.filter(itemMatches); }

// ---------- mutations ----------
function applyChange(label, ids, patch) {
  undo.push(label, state);
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
  state = u.state; save(); render();
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
    undo.push('Edited note: ' + it.name, state);
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
}

function renderGrid() {
  var g = $('#grid');
  g.innerHTML = '';
  filteredItems().forEach(function (it) {
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
  if (!filteredItems().length) g.innerHTML = '<p class="hint">Nothing here. Add photos or change the filter.</p>';
}

function renderBatchBar() {
  var bar = $('#batchbar');
  if (view === 'grid' && selection.size) {
    bar.classList.add('show');
    $('#batchCount').textContent = selection.size + ' selected';
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
  render();
}

// ---------- overlays / fullscreen ----------
function openZoom(it) {
  $('#zoomImg').src = it.src;
  $('#zoomCap').textContent = it.name;
  $('#zoomOv').classList.add('show');
}
function closeZoom() { $('#zoomOv').classList.remove('show'); }
function toggleHelp(force) {
  var o = $('#helpOv');
  var show = force != null ? force : !o.classList.contains('show');
  o.classList.toggle('show', show);
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
    toast(added + ' photo(s) added — uploads are session-only, export before closing.', false);
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
    pairIdx = 0; render();
  });
  $('#search').addEventListener('input', function (e) {
    search = e.target.value.trim().toLowerCase(); pairIdx = 0; render();
  });
  $('#btnPrev').onclick = function () { step(-1); };
  $('#btnNext').onclick = function () { step(1); };
  $('#btnApprovePair').onclick = function () { markFocused({ status: 'approved' }, true, 'Approved pair'); };
  $('#btnRejectPair').onclick = function () { markFocused({ status: 'rejected' }, true, 'Rejected pair'); };
  $('#btnFlagPair').onclick = function () { markFocused({ status: 'flagged' }, true, 'Flagged pair'); };
  $('#btnClearPair').onclick = function () { markFocused({ status: 'unreviewed', rating: 0 }, true, 'Cleared pair'); };
  $('#btnFs').onclick = toggleFs;
  $('#btnUndo').onclick = doUndo;
  $('#btnJSON').onclick = exportJSON;
  $('#btnCSV').onclick = exportCSV;
  $('#btnHelp').onclick = function () { toggleHelp(true); };
  $('#helpClose').onclick = function () { toggleHelp(false); };
  $('#helpOv').addEventListener('click', function (e) { if (e.target === this) toggleHelp(false); });
  $('#zoomX').onclick = closeZoom;
  $('#zoomOv').addEventListener('click', function (e) { if (e.target !== $('#zoomImg')) closeZoom(); });
  $('#btnReset').onclick = function () {
    if (!confirm('Clear all review marks, ratings and notes?')) return;
    undo.push('Reset all marks', state);
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
      else if (lk === 'c' && wide) markFocused({ status: 'unreviewed', rating: 0 }, true, 'Cleared pair');
    }
  });
}

function step(d) {
  var fps = filteredPairs();
  if (!fps.length) return;
  pairIdx = (pairIdx + d + fps.length) % fps.length;
  focusedId = null;
  renderViewer();
  renderProgress();
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
  bind();
  rebuild();          // renders once
  probeExtraSheets(); // finds more sheet_NN.jpg in the background
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
})();
