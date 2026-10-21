/* gg-photo-review UI smoke test (jsdom).
 *
 * Drives the REAL app (index.html + logic.js + app.js) in a simulated DOM:
 * keyboard review, undo, batch ops, manual pairing, exports, chunked grid,
 * overlay focus management.
 *
 * Needs jsdom installed locally, OUTSIDE the repo (node_modules must not
 * ship with the static Pages deploy). Run from the repo root:
 *
 *   mkdir -p /tmp/jsdom-run && cd /tmp/jsdom-run && npm init -y >/dev/null && npm i jsdom
 *   JSDOM_DIR=/tmp/jsdom-run node test/ui.smoke.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

// Resolve jsdom without adding it to the repo's dependencies.
let JSDOM;
function tryRequire(p) {
  try { return require(p); } catch (e) { return null; }
}
const jsdomMod =
  tryRequire('jsdom') ||
  (process.env.JSDOM_DIR && tryRequire(path.join(process.env.JSDOM_DIR, 'node_modules', 'jsdom')));
if (!jsdomMod) {
  console.error(
    'ui.smoke.js: jsdom not found. Install it in a scratch dir outside the repo:\n' +
    '  mkdir -p /tmp/jsdom-run && cd /tmp/jsdom-run && npm init -y >/dev/null && npm i jsdom\n' +
    'Then run: JSDOM_DIR=/tmp/jsdom-run node test/ui.smoke.js   (from the repo root)'
  );
  process.exit(2);
}
JSDOM = jsdomMod.JSDOM;

function boot() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // we eval the scripts ourselves; drop the <script src> tags
  html = html.replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const { window } = dom;

  // No network in the smoke test: sheet probing fails fast.
  window.fetch = () => Promise.reject(new Error('offline (smoke test)'));

  // Capture downloads instead of triggering them.
  const downloads = [];
  window.URL.createObjectURL = () => 'blob:smoke';
  window.URL.revokeObjectURL = () => {};
  const RealBlob = window.Blob;
  window.Blob = function (parts, opts) {
    const b = new RealBlob(parts, opts);
    downloads.push({ content: String(parts[0]), type: opts && opts.type, name: null });
    return b;
  };
  window.eval(fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
  // app.js boots synchronously when readyState is not 'loading'
  return { window, document: window.document, downloads };
}

function click(el) {
  el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
}
function key(doc, k, opts) {
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, opts)));
}
function progText(doc) { return doc.querySelector('#progText').textContent; }
function lastToast(doc) {
  const ts = doc.querySelectorAll('#toasts .toast');
  return ts.length ? ts[ts.length - 1].textContent : '';
}
// the app boots on DOMContentLoaded, which jsdom fires asynchronously
function waitForBoot(document) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (document.querySelector('#pairPos').textContent) return resolve();
      if (Date.now() - t0 > 5000) return reject(new Error('app did not boot'));
      setTimeout(poll, 25);
    })();
  });
}

async function main() {
const { window, document, downloads } = boot();
await waitForBoot(document);

// ---- boot: 4 manifest sheets -> 2 sequence pairs ---------------------------
assert.equal(document.querySelector('#pairPos').textContent, 'Pair 1 of 2', 'boots with 2 pairs');
assert.equal(progText(document), 'Reviewed 0 / 4 photos');
assert.ok(document.querySelector('#pairMethod').textContent.includes('sequence'), 'pair method caption shown');

// ---- keyboard: A approves focused photo ------------------------------------
key(document, 'a');
assert.equal(progText(document), 'Reviewed 1 / 4 photos', 'A approves focused photo');
// Ctrl+Z undoes it
key(document, 'z', { ctrlKey: true });
assert.equal(progText(document), 'Reviewed 0 / 4 photos', 'Ctrl+Z undoes');
// Shift+A approves the whole pair
key(document, 'a', { shiftKey: true });
assert.equal(progText(document), 'Reviewed 2 / 4 photos', 'Shift+A approves pair');

// ---- Next unreviewed jumps to pair 2 ---------------------------------------
click(document.querySelector('#btnSkip'));
assert.equal(document.querySelector('#pairPos').textContent, 'Pair 2 of 2', 'skips to next unreviewed pair');
click(document.querySelector('#btnSkip'));
assert.equal(document.querySelector('#pairPos').textContent, 'Pair 2 of 2', 'stays: pair 2 is the only unreviewed one');

// ---- grid batch: select 2 -> manual pair -----------------------------------
click(document.querySelector('#tabGrid'));
let boxes = document.querySelectorAll('.pickbox');
assert.ok(boxes.length >= 4, 'grid renders photo cards');
click(boxes[2]); // first selected = before
click(boxes[3]); // second selected = after
assert.equal(document.querySelector('#batchCount').textContent, '2 selected');
assert.notEqual(document.querySelector('#bPair').style.display, 'none', 'pair button appears at 2 selected');
click(document.querySelector('#bPair'));
assert.ok(lastToast(document).includes('Paired by hand'), 'manual pair toast');
const saved = JSON.parse(window.localStorage.getItem('gg_photo_review_manual_pairs'));
assert.equal(saved.length, 1, 'manual pair persisted');
assert.equal(saved[0].before, 'sheet_02.jpg');

// ---- review view: manual pair captioned + unpair ---------------------------
click(document.querySelector('#tabReview'));
click(document.querySelector('#btnPrev')); // manual pairs sort first
assert.equal(document.querySelector('#pairPos').textContent, 'Pair 1 of 2', 'manual pair is first');
assert.ok(document.querySelector('#pairMethod').textContent.includes('hand'), 'manual caption in viewer');
click(document.querySelector('#btnUnpair'));
assert.ok(lastToast(document).includes('Manual pair removed'), 'unpair toast');
assert.equal(JSON.parse(window.localStorage.getItem('gg_photo_review_manual_pairs')).length, 0);
assert.ok(document.querySelector('#pairMethod').textContent.includes('sequence'), 'back to auto caption');

// ---- zoom overlay focus management -----------------------------------------
const cardImg = document.querySelector('.photo-card img');
cardImg.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
assert.ok(document.querySelector('#zoomOv').classList.contains('show'), 'zoom opens on dblclick');
assert.equal(document.activeElement.id, 'zoomX', 'focus moves into zoom dialog');
assert.equal(document.querySelector('#zoomOv').getAttribute('role'), 'dialog', 'zoom has dialog role');
key(document, 'Escape');
assert.ok(!document.querySelector('#zoomOv').classList.contains('show'), 'Escape closes zoom');

// ---- exports: MD / sheet / JSON --------------------------------------------
click(document.querySelector('#btnMD'));
let md = downloads[downloads.length - 1];
assert.equal(md.type, 'text/markdown');
assert.ok(md.content.startsWith('# Photo review report'), 'markdown report content');
assert.ok(md.content.includes('## Pair 1'));
click(document.querySelector('#btnSheet'));
let sheet = downloads[downloads.length - 1];
assert.equal(sheet.type, 'text/html');
assert.ok(sheet.content.startsWith('<!DOCTYPE html>'), 'contact sheet html');
assert.ok(sheet.content.includes('grid'), 'contact sheet has grid');
click(document.querySelector('#btnJSON'));
let json = downloads[downloads.length - 1];
const payload = JSON.parse(json.content);
assert.equal(payload.app, 'gg-photo-review');
assert.equal(payload.picks.length, 4);

// ---- toasts are announced to assistive tech --------------------------------
assert.equal(document.querySelector('#toasts').getAttribute('aria-live'), 'polite', 'toast live region');

// ---- skip link --------------------------------------------------------------
const skip = document.querySelector('a.skip');
assert.ok(skip, 'skip link exists');
assert.equal(skip.getAttribute('href'), '#viewer');

// ---- chunked grid: 150 uploads render in chunks ----------------------------
const input = document.querySelector('#fileInput');
const files = [];
for (let i = 1; i <= 150; i++) {
  const n = 'photo_' + String(i).padStart(3, '0') + '.jpg';
  files.push(new window.File(['x'.repeat(20)], n, { type: 'image/jpeg', lastModified: i }));
}
Object.defineProperty(input, 'files', { value: files, configurable: true });
input.dispatchEvent(new window.Event('change', { bubbles: true }));
click(document.querySelector('#tabGrid'));
let sheets = document.querySelectorAll('.sheet');
assert.equal(sheets.length, 120, 'grid renders first chunk of 120');
const loadMore = document.querySelector('.loadmore');
assert.ok(loadMore, 'load-more button present');
assert.ok(loadMore.textContent.includes('left'), 'load-more shows remaining count');
click(loadMore);
assert.equal(document.querySelectorAll('.sheet').length, 154, 'load more renders the rest');

// ---- batch bar still works after chunking -----------------------------------
const fresh = document.querySelectorAll('.pickbox');
click(fresh[0]); click(fresh[1]); click(fresh[2]);
assert.equal(document.querySelector('#batchCount').textContent, '3 selected');
assert.equal(document.querySelector('#bPair').style.display, 'none', 'pair button hidden at 3 selected');
click(document.querySelector('#bApprove'));
assert.ok(lastToast(document).includes('Batch approve (3)'), 'batch approve toast');
// the grid is name-sorted, so the first 3 cards are the photo_001..003
// uploads (all unreviewed): 2 earlier + 3 new = 5
assert.equal(progText(document), 'Reviewed 5 / 154 photos', 'batch approve marks selection');

// ---- zoom keyboard nav ------------------------------------------------------
click(document.querySelector('#tabReview'));
const zimg = document.querySelector('.photo-card img');
zimg.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
assert.ok(document.querySelector('#zoomOv').classList.contains('show'), 'zoom opens');
const cap1 = document.querySelector('#zoomCap').textContent;
key(document, 'ArrowRight');
const cap2 = document.querySelector('#zoomCap').textContent;
assert.notEqual(cap1, cap2, 'zoom arrow moves to next photo in pair');
key(document, 'ArrowLeft');
assert.equal(document.querySelector('#zoomCap').textContent, cap1, 'zoom arrow back');
key(document, 'Escape');
assert.ok(!document.querySelector('#zoomOv').classList.contains('show'), 'zoom closes');

// ---- grid sort by rating ----------------------------------------------------
key(document, '5'); // rate the focused photo 5 stars
// review-view fnames append " (uploaded)"; grid cards show the bare name
const ratedName = document.querySelector('.photo-card.focused .fname').textContent.replace(' (uploaded)', '');
click(document.querySelector('#tabGrid'));
const sortSel = document.querySelector('#gridSort');
sortSel.value = 'rating';
sortSel.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(document.querySelector('.sheet .fname').textContent, ratedName, 'grid sorts by rating desc');

// ---- swap before/after ------------------------------------------------------
click(document.querySelector('#tabReview'));
assert.equal(document.querySelector('#btnSwap').hidden, false, 'swap button visible on pairs');
const fnameBefore = document.querySelectorAll('.photo-card .fname')[0].textContent;
click(document.querySelector('#btnSwap'));
assert.ok(lastToast(document).includes('swapped'), 'swap toast');
assert.ok(document.querySelector('#pairMethod').textContent.includes('swapped'), 'swap caption');
const fnameAfter = document.querySelectorAll('.photo-card .fname')[0].textContent;
assert.notEqual(fnameBefore, fnameAfter, 'swap flips which photo sits in the before slot');
assert.ok(JSON.parse(window.localStorage.getItem('gg_photo_review_manual_pairs'))
  .some((m) => m.kind === 'swapped'), 'swap persisted');
key(document, 'z', { ctrlKey: true }); // undo the swap
assert.ok(!document.querySelector('#pairMethod').textContent.includes('swapped'), 'undo restores pairing');

// ---- session save / load ----------------------------------------------------
window.confirm = () => true; // approve the overwrite prompts
click(document.querySelector('#btnSave'));
const sessDl = downloads[downloads.length - 1];
assert.equal(sessDl.type, 'application/json');
const sessObj = JSON.parse(sessDl.content);
assert.equal(sessObj.app, 'gg-photo-review', 'session file shape');
assert.ok(sessObj.state && Object.keys(sessObj.state).length > 0, 'session has marks');
click(document.querySelector('#btnReset'));
assert.equal(progText(document), 'Reviewed 0 / 154 photos', 'reset clears marks');
const sfile = new window.File([sessDl.content], 'session.json', { type: 'application/json' });
const sinput = document.querySelector('#sessionInput');
Object.defineProperty(sinput, 'files', { value: [sfile], configurable: true });
sinput.dispatchEvent(new window.Event('change', { bubbles: true }));
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function poll() {
    if (progText(document) !== 'Reviewed 0 / 154 photos') return resolve();
    if (Date.now() - t0 > 3000) return reject(new Error('session load timed out'));
    setTimeout(poll, 25);
  })();
});
assert.ok(lastToast(document).includes('Session loaded'), 'session load toast');

console.log('UI smoke tests passed (jsdom).');
}

main().catch((e) => { console.error(e); process.exit(1); });
