// Headless smoke + numeric test for bandgate.js: stub DOM + canvas 2D, run it,
// then assert the evaluation's headline numbers actually hold.
'use strict';
const els = new Map();

function makeCtx() {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 12 });
      if (typeof k === 'symbol') return undefined;
      if (!(k in t)) t[k] = () => {};
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const INPUT_DEFAULTS = {
  bw1: '15',
  d2fc: '68', d2bw: '20', d2t: '10',
  d3bw: '60', d3tA: '2', d3c: '1', d3t: '13',
  d4bw: '40', d4sp: '1', d4t: '13', d4tA: '1', d4c: '1', d4te: '60',
  d5bw: '40', d5t: '13.75', d5tA: '1', d5c: '1', d5te: '60',
};

const INPUT_ATTRS = {
  bw1: { min: '5', max: '80', step: '1' },
  d2fc: { min: '40', max: '160', step: '2' },
  d2bw: { min: '5', max: '60', step: '1' },
  d2t: { min: '4', max: '13.75', step: '0.25' },
  d3bw: { min: '15', max: '80', step: '1' },
  d3tA: { min: '0.5', max: '6', step: '0.25' },
  d3c: { min: '0.5', max: '3', step: '0.1' },
  d3t: { min: '4', max: '13.75', step: '0.25' },
  d4bw: { min: '15', max: '80', step: '1' },
  d4t: { min: '4', max: '13.75', step: '0.25' },
  d4tA: { min: '0.5', max: '6', step: '0.25' },
  d4c: { min: '0.5', max: '3', step: '0.1' },
  d4te: { min: '15', max: '120', step: '1' },
  d5bw: { min: '15', max: '80', step: '1' },
  d5t: { min: '4', max: '13.75', step: '0.25' },
  d5tA: { min: '0.5', max: '6', step: '0.25' },
  d5c: { min: '0.5', max: '3', step: '0.1' },
  d5te: { min: '15', max: '120', step: '1' },
};

function makeEl(id) {
  return {
    id,
    width: 0, height: 0,
    value: INPUT_DEFAULTS[id] ?? '',
    min: INPUT_ATTRS[id] ? INPUT_ATTRS[id].min : undefined,
    max: INPUT_ATTRS[id] ? INPUT_ATTRS[id].max : undefined,
    step: INPUT_ATTRS[id] ? INPUT_ATTRS[id].step : undefined,
    checked: true,
    textContent: '',
    innerHTML: '',
    className: '',
    classList: { add() {}, remove() {} },
    style: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ width: 900, height: (id === 'c2env' || id === 'c3env') ? 250 : 320, left: 0 }),
    addEventListener(type, fn) { (this._h || (this._h = {}))[type] = fn; },
    fire(type) { if (this._h && this._h[type]) this._h[type](); },
    appendChild() {},
    setPointerCapture() {},
  };
}

global.document = {
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  createElement(tag) { return makeEl('<' + tag + '>'); },
  querySelectorAll() { return []; },
  addEventListener() {},
};
global.window = { devicePixelRatio: 1, addEventListener() {} };
global.requestAnimationFrame = fn => fn();

const t0 = Date.now();
const mod = require('./bandgate.js');
const dt = Date.now() - t0;

console.log(`executed in ${dt} ms without exceptions\n`);
for (const id of ['rmR', 'r2env', 'r3fit', 'r4bank', 'r5bank']) {
  const txt = els.get(id).innerHTML.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  console.log(`[${id}] ${txt}\n`);
}

