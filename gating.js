'use strict';
/* =====================================================================
   Gating, zero-padding and the 1/T limit — interactive demonstrations
   fs = 48 kHz, synthetic impulse responses.
   All spectra are computed by direct DTFT evaluation:
       X(f) = sum_n x[n] * exp(-j 2 pi f n / fs)
   which is mathematically identical to a zero-padded FFT evaluated at
   arbitrarily fine frequency spacing.
   ===================================================================== */

const FS = 48000, FMIN = 20, FMAX = 20000;

/* ------------------------- synthetic IRs ---------------------------- */

function normalize(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] /= m;
  return x;
}

function addModes(x, modes) {
  for (const [f, tau, a] of modes) {
    const w = 2 * Math.PI * f / FS, d = 1 / (tau * FS);
    for (let n = 0; n < x.length; n++) x[n] += a * Math.exp(-n * d) * Math.cos(w * n);
  }
}

const FAST_MODES = [[420, 0.75e-3, 1.00], [1150, 0.60e-3, 0.62],
                    [2900, 0.50e-3, 0.40], [6400, 0.35e-3, 0.18]];

/* Demo 1: decays below ~-50 dB within exactly 5 ms -> gate catches all of it */
function fastDecayIR() {
  const x = new Float64Array(Math.round(5e-3 * FS));
  addModes(x, FAST_MODES);
  x[0] += 1.3;
  return normalize(x);
}

/* Demo 2 & 4: fast mid/high part + slow 68 Hz bass/port tail (tau = 11 ms)
   + floor reflection at 14 ms ("room measurement")                       */
function slowDecayIR(reflection, dur = 0.040) {
  const x = new Float64Array(Math.round(dur * FS));
  addModes(x, [[420, 0.75e-3, 0.90], [1150, 0.60e-3, 0.55],
               [2900, 0.50e-3, 0.35], [6400, 0.35e-3, 0.15]]);
  x[0] += 1.2;
  const f0 = 68, tau = 11e-3, a = 0.35, n0 = Math.round(0.4e-3 * FS);
  const w = 2 * Math.PI * f0 / FS, d = 1 / (tau * FS);
  for (let n = n0; n < x.length; n++) x[n] += a * Math.exp(-(n - n0) * d) * Math.cos(w * (n - n0));
  if (reflection) {
    const fast = fastDecayIR(), rd = Math.round(14e-3 * FS);
    for (let n = 0; n < fast.length && rd + n < x.length; n++) x[rd + n] += 0.55 * fast[n];
  }
  return normalize(x);
}

/* Demo 3: modal background + one high-Q 1 kHz resonance (tau = 20 ms, Q ~ 63)
   kept for 160 ms -> the "true" impulse response                              */
function sharpIR() {
  const x = new Float64Array(Math.round(0.160 * FS));
  addModes(x, [[420, 0.75e-3, 0.90], [1150, 0.60e-3, 0.55],
               [2900, 0.50e-3, 0.35], [6400, 0.35e-3, 0.15]]);
  x[0] += 1.2;
  const f0 = 1000, tau = 20e-3, a = 0.08;
  const w = 2 * Math.PI * f0 / FS, d = 1 / (tau * FS);
  for (let n = 0; n < x.length; n++) x[n] += a * Math.exp(-n * d) * Math.cos(w * n);
  return normalize(x);
}

/* --------------------- gating / spectrum machinery ------------------- */

/* Multiply the IR by a gate of length Tms.
   'rect' = hard truncation, 'hann' = half-Hann fade 1 -> 0 (a "tapered" gate). */
function gate(x, Tms, type) {
  const N = Math.min(x.length, Math.max(2, Math.round(Tms * 1e-3 * FS)));
  const y = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    y[n] = x[n] * (type === 'hann' ? 0.5 * (1 + Math.cos(Math.PI * n / N)) : 1);
  }
  return y;
}

/* Direct DTFT magnitude in dB at arbitrary frequencies (== zero-padded FFT). */
function spectrumDb(x, freqs) {
  const out = new Float64Array(freqs.length), N = x.length;
  for (let i = 0; i < freqs.length; i++) {
    const w = -2 * Math.PI * freqs[i] / FS;
    const cw = Math.cos(w), sw = Math.sin(w);
    let wr = 1, wi = 0, sr = 0, si = 0;
    for (let n = 0; n < N; n++) {
      sr += x[n] * wr; si += x[n] * wi;
      const tw = wr * cw - wi * sw;
      wi = wr * sw + wi * cw; wr = tw;
      if ((n & 255) === 255) { const m = Math.hypot(wr, wi); wr /= m; wi /= m; }
    }
    out[i] = 20 * Math.log10(Math.hypot(sr, si) + 1e-12);
  }
  return out;
}

function logFreqs(n) {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = FMIN * Math.pow(FMAX / FMIN, i / (n - 1));
  return a;
}

function autoRange(list, { pad = 3, step = 6, minSpan = 30, maxSpan = 80 } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const s of list) for (let i = 0; i < s.length; i++) {
    const v = s[i];
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  lo = Math.floor((lo - pad) / step) * step;
  hi = Math.ceil((hi + pad) / step) * step;
  if (hi - lo > maxSpan) lo = hi - maxSpan;
  if (hi - lo < minSpan) lo = hi - minSpan;
  return [lo, hi];
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw - 1e-12) return m * p;
  return 10 * p;
}

function rafThrottle(fn) {
  let pend = false;
  return function () {
    if (pend) return;
    pend = true;
    requestAnimationFrame(() => { pend = false; fn(); });
  };
}

/* --------------------------- plot helpers ---------------------------- */

const ML = 48, MR = 14, MT = 10, MB = 26;

function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.max(2, Math.round(r.width * dpr));
  cv.height = Math.max(2, Math.round(r.height * dpr));
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

/* log-frequency / dB plot */
class Plot {
  constructor(id) {
    this.cv = document.getElementById(id);
    this.ctx = this.cv.getContext('2d');
    this.ymin = -60; this.ymax = 0;
    this.setSize();
  }
  setSize() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.max(2, Math.round(r.width * dpr));
    this.cv.height = Math.max(2, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setRange(lo, hi) { this.ymin = lo; this.ymax = hi; }
  X(f) { return ML + (Math.log10(f / FMIN) / Math.log10(FMAX / FMIN)) * (this.w - ML - MR); }
  freqAt(px) { return FMIN * Math.pow(FMAX / FMIN, (px - ML) / (this.w - ML - MR)); }
  Y(db) { return MT + (1 - (db - this.ymin) / (this.ymax - this.ymin)) * (this.h - MT - MB); }
  frame() {
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    c.font = '11px system-ui'; c.lineWidth = 1;
    const fT = [20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4];
    const fL = ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'];
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let i = 0; i < fT.length; i++) {
      const x = this.X(fT[i]);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(x, MT); c.lineTo(x, h - MB); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(fL[i], x, h - MB + 6);
    }
    const span = this.ymax - this.ymin, step = span <= 42 ? 6 : 10;
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = Math.ceil(this.ymin / step) * step; db <= this.ymax; db += step) {
      const y = this.Y(db);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ML, y); c.lineTo(w - MR, y); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ML - 6, y);
    }
    c.strokeStyle = '#39434f';
    c.strokeRect(ML, MT, w - ML - MR, h - MT - MB);
  }
  clip() {
    const c = this.ctx;
    c.save(); c.beginPath();
    c.rect(ML, MT, this.w - ML - MR, this.h - MT - MB); c.clip();
  }
  curve(f, db, { color = '#4da3ff', width = 1.8, dash = null, alpha = 1 } = {}) {
    const c = this.ctx;
    this.clip();
    c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width;
    c.setLineDash(dash || []);
    c.beginPath();
    const lo = this.ymin - 30, hi = this.ymax + 30;
    for (let i = 0; i < f.length; i++) {
      let v = db[i]; if (v < lo) v = lo; if (v > hi) v = hi;
      const x = this.X(f[i]), y = this.Y(v);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.setLineDash([]); c.globalAlpha = 1; c.restore();
  }
  dots(f, db, { color = '#4da3ff', r = 3 } = {}) {
    const c = this.ctx;
    this.clip();
    c.fillStyle = color;
    for (let i = 0; i < f.length; i++) {
      const v = db[i];
      if (v < this.ymin - 5 || v > this.ymax + 5) continue;
      c.beginPath(); c.arc(this.X(f[i]), this.Y(v), r, 0, 6.2832); c.fill();
    }
    c.restore();
  }
  band(f, loArr, hiArr, color = 'rgba(255,159,67,0.22)') {
    const c = this.ctx;
    this.clip();
    c.fillStyle = color; c.beginPath();
    for (let i = 0; i < f.length; i++) {
      const y = this.Y(Math.min(hiArr[i], this.ymax + 30));
      i ? c.lineTo(this.X(f[i]), y) : c.moveTo(this.X(f[i]), y);
    }
    for (let i = f.length - 1; i >= 0; i--) {
      const y = this.Y(Math.max(loArr[i], this.ymin - 30));
      c.lineTo(this.X(f[i]), y);
    }
    c.closePath(); c.fill();
    c.restore();
  }
  vline(f, { color = '#e05c5c', label = '', dash = [5, 4] } = {}) {
    if (f < FMIN || f > FMAX) return;
    const c = this.ctx, x = this.X(f);
    c.save();
    c.strokeStyle = color; c.setLineDash(dash); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x, MT); c.lineTo(x, this.h - MB); c.stroke();
    c.setLineDash([]);
    if (label) {
      c.font = '11px system-ui';
      const tw = c.measureText(label).width;
      let lx = x + 5;
      if (lx + tw > this.w - MR - 2) lx = x - tw - 5;
      c.fillStyle = 'rgba(14,17,22,0.85)'; c.fillRect(lx - 3, MT + 3, tw + 6, 15);
      c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(label, lx, MT + 5);
    }
    c.restore();
  }
}

/* linear-time / dB plot (impulse-response overview) */
class TimePlot {
  constructor(id, tmax) {
    this.cv = document.getElementById(id);
    this.ctx = this.cv.getContext('2d');
    this.tmax = tmax; this.ymin = -80; this.ymax = 4;
    this.setSize();
  }
  setSize() {
    const dpr = window.devicePixelRatio || 1, r = this.cv.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.max(2, Math.round(r.width * dpr));
    this.cv.height = Math.max(2, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  X(t) { return ML + (t / this.tmax) * (this.w - ML - MR); }
  msAt(px) { return (px - ML) / (this.w - ML - MR) * this.tmax; }
  Y(db) { return MT + (1 - (db - this.ymin) / (this.ymax - this.ymin)) * (this.h - MT - MB); }
  frame() {
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    const step = this.tmax > 15 ? 4 : 2;
    for (let t = 0; t <= this.tmax + 1e-9; t += step) {
      const x = this.X(t);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(x, MT); c.lineTo(x, h - MB); c.stroke();
      c.fillStyle = '#7d8899';
      c.fillText(Math.abs(t - this.tmax) < 1e-9 ? t + ' ms' : String(t), x, h - MB + 6);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = -80; db <= this.ymax; db += 20) {
      const y = this.Y(db);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ML, y); c.lineTo(w - MR, y); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ML - 6, y);
    }
    c.strokeStyle = '#39434f';
    c.strokeRect(ML, MT, w - ML - MR, h - MT - MB);
  }
  vlineMs(t, { color = '#ff9f43', label = '', dash = [5, 4], dy = 5 } = {}) {
    if (t < 0 || t > this.tmax) return;
    const c = this.ctx, x = this.X(t);
    c.strokeStyle = color; c.setLineDash(dash); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(x, MT); c.lineTo(x, this.h - MB); c.stroke();
    c.setLineDash([]);
    if (label) {
      c.font = '11px system-ui';
      const tw = c.measureText(label).width;
      let lx = x + 5;
      if (lx + tw > this.w - MR - 2) lx = x - tw - 5;
      c.fillStyle = 'rgba(14,17,22,0.85)'; c.fillRect(lx - 3, MT + dy - 2, tw + 6, 14);
      c.fillStyle = color; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(label, lx, MT + dy);
    }
  }
}

/* ------------------------- data + caches ----------------------------- */

const GRID = logFreqs(600);          // shared dense log grid
const G2 = logFreqs(500);            // demo 2 grid
const G4 = logFreqs(400);            // demo 4 grid

