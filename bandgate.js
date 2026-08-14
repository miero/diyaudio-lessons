'use strict';
/* =====================================================================
   Extending the gate with a narrow bandpass bank — an evaluation of an
   alternative to Demo 6's tail fit (gating.html).

   The idea under test:
     1. send the gated room IR through very narrow bandpass filters;
     2. in each band the gated record shows an "unnatural" decay — the
        filter's own ring-out once the gate ends;
     3. fit the band's TRUE decay (assumed exponential = one damped
        sinusoid per band) on the part that is still uncontaminated;
     4. a dense (perfect-reconstruction) bank of such bands rebuilds the
        whole response.

   Implementation notes:
     - bands are zero-phase Gaussian bandpasses in frequency,
       H_c(f) = exp(-(f-fc)^2 / 2 sigmaF^2) (+ mirror at -fc so real
       signals stay real). Analysis divides by the overlap sum
       S(f) = sum_c H_c(f), so sum_c band_c == gated data EXACTLY
       (perfect reconstruction) whenever the bank is dense enough.
     - sigma_t = 1/(2 pi sigmaF) is the filter's memory (its kernel's
       e-folding time in time): band output at time t needs ~2-3 sigma_t
       of data on BOTH sides of t. Data removed by the gate contaminates
       the band from about T - c*sigma_t onward.
     - spectra again by direct DTFT (== zero-padded FFT), fs = 48 kHz.
   ===================================================================== */

const FS = 48000, FMIN = 20, FMAX = 20000;

/* ------------------------- synthetic IRs ---------------------------- */
/* Identical "Demo 6 speaker" as gating.html: fast mid/treble modes plus
   one slow 68 Hz port-like tail (tau = 11 ms) and a floor reflection at
   14 ms. Two-tails adds a SECOND overlapping bass decay (130 Hz, 5 ms) —
   the case a single global tail fit cannot describe.                   */

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

function fastDecayIR() {
  const x = new Float64Array(Math.round(5e-3 * FS));
  addModes(x, FAST_MODES);
  x[0] += 1.3;
  return normalize(x);
}

const SLOW_MODES = [[420, 0.75e-3, 0.90], [1150, 0.60e-3, 0.55],
                    [2900, 0.50e-3, 0.35], [6400, 0.35e-3, 0.15]];

/* one slow tail: [f0, tau_s, amplitude, start_s] */
const TAIL_ONE = [[68, 11e-3, 0.35, 0.4e-3]];
const TAIL_TWO = [[60, 11e-3, 0.35, 0.4e-3], [130, 5e-3, 0.30, 0.2e-3]];

function roomIR(tails, reflection, dur = 0.040) {
  const x = new Float64Array(Math.round(dur * FS));
  addModes(x, SLOW_MODES);
  x[0] += 1.2;
  for (const [f0, tau, a, t0] of tails) {
    const n0 = Math.round(t0 * FS);
    const w = 2 * Math.PI * f0 / FS, d = 1 / (tau * FS);
    for (let n = n0; n < x.length; n++) x[n] += a * Math.exp(-(n - n0) * d) * Math.cos(w * (n - n0));
  }
  if (reflection) {
    const fast = fastDecayIR(), rd = Math.round(14e-3 * FS);
    for (let n = 0; n < fast.length && rd + n < x.length; n++) x[rd + n] += 0.55 * fast[n];
  }
  return normalize(x);
}

/* --------------------- gating / spectrum machinery ------------------- */

function gate(x, Tms) {
  const N = Math.min(x.length, Math.max(2, Math.round(Tms * 1e-3 * FS)));
  return x.slice(0, N);
}

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

function nearestIdx(freqs, f) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < freqs.length; i++) {
    const d = Math.abs(freqs[i] - f);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}

/* ------------------------------ FFT ---------------------------------- */
/* Radix-2 iterative in-place FFT (the bank analysis needs it; the plots
   themselves still use direct DTFT as in gating.html).                 */

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

function fft(re, im, inv) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = 2 * Math.PI / len * (inv ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < N; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < half; k++) {
        const i0 = i + k, i1 = i0 + half;
        const vr = re[i1] * cwr - im[i1] * cwi;
        const vi = re[i1] * cwi + im[i1] * cwr;
        re[i1] = re[i0] - vr; im[i1] = im[i0] - vi;
        re[i0] += vr; im[i0] += vi;
        const nwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
  if (inv) for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
}

/* --------------------------- plot helpers ---------------------------- */

const ML = 48, MR = 34, MT = 20, MB = 26;

function sizeCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  cv.width = Math.max(2, Math.round(r.width * dpr));
  cv.height = Math.max(2, Math.round(r.height * dpr));
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

/* log-frequency / dB plot (same class as gating.html) */
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
    const fL = ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k Hz'];
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
    c.fillStyle = '#7d8899'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('dB', ML - 6, MT - 4);
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

