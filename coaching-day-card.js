/* Day card: one past day in the coaching portal. Used by the coach's Logs tab (coach.html) and the client's
   past days (my-coach.html). Plain browser JavaScript with no dependencies. The styles are added once, here.
   A day is { date, meals, workouts, steps, weigh }. Options: { today, targets, open, planned }.
   Collapsed days are native <details>, so they open on tap with no script. */
(function (root) {
  var CSS = '' +
    '.dc{background:#fff;border:1px solid var(--line,#D5E0D8);border-radius:18px;margin:0 0 10px;overflow:hidden}' +
    '.dc>summary{list-style:none;cursor:pointer;padding:14px 16px 12px}' +
    '.dc>summary::-webkit-details-marker{display:none}' +
    '.dc-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}' +
    '.dc-date{font-family:"Bebas Neue","Arial Narrow",Impact,sans-serif;font-size:24px;letter-spacing:.02em;line-height:1.1;color:var(--ink,#1B3022)}' +
    '.dc-tag-day{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green,#2D6A4F)}' +
    '.dc-strip{display:grid;grid-template-columns:1fr;gap:10px;margin-top:10px}' +
    '@media(min-width:560px){.dc-strip{grid-template-columns:repeat(2,1fr)}}' +
    '.dc-m{min-width:0}' +
    '.dc-m-top{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--muted,#3B4F43)}' +
    '.dc-m-top b{color:var(--ink,#1B3022);font-weight:800}' +
    '.dc-bar{height:6px;border-radius:99px;background:#E6EEE9;overflow:hidden;margin-top:5px}' +
    '.dc-bar span{display:block;height:100%;border-radius:99px}' +
    '.dc-ok{color:var(--green,#2D6A4F)}.dc-ok .dc-bar span{background:#2D6A4F}' +
    '.dc-off{color:#8a5300}.dc-off .dc-bar span{background:#F59E0B}' +
    '.dc-body{border-top:1px solid #EEF3EF;padding:6px 16px 14px}' +
    '.dc-sec{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--green,#2D6A4F);margin:12px 0 4px}' +
    '.dc-meal{border-bottom:1px solid #EEF3EF}.dc-meal:last-child{border-bottom:0}' +
    '.dc-meal>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:10px 0}' +
    '.dc-meal>summary::-webkit-details-marker{display:none}' +
    '.dc-meal-name{font-weight:800;color:var(--ink,#1B3022);min-width:0;overflow-wrap:anywhere}' +
    '.dc-time{font-size:12px;color:var(--muted,#3B4F43);font-weight:600;margin-right:6px}' +
    '.dc-kcal{font-weight:800;text-align:right;white-space:nowrap}' +
    '.dc-macros{grid-column:1/-1;font-size:12px;color:var(--muted,#3B4F43)}' +
    '.dc-tags{display:flex;flex-wrap:wrap;gap:6px;grid-column:1/-1}' +
    '.dc-tag{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;background:#EEF6F1;color:var(--green,#2D6A4F);white-space:nowrap}' +
    '.dc-tag-warn{background:#FFF4E0;color:#8a5300}' +
    '.dc-desc{font-size:14px;color:var(--ink,#1B3022);padding:0 0 12px;white-space:pre-line;overflow-wrap:anywhere}' +
    '.dc-ex{padding:6px 0;border-bottom:1px solid #EEF3EF}.dc-ex:last-child{border-bottom:0}' +
    '.dc-ex b{font-weight:800}.dc-planned{font-size:12px;color:var(--muted,#3B4F43)}' +
    '.dc-wo{padding:8px 0;border-bottom:1px solid #EEF3EF}.dc-wo:last-child{border-bottom:0}' +
    '.dc-none{font-size:14px;color:var(--muted,#3B4F43);margin:8px 0 2px}' +
    '.dc-quiet{font-size:14px;color:var(--muted,#3B4F43);padding:12px 16px;background:#fff;border:1px dashed var(--line,#D5E0D8);border-radius:14px;margin:0 0 10px}' +
    '.dc-week{margin:18px 0 8px;display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.dc-week h4{margin:0;font-family:"Bebas Neue","Arial Narrow",Impact,sans-serif;font-weight:400;font-size:22px;letter-spacing:.02em;color:var(--ink,#1B3022)}' +
    '.dc-week p{margin:0;font-size:13px;color:var(--muted,#3B4F43)}';

  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('dc-css')) return;
    var st = document.createElement('style'); st.id = 'dc-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Math.round(Number(n) || 0).toLocaleString('en-AU'); };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // "Tue 25 Nov", with "Today" or "Yesterday" where it applies. Dates are the client's own YYYY-MM-DD days.
  function dateParts(date) {
    var p = String(date).split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
    return { dow: DOW[d.getUTCDay()], day: p[2], month: MONTHS[p[1] - 1], weekday: (d.getUTCDay() + 6) % 7 + 1 };
  }
  function dayLabel(date, today) {
    var x = dateParts(date);
    var rel = date === today ? 'Today' : date === shift(today, -1) ? 'Yesterday' : '';
    return { text: x.dow + ' ' + x.day + ' ' + x.month, rel: rel };
  }
  function shift(date, n) {
    var p = String(date).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  // Within about 10% of target is green. Well over or under is amber. No red, and no judgement in the words.
  function tone(val, target) { if (!target) return ''; var r = val / target; return r >= 0.9 && r <= 1.1 ? 'dc-ok' : 'dc-off'; }
  function metric(label, val, target, unit) {
    var t = tone(val, target);
    var pct = target ? Math.min(100, Math.round(val / target * 100)) : 0;
    var figure = target ? fmt(val) + ' of ' + fmt(target) + unit : fmt(val) + unit;
    return '<div class="dc-m ' + t + '"><div class="dc-m-top"><span>' + label + '</span><b>' + figure + '</b></div>' +
      (target ? '<div class="dc-bar"><span style="width:' + pct + '%"></span></div>' : '') + '</div>';
  }
  var SOURCE = { plan: 'From plan', ai: 'Described', builder: 'Meal Builder', typed: 'Typed in' };
  function totals(meals) {
    var t = { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
    meals.forEach(function (m) { Object.keys(t).forEach(function (k) { t[k] += Number(m[k]) || 0; }); });
    return t;
  }
  // Sets as people read them: "3 × 8 at 60 kg", or each set when they differ.
  function setsText(sets) {
    if (!sets || !sets.length) return 'no sets';
    var reps = sets.map(function (s) { return s.reps; }), kgs = sets.map(function (s) { return s.kg; });
    var sameReps = reps.every(function (r) { return r === reps[0]; }), sameKg = kgs.every(function (k) { return k === kgs[0]; });
    if (sameReps && sameKg) return sets.length + ' × ' + (reps[0] == null ? '-' : reps[0]) + (kgs[0] != null ? ' at ' + kgs[0] + ' kg' : '');
    return sets.map(function (s) { return (s.kg != null ? s.kg + ' kg × ' : '') + (s.reps == null ? '-' : s.reps); }).join(', ');
  }
  function exercises(w, planned) {
    var list = (w.session && w.session.exercises) || [];
    return list.map(function (e) {
      var plan = planned && planned[e.name] ? '<span class="dc-planned"> (planned ' + esc(planned[e.name]) + ')</span>' : '';
      var done = e.skipped ? '<span class="dc-planned">skipped</span>' : '<span>' + esc(setsText(e.sets)) + '</span>';
      return '<div class="dc-ex"><b>' + esc(e.name) + '</b> ' + done + plan + '</div>';
    }).join('');
  }
  function mealRow(m) {
    var tags = [];
    if (m.source) tags.push('<span class="dc-tag">' + esc(SOURCE[m.source] || m.source) + '</span>');
    if (m.edited) tags.push('<span class="dc-tag dc-tag-warn">Edited</span>');
    if (m.added_late) tags.push('<span class="dc-tag dc-tag-warn">Added late</span>');
    var desc = m.entry_text ? '<div class="dc-desc">' + esc(m.entry_text) + '</div>' :
      '<div class="dc-desc dc-planned">No written description. Logged as ' + esc((SOURCE[m.source] || 'typed in').toLowerCase()) + '.</div>';
    return '<details class="dc-meal"><summary>' +
      '<div class="dc-meal-name">' + (m.meal_time ? '<span class="dc-time">' + esc(m.meal_time) + '</span>' : '') + esc(m.name) + '</div>' +
      '<div class="dc-kcal">' + fmt(m.calories) + ' kcal</div>' +
      '<div class="dc-macros">P ' + fmt(m.protein) + ' g · C ' + fmt(m.carbs) + ' g · F ' + fmt(m.fat) + ' g</div>' +
      (tags.length ? '<div class="dc-tags">' + tags.join('') + '</div>' : '') +
      '</summary>' + desc + '</details>';
  }
  function body(day, opts) {
    var t = opts.targets || {}, meals = day.meals || [], wos = day.workouts || [], parts = [];
    if (meals.length) {
      parts.push('<div class="dc-sec">Meals</div>' + meals.map(mealRow).join(''));
    }
    if (wos.length) {
      parts.push('<div class="dc-sec">Workouts</div>' + wos.map(function (w) {
        if (w.session) return '<div class="dc-wo"><b>' + esc(w.what || 'Workout') + '</b>' + (w.added_late ? ' <span class="dc-tag dc-tag-warn">Added late</span>' : '') + exercises(w, opts.planned) + (w.notes ? '<div class="dc-planned">' + esc(w.notes) + '</div>' : '') + '</div>';
        return '<div class="dc-wo"><b>Other activity</b>: ' + esc(w.what || '') + (w.minutes ? ' · ' + fmt(w.minutes) + ' min' : '') + (w.notes ? '<div class="dc-planned">' + esc(w.notes) + '</div>' : '') + '</div>';
      }).join(''));
    }
    return parts.join('');
  }
  // One day. Days with nothing logged are a single quiet line, not an empty card.
  function render(day, opts) {
    opts = opts || {};
    var t = opts.targets || {};
    var lab = dayLabel(day.date, opts.today);
    var meals = day.meals || [], wos = day.workouts || [];
    var empty = !meals.length && !wos.length && day.steps == null && day.weigh == null;
    if (empty) return '<div class="dc-quiet"><b>' + esc(lab.text) + '</b>' + (lab.rel ? ' · ' + lab.rel : '') + ' · Nothing logged</div>';
    var tot = totals(meals);
    var strip = [];
    if (meals.length) {
      strip.push(metric('Calories', tot.calories, t.calories, ' kcal'));
      strip.push(metric('Protein', tot.protein, t.protein, ' g'));
    }
    if (day.steps != null) strip.push(metric('Steps', day.steps, t.steps, ''));
    if (day.weigh != null) strip.push('<div class="dc-m"><div class="dc-m-top"><span>Weigh-in</span><b>' + Number(day.weigh).toFixed(1) + ' kg</b></div></div>');
    var summary = '<summary><div class="dc-head"><span class="dc-date">' + esc(lab.text) + '</span>' +
      (lab.rel ? '<span class="dc-tag-day">' + lab.rel + '</span>' : '') + '</div>' +
      (strip.length ? '<div class="dc-strip">' + strip.join('') + '</div>' : '') + '</summary>';
    var inner = body(day, opts);
    return '<details class="dc" data-date="' + esc(day.date) + '"' + (opts.open ? ' open' : '') + '>' + summary +
      (inner ? '<div class="dc-body">' + inner + '</div>' : '<div class="dc-body"><p class="dc-none">Nothing logged</p></div>') + '</details>';
  }
  // The week's averages: calories and protein per logged day, steps per day with steps, and the workout count.
  function weekAverages(days) {
    var kcal = [], pro = [], steps = [], workouts = 0;
    (days || []).forEach(function (d) {
      if (d.meals && d.meals.length) { var t = totals(d.meals); kcal.push(t.calories); pro.push(t.protein); }
      if (d.steps != null) steps.push(Number(d.steps));
      workouts += (d.workouts || []).length;
    });
    var avg = function (a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; };
    return { calories: avg(kcal), protein: avg(pro), steps: avg(steps), workouts: workouts, loggedDays: kcal.length };
  }
  function weekHeading(title, avg) {
    // Calories, protein and steps are averages per day. The workouts are a count for the whole week.
    var perDay = [];
    perDay.push(avg.calories == null ? 'No meals logged' : fmt(avg.calories) + ' kcal');
    perDay.push(avg.protein == null ? '' : 'P ' + fmt(avg.protein) + ' g');
    perDay.push(avg.steps == null ? 'No steps' : fmt(avg.steps) + ' steps');
    var avgText = 'Average per day: ' + perDay.filter(Boolean).join(' · ');
    var wk = avg.workouts + (avg.workouts === 1 ? ' workout' : ' workouts') + ' this week';
    return '<div class="dc-week"><h4>' + esc(title) + '</h4><p>' + avgText + ' · ' + wk + '</p></div>';
  }
  var api = { render: render, weekAverages: weekAverages, weekHeading: weekHeading, dayLabel: dayLabel, tone: tone, shift: shift, totals: totals, css: CSS };
  injectCss();
  root.DayCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
