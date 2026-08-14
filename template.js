'use strict';
/* =====================================================================
   SELF-STANDING INTERACTIVE LESSON TEMPLATE

   How to use this file
   --------------------
   1. Copy template.html, template.js, and template.test.js together.
   2. Rename all three; update the <script src> in the HTML and require()
      path in the test.
   3. Replace the example first-order low-pass model with the lesson's
      model. Keep numerical work in pure functions so it can be tested.
   4. Replace PREDICTION and QUIZ at the same time as the lesson prose.
   5. Add controls to REQUIRED_IDS, initialize them in initLesson(), and
      add one test for each important interaction or fallback.
   6. Keep plot colors consistent with the HTML legend and always provide
      the same conclusion in a text readout.
   7. Run: node your-lesson.test.js

   The placeholder demo is intentionally small but complete: responsive
   canvas drawing, state, controls, reset, prediction, quiz, chapter links,
   pure calculations, CommonJS exports, and a headless test seam.
   ===================================================================== */

const DEFAULT_STATE = Object.freeze({ cutoffHz: 500, probeHz: 1000 });

/* Every ID used by JavaScript is listed here. The test verifies that each
   one exists in the HTML, which catches the most common copy/edit error. */
const REQUIRED_IDS = Object.freeze([
  'demoCanvas', 'demoReadout', 'demoParameter', 'demoParameterValue', 'demoReset',
  'predictionOptions', 'predictionWhy',
  'quizBox', 'quizScore', 'quizReset',
]);

const PREDICTION = Object.freeze({
  options: Object.freeze([
    'The probe level rises (less attenuation)',
    'The probe level falls (more attenuation)',
    'Nothing changes at the probe frequency',
  ]),
  correct: 0,
  why: 'The ratio f/fc gets smaller. For a first-order low-pass, |H| = 1/sqrt(1 + (f/fc)^2), so the fixed probe moves closer to the passband.',
});

/* TEMPLATE: replace these with questions about the new lesson's mechanism,
   assumption, and failure mode. Keep feedback explanatory, not merely a
   restatement of “true” or “false.” */
const QUIZ = Object.freeze([
  Object.freeze({
    q: 'At the cutoff of a first-order low-pass filter, the magnitude is approximately −3.01 dB.',
    answer: true,
    why: 'At f = fc, |H| = 1/sqrt(2), and 20 log10(1/sqrt(2)) ≈ −3.01 dB.',
  }),
  Object.freeze({
    q: 'Raising the cutoff always adds more attenuation at a fixed probe frequency.',
    answer: false,
    why: 'Raising fc reduces f/fc, so the fixed probe is attenuated less, not more.',
  }),
  Object.freeze({
    q: 'Agreement with this idealized plot proves that a real circuit has no component tolerances or parasitics.',
    answer: false,
    why: 'The plot evaluates an ideal first-order model. Real behavior still needs measurement, tolerances, and omitted effects to be checked.',
  }),
]);

/* ------------------------ pure lesson model ------------------------- */

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

/* Example model. Pure functions contain no DOM/canvas access and should be
   the primary target of numerical tests in the generated lesson. */
function firstOrderLowPassDb(cutoffHz, frequencyHz) {
  requirePositiveFinite(cutoffHz, 'cutoffHz');
  requirePositiveFinite(frequencyHz, 'frequencyHz');
  const ratio = frequencyHz / cutoffHz;
  return -10 * Math.log10(1 + ratio * ratio);
}

function calculateDemo(cutoffHz, probeHz = DEFAULT_STATE.probeHz) {
  const probeDb = firstOrderLowPassDb(cutoffHz, probeHz);
  return {
    cutoffHz,
    probeHz,
    probeDb,
    linearGain: Math.pow(10, probeDb / 20),
  };
}