/* linear-time / dB plot (impulse-response & envelope views) */
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
    c.fillStyle = '#7d8899'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('dB', ML - 6, MT - 4);
    c.strokeStyle = '#39434f';
    c.strokeRect(ML, MT, w - ML - MR, h - MT - MB);
  }
  clip() {
    const c = this.ctx;
    c.save(); c.beginPath();
    c.rect(ML, MT, this.w - ML - MR, this.h - MT - MB); c.clip();
  }
  curveMs(tMs, db, { color = '#4da3ff', width = 1.8, dash = null, alpha = 1 } = {}) {
    const c = this.ctx;
    this.clip();
    c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width;
    c.setLineDash(dash || []);
    c.beginPath();
    const lo = this.ymin - 20, hi = this.ymax + 20;
    for (let i = 0; i < tMs.length; i++) {
      let v = db[i]; if (v < lo) v = lo; if (v > hi) v = hi;
      const x = this.X(tMs[i]), y = this.Y(v);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
    c.setLineDash([]); c.globalAlpha = 1; c.restore();
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

/* --------------------- bandpass bank machinery ----------------------- */

/* One zero-phase Gaussian bandpass applied to x (via FFT). Returns the
   real band signal on [0, nOut). sigmaF = bandwidth parameter (Hz).   */
function singleBand(x, fc, sigmaF, nOut) {
  const N = nextPow2(Math.max(x.length, nOut));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let n = 0; n < x.length; n++) re[n] = x[n];
  fft(re, im, false);
  const inv2s2 = 1 / (2 * sigmaF * sigmaF);
  for (let k = 0; k < N; k++) {
    const fk = (k <= N / 2 ? k : k - N) * FS / N;
    const H = Math.exp(-(fk - fc) * (fk - fc) * inv2s2) + Math.exp(-(fk + fc) * (fk + fc) * inv2s2);
    re[k] *= H; im[k] *= H;
  }
  fft(re, im, true);
  return re.slice(0, Math.min(nOut, N));
}

/* running-max envelope in dB (window ~ half a period at fc) */
function envelopeDb(x, fc) {
  const win = Math.max(4, Math.round(FS / (2 * fc)));
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

/* Fit ONE band segment. The model is the filter-inclusive one:
     band signal ~= bandpass applied to a one-sided damped sinusoid
     m(t) = u(t) e^(-t/tau) (A cos 2 pi f t + B sin 2 pi f t)
   i.e. the fit synthesizes IFFT{ H_c(f) * M(f) } and least-squares it
   against the data. This matters: a narrow band's output is NOT the raw
   mode — it is the mode convolved with the filter kernel (the onset
   transient included), and fitting a bare damped sinusoid to it biases
   the parameters. M(f) is analytic (two Lorentzians), H_c is concentrated
   on a few bins around fc, so each candidate (f, tau) is synthesized by a
   SPARSE inverse DTFT over those bins only — fast enough to sweep.
   The fit samples are decimated x3 (bass only) and nA is the absolute
   sample offset of the segment start (for the synthesis phases).        */
function fitBand(seg, nA, fc, sigmaF, N = 2048) {
  const W = seg.length;
  const idx = [];
  for (let i = 0; i < W; i += 3) idx.push(i);
  const M2 = idx.length;
  const ns = idx.map(i => nA + i);
  const kc = Math.round(fc * N / FS);
  const K = Math.max(2, Math.ceil(3.5 * sigmaF * N / FS));
  const bins = [];
  for (let k = Math.max(0, kc - K); k <= kc + K; k++) bins.push(k);
  const fk = bins.map(k => k * FS / N);
  const Hk = fk.map(f => Math.exp(-(f - fc) * (f - fc) / (2 * sigmaF * sigmaF)) +
                         Math.exp(-(f + fc) * (f + fc) / (2 * sigmaF * sigmaF)));
  const mir = bins.map(k => (k === 0) ? 1 : 2); // bin 0 is self-mirrored
  const Rc = bins.map(() => new Float64Array(M2));
  const Rs = bins.map(() => new Float64Array(M2));
  for (let b = 0; b < bins.length; b++) {
    const ph = 2 * Math.PI * bins[b] / N;
    for (let i = 0; i < M2; i++) {
      const a = ph * ns[i];
      Rc[b][i] = Math.cos(a); Rs[b][i] = Math.sin(a);
    }
  }
  const u = new Float64Array(M2), v = new Float64Array(M2);

  /* bases: y_model = A*u + B*v, with
     M(f) = (A-jB)/2 P1 + (A+jB)/2 P2,
     P1 = 1/(1/tau + j2pi(f-f0)),  P2 = 1/(1/tau + j2pi(f+f0))           */
  function synth(f0, tau) {
    const alpha = 1 / tau;
    u.fill(0); v.fill(0);
    for (let b = 0; b < bins.length; b++) {
      const f = fk[b];
      const b1 = 2 * Math.PI * (f - f0), b2 = 2 * Math.PI * (f + f0);
      const d1 = alpha * alpha + b1 * b1, d2 = alpha * alpha + b2 * b2;
      const p1r = alpha / d1, p1i = -b1 / d1;
      const p2r = alpha / d2, p2i = -b2 / d2;
      const Ur = FS * Hk[b] * 0.5 * (p1r + p2r), Ui = FS * Hk[b] * 0.5 * (p1i + p2i);
      const Vr = FS * Hk[b] * 0.5 * (p2i - p1i), Vi = FS * Hk[b] * 0.5 * (p1r - p2r);
      const sc = mir[b] / N;
      for (let i = 0; i < M2; i++) {
        u[i] += sc * (Ur * Rc[b][i] - Ui * Rs[b][i]);
        v[i] += sc * (Vr * Rc[b][i] - Vi * Rs[b][i]);
      }
    }
  }

  function solve(f0, tau) {
    synth(f0, tau);
    let s11 = 0, s12 = 0, s22 = 0, s1y = 0, s2y = 0;
    for (let i = 0; i < M2; i++) {
      s11 += u[i] * u[i]; s12 += u[i] * v[i]; s22 += v[i] * v[i];
      s1y += u[i] * seg[idx[i]]; s2y += v[i] * seg[idx[i]];
    }
    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-30) return { err: Infinity, A: 0, B: 0 };
    const A = (s22 * s1y - s12 * s2y) / det;
    const B = (s11 * s2y - s12 * s1y) / det;
    let err = 0;
    for (let i = 0; i < M2; i++) { const r = seg[idx[i]] - (A * u[i] + B * v[i]); err += r * r; }
    return { err, A, B };
  }

  function sweep(fLo, fHi, fStep, tauLo, tauHi, tauStep) {
    let best = { err: Infinity, f: fc, tau: 5e-3, A: 0, B: 0 };
    for (let f = fLo; f <= fHi + 1e-9; f += fStep)
      for (let tms = tauLo; tms <= tauHi + 1e-9; tms += tauStep) {
        const r = solve(f, tms * 1e-3);
        if (r.err < best.err) best = { err: r.err, f, tau: tms * 1e-3, A: r.A, B: r.B };
      }
    return best;
  }

  // coarse + refine; the refine must cover a full coarse cell (the window
  // is short, so the (f, tau) error surface is flat and grid gaps matter)
  const fr = Math.max(4, sigmaF * 0.8);
  const fStepC = Math.max(2, sigmaF / 4);
  const coarse = sweep(Math.max(15, fc - fr), fc + fr, fStepC, 1, 40, 2);
  const fine = sweep(coarse.f - fStepC, coarse.f + fStepC, 0.5,
                     Math.max(0.5, coarse.tau * 1000 - 2), coarse.tau * 1000 + 2, 0.25);
  const best = fine.err < coarse.err ? fine : coarse;

  let mean = 0;
  for (let i = 0; i < M2; i++) mean += seg[idx[i]];
  mean /= M2;
  let ssTot = 0;
  for (let i = 0; i < M2; i++) { const d = seg[idx[i]] - mean; ssTot += d * d; }
  const r2 = ssTot > 0 ? Math.max(0, 1 - best.err / ssTot) : 1;
  return { ...best, r2, amp: Math.hypot(best.A, best.B) };
}

/* The Demo-6-style GLOBAL single-pole fit for direct comparison
   (same fitter as gating.html: coarse-to-fine sweep over f in 40..160 Hz
   and tau in 3..30 ms).                                                */
function fitGlobal(x, n0, n1) {
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
  const coarse = sweep(40, 160, 4, 3, 30, 1);
  const fine = sweep(Math.max(30, coarse.f - 4), coarse.f + 4, 0.5,
                     Math.max(2, coarse.tau * 1000 - 1), coarse.tau * 1000 + 1, 0.1);
  const best = fine.err < coarse.err ? fine : coarse;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += seg[i];
  mean /= N;
  let ssTot = 0;
  for (let i = 0; i < N; i++) { const d = seg[i] - mean; ssTot += d * d; }
  const r2 = ssTot > 0 ? Math.max(0, 1 - best.err / ssTot) : 1;
  return { ...best, r2, n0, n1 };
}

/* The bank, split in two steps so interactive drags stay fast:
   bankAnalyze  — the expensive part (FFT analysis + per-band fits);
                  depends only on (which, sigmaF, spacing, T, tA, c), cached.
   bankSynthesize — build the extended IR from the cached fits for a given
                  effective gate Teff (cheap, runs on every slider tick).
   params: sigmaF (Hz), spacingFactor (band spacing = spacingFactor*sigmaF),
           Tgate (ms), tA (ms, fit start), cMargin (contamination margin in
           units of sigma_t), fLo, fHi.                                  */
let bankCache = null;
function bankAnalyze(which, params) {
  const key = [which, params.sigmaF, params.spacingFactor, params.Tgate, params.tA, params.cMargin].join('/');
  if (bankCache && bankCache.key === key) return bankCache;
  const irRoom = which === 'one' ? irRoomOne : irRoomTwo;
  const { sigmaF, spacingFactor, Tgate, tA, cMargin, fLo = 30, fHi = 300 } = params;
  const xGate = gate(irRoom, Tgate);
  // pad to >= 2048: the fit model synthesizes at N = 2048, and the padded
  // length also suppresses circular wrap-around of the still-decaying tail
  const N = nextPow2(Math.max(xGate.length, 2048));
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let n = 0; n < xGate.length; n++) re[n] = xGate[n];
  fft(re, im, false);

  const centers = [];
  for (let f = fLo; f <= fHi + 1e-9; f += sigmaF * spacingFactor) centers.push(f);

  // overlap sum S(f) = sum_c H_c(f)  (PR normalization)
  const S = new Float64Array(N);
  const inv2s2 = 1 / (2 * sigmaF * sigmaF);
  for (const fc of centers) {
    for (let k = 0; k < N; k++) {
      const fk = (k <= N / 2 ? k : k - N) * FS / N;
      S[k] += Math.exp(-(fk - fc) * (fk - fc) * inv2s2) + Math.exp(-(fk + fc) * (fk + fc) * inv2s2);
    }
  }

  const sigmaT = 1 / (2 * Math.PI * sigmaF);            // s
  const tB = Tgate * 1e-3 - cMargin * sigmaT;           // contamination start, s
  const nA = Math.round(tA * 1e-3 * FS), nB = Math.round(tB * FS);
  const minWin = Math.round(1.5e-3 * FS);
  const stats = {
    centers, sigmaTms: sigmaT * 1e3, tBms: tB * 1e3,
    nUsed: 0, nShort: 0, nSilent: 0, nWeak: 0, worstR2: 1,
  };
  const fits = [];

  if (nB - nA >= minWin) {
    let gpk = 0;
    for (let n = 0; n < xGate.length; n++) gpk = Math.max(gpk, Math.abs(xGate[n]));
    const bre = new Float64Array(N), bim = new Float64Array(N);
    for (const fc of centers) {
      for (let k = 0; k < N; k++) {
        const fk = (k <= N / 2 ? k : k - N) * FS / N;
        const H = Math.exp(-(fk - fc) * (fk - fc) * inv2s2) + Math.exp(-(fk + fc) * (fk + fc) * inv2s2);
        if (S[k] > 1e-3) { bre[k] = re[k] * H / S[k]; bim[k] = im[k] * H / S[k]; }
        else { bre[k] = 0; bim[k] = 0; }
      }
      fft(bre, bim, true);
      let rms = 0;
      for (let n = nA; n < nB; n++) rms += bre[n] * bre[n];
      rms = Math.sqrt(rms / (nB - nA));
      if (rms < 3e-3 * gpk) { stats.nSilent++; continue; }
      const fit = fitBand(bre.slice(nA, nB), nA, fc, sigmaF);
      if (fit.r2 < 0.95) { stats.nWeak++; continue; } // phantom guard
      fits.push({ fc, fit });
      stats.nUsed++;
      stats.worstR2 = Math.min(stats.worstR2, fit.r2);
    }
  } else {
    stats.nShort = centers.length; // no uncontaminated window at all
  }

  bankCache = { key, xGate, fits, stats, nA, nB };
  return bankCache;
}

