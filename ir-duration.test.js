#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lesson = require('./ir-duration.js');

let failures = 0;
let passes = 0;

function test(name, fn) {
  try {
    fn();
    passes++;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`);
    console.error(`     ${error.stack || error.message}`);
  }
}

function nearlyEqual(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

/* ------------------------- HTML contract ---------------------------- */

const htmlPath = path.join(__dirname, 'ir-duration.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('HTML loads the matching JavaScript file', () => {
  assert.match(html, /<script\s+src=["']ir-duration\.js["']><\/script>/);
});

test('every JavaScript-required ID exists in the HTML', () => {
  for (const id of lesson.REQUIRED_IDS) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`\\bid=["']${escaped}["']`), `missing #${id}`);
  }
});

test('published lesson keeps semantic chapters and accessible non-canvas output', () => {
  for (const id of ['idea', 'demo-1', 'takeaways', 'quiz']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing chapter #${id}`);
  }
  assert.match(html, /<main>/);
  assert.equal((html.match(/\bid=["']demo-\d+["']/g) || []).length, 1, 'expected one central demo');
  assert.ok((html.match(/<canvas[^>]+aria-label=/g) || []).length >= 4, 'all four plots need canvas labels');
  assert.match(html, /id=["']demoReadout["'][^>]+aria-live=["']polite["']/);
  assert.match(html, /<noscript>/);
  assert.doesNotMatch(html, /author-note|author-checklist|Author TODO|TEMPLATE:/i);
});

test('lesson states the correction and links its source discussion', () => {
  assert.match(html, /no hard lowest frequency/i);
  assert.match(html, /H\(e<sup>jω<\/sup>\) = 1/);
  assert.match(html, /characteristic spectral-detail and rectangular-truncation scale/i);
  assert.match(html, /both curves use its level at f<sub>0<\/sub> as\s+one common 0 dB reference/i);
  assert.match(html, /Guided scenarios/);
  assert.match(html, /id=["']scenarioPresets["'][^>]+role=["']group["']/);
  assert.match(html, /Frequency evidence — dB relative to full model at f₀ \(0 dB\)/);
  assert.match(html, /Containment map — Q<sub>max<\/sub>\(f<sub>0<\/sub>\)/);
  assert.match(html, /Gate-length convergence — envelope remaining at T versus finite\/full level error at f₀/);
  assert.match(html, /criterion map, not a hard\s+minimum-frequency chart/i);
  assert.match(html, /tail containment and spectral\s+accuracy are related—not identical—criteria/i);
  assert.match(html, /https:\/\/claude\.ai\/share\/78a940c2-4381-49ef-b768-8f41dcfb4a7b/);
});

test('parameter bounds separate representation, containment, and estimation rules', () => {
  assert.match(html, /0 ≤ f<sub>0<\/sub> ≤ F<sub>s<\/sub>\/2/);
  assert.match(html, /τ ≤ T\/ln\(1\/ε\)/);
  assert.match(html, /Q ≤ πf<sub>0<\/sub>T\/ln\(1\/ε\)/);
  assert.match(html, /τ ≥ m\/F<sub>s<\/sub>/);
  assert.match(html, /user-chosen estimation\s+robustness rule, not a representation law/i);
  assert.match(html, /lightly damped approximation/i);
  assert.match(html, /not hard limits such as an arbitrary F<sub>s<\/sub>\/4 cutoff/i);
});

/* ----------------------- headline mathematics ---------------------- */

test('guided scenarios encode the four intended comparisons', () => {
  assert.deepEqual(lesson.SCENARIO_PRESETS.map(preset => preset.id), [
    'impulse-counterexample', 'truncated-default', 'just-contained', 'double-sample-rate',
  ]);
  const [impulse, truncated, contained, doubled] = lesson.SCENARIO_PRESETS;
  assert.equal(impulse.state.example, 'impulse');
  assert.deepEqual(truncated.state, lesson.DEFAULT_STATE);
  assert.equal(lesson.calculateLesson(contained.state).contained, true);
  assert.equal(contained.state.f0Hz, truncated.state.f0Hz);
  assert.equal(contained.state.qualityFactor, truncated.state.qualityFactor);
  assert.equal(doubled.state.durationMs, truncated.state.durationMs);
  assert.equal(doubled.state.sampleRate, 2 * truncated.state.sampleRate);
  nearlyEqual(lesson.calculateLesson(doubled.state).residualDb,
    lesson.calculateLesson(truncated.state).residualDb, 1e-14,
    'doubling Fs preset leaves decay containment unchanged');
});

test('headline tau, required duration, Q bound, and frequency bound are correct', () => {
  const f0 = 1000;
  const q = 10;
  const duration = 0.001;
  const epsilon = 0.01;
  const expectedTau = q / (Math.PI * f0);
  const expectedRequired = expectedTau * Math.log(1 / epsilon);
  const expectedQMax = Math.PI * f0 * duration / Math.log(1 / epsilon);
  const expectedFMin = q * Math.log(1 / epsilon) / (Math.PI * duration);

  nearlyEqual(lesson.targetAmplitude(-40), epsilon, 1e-15, '−40 dB amplitude');
  nearlyEqual(lesson.tauFromQ(f0, q), expectedTau, 1e-15, 'tau = Q/(pi f0)');
  nearlyEqual(lesson.containmentTimeSeconds(f0, q, -40), expectedRequired, 1e-15, 'required duration');
  nearlyEqual(lesson.maxContainedQ(duration, f0, -40), expectedQMax, 1e-15, 'Q bound');
  nearlyEqual(lesson.minContainedFrequency(duration, q, -40), expectedFMin, 1e-9, 'frequency bound');

  const result = lesson.calculateLesson(lesson.DEFAULT_STATE);
  nearlyEqual(result.tauSeconds, expectedTau, 1e-15, 'default tau');
  nearlyEqual(result.requiredDurationSeconds, expectedRequired, 1e-15, 'default required duration');
  nearlyEqual(result.qMax, expectedQMax, 1e-15, 'default Q bound');
  assert.equal(result.contained, false);
  assert.ok(result.residualDb > -3 && result.residualDb < -2.5, `default boundary level was ${result.residualDb} dB`);
});

test('containment boundary is criterion-dependent and includes equality', () => {
  const durationSeconds = 0.001;
  const f0 = 1000;
  const qBoundary = lesson.maxContainedQ(durationSeconds, f0, -40);
  const base = { example: 'resonance', durationMs: 1, sampleRate: 48000, f0Hz: f0, targetDb: -40 };
  const onBoundary = lesson.calculateLesson({ ...base, qualityFactor: qBoundary });
  const justInside = lesson.calculateLesson({ ...base, qualityFactor: qBoundary * (1 - 1e-6) });
  const justOutside = lesson.calculateLesson({ ...base, qualityFactor: qBoundary * (1 + 1e-6) });

  nearlyEqual(onBoundary.residualAmplitude, 0.01, 2e-15, 'boundary amplitude');
  assert.equal(onBoundary.contained, true);
  assert.equal(justInside.contained, true);
  assert.equal(justOutside.contained, false);
  assert.ok(lesson.maxContainedQ(durationSeconds, f0, -20) > qBoundary);
  assert.ok(lesson.maxContainedQ(durationSeconds, f0, -60) < qBoundary);
});

test('containment map encodes target-dependent Q bounds and the Nyquist edge', () => {
  const result = lesson.calculateLesson(lesson.DEFAULT_STATE);
  const map = lesson.containmentMapData(result, 41);
  assert.equal(map.frequencies.length, 41);
  nearlyEqual(map.frequencies[0], 20, 1e-12, 'map lower display frequency');
  nearlyEqual(map.frequencies[40], result.nyquistHz, 1e-9, 'map ends at Nyquist');
  assert.equal(map.selectedTargetDb, -40);
  assert.deepEqual(map.curves.map(curve => curve.targetDb), [-20, -40, -60]);
  const last = map.curves.map(curve => curve.qMax[40]);
  assert.ok(last[0] > last[1] && last[1] > last[2], 'looser target permits larger Q');
  nearlyEqual(map.current.qBoundary, result.qMax, 1e-15, 'current map boundary matches readout');
  assert.equal(map.current.contained, false);

  const longer = lesson.containmentMapData(
    lesson.calculateLesson({ ...lesson.DEFAULT_STATE, durationMs: 2 }), 41);
  nearlyEqual(longer.selectedCurve.qMax[20], 2 * map.selectedCurve.qMax[20], 1e-12,
    'doubling T doubles the map Q boundary');
});

test('gate convergence distinguishes tail criterion from normalized spectral error', () => {
  const result = lesson.calculateLesson(lesson.DEFAULT_STATE);
  const data = lesson.gateConvergenceData(result, 80);
  assert.equal(data.durationsMs.length, 80);
  nearlyEqual(data.durationsMs[0], 1000 / result.sampleRate, 1e-12, 'convergence starts at one sample');
  nearlyEqual(data.currentTailDb, result.residualDb, 1e-14, 'current tail marker');
  nearlyEqual(data.currentSpectralErrorDb, result.truncationAtF0Db, 1e-14, 'current spectral marker');
  assert.ok(data.tailDb[data.tailDb.length - 1] < result.targetDb,
    'convergence range extends beyond selected tail target');
  assert.ok(Array.from(data.spectralErrorDb).every(Number.isFinite), 'spectral convergence values are finite');
  assert.notEqual(data.currentTailDb.toFixed(2), data.currentSpectralErrorDb.toFixed(2),
    'tail level and spectral error are not conflated');

  const impulse = lesson.calculateLesson({ example: 'impulse', durationMs: 1, sampleRate: 48000 });
  assert.equal(lesson.containmentMapData(impulse), null);
  const impulseData = lesson.gateConvergenceData(impulse, 24);
  assert.ok(Array.from(impulseData.spectralErrorDb).every(value => value === 0));
});

test('canvas coordinate helpers map plot interiors to parameters and duration', () => {
  const result = lesson.calculateLesson(lesson.DEFAULT_STATE);
  const width = 900, height = 270;
  const lowerLeft = lesson.containmentParametersAtCanvasPoint(result, 58, height - 34, width, height);
  const upperRight = lesson.containmentParametersAtCanvasPoint(result, width - 34, 22, width, height);
  nearlyEqual(lowerLeft.f0Hz, 20, 1e-12, 'containment left edge frequency');
  nearlyEqual(lowerLeft.qualityFactor, 0.1, 1e-12, 'containment bottom edge Q');
  nearlyEqual(upperRight.f0Hz, result.nyquistHz, 1e-9, 'containment right edge Nyquist');
  nearlyEqual(upperRight.qualityFactor, 100, 1e-10, 'containment top edge Q');
  assert.equal(lesson.containmentParametersAtCanvasPoint(result, 20, 20, width, height), null);

  const range = lesson.gateConvergenceRange(result);
  nearlyEqual(lesson.convergenceDurationAtCanvasPoint(result, 58, 100, width, height),
    range.minimumDurationMs, 1e-12, 'convergence left edge');
  nearlyEqual(lesson.convergenceDurationAtCanvasPoint(result, width - 28, 100, width, height),
    range.maximumDurationMs, 1e-10, 'convergence right edge');
  assert.equal(lesson.convergenceDurationAtCanvasPoint(result, width / 2, 5, width, height), null);
});

test('single-tap impulse is exactly flat, including DC and below 1/T', () => {
  const state = { example: 'impulse', durationMs: 1, sampleRate: 48000 };
  const samples = lesson.generateFiniteIR(state);
  assert.equal(samples.length, 48);
  assert.equal(samples[0], 1);
  assert.ok(Array.from(samples.slice(1)).every(value => value === 0));
  for (const frequency of [0, 1, 20, 100, 999, 1000, 12345, 24000]) {
    nearlyEqual(lesson.impulseDtftMagnitude(frequency, 48000), 1, 0, `analytic impulse at ${frequency} Hz`);
    nearlyEqual(lesson.dtftMagnitude(samples, frequency, 48000), 1, 1e-14, `finite impulse at ${frequency} Hz`);
  }
  const evidence = lesson.frequencyEvidence(lesson.calculateLesson(state), 32);
  assert.ok(Array.from(evidence.finiteDb).every(db => Math.abs(db) < 1e-14));
  assert.ok(Array.from(evidence.fullDb).every(db => Math.abs(db) < 1e-14));
});

test('closed-form finite resonance DTFT matches direct summation', () => {
  const state = { example: 'resonance', durationMs: 2, sampleRate: 48000,
    f0Hz: 1500, qualityFactor: 7, targetDb: -40 };
  const result = lesson.calculateLesson(state);
  const samples = lesson.generateFiniteIR(state);
  for (const frequency of [0, 200, 1500, 3333, 24000]) {
    const direct = lesson.dtftMagnitude(samples, frequency, state.sampleRate);
    const closed = lesson.resonanceDtftMagnitude(
      frequency, state.f0Hz, state.qualityFactor, state.sampleRate, result.sampleCount);
    nearlyEqual(closed, direct, 2e-12, `finite DTFT at ${frequency} Hz`);
  }
});

test('resonance spectra share the full model at f0 as a 0 dB reference', () => {
  const results = [24000, 48000, 96000].map(sampleRate =>
    lesson.calculateLesson({ ...lesson.DEFAULT_STATE, sampleRate }));
  for (const result of results) {
    nearlyEqual(result.fullAtF0Db, 0, 0, 'full model reference at f0');
    const expectedError = 20 * Math.log10(result.finiteAtF0 / result.fullAtF0);
    nearlyEqual(result.finiteAtF0Db, expectedError, 1e-14, 'finite level relative to full model');
    nearlyEqual(result.truncationAtF0Db, expectedError, 1e-14, 'reported truncation error');
    const evidence = lesson.frequencyEvidence(result, 32);
    const frequency = evidence.frequencies[7];
    const fullMagnitude = lesson.resonanceDtftMagnitude(
      frequency, result.f0Hz, result.qualityFactor, result.sampleRate);
    nearlyEqual(evidence.fullDb[7], 20 * Math.log10((fullMagnitude + 1e-15) / result.fullAtF0),
      1e-12, 'full plotted curve uses common reference');
  }
  nearlyEqual(results[1].finiteAtF0Db, -11.385688942542272, 1e-12, 'default truncation error at f0');
  nearlyEqual(results[0].finiteAtF0Db, results[2].finiteAtF0Db, 1e-12,
    'normalized f0 error does not carry arbitrary Fs scaling');
});

test('Fs controls sample count and Nyquist while T controls DFT spacing', () => {
  const rates = [24000, 48000, 96000];
  const metrics = rates.map(sampleRate => lesson.sampleMetrics(1, sampleRate));
  assert.deepEqual(metrics.map(item => item.sampleCount), [24, 48, 96]);
  assert.deepEqual(metrics.map(item => item.nyquistHz), [12000, 24000, 48000]);
  assert.deepEqual(metrics.map(item => item.dftSpacingHz), [1000, 1000, 1000]);

  const fixedModel = rates.map(sampleRate => lesson.calculateLesson({ ...lesson.DEFAULT_STATE, sampleRate }));
  for (let i = 1; i < fixedModel.length; i++) {
    nearlyEqual(fixedModel[i].residualAmplitude, fixedModel[0].residualAmplitude, 1e-15, 'Fs-independent residual');
    nearlyEqual(fixedModel[i].qMax, fixedModel[0].qMax, 1e-15, 'Fs-independent Q bound');
  }

  const oneMs = lesson.calculateLesson(lesson.DEFAULT_STATE);
  const twoMs = lesson.calculateLesson({ ...lesson.DEFAULT_STATE, durationMs: 2 });
  assert.equal(twoMs.sampleCount, 2 * oneMs.sampleCount);
  nearlyEqual(twoMs.dftSpacingHz, oneMs.dftSpacingHz / 2, 1e-12, 'doubling T halves spacing');
  nearlyEqual(twoMs.qMax, 2 * oneMs.qMax, 1e-12, 'doubling T doubles containment Q bound');
  assert.ok(twoMs.residualAmplitude < oneMs.residualAmplitude);
});

test('model rejects invalid values and a resonance above Nyquist', () => {
  assert.throws(() => lesson.sampleMetrics(0, 48000), RangeError);
  assert.throws(() => lesson.targetAmplitude(0), RangeError);
  assert.throws(() => lesson.tauFromQ(1000, 0), RangeError);
  assert.throws(() => lesson.calculateLesson({ example: 'unknown' }), RangeError);
  assert.throws(() => lesson.calculateLesson({ ...lesson.DEFAULT_STATE, sampleRate: 24000, f0Hz: 13000 }), /Nyquist/);
  assert.throws(() => lesson.frequencyGrid(24000, 1), RangeError);
});

test('control values clamp and animation throttling coalesces work', () => {
  const input = { min: '0.25', max: '20', step: '0.25' };
  assert.equal(lesson.clampToInput(input, 0), 0.25);
  assert.equal(lesson.clampToInput(input, 20.2), 20);
  assert.equal(lesson.clampToInput(input, 1.13), 1.25);

  const queue = [];
  let calls = 0;
  const throttled = lesson.rafThrottle(() => { calls++; }, callback => queue.push(callback));
  throttled(); throttled(); throttled();
  assert.equal(queue.length, 1);
  assert.equal(calls, 0);
  queue.shift()();
  assert.equal(calls, 1);
});

/* ---------------------- minimal headless DOM ------------------------ */

function makeContext() {
  return new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return () => ({ width: 20 });
      if (typeof key === 'symbol') return undefined;
      if (!(key in target)) target[key] = () => {};
      return target[key];
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function makeClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
  };
}

function makeElement(tagName = 'div', id = '') {
  const handlers = new Map();
  const attributes = new Map();
  const element = {
    tagName: tagName.toUpperCase(), id, type: '', value: '', min: '', max: '', step: '',
    disabled: false, width: 0, height: 0, textContent: '', innerHTML: '', className: '',
    children: [], dataset: {}, style: {}, classList: makeClassList(),
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    replaceChildren(...children) { this.children = []; children.forEach(child => this.appendChild(child)); },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    fire(type, suppliedEvent = {}) {
      const event = { preventDefault() {}, target: this, ...suppliedEvent };
      for (const fn of handlers.get(type) || []) fn(event);
    },
    getContext() { return makeContext(); },
    getBoundingClientRect() { return { width: 900, height: 270, left: 0, top: 0 }; },
    setPointerCapture() {},
  };
  Object.defineProperty(element, 'firstChild', { get() { return this.children[0] || null; } });
  return element;
}

function makeHeadlessEnvironment() {
  const elements = new Map();
  const canvasIds = new Set(['timeCanvas', 'frequencyCanvas', 'containmentCanvas', 'convergenceCanvas']);
  const selectIds = new Set(['exampleType', 'sampleRate', 'targetDb']);
  for (const id of lesson.REQUIRED_IDS) {
    const tag = canvasIds.has(id) ? 'canvas' : selectIds.has(id) ? 'select' : id === 'resonanceControls' ? 'fieldset' : 'div';
    elements.set(id, makeElement(tag, id));
  }

  elements.get('exampleType').value = 'resonance';
  const duration = elements.get('durationMs');
  duration.value = '1'; duration.min = '0.25'; duration.max = '20'; duration.step = '0.25';
  elements.get('sampleRate').value = '48000';
  const f0 = elements.get('f0Hz');
  f0.value = '1000'; f0.min = '20'; f0.max = '24000'; f0.step = '10';
  const q = elements.get('qualityFactor');
  q.value = '10'; q.min = '0.1'; q.max = '100'; q.step = '0.1';
  elements.get('targetDb').value = '-40';
  for (const id of ['demoReset', 'quizReset']) elements.get(id).tagName = 'BUTTON';

  const document = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const windowHandlers = new Map();
  const window = {
    devicePixelRatio: 1,
    requestAnimationFrame(fn) { fn(); return 1; },
    addEventListener(type, fn) { windowHandlers.set(type, fn); },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
  };
  return { document, window, elements, windowHandlers };
}

/* ----------------------- browser smoke checks ----------------------- */

test('lesson initializes, draws all responsive canvases, and tells the default truncation story', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  assert.deepEqual(app.state, { ...lesson.DEFAULT_STATE });
  assert.equal(env.elements.get('timeCanvas').width, 900);
  assert.equal(env.elements.get('frequencyCanvas').height, 270);
  assert.equal(env.elements.get('containmentCanvas').width, 900);
  assert.equal(env.elements.get('convergenceCanvas').height, 270);
  assert.match(env.elements.get('demoReadout').innerHTML, /48 samples/);
  assert.match(env.elements.get('demoReadout').innerHTML, /Truncated/);
  assert.match(env.elements.get('demoReadout').innerHTML, /3\.183 ms/);
  assert.match(env.elements.get('demoReadout').innerHTML, /common <b>0 dB reference<\/b>/);
  assert.match(env.elements.get('demoReadout').innerHTML, /finite record is <b>-11\.39 dB<\/b>/);
  assert.equal(app.presetButtons.length, lesson.SCENARIO_PRESETS.length);
  assert.ok(app.presetButtons[1].classList.contains('active'));
  assert.equal(app.presetButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(app.predictionButtons.length, lesson.PREDICTION.options.length);
  assert.equal(app.quizView.rows.length, lesson.QUIZ.length);
});

test('guided scenario buttons apply complete states and track the active scenario', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);

  app.presetButtons[0].fire('click');
  assert.equal(app.state.example, 'impulse');
  assert.equal(env.elements.get('resonanceControls').disabled, true);
  assert.match(env.elements.get('demoReadout').innerHTML, /at DC/);
  assert.ok(app.presetButtons[0].classList.contains('active'));

  app.presetButtons[2].fire('click');
  assert.equal(app.state.durationMs, 14.75);
  assert.equal(lesson.calculateLesson(app.state).contained, true);
  assert.match(env.elements.get('demoReadout').innerHTML, /Contained/);
  assert.ok(app.presetButtons[2].classList.contains('active'));

  app.presetButtons[3].fire('click');
  assert.equal(app.state.durationMs, 1);
  assert.equal(app.state.sampleRate, 96000);
  assert.match(env.elements.get('demoReadout').innerHTML, /96 samples/);
  assert.match(env.elements.get('demoReadout').innerHTML, /Nyquist = <b>48 kHz/);
  assert.ok(app.presetButtons[3].classList.contains('active'));

  const duration = env.elements.get('durationMs');
  duration.value = '2'; duration.fire('input');
  assert.ok(app.presetButtons.every(button => !button.classList.contains('active')),
    'manual edits clear preset selection');
  env.elements.get('demoReset').fire('click');
  assert.ok(app.presetButtons[1].classList.contains('active'));
});

test('direct graph manipulation updates f0, Q, and T through the existing controls', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const width = 900, height = 270;
  const mapWidth = width - 58 - 34;
  const mapHeight = height - 22 - 34;
  const mapX = 58 + Math.log(2000 / 20) / Math.log(24000 / 20) * mapWidth;
  const mapY = 22 + (1 - Math.log(2 / 0.1) / Math.log(100 / 0.1)) * mapHeight;
  const map = env.elements.get('containmentCanvas');
  map.fire('pointerdown', { clientX: mapX, clientY: mapY, pointerId: 1 });
  map.fire('pointerup', { clientX: mapX, clientY: mapY });
  assert.equal(app.state.f0Hz, 2000);
  assert.equal(app.state.qualityFactor, 2);
  assert.equal(env.elements.get('f0Hz').value, '2000');
  assert.equal(env.elements.get('qualityFactor').value, '2');

  const result = lesson.calculateLesson(app.state);
  const range = lesson.gateConvergenceRange(result);
  const convergenceWidth = width - 58 - 28;
  const convergenceX = 58 + Math.log(4 / range.minimumDurationMs) /
    Math.log(range.maximumDurationMs / range.minimumDurationMs) * convergenceWidth;
  const convergence = env.elements.get('convergenceCanvas');
  convergence.fire('pointerdown', { clientX: convergenceX, clientY: 120, pointerId: 2 });
  convergence.fire('pointerup', { clientX: convergenceX, clientY: 120 });
  assert.equal(app.state.durationMs, 4);
  assert.equal(env.elements.get('durationMs').value, '4');
  assert.equal(env.elements.get('durationValue').textContent, '4.00 ms');
  assert.ok(app.presetButtons.every(button => !button.classList.contains('active')));
});

test('all demo controls update state and evidence; reset restores the 1 ms / 48 kHz default', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const duration = env.elements.get('durationMs');
  const sampleRate = env.elements.get('sampleRate');
  const f0 = env.elements.get('f0Hz');
  const q = env.elements.get('qualityFactor');
  const target = env.elements.get('targetDb');
  const example = env.elements.get('exampleType');

  duration.value = '2'; duration.fire('input');
  assert.equal(app.state.durationMs, 2);
  assert.equal(env.elements.get('durationValue').textContent, '2.00 ms');
  assert.match(env.elements.get('demoReadout').innerHTML, /96 samples/);
  assert.match(env.elements.get('demoReadout').innerHTML, /500 Hz/);

  sampleRate.value = '96000'; sampleRate.fire('change');
  assert.equal(app.state.sampleRate, 96000);
  assert.equal(f0.max, '48000');
  assert.match(env.elements.get('demoReadout').innerHTML, /192 samples/);
  assert.match(env.elements.get('demoReadout').innerHTML, /48 kHz/);

  f0.value = '2000'; f0.fire('input');
  q.value = '5'; q.fire('input');
  target.value = '-20'; target.fire('change');
  assert.equal(app.state.f0Hz, 2000);
  assert.equal(app.state.qualityFactor, 5);
  assert.equal(app.state.targetDb, -20);
  assert.equal(env.elements.get('f0Value').textContent, '2 kHz');
  assert.equal(env.elements.get('qualityValue').textContent, '5.0');
  assert.match(env.elements.get('demoReadout').innerHTML, /Contained/);

  example.value = 'impulse'; example.fire('change');
  assert.equal(app.state.example, 'impulse');
  assert.equal(env.elements.get('resonanceControls').disabled, true);
  assert.match(env.elements.get('demoReadout').innerHTML, /at DC/);
  assert.match(env.elements.get('demoReadout').innerHTML, /0 dB/);

  env.elements.get('demoReset').fire('click');
  assert.deepEqual(app.state, { ...lesson.DEFAULT_STATE });
  assert.equal(example.value, 'resonance');
  assert.equal(duration.value, '1');
  assert.equal(sampleRate.value, '48000');
  assert.equal(env.elements.get('resonanceControls').disabled, false);
  assert.match(env.elements.get('demoReadout').innerHTML, /48 samples/);
  assert.match(env.elements.get('demoReadout').innerHTML, /Truncated/);
});

test('sample-rate interaction clamps f0 to the new Nyquist limit', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const sampleRate = env.elements.get('sampleRate');
  const f0 = env.elements.get('f0Hz');

  sampleRate.value = '96000'; sampleRate.fire('change');
  f0.value = '30000'; f0.fire('input');
  assert.equal(app.state.f0Hz, 30000);
  sampleRate.value = '24000'; sampleRate.fire('change');
  assert.equal(app.state.f0Hz, 12000);
  assert.equal(f0.value, '12000');
  assert.equal(f0.max, '12000');
  assert.match(env.elements.get('demoReadout').innerHTML, /Nyquist = <b>12 kHz/);
});

test('prediction reveals the correction after a wrong choice', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const wrong = app.predictionButtons[1];
  wrong.fire('click');
  assert.ok(wrong.classList.contains('qbad'));
  assert.ok(app.predictionButtons[lesson.PREDICTION.correct].classList.contains('qgood'));
  assert.equal(env.elements.get('predictionWhy').style.display, 'block');
  assert.match(env.elements.get('predictionWhy').textContent, /Not quite/);
  assert.match(env.elements.get('predictionWhy').textContent, /unchanged/);
});

test('quiz scores once and reset creates a clean quiz', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  app.quizView.rows[0].buttons[1].fire('click'); // false: correct
  app.quizView.rows[1].buttons[0].fire('click'); // true: correct
  app.quizView.rows[1].buttons[0].fire('click'); // duplicate ignored
  assert.deepEqual(app.quizView.getScore(), { score: 2, answered: 2 });
  assert.match(env.elements.get('quizScore').textContent, /2 correct of 2 answered/);
  env.elements.get('quizReset').fire('click');
  assert.deepEqual(app.quizView.getScore(), { score: 0, answered: 0 });
  assert.equal(env.elements.get('quizScore').textContent, '');
});

test('resize redraws and missing required elements produce a useful error', () => {
  const env = makeHeadlessEnvironment();
  lesson.initLesson(env.document, env.window);
  assert.doesNotThrow(() => env.windowHandlers.get('resize')());

  const broken = makeHeadlessEnvironment();
  broken.elements.delete('demoReadout');
  assert.throws(() => lesson.initLesson(broken.document, broken.window), /Missing required lesson element #demoReadout/);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
