// Unit tests for the shared day card (coaching-day-card.js), used by the coach's Logs and the client's past days.
// Run with: node --test tests/coaching-day-card.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const DayCard = require(path.join(__dirname, '..', 'coaching-day-card.js'));
const TODAY = '2026-11-25';

const fullDay = {
  date: TODAY,
  meals: [
    { meal_time: '07:30', name: 'Oats and berries', calories: 450, protein: 25, carbs: 60, fat: 10, fibre: 8, source: 'plan', entry_text: '60 g oats, 150 g berries', edited: true },
    { meal_time: '19:00', name: 'Chicken rice', calories: 700, protein: 52, carbs: 80, fat: 14, fibre: 6, source: 'ai', entry_text: 'Chicken thigh, rice, broccoli', added_late: true }
  ],
  workouts: [
    { what: 'Full body A', session: { exercises: [
      { name: 'Bench press', sets: [{ kg: 60, reps: 8 }, { kg: 60, reps: 8 }, { kg: 60, reps: 8 }] },
      { name: 'Squat', sets: [{ kg: 62.5, reps: 8 }, { kg: 62.5, reps: 7 }] }
    ] } },
    { what: 'Walk with the dog', minutes: 30, notes: 'Easy pace', session: null }
  ],
  steps: 7400,
  weigh: 84.6
};
const targets = { calories: 2000, protein: 150, steps: 8000 };
const plannedBench = { 'Bench press': '3 × 10' };

test('a day with meals, workouts, steps and a weigh-in renders every part', () => {
  const html = DayCard.render(fullDay, { today: TODAY, targets, open: true, planned: plannedBench });
  // header, with the day in words and "Today"
  assert.match(html, /Wed 25 Nov/);
  assert.match(html, /<span class="dc-tag-day">Today<\/span>/);
  // summary strip: calories, protein, steps and the weigh-in
  assert.match(html, /Calories/);
  assert.match(html, /1,150 of 2,000 kcal/);
  assert.match(html, /Protein/);
  assert.match(html, /77 of 150 g/);
  assert.match(html, /7,400 of 8,000/);
  assert.match(html, /84\.6 kg/);
  // meals: time, name, kcal, macros and the logging tag
  assert.match(html, /07:30/);
  assert.match(html, /Oats and berries/);
  assert.match(html, /450 kcal/);
  assert.match(html, /P 25 g · C 60 g · F 10 g/);
  assert.match(html, /From plan/);
  assert.match(html, /Described/);
  assert.match(html, />Edited</);
  assert.match(html, />Added late</);
  // the full description is in the tap-to-open part
  assert.match(html, /60 g oats, 150 g berries/);
  // workouts: exercises with what was done and what was planned, and other activity with minutes and notes
  assert.match(html, /Bench press/);
  assert.match(html, /3 × 8 at 60 kg/);
  assert.match(html, /\(planned 3 × 10\)/);
  assert.match(html, /62\.5 kg × 8, 62\.5 kg × 7/);
  assert.match(html, /Other activity/);
  assert.match(html, /30 min/);
  assert.match(html, /Easy pace/);
});

test('a day with no target shows the numbers without a bar', () => {
  const html = DayCard.render(fullDay, { today: TODAY, targets: {}, open: true });
  assert.match(html, /1,150 kcal/);
  assert.match(html, /77 g/);
  assert.match(html, /<span>Steps<\/span><b>7,400<\/b>/, 'the steps number, with no target');
  assert.equal((html.match(/class="dc-bar"/g) || []).length, 0, 'no progress bars without a target');
  assert.doesNotMatch(html, / of 2,000/, 'no target figure is made up');
});

