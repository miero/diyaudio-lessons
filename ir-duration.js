'use strict';
/* A finite IR has a continuous DTFT. This lesson keeps the numerical model
   independent of the DOM so the duration, sampling, and decay claims can be
   checked directly. */

const DEFAULT_STATE = Object.freeze({
  example: 'resonance',
  durationMs: 1,
  sampleRate: 48000,
  f0Hz: 1000,
  qualityFactor: 10,
  targetDb: -40,
});

const REQUIRED_IDS = Object.freeze([
  'exampleType', 'durationMs', 'durationValue', 'sampleRate',
  'resonanceControls', 'f0Hz', 'f0Value', 'qualityFactor', 'qualityValue', 'targetDb',
  'demoReset', 'predictionOptions', 'predictionWhy',
  'timeCanvas', 'frequencyCanvas', 'demoReadout',
  'quizBox', 'quizScore', 'quizReset',
]);

const PREDICTION = Object.freeze({
  options: Object.freeze([
    'Nyquist and sample count double; 1/T and decay containment stay the same',
    'The hard lowest frequency is cut in half',
    'The maximum contained Q doubles because there are twice as many samples',
  ]),
  correct: 0,
  why: 'At fixed T, doubling Fs doubles N = FsT and Nyquist = Fs/2. But Fs/N remains 1/T, and a physical envelope has had the same amount of time to decay, so the containment bound is unchanged.',
});

const QUIZ = Object.freeze([
  Object.freeze({
    q: 'A 1 ms record has no Fourier-transform value below 1 kHz.',
    answer: false,
    why: 'Its unpadded DFT samples are 1 kHz apart, but the finite sequence has a continuous DTFT between them and at DC. Spacing is not a hard lower-frequency boundary.',
  }),
  Object.freeze({
    q: 'The DTFT magnitude of h[n] = δ[n] is 1 at DC and at every other frequency.',
    answer: true,
    why: 'Only h[0] is nonzero, so H(eʲω) = Σ h[n]e⁻ʲωⁿ = 1 for every ω. Its magnitude is exactly 0 dB throughout the Nyquist interval.',
  }),
  Object.freeze({
    q: 'Zero-padding can sample the finite record’s DTFT more densely, but cannot restore a resonance tail cut off at T.',
    answer: true,
    why: 'Padding adds zeros, not the omitted physical samples. It changes displayed frequency sampling, while truncation error and its characteristic ~1/T detail scale remain.',
  }),
  Object.freeze({
    q: 'At fixed duration, raising Fs raises Nyquist and the number of samples but leaves the unpadded DFT spacing unchanged.',
    answer: true,
    why: 'N = FsT, so Fs/N = Fs/(FsT) = 1/T. The extra samples cover a wider non-aliased band rather than providing more elapsed decay time.',
  }),
  Object.freeze({
    q: 'A 1 ms duration creates one universal maximum Q for every resonance and every accuracy requirement.',
    answer: false,
    why: 'For the stated amplitude criterion, Qmax = πf₀T/ln(1/ε). It depends on f₀ and ε; another error, noise, or energy criterion gives another boundary.',
  }),
]);

/* --------------------------- pure model ---------------------------- */

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

function requireFinite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function targetAmplitude(targetDb) {
  requireFinite(targetDb, 'targetDb');
  if (targetDb >= 0) throw new RangeError('targetDb must be below 0 dB');
  return Math.pow(10, targetDb / 20);
}

function sampleMetrics(durationMs, sampleRate) {
  requirePositiveFinite(durationMs, 'durationMs');
  requirePositiveFinite(sampleRate, 'sampleRate');
  const sampleCount = Math.max(1, Math.round(durationMs * 1e-3 * sampleRate));
  const durationSeconds = sampleCount / sampleRate;
  return {
    sampleCount,
    durationSeconds,
    durationMs: durationSeconds * 1000,
    nyquistHz: sampleRate / 2,
    dftSpacingHz: sampleRate / sampleCount,
  };
}

function tauFromQ(f0Hz, qualityFactor) {
  requirePositiveFinite(f0Hz, 'f0Hz');
  requirePositiveFinite(qualityFactor, 'qualityFactor');
  return qualityFactor / (Math.PI * f0Hz);
}

function containmentTimeSeconds(f0Hz, qualityFactor, targetDb) {
  const tauSeconds = tauFromQ(f0Hz, qualityFactor);
  const epsilon = targetAmplitude(targetDb);
  return tauSeconds * Math.log(1 / epsilon);
}