function bankSynthesize(an, TeffMs) {
  const nT = Math.round(TeffMs * 1e-3 * FS);
  const xExt = new Float64Array(nT);
  for (let n = 0; n < Math.min(nT, an.xGate.length); n++) xExt[n] = an.xGate[n];
  if (an.fits.length > 0 && an.nB > 0) {
    // real (gated) data only up to the contamination start; past it the
    // per-band model tails take over
    for (let n = an.nB; n < Math.min(nT, an.xGate.length); n++) xExt[n] = 0;
    for (const { fit } of an.fits) {
      for (let n = Math.max(0, an.nB); n < nT; n++) {
        const tt = n / FS; // absolute time — the fits' A, B are absolute-time coefficients
        xExt[n] += Math.exp(-tt / fit.tau) * (fit.A * Math.cos(2 * Math.PI * fit.f * tt) + fit.B * Math.sin(2 * Math.PI * fit.f * tt));
      }
    }
  }
  return xExt;
}

/* Full evaluation pipeline for one IR ("which" selects the speaker):
   bank + Demo-6-style global fit, both against the truth.              */
let gatedCache = null, singleFitCache = null;
function evaluateBank(which, params) {
  const one = which === 'one';
  const irRoom = one ? irRoomOne : irRoomTwo;
  const truthDb = one ? getTruthOne() : getTruthTwo();
  const modes = one ? [68] : [60, 130];

  const an = bankAnalyze(which, params);
  const xExt = bankSynthesize(an, params.Teff);
  const reconDb = spectrumDb(xExt, GRID);

  const gKey = which + '/' + params.Tgate;
  if (!gatedCache || gatedCache.key !== gKey)
    gatedCache = { key: gKey, db: spectrumDb(gate(irRoom, params.Tgate), GRID) };
  const gatedDb = gatedCache.db;

  // Demo-6-style comparison: one global pole fit on [3 ms, T - 0.25 ms]
  // (the careful fit window of gating.html's Demo 6: starts after the
  // direct sound, ends just before the gate)
  const n0 = Math.round(Math.min(3, Math.max(params.tA, params.Tgate - 2)) * 1e-3 * FS);
  const n1 = Math.round((params.Tgate - 0.25) * 1e-3 * FS);
  let singleDb = null, gFit = null;
  if (n1 - n0 >= Math.round(1.5e-3 * FS)) {
    const sKey = which + '/' + params.Tgate + '/' + n0;
    if (!singleFitCache || singleFitCache.key !== sKey)
      singleFitCache = { key: sKey, fit: fitGlobal(gate(irRoom, 14), n0, n1) };
    gFit = singleFitCache.fit;
    const nT = Math.round(params.Teff * 1e-3 * FS);
    const xs = new Float64Array(nT);
    for (let n = 0; n < n1 && n < irRoom.length; n++) xs[n] = irRoom[n];
    for (let n = n1; n < nT; n++) {
      const tt = (n - n0) / FS; // continue the fit's own time axis (phase-continuous splice)
      xs[n] = Math.exp(-tt / gFit.tau) * (gFit.A * Math.cos(2 * Math.PI * gFit.f * tt) + gFit.B * Math.sin(2 * Math.PI * gFit.f * tt));
    }
    singleDb = spectrumDb(xs, GRID);
  }

  const errs = { bank: {}, gated: {}, single: {} };
  for (const f of modes) {
    const i = nearestIdx(GRID, f);
    errs.bank[f] = Math.abs(reconDb[i] - truthDb[i]);
    errs.gated[f] = Math.abs(gatedDb[i] - truthDb[i]);
    errs.single[f] = singleDb ? Math.abs(singleDb[i] - truthDb[i]) : NaN;
  }
  return { gatedDb, reconDb, singleDb, gFit, stats: an.stats, errs, modes };
}