const irFast = fastDecayIR();        // demo 1 (exactly 5 ms of data)
const irSlow = slowDecayIR(true);    // demo 2/4 "room measurement" (reflection @ 14 ms)
const irSharp = sharpIR();           // demo 3 (160 ms "true" IR)
const truthSlow = slowDecayIR(false, 0.20); // demo 4 "true anechoic" response

const refDb1 = spectrumDb(irFast, GRID);        // demo 1: dense reference, same data
const trueDbSharp = spectrumDb(irSharp, GRID);  // demo 3: true spectrum (cached)
let trueDbSlow4 = null;                          // demo 4: true spectrum on G4 (lazy)
function truth4() { if (!trueDbSlow4) trueDbSlow4 = spectrumDb(truthSlow, G4); return trueDbSlow4; }

/* ------------------------------ DOM ---------------------------------- */

const els = {};
for (const id of ['c0t', 'c0f', 'c1', 'c2', 'c2ir', 'c3', 'c3k', 'c4',
                  'c5w', 'c5s', 'c5t', 'c6', 'cp1', 'cp2',
                  'dsAt', 'dsAs', 'dsBt', 'dsBf', 'd6t', 'd6s',
                  'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'rp',
                  'dsAr', 'dsBr', 'dsModes', 'dsLegend', 'd6fit',
                  's0', 's5', 't2', 'win2', 'ghosts2', 't3', 'win3', 't4', 't6',
                  'dsAf', 'dsAtau', 'dsAfV', 'dsAtauV', 'd6fs', 'd6fe', 'd6fsV', 'd6feV',
                  's0v', 's5v', 's5t', 's5tV', 't2v', 't3v', 't4v', 't6v', 'padBtns',
                  'pf0', 'pQ', 'pdB', 'ptRefl', 'pf0v', 'pQv', 'ptRefv',
                  'pd', 'phs', 'phm', 'pbApply', 'pbVal',
                  'p1', 'p1why', 'p3', 'p3why',
                  'quiz', 'qzscore', 'qzreset']) {
  els[id] = document.getElementById(id);
}

const plots = {
  d1: new Plot('c1'),
  d2: new Plot('c2'),
  ir: new TimePlot('c2ir', 24),
  d3: new Plot('c3'),
  d4: new Plot('c4'),
  d6: new Plot('c6'),
  dsBf: new Plot('dsBf'),
};

/* ---------------------------- Demo 0 --------------------------------- */
/* The uncertainty-principle seesaw: a Gaussian and its transform.
   g(t) = exp(-t^2/(2 sigT^2))  <=>  G(f) ~ exp(-f^2/(2 sigF^2)),
   with sigF = 1/(2*pi*sigT)  ->  sigT*sigF = 1/(2*pi), invariant.      */

const state0 = { sig: parseFloat(els.s0.value) }; // sigma_t in ms, from the slider

function drawLinPlot(cv, xs, ys, { xmin, xmax, xticks, xlabels, title, color = '#4da3ff', fill = null }) {
  const { ctx: c, w, h } = sizeCanvas(cv);
  c.clearRect(0, 0, w, h);
  const ml = 44, mr = 14, mt = 10, mb = 26;
  const X = x => ml + (x - xmin) / (xmax - xmin) * (w - ml - mr);
  const Y = y => mt + (1 - y) * (h - mt - mb); // amplitude 0..1
  c.font = '11px system-ui'; c.lineWidth = 1;
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let i = 0; i < xticks.length; i++) {
    const x = X(xticks[i]);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(xlabels[i], x, h - mb + 6);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const yv of [0, 0.5, 1]) {
    const y = Y(yv);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(yv), ml - 6, y);
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  c.beginPath();
  for (let i = 0; i < xs.length; i++) {
    i ? c.lineTo(X(xs[i]), Y(ys[i])) : c.moveTo(X(xs[i]), Y(ys[i]));
  }
  if (fill) {
    c.lineTo(X(xs[xs.length - 1]), Y(0)); c.lineTo(X(xs[0]), Y(0));
    c.closePath();
    c.fillStyle = fill; c.fill();
  }
  c.strokeStyle = color; c.lineWidth = 2;
  c.beginPath();
  for (let i = 0; i < xs.length; i++) {
    i ? c.lineTo(X(xs[i]), Y(ys[i])) : c.moveTo(X(xs[i]), Y(ys[i]));
  }
  c.stroke();
  c.restore();
  if (title) {
    c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(title, ml + 6, mt + 4);
  }
}

function drawDemo0() {
  const sigMs = state0.sig;
  const sigT = sigMs * 1e-3;               // s
  const sigF = 1 / (2 * Math.PI * sigT);   // Hz

  // time view: fixed +/-10 ms axis so the squeezing is visible
  const N = 500;
  const ts = new Float64Array(N), g = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = (-10 + 20 * i / (N - 1)) * 1e-3;
    ts[i] = t;
    g[i] = Math.exp(-t * t / (2 * sigT * sigT));
  }
  drawLinPlot(els.c0t, Array.from(ts, t => t * 1000), g, {
    xmin: -10, xmax: 10,
    xticks: [-10, -5, 0, 5, 10], xlabels: ['-10', '-5', '0', '5', '10 ms'],
    title: 'time: the pulse (amplitude)', color: '#4da3ff', fill: 'rgba(77,163,255,0.12)',
  });

  // frequency view: fixed +/-1200 Hz axis so the stretching is visible
  const fs2 = new Float64Array(N), G = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const f = -1200 + 2400 * i / (N - 1);
    fs2[i] = f;
    G[i] = Math.exp(-f * f / (2 * sigF * sigF));
  }
  drawLinPlot(els.c0f, Array.from(fs2), G, {
    xmin: -1200, xmax: 1200,
    xticks: [-1200, -600, 0, 600, 1200], xlabels: ['-1200', '-600', '0', '600', '1200 Hz'],
    title: `frequency: its spectrum \u2014 \u03c3f = ${sigF.toFixed(0)} Hz (amplitude)`,
    color: '#ff9f43', fill: 'rgba(255,159,67,0.12)',
  });

  els.r0.innerHTML =
    `\u03c3<sub>t</sub> = <b>${sigMs.toFixed(2)} ms</b> \u2192 \u03c3<sub>f</sub> = 1/(2\u03c0\u03c3<sub>t</sub>) = <b>${sigF.toFixed(0)} Hz</b> \u00b7 ` +
    `product \u03c3<sub>t</sub>\u00b7\u03c3<sub>f</sub> = <b>${(sigT * sigF).toFixed(4)}</b> = 1/2\u03c0 \u2014 <span class="hl">invariant</span>. ` +
    `Squeeze time \u00d7\u00bd and frequency stretches \u00d72. Translate to gating: a gate of T seconds can hold spectral detail no finer than \u2248 ` +
    `<b>${(1 / (sigMs * 1e-3)).toFixed(0)} Hz = 1/T</b>.`;
}

/* ------------------- building blocks: damped sinusoids --------------- */
/* One resonance rings as a*e^(-t/tau)*cos(2*pi*f0*t); every IR on this
   page (and every real loudspeaker's) is a sum of these.              */

function dampedSinusoid(fHz, tauMs, a, durSec) {
  const N = Math.max(2, Math.round(durSec * FS));
  const x = new Float64Array(N);
  const d = 1 / (tauMs * 1e-3 * FS);
  const w = 2 * Math.PI * fHz / FS;
  for (let n = 0; n < N; n++) x[n] = a * Math.exp(-n * d) * Math.cos(w * n);
  return x;
}

/* ---- Part A: one resonance, dissected ---- */
const stateA = { f: parseFloat(els.dsAf.value), tau: parseFloat(els.dsAtau.value) };

function drawDStime() {
  const f = stateA.f, tauMs = stateA.tau;
  const dur = Math.max(0.004, Math.min(0.2, 8 * tauMs * 1e-3));
  const x = dampedSinusoid(f, tauMs, 1, dur);
  const { ctx: c, w, h } = sizeCanvas(els.dsAt);
  c.clearRect(0, 0, w, h);
  const ml = 44, mr = 14, mt = 12, mb = 24;
  const X = t => ml + t / dur * (w - ml - mr);
  const Y = v => mt + (1 - (v + 1.25) / 2.5) * (h - mt - mb);
  c.font = '11px system-ui'; c.lineWidth = 1;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const tst = niceStep(dur * 1000 / 5);
  for (let t = 0; t <= dur * 1000 + 1e-9; t += tst) {
    const px = X(t / 1000);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(Math.round(t * 10) / 10), px, h - mb + 5);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const v of [-1, -0.5, 0, 0.5, 1]) {
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, Y(v));
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  // decaying envelope
  c.setLineDash([5, 4]); c.strokeStyle = '#8d99ab'; c.lineWidth = 1.2;
  for (const s of [1, -1]) {
    c.beginPath();
    for (let i = 0; i <= 200; i++) {
      const t = dur * i / 200;
      i ? c.lineTo(X(t), Y(s * Math.exp(-t / (tauMs * 1e-3)))) : c.moveTo(X(t), Y(s * Math.exp(-t / (tauMs * 1e-3))));
    }
    c.stroke();
  }
  c.setLineDash([]);
  // the ringing itself
  c.beginPath();
  for (let n = 0; n < x.length; n++) {
    const t = n / FS;
    n ? c.lineTo(X(t), Y(x[n])) : c.moveTo(X(t), Y(x[n]));
  }
  c.strokeStyle = '#4da3ff'; c.lineWidth = 1.6; c.stroke();
  // bracket one period
  const per = 1 / f;
  if (per < dur * 0.9) {
    const yb = Y(-1.15);
    c.strokeStyle = '#ff9f43'; c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(X(0), yb - 4); c.lineTo(X(0), yb); c.lineTo(X(per), yb); c.lineTo(X(per), yb - 4);
    c.stroke();
    c.fillStyle = '#ff9f43'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`one period = 1/f\u2080 = ${(per * 1000).toFixed(2)} ms`, X(per) + 6, yb);
  }
  c.restore();
  c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText('time: the ringing of one resonance \u00b7 dashed = envelope \u00b1e^(\u2212t/\u03c4)', ml + 6, mt + 2);
}

function drawDSspec() {
  const f = stateA.f, tauMs = stateA.tau, tauS = tauMs * 1e-3;
  const dur = Math.max(0.004, Math.min(0.2, 8 * tauMs * 1e-3));
  const x = dampedSinusoid(f, tauMs, 1, dur);
  const span = Math.max(0.5 * f, 6 / (Math.PI * tauS));
  const fmin = Math.max(1, f - span), fmax = f + span;
  const M = 900;
  const fr = new Float64Array(M);
  for (let i = 0; i < M; i++) fr[i] = fmin + (fmax - fmin) * i / (M - 1);
  const db = spectrumDb(x, fr);
  let pk = -Infinity;
  for (let i = 0; i < M; i++) if (db[i] > pk) pk = db[i];
  for (let i = 0; i < M; i++) db[i] -= pk;
  // measured -6 dB width
  let il = -1, ir2 = -1;
  for (let i = 0; i < M; i++) if (db[i] >= -6) { if (il < 0) il = i; ir2 = i; }
  const w6 = (il >= 0 && ir2 > il) ? fr[ir2] - fr[il] : NaN;

  const { ctx: c, w, h } = sizeCanvas(els.dsAs);
  c.clearRect(0, 0, w, h);
  const ml = 44, mr = 14, mt = 12, mb = 24;
  const X = fq => ml + (fq - fmin) / (fmax - fmin) * (w - ml - mr);
  const Y = v => mt + (1 - (v + 60) / 60) * (h - mt - mb);
  c.font = '11px system-ui'; c.lineWidth = 1;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const fst = niceStep((fmax - fmin) / 6);
  for (let fq = Math.ceil(fmin / fst) * fst; fq <= fmax; fq += fst) {
    const px = X(fq);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(fq >= 1000 ? (fq / 1000).toFixed(1) + 'k' : String(Math.round(fq)), px, h - mb + 5);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = 0; v >= -60; v -= 20) {
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, Y(v));
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  c.beginPath();
  for (let i = 0; i < M; i++) i ? c.lineTo(X(fr[i]), Y(db[i])) : c.moveTo(X(fr[i]), Y(db[i]));
  c.strokeStyle = '#ff9f43'; c.lineWidth = 2; c.stroke();
  // -6 dB width bracket
  if (!isNaN(w6)) {
    c.strokeStyle = '#3ecf8e'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(X(fr[il]), Y(-6)); c.lineTo(X(fr[ir2]), Y(-6)); c.stroke();
    c.fillStyle = '#3ecf8e'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`\u22126 dB width \u2248 ${w6.toFixed(0)} Hz`, X((fr[il] + fr[ir2]) / 2), Y(-6) - 3);
  }
  c.setLineDash([5, 4]); c.strokeStyle = '#e05c5c';
  c.beginPath(); c.moveTo(X(f), mt); c.lineTo(X(f), h - mb); c.stroke(); c.setLineDash([]);
  c.restore();
  c.fillStyle = '#e05c5c'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(`f\u2080 = ${f} Hz`, Math.min(X(f) + 5, w - 80), mt + 2);
  c.fillStyle = '#93a0b4';
  c.fillText('frequency: one peak at f\u2080 \u2014 longer \u03c4 \u21d2 narrower, taller peak', ml + 6, mt + 2);
  return { w6 };
}

