#!/usr/bin/env node
'use strict';
/* =====================================================================
   SELF-STANDING TEST TEMPLATE — no packages or browser required

   Copy this file with template.html and template.js. After renaming:
     1. change require('./template.js') below;
     2. replace the example numeric assertions with the new lesson's
        headline result, boundary cases, and fallback behavior;
     3. update the interaction test for every important control;
     4. keep the HTML/REQUIRED_IDS contract test;
     5. run with: node your-lesson.test.js

   The fake DOM is deliberately small. Add only browser methods the lesson
   actually uses; that way accidental browser-only coupling is visible.
   ===================================================================== */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lesson = require('./template.js'); // TEMPLATE: update after renaming

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

const htmlPath = path.join(__dirname, 'template.html'); // TEMPLATE: update after renaming
const html = fs.readFileSync(htmlPath, 'utf8');

test('HTML loads the matching JavaScript file', () => {
  assert.match(html, /<script\s+src=["']template\.js["']><\/script>/);
});

test('every JavaScript-required ID exists in the HTML', () => {
  for (const id of lesson.REQUIRED_IDS) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(html, new RegExp(`\\bid=["']${escaped}["']`), `missing #${id}`);
  }
});

test('lesson keeps semantic chapters and accessible non-canvas output', () => {
  for (const id of ['idea', 'demo-1', 'takeaways', 'quiz', 'author-checklist']) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `missing chapter #${id}`);
  }
  assert.match(html, /<canvas[^>]+aria-label=/);
  assert.match(html, /id=["']demoReadout["'][^>]+aria-live=["']polite["']/);
  assert.match(html, /<noscript>/);
});

/* ----------------------- pure numeric checks ------------------------ */
/* TEMPLATE: these are the assertions to replace first. Test meaningful
   numbers, not merely that a function returns something finite. */

test('first-order response is −3.0103 dB at cutoff', () => {
  nearlyEqual(lesson.firstOrderLowPassDb(1000, 1000), -3.0102999566, 1e-9, 'cutoff response');
});

test('first-order response has the expected DC and high-frequency behavior', () => {
  assert.ok(lesson.firstOrderLowPassDb(1000, 1) > -0.00001, 'near DC should be near 0 dB');
  nearlyEqual(lesson.firstOrderLowPassDb(1000, 10000), -20.0432137378, 1e-9, 'one decade above cutoff');
});

test('raising cutoff raises level at a fixed probe', () => {
  const lowCutoff = lesson.calculateDemo(250, 1000);
  const highCutoff = lesson.calculateDemo(2000, 1000);
  assert.ok(highCutoff.probeDb > lowCutoff.probeDb);
  assert.ok(highCutoff.linearGain > lowCutoff.linearGain);
});

test('model rejects nonphysical inputs', () => {
  assert.throws(() => lesson.firstOrderLowPassDb(0, 1000), RangeError);
  assert.throws(() => lesson.firstOrderLowPassDb(1000, NaN), RangeError);
  assert.throws(() => lesson.logGrid(20, 20, 10), RangeError);
  assert.throws(() => lesson.logGrid(20, 20000, 1), RangeError);
});

test('log grid includes both endpoints', () => {
  const grid = lesson.logGrid(20, 20000, 4);
  nearlyEqual(grid[0], 20, 1e-12, 'first endpoint');
  nearlyEqual(grid[3], 20000, 1e-9, 'last endpoint');
  assert.ok(grid[0] < grid[1] && grid[1] < grid[2] && grid[2] < grid[3]);
});

test('control values are clamped and snapped to their declared step', () => {
  const input = { min: '50', max: '4000', step: '10' };
  assert.equal(lesson.clampToInput(input, 12), 50);
  assert.equal(lesson.clampToInput(input, 4030), 4000);
  assert.equal(lesson.clampToInput(input, 516), 520);
});

test('rafThrottle coalesces work until the next frame', () => {
  const queue = [];
  let calls = 0;
  const throttled = lesson.rafThrottle(() => { calls++; }, callback => queue.push(callback));
  throttled(); throttled(); throttled();
  assert.equal(queue.length, 1);
  assert.equal(calls, 0);
  queue.shift()();
  assert.equal(calls, 1);
  throttled();
  assert.equal(queue.length, 1);
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
    toString() { return Array.from(values).join(' '); },
  };
}

function makeElement(tagName = 'div', id = '') {
  const handlers = new Map();
  const attributes = new Map();
  const element = {
    tagName: tagName.toUpperCase(),
    id,
    type: '',
    value: '',
    min: '', max: '', step: '',
    width: 0, height: 0,
    textContent: '', innerHTML: '', className: '',
    children: [], dataset: {}, style: {},
    classList: makeClassList(),
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    replaceChildren(...children) {
      this.children = [];
      children.forEach(child => this.appendChild(child));
    },
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
    getBoundingClientRect() { return { width: 900, height: 300, left: 0, top: 0 }; },
  };
  Object.defineProperty(element, 'firstChild', { get() { return this.children[0] || null; } });
  return element;
}

function makeHeadlessEnvironment() {
  const elements = new Map();
  for (const id of lesson.REQUIRED_IDS) {
    elements.set(id, makeElement(id === 'demoCanvas' ? 'canvas' : 'div', id));
  }

  const input = elements.get('demoParameter');
  input.value = '500'; input.min = '50'; input.max = '4000'; input.step = '10';
  for (const id of ['demoReset', 'quizReset']) elements.get(id).tagName = 'BUTTON';

  const documentHandlers = new Map();
  const document = {
    readyState: 'complete',
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) { return makeElement(tag); },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { documentHandlers.set(type, fn); },
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

test('lesson initializes and draws with the headless DOM/canvas', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  assert.equal(app.state.cutoffHz, 500);
  assert.equal(env.elements.get('demoCanvas').width, 900);
  assert.match(env.elements.get('demoReadout').innerHTML, /−?6\.99 dB|-6\.99 dB/);
  assert.equal(app.predictionButtons.length, lesson.PREDICTION.options.length);
  assert.equal(app.quizView.rows.length, lesson.QUIZ.length);
});

test('slider interaction updates state, value label, and readout; reset restores defaults', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const input = env.elements.get('demoParameter');

  input.value = '2000';
  input.fire('input');
  assert.equal(app.state.cutoffHz, 2000);
  assert.equal(env.elements.get('demoParameterValue').textContent, '2 kHz');
  assert.match(env.elements.get('demoReadout').innerHTML, /−?0\.97 dB|-0\.97 dB/);

  env.elements.get('demoReset').fire('click');
  assert.equal(app.state.cutoffHz, lesson.DEFAULT_STATE.cutoffHz);
  assert.equal(input.value, '500');
  assert.equal(env.elements.get('demoParameterValue').textContent, '500 Hz');
});

