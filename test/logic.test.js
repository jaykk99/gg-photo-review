/* Unit tests for gg-photo-review logic.js — run with: node --test "test/*.test.js" */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const it = (id, name) => ({ id, name });

test('detectRole finds before/after keywords', () => {
  assert.equal(L.detectRole('gutter_before.jpg'), 'before');
  assert.equal(L.detectRole('gutter-after.png'), 'after');
  assert.equal(L.detectRole('job1_pre.jpg'), 'before');
  assert.equal(L.detectRole('job1_post.jpg'), 'after');
  assert.equal(L.detectRole('downspout_dirty_final.jpg'), 'before');
  assert.equal(L.detectRole('downspout_clean_final.jpg'), 'after');
  assert.equal(L.detectRole('sheet_00.jpg'), null);
  assert.equal(L.detectRole('IMG_20260930_120000.jpg'), null);
});

test('pairPhotos matches before/after by base key, before first', () => {
  const pairs = L.pairPhotos([
    it('a', 'gutter_after.jpg'),
    it('b', 'gutter_before.jpg'),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].before.name, 'gutter_before.jpg');
  assert.equal(pairs[0].after.name, 'gutter_after.jpg');
  assert.equal(pairs[0].single, null);
});

test('pairPhotos pairs contact-sheet style numeric sequences', () => {
  const pairs = L.pairPhotos([
    it('s0', 'sheet_00.jpg'), it('s1', 'sheet_01.jpg'),
    it('s2', 'sheet_02.jpg'), it('s3', 'sheet_03.jpg'),
  ]);
  assert.equal(pairs.length, 2);
  assert.deepEqual([pairs[0].before.id, pairs[0].after.id], ['s0', 's1']);
  assert.deepEqual([pairs[1].before.id, pairs[1].after.id], ['s2', 's3']);
});

test('pairPhotos pairs by embedded timestamp, earlier = before', () => {
  const pairs = L.pairPhotos([
    it('x', 'IMG_20260930_143000.jpg'),
    it('y', 'IMG_20260930_121500.jpg'),
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].before.id, 'y');
  assert.equal(pairs[0].after.id, 'x');
});

test('pairPhotos leaves unpaired photos as singles', () => {
  const pairs = L.pairPhotos([
    it('a', 'random-a.jpg'), it('b', 'oddball.jpg'),
    it('c', 'gutter_before.jpg'), it('d', 'gutter_after.jpg'),
  ]);
  const singles = pairs.filter(p => p.single);
  const matched = pairs.filter(p => !p.single);
  assert.equal(matched.length, 1);
  assert.equal(singles.length, 2);
  assert.equal(matched[0].before.id, 'c');
});

test('pairPhotos does not mix different jobs with same keywords', () => {
  const pairs = L.pairPhotos([
    it('a', 'front_before.jpg'), it('b', 'back_before.jpg'),
    it('c', 'front_after.jpg'), it('d', 'back_after.jpg'),
  ]);
  assert.equal(pairs.length, 2);
  const keys = pairs.map(p => p.before.name + '|' + p.after.name).sort();
  assert.deepEqual(keys, ['back_before.jpg|back_after.jpg', 'front_before.jpg|front_after.jpg']);
});

test('setPhotoState / getState round-trip with undo-safe prev', () => {
  let state = {};
  const r = L.setPhotoState(state, 'p1', { status: 'approved', rating: 5 });
  assert.equal(r.state.p1.status, 'approved');
  assert.equal(r.state.p1.rating, 5);
  assert.ok(r.state.p1.at);
  assert.equal(r.prev.status, 'unreviewed');
  // original untouched (immutable update)
  assert.deepEqual(state, {});
});

test('reviewedCount and pairReviewed', () => {
  const items = [it('a', 'a.jpg'), it('b', 'b.jpg')];
  const pairs = L.pairPhotos(items);
  let state = {};
  assert.equal(L.reviewedCount(state, items), 0);
  assert.equal(L.pairReviewed(state, pairs[0]), false);
  state = L.setPhotoState(state, 'a', { status: 'approved' }).state;
  assert.equal(L.reviewedCount(state, items), 1);
  state = L.setPhotoState(state, 'b', { status: 'rejected' }).state;
  assert.equal(L.reviewedCount(state, items), 2);
  assert.equal(L.pairReviewed(state, pairs[0]), true);
});