function drawPartA() {
  drawDStime();
  const { w6 } = drawDSspec();
  const f = stateA.f, tauS = stateA.tau * 1e-3;
  const Q = Math.PI * f * tauS;
  els.dsAr.innerHTML =
    `f\u2080 = <b>${f} Hz</b>, \u03c4 = <b>${stateA.tau.toFixed(1)} ms</b> \u2192 ` +
    `Q = \u03c0f\u2080\u03c4 = <b>${Q.toFixed(1)}</b> \u00b7 peak width \u2248 f\u2080/Q = 1/(\u03c0\u03c4) = ` +
    `<b>${(1 / (Math.PI * tauS)).toFixed(0)} Hz</b> (\u22123 dB)` +
    (isNaN(w6) ? '' : `, measured \u22126 dB width ${w6.toFixed(0)} Hz`) + `. ` +
    `<span class="hl">The ringing lasts \u03c4 \u2192 the spectral detail is 1/(\u03c0\u03c4) wide.</span> ` +
    `To capture this resonance cleanly the gate must cover it (~6.9\u03c4 = ${(6.9 * stateA.tau).toFixed(0)} ms for \u221260 dB) \u2014 ` +
    `which then resolves features down to 1/T \u2248 ${(1000 / (6.9 * stateA.tau)).toFixed(0)} Hz. One number ruling both sides.`;
}

/* ---- Part B: a whole speaker, toggled mode by mode ---- */
const DS_MODES = [
  { id: 'dir', label: 'direct sound (the impulse itself)', color: '#e8edf4', on: true, direct: true },
  { id: 'm1', label: 'bass resonance (port-like)', f: 100, tau: 10, a: 0.8, color: '#ff6b6b', on: true },
  { id: 'm2', label: 'mid resonance', f: 420, tau: 0.8, a: 1.0, color: '#4da3ff', on: true },
  { id: 'm3', label: 'upper-mid resonance', f: 1150, tau: 0.6, a: 0.62, color: '#3ecf8e', on: true },
  { id: 'm4', label: 'treble resonance I', f: 2900, tau: 0.5, a: 0.4, color: '#ff9f43', on: true },
  { id: 'm5', label: 'treble resonance II', f: 6400, tau: 0.4, a: 0.2, color: '#b48cff', on: true },
];
const DS_WIN = 0.060; // analysis window, s (covers 6x the slowest tau)
let dsIndiv = null; // cached individual spectra on GRID

function dsIndividual() {
  if (dsIndiv) return dsIndiv;
  dsIndiv = {};
  for (const m of DS_MODES) {
    const x = new Float64Array(Math.round(DS_WIN * FS));
    if (m.direct) x[0] = 1.2;
    else {
      const d = dampedSinusoid(m.f, m.tau, m.a, DS_WIN);
      for (let n = 0; n < x.length; n++) x[n] = d[n];
    }
    dsIndiv[m.id] = spectrumDb(x, GRID);
  }
  return dsIndiv;
}

function buildDSTable() {
  const box = els.dsModes;
  box.innerHTML = '';
  DS_MODES.forEach(m => {
    const row = document.createElement('div');
    row.className = 'dsrow' + (m.on ? '' : ' off');
    row.id = 'dsrow_' + m.id;
    const pars = m.direct
      ? 'broadband, flat spectrum'
      : `${m.f} Hz \u00b7 \u03c4 ${m.tau} ms \u00b7 Q ${(Math.PI * m.f * m.tau * 1e-3).toFixed(1)} \u00b7 a ${m.a}`;
    row.innerHTML = `<input type="checkbox" ${m.on ? 'checked' : ''}>` +
      `<span class="swatch" style="background:${m.color}"></span>` +
      `<span>${m.label}</span><span class="pars">${pars}</span>`;
    const cb = row.querySelector ? row.querySelector('input') : null;
    if (cb) cb.addEventListener('change', () => {
      m.on = cb.checked;
      row.classList.toggle('off', !m.on);
      drawPartB();
    });
    else row.addEventListener('click', () => {
      m.on = !m.on;
      row.classList.toggle('off', !m.on);
      drawPartB();
    });
    box.appendChild(row);
  });
  els.dsLegend.innerHTML =
    `<span><span class="swatch" style="background:#dfe6ee"></span> bold: coherent sum of the active modes</span>` +
    `<span><span class="swatch" style="background:#5a6575"></span> thin colored: each active mode alone</span>`;
}

function envelopeDb(x, win) {
  const N = x.length, out = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    let m = 0;
    for (let k = Math.max(0, n - win); k < Math.min(N, n + win + 1); k++) {
      const a = Math.abs(x[k]);
      if (a > m) m = a;
    }
    out[n] = 20 * Math.log10(m + 1e-12);
  }
  return out;
}

function drawPartB() {
  const ind = dsIndividual();
  const N = Math.round(DS_WIN * FS);
  const total = new Float64Array(N);
  let activeModes = 0, slowest = null;
  for (const m of DS_MODES) {
    if (!m.on) continue;
    if (m.direct) total[0] += 1.2;
    else {
      const d = dampedSinusoid(m.f, m.tau, m.a, DS_WIN);
      for (let n = 0; n < N; n++) total[n] += d[n];
      activeModes++;
      if (!slowest || m.tau > slowest.tau) slowest = m;
    }
  }
  let peak = 0;
  for (let n = 0; n < N; n++) if (Math.abs(total[n]) > peak) peak = Math.abs(total[n]);

  /* IR time view (dB envelope) */
  {
    const { ctx: c, w, h } = sizeCanvas(els.dsBt);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 12, mb = 24;
    const tmaxMs = DS_WIN * 1000;
    const X = t => ml + t / tmaxMs * (w - ml - mr);
    const Y = db => mt + (1 - (db + 80) / 85) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let t = 0; t <= tmaxMs; t += 10) {
      const px = X(t);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(t + (t === tmaxMs ? ' ms' : ''), px, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = -80; db <= 0; db += 20) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(db)); c.lineTo(w - mr, Y(db)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ml - 5, Y(db));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    if (peak > 1e-9) {
      const env = envelopeDb(total, 12);
      c.beginPath();
      for (let n = 0; n < N; n += 2) {
        const px = X(n / FS * 1000), py = Y(Math.max(-80, env[n]));
        n ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.strokeStyle = '#dfe6ee'; c.lineWidth = 1.8; c.stroke();
    }
    c.restore();
    c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('impulse response, dB envelope \u2014 the long tail exists only if a long-\u03c4 mode is active', ml + 6, mt + 2);
  }

  /* FR view */
  const p = plots.dsBf;
  if (peak <= 1e-9) {
    p.setRange(-60, 0); p.frame();
    els.dsBr.innerHTML = 'All modes off \u2014 no signal. Switch something on.';
    return;
  }
  const totalDb = spectrumDb(total, GRID);
  const shown = [totalDb];
  for (const m of DS_MODES) if (m.on) shown.push(ind[m.id]);
  const [lo, hi] = autoRange(shown, { maxSpan: 80 });
  p.setRange(lo, hi); p.frame();
  for (const m of DS_MODES) {
    if (m.on) p.curve(GRID, ind[m.id], { color: m.color, width: 1.1, alpha: 0.6 });
  }
  p.curve(GRID, totalDb, { color: '#dfe6ee', width: 2.2 });

  els.dsBr.innerHTML =
    `<b>${activeModes}</b> resonance${activeModes === 1 ? '' : 's'} active` +
    (slowest
      ? ` \u2014 the slowest is <b>${slowest.label}</b> (\u03c4 = ${slowest.tau} ms). It alone forces a gate of ` +
        `\u2248 6.9\u03c4 = <b>${(6.9 * slowest.tau).toFixed(0)} ms</b> to reach \u221260 dB \u2192 resolution limited to ` +
        `1/T \u2248 <b>${(1000 / (6.9 * slowest.tau)).toFixed(0)} Hz</b>. Switch it off and the gate could shrink to ` +
        `\u2248 <b>${(6.9 * Math.max(...DS_MODES.filter(m => !m.direct && m.on && m !== slowest).map(m => m.tau), 0.3)).toFixed(1)} ms</b> ` +
        `with correspondingly finer resolution.`
      : ` \u2014 only the direct sound remains: a perfectly flat, infinitely short IR. Any gate length works for it.`);
}

/* ---------------------------- Demo 1 --------------------------------- */

const state1 = { P: 1 };

function binFreqs(P) {
  const N = irFast.length, L = P * N, out = [];
  const k0 = Math.max(1, Math.ceil(FMIN * L / FS));
  for (let k = k0; ; k++) {
    const f = k * FS / L;
    if (f > FMAX) break;
    out.push(f);
  }
  return Float64Array.from(out);
}

function drawDemo1() {
  const P = state1.P;
  const bf = binFreqs(P);
  const bd = spectrumDb(irFast, bf);
  const [lo, hi] = autoRange([refDb1, bd]);
  const p = plots.d1;
  p.setRange(lo, hi); p.frame();
  p.curve(GRID, refDb1, { color: '#8a95a6', width: 1.6 });
  if (bf.length <= 900) p.dots(bf, bd, { color: '#4da3ff', r: bf.length > 400 ? 2.4 : 3.2 });
  else p.curve(bf, bd, { color: '#4da3ff', width: 1.8 });
  p.vline(200, { color: '#e05c5c', label: '1/T = 200 Hz' });
  const spacing = FS / (P * irFast.length);
  els.r1.innerHTML =
    `<b>${P}\u00d7 zero-padding</b>: FFT length ${P}\u00d7${irFast.length} = ${P * irFast.length} samples ` +
    `\u2192 bin spacing <b>${spacing >= 10 ? spacing.toFixed(0) : spacing.toFixed(2)} Hz</b>, ` +
    `${bf.length} bins in the 20 Hz \u2013 20 kHz window. ` +
    (P === 1
      ? `With no padding you get one point every 200 Hz \u2014 yet the data <i>between</i> the bins is fully determined by the 5 ms record; we are simply not looking at it.`
      : `Same 5 ms of data, ${P}\u00d7 more evaluation points \u2014 and every new point lands exactly on the grey curve.`) +
    ` <span class="hl">Zero-padding creates no new information; it needs none.</span>`;
}

/* ---------------------------- Demo 2 --------------------------------- */

const state2 = { T: parseFloat(els.t2.value), win: els.win2.value || 'rect', ghosts: els.ghosts2.checked };
const GHOSTS = [2, 4, 8, 12];
const ghostCache = {};
function getGhosts(wt) {
  if (!ghostCache[wt]) ghostCache[wt] = GHOSTS.map(g => spectrumDb(gate(irSlow, g, wt), G2));
  return ghostCache[wt];
}