/* ------------------------- data + caches ----------------------------- */

const GRID = logFreqs(600);

const irRoomOne = roomIR(TAIL_ONE, true);         // "Demo 6 speaker" + reflection @ 14 ms
const irTruthOne = roomIR(TAIL_ONE, false, 0.20); // its true (reflection-free) response
const irRoomTwo = roomIR(TAIL_TWO, true);         // two overlapping bass tails
const irTruthTwo = roomIR(TAIL_TWO, false, 0.20);

let truthDbOne = null, truthDbTwo = null;
function getTruthOne() { if (!truthDbOne) truthDbOne = spectrumDb(irTruthOne, GRID); return truthDbOne; }
function getTruthTwo() { if (!truthDbTwo) truthDbTwo = spectrumDb(irTruthTwo, GRID); return truthDbTwo; }

/* ------------------------------ DOM ---------------------------------- */

const els = {};
for (const id of ['cmT', 'cmS', 'c2env', 'c3env', 'c4fr', 'c5fr',
                  'rmR', 'r2env', 'r3fit', 'r4bank', 'r5bank',
                  'bw1', 'bw1v',
                  'd2fc', 'd2fcV', 'd2bw', 'd2bwV', 'd2t', 'd2tV',
                  'd3bw', 'd3bwV', 'd3tA', 'd3tAV', 'd3c', 'd3cV', 'd3t', 'd3tV',
                  'd4bw', 'd4bwV', 'd4sp', 'd4t', 'd4tV', 'd4tA', 'd4tAV', 'd4c', 'd4cV', 'd4te', 'd4teV',
                  'd5bw', 'd5bwV', 'd5t', 'd5tV', 'd5tA', 'd5tAV', 'd5c', 'd5cV', 'd5te', 'd5teV',
                  'p2b', 'p2bwhy', 'quizbox', 'qzscore', 'qzreset',
                  'r1reset', 'r2reset', 'r3reset', 'r4reset', 'r5reset']) {
  els[id] = document.getElementById(id);
}

const plots = {
  b2: new TimePlot('c2env', 24),
  b3: new TimePlot('c3env', 24),
  b4: new Plot('c4fr'),
  b5: new Plot('c5fr'),
};

/* ---------------------------- Demo 1 --------------------------------- */
/* The filter IS a damped ringing: a bandpass of bandwidth sigma_f has a
   time kernel ~ e^(-t^2/2 sigma_t^2) cos(2 pi fc t) with
   sigma_t = 1/(2 pi sigma_f). That sigma_t is its MEMORY.              */

const state1 = { bw: parseFloat(els.bw1.value) };

function drawDemo1() {
  const bw = state1.bw;
  const sigT = 1 / (2 * Math.PI * bw); // s

  /* time view: the kernel, fixed +/-40 ms axis */
  {
    const { ctx: c, w, h } = sizeCanvas(els.cmT);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 30, mt = 12, mb = 24;
    const tmaxMs = 40;
    const X = tm => ml + (tm + tmaxMs) / (2 * tmaxMs) * (w - ml - mr);
    const Y = v => mt + (1 - (v + 1.15) / 2.3) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let tm = -40; tm <= tmaxMs; tm += 10) {
      const px = X(tm);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(tm + (tm === tmaxMs ? ' ms' : ''), px, h - mb + 5);
    }
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const y = Y(v);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(v), ml - 5, y);
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    // memory band (+/- 2 sigma_t)
    c.fillStyle = 'rgba(255,159,67,0.09)';
    c.fillRect(X(-2 * sigT * 1000), mt, X(2 * sigT * 1000) - X(-2 * sigT * 1000), h - mt - mb);
    // kernel: normalized Gaussian envelope x cosine carrier
    c.beginPath();
    const M = 2000;
    for (let i = 0; i <= M; i++) {
      const tms = -tmaxMs + 2 * tmaxMs * i / M;
      const t = tms * 1e-3;
      const v = Math.exp(-t * t / (2 * sigT * sigT)) * Math.cos(2 * Math.PI * 68 * t);
      i ? c.lineTo(X(tms), Y(v)) : c.moveTo(X(tms), Y(v));
    }
    c.strokeStyle = '#4da3ff'; c.lineWidth = 1.4; c.stroke();
    // envelope
    c.setLineDash([5, 4]); c.strokeStyle = '#8d99ab'; c.lineWidth = 1.2;
    for (const s of [1, -1]) {
      c.beginPath();
      for (let i = 0; i <= 400; i++) {
        const tms = -tmaxMs + 2 * tmaxMs * i / 400;
        const t = tms * 1e-3;
        const v = s * Math.exp(-t * t / (2 * sigT * sigT));
        i ? c.lineTo(X(tms), Y(v)) : c.moveTo(X(tms), Y(v));
      }
      c.stroke();
    }
    c.setLineDash([]);
    c.restore();
  }

  /* spectrum view: the Gaussian passband, fixed 20..200 Hz axis */
  {
    const { ctx: c, w, h } = sizeCanvas(els.cmS);
    c.clearRect(0, 0, w, h);
    const ml = 44, mr = 30, mt = 18, mb = 24;
    const fmin = 20, fmax = 200;
    const X = f => ml + (f - fmin) / (fmax - fmin) * (w - ml - mr);
    const Y = db => mt + (1 - (db + 60) / 63) * (h - mt - mb);
    c.font = '11px system-ui'; c.lineWidth = 1;
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (let f = 50; f <= fmax; f += 50) {
      const px = X(f);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(px, mt); c.lineTo(px, h - mb); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(f === fmax ? f + ' Hz' : String(f), px, h - mb + 5);
    }
    c.fillStyle = '#7d8899'; c.textAlign = 'right'; c.textBaseline = 'bottom';
    c.fillText('dB', ml - 5, mt - 6);
    c.textAlign = 'right'; c.textBaseline = 'middle';
    for (let db = 0; db >= -60; db -= 20) {
      const y = Y(db);
      c.strokeStyle = '#232c38';
      c.beginPath(); c.moveTo(ml, y); c.lineTo(w - mr, y); c.stroke();
      c.fillStyle = '#7d8899'; c.fillText(String(db), ml - 5, y);
    }
    c.strokeStyle = '#39434f'; c.strokeRect(ml, mt, w - ml - mr, h - mt - mb);
    c.save();
    c.beginPath(); c.rect(ml, mt, w - ml - mr, h - mt - mb); c.clip();
    c.beginPath();
    for (let i = 0; i <= 600; i++) {
      const f = fmin + (fmax - fmin) * i / 600;
      const H = Math.exp(-(f - 68) * (f - 68) / (2 * bw * bw)) + Math.exp(-(f + 68) * (f + 68) / (2 * bw * bw));
      const db = Math.max(-60, 20 * Math.log10(H));
      i ? c.lineTo(X(f), Y(db)) : c.moveTo(X(f), Y(db));
    }
    c.strokeStyle = '#ff9f43'; c.lineWidth = 2; c.stroke();
    // -6 dB width bracket
    const w6 = 2 * bw * Math.sqrt(2 * Math.log(2));
    c.strokeStyle = '#3ecf8e'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(X(68 - w6 / 2), Y(-6)); c.lineTo(X(68 + w6 / 2), Y(-6)); c.stroke();
    c.fillStyle = '#3ecf8e'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(`\u22126 dB width \u2248 ${w6.toFixed(0)} Hz`, X(68), Y(-6) - 3);
    c.restore();
  }

  els.rmR.innerHTML =
    `Bandwidth \u03c3<sub>f</sub> = <b>${bw.toFixed(0)} Hz</b> \u2192 filter memory \u03c3<sub>t</sub> = 1/(2\u03c0\u03c3<sub>f</sub>) = ` +
    `<b>${(sigT * 1000).toFixed(1)} ms</b> (the shaded \u00b12\u03c3<sub>t</sub> \u2248 \u00b1${(2 * sigT * 1000).toFixed(0)} ms is where the kernel is significant). ` +
    `Product \u03c3<sub>t</sub>\u00b7\u03c3<sub>f</sub> = <b>${(sigT * bw).toFixed(4)}</b> = 1/2\u03c0 \u2014 <span class="hl">the same seesaw as the gate itself</span>. ` +
    `Consequence: the band output at time t mixes \u2248 2\u20133\u00b7\u03c3<sub>t</sub> of data on both sides of t \u2014 so inside a gate of T ms, ` +
    `only t \u2272 T \u2212 c\u00b7\u03c3<sub>t</sub> is an uncontaminated view of the speaker; the narrower the filter, the less of the gate is usable.`;
}