function logGrid(minHz, maxHz, count) {
  requirePositiveFinite(minHz, 'minHz');
  requirePositiveFinite(maxHz, 'maxHz');
  if (maxHz <= minHz) throw new RangeError('maxHz must be greater than minHz');
  if (!Number.isInteger(count) || count < 2) throw new RangeError('count must be an integer of at least 2');
  return Array.from({ length: count }, (_, i) => minHz * Math.pow(maxHz / minHz, i / (count - 1)));
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

function formatHz(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 2)} kHz` : `${value.toFixed(0)} Hz`;
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

/* ---------------------------- plotting ------------------------------ */

const PLOT = Object.freeze({ left: 52, right: 24, top: 18, bottom: 30, fmin: 20, fmax: 20000, ymin: -48, ymax: 3 });

function sizeCanvas(canvas, win) {
  const rect = canvas.getBoundingClientRect();
  const dpr = win.devicePixelRatio || 1;
  canvas.width = Math.max(2, Math.round(rect.width * dpr));
  canvas.height = Math.max(2, Math.round(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawResponse(canvas, state, win) {
  const { ctx, width, height } = sizeCanvas(canvas, win);
  const p = PLOT;
  const plotWidth = width - p.left - p.right;
  const plotHeight = height - p.top - p.bottom;
  const x = frequency => p.left + Math.log10(frequency / p.fmin) / Math.log10(p.fmax / p.fmin) * plotWidth;
  const y = db => p.top + (1 - (db - p.ymin) / (p.ymax - p.ymin)) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;

  const frequencyTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const frequency of frequencyTicks) {
    const px = x(frequency);
    ctx.strokeStyle = '#232c38';
    ctx.beginPath(); ctx.moveTo(px, p.top); ctx.lineTo(px, height - p.bottom); ctx.stroke();
    ctx.fillStyle = '#7d8899';
    const label = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
    ctx.fillText(frequency === p.fmax ? `${label} Hz` : label, px, height - p.bottom + 6);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let db = -48; db <= 0; db += 12) {
    const py = y(db);
    ctx.strokeStyle = '#232c38';
    ctx.beginPath(); ctx.moveTo(p.left, py); ctx.lineTo(width - p.right, py); ctx.stroke();
    ctx.fillStyle = '#7d8899'; ctx.fillText(String(db), p.left - 6, py);
  }
  ctx.textBaseline = 'bottom';
  ctx.fillText('dB', p.left - 6, p.top - 3);
  ctx.strokeStyle = '#39434f';
  ctx.strokeRect(p.left, p.top, plotWidth, plotHeight);

  ctx.save();
  ctx.beginPath(); ctx.rect(p.left, p.top, plotWidth, plotHeight); ctx.clip();

  const frequencies = logGrid(p.fmin, p.fmax, 500);
  ctx.beginPath();
  frequencies.forEach((frequency, index) => {
    const db = Math.max(p.ymin - 12, firstOrderLowPassDb(state.cutoffHz, frequency));
    if (index === 0) ctx.moveTo(x(frequency), y(db));
    else ctx.lineTo(x(frequency), y(db));
  });
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2.2; ctx.stroke();

  function verticalMarker(frequency, color, dash) {
    if (frequency < p.fmin || frequency > p.fmax) return;
    const px = x(frequency);
    ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(px, p.top); ctx.lineTo(px, height - p.bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
  verticalMarker(state.cutoffHz, '#ff9f43', [6, 4]);
  verticalMarker(state.probeHz, '#e8edf4', [3, 4]);
  ctx.restore();
}

/* ---------------------- prediction and quiz ------------------------- */

function clearElement(element) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren();
  else {
    while (element.firstChild) element.removeChild(element.firstChild);
  }
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
    card.appendChild(question);
    card.appendChild(buttonRow);
    card.appendChild(feedback);

    const buttons = ['True', 'False'].map((label, buttonIndex) => {
      const button = makeElement(doc, 'button', 'padbtn', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        if (card.dataset.done) return;
        card.dataset.done = '1';
        answered++;
        const chosenAnswer = buttonIndex === 0;
        const correct = chosenAnswer === item.answer;
        if (correct) {
          score++;
          button.classList.add('qgood');
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

/* ------------------------- DOM application -------------------------- */

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
        try { win.history.replaceState(null, '', hash); } catch (error) { /* file:// or sandbox */ }
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

  function draw() {
    drawResponse(elements.demoCanvas, state, win);
    const result = calculateDemo(state.cutoffHz, state.probeHz);
    const region = result.probeDb > -3 ? 'near the passband' : result.probeDb > -12 ? 'in the transition region' : 'strongly attenuated';
    elements.demoReadout.innerHTML =
      `Cutoff <b>${formatHz(result.cutoffHz)}</b> · fixed probe <b>${formatHz(result.probeHz)}</b> · ` +
      `magnitude at the probe <b>${result.probeDb.toFixed(2)} dB</b> (${(result.linearGain * 100).toFixed(1)}% voltage gain). ` +
      `The probe is <b>${region}</b>. Raising the cutoff reduces f/f<sub>c</sub>, so the same probe is attenuated less.`;
  }

  const requestFrame = win.requestAnimationFrame
    ? win.requestAnimationFrame.bind(win)
    : callback => setTimeout(callback, 0);
  const throttledDraw = rafThrottle(draw, requestFrame);

  function setCutoff(rawValue, schedule = true) {
    const value = clampToInput(elements.demoParameter, rawValue);
    state.cutoffHz = value;
    elements.demoParameter.value = String(value);
    elements.demoParameterValue.textContent = formatHz(value);
    if (schedule) throttledDraw();
    else draw();
  }

  function resetDemo() {
    setCutoff(DEFAULT_STATE.cutoffHz, false);
  }

  elements.demoParameter.addEventListener('input', () => {
    setCutoff(Number.parseFloat(elements.demoParameter.value));
  });
  elements.demoReset.addEventListener('click', resetDemo);
  elements.quizReset.addEventListener('click', () => {
    quizView = renderQuiz(doc, elements.quizBox, elements.quizScore);
  });

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

  elements.demoParameterValue.textContent = formatHz(state.cutoffHz);
  draw();

  return {
    state,
    elements,
    draw,
    setCutoff,
    resetDemo,
    predictionButtons,
    get quizView() { return quizView; },
  };
}

/* Browser boot. Keeping initLesson() explicit and exported lets the same
   code run under the tiny headless DOM in template.test.js. */
function boot() {
  if (!window.lessonApp) window.lessonApp = initLesson(document, window);
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
    firstOrderLowPassDb,
    calculateDemo,
    logGrid,
    clampToInput,
    formatHz,
    rafThrottle,
    drawResponse,
    renderPrediction,
    renderQuiz,
    initLesson,
  };
}