function drawDemo2() {
  const T = state2.T, wt = state2.win;
  const cur = spectrumDb(gate(irSlow, T, wt), G2);
  const Tref = Math.min(2 * T, 13.75);
  const cmp = spectrumDb(gate(irSlow, Tref, wt), G2);
  const diff = new Float64Array(G2.length);
  let dmax = 0;
  for (let i = 0; i < G2.length; i++) {
    diff[i] = Math.abs(cur[i] - cmp[i]);
    if (diff[i] > dmax) dmax = diff[i];
  }
  // split the change into the unresolved region (below 1/T) and the rest
  const fLim = Math.max(1000 / T, 30);
  let dLow = 0, dHigh = 0;
  for (let i = 0; i < G2.length; i++) {
    if (G2[i] < fLim) { if (diff[i] > dLow) dLow = diff[i]; }
    else if (diff[i] > dHigh) dHigh = diff[i];
  }
  const all = [cur, cmp];
  if (state2.ghosts) all.push(...getGhosts(wt));
  const [lo, hi] = autoRange(all, { maxSpan: 70 });
  const p = plots.d2;
  p.setRange(lo, hi); p.frame();
  if (state2.ghosts) getGhosts(wt).forEach(g => p.curve(G2, g, { color: '#5a6575', width: 1, alpha: 0.55 }));
  p.curve(G2, cmp, { color: '#3ecf8e', width: 1.3, alpha: 0.85, dash: [6, 4] });
  p.curve(G2, cur, { color: '#4da3ff', width: 2.2 });
  p.vline(1000 / T, { color: '#e05c5c', label: `1/T = ${(1000 / T).toFixed(0)} Hz` });
  drawIRView(T, wt);

  const Ng = Math.round(T * 1e-3 * FS);
  // tail level: peak envelope over the last 2 ms of the gate
  // (max, not RMS — a 0.5 ms RMS window spans only a fraction of a 68 Hz period)
  const a0 = Math.max(0, Ng - Math.round(2e-3 * FS));
  let mTail = 0;
  for (let n = a0; n < Ng && n < irSlow.length; n++) mTail = Math.max(mTail, Math.abs(irSlow[n]));
  const tail = 20 * Math.log10(mTail + 1e-12);
  let status;
  if (T >= 14) {
    status = `<span class="warn">\u26a0 The gate now contains the 14 ms reflection \u2014 the curve is comb-filtered; this is no longer the speaker's free-field response at all.</span>`;
  } else if (T >= 13.75 - 1e-9) {
    status = `This is the longest gate available before the reflection \u2014 nothing left to compare against. The IR is still at ${tail.toFixed(0)} dB there, far from decayed: <span class="hl">the bass never got resolved \u2014 you need another method</span> (ground plane, nearfield splice, chamber \u2014 see below).`;
  } else if (2 * T <= 13.75 + 1e-9) {
    // honest doubling test: 2xT is still reflection-free
    if (dmax < 0.15) {
      status = `<span class="ok">\u2713 Converged:</span> doubling the gate changes the response by only <b>${dmax.toFixed(2)} dB</b> \u2014 the gate already contains essentially all the data.`;
    } else {
      status = `<span class="warn">Still moving:</span> doubling the gate changes the response by up to ` +
        `<b>${dLow.toFixed(1)} dB below 1/T</b> (&lt; ${(1000 / T).toFixed(0)} Hz)` +
        (dHigh < 1
          ? ` and by only ${dHigh.toFixed(1)} dB above it \u2014 the changes sit exactly where 1/T says nothing can be resolved. `
          : ` and by ${dHigh.toFixed(1)} dB above it \u2014 the truncated tail is still strong, and its spectral sidelobes leak into the midrange. `) +
        `<span class="hl">Gate too short.</span>`;
    }
  } else {
    // doubling is impossible: 2xT would land past the reflection
    status = `<span class="hl">Doubling test unavailable</span> \u2014 2\u00d7T would run past the 14 ms reflection. ` +
      `Difference to the longest clean gate (13.75 ms): up to <b>${dmax.toFixed(1)} dB</b>` +
      (dmax >= 0.15 ? ` (${dLow.toFixed(1)} dB of it below 1/T)` : '') +
      `; IR level at the gate end \u2248 <b>${tail.toFixed(0)} dB</b>` +
      (tail <= -45
        ? ` \u2014 well decayed, this gate is essentially sufficient.`
        : ` \u2014 nowhere near decayed: the bass below ~1/T stays unresolved. This is exactly the situation Demo 4 addresses.`);
  }
  els.r2.innerHTML =
    `<b>T = ${T.toFixed(2)} ms</b> \u2192 resolution limit 1/T = <b>${(1000 / T).toFixed(0)} Hz</b> \u00b7 ` +
    `IR level at the gate end \u2248 <b>${tail.toFixed(0)} dB</b> below peak \u00b7 ` +
    `green dashed = response at ${Tref.toFixed(2)} ms (2\u00d7T${Tref < 2 * T - 1e-6 ? ' \u2014 capped at 13.75 ms, the longest clean gate before the reflection' : ''}). ${status}`;
}

/* impulse-response overview under demo 2 */
function drawIRView(Tms, wtype) {
  const tp = plots.ir;
  tp.frame();
  const c = tp.ctx, x = irSlow, N = x.length;
  // gate shading
  c.fillStyle = 'rgba(255,159,67,0.10)';
  c.fillRect(tp.X(0), MT, tp.X(Math.min(Tms, tp.tmax)) - tp.X(0), tp.h - MT - MB);
  // envelope of |IR| in dB
  const env = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    let m = 0;
    for (let k = Math.max(0, n - 12); k < Math.min(N, n + 13); k++) {
      const a = Math.abs(x[k]);
      if (a > m) m = a;
    }
    env[n] = m;
  }
  c.save();
  c.beginPath(); c.rect(ML, MT, tp.w - ML - MR, tp.h - MT - MB); c.clip();
  c.beginPath();
  for (let n = 0; n < N; n++) {
    const t = n / FS * 1000;
    const db = Math.max(tp.ymin, 20 * Math.log10(env[n] + 1e-12));
    const px = tp.X(t), py = tp.Y(db);
    n ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.strokeStyle = '#4da3ff'; c.lineWidth = 1.3; c.stroke();
  c.lineTo(tp.X((N - 1) / FS * 1000), tp.h - MB);
  c.lineTo(tp.X(0), tp.h - MB);
  c.closePath();
  c.fillStyle = 'rgba(77,163,255,0.12)'; c.fill();
  // window shape of the current gate
  const Ng = Math.min(N, Math.round(Tms * 1e-3 * FS));
  c.beginPath();
  for (let n = 0; n < Ng; n++) {
    const wgt = wtype === 'hann' ? 0.5 * (1 + Math.cos(Math.PI * n / Ng)) : 1;
    const db = Math.max(tp.ymin, 20 * Math.log10(wgt));
    const px = tp.X(n / FS * 1000), py = tp.Y(db);
    n ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.strokeStyle = '#ff9f43'; c.setLineDash([4, 3]); c.lineWidth = 1.2; c.stroke();
  c.setLineDash([]);
  c.restore();
  tp.vlineMs(Tms, { color: '#ff9f43', label: `gate end ${Tms.toFixed(2)} ms`, dy: 5 });
  tp.vlineMs(14, { color: '#ff6b6b', label: 'reflection 14 ms', dy: 21 });
}

/* ---------------------------- Demo 3 --------------------------------- */

const state3 = { T: parseFloat(els.t3.value), win: els.win3.value || 'rect' };
const TAU3 = 20; // resonance decay time, ms

function drawDemo3() {
  const T = state3.T, wt = state3.win;
  const gd = spectrumDb(gate(irSharp, T, wt), GRID);
  const [lo, hi] = autoRange([trueDbSharp, gd], { maxSpan: 80 });
  const p = plots.d3;
  p.setRange(lo, hi); p.frame();
  p.curve(GRID, trueDbSharp, { color: '#9aa5b5', width: 1.5 });
  p.curve(GRID, gd, { color: '#4da3ff', width: 2.2 });
  p.vline(1000 / T, { color: '#e05c5c', label: `1/T = ${(1000 / T).toFixed(0)} Hz` });
  drawKernel(T, wt);
  const captured = (1 - Math.exp(-2 * T / TAU3)) * 100;
  const lobe = wt === 'rect' ? 1 : 2;
  const smear = (lobe * 1000 / T).toFixed(0);
  els.r3.innerHTML =
    `Gate <b>${T} ms</b> \u2192 smearing width \u2248 ${lobe}/T = <b>${smear} Hz</b> ` +
    `(${wt === 'rect' ? 'rectangular main lobe' : 'half-Hann main lobe, \u2248 2\u00d7 the rectangular one'}) \u2014 ` +
    `while the true resonance is only \u2248 15 Hz wide. ` +
    `That ${smear} Hz blur is <b>the same fixed width everywhere</b> \u2014 at 200 Hz exactly as at 5 kHz: ` +
    `smoothing in Hz, not in octaves. ` +
    `Share of the resonance's decay energy inside the gate: <b>${captured.toFixed(0)} %</b>. ` +
    (T >= 55
      ? `<span class="ok">The gate now covers most of the decay \u2014 the gated spectrum nearly coincides with the true one. Multiplication by 1 did nothing.</span>`
      : `The 1 kHz peak is broadened and lowered${wt === 'rect' ? ' and surrounded by \u221213 dB leakage sidelobes' : ''} \u2014 exactly the convolution with the kernel shown below.`);
}

/* the "smearing kernel": magnitude spectrum of the gate window itself */
function drawKernel(Tms, wtype) {
  const { ctx: c, w, h } = sizeCanvas(els.c3k);
  c.clearRect(0, 0, w, h);
  const Ng = Math.max(2, Math.round(Tms * 1e-3 * FS));
  const win = new Float64Array(Ng);
  let dc = 0;
  for (let n = 0; n < Ng; n++) {
    const wgt = wtype === 'hann' ? 0.5 * (1 + Math.cos(Math.PI * n / Ng)) : 1;
    win[n] = wgt; dc += wgt;
  }
  const fmax = 4000 / Tms, M = 320;
  const fr = new Float64Array(M);
  for (let i = 0; i < M; i++) fr[i] = i * fmax / (M - 1);
  const db = spectrumDb(win, fr);
  const off = 20 * Math.log10(dc);
  const ml = 40, mr = 14, mt = 20, mb = 22;
  const X = f => ml + (f / fmax) * (w - ml - mr);
  const Y = v => mt + (1 - (v + 60) / 63) * (h - mt - mb); // +3 .. -60 dB
  c.font = '11px system-ui';
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let v = 0; v >= -60; v -= 20) {
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, Y(v));
  }
  const st = niceStep(fmax / 5);
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let f = 0; f <= fmax + 1e-9; f += st) {
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(X(f), mt); c.lineTo(X(f), h - mb); c.stroke();
    c.fillStyle = '#7d8899';
    c.fillText(f >= 1000 ? (f / 1000) + 'k' : String(Math.round(f)), X(f), h - mb + 5);
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  c.beginPath();
  for (let i = 0; i < M; i++) {
    const v = Math.max(-60, db[i] - off);
    i ? c.lineTo(X(fr[i]), Y(v)) : c.moveTo(X(fr[i]), Y(v));
  }
  c.strokeStyle = '#ff9f43'; c.lineWidth = 1.8; c.stroke();
  const x1 = X(1000 / Tms);
  c.strokeStyle = '#e05c5c'; c.setLineDash([5, 4]);
  c.beginPath(); c.moveTo(x1, mt); c.lineTo(x1, h - mb); c.stroke();
  c.setLineDash([]);
  c.restore();
  c.fillStyle = '#e05c5c'; c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillText(`1/T = ${(1000 / Tms).toFixed(0)} Hz (first zero of the rectangular kernel)`, Math.min(x1 + 5, w - 240), mt + 4);
  c.fillStyle = '#93a0b4';
  c.fillText(
    wtype === 'rect'
      ? 'window spectrum |W(f)| \u2014 the smearing kernel: main lobe 1/T wide, sidelobes only \u221213 dB'
      : 'window spectrum |W(f)| \u2014 the smearing kernel: main lobe \u2248 2/T wide, but sidelobes far lower',
    ml + 6, 4);
}

/* ---------------------------- Demo 4 --------------------------------- */

const state4 = { Tmax: parseFloat(els.t4.value) };