function maxContainedQ(durationSeconds, f0Hz, targetDb) {
  requirePositiveFinite(durationSeconds, 'durationSeconds');
  requirePositiveFinite(f0Hz, 'f0Hz');
  const epsilon = targetAmplitude(targetDb);
  return Math.PI * f0Hz * durationSeconds / Math.log(1 / epsilon);
}

function minContainedFrequency(durationSeconds, qualityFactor, targetDb) {
  requirePositiveFinite(durationSeconds, 'durationSeconds');
  requirePositiveFinite(qualityFactor, 'qualityFactor');
  const epsilon = targetAmplitude(targetDb);
  return qualityFactor * Math.log(1 / epsilon) / (Math.PI * durationSeconds);
}

function dtftComplex(samples, frequencyHz, sampleRate) {
  requireFinite(frequencyHz, 'frequencyHz');
  requirePositiveFinite(sampleRate, 'sampleRate');
  if (!samples || !Number.isInteger(samples.length)) throw new TypeError('samples must be array-like');
  const angle = -2 * Math.PI * frequencyHz / sampleRate;
  const cr = Math.cos(angle), ci = Math.sin(angle);
  let wr = 1, wi = 0, re = 0, im = 0;
  for (let n = 0; n < samples.length; n++) {
    const value = Number(samples[n]);
    if (!Number.isFinite(value)) throw new RangeError('samples must contain finite numbers');
    re += value * wr;
    im += value * wi;
    const nextWr = wr * cr - wi * ci;
    wi = wr * ci + wi * cr;
    wr = nextWr;
  }
  return { re, im };
}

function dtftMagnitude(samples, frequencyHz, sampleRate) {
  const value = dtftComplex(samples, frequencyHz, sampleRate);
  return Math.hypot(value.re, value.im);
}

function impulseDtftMagnitude(frequencyHz, sampleRate) {
  requireFinite(frequencyHz, 'frequencyHz');
  requirePositiveFinite(sampleRate, 'sampleRate');
  return 1;
}

/* Σ(n=0..count-1) [radius exp(j angle)]^n, or the infinite sum when
   count is omitted. The damped-resonance DTFT is the average of two such
   geometric sums, one for each complex exponential in the cosine. */
function geometricComplex(radius, angle, count) {
  const zr = radius * Math.cos(angle);
  const zi = radius * Math.sin(angle);
  const dr = 1 - zr;
  const di = -zi;
  let nr = 1, ni = 0;
  if (count !== undefined) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
    const radiusN = Math.pow(radius, count);
    nr = 1 - radiusN * Math.cos(angle * count);
    ni = -radiusN * Math.sin(angle * count);
  }
  const denominator = dr * dr + di * di;
  return {
    re: (nr * dr + ni * di) / denominator,
    im: (ni * dr - nr * di) / denominator,
  };
}

function resonanceDtftComplex(frequencyHz, f0Hz, qualityFactor, sampleRate, sampleCount) {
  requireFinite(frequencyHz, 'frequencyHz');
  requirePositiveFinite(sampleRate, 'sampleRate');
  const tauSeconds = tauFromQ(f0Hz, qualityFactor);
  if (f0Hz > sampleRate / 2) throw new RangeError('f0Hz must not exceed Nyquist');
  const radius = Math.exp(-1 / (sampleRate * tauSeconds));
  const omega = 2 * Math.PI * frequencyHz / sampleRate;
  const omega0 = 2 * Math.PI * f0Hz / sampleRate;
  const positive = geometricComplex(radius, omega0 - omega, sampleCount);
  const negative = geometricComplex(radius, -omega0 - omega, sampleCount);
  return {
    re: 0.5 * (positive.re + negative.re),
    im: 0.5 * (positive.im + negative.im),
  };
}

function resonanceDtftMagnitude(frequencyHz, f0Hz, qualityFactor, sampleRate, sampleCount) {
  const value = resonanceDtftComplex(frequencyHz, f0Hz, qualityFactor, sampleRate, sampleCount);
  return Math.hypot(value.re, value.im);
}