/* ---------------------------- Demo 2 --------------------------------- */
/* What gating looks like inside one band: the envelope follows the true
   decay, then bends away onto the filter's own ring-out — the
   "unnatural" decay caused by the gate.                                */

const state2 = { fc: parseFloat(els.d2fc.value), bw: parseFloat(els.d2bw.value), T: parseFloat(els.d2t.value) };
let truthBandCache = null;

function getTruthBand(fc, bw) {
  if (!truthBandCache || truthBandCache.fc !== fc || truthBandCache.bw !== bw) {
    const y = singleBand(irTruthOne, fc, bw, irTruthOne.length);
    truthBandCache = { fc, bw, env: envelopeDb(y, fc) };
  }
  return truthBandCache;
}

function drawDemo2() {
  const { fc, bw, T } = state2;
  const sigTms = 1000 / (2 * Math.PI * bw);
  const tb = getTruthBand(fc, bw);
  const nPlot = Math.round(24e-3 * FS);
  const yG = singleBand(gate(irRoomOne, T), fc, bw, nPlot);
  const envG = envelopeDb(yG, fc);
  const tG = Float64Array.from({ length: envG.length }, (_, n) => n / FS * 1000);
  const tT = Float64Array.from({ length: Math.min(tb.env.length, nPlot) }, (_, n) => n / FS * 1000);

  const tp = plots.b2;
  tp.frame();
  tp.curveMs(tT, tb.env, { color: '#e8edf4', width: 1.4, dash: [7, 5] });
  tp.curveMs(tG, envG, { color: '#4da3ff', width: 2 });
  const tCont = T - 2.5 * sigTms;
  if (tCont > 0) tp.vlineMs(tCont, { color: '#e05c5c', label: `contamination \u2248 ${tCont.toFixed(1)} ms`, dy: 21 });
  tp.vlineMs(T, { color: '#ff9f43', label: `gate end ${T.toFixed(1)} ms`, dy: 5 });
  tp.vlineMs(14, { color: '#ff6b6b', label: 'reflection 14 ms', dy: 37 });

  const clean = Math.max(0, T - 2.5 * sigTms);
  const frac = clean / T * 100;
  let note;
  if (clean <= 0) {
    note = `<span class="warn">\u26a0 The filter memory (2.5\u03c3<sub>t</sub> \u2248 ${(2.5 * sigTms).toFixed(0)} ms) exceeds the whole gate \u2014 ` +
      `<b>nothing in this band is uncontaminated</b>: the entire curve you see is a mixture of speaker and filter. ` +
      `Widen the bandwidth or accept the bias (Demo 3).</span>`;
  } else if (fc < 150 && clean < 4) {
    note = `<span class="warn">Only ${clean.toFixed(1)} ms of clean decay \u2014 less than needed to fit ${fc.toFixed(0)} Hz confidently. ` +
      `This is the bottleneck of the whole method.</span>`;
  } else {
    note = `<span class="ok">\u2713 ${clean.toFixed(1)} ms (${frac.toFixed(0)} %) of the visible decay is genuinely the speaker's</span> ` +
      `\u2014 that is the part Demo 3 fits.`;
  }
  els.r2env.innerHTML =
    `Band at <b>${fc.toFixed(0)} Hz</b>, bandwidth \u03c3<sub>f</sub> = <b>${bw.toFixed(0)} Hz</b> (memory \u03c3<sub>t</sub> = ${sigTms.toFixed(1)} ms), ` +
    `gate <b>${T.toFixed(2)} ms</b>. The blue envelope hugs the true decay (white dashed) until \u2248 T \u2212 2.5\u03c3<sub>t</sub>, ` +
    `then bends off onto the filter's own ring-out \u2014 the <span class="hl">unnatural decay the gate causes</span>: past that point the ` +
    `band is reporting the <i>filter</i>, not the speaker. ${note}`;
}

/* ---------------------------- Demo 3 --------------------------------- */
/* Reconstruct the true decay of ONE band: exponential fit on the
   uncontaminated part, extrapolated past the gate.                     */

const state3 = { bw: parseFloat(els.d3bw.value), tA: parseFloat(els.d3tA.value),
                 c: parseFloat(els.d3c.value), T: parseFloat(els.d3t.value) };