test('createUndo push/pop bounded', () => {
  const u = L.createUndo(2);
  u.push('one', { a: 1 });
  u.push('two', { a: 2 });
  u.push('three', { a: 3 }); // evicts 'one'
  assert.equal(u.depth(), 2);
  assert.equal(u.peek(), 'three');
  const popped = u.pop();
  assert.equal(popped.label, 'three');
  assert.deepEqual(popped.state, { a: 3 });
  assert.ok(u.canUndo());
  u.pop();
  assert.ok(!u.canUndo());
  assert.equal(u.pop(), null);
});

test('buildExport payload shape and totals', () => {
  const items = [it('a', 'gutter_before.jpg'), it('b', 'gutter_after.jpg')];
  const pairs = L.pairPhotos(items);
  let state = L.setPhotoState({}, 'a', { status: 'approved', rating: 5, note: 'great' }).state;
  state = L.setPhotoState(state, 'b', { status: 'approved', rating: 4 }).state;
  const exp = L.buildExport(state, items, pairs);
  assert.equal(exp.app, 'gg-photo-review');
  assert.ok(exp.exportedAt);
  assert.equal(exp.totals.photos, 2);
  assert.equal(exp.totals.reviewed, 2);
  assert.equal(exp.totals.approved, 2);
  assert.equal(exp.picks.length, 2);
  const before = exp.picks.find(p => p.role === 'before');
  assert.equal(before.status, 'approved');
  assert.equal(before.rating, 5);
  assert.equal(before.note, 'great');
});

test('exportCSV escapes commas/quotes', () => {
  const exp = {
    picks: [
      { file: 'a.jpg', pair: 'p', role: 'before', status: 'approved', rating: 5, note: 'nice, "clean" job', reviewedAt: 't' },
    ]
  };
  const csv = L.exportCSV(exp);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'file,pair,role,status,rating,note,reviewedAt');
  assert.ok(lines[1].includes('"nice, ""clean"" job"'));
});

test('migrateV1 converts old reviewed/flagged marks', () => {
  const out = L.migrateV1({
    'sheet_00.jpg': { status: 'reviewed', at: 'x' },
    'sheet_01.jpg': { status: 'flagged', at: 'y' },
  });
  assert.equal(out['sheet_00.jpg'].status, 'approved');
  assert.equal(out['sheet_01.jpg'].status, 'flagged');
  assert.equal(out['sheet_00.jpg'].rating, 0);
});

test('pairPhotos honors manual pairs first (method manual)', () => {
  const pairs = L.pairPhotos(
    [it('a', 'gutter_before.jpg'), it('b', 'gutter_after.jpg'),
     it('c', 'random-a.jpg'), it('d', 'oddball.jpg')],
    [{ before: 'c', after: 'd' }]
  );
  const manual = pairs.find(p => p.method === 'manual');
  assert.ok(manual);
  assert.equal(manual.before.id, 'c');
  assert.equal(manual.after.id, 'd');
  // heuristic pass still pairs the keyword couple from the leftovers
  const kw = pairs.find(p => p.method === 'keyword');
  assert.ok(kw);
  assert.equal(kw.before.id, 'a');
});

test('pairPhotos ignores invalid manual pairs', () => {
  // unknown id + self-pair + pair reusing an id already used
  const pairs = L.pairPhotos(
    [it('a', 'x1.jpg'), it('b', 'x2.jpg')],
    [{ before: 'nope', after: 'b' }, { before: 'a', after: 'a' }, { before: 'a', after: 'b' }]
  );
  const manual = pairs.find(p => p.method === 'manual');
  assert.ok(manual);
  assert.equal(pairs.filter(p => p.method === 'manual').length, 1);
});

test('pairMethodCaption describes every method', () => {
  assert.ok(L.pairMethodCaption({ method: 'manual' }).includes('hand'));
  assert.ok(L.pairMethodCaption({ method: 'keyword' }).includes('keywords'));
  assert.ok(L.pairMethodCaption({ method: 'timestamp' }).includes('timestamps'));
  assert.ok(L.pairMethodCaption({ method: 'sequence' }).includes('sequence'));
  assert.ok(L.pairMethodCaption({ method: 'single' }).includes('Single'));
});

test('exportMarkdown builds a per-pair report', () => {
  const items = [it('a', 'gutter_before.jpg'), it('b', 'gutter_after.jpg')];
  const pairs = L.pairPhotos(items);
  let state = L.setPhotoState({}, 'a', { status: 'approved', rating: 5, note: 'great' }).state;
  const exp = L.buildExport(state, items, pairs);
  const md = L.exportMarkdown(exp);
  assert.ok(md.startsWith('# Photo review report'));
  assert.ok(md.includes('Approved: 1'));
  assert.ok(md.includes('## Pair 1'));
  assert.ok(md.includes('`gutter_before.jpg`'));
  assert.ok(md.includes('★★★★★'));
  assert.ok(md.includes('_great_'));
  assert.ok(md.includes('— rejected') || md.includes('unreviewed'));
});