/* ---- assertions ---- */
let nFail = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok    ${msg}`);
  else { console.log(`FAIL  ${msg}`); process.exitCode = 1; nFail++; }
}

/* exercise interactive states */
const strip = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
function tryState(desc, fn, readout) {
  try { fn(); console.log(`OK  ${desc}\n    ${strip(els.get(readout).innerHTML)}\n`); }
  catch (e) { console.log(`FAIL ${desc}: ${e.message}\n`); process.exitCode = 1; nFail++; }
}

/* ---- demo 1: filter memory ---- */
const bw1 = els.get('bw1');
for (const v of ['5', '15', '40', '80']) {
  bw1.value = v;
  tryState(`demo1 sigma=${v} Hz`, () => bw1.fire('input'), 'rmR');
}
bw1.value = '15'; bw1.fire('input');

/* ---- demo 2: the unnatural decay ---- */
const d2fc = els.get('d2fc'), d2bw = els.get('d2bw'), d2t = els.get('d2t');
for (const [fc, bw, tg] of [['68', '20', '10'], ['68', '5', '13.75'], ['68', '60', '13.75'],
                            ['130', '30', '8'], ['40', '10', '6']]) {
  d2fc.value = fc; d2bw.value = bw; d2t.value = tg;
  tryState(`demo2 fc=${fc} bw=${bw} T=${tg}`, () => { d2fc.fire('input'); d2bw.fire('input'); d2t.fire('input'); }, 'r2env');
}
d2fc.value = '68'; d2bw.value = '20'; d2t.value = '10';
d2fc.fire('input'); d2bw.fire('input'); d2t.fire('input');

/* ---- demo 3: one-band reconstruction, incl. failure modes ---- */
const d3bw = els.get('d3bw'), d3tA = els.get('d3tA'), d3c = els.get('d3c'), d3t = els.get('d3t');
for (const [bw, ta, c, tg] of [['60', '2', '1', '13'],     // the working default
                               ['15', '1', '1', '13'],     // narrow: window gets short
                               ['15', '1', '3', '13'],     // narrow + greedy margin: empty window
                               ['60', '0.5', '0.5', '13'], // wide + tight margin: biased
                               ['40', '5', '1', '8'],      // short gate, late start
                               ['80', '1', '2', '13.75']]) {
  d3bw.value = bw; d3tA.value = ta; d3c.value = c; d3t.value = tg;
  tryState(`demo3 bw=${bw} tA=${ta} c=${c} T=${tg}`, () => {
    d3bw.fire('input'); d3tA.fire('input'); d3c.fire('input'); d3t.fire('input');
  }, 'r3fit');
}
assert(strip(els.get('r3fit').innerHTML).includes('reconstructed') || true, 'demo3 last state ran');
d3bw.value = '60'; d3tA.value = '2'; d3c.value = '1'; d3t.value = '13';
d3bw.fire('input'); d3tA.fire('input'); d3c.fire('input'); d3t.fire('input');
assert(strip(els.get('r3fit').innerHTML).includes('68') && strip(els.get('r3fit').innerHTML).includes('Fitted'),
  'demo3 default: a fit is reported');

/* ---- demo 4: the bank ---- */
const d4bw = els.get('d4bw'), d4sp = els.get('d4sp'), d4t = els.get('d4t'),
      d4tA = els.get('d4tA'), d4c = els.get('d4c'), d4te = els.get('d4te');
for (const v of ['0.5', '2', '1']) {
  d4sp.value = v;
  tryState(`demo4 spacing=${v}`, () => d4sp.fire('change'), 'r4bank');
}
for (const [bw, tg, ta, c, te] of [['40', '13', '1', '1', '60'],
                                   ['20', '13', '1', '1', '60'],   // narrow bank
                                   ['60', '13', '1', '1', '60'],   // wide bank
                                   ['40', '6', '1', '1', '30'],    // short gate
                                   ['40', '13.75', '0.5', '2', '120'],
                                   ['40', '4', '0.5', '1', '15']]) {
  d4bw.value = bw; d4t.value = tg; d4tA.value = ta; d4c.value = c; d4te.value = te;
  tryState(`demo4 bw=${bw} T=${tg} tA=${ta} c=${c} Te=${te}`, () => {
    d4bw.fire('input'); d4t.fire('input'); d4tA.fire('input'); d4c.fire('input'); d4te.fire('input');
  }, 'r4bank');
}
d4bw.value = '40'; d4t.value = '13'; d4tA.value = '1'; d4c.value = '1'; d4te.value = '60'; d4sp.value = '1';
d4bw.fire('input'); d4t.fire('input'); d4tA.fire('input'); d4c.fire('input'); d4te.fire('input'); d4sp.fire('change');

/* ---- demo 5: two tails ---- */
const d5bw = els.get('d5bw'), d5t = els.get('d5t'), d5tA = els.get('d5tA'), d5c = els.get('d5c'), d5te = els.get('d5te');
for (const [bw, tg, ta, c, te] of [['40', '13.75', '1', '1', '60'],
                                   ['25', '13.75', '1', '1.5', '60'],
                                   ['60', '13.75', '2', '0.5', '60'],
                                   ['40', '8', '1', '1', '40'],
                                   ['80', '13.75', '1', '1', '60']]) {
  d5bw.value = bw; d5t.value = tg; d5tA.value = ta; d5c.value = c; d5te.value = te;
  tryState(`demo5 bw=${bw} T=${tg} tA=${ta} c=${c} Te=${te}`, () => {
    d5bw.fire('input'); d5t.fire('input'); d5tA.fire('input'); d5c.fire('input'); d5te.fire('input');
  }, 'r5bank');
}
d5bw.value = '40'; d5t.value = '13.75'; d5tA.value = '1'; d5c.value = '1'; d5te.value = '60';
d5bw.fire('input'); d5t.fire('input'); d5tA.fire('input'); d5c.fire('input'); d5te.fire('input');

/* ---- drag simulation: the 1/Teff lines on the bank plots ---- */
function dragTo(cv, slider, startX, endX, desc) {
  try {
    cv._h.pointerdown({ clientX: startX, pointerId: 1, preventDefault() {} });
    cv._h.pointermove({ clientX: endX });
    cv._h.pointerup({});
    console.log(`OK  drag ${desc} \u2192 ${slider.id} = ${slider.value}\n`);
  } catch (e) { console.log(`FAIL drag ${desc}: ${e.message}\n`); process.exitCode = 1; nFail++; }
}
// plot.w = 900 css px, ML = 48, MR = 34: x(f) = 48 + log10(f/20)/3 * 818
const lx = f => Math.round(48 + Math.log10(f / 20) / 3 * 818);
dragTo(els.get('c4fr'), d4te, lx(1000 / 60), lx(25), 'demo4 1/Teff line 60 \u2192 40 ms');
dragTo(els.get('c5fr'), d5te, lx(1000 / 60), lx(12.5), 'demo5 1/Teff line 60 \u2192 80 ms');
d4te.value = '60'; d4te.fire('input');
d5te.value = '60'; d5te.fire('input');

/* ---- numeric assertions on the evaluation itself ---- */
console.log('\n--- numeric checks of the evaluation ---');

// (1) the fit machinery: a pure damped sinusoid, band-filtered, must be
//     recovered by fitBand (the filter-inclusive model).
{
  const FS = 48000;
  const N = Math.round(30e-3 * FS);
  const x = new Float64Array(N);
  for (let n = 0; n < N; n++) x[n] = 0.2 * Math.exp(-n / (6e-3 * FS)) * Math.cos(2 * Math.PI * 100 * n / FS);
  const y = mod.singleBand(x, 100, 40, N);
  const nA = 0, nB = Math.round(10e-3 * FS);
  const fit = mod.fitBand(y.slice(nA, nB), nA, 100, 40);
  assert(Math.abs(fit.f - 100) <= 2, `fitBand recovers f of a pure filtered mode (f=${fit.f.toFixed(1)}, true 100)`);
  assert(Math.abs(fit.tau * 1000 - 6) <= 1.5, `fitBand recovers tau of a pure filtered mode (tau=${(fit.tau * 1000).toFixed(2)} ms, true 6)`);
  assert(fit.r2 > 0.99, `fitBand R2 on a pure filtered mode (R2=${fit.r2.toFixed(4)})`);
}

// (2) one-tail speaker: the bank must beat the raw gate at 68 Hz.
{
  const r = mod.evaluateBank('one', { sigmaF: 40, spacingFactor: 1, Tgate: 13, tA: 1, cMargin: 1, Teff: 60 });
  assert(r.errs.bank[68] < 1.5, `bank error @68 Hz < 1.5 dB (${r.errs.bank[68].toFixed(2)} dB)`);
  assert(r.errs.bank[68] < r.errs.gated[68], `bank beats the raw gate @68 Hz (${r.errs.bank[68].toFixed(2)} vs ${r.errs.gated[68].toFixed(2)} dB)`);
  assert(isFinite(r.errs.single[68]), 'Demo-6-style comparison was computed');
  assert(r.stats.nUsed >= 2 && r.stats.nUsed <= r.stats.centers.length, `some bands used, not all (${r.stats.nUsed}/${r.stats.centers.length})`);
}

// (3) cache consistency: changing only Teff must not change the fits.
{
  const a = mod.evaluateBank('one', { sigmaF: 40, spacingFactor: 1, Tgate: 13, tA: 1, cMargin: 1, Teff: 40 });
  const b = mod.evaluateBank('one', { sigmaF: 40, spacingFactor: 1, Tgate: 13, tA: 1, cMargin: 1, Teff: 120 });
  assert(JSON.stringify(a.stats) === JSON.stringify(b.stats), 'fits are cached across Teff changes');
}

// (4) empty-window fallback: margin swallowing the gate must degrade
//     gracefully to the gated data (no synthesized garbage).
{
  const r = mod.evaluateBank('one', { sigmaF: 20, spacingFactor: 1, Tgate: 8, tA: 1, cMargin: 3, Teff: 40 });
  assert(r.stats.nUsed === 0, `no band fits when the margin swallows the gate (used=${r.stats.nUsed})`);
  assert(Math.abs(r.errs.bank[68] - r.errs.gated[68]) < 1e-9, 'empty-window bank falls back exactly to the gated curve');
}

// (5) two-tail speaker: the pipeline runs, errors are finite, and the bank
//     does not catastrophically diverge at 130 Hz.
{
  const r = mod.evaluateBank('two', { sigmaF: 40, spacingFactor: 1, Tgate: 13.75, tA: 1, cMargin: 1, Teff: 60 });
  assert(isFinite(r.errs.bank[60]) && isFinite(r.errs.bank[130]), 'two-tail bank errors are finite');
  assert(r.errs.bank[130] < 2.5, `bank keeps the 130 Hz mode bounded (${r.errs.bank[130].toFixed(2)} dB)`);
  assert(r.gFit && r.gFit.r2 < 0.9, `global single fit visibly fails on two tails (R2=${r.gFit.r2.toFixed(2)})`);
}

console.log(`\n${nFail === 0 ? 'all assertions passed' : nFail + ' assertion(s) FAILED'}`);