function drawDemo3() {
  const { bw, tA, c, T } = state3;
  const fc = 68; // this demo looks at the port band
  const sigTms = 1000 / (2 * Math.PI * bw);
  const tB = T - c * sigTms;
  const tb = getTruthBand(fc, bw);
  const nPlot = Math.round(24e-3 * FS);
  const yG = singleBand(gate(irRoomOne, T), fc, bw, nPlot);
  const envG = envelopeDb(yG, fc);
  const tG = Float64Array.from({ length: envG.length }, (_, n) => n / FS * 1000);
  const tT = Float64Array.from({ length: Math.min(tb.env.length, nPlot) }, (_, n) => n / FS * 1000);

  const nA = Math.round(tA * 1e-3 * FS), nB = Math.round(tB * 1e-3 * FS);
  const minWin = Math.round(1.5e-3 * FS);

  let fit = null;
  if (nB - nA >= minWin) {
    let rms = 0;
    for (let n = nA; n < nB; n++) rms += yG[n] * yG[n];
    rms = Math.sqrt(rms / (nB - nA));
    let gpk = 0;
    for (let n = 0; n < yG.length; n++) gpk = Math.max(gpk, Math.abs(yG[n]));
    if (rms >= 3e-3 * gpk) fit = fitBand(yG.slice(nA, nB), nA, fc, bw);
  }

  const tp = plots.b3;
  tp.frame();
  // fit window shading
  if (nB > nA) {
    const ctx = tp.ctx;
    ctx.fillStyle = 'rgba(77,163,255,0.10)';
    ctx.fillRect(tp.X(tA), MT, tp.X(Math.min(tB, 24)) - tp.X(tA), tp.h - MT - MB);
  }
  tp.curveMs(tT, tb.env, { color: '#e8edf4', width: 1.4, dash: [7, 5] });
  tp.curveMs(tG, envG, { color: '#4da3ff', width: 2 });
  // fitted decay, extrapolated
  if (fit) {
    const M = 400, tF = new Float64Array(M), eF = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const tms = tA + (24 - tA) * i / (M - 1);
      tF[i] = tms;
      eF[i] = 20 * Math.log10(fit.amp * Math.exp(-tms * 1e-3 / fit.tau) + 1e-12);
    }
    tp.curveMs(tF, eF, { color: '#ff9f43', width: 2, dash: [6, 4] });
  }
  if (tB > 0) tp.vlineMs(tB, { color: '#e05c5c', label: `fit end ${tB.toFixed(1)} ms (T \u2212 ${c.toFixed(1)}\u03c3t)`, dy: 21 });
  tp.vlineMs(T, { color: '#ff9f43', label: `gate end ${T.toFixed(1)} ms`, dy: 5 });
  tp.vlineMs(14, { color: '#ff6b6b', label: 'reflection 14 ms', dy: 37 });

  let verdict;
  if (!fit) {
    verdict = `<span class="warn">\u26a0 No fit possible: the uncontaminated window [${tA.toFixed(1)}, ${tB.toFixed(1)}] ms is ` +
      (tB <= tA ? `empty \u2014 the margin ${c.toFixed(1)}\u03c3<sub>t</sub> \u2248 ${(c * sigTms).toFixed(1)} ms swallows the gate` :
        `shorter than ${ (minWin / FS * 1000).toFixed(1)} ms`) + `. ` +
      `Widen the bandwidth, shrink the margin, or move the fit start earlier.</span>`;
  } else {
    const tauErr = Math.abs(fit.tau * 1000 - 11);
    verdict = `Fitted: f\u2080 = <b>${fit.f.toFixed(1)} Hz</b>, \u03c4 = <b>${(fit.tau * 1000).toFixed(1)} ms</b>, R\u00b2 = <b>${fit.r2.toFixed(3)}</b> ` +
      `\u2014 true values 68 Hz / 11.0 ms. ` +
      (tauErr <= 2 && fit.r2 >= 0.98
        ? `<span class="ok">\u2713 The true decay is reconstructed from ${((tB - tA)).toFixed(1)} ms of clean data; the orange extrapolation runs onto the white truth.</span>`
        : tauErr <= 4
          ? `<span class="hl">Close, but biased \u2014 ${tauErr.toFixed(1)} ms off.</span> Either the window is short or the margin lets filter ring-out in; try c = 2 or a wider band.`
          : `<span class="warn">\u26a0 \u03c4 off by ${tauErr.toFixed(1)} ms \u2014 the fit is seeing mostly filter ring-out (margin too small) or too little decay (window too short).</span>`);
  }
  els.r3fit.innerHTML =
    `Band 68 Hz \u00b7 \u03c3<sub>f</sub> = <b>${bw.toFixed(0)} Hz</b> (\u03c3<sub>t</sub> = ${sigTms.toFixed(1)} ms) \u00b7 gate <b>${T.toFixed(2)} ms</b> \u00b7 ` +
    `margin ${c.toFixed(1)}\u03c3<sub>t</sub> \u2192 fit window <b>[${tA.toFixed(1)}, ${tB.toFixed(1)}] ms</b> = ${Math.max(0, tB - tA).toFixed(1)} ms. ${verdict}`;
}

/* ------------------------- Demo 4 & 5: the bank ---------------------- */

const state4 = { bw: parseFloat(els.d4bw.value), sp: parseFloat(els.d4sp.value), T: parseFloat(els.d4t.value),
                 tA: parseFloat(els.d4tA.value), c: parseFloat(els.d4c.value), Te: parseFloat(els.d4te.value) };
const state5 = { bw: parseFloat(els.d5bw.value), T: parseFloat(els.d5t.value),
                 tA: parseFloat(els.d5tA.value), c: parseFloat(els.d5c.value), Te: parseFloat(els.d5te.value) };