function calculateLesson(inputState) {
  const state = { ...DEFAULT_STATE, ...inputState };
  if (state.example !== 'impulse' && state.example !== 'resonance') {
    throw new RangeError('example must be impulse or resonance');
  }
  const metrics = sampleMetrics(state.durationMs, state.sampleRate);
  const result = { ...state, ...metrics };

  if (state.example === 'impulse') {
    return {
      ...result,
      dcMagnitude: 1,
      dcDb: 0,
      contained: true,
    };
  }

  requirePositiveFinite(state.f0Hz, 'f0Hz');
  requirePositiveFinite(state.qualityFactor, 'qualityFactor');
  if (state.f0Hz > metrics.nyquistHz) throw new RangeError('f0Hz must not exceed Nyquist');
  const epsilon = targetAmplitude(state.targetDb);
  const tauSeconds = tauFromQ(state.f0Hz, state.qualityFactor);
  const requiredDurationSeconds = containmentTimeSeconds(state.f0Hz, state.qualityFactor, state.targetDb);
  const residualAmplitude = Math.exp(-metrics.durationSeconds / tauSeconds);
  const residualDb = 20 * Math.log10(residualAmplitude);
  const qMax = maxContainedQ(metrics.durationSeconds, state.f0Hz, state.targetDb);
  const minimumFrequencyHz = minContainedFrequency(metrics.durationSeconds, state.qualityFactor, state.targetDb);
  const finiteAtF0 = resonanceDtftMagnitude(
    state.f0Hz, state.f0Hz, state.qualityFactor, state.sampleRate, metrics.sampleCount);
  const fullAtF0 = resonanceDtftMagnitude(
    state.f0Hz, state.f0Hz, state.qualityFactor, state.sampleRate);

  return {
    ...result,
    epsilon,
    tauSeconds,
    tauMs: tauSeconds * 1000,
    requiredDurationSeconds,
    requiredDurationMs: requiredDurationSeconds * 1000,
    residualAmplitude,
    residualDb,
    qMax,
    minimumFrequencyHz,
    contained: residualAmplitude <= epsilon * (1 + 1e-12),
    cyclesInRecord: state.f0Hz * metrics.durationSeconds,
    finiteAtF0,
    fullAtF0,
    referenceMagnitude: fullAtF0,
    finiteAtF0Db: 20 * Math.log10(finiteAtF0 / fullAtF0),
    fullAtF0Db: 0,
    truncationAtF0Db: 20 * Math.log10(finiteAtF0 / fullAtF0),
  };
}

function generateFiniteIR(inputState) {
  const result = calculateLesson(inputState);
  const samples = new Float64Array(result.sampleCount);
  if (result.example === 'impulse') {
    samples[0] = 1;
    return samples;
  }
  const radius = Math.exp(-1 / (result.sampleRate * result.tauSeconds));
  const omega0 = 2 * Math.PI * result.f0Hz / result.sampleRate;
  for (let n = 0; n < samples.length; n++) {
    samples[n] = Math.pow(radius, n) * Math.cos(omega0 * n);
  }
  return samples;
}

function frequencyGrid(nyquistHz, count) {
  requirePositiveFinite(nyquistHz, 'nyquistHz');
  if (!Number.isInteger(count) || count < 2) throw new RangeError('count must be an integer of at least 2');
  const scale = 20;
  const span = Math.log1p(nyquistHz / scale);
  return Array.from({ length: count }, (_, i) => scale * Math.expm1(span * i / (count - 1)));
}

function frequencyEvidence(result, count = 720) {
  const frequencies = frequencyGrid(result.nyquistHz, count);
  const finiteDb = new Float64Array(count);
  const fullDb = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (result.example === 'impulse') {
      finiteDb[i] = 0;
      fullDb[i] = 0;
    } else {
      const finite = resonanceDtftMagnitude(
        frequencies[i], result.f0Hz, result.qualityFactor, result.sampleRate, result.sampleCount);
      const full = resonanceDtftMagnitude(
        frequencies[i], result.f0Hz, result.qualityFactor, result.sampleRate);
      // One common reference removes arbitrary DTFT sum scaling: the
      // infinite model's magnitude at f0 is exactly 0 dB.
      finiteDb[i] = 20 * Math.log10((finite + 1e-15) / result.referenceMagnitude);
      fullDb[i] = 20 * Math.log10((full + 1e-15) / result.referenceMagnitude);
    }
  }
  return { frequencies, finiteDb, fullDb };
}

function clampToInput(input, rawValue) {
  const min = Number.parseFloat(input.min);
  const max = Number.parseFloat(input.max);
  const step = Number.parseFloat(input.step);
  let value = rawValue;
  if (Number.isFinite(min)) value = Math.max(min, value);
  if (Number.isFinite(max)) value = Math.min(max, value);
  if (Number.isFinite(step) && step > 0 && Number.isFinite(min)) {
    value = min + Math.round((value - min) / step) * step;
    if (Number.isFinite(max)) value = Math.min(max, value);
  }
  return value;
}

function formatFrequency(value) {
  if (value >= 1000) {
    const digits = value >= 10000 || Math.abs(value % 1000) < 1e-9 ? 0 : 2;
    return `${(value / 1000).toFixed(digits)} kHz`;
  }
  return `${value.toFixed(value < 100 ? 1 : 0)} Hz`;
}

