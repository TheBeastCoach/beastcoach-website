// Basic targets: compares basic-targets.js with the numbers calculator.html actually shows.
// The calculator's own script runs here against a small DOM stub, so the comparison is with the
// real page code, not a copy. Run with: node --test tests/basic-targets.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BasicTargets = require(path.join(__dirname, '..', 'basic-targets.js'));
const CALC_HTML = fs.readFileSync(path.join(__dirname, '..', 'calculator.html'), 'utf8');

// Runs the calculator's inline script with the given input values and returns what it displays.
function runCalculator(inputs, goal, sex) {
  const scripts = [...CALC_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const code = scripts.find(s => s.includes('var GOALS')) ;
  assert.ok(code, 'calculator script found');

  const els = {};
  const attrSets = { 'data-sex': [], 'data-goal': [] };
  // Buttons for sex and goal, read from the real markup.
  for (const m of CALC_HTML.matchAll(/data-sex="([^"]+)"/g)) attrSets['data-sex'].push(m[1]);
  for (const m of CALC_HTML.matchAll(/data-goal="([^"]+)"/g)) attrSets['data-goal'].push(m[1]);

  function stub(id, attrs) {
    return {
      id, value: (inputs[id] !== undefined ? String(inputs[id]) : ''), textContent: '', innerHTML: '',
      style: {}, classList: { add() {}, remove() {}, toggle() {} }, attrs: attrs || {}, listeners: {},
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      getAttribute(name) { return this.attrs[name] !== undefined ? this.attrs[name] : null; },
      setAttribute() {}, appendChild() {}, remove() {}
    };
  }
  const cache = {};
  const attrCache = {};
  const sandboxDocument = {
    getElementById(id) { return cache[id] || (cache[id] = stub(id)); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const m = sel.match(/^\[(data-sex|data-goal)\]$/);
      if (!m) return [];
      if (!attrCache[m[1]]) attrCache[m[1]] = attrSets[m[1]].map(v => stub(m[1] + ':' + v, { [m[1]]: v }));
      return attrCache[m[1]];
    },
    createElement() { return stub('created'); }
  };
  const sandbox = { document: sandboxDocument, console, Math, parseFloat, Number, String, window: {} };
  sandbox.window = sandbox;
  require('vm').createContext(sandbox);
  require('vm').runInContext(code, sandbox);

  // Choose the sex and goal the way a visitor would: click the matching button.
  const buttons = [...attrSets['data-sex'].map(v => ['data-sex', v]), ...attrSets['data-goal'].map(v => ['data-goal', v])];
  for (const [attr, value] of buttons) {
    if ((attr === 'data-sex' && value === sex) || (attr === 'data-goal' && value === goal)) {
      const btn = sandboxDocument.querySelectorAll('[' + attr + ']').find(b => b.attrs[attr] === value);
      (btn.listeners.click || []).forEach(fn => fn());
    }
  }
  // Put the inputs in and fire their input listeners, which run the calculation.
  for (const [id, value] of Object.entries(inputs)) cache[id] = cache[id] || stub(id);
  for (const id of Object.keys(inputs)) {
    cache[id].value = String(inputs[id]);
    (cache[id].listeners.input || []).forEach(fn => fn());
  }
  const num = s => parseFloat(String(s).replace(/<[^>]+>/g, ' ').trim().split(/\s+/)[0]);
  const maint = /Your maintenance is <strong>(\d+) kcal\/day<\/strong>/.exec(cache.calorieExplainer.innerHTML);
  return {
    calories: num(cache.targetValue.innerHTML),
    protein: num(cache.proteinGrams.textContent),
    carbs: num(cache.carbGrams.textContent),
    fat: num(cache.fatGrams.textContent),
    fibre: num(cache.fibreGrams.innerHTML),
    maintenance: maint ? Number(maint[1]) : null
  };
}

// Three sample people. Inputs are the calculator's own fields.
const PEOPLE = [
  { label: 'man, desk job, 3 moderate sessions, fat loss',
    calc: { heightCm: 182, weight: 84, age: 34, activity: '1.15', steps: 5000, trainingSessions: 3, trainingIntensity: '350' },
    goal: 'fatloss', sex: 'male',
    basic: { sex: 'male', age: 34, heightCm: 182, weightKg: 84, activity: 1.15, steps: 5000, trainingSessions: 3, trainingIntensity: 350, goal: 'fatloss' } },
  { label: 'woman, on her feet, 2 light sessions, build muscle',
    calc: { heightCm: 166, weight: 71, age: 29, activity: '1.25', steps: 9000, trainingSessions: 2, trainingIntensity: '200' },
    goal: 'muscle', sex: 'female',
    basic: { sex: 'female', age: 29, heightCm: 166, weightKg: 71, activity: 1.25, steps: 9000, trainingSessions: 2, trainingIntensity: 200, goal: 'muscle' } },
  { label: 'man, physical job, 5 hard sessions, fat loss',
    calc: { heightCm: 178, weight: 101.5, age: 45, activity: '1.35', steps: 12000, trainingSessions: 5, trainingIntensity: '500' },
    goal: 'fatloss', sex: 'male',
    basic: { sex: 'male', age: 45, heightCm: 178, weightKg: 101.5, activity: 1.35, steps: 12000, trainingSessions: 5, trainingIntensity: 500, goal: 'fatloss' } }
];

for (const p of PEOPLE) {
  test('Basic targets match calculator.html for ' + p.label, () => {
    const shown = runCalculator(p.calc, p.goal, p.sex);
    const mine = BasicTargets.calcTargets(p.basic);
    assert.equal(mine.maintenance, shown.maintenance, 'maintenance');
    assert.equal(mine.calories, shown.calories, 'calories');
    assert.equal(mine.protein, shown.protein, 'protein');
    assert.equal(mine.carbs, shown.carbs, 'carbs');
    assert.equal(mine.fat, shown.fat, 'fat');
    assert.equal(mine.fibre, shown.fibre, 'fibre');
  });
}

test('steps target is the realistic target the client gave, kept between 3,000 and 20,000', () => {
  assert.equal(BasicTargets.stepsTarget(1000), 3000, 'below the floor goes up to 3,000');
  assert.equal(BasicTargets.stepsTarget(3000), 3000);
  assert.equal(BasicTargets.stepsTarget(8000), 8000, 'no +2,000 rule any more');
  assert.equal(BasicTargets.stepsTarget(9000), 9000);
  assert.equal(BasicTargets.stepsTarget(20000), 20000);
  assert.equal(BasicTargets.stepsTarget(25000), 20000, 'above the ceiling goes down to 20,000');
});

test('the calculator has no maintain goal, so maintain is the calculator maintenance (adjustment 0)', () => {
  const m = BasicTargets.calcTargets({ sex: 'male', age: 34, heightCm: 182, weightKg: 84, activity: 1.15, steps: 5000, trainingSessions: 3, trainingIntensity: 350, goal: 'maintain' });
  assert.equal(m.calories, m.maintenance);
});

// Maintain must give exactly the calculated maintenance calories: no deficit, no surplus.
test('maintain: calories equal the calculated maintenance for every combination of inputs', () => {
  let checked = 0;
  for (const sex of ['male', 'female']) for (const age of [18, 29, 45, 70, 100]) for (const heightCm of [150, 170, 195])
    for (const weightKg of [48.5, 72, 110]) for (const activity of [1.15, 1.25, 1.35]) for (const steps of [0, 4000, 12000])
      for (const trainingSessions of [0, 3, 7]) for (const trainingIntensity of [200, 350, 500]) {
        const t = BasicTargets.calcTargets({ sex, age, heightCm, weightKg, activity, steps, trainingSessions, trainingIntensity, goal: 'maintain' });
        assert.equal(t.calories, t.maintenance, `calories ${t.calories} vs maintenance ${t.maintenance}`);
        checked++;
      }
  assert.equal(checked, 2 * 5 * 3 * 3 * 3 * 3 * 3 * 3);
});

test('maintain has no calorie adjustment, and the other goals still move calories', () => {
  assert.equal(BasicTargets.GOALS.maintain.delta, 0);
  const base = { sex: 'female', age: 40, heightCm: 165, weightKg: 70, activity: 1.25, steps: 6000, trainingSessions: 4, trainingIntensity: 350 };
  const m = BasicTargets.calcTargets(Object.assign({ goal: 'maintain' }, base));
  const f = BasicTargets.calcTargets(Object.assign({ goal: 'fatloss' }, base));
  const u = BasicTargets.calcTargets(Object.assign({ goal: 'muscle' }, base));
  assert.equal(f.calories, m.maintenance - 500, 'fat loss is 500 under maintenance');
  assert.equal(u.calories, m.maintenance + 300, 'muscle is 300 over maintenance');
});