test('colour: within about 10% of target is green, well over or under is amber, and never red', () => {
  const near = DayCard.render({ date: TODAY, meals: [{ name: 'a', calories: 2100, protein: 150, carbs: 0, fat: 0, fibre: 0, source: 'typed' }] },
    { today: TODAY, targets: { calories: 2000, protein: 150 } });
  assert.match(near, /dc-m dc-ok/, '5% over is green');
  const far = DayCard.render({ date: TODAY, meals: [{ name: 'a', calories: 2700, protein: 60, carbs: 0, fat: 0, fibre: 0, source: 'typed' }] },
    { today: TODAY, targets: { calories: 2000, protein: 150 } });
  assert.match(far, /dc-m dc-off/, '35% over is amber');
  assert.match(far, /dc-m dc-off[\s\S]*Protein|Protein[\s\S]*dc-off/, 'protein well under is amber too');
  assert.doesNotMatch(near + far, /c-red|dc-red|#b42318|red/i, 'no red anywhere');
});

test('an empty day is one quiet line, not an empty card', () => {
  const html = DayCard.render({ date: '2026-11-24', meals: [], workouts: [], steps: null, weigh: null }, { today: TODAY });
  assert.match(html, /Tue 24 Nov/);
  assert.match(html, /Yesterday/);
  assert.match(html, /Nothing logged/);
  assert.match(html, /class="dc-quiet"/);
  assert.doesNotMatch(html, /<details/, 'not a card');
});

test('older days are collapsed; the open ones are open', () => {
  const open = DayCard.render(fullDay, { today: TODAY, targets, open: true });
  const shut = DayCard.render(fullDay, { today: TODAY, targets, open: false });
  assert.match(open, /<details class="dc" data-date="2026-11-25" open>/);
  assert.match(shut, /<details class="dc" data-date="2026-11-25">/);
  assert.doesNotMatch(shut, / open>/);
});

test('week averages: calories and protein per logged day, steps per day with steps, and the workouts', () => {
  const days = [
    { date: '2026-11-19', meals: [{ calories: 2000, protein: 150 }], workouts: [{ what: 'A' }], steps: 8000 },
    { date: '2026-11-20', meals: [{ calories: 1600, protein: 120 }, { calories: 400, protein: 30 }], workouts: [], steps: 6000 },
    { date: '2026-11-21', meals: [], workouts: [{ what: 'B' }, { what: 'C' }], steps: null },
    { date: '2026-11-22', meals: [], workouts: [], steps: null }
  ];
  const avg = DayCard.weekAverages(days);
  assert.equal(avg.calories, 2000, '(2000 + 2000) / 2 logged days');
  assert.equal(avg.protein, 150, '(150 + 150) / 2 logged days');
  assert.equal(avg.steps, 7000, '(8000 + 6000) / 2 days with steps');
  assert.equal(avg.workouts, 3, 'every workout counted');
  assert.equal(avg.loggedDays, 2);
  const none = DayCard.weekAverages([{ date: '2026-11-19', meals: [], workouts: [], steps: null }]);
  assert.equal(none.calories, null);
  assert.equal(none.steps, null);
  assert.equal(none.workouts, 0);
});

test('week heading shows the week and its averages', () => {
  const html = DayCard.weekHeading('Week 3 of 12', { calories: 2000, protein: 150, steps: 7000, workouts: 3 });
  assert.match(html, /Week 3 of 12/);
  assert.match(html, /Average per day: 2,000 kcal · P 150 g · 7,000 steps · 3 workouts this week/);
});

test('names and notes are escaped (no markup from the client or the coach reaches the page)', () => {
  const html = DayCard.render({ date: TODAY, meals: [{ name: '<img src=x onerror=alert(1)>', calories: 1, protein: 0, carbs: 0, fat: 0, fibre: 0, source: 'typed', entry_text: '<b>x</b>' }] },
    { today: TODAY });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('dayLabel: Today and Yesterday in the client\'s own days', () => {
  assert.deepEqual(DayCard.dayLabel(TODAY, TODAY), { text: 'Wed 25 Nov', rel: 'Today' });
  assert.deepEqual(DayCard.dayLabel('2026-11-24', TODAY), { text: 'Tue 24 Nov', rel: 'Yesterday' });
  assert.equal(DayCard.dayLabel('2026-11-10', TODAY).rel, '');
});