function drawDemo4() {
  const Tmax = state4.Tmax;
  const gates = [];
  for (let t = 1; t < Tmax - 1e-9; t += 0.5) gates.push(t);
  gates.push(Tmax);
  const curves = gates.map(t => spectrumDb(gate(irSlow, t, 'rect'), G4));
  const lo = new Float64Array(G4.length).fill(Infinity);
  const hi = new Float64Array(G4.length).fill(-Infinity);
  for (const cvv of curves) for (let i = 0; i < G4.length; i++) {
    if (cvv[i] < lo[i]) lo[i] = cvv[i];
    if (cvv[i] > hi[i]) hi[i] = cvv[i];
  }
  const last = curves[curves.length - 1];
  const [ylo, yhi] = autoRange([lo, hi, truth4()], { maxSpan: 80 });
  const p = plots.d4;
  p.setRange(ylo, yhi); p.frame();
  p.band(G4, lo, hi);
  curves.forEach((cvv, i) => {
    if (i % 2 === 0 && i !== curves.length - 1) p.curve(G4, cvv, { color: '#6b7684', width: 0.8, alpha: 0.5 });
  });
  p.curve(G4, truth4(), { color: '#e8edf4', width: 1.3, dash: [7, 5] });
  p.curve(G4, last, { color: '#3ecf8e', width: 2.4 });
  // the exact multiples of 1/Tmax: no frequency is privileged, not even the "bin" centers
  const f1 = 1000 / Tmax, kmax = Math.max(1, Math.floor(1600 / f1));
  const mf = [], md = [];
  for (let k = 1; k <= kmax; k++) { mf.push(k * f1); md.push(last[nearestIdx(G4, k * f1)]); }
  p.dots(mf, md, { color: '#3ecf8e', r: 3 });
  p.vline(1000 / Tmax, { color: '#e05c5c', label: `1/Tmax = ${(1000 / Tmax).toFixed(0)} Hz` });
  const wAt = f0 => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < G4.length; i++) {
      const d = Math.abs(G4[i] - f0);
      if (d < bd) { bd = d; bi = i; }
    }
    return hi[bi] - lo[bi];
  };
  els.r4.innerHTML =
    `Longest usable gate <b>${Tmax.toFixed(2)} ms</b> (the reflection arrives at 14 ms) \u2192 features narrower than ` +
    `<b>${(1000 / Tmax).toFixed(0)} Hz</b> cannot be resolved below that frequency. ` +
    `Remaining uncertainty (band width): <b>${wAt(40).toFixed(1)} dB @ 40 Hz</b>, ` +
    `${wAt(100).toFixed(1)} dB @ 100 Hz, ${wAt(400).toFixed(1)} dB @ 400 Hz. ` +
    `The green dots mark the exact multiples of 1/Tmax (${(1000 / Tmax).toFixed(0)}, ${(2000 / Tmax).toFixed(0)}, \u2026 Hz) \u2014 ` +
    `<b>even they are window-smoothed estimates</b>, not exact samples of the true response: near the port resonance the first dot ` +
    `sits visibly off the dashed truth. Truncation error lands on every frequency, not just \u201cbetween the bins\u201d. ` +
    `<span class="hl">The band is the honest answer below 1/T</span> \u2014 green is the best estimate ` +
    `(window-smoothed truth), white dashed is where the curves are heading (the true response).`;
}

/* ---------------------------- Demo 5 --------------------------------- */
/* The window design space: main-lobe width vs peak sidelobe. All windows
   are T long (T = 10 ms -> N = 480), start at 1 and fade toward 0 like a
   real gate; spectra plotted vs f*T so the rect first zero sits at 1.    */

const state5 = { beta: parseFloat(els.s5.value), T: parseFloat(els.s5t.value) };

function besselI0(x) {
  let sum = 1, term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x * x) / (4 * k * k);
    sum += term;
    if (term < 1e-16 * sum) break;
  }
  return sum;
}

function makeWindow(type, N, beta) {
  const w = new Float64Array(N);
  if (type === 'rect') w.fill(1);
  else if (type === 'hann') for (let n = 0; n < N; n++) w[n] = 0.5 * (1 + Math.cos(Math.PI * n / N));
  else if (type === 'kaiser') {
    const Ib = besselI0(beta);
    for (let n = 0; n < N; n++) {
      const r = n / N;
      w[n] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / Ib;
    }
  } else if (type === 'exp') for (let n = 0; n < N; n++) w[n] = Math.exp(-6 * n / N);
  return w;
}

/* spectrum in dB (DC-normalized, floored) on f*T in 0..5, plus stats:
   - lobeT: smoothing width = full -6 dB width of the kernel, in 1/T units
   - sl:    first sidelobe (ringing) level, or null if the skirt decays
            monotonically (no sidelobes at all)                             */
function analyzeWin(type, beta, Tms) {
  const N = Math.max(2, Math.round(Tms * 1e-3 * FS)), M = 2400;
  const w = makeWindow(type, N, beta);
  const oneOverT = 1000 / Tms;                 // Hz
  const fr = new Float64Array(M);
  for (let i = 0; i < M; i++) fr[i] = i * 5 * oneOverT / (M - 1); // f\u00b7T in 0..5
  const db = spectrumDb(w, fr);
  const dc = db[0];
  for (let i = 0; i < M; i++) db[i] = Math.max(-140, db[i] - dc);
  let i6 = -1;
  for (let i = 1; i < M; i++) { if (db[i] < -6) { i6 = i; break; } }
  const lobeT = i6 > 0 ? 2 * fr[i6] / oneOverT : NaN; // full -6 dB width, units of 1/T
  let iMin = -1;
  for (let i = (i6 > 0 ? i6 : 4) + 1; i < M - 1; i++) {
    if (db[i] < db[i - 1] && db[i] <= db[i + 1]) { iMin = i; break; }
  }
  let sl = null;
  if (iMin > 0) {
    sl = -Infinity;
    for (let i = iMin + 1; i < M; i++) if (db[i] > sl) sl = db[i];
  }
  return { fT: Array.from(fr, f => f / oneOverT), db, lobeT, sl };
}

const WIN_DEFS = [
  { type: 'rect', label: 'rect', color: '#ff6b6b' },
  { type: 'hann', label: 'half-Hann', color: '#ff9f43' },
  { type: 'kaiser', beta: 4, label: 'Kaiser \u03b2=4', color: '#3ecf8e' },
  { type: 'kaiser', beta: 8, label: 'Kaiser \u03b2=8', color: '#b48cff' },
  { type: 'exp', label: 'exponential', color: '#8a95a6' },
];
let winCache = null;
function getWinCache() {
  if (!winCache || winCache.T !== state5.T)
    winCache = { T: state5.T, wins: WIN_DEFS.map(d => ({ ...d, an: analyzeWin(d.type, d.beta, state5.T) })) };
  return winCache.wins;
}

function drawDemo5() {
  const beta = state5.beta, T5 = state5.T;
  const user = analyzeWin('kaiser', beta, T5);
  const wins = getWinCache();

  /* --- time view: the window shapes --- */
  {
    const { ctx: c, w, h } = sizeCanvas(els.c5w);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 10, mb = 24;
    const N = Math.max(2, Math.round(T5 * 1e-3 * FS));
    const X = n => ml + n / (N - 1) * (w - ml - mr);
    const Y = v => mt + (1 - v) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    const tst = niceStep(T5 / 5);
    for (let ms = 0; ms <= T5 + 1e-9; ms += tst) {
      const x = X(ms * FS / 1000);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke();
      c.fillStyle = '#7d8899';
      c.fillText((Math.round(ms * 10) / 10) + (T5 - ms < tst ? ' ms' : ''), x, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of [0, 0.5, 1]) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, Y(v));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    const all = wins.concat([{ color: '#4da3ff', w: makeWindow('kaiser', N, beta) }]);
    for (const wd of all) {
      const ww = wd.w || makeWindow(wd.type, N, wd.beta);
      c.beginPath();
      for (let n = 0; n < N; n++) n ? c.lineTo(X(n), Y(ww[n])) : c.moveTo(X(n), Y(ww[n]));
      c.strokeStyle = wd.color; c.lineWidth = wd.color === '#4da3ff' ? 2 : 1.4; c.stroke();
    }
    c.restore();
    c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`gate shapes, all T = ${T5.toFixed(1)} ms long`, ml + 6, mt + 4);
  }

  /* --- spectra view --- */
  {
    const { ctx: c, w, h } = sizeCanvas(els.c5s);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 10, mb = 24;
    const X = ft => ml + ft / 5 * (w - ml - mr);
    const Y = db => mt + (1 - (db + 120) / 120) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let ft = 0; ft <= 5; ft++) {
      const x = X(ft);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(ft === 1 ? '1 (=1/T)' : String(ft), x, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = 0; db >= -120; db -= 20) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(db)); c.lineTo(w - mr, Y(db)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ml - 5, Y(db));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    for (const wd of wins) {
      c.beginPath();
      for (let i = 0; i < wd.an.fT.length; i++) {
        i ? c.lineTo(X(wd.an.fT[i]), Y(wd.an.db[i])) : c.moveTo(X(wd.an.fT[i]), Y(wd.an.db[i]));
      }
      c.strokeStyle = wd.color; c.lineWidth = 1.4; c.stroke();
    }
    c.beginPath();
    for (let i = 0; i < user.fT.length; i++) {
      i ? c.lineTo(X(user.fT[i]), Y(user.db[i])) : c.moveTo(X(user.fT[i]), Y(user.db[i]));
    }
    c.strokeStyle = '#4da3ff'; c.lineWidth = 2.2; c.stroke();
    c.restore();
    c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('window spectra |W(f)|, dB \u2014 main lobe vs sidelobes (x axis: f\u00b7T)', ml + 6, mt + 4);
  }

  /* --- trade-off scatter --- */
  {
    const { ctx: c, w, h } = sizeCanvas(els.c5t);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 10, mb = 24;
    const xmin = 1.0, xmax = 3.5, ymin = -40, ymax = 0;
    const X = x => ml + (x - xmin) / (xmax - xmin) * (w - ml - mr);
    const Y = y => mt + (1 - (y - ymin) / (ymax - ymin)) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let x = 1; x <= 3.5; x += 0.5) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(X(x), mt); c.lineTo(X(x), h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(x.toFixed(1) + '/T', X(x), h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let y = 0; y >= -40; y -= 10) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(y)); c.lineTo(w - mr, Y(y)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(y) + ' dB', ml - 5, Y(y));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    const dot = (wd, an) => {
      const mono = an.sl === null;
      const y = mono ? ymin : Math.max(an.sl, ymin);
      c.fillStyle = wd.color;
      c.beginPath(); c.arc(X(an.lobeT), Y(y), 4.5, 0, 6.2832); c.fill();
      if (mono) { // downward tick: sidelobe does not exist
        c.strokeStyle = wd.color; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(X(an.lobeT), Y(y) + 5); c.lineTo(X(an.lobeT), Y(y) + 11); c.stroke();
      }
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(wd.label, X(an.lobeT) + 8, Y(y));
    };
    for (const wd of wins) dot(wd, wd.an);
    dot({ color: '#4da3ff', label: `your Kaiser \u03b2=${beta.toFixed(1)}` }, user);
    c.fillStyle = '#93a0b4'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('the design space: smoothing width (\u22126 dB) vs ringing (first sidelobe) \u2014 you can slide along it, never past it', ml + 6, mt + 4);
    c.fillText('points pinned to the bottom edge \u2193 have no sidelobe at all: their skirt decays monotonically (no ringing)', ml + 6, mt + 17);
  }

  els.r5.innerHTML =
    `Kaiser \u03b2 = <b>${beta.toFixed(1)}</b>: smoothing width \u2248 <b>${user.lobeT.toFixed(2)}/T</b> ` +
    `(= ${(user.lobeT * 1000 / T5).toFixed(0)} Hz for a ${T5.toFixed(1)} ms gate), ringing: ` +
    (user.sl === null ? `<b>none</b> \u2014 the kernel skirt decays monotonically` : `first sidelobe \u2248 <b>${user.sl.toFixed(1)} dB</b>`) + `. ` +
    `Rectangular is the opposite corner: narrowest kernel (1.21/T) but \u221213.3 dB sidelobes \u2014 visible as the ripples ` +
    `beside smeared features in Demo 3. <span class="hl">More taper \u2192 less ringing, wider smearing kernel. Pick where you sit.</span>`;
}

/* ---------------------------- Demo 6 --------------------------------- */
/* "Something else", done properly in two steps:
   1. OBTAIN the model: fit a damped sinusoid to the visible tail
        f0   <- spectral peak of the fit window
        tau, A, B <- least squares of e^(-t/tau)(A cos + B sin), sweeping tau
   2. USE it: splice the synthesized tail in at the fit-window end and run
      it past the reflection -> an effectively longer gate.              */