function drawBank(which) {
  const one = which === 'one';
  const st = one ? state4 : state5;
  const p = one ? plots.b4 : plots.b5;
  const el = one ? els.r4bank : els.r5bank;
  const params = { sigmaF: st.bw, spacingFactor: one ? st.sp : 1, Tgate: st.T, tA: st.tA, cMargin: st.c, Teff: st.Te };
  const res = evaluateBank(which, params);
  const truth = one ? getTruthOne() : getTruthTwo();

  const list = [truth, res.gatedDb, res.reconDb];
  if (res.singleDb) list.push(res.singleDb);
  const [lo, hi] = autoRange(list, { maxSpan: 80 });
  p.setRange(lo, hi); p.frame();
  p.curve(GRID, res.gatedDb, { color: '#8a95a6', width: 1.6 });
  if (res.singleDb) p.curve(GRID, res.singleDb, { color: '#ff9f43', width: 1.4, alpha: 0.9 });
  p.curve(GRID, truth, { color: '#e8edf4', width: 1.3, dash: [7, 5] });
  p.curve(GRID, res.reconDb, { color: '#4da3ff', width: 2.2 });
  p.vline(1000 / st.Te, { color: '#e05c5c', label: `1/T = ${(1000 / st.Te).toFixed(0)} Hz` });

  const s = res.stats;
  const errBits = res.modes.map(f => {
    const b = res.errs.bank[f], g = res.errs.gated[f], sgl = res.errs.single[f];
    return `@ ${f} Hz: bank <b>${b.toFixed(1)} dB</b> vs gated ${g.toFixed(1)} dB` +
      (isNaN(sgl) ? ' (single fit: no window)' : ` vs Demo-6-style fit ${sgl.toFixed(1)} dB`);
  }).join(' \u00b7 ');

  let verdict;
  if (s.nUsed === 0) {
    verdict = `<span class="warn">\u26a0 No band produced a fit \u2014 the uncontaminated window ` +
      `[${st.tA.toFixed(1)}, ${s.tBms.toFixed(1)}] ms is empty (margin ${st.c.toFixed(1)}\u03c3<sub>t</sub> \u2248 ${(st.c * s.sigmaTms).toFixed(1)} ms). ` +
      `The blue curve falls back to the gated data. Widen the bandwidth or shrink c.</span>`;
  } else {
    const worst = Math.max(...res.modes.map(f => res.errs.bank[f]));
    const worstGated = Math.max(...res.modes.map(f => res.errs.gated[f]));
    if (worst < 1) {
      verdict = `<span class="ok">\u2713 The bank has essentially recovered the bass \u2014 per-band exponential decays, each fitted from ` +
        `${Math.max(0, s.tBms - st.tA).toFixed(1)} ms of clean data.</span>`;
    } else if (worst > worstGated + 0.5) {
      verdict = `<span class="warn">\u26a0 The bank is doing harm here (${worst.toFixed(1)} dB vs ${worstGated.toFixed(1)} gated).</span> ` +
        `The fit window is either too short or too contaminated at this bandwidth, so one or more bands synthesized a wrong tail. ` +
        `Widen \u03c3<sub>f</sub>, adjust the margin / fit start, or simply accept the gated curve below ~1/T.`;
    } else {
      verdict = `<span class="hl">Remaining error ${worst.toFixed(1)} dB</span> \u2014 extend the effective gate (more synthesized tail) or improve the fit windows.`;
    }
  }
  el.innerHTML =
    `Gate <b>${st.T.toFixed(2)} ms</b> \u00b7 \u03c3<sub>f</sub> = <b>${st.bw.toFixed(0)} Hz</b>` +
    (one ? ` \u00b7 spacing ${st.sp === 1 ? 'critical (\u0394f = \u03c3<sub>f</sub>)' : st.sp < 1 ? 'dense (\u0394f = \u03c3<sub>f</sub>/2)' : 'sparse (\u0394f = 2\u03c3<sub>f</sub>)'}` : '') +
    ` \u00b7 bands used <b>${s.nUsed}</b>/${s.centers.length}` +
    (s.nSilent ? ` (silent ${s.nSilent})` : '') +
    (s.nShort ? ` \u00b7 <span class="warn">window too short in all bands</span>` : '') +
    ` \u00b7 worst band R\u00b2 = ${s.nUsed ? s.worstR2.toFixed(3) : '\u2014'} \u00b7 effective gate ${st.Te} ms. ${errBits}. ${verdict}`;
}

const drawBank4 = () => drawBank('one');
const drawBank5 = () => drawBank('two');

/* ------------------------- prediction + quiz ------------------------- */