function rafThrottle(fn, requestFrame) {
  let pending = false;
  const raf = requestFrame || (callback => setTimeout(callback, 0));
  return function throttled(...args) {
    if (pending) return;
    pending = true;
    raf(() => {
      pending = false;
      fn(...args);
    });
  };
}

/* ------------------------------ plots ------------------------------ */

const COLORS = Object.freeze({
  finite: '#4da3ff', full: '#e8edf4', accent: '#ff9f43', omitted: '#e05c5c',
  target: '#3ecf8e', grid: '#27313d', axis: '#7d8899', border: '#39434f',
});
const MARGIN = Object.freeze({ left: 58, right: 24, top: 20, bottom: 30 });

function sizeCanvas(canvas, win) {
  const rect = canvas.getBoundingClientRect();
  const dpr = win.devicePixelRatio || 1;
  canvas.width = Math.max(2, Math.round(rect.width * dpr));
  canvas.height = Math.max(2, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function niceStep(raw) {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
  for (const multiplier of [1, 2, 5, 10]) {
    if (multiplier * power >= raw - 1e-12) return multiplier * power;
  }
  return 10 * power;
}

function drawTime(canvas, result, win) {
  const { ctx, width, height } = sizeCanvas(canvas, win);
  const p = MARGIN;
  const plotWidth = width - p.left - p.right;
  const plotHeight = height - p.top - p.bottom;
  const requestedMax = result.example === 'resonance'
    ? Math.max(result.durationMs * 1.6, result.requiredDurationMs * 1.05)
    : result.durationMs * 1.35;
  const cap = Math.max(result.durationMs * 8, 80);
  const timeMaxMs = result.example === 'resonance' ? Math.min(requestedMax, cap) : requestedMax;
  const x = timeMs => p.left + timeMs / timeMaxMs * plotWidth;
  const y = value => p.top + (1 - (value + 1.1) / 2.2) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;
  const timeStep = niceStep(timeMaxMs / 6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let time = 0; time <= timeMaxMs + timeStep * 0.25; time += timeStep) {
    if (time > timeMaxMs + 1e-9) break;
    const px = x(time);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(px, p.top); ctx.lineTo(px, height - p.bottom); ctx.stroke();
    ctx.fillStyle = COLORS.axis;
    const isLastTick = time + timeStep > timeMaxMs + 1e-9;
    const label = isLastTick ? `${time.toFixed(timeStep < 1 ? 1 : 0)} ms` : time.toFixed(timeStep < 1 ? 1 : 0);
    ctx.fillText(label, px, height - p.bottom + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const value of [-1, -0.5, 0, 0.5, 1]) {
    const py = y(value);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(p.left, py); ctx.lineTo(width - p.right, py); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(String(value), p.left - 6, py);
  }
  ctx.textBaseline = 'bottom'; ctx.fillText('ampl.', p.left - 6, p.top - 3);
  ctx.strokeStyle = COLORS.border; ctx.strokeRect(p.left, p.top, plotWidth, plotHeight);

  ctx.save();
  ctx.beginPath(); ctx.rect(p.left, p.top, plotWidth, plotHeight); ctx.clip();
  const gateX = x(result.durationMs);
  ctx.fillStyle = 'rgba(224,92,92,0.07)';
  ctx.fillRect(gateX, p.top, Math.max(0, width - p.right - gateX), plotHeight);

  if (result.example === 'impulse') {
    ctx.strokeStyle = COLORS.finite; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x(0), y(0)); ctx.lineTo(x(0), y(1)); ctx.stroke();
    ctx.fillStyle = COLORS.finite; ctx.beginPath(); ctx.arc(x(0), y(1), 3.5, 0, 2 * Math.PI); ctx.fill();
    const showEvery = Math.max(1, Math.ceil(result.sampleCount / 180));
    ctx.fillStyle = COLORS.full;
    for (let n = 1; n < result.sampleCount; n += showEvery) {
      ctx.beginPath(); ctx.arc(x(n / result.sampleRate * 1000), y(0), 1.7, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.strokeStyle = COLORS.finite; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x(0), y(0)); ctx.lineTo(x(timeMaxMs), y(0)); ctx.stroke();
  } else {
    const modelAt = timeMs => Math.exp(-timeMs * 1e-3 / result.tauSeconds) *
      Math.cos(2 * Math.PI * result.f0Hz * timeMs * 1e-3);
    const points = Math.max(500, Math.round(width * 1.5));
    ctx.strokeStyle = COLORS.full; ctx.lineWidth = 1.4; ctx.setLineDash([7, 5]);
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const timeMs = timeMaxMs * i / points;
      const px = x(timeMs), py = y(modelAt(timeMs));
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);

    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.1; ctx.setLineDash([4, 4]);
    for (const sign of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i <= 400; i++) {
        const timeMs = timeMaxMs * i / 400;
        const value = sign * Math.exp(-timeMs * 1e-3 / result.tauSeconds);
        i ? ctx.lineTo(x(timeMs), y(value)) : ctx.moveTo(x(timeMs), y(value));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const samples = generateFiniteIR(result);
    const showEvery = Math.max(1, Math.ceil(samples.length / 1200));
    ctx.strokeStyle = COLORS.finite; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let n = 0; n < samples.length; n += showEvery) {
      const px = x(n / result.sampleRate * 1000), py = y(samples[n]);
      n === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    const last = samples[samples.length - 1];
    ctx.beginPath(); ctx.moveTo(x((samples.length - 1) / result.sampleRate * 1000), y(last));
    ctx.lineTo(gateX, y(last)); ctx.lineTo(gateX, y(0)); ctx.lineTo(x(timeMaxMs), y(0));
    ctx.stroke();

    if (result.requiredDurationMs <= timeMaxMs) {
      const targetX = x(result.requiredDurationMs);
      ctx.strokeStyle = COLORS.target; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(targetX, p.top); ctx.lineTo(targetX, height - p.bottom); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.3; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(gateX, p.top); ctx.lineTo(gateX, height - p.bottom); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.fillStyle = COLORS.accent; ctx.textAlign = gateX > width - 120 ? 'right' : 'left'; ctx.textBaseline = 'top';
  ctx.fillText(`T = ${result.durationMs.toFixed(2)} ms`, gateX + (gateX > width - 120 ? -5 : 5), p.top + 5);
  if (result.example === 'resonance' && result.requiredDurationMs <= timeMaxMs) {
    const targetX = x(result.requiredDurationMs);
    ctx.fillStyle = COLORS.target; ctx.textAlign = targetX > width - 135 ? 'right' : 'left';
    ctx.fillText(`target at ${result.requiredDurationMs.toFixed(2)} ms`, targetX + (targetX > width - 135 ? -5 : 5), p.top + 20);
  }
}

function drawFrequency(canvas, result, win) {
  const { ctx, width, height } = sizeCanvas(canvas, win);
  const p = MARGIN;
  const plotWidth = width - p.left - p.right;
  const plotHeight = height - p.top - p.bottom;
  const scale = 20;
  const frequencySpan = Math.log1p(result.nyquistHz / scale);
  const x = frequency => p.left + Math.log1p(Math.max(0, frequency) / scale) / frequencySpan * plotWidth;
  const evidence = frequencyEvidence(result);

  let yMin = -12, yMax = 3;
  if (result.example === 'resonance') {
    let peak = -Infinity;
    for (let i = 0; i < evidence.finiteDb.length; i++) {
      peak = Math.max(peak, evidence.finiteDb[i], evidence.fullDb[i]);
    }
    yMax = Math.ceil((peak + 2) / 10) * 10;
    yMin = yMax - 70;
  }
  const y = db => p.top + (1 - (db - yMin) / (yMax - yMin)) * plotHeight;
  const clippedY = db => y(Math.max(yMin - 10, Math.min(yMax + 10, db)));

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  const tickCandidates = [0, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
    .filter(frequency => frequency === 0 || frequency <= result.nyquistHz * 0.78)
    .concat(result.nyquistHz);
  const ticks = tickCandidates.filter((frequency, index, list) => index === 0 || Math.abs(frequency - list[index - 1]) > 1e-9);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const frequency of ticks) {
    const px = x(frequency);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(px, p.top); ctx.lineTo(px, height - p.bottom); ctx.stroke();
    ctx.fillStyle = COLORS.axis;
    const label = frequency === 0 ? 'DC' : frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
    ctx.fillText(frequency === result.nyquistHz ? `${label} Hz` : label, px, height - p.bottom + 6);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const dbStep = result.example === 'impulse' ? 3 : 10;
  for (let db = Math.ceil(yMin / dbStep) * dbStep; db <= yMax + 1e-9; db += dbStep) {
    const py = y(db);
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(p.left, py); ctx.lineTo(width - p.right, py); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(String(db), p.left - 6, py);
  }
  ctx.textBaseline = 'bottom'; ctx.fillText('dB', p.left - 6, p.top - 3);
  ctx.strokeStyle = COLORS.border; ctx.strokeRect(p.left, p.top, plotWidth, plotHeight);

  ctx.save(); ctx.beginPath(); ctx.rect(p.left, p.top, plotWidth, plotHeight); ctx.clip();
  if (result.example === 'resonance') {
    const lo = Math.max(0, result.f0Hz - result.dftSpacingHz / 2);
    const hi = Math.min(result.nyquistHz, result.f0Hz + result.dftSpacingHz / 2);
    ctx.fillStyle = 'rgba(224,92,92,0.08)';
    ctx.fillRect(x(lo), p.top, Math.max(1, x(hi) - x(lo)), plotHeight);
  }

  function curve(values, color, widthPx, dash) {
    ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.setLineDash(dash || []); ctx.beginPath();
    for (let i = 0; i < evidence.frequencies.length; i++) {
      const px = x(evidence.frequencies[i]), py = clippedY(values[i]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  curve(evidence.fullDb, COLORS.full, 1.4, [7, 5]);
  curve(evidence.finiteDb, COLORS.finite, 2.2);

  const binCount = Math.floor(result.sampleCount / 2) + 1;
  const binStride = Math.max(1, Math.ceil(binCount / 320));
  ctx.fillStyle = COLORS.full;
  for (let k = 0; k < binCount; k += binStride) {
    const frequency = k * result.dftSpacingHz;
    const magnitude = result.example === 'impulse' ? 1 : resonanceDtftMagnitude(
      frequency, result.f0Hz, result.qualityFactor, result.sampleRate, result.sampleCount);
    const db = result.example === 'impulse'
      ? 0
      : 20 * Math.log10((magnitude + 1e-15) / result.referenceMagnitude);
    ctx.beginPath(); ctx.arc(x(frequency), clippedY(db), 2.1, 0, 2 * Math.PI); ctx.fill();
  }

  if (result.example === 'resonance') {
    const markerX = x(result.f0Hz);
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(markerX, p.top); ctx.lineTo(markerX, height - p.bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  if (result.example === 'resonance') {
    const markerX = x(result.f0Hz);
    ctx.fillStyle = COLORS.accent; ctx.textAlign = markerX > width - 105 ? 'right' : 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`f₀ ${formatFrequency(result.f0Hz)}`, markerX + (markerX > width - 105 ? -5 : 5), p.top + 5);
  } else {
    ctx.fillStyle = COLORS.finite; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('H(eʲω) = 1, including DC', p.left + 8, p.top + 7);
  }
}

function formatReadout(result) {
  const sampling = `T = <b>${result.durationMs.toFixed(2)} ms</b> · F<sub>s</sub> = <b>${formatFrequency(result.sampleRate)}</b> · ` +
    `N = <b>${result.sampleCount} samples</b> · unpadded DFT spacing = <b>${formatFrequency(result.dftSpacingHz)}</b> · ` +
    `Nyquist = <b>${formatFrequency(result.nyquistHz)}</b>. `;
  if (result.example === 'impulse') {
    return sampling + `<span class="ok">The nonzero response is fully contained in one tap.</span> ` +
      `Because h[0] = 1 and every later sample is zero, <b>|H(e<sup>jω</sup>)| = 1 (0 dB)</b> at DC, ` +
      `below 1/T, between the DFT dots, and up to Nyquist. Changing T changes N and dot spacing, not a nonexistent low-frequency cutoff.`;
  }

  const verdict = result.contained
    ? `<span class="ok">Contained to the selected ${result.targetDb} dB amplitude criterion.</span>`
    : `<span class="warn">Truncated: the omitted tail is still above the selected ${result.targetDb} dB amplitude criterion.</span>`;
  const nyquistNote = result.minimumFrequencyHz > result.nyquistHz
    ? ` The equivalent contained-frequency bound is above Nyquist at this F<sub>s</sub>, so no representable f<sub>0</sub> at this Q meets that target in T.`
    : ` Equivalently, at Q = ${result.qualityFactor.toFixed(1)} the criterion needs f<sub>0</sub> ≥ <b>${formatFrequency(result.minimumFrequencyHz)}</b>.`;
  return sampling +
    `For f<sub>0</sub> = <b>${formatFrequency(result.f0Hz)}</b> and Q = <b>${result.qualityFactor.toFixed(1)}</b>, ` +
    `τ = Q/(πf<sub>0</sub>) = <b>${result.tauMs.toFixed(3)} ms</b>. At the gate boundary the amplitude envelope is ` +
    `<b>${result.residualDb.toFixed(2)} dB</b> (${(result.residualAmplitude * 100).toFixed(1)}%). ` + verdict + ` It needs T ≥ <b>${result.requiredDurationMs.toFixed(2)} ms</b>; ` +
    `at this f<sub>0</sub> and T the criterion-specific bound is Q ≤ <b>${result.qMax.toFixed(2)}</b>.` + nyquistNote +
    ` With the full model at f<sub>0</sub> defined as the common <b>0 dB reference</b>, the finite record is ` +
    `<b>${result.finiteAtF0Db.toFixed(2)} dB</b> there—its truncation level error relative to the full model. ` +
    `<span class="hl">These are decay-containment bounds, not a universal lowest frequency or Q limit; F<sub>s</sub> alone does not change them.</span>`;
}

/* ---------------------- prediction and quiz ------------------------ */

function clearElement(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else while (element.firstChild) element.removeChild(element.firstChild);
}

function makeElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderPrediction(doc, optionsBox, feedback) {
  clearElement(optionsBox);
  delete optionsBox.dataset.done;
  feedback.style.display = 'none';
  feedback.textContent = '';
  const buttons = PREDICTION.options.map((option, index) => {
    const button = makeElement(doc, 'button', 'padbtn', option);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (optionsBox.dataset.done) return;
      optionsBox.dataset.done = '1';
      const correct = index === PREDICTION.correct;
      button.classList.add(correct ? 'qgood' : 'qbad');
      if (!correct) buttons[PREDICTION.correct].classList.add('qgood');
      feedback.style.display = 'block';
      feedback.textContent = `${correct ? '✓ Right.' : '✗ Not quite.'} ${PREDICTION.why}`;
    });
    optionsBox.appendChild(button);
    return button;
  });
  return buttons;
}

function renderQuiz(doc, quizBox, scoreElement) {
  clearElement(quizBox);
  let score = 0;
  let answered = 0;
  function updateScore() {
    scoreElement.textContent = answered
      ? ` Score: ${score} correct of ${answered} answered (${QUIZ.length} total).`
      : '';
  }
  updateScore();

  const rows = QUIZ.map((item, index) => {
    const card = makeElement(doc, 'div', 'qz');
    const question = makeElement(doc, 'div', 'qtext', `${index + 1}. ${item.q}`);
    const buttonRow = makeElement(doc, 'div', 'button-row');
    const feedback = makeElement(doc, 'div', 'feedback');
    feedback.setAttribute('role', 'status');
    card.appendChild(question); card.appendChild(buttonRow); card.appendChild(feedback);
    const buttons = ['True', 'False'].map((label, buttonIndex) => {
      const button = makeElement(doc, 'button', 'padbtn', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        if (card.dataset.done) return;
        card.dataset.done = '1';
        answered++;
        const correct = (buttonIndex === 0) === item.answer;
        if (correct) {
          score++; button.classList.add('qgood');
        } else {
          button.classList.add('qbad');
          buttons[item.answer ? 0 : 1].classList.add('qgood');
        }
        feedback.style.display = 'block';
        feedback.textContent = `${correct ? '✓ Correct.' : '✗ Not quite.'} ${item.why}`;
        updateScore();
      });
      buttonRow.appendChild(button);
      return button;
    });
    quizBox.appendChild(card);
    return { card, buttons, feedback };
  });
  return { rows, getScore: () => ({ score, answered }) };
}

/* --------------------------- DOM app ------------------------------- */

function getRequiredElements(doc) {
  const elements = {};
  for (const id of REQUIRED_IDS) {
    const element = doc.getElementById(id);
    if (!element) throw new Error(`Missing required lesson element #${id}`);
    elements[id] = element;
  }
  return elements;
}

function installChapterLinks(doc, win) {
  const links = Array.from(doc.querySelectorAll('a.hlink'));
  for (const link of links) {
    link.addEventListener('click', event => {
      event.preventDefault();
      const hash = link.getAttribute('href');
      const base = win.location ? win.location.href.split('#')[0] : '';
      const url = base + hash;
      if (win.history && win.history.replaceState) {
        try { win.history.replaceState(null, '', hash); } catch (error) { /* sandbox or file URL */ }
      }
      const showCopied = () => {
        link.classList.add('copied');
        const later = win.setTimeout || setTimeout;
        later(() => link.classList.remove('copied'), 1200);
      };
      const clipboard = win.navigator && win.navigator.clipboard;
      if (clipboard && clipboard.writeText) clipboard.writeText(url).then(showCopied, showCopied);
      else showCopied();
    });
  }
  return links;
}

function initLesson(doc, win) {
  if (!doc || !win) throw new TypeError('initLesson requires document and window objects');
  const elements = getRequiredElements(doc);
  const state = { ...DEFAULT_STATE };
  let quizView;

  function syncFrequencyLimit() {
    const limit = state.sampleRate / 2;
    elements.f0Hz.max = String(limit);
    if (state.f0Hz > limit) state.f0Hz = limit;
    state.f0Hz = clampToInput(elements.f0Hz, state.f0Hz);
    elements.f0Hz.value = String(state.f0Hz);
  }

  function updateLabels() {
    elements.durationValue.textContent = `${state.durationMs.toFixed(2)} ms`;
    elements.f0Value.textContent = formatFrequency(state.f0Hz);
    elements.qualityValue.textContent = state.qualityFactor.toFixed(1);
    elements.resonanceControls.disabled = state.example === 'impulse';
  }

  function draw() {
    const result = calculateLesson(state);
    drawTime(elements.timeCanvas, result, win);
    drawFrequency(elements.frequencyCanvas, result, win);
    elements.demoReadout.innerHTML = formatReadout(result);
    return result;
  }

  const requestFrame = win.requestAnimationFrame
    ? win.requestAnimationFrame.bind(win)
    : callback => setTimeout(callback, 0);
  const throttledDraw = rafThrottle(draw, requestFrame);

  elements.exampleType.addEventListener('change', () => {
    state.example = elements.exampleType.value;
    updateLabels(); throttledDraw();
  });
  elements.durationMs.addEventListener('input', () => {
    state.durationMs = clampToInput(elements.durationMs, Number.parseFloat(elements.durationMs.value));
    elements.durationMs.value = String(state.durationMs);
    updateLabels(); throttledDraw();
  });
  elements.sampleRate.addEventListener('change', () => {
    state.sampleRate = Number.parseFloat(elements.sampleRate.value);
    syncFrequencyLimit(); updateLabels(); throttledDraw();
  });
  elements.f0Hz.addEventListener('input', () => {
    state.f0Hz = clampToInput(elements.f0Hz, Number.parseFloat(elements.f0Hz.value));
    elements.f0Hz.value = String(state.f0Hz);
    updateLabels(); throttledDraw();
  });
  elements.qualityFactor.addEventListener('input', () => {
    state.qualityFactor = clampToInput(elements.qualityFactor, Number.parseFloat(elements.qualityFactor.value));
    elements.qualityFactor.value = String(state.qualityFactor);
    updateLabels(); throttledDraw();
  });
  elements.targetDb.addEventListener('change', () => {
    state.targetDb = Number.parseFloat(elements.targetDb.value);
    throttledDraw();
  });

  function resetDemo() {
    Object.assign(state, DEFAULT_STATE);
    elements.exampleType.value = state.example;
    elements.durationMs.value = String(state.durationMs);
    elements.sampleRate.value = String(state.sampleRate);
    elements.f0Hz.value = String(state.f0Hz);
    elements.qualityFactor.value = String(state.qualityFactor);
    elements.targetDb.value = String(state.targetDb);
    syncFrequencyLimit(); updateLabels(); draw();
  }

  elements.demoReset.addEventListener('click', resetDemo);
  elements.quizReset.addEventListener('click', () => {
    quizView = renderQuiz(doc, elements.quizBox, elements.quizScore);
  });

  syncFrequencyLimit();
  updateLabels();
  const predictionButtons = renderPrediction(doc, elements.predictionOptions, elements.predictionWhy);
  quizView = renderQuiz(doc, elements.quizBox, elements.quizScore);
  installChapterLinks(doc, win);

  let resizeTimer = null;
  win.addEventListener('resize', () => {
    const clear = win.clearTimeout || clearTimeout;
    const later = win.setTimeout || setTimeout;
    clear(resizeTimer);
    resizeTimer = later(draw, 150);
  });
  draw();

  return {
    state,
    elements,
    draw,
    resetDemo,
    predictionButtons,
    get quizView() { return quizView; },
  };
}

function boot() {
  if (!window.irDurationLesson) window.irDurationLesson = initLesson(document, window);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_STATE,
    REQUIRED_IDS,
    PREDICTION,
    QUIZ,
    targetAmplitude,
    sampleMetrics,
    tauFromQ,
    containmentTimeSeconds,
    maxContainedQ,
    minContainedFrequency,
    dtftComplex,
    dtftMagnitude,
    impulseDtftMagnitude,
    resonanceDtftComplex,
    resonanceDtftMagnitude,
    calculateLesson,
    generateFiniteIR,
    frequencyGrid,
    frequencyEvidence,
    clampToInput,
    formatFrequency,
    rafThrottle,
    drawTime,
    drawFrequency,
    formatReadout,
    renderPrediction,
    renderQuiz,
    initLesson,
  };
}
