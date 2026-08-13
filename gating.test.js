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

function makeEl(id) {
  return {
    id,
    width: 0, height: 0,
    value: id === 't2' ? '5' : id === 't3' ? '8' : id === 't4' ? '13' : '',
    checked: true,
    textContent: '',
    innerHTML: '',
    className: '',
    classList: { add() {}, remove() {} },
    style: {},
    getContext: () => makeCtx(),
    getBoundingClientRect: () => ({ width: 900, height: id === 'c2ir' ? 250 : id === 'c3k' ? 150 : 320 }),
    addEventListener(type, fn) { (this._h || (this._h = {}))[type] = fn; },
    fire(type) { if (this._h && this._h[type]) this._h[type](); },
    appendChild() {},
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