const state6 = { fitStart: parseFloat(els.d6fs.value), fitEnd: parseFloat(els.d6fe.value), T: parseFloat(els.t6.value) };
let truthDb6 = null;
function getTruth6() { if (!truthDb6) truthDb6 = spectrumDb(truthSlow, GRID); return truthDb6; }
function nearestIdx(freqs, f) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < freqs.length; i++) {
    const d = Math.abs(freqs[i] - f);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/* The fitter: a small pole fit. The spectrum of a short window of a slow
   tail has no clear peak at f0, so f0 and tau are found TOGETHER by
   coarse-to-fine least squares over e^(-t/tau)(A cos 2 pi f t + B sin ..).
   Returns f0, tau (s), A, B (relative to window start), amp, r2, plus the
   window spectrum and where a naive peak-pick would have (mis)landed.    */
function fitDamped(x, n0, n1) {
  const N = n1 - n0;
  const seg = new Float64Array(N);
  for (let i = 0; i < N; i++) seg[i] = x[n0 + i];
  const t = new Float64Array(N);
  for (let i = 0; i < N; i++) t[i] = i / FS;
  const cw = new Float64Array(N), sw = new Float64Array(N);
  const b1 = new Float64Array(N), b2 = new Float64Array(N);

  function sweep(fLo, fHi, fStep, tauLo, tauHi, tauStep) {
    let local = { err: Infinity, f: 0, tau: 0, A: 0, B: 0 };
    for (let f = fLo; f <= fHi + 1e-9; f += fStep) {
      const w = 2 * Math.PI * f;
      for (let i = 0; i < N; i++) { cw[i] = Math.cos(w * t[i]); sw[i] = Math.sin(w * t[i]); }
      for (let tauMs = tauLo; tauMs <= tauHi + 1e-9; tauMs += tauStep) {
        const tau = tauMs * 1e-3;
        let s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0;
        for (let i = 0; i < N; i++) {
          const e = Math.exp(-t[i] / tau);
          const u = e * cw[i], v = e * sw[i];
          b1[i] = u; b2[i] = v;
          s11 += u * u; s12 += u * v; s22 += v * v;
          s1y += u * seg[i]; s2y += v * seg[i];
        }
        const det = s11 * s22 - s12 * s12;
        if (Math.abs(det) < 1e-20) continue;
        const A = (s22 * s1y - s12 * s2y) / det;
        const B = (s11 * s2y - s12 * s1y) / det;
        let err = 0;
        for (let i = 0; i < N; i++) { const r = seg[i] - (A * b1[i] + B * b2[i]); err += r * r; }
        if (err < local.err) local = { err, f, tau, A, B };
      }
    }
    return local;
  }

  // coarse grid over (f, tau), then a local refinement around the minimum
  const coarse = sweep(40, 160, 4, 3, 30, 1);
  const fine = sweep(Math.max(30, coarse.f - 4), coarse.f + 4, 0.5,
                     Math.max(2, coarse.tau * 1000 - 1), coarse.tau * 1000 + 1, 0.1);
  const best = fine.err < coarse.err ? fine : coarse;

  let mean = 0;
  for (let i = 0; i < N; i++) mean += seg[i];
  mean /= N;
  let ssTot = 0;
  for (let i = 0; i < N; i++) { const dd = seg[i] - mean; ssTot += dd * dd; }
  const r2 = ssTot > 0 ? Math.max(0, 1 - best.err / ssTot) : 1;

  // window spectrum for display + the naive peak-pick it would (mis)make
  const M = 360;
  const fr = new Float64Array(M);
  for (let i = 0; i < M; i++) fr[i] = 30 + (250 - 30) * i / (M - 1);
  const winDb = spectrumDb(seg, fr);
  let pk = -Infinity;
  for (let i = 0; i < M; i++) if (winDb[i] > pk) pk = winDb[i];
  for (let i = 0; i < M; i++) winDb[i] -= pk;
  let ipk = 0;
  for (let i = 1; i < M; i++) if (winDb[i] > winDb[ipk]) ipk = i;

  return { f0: best.f, tau: best.tau, A: best.A, B: best.B, amp: Math.hypot(best.A, best.B),
           r2, n0, n1, fr, winDb, naivePk: fr[ipk] };
}

/* Model value at sample n (relative-time formula from the fit) */
function modelAt(fit, n) {
  const tRel = (n - fit.n0) / FS;
  return Math.exp(-tRel / fit.tau) * (fit.A * Math.cos(2 * Math.PI * fit.f0 * tRel) + fit.B * Math.sin(2 * Math.PI * fit.f0 * tRel));
}

/* real data up to the fit-window end, then the synthesized tail */
function extendIR(x, fit, Tms) {
  const NT = Math.max(fit.n1, Math.round(Tms * 1e-3 * FS));
  const out = new Float64Array(NT);
  for (let n = 0; n < fit.n1 && n < x.length; n++) out[n] = x[n];
  for (let n = fit.n1; n < NT; n++) out[n] = modelAt(fit, n);
  return out;
}

let fitCache = null;
function getFit() {
  if (!fitCache) {
    fitCache = fitDamped(irSlow, Math.round(state6.fitStart * 1e-3 * FS), Math.round(state6.fitEnd * 1e-3 * FS));
  }
  return fitCache;
}
function invalidateFit() { fitCache = null; }

function drawDemo6Fit() {
  const fit = getFit();
  const t0ms = fit.n0 / FS * 1000, t1ms = fit.n1 / FS * 1000;

  /* time view: room IR + fit window + fitted model */
  {
    const { ctx: c, w, h } = sizeCanvas(els.d6t);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 12, mb = 24;
    const tmaxMs = 18;
    const X = tm => ml + tm / tmaxMs * (w - ml - mr);
    const Y = v => mt + (1 - (v + 1.15) / 2.3) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let tm = 0; tm <= tmaxMs; tm += 3) {
      const px = X(tm);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(tm + (tm === tmaxMs ? ' ms' : ''), px, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(v)); c.lineTo(w - mr, Y(v)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, Y(v));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    // fit-window shading
    c.fillStyle = 'rgba(77,163,255,0.10)';
    c.fillRect(X(t0ms), mt, X(t1ms) - X(t0ms), h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    // measured room IR
    c.beginPath();
    for (let n = 0; n < irSlow.length && n / FS * 1000 <= tmaxMs; n++) {
      const px = X(n / FS * 1000), py = Y(irSlow[n]);
      n ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.strokeStyle = '#8a95a6'; c.lineWidth = 1.1; c.stroke();
    // fitted model inside the window + envelope
    c.beginPath();
    for (let n = fit.n0; n <= fit.n1; n++) {
      const px = X(n / FS * 1000), py = Y(modelAt(fit, n));
      n > fit.n0 ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.strokeStyle = '#ff9f43'; c.lineWidth = 1.8; c.stroke();
    c.setLineDash([5, 4]); c.strokeStyle = '#ff9f43'; c.lineWidth = 1;
    for (const s of [1, -1]) {
      c.beginPath();
      for (let n = fit.n0; n <= fit.n1; n++) {
        const tRel = (n - fit.n0) / FS;
        const ev = s * fit.amp * Math.exp(-tRel / fit.tau);
        n > fit.n0 ? c.lineTo(X(n / FS * 1000), Y(ev)) : c.moveTo(X(n / FS * 1000), Y(ev));
      }
      c.stroke();
    }
    c.setLineDash([]);
    // reflection marker
    c.setLineDash([5, 4]); c.strokeStyle = '#ff6b6b';
    c.beginPath(); c.moveTo(X(14), mt); c.lineTo(X(14), h - mb); c.stroke(); c.setLineDash([]);
    c.restore();
    c.fillStyle = '#ff6b6b'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText('reflection 14 ms', X(14) + 4, mt + 16);
    c.fillStyle = '#93a0b4';
    c.fillText('measured room IR (grey) \u00b7 fit window (shaded) \u00b7 fitted damped sinusoid (orange)', ml + 6, mt + 2);
  }

  /* spectrum of the fit window */
  {
    const { ctx: c, w, h } = sizeCanvas(els.d6s);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 14, mt = 12, mb = 24;
    const X = f => ml + (f - 20) / (300 - 20) * (w - ml - mr);
    const Y = db => mt + (1 - (db + 60) / 60) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let f = 50; f <= 300; f += 50) {
      const px = X(f);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(f), px, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = 0; db >= -60; db -= 20) {
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, Y(db)); c.lineTo(w - mr, Y(db)); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ml - 5, Y(db));
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    c.beginPath();
    for (let i = 0; i < fit.fr.length; i++) {
      i ? c.lineTo(X(fit.fr[i]), Y(fit.winDb[i])) : c.moveTo(X(fit.fr[i]), Y(fit.winDb[i]));
    }
    c.strokeStyle = '#3ecf8e'; c.lineWidth = 1.8; c.stroke();
    // naive peak-pick marker vs the fitted f0
    c.fillStyle = '#8a95a6';
    c.beginPath(); c.arc(X(fit.naivePk), Y(fit.winDb[nearestIdx(fit.fr, fit.naivePk)]), 4, 0, 6.2832); c.fill();
    c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`naive peak-pick: ${fit.naivePk.toFixed(0)} Hz`, Math.min(X(fit.naivePk) + 7, w - 130), mt + 30);
    c.setLineDash([5, 4]); c.strokeStyle = '#e05c5c';
    c.beginPath(); c.moveTo(X(fit.f0), mt); c.lineTo(X(fit.f0), h - mb); c.stroke(); c.setLineDash([]);
    c.restore();
    c.fillStyle = '#e05c5c'; c.textAlign = 'left'; c.textBaseline = 'top';
    c.fillText(`fitted f\u2080 = ${fit.f0.toFixed(1)} Hz`, X(fit.f0) + 5, mt + 16);
    c.fillStyle = '#93a0b4';
    c.fillText('spectrum of the fit window \u2014 no clean peak: f\u2080 must be fitted, not peak-picked', ml + 6, mt + 2);
  }

  const good = fit.r2 >= 0.98;
  els.d6fit.innerHTML =
    `Fitted from the window: f\u2080 = <b>${fit.f0.toFixed(1)} Hz</b>, \u03c4 = <b>${(fit.tau * 1000).toFixed(1)} ms</b>, ` +
    `amplitude <b>${fit.amp.toFixed(2)}</b>, fit quality R\u00b2 = <b>${fit.r2.toFixed(3)}</b>. ` +
    `(True values for this synthetic speaker: 68 Hz, 11.0 ms.) ` +
    (good
      ? `<span class="ok">\u2713 The window is a clean single decay \u2014 the model is trustworthy and Step 2 will work.</span>`
      : `<span class="warn">\u26a0 Low R\u00b2: the window is not one clean decay (direct sound, other modes, or too short). ` +
        `The fitted \u03c4 drifts and Step 2 will synthesize confident nonsense.</span>`);
}

function drawDemo6() {
  const fit = getFit();
  const T = state6.T;
  const spliceMs = fit.n1 / FS * 1000;
  const gatedDb = spectrumDb(gate(irSlow, spliceMs), GRID);
  const extDb = spectrumDb(extendIR(irSlow, fit, T), GRID);
  const truth = getTruth6();
  const [lo, hi] = autoRange([truth, gatedDb, extDb], { maxSpan: 80 });
  const p = plots.d6;
  p.setRange(lo, hi); p.frame();
  p.curve(GRID, gatedDb, { color: '#8a95a6', width: 1.6 });
  p.curve(GRID, truth, { color: '#e8edf4', width: 1.3, dash: [7, 5] });
  p.curve(GRID, extDb, { color: '#4da3ff', width: 2.2 });
  p.vline(1000 / T, { color: '#e05c5c', label: `1/T = ${(1000 / T).toFixed(0)} Hz` });
  const i68 = nearestIdx(GRID, 68);
  const errExt = Math.abs(extDb[i68] - truth[i68]);
  const errGated = Math.abs(gatedDb[i68] - truth[i68]);
  els.r6.innerHTML =
    `Effective gate <b>${T} ms</b> (real data to ${spliceMs.toFixed(1)} ms, then model) \u2192 resolution \u2248 ` +
    `<b>${(1000 / T).toFixed(0)} Hz</b>. Bass error at 68 Hz: <b>${errExt.toFixed(1)} dB</b> with the fitted tail, versus ` +
    `${errGated.toFixed(1)} dB for real data alone. ` +
    (fit.r2 >= 0.98
      ? (errExt < 0.5
          ? `<span class="ok">\u2713 The fitted tail has essentially recovered the bass.</span>`
          : `Extend the gate further and the blue curve keeps converging onto the dashed truth.`)
      : `<span class="warn">\u26a0 Fit quality is low (R\u00b2 = ${fit.r2.toFixed(2)}) \u2014 the blue curve is converging to a wrong bass. Fix the fit window in Step 1.</span>`);
}

/* ----------------------- Measurement Planner ------------------------ */
/* The synthesis skill: the gate the speaker needs vs the gate the room
   allows. A resonance at f0 with Q has amplitude decay time
   tau = Q/(pi f0); reaching -D dB takes tau * D/8.686. The room caps the
   gate at the first-reflection delay -> resolution floor 1/T.           */

const stateP = { f0: parseFloat(els.pf0.value), Q: parseFloat(els.pQ.value), dB: parseFloat(els.pdB.value), tRefl: parseFloat(els.ptRefl.value) };
const DB_PER_TAU = 20 / Math.log(10); // 8.686 dB of amplitude decay per tau

function drawPlannerDecay(tau, Tneed, Tallow, dBtarget) {
  const { ctx: c, w, h } = sizeCanvas(els.cp1);
  c.clearRect(0, 0, w, h);
  const ml = 44, mr = 14, mt = 10, mb = 26;
  const tmax = Math.max(Tneed, Tallow) * 1.12 + 1e-9;
  const ymin = -(dBtarget + 8);
  const X = t => ml + t / tmax * (w - ml - mr);
  const Y = db => mt + (db / ymin) * (h - mt - mb); // 0 dB at top, ymin at bottom
  c.font = '11px system-ui'; c.lineWidth = 1;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const st = niceStep(tmax / 5);
  for (let t = 0; t <= tmax + 1e-9; t += st) {
    const x = X(t);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke();
    c.fillStyle = '#7d8899';
    c.fillText(t >= 1000 ? (t / 1000).toFixed(1) + ' s' : String(Math.round(t)), x, h - mb + 6);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  const yst = dBtarget > 45 ? 20 : 10;
  for (let db = 0; db >= ymin; db -= yst) {
    const y = Y(db);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(db), ml - 5, y);
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  // usable region + envelope
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  c.fillStyle = 'rgba(62,207,142,0.07)';
  c.fillRect(X(0), mt, X(Math.min(Tallow, tmax)) - X(0), h - mt - mb);
  c.beginPath();
  for (let i = 0; i <= 300; i++) {
    const t = tmax * i / 300, db = Math.max(ymin, -DB_PER_TAU * t / tau);
    i ? c.lineTo(X(t), Y(db)) : c.moveTo(X(t), Y(db));
  }
  c.strokeStyle = '#4da3ff'; c.lineWidth = 2; c.stroke();
  // markers
  c.setLineDash([5, 4]);
  c.strokeStyle = '#ff6b6b';
  c.beginPath(); c.moveTo(X(Tallow), mt); c.lineTo(X(Tallow), h - mb); c.stroke();
  c.strokeStyle = '#3ecf8e';
  c.beginPath(); c.moveTo(X(Math.min(Tneed, tmax)), mt); c.lineTo(X(Math.min(Tneed, tmax)), h - mb); c.stroke();
  c.setLineDash([]);
  c.restore();
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillStyle = '#ff6b6b';
  c.fillText(`reflection ${Tallow.toFixed(1)} ms`, X(Tallow) + 5, mt + 4);
  c.fillStyle = '#3ecf8e';
  c.fillText(Tneed <= tmax ? `gate needed ${Tneed.toFixed(0)} ms` : `gate needed ${Tneed.toFixed(0)} ms (off scale)`,
    Math.min(X(Math.min(Tneed, tmax)) + 5, w - 170), mt + 18);
  c.fillStyle = '#93a0b4';
  c.fillText('resonance decay envelope, dB vs time', ml + 6, mt + 4);
}

function drawPlannerQ(kNeed, Tallow, f0, Q) {
  const { ctx: c, w, h } = sizeCanvas(els.cp2);
  c.clearRect(0, 0, w, h);
  const ml = 44, mr = 14, mt = 10, mb = 26;
  const fmin = 20, fmax = 4000, qmax = 30;
  const X = f => ml + Math.log10(f / fmin) / Math.log10(fmax / fmin) * (w - ml - mr);
  const Y = q => mt + (1 - q / qmax) * (h - mt - mb);
  c.font = '11px system-ui'; c.lineWidth = 1;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const fT = [20, 50, 100, 200, 500, 1000, 2000, 4000];
  const fL = ['20', '50', '100', '200', '500', '1k', '2k', '4k'];
  for (let i = 0; i < fT.length; i++) {
    const x = X(fT[i]);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(x, mt); c.lineTo(x, h - mb); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(fL[i], x, h - mb + 6);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let q = 0; q <= qmax; q += 10) {
    const y = Y(q);
    c.strokeStyle = '#232c38';
    c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
    c.fillStyle = '#7d8899'; c.fillText(String(q), ml - 5, y);
  }
  c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
  c.save();
  c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
  // Qmax(f) = pi * f * Tallow / kNeed  (f in Hz, Tallow in s)
  c.beginPath();
  for (let i = 0; i <= 300; i++) {
    const f = fmin * Math.pow(fmax / fmin, i / 300);
    const q = Math.PI * f * (Tallow / 1000) / kNeed;
    i ? c.lineTo(X(f), Y(q)) : c.moveTo(X(f), Y(q));
  }
  c.strokeStyle = '#ff9f43'; c.lineWidth = 2; c.stroke();
  // operating point
  const px = X(Math.min(Math.max(f0, fmin), fmax)), py = Y(Math.min(Q, qmax));
  c.fillStyle = '#4da3ff';
  c.beginPath(); c.arc(px, py, 5, 0, 6.2832); c.fill();
  c.restore();
  c.textAlign = 'left'; c.textBaseline = 'top';
  c.fillStyle = '#4da3ff';
  c.fillText(`your resonance (${f0} Hz, Q = ${Q})`, Math.min(px + 8, w - 150), Math.max(mt + 2, py - 18));
  c.fillStyle = '#93a0b4';
  c.fillText(`maximum fully-resolvable Q vs frequency (room limit, T = ${Tallow.toFixed(1)} ms) \u2014 below the curve: resolvable`, ml + 6, mt + 4);
}

function drawPlanner() {
  const { f0, Q, dB, tRefl } = stateP;
  const tau = Q / (Math.PI * f0) * 1000;         // ms
  const kNeed = dB / DB_PER_TAU;                  // how many taus the target needs
  const Tneed = tau * kNeed;                      // ms
  const Tallow = tRefl;                           // ms
  const floorHz = 1000 / Tallow;
  const levelAtCap = -DB_PER_TAU * Tallow / tau;  // dB still remaining at the reflection
  const eRem = Math.exp(-2 * Tallow / tau) * 100; // % of energy left
  const width = f0 / Q;                           // resonance width, Hz
  drawPlannerDecay(tau, Tneed, Tallow, dB);
  drawPlannerQ(kNeed, Tallow, f0, Q);
  let verdict;
  if (Tneed <= Tallow) {
    verdict = `<span class="ok">\u2713 Feasible in-room:</span> the resonance decays to \u2212${dB} dB in ` +
      `<b>${Tneed.toFixed(0)} ms</b>, before the reflection at ${Tallow.toFixed(1)} ms. Gate with \u2248 ` +
      `${Tneed.toFixed(0)} ms \u2192 resolution 1/T \u2248 <b>${(1000 / Tneed).toFixed(1)} Hz</b>, comfortably finer ` +
      `than the ${width.toFixed(1)} Hz-wide feature. A clean gated measurement.`;
  } else {
    verdict = `<span class="warn">\u2717 Not resolvable in this room:</span> decay to \u2212${dB} dB needs ` +
      `<b>${Tneed.toFixed(0)} ms</b>, but the reflection caps the gate at <b>${Tallow.toFixed(1)} ms</b>. When the gate ` +
      `closes, the resonance is still at <b>${levelAtCap.toFixed(0)} dB</b> (${eRem < 1 ? eRem.toFixed(1) : eRem.toFixed(0)} % of its energy remaining) \u2014 ` +
      `the ${f0} Hz, Q&nbsp;=&nbsp;${Q} feature gets smeared by the \u2248 ${floorHz.toFixed(0)} Hz-wide window kernel. ` +
      `<span class="hl">Measure it nearfield or ground-plane and splice, or extend the tail model-based.</span>`;
  }
  els.rp.innerHTML = verdict +
    `<br>Best resolution this room allows at all: <b>${floorHz.toFixed(0)} Hz</b> (= 1/T of the longest clean gate).`;
}

/* ------------------- predictions + quiz (retrieval) ------------------ */

const PREDICTS = {
  p1: {
    opts: ['Exactly on the grey curve \u2014 they are exact values',
           'Only near it \u2014 padding is an interpolation/approximation'],
    correct: 0,
    why: 'Zero-padding evaluates the very same DTFT (the same polynomial in e<sup>\u2212j2\u03c0f/fs</sup>) at more points. Every new point is exact for the 5 ms of data \u2014 nothing is interpolated, and nothing new is invented.',
  },
  p3: {
    opts: ['Still \u2248 15 Hz \u2014 the resonance is a property of the speaker',
           `\u2248 ${Math.round(1000 / parseFloat(els.t3.value))} Hz wide \u2014 smeared to the window\u2019s 1/T`,
           '\u2248 1 kHz wide \u2014 set by the sampling rate'],
    correct: 1,
    why: `The gated spectrum is the true spectrum convolved with the window\u2019s kernel; the rectangular main lobe is 1/T = 1/${parseFloat(els.t3.value)} ms = ${Math.round(1000 / parseFloat(els.t3.value))} Hz wide, so any finer detail \u2014 like the 15 Hz resonance \u2014 is broadened to that width and lowered. Scroll down to the kernel plot to see why.`,
  },
};

function renderPredict(id) {
  const def = PREDICTS[id], box = els[id];
  box.innerHTML = '';
  if (box.dataset) delete box.dataset.done;
  def.opts.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'padbtn';
    b.textContent = opt;
    b.addEventListener('click', () => {
      if (box.dataset && box.dataset.done) return;
      if (box.dataset) box.dataset.done = '1';
      const ok = i === def.correct;
      b.classList.add(ok ? 'qgood' : 'qbad');
      if (!ok && box.children && box.children[def.correct]) box.children[def.correct].classList.add('qgood');
      const why = els[id + 'why'];
      why.style.display = 'block';
      why.innerHTML = `<b class="${ok ? 'ok' : 'warn'}">${ok ? '\u2713 Right.' : '\u2717 Not quite.'}</b> ${def.why}`;
    });
    box.appendChild(b);
  });
}