test('prediction reveals the right answer and explanation', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);
  const wrong = app.predictionButtons[1];
  wrong.fire('click');

  assert.ok(wrong.classList.contains('qbad'));
  assert.ok(app.predictionButtons[lesson.PREDICTION.correct].classList.contains('qgood'));
  assert.equal(env.elements.get('predictionWhy').style.display, 'block');
  assert.match(env.elements.get('predictionWhy').textContent, /Not quite/);
});

test('quiz scores answers once and reset creates a clean quiz', () => {
  const env = makeHeadlessEnvironment();
  const app = lesson.initLesson(env.document, env.window);

  app.quizView.rows[0].buttons[0].fire('click'); // true: correct
  app.quizView.rows[1].buttons[1].fire('click'); // false: correct
  app.quizView.rows[1].buttons[1].fire('click'); // duplicate: ignored
  assert.deepEqual(app.quizView.getScore(), { score: 2, answered: 2 });
  assert.match(env.elements.get('quizScore').textContent, /2 correct of 2 answered/);

  env.elements.get('quizReset').fire('click');
  assert.deepEqual(app.quizView.getScore(), { score: 0, answered: 0 });
  assert.equal(env.elements.get('quizScore').textContent, '');
});

test('resize path redraws without throwing', () => {
  const env = makeHeadlessEnvironment();
  lesson.initLesson(env.document, env.window);
  assert.doesNotThrow(() => env.windowHandlers.get('resize')());
});

test('initialization reports a useful error for a missing HTML element', () => {
  const env = makeHeadlessEnvironment();
  env.elements.delete('demoReadout');
  assert.throws(() => lesson.initLesson(env.document, env.window), /Missing required lesson element #demoReadout/);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exitCode = 1;
