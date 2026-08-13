// Headless smoke test for gating.js: stub DOM + canvas 2D, then run it.
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
  s0: '1.5', dsAf: '400', dsAtau: '2',
  t2: '5', win2: 'rect', t3: '8', win3: 'rect', f3: '1000', tau3: '20', t4: '13', t6: '40',
  s5: '6', s5t: '10',
  d6fs: '3', d6fe: '13',
  pf0: '1000', pQ: '3', pdB: '60', ptRefl: '7',
  pd: '2', phs: '2', phm: '2',
};

const INPUT_ATTRS = {
  t2: { min: '1', max: '22', step: '0.25' },
  t3: { min: '2', max: '200', step: '1' },
  f3: { min: '100', max: '5000', step: '10' },
  tau3: { min: '0.2', max: '25', step: '0.1' },
  t4: { min: '6', max: '13.75', step: '0.25' },
  t6: { min: '15', max: '120', step: '1' },
  s5t: { min: '2', max: '40', step: '0.5' },
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
    getBoundingClientRect: () => ({ width: 900, height: id === 'c2ir' ? 250 : id === 'c3k' ? 150 : 320, left: 0 }),
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
const appExports = require('./gating.js');
const dt = Date.now() - t0;

console.log(`executed in ${dt} ms without exceptions\n`);
for (const id of ['r1', 'r2', 'r3', 'r4']) {
  const txt = els.get(id).innerHTML.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  console.log(`[${id}] ${txt}\n`);
}

/* ---- exercise interactive states ---- */
const strip = s => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
function tryState(desc, fn, readout) {
  try { fn(); console.log(`OK  ${desc}\n    ${strip(els.get(readout).innerHTML)}\n`); }
  catch (e) { console.log(`FAIL ${desc}: ${e.message}\n`); process.exitCode = 1; }
}
const t2 = els.get('t2'), win2 = els.get('win2'), g2 = els.get('ghosts2');
const t3 = els.get('t3'), win3 = els.get('win3'), t4 = els.get('t4');

const s0 = els.get('s0');

/* ---- damped sinusoids: Part A sliders ---- */
const dsAf = els.get('dsAf'), dsAtau = els.get('dsAtau');
for (const [f, t] of [['100', '0.3'], ['400', '2'], ['2000', '20'], ['150', '8']]) {
  dsAf.value = f; dsAtau.value = t;
  tryState(`damped-sin f=${f} tau=${t}`, () => { dsAf.fire('input'); dsAtau.fire('input'); }, 'dsAr');
}
for (const v of ['0.4', '1.5', '4']) {
  s0.value = v;
  tryState(`demo0 sig=${v} ms`, () => s0.fire('input'), 'r0');
}

for (const v of ['1', '2', '8', '12', '13.75', '16', '22']) {
  t2.value = v;
  tryState(`demo2 T=${v} ms`, () => t2.fire('input'), 'r2');
}
t2.value = '5'; t2.fire('input');
win2.value = 'hann';
tryState('demo2 window=hann', () => win2.fire('change'), 'r2');
g2.checked = false;
tryState('demo2 ghosts off', () => g2.fire('change'), 'r2');
g2.checked = true; g2.fire('change');
win2.value = 'rect'; win2.fire('change');

for (const v of ['2', '20', '55', '80']) {
  t3.value = v;
  tryState(`demo3 T=${v} ms`, () => t3.fire('input'), 'r3');
}
win3.value = 'hann';
tryState('demo3 window=hann', () => win3.fire('change'), 'r3');
win3.value = 'rect'; win3.fire('change');

const f3 = els.get('f3'), tau3 = els.get('tau3');
for (const fv of ['100', '2500', '5000']) {
  f3.value = fv;
  tryState(`demo3 f0=${fv} Hz`, () => f3.fire('input'), 'r3');
}
f3.value = '1000'; f3.fire('input');
for (const tv of ['0.2', '1', '10', '25']) {
  tau3.value = tv;
  tryState(`demo3 tau=${tv} ms`, () => tau3.fire('input'), 'r3');
}
t3.value = '200';
tryState('demo3 T=200 ms (gate longer than the decay)', () => t3.fire('input'), 'r3');
tau3.value = '20'; tau3.fire('input');

for (const v of ['6', '10', '13.75']) {
  t4.value = v;
  tryState(`demo4 Tmax=${v} ms`, () => t4.fire('input'), 'r4');
}

/* ---- demo 5 ---- */
const s5 = els.get('s5');
for (const v of ['3', '6', '12']) {
  s5.value = v;
  tryState(`demo5 beta=${v}`, () => s5.fire('input'), 'r5');
}
const s5t = els.get('s5t');
for (const v of ['2', '10', '40']) {
  s5t.value = v;
  tryState(`demo5 T=${v} ms`, () => s5t.fire('input'), 'r5');
}
s5t.value = '10'; s5t.fire('input');

/* ---- drag simulation: pointer events on the draggable plots ---- */
function dragTo(cv, slider, startX, endX, desc) {
  try {
    cv._h.pointerdown({ clientX: startX, pointerId: 1, preventDefault() {} });
    cv._h.pointermove({ clientX: endX });
    cv._h.pointerup({});
    console.log(`OK  drag ${desc} \u2192 ${slider.id} = ${slider.value}\n`);
  } catch (e) { console.log(`FAIL drag ${desc}: ${e.message}\n`); process.exitCode = 1; }
}
// marker positions: plot.w = 900 css px, ML = 48, MR = 14 (log axis: x(f) = 48 + log10(f/20)/3 * 838)
t2.value = '5'; t2.fire('input');
t3.value = '8'; t3.fire('input');
t4.value = '13'; t4.fire('input');
els.get('t6').value = '40'; els.get('t6').fire('input');
const lx = f => Math.round(48 + Math.log10(f / 20) / 3 * 818);
dragTo(els.get('c3'), els.get('t3'), lx(125), lx(100), 'demo3 1/T line 8 \u2192 10 ms');
dragTo(els.get('c2'), els.get('t2'), lx(200), lx(100), 'demo2 1/T line 5 \u2192 10 ms');
dragTo(els.get('c4'), els.get('t4'), lx(1000 / 13), lx(100), 'demo4 1/Tmax line 13 \u2192 10 ms');
dragTo(els.get('c6'), els.get('t6'), lx(25), 26, 'demo6 1/T line 40 \u2192 60 ms');
// kernel plot: first zero sits at a quarter of the axis (x = 40..w-14)
dragTo(els.get('c3k'), els.get('t3'), 40 + 0.25 * (900 - 70), 40 + 0.32 * (900 - 70), 'demo3 kernel zero (shorter gate)');
// IR plot gate edge: x(t) = 48 + t/24 * 838; t2 is at 10 ms after the c2 drag above
dragTo(els.get('c2ir'), els.get('t2'), Math.round(48 + 10 / 24 * 818), Math.round(48 + 12 / 24 * 818), 'demo2 IR gate edge 10 \u2192 12 ms');
// restore defaults
t2.value = '5'; t2.fire('input');
t3.value = '8'; t3.fire('input');
t4.value = '13'; t4.fire('input');
els.get('t6').value = '40'; els.get('t6').fire('input');

/* ---- demo 6: fit window + extension ---- */
const t6 = els.get('t6'), d6fs = els.get('d6fs'), d6fe = els.get('d6fe');
const d6combos = [
  ['3', '13', '40'],    // clean window, good fit
  ['0.5', '13', '40'],  // includes direct sound + fast modes -> bad fit
  ['8', '13', '40'],    // shorter window
  ['3', '6', '60'],     // very short window
  ['3', '13.5', '120'], // longest window + long gate
];
for (const [fs2, fe, tg] of d6combos) {
  d6fs.value = fs2; d6fe.value = fe; t6.value = tg;
  tryState(`demo6 fit=[${fs2},${fe}]ms gate=${tg}ms`, () => {
    d6fs.fire('input'); d6fe.fire('input'); t6.fire('input');
  }, 'r6');
}

/* ---- planner ---- */
const pf0 = els.get('pf0'), pQ = els.get('pQ'), pdB = els.get('pdB'), ptRefl = els.get('ptRefl');
const combos = [
  ['100', '10', '60', '10'],   // classic infeasible bass case
  ['300', '3', '60', '10'],    // feasible
  ['60', '20', '50', '30'],    // large room, still tight
  ['1000', '5', '40', '20'],   // midrange, feasible
];
for (const [f, q, d, t] of combos) {
  pf0.value = f; pQ.value = q; pdB.value = d; ptRefl.value = t;
  tryState(`planner f0=${f} Q=${q} target=-${d} refl=${t}ms`, () => {
    pf0.fire('input'); pQ.fire('input'); pdB.fire('change'); ptRefl.fire('input');
  }, 'rp');
}

/* ---- damped sinusoids: Part B mode toggles ---- */
if (appExports && appExports.DS_MODES) {
  const { DS_MODES, drawPartB } = appExports;
  const dsBr = els.get('dsBr');
  const combosB = [
    ['all on', () => DS_MODES.forEach(m => m.on = true)],
    ['bass off', () => { DS_MODES.forEach(m => m.on = true); DS_MODES.find(m => m.id === 'm1').on = false; }],
    ['only direct + bass', () => DS_MODES.forEach(m => m.on = (m.id === 'dir' || m.id === 'm1'))],
    ['only fast modes', () => DS_MODES.forEach(m => m.on = (m.id === 'dir' || (m.f && m.tau < 1)))],
    ['all off', () => DS_MODES.forEach(m => m.on = false)],
  ];
  for (const [name, fn] of combosB) {
    fn();
    tryState(`modes: ${name}`, () => drawPartB(), 'dsBr');
  }
  DS_MODES.forEach(m => m.on = true); // restore
  drawPartB();
}