const QUIZ = [
  { q: 'Zero-padding improves the true frequency resolution of a gated measurement.', a: false,
    why: 'Resolution is set by the gate length (\u2248 1/T). Padding only samples the already-determined spectrum more densely \u2014 it recovers nothing the gate threw away.' },
  { q: 'A 5 ms gate can clearly resolve a spectral feature 50 Hz wide.', a: false,
    why: '1/T = 1/0.005 s = 200 Hz. Anything narrower than \u2248 200 Hz is smeared together; a 50 Hz feature is far below that limit.' },
  { q: 'If a gate turned out too short, you can fix the result by zero-padding harder.', a: false,
    why: 'Truncation is smoothing \u2014 an irreversible loss. Padding can never undo it; only a longer gate (or another method) can.' },
  { q: 'A rectangular gate and a half-Hann gate of the same length have the same main-lobe width.', a: false,
    why: 'The taper lowers the sidelobes but widens the main lobe to \u2248 2/T \u2014 twice the smearing of the rectangular gate. That is the trade.' },
  { q: 'If the measured response looks smooth, the measurement resolved it.', a: false,
    why: 'Smoothness can be the <i>result</i> of smearing (Demo 3). The objective check is convergence: grow the gate and see whether the curve still changes (Demo 2).' },
  { q: 'Longer gates are always better.', a: false,
    why: 'Past the first reflection the response is comb-filtered (slide Demo 2 beyond 14 ms), and long gates also admit noise. Lengthen the gate only while the IR decays and no reflection has arrived.' },
  { q: 'If the IR has fully decayed inside the gate, lengthening the gate further does not change the spectrum.', a: true,
    why: 'The gate multiplies all significant data by 1, and convolving with the window\u2019s spectrum then changes nothing. That is the definition of a sufficient gate \u2014 “short in time means smooth in frequency”, so nothing was lost.' },
  { q: 'If the gate is too short, at least the values at exact multiples of 1/T (for a 5 ms gate: 200, 400, 600 Hz\u2026) are still accurate.', a: false,
    why: 'Truncation convolves the whole true spectrum with the window\u2019s kernel \u2014 a fixed-width smoothing applied across the entire range. The resulting error lands on every frequency, including the bin centers; being a multiple of 1/T gives a point no special accuracy.' },
  { q: 'Below 1/T, a gated measurement tells us nothing.', a: false,
    why: 'It still gives the window-smoothed best estimate \u2014 just with an uncertainty attached. Report the curve plus the band of remaining change (Demo 4); a dotted void or a fake extrapolation are both worse.' },
];