const PREDICTS = {
  p2b: {
    opts: ['It follows the speaker\u2019s decay for longer — narrow filters are more precise',
           'It bends onto the filter\u2019s own decay sooner — the filter\u2019s memory grows',
           'Nothing changes — the decay is a property of the speaker'],
    correct: 1,
    why: 'Halving the bandwidth doubles the filter\u2019s memory \u03c3<sub>t</sub> = 1/(2\u03c0\u03c3<sub>f</sub>). The band output then needs data from further past the gate end, so the contaminated part starts earlier and <i>less</i> of the visible decay is the speaker\u2019s. Try it with the slider.',
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
  { q: 'Past the gate end, the narrow bandpass output keeps showing the speaker\u2019s decay in that band — merely delayed.', a: false,
    why: 'Past the gate the filter has nothing left to feed on and rings out with its <i>own</i> impulse response. That is exactly the "unnatural" decay of Demo 2 — it reports the filter, not the speaker.' },
  { q: 'The filter bank recovers detail below 1/T without any assumption about the loudspeaker.', a: false,
    why: 'The extra resolution comes entirely from the model assumption — one exponential decay per band. The filters only localize it; with the model switched off there is no data past the gate, same as before.' },
  { q: 'If a filter\u2019s memory (\u2248 1/(2\u03c0\u00b7BW)) no longer fits inside the gate, there is nothing uncontaminated left to fit in that band.', a: true,
    why: 'The band output at time t mixes \u2248 2\u20133\u00b7\u03c3<sub>t</sub> of data around t. When that exceeds the gate, every visible sample already contains the missing tail — the fit can only be biased.' },
  { q: 'The bank copes with two overlapping bass decays better than one global tail fit, because each band contains (roughly) one decay.', a: true,
    why: 'That is Demo 5: the time-domain tail of two close bass modes is not one damped sinusoid, so Demo 6\u2019s single fit fails — while narrow bands separate the modes in frequency and fit each locally.' },
  { q: 'How densely the bands are spaced does not matter, as long as each filter is narrow.', a: false,
    why: 'The synthesized tails of the fitted bands must add up to the whole signal — that needs (near-)perfect-reconstruction overlap. A sparsely spaced bank leaves gaps and phantom peaks between bands (try \u201csparse\u201d in Demo 4).' },
];

let quizScore = 0, quizAnswered = 0;
function updateScore() {
  els.qzscore.textContent = quizAnswered
    ? `Score so far: ${quizScore} correct of ${quizAnswered} answered (${QUIZ.length} total).`
    : '';
}
function renderQuiz() {
  const box = els.quizbox;
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

const throttled1 = rafThrottle(drawDemo1);
els.bw1.addEventListener('input', () => {
  state1.bw = parseFloat(els.bw1.value);
  els.bw1v.textContent = state1.bw.toFixed(0) + ' Hz';
  throttled1();
});

const throttled2 = rafThrottle(drawDemo2);
els.d2fc.addEventListener('input', () => {
  state2.fc = parseFloat(els.d2fc.value);
  els.d2fcV.textContent = state2.fc.toFixed(0) + ' Hz';
  throttled2();
});
els.d2bw.addEventListener('input', () => {
  state2.bw = parseFloat(els.d2bw.value);
  els.d2bwV.textContent = state2.bw.toFixed(0) + ' Hz';
  throttled2();
});
els.d2t.addEventListener('input', () => {
  state2.T = parseFloat(els.d2t.value);
  els.d2tV.textContent = state2.T.toFixed(2) + ' ms';
  throttled2();
});

const throttled3 = rafThrottle(drawDemo3);
els.d3bw.addEventListener('input', () => {
  state3.bw = parseFloat(els.d3bw.value);
  els.d3bwV.textContent = state3.bw.toFixed(0) + ' Hz';
  throttled3();
});
els.d3tA.addEventListener('input', () => {
  state3.tA = parseFloat(els.d3tA.value);
  els.d3tAV.textContent = state3.tA.toFixed(2) + ' ms';
  throttled3();
});
els.d3c.addEventListener('input', () => {
  state3.c = parseFloat(els.d3c.value);
  els.d3cV.textContent = state3.c.toFixed(1) + '\u03c3t';
  throttled3();
});
els.d3t.addEventListener('input', () => {
  state3.T = parseFloat(els.d3t.value);
  els.d3tV.textContent = state3.T.toFixed(2) + ' ms';
  throttled3();
});

const throttled4 = rafThrottle(drawBank4);
els.d4bw.addEventListener('input', () => {
  state4.bw = parseFloat(els.d4bw.value);
  els.d4bwV.textContent = state4.bw.toFixed(0) + ' Hz';
  throttled4();
});
els.d4sp.addEventListener('change', () => { state4.sp = parseFloat(els.d4sp.value); drawBank4(); });
els.d4t.addEventListener('input', () => {
  state4.T = parseFloat(els.d4t.value);
  els.d4tV.textContent = state4.T.toFixed(2) + ' ms';
  throttled4();
});
els.d4tA.addEventListener('input', () => {
  state4.tA = parseFloat(els.d4tA.value);
  els.d4tAV.textContent = state4.tA.toFixed(2) + ' ms';
  throttled4();
});
els.d4c.addEventListener('input', () => {
  state4.c = parseFloat(els.d4c.value);
  els.d4cV.textContent = state4.c.toFixed(1) + '\u03c3t';
  throttled4();
});
els.d4te.addEventListener('input', () => {
  state4.Te = parseFloat(els.d4te.value);
  els.d4teV.textContent = state4.Te + ' ms';
  throttled4();
});

const throttled5 = rafThrottle(drawBank5);
els.d5bw.addEventListener('input', () => {
  state5.bw = parseFloat(els.d5bw.value);
  els.d5bwV.textContent = state5.bw.toFixed(0) + ' Hz';
  throttled5();
});
els.d5t.addEventListener('input', () => {
  state5.T = parseFloat(els.d5t.value);
  els.d5tV.textContent = state5.T.toFixed(2) + ' ms';
  throttled5();
});
els.d5tA.addEventListener('input', () => {
  state5.tA = parseFloat(els.d5tA.value);
  els.d5tAV.textContent = state5.tA.toFixed(2) + ' ms';
  throttled5();
});
els.d5c.addEventListener('input', () => {
  state5.c = parseFloat(els.d5c.value);
  els.d5cV.textContent = state5.c.toFixed(1) + '\u03c3t';
  throttled5();
});
els.d5te.addEventListener('input', () => {
  state5.Te = parseFloat(els.d5te.value);
  els.d5teV.textContent = state5.Te + ' ms';
  throttled5();
});

/* ---- per-demo reset buttons: revert one card's controls to defaults - */

els.r1reset.addEventListener('click', () => {
  els.bw1.value = '15'; state1.bw = 15; els.bw1v.textContent = '15 Hz';
  drawDemo1();
});
els.r2reset.addEventListener('click', () => {
  els.d2fc.value = '68'; els.d2bw.value = '20'; els.d2t.value = '10';
  state2.fc = 68; state2.bw = 20; state2.T = 10;
  els.d2fcV.textContent = '68 Hz'; els.d2bwV.textContent = '20 Hz'; els.d2tV.textContent = '10.00 ms';
  drawDemo2();
});
els.r3reset.addEventListener('click', () => {
  els.d3bw.value = '60'; els.d3tA.value = '2'; els.d3c.value = '1'; els.d3t.value = '13';
  state3.bw = 60; state3.tA = 2; state3.c = 1; state3.T = 13;
  els.d3bwV.textContent = '60 Hz'; els.d3tAV.textContent = '2.00 ms';
  els.d3cV.textContent = '1.0\u03c3t'; els.d3tV.textContent = '13.00 ms';
  drawDemo3();
});
els.r4reset.addEventListener('click', () => {
  els.d4bw.value = '40'; els.d4sp.value = '1'; els.d4t.value = '13';
  els.d4tA.value = '1'; els.d4c.value = '1'; els.d4te.value = '60';
  state4.bw = 40; state4.sp = 1; state4.T = 13; state4.tA = 1; state4.c = 1; state4.Te = 60;
  els.d4bwV.textContent = '40 Hz'; els.d4tV.textContent = '13.00 ms'; els.d4tAV.textContent = '1.00 ms';
  els.d4cV.textContent = '1.0\u03c3t'; els.d4teV.textContent = '60 ms';
  drawBank4();
});
els.r5reset.addEventListener('click', () => {
  els.d5bw.value = '40'; els.d5t.value = '13.75'; els.d5tA.value = '1'; els.d5c.value = '1'; els.d5te.value = '60';
  state5.bw = 40; state5.T = 13.75; state5.tA = 1; state5.c = 1; state5.Te = 60;
  els.d5bwV.textContent = '40 Hz'; els.d5tV.textContent = '13.75 ms'; els.d5tAV.textContent = '1.00 ms';
  els.d5cV.textContent = '1.0\u03c3t'; els.d5teV.textContent = '60 ms';
  drawBank5();
});

/* ---- direct manipulation: drag the 1/T line of the effective gate --- */

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

makeDraggable(els.c4fr, () => plots.b4.X(1000 / state4.Te), x => {
  dragSet(els.d4te, els.d4teV, v => v + ' ms', 1000 / plots.b4.freqAt(x),
    v => { state4.Te = v; throttled4(); });
});
makeDraggable(els.c5fr, () => plots.b5.X(1000 / state5.Te), x => {
  dragSet(els.d5te, els.d5teV, v => v + ' ms', 1000 / plots.b5.freqAt(x),
    v => { state5.Te = v; throttled5(); });
});

/* ---- chapter link icons: click copies the chapter URL --------------- */
document.querySelectorAll('a.hlink').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    const hash = a.getAttribute('href');
    const url = location.href.split('#')[0] + hash;
    try { history.replaceState(null, '', hash); } catch (err) { /* e.g. some file:// setups */ }
    const show = () => { a.classList.add('copied'); setTimeout(() => a.classList.remove('copied'), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(url).then(show, show);
    else show();
  });
});

renderPredict('p2b');
renderQuiz();
els.qzreset.addEventListener('click', renderQuiz);

function drawAll() { drawDemo1(); drawDemo2(); drawDemo3(); drawBank4(); drawBank5(); }

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
// jumping the page when a control is first clicked/focused.
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
  module.exports = { evaluateBank, bankAnalyze, bankSynthesize, fitBand, fitGlobal, singleBand, drawBank4, drawBank5, state4, state5 };
}