test('exportContactSheetHTML prefers approved picks', () => {
  const items = [it('a', 'gutter_before.jpg'), it('b', 'gutter_after.jpg'), it('c', 'lone.jpg')];
  const pairs = L.pairPhotos(items);
  let state = L.setPhotoState({}, 'a', { status: 'approved', rating: 5 }).state;
  state = L.setPhotoState(state, 'b', { status: 'rejected' }).state;
  const exp = L.buildExport(state, items, pairs);
  const html = L.exportContactSheetHTML(exp);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('Approved picks'));
  assert.ok(html.includes('gutter_before.jpg'));
  assert.ok(!html.includes('lone.jpg')); // unreviewed, excluded
  // no approvals -> falls back to all reviewed picks
  const state2 = L.setPhotoState({}, 'c', { status: 'flagged' }).state;
  const html2 = L.exportContactSheetHTML(L.buildExport(state2, items, pairs));
  assert.ok(html2.includes('Reviewed picks'));
  assert.ok(html2.includes('lone.jpg'));
});

test('exportContactSheetHTML escapes HTML in filenames and notes', () => {
  const exp = {
    exportedAt: 'x',
    totals: { approved: 1 },
    picks: [
      { file: 'a<b>&".jpg', pair: 'p', role: 'before', status: 'approved', rating: 0, note: '<script>alert(1)</script>', reviewedAt: null },
    ]
  };
  const html = L.exportContactSheetHTML(exp);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a&lt;b&gt;&amp;&quot;.jpg'));
});

test('serializeSession / deserializeSession round-trip', () => {
  let state = L.setPhotoState({}, 'a', { status: 'approved', rating: 5, note: 'great' }).state;
  const mp = [{ before: 'a', after: 'b' }];
  const text = L.serializeSession(state, mp);
  const res = L.deserializeSession(text);
  assert.equal(res.ok, true);
  assert.equal(res.state.a.status, 'approved');
  assert.equal(res.state.a.rating, 5);
  assert.equal(res.state.a.note, 'great');
  assert.deepEqual(res.manualPairs, mp);
});

test('deserializeSession sanitizes junk and rejects bad files', () => {
  assert.equal(L.deserializeSession('not json').ok, false);
  assert.equal(L.deserializeSession('{"app":"other"}').ok, false);
  assert.equal(L.deserializeSession('{"app":"gg-photo-review"}').ok, false);
  const res = L.deserializeSession(JSON.stringify({
    app: 'gg-photo-review', v: 1,
    state: {
      a: { status: 'approved', rating: 99, note: 'x'.repeat(5000) },
      b: { status: 'bogus', rating: -3 },
      c: 'garbage',
    },
    manualPairs: [{ before: 'a', after: 'a' }, { before: 'a' }, 'x', { before: 'a', after: 'b' }],
  }));
  assert.equal(res.ok, true);
  assert.equal(res.state.a.rating, 5, 'rating clamped');
  assert.equal(res.state.a.note.length, 2000, 'note truncated');
  assert.equal(res.state.b.status, 'unreviewed', 'bad status reset');
  assert.equal(res.state.b.rating, 0);
  assert.deepEqual(res.manualPairs, [{ before: 'a', after: 'b' }], 'only valid pairs kept');
});

test('pairPhotos supports swapped kind (before/after flipped by hand)', () => {
  const pairs = L.pairPhotos(
    [it('a', 'gutter_before.jpg'), it('b', 'gutter_after.jpg')],
    [{ before: 'b', after: 'a', kind: 'swapped' }]
  );
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].method, 'swapped');
  assert.equal(pairs[0].before.id, 'b');
  assert.equal(pairs[0].after.id, 'a');
  assert.ok(L.pairMethodCaption(pairs[0]).includes('swapped'));
});

test('createUndo snapshots manual pairs and restores them on pop', () => {
  const u = L.createUndo(10);
  u.push('swap', { a: 1 }, [{ before: 'x', after: 'y', kind: 'swapped' }]);
  const popped = u.pop();
  assert.deepEqual(popped.mpairs, [{ before: 'x', after: 'y', kind: 'swapped' }]);
  // mutating the popped copy must not corrupt the stored snapshot
  u.push('plain', { a: 2 });
  assert.equal(u.pop().mpairs, undefined, 'entries without mpairs leave them alone');
});