let quizScore = 0, quizAnswered = 0;
function updateScore() {
  els.qzscore.textContent = quizAnswered
    ? `Score so far: ${quizScore} correct of ${quizAnswered} answered (${QUIZ.length} total).`
    : '';
}
function renderQuiz() {
  const box = els.quiz;
  box.innerHTML = '';
  quizScore = 0; quizAnswered = 0; updateScore();
  QUIZ.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'qz';
    div.innerHTML = `<div class="qtext">${i + 1}. ${item.q}</div>` +
      `<div class="qbtns"><button class="padbtn">True</button><button class="padbtn">False</button></div>` +
      `<div class="qwhy"></div>`;
    const btns = div.querySelectorAll ? div.querySelectorAll('button') : [];
    btns.forEach((b, bi) => {
      b.addEventListener('click', () => {
        if (div.dataset && div.dataset.done) return;
        if (div.dataset) div.dataset.done = '1';
        quizAnswered++;
        const ok = (bi === 0) === item.a;
        if (ok) { quizScore++; b.classList.add('qgood'); }
        else { b.classList.add('qbad'); btns[item.a ? 0 : 1].classList.add('qgood'); }
        const why = div.querySelector ? div.querySelector('.qwhy') : null;
        if (why) {
          why.style.display = 'block';
          why.innerHTML = `<b class="${ok ? 'ok' : 'warn'}">${ok ? '\u2713 Correct.' : '\u2717 Not quite.'}</b> ${item.why}`;
        }
        updateScore();
      });
    });
    box.appendChild(div);
  });
}

/* ------------------------- wiring + redraw --------------------------- */

[1, 2, 4, 8, 16, 64].forEach(P => {
  const b = document.createElement('button');
  b.className = 'padbtn';
  b.textContent = P + '\u00d7';
  if (P === state1.P) b.classList.add('active');
  b.onclick = () => {
    state1.P = P;
    document.querySelectorAll('.padbtn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    drawDemo1();
  };
  els.padBtns.appendChild(b);
});

const throttledA = rafThrottle(drawPartA);
els.dsAf.addEventListener('input', () => {
  stateA.f = parseFloat(els.dsAf.value);
  els.dsAfV.textContent = stateA.f + ' Hz';
  throttledA();
});
els.dsAtau.addEventListener('input', () => {
  stateA.tau = parseFloat(els.dsAtau.value);
  els.dsAtauV.textContent = stateA.tau.toFixed(1) + ' ms';
  throttledA();
});
buildDSTable();

const throttled0 = rafThrottle(drawDemo0);
els.s0.addEventListener('input', () => {
  state0.sig = parseFloat(els.s0.value);
  els.s0v.textContent = state0.sig.toFixed(2) + ' ms';
  throttled0();
});

const throttled2 = rafThrottle(drawDemo2);
const throttled3 = rafThrottle(drawDemo3);
const throttled4 = rafThrottle(drawDemo4);

els.t2.addEventListener('input', () => {
  state2.T = parseFloat(els.t2.value);
  els.t2v.textContent = state2.T.toFixed(2) + ' ms';
  throttled2();
});
els.win2.addEventListener('change', () => { state2.win = els.win2.value; drawDemo2(); });
els.ghosts2.addEventListener('change', () => { state2.ghosts = els.ghosts2.checked; drawDemo2(); });
els.t3.addEventListener('input', () => {
  state3.T = parseFloat(els.t3.value);
  els.t3v.textContent = state3.T + ' ms';
  throttled3();
});
els.win3.addEventListener('change', () => { state3.win = els.win3.value; drawDemo3(); });
els.t4.addEventListener('input', () => {
  state4.Tmax = parseFloat(els.t4.value);
  els.t4v.textContent = state4.Tmax.toFixed(2) + ' ms';
  throttled4();
});

const throttled5 = rafThrottle(drawDemo5);
els.s5.addEventListener('input', () => {
  state5.beta = parseFloat(els.s5.value);
  els.s5v.textContent = state5.beta.toFixed(1);
  throttled5();
});
els.s5t.addEventListener('input', () => {
  state5.T = parseFloat(els.s5t.value);
  els.s5tV.textContent = state5.T.toFixed(1) + ' ms';
  throttled5();
});

const throttled6 = rafThrottle(() => drawDemo6());
const throttled6all = rafThrottle(() => { drawDemo6Fit(); drawDemo6(); });
els.t6.addEventListener('input', () => {
  state6.T = parseFloat(els.t6.value);
  els.t6v.textContent = state6.T + ' ms';
  throttled6();
});
els.d6fs.addEventListener('input', () => {
  let v = parseFloat(els.d6fs.value);
  if (v > state6.fitEnd - 0.5) { v = state6.fitEnd - 0.5; els.d6fs.value = String(v); }
  state6.fitStart = v;
  els.d6fsV.textContent = v.toFixed(2) + ' ms';
  invalidateFit();
  throttled6all();
});
els.d6fe.addEventListener('input', () => {
  let v = parseFloat(els.d6fe.value);
  if (v < state6.fitStart + 0.5) { v = state6.fitStart + 0.5; els.d6fe.value = String(v); }
  state6.fitEnd = v;
  els.d6feV.textContent = v.toFixed(2) + ' ms';
  invalidateFit();
  throttled6all();
});

const throttledP = rafThrottle(drawPlanner);
els.pf0.addEventListener('input', () => {
  stateP.f0 = parseFloat(els.pf0.value);
  els.pf0v.textContent = stateP.f0 + ' Hz';
  throttledP();
});
els.pQ.addEventListener('input', () => {
  stateP.Q = parseFloat(els.pQ.value);
  els.pQv.textContent = String(stateP.Q);
  throttledP();
});
els.pdB.addEventListener('change', () => { stateP.dB = parseFloat(els.pdB.value); drawPlanner(); });
els.ptRefl.addEventListener('input', () => {
  stateP.tRefl = parseFloat(els.ptRefl.value);
  els.ptRefv.textContent = stateP.tRefl.toFixed(1) + ' ms';
  throttledP();
});
function updateBounce() {
  const d = parseFloat(els.pd.value), hs = parseFloat(els.phs.value), hm = parseFloat(els.phm.value);
  if (isFinite(d) && d > 0 && isFinite(hs) && hs >= 0 && isFinite(hm) && hm >= 0) {
    const ms = (Math.hypot(d, hs + hm) - Math.hypot(d, hs - hm)) / 343 * 1000;
    els.pbVal.textContent = ms.toFixed(1) + ' ms';
  } else els.pbVal.textContent = '\u2014';
}
['pd', 'phs', 'phm'].forEach(id => els[id].addEventListener('input', updateBounce));
els.pbApply.addEventListener('click', () => {
  const ms = parseFloat(els.pbVal.textContent);
  if (isFinite(ms)) {
    stateP.tRefl = Math.min(50, Math.max(2, Math.round(ms * 2) / 2));
    els.ptRefl.value = String(stateP.tRefl);
    els.ptRefv.textContent = stateP.tRefl.toFixed(1) + ' ms';
    drawPlanner();
  }
});
updateBounce();

/* ---- direct manipulation: drag markers on the plots ------------------
   The gate length can be dragged where it is drawn: the red 1/T line on
   the frequency plots, the kernel's first zero in Demo 3, and the gate
   edge in Demo 2's IR view. Dragging clamps/quantizes to the matching
   slider's own min/max/step and keeps slider, label and state in sync. */

function dragSet(inputEl, labelEl, fmt, raw, apply) {
  const min = parseFloat(inputEl.min), max = parseFloat(inputEl.max);
  const step = parseFloat(inputEl.step);
  let v = raw;
  if (isFinite(min) && isFinite(max)) {
    v = Math.min(max, Math.max(min, v));
    if (isFinite(step) && step > 0) v = Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  }
  inputEl.value = String(v);
  labelEl.textContent = fmt(v);
  apply(v);
}

function makeDraggable(cv, getX, onDrag) {
  const tol = 14;
  let dragging = false;
  cv.style.touchAction = 'none';
  const px = e => e.clientX - cv.getBoundingClientRect().left;
  cv.addEventListener('pointerdown', e => {
    if (Math.abs(px(e) - getX()) > tol) return;
    dragging = true;
    if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
    onDrag(px(e));
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    const x = px(e);
    if (dragging) onDrag(x);
    else cv.style.cursor = Math.abs(x - getX()) <= tol ? 'ew-resize' : '';
  });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });
}

// demo 2: the 1/T line on the FR plot, or the gate edge on the IR plot
makeDraggable(els.c2, () => plots.d2.X(1000 / state2.T), x => {
  dragSet(els.t2, els.t2v, v => v.toFixed(2) + ' ms', 1000 / plots.d2.freqAt(x),
    v => { state2.T = v; throttled2(); });
});
makeDraggable(els.c2ir, () => plots.ir.X(Math.min(state2.T, plots.ir.tmax)), x => {
  dragSet(els.t2, els.t2v, v => v.toFixed(2) + ' ms', plots.ir.msAt(x),
    v => { state2.T = v; throttled2(); });
});
// demo 3: the 1/T line on the FR plot and the kernel's first zero
makeDraggable(els.c3, () => plots.d3.X(1000 / state3.T), x => {
  dragSet(els.t3, els.t3v, v => v + ' ms', 1000 / plots.d3.freqAt(x),
    v => { state3.T = v; throttled3(); });
});
makeDraggable(els.c3k, () => 40 + 0.25 * (els.c3k.getBoundingClientRect().width - 54), x => {
  const w = els.c3k.getBoundingClientRect().width;
  const f = Math.max(1e-6, (x - 40) / (w - 54) * (4000 / state3.T));
  dragSet(els.t3, els.t3v, v => v + ' ms', 1000 / f,
    v => { state3.T = v; throttled3(); });
});
// demo 4: the 1/Tmax line
makeDraggable(els.c4, () => plots.d4.X(1000 / state4.Tmax), x => {
  dragSet(els.t4, els.t4v, v => v.toFixed(2) + ' ms', 1000 / plots.d4.freqAt(x),
    v => { state4.Tmax = v; throttled4(); });
});
// demo 6: the 1/T line of the effective gate
makeDraggable(els.c6, () => plots.d6.X(1000 / state6.T), x => {
  dragSet(els.t6, els.t6v, v => v + ' ms', 1000 / plots.d6.freqAt(x),
    v => { state6.T = v; throttled6(); });
});

renderPredict('p1');
renderPredict('p3');
renderQuiz();
els.qzreset.addEventListener('click', renderQuiz);

function drawAll() { drawPartA(); drawPartB(); drawDemo0(); drawDemo1(); drawDemo2(); drawDemo3(); drawDemo4(); drawDemo5(); drawDemo6Fit(); drawDemo6(); drawPlanner(); }

let rsz = null;
window.addEventListener('resize', () => {
  clearTimeout(rsz);
  rsz = setTimeout(() => {
    for (const k in plots) plots[k].setSize();
    drawAll();
  }, 150);
});

drawAll();

// Prevent the browser's default "scroll the focused element into view" from
// jumping the page when a control is first clicked/focused (e.g. the planner
// sliders). We snapshot the scroll position on pointerdown and, if that
// pointer interaction focused a control, restore the snapshot next frame so
// the page never moves. Keyboard/tab focus is left untouched.
{
  let restorePos = null;
  window.addEventListener('pointerdown', () => {
    restorePos = { x: window.scrollX, y: window.scrollY };
  }, true);
  document.addEventListener('focusin', (e) => {
    if (!restorePos) return;
    const pos = restorePos;
    restorePos = null;
    const t = e.target;
    if (t !== document.activeElement) return;
    requestAnimationFrame(() => {
      if (document.activeElement === t) window.scrollTo(pos.x, pos.y);
    });
  });
}

// minimal hook for headless tests (no-op in the browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DS_MODES, drawPartB, stateA, drawPartA };
}
