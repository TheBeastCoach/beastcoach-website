/* Basic plan daily targets.
 *
 * Copied from the calculate() function in calculator.html, so the two must stay in step.
 * Same maths: Mifflin-St Jeor BMR, job multiplier, steps kcal and training kcal added to
 * maintenance, then the goal adjustment, then protein, fat, carbs and fibre.
 *
 * Maintain: the calculator has no "maintain" goal. It uses the calculator's own maintenance
 * branch (adjustment 0), with the Tone / Recomp protein and fat ratios. Confirm before launch.
 *
 * Loaded by coaching-demo.html (window.BasicTargets) and by tests (module.exports).
 */
(function (root) {
  var GOALS = {
    fatloss:  { label: 'Fat loss',          proteinPerKg: 2.2, delta: -500, fatPct: 0.25 },
    maintain: { label: 'Maintain',          proteinPerKg: 2.0, delta: 0,    fatPct: 0.27 },
    muscle:   { label: 'Muscle / Strength', proteinPerKg: 1.8, delta: 300,  fatPct: 0.25 }
  };

  // i: { sex: 'male'|'female', age, heightCm, weightKg, activity (1.15|1.25|1.35),
  //      steps, trainingSessions, trainingIntensity (200|350|500 kcal per session), goal }
  function calcTargets(i) {
    var weightKg = i.weightKg, heightCm = i.heightCm, age = i.age;
    var bmr = i.sex === 'male'
      ? (10 * weightKg + 6.25 * heightCm - 5 * age + 5)
      : (10 * weightKg + 6.25 * heightCm - 5 * age - 161);

    var stepsKcal = i.steps * weightKg * 0.00057;
    var trainingKcalPerDay = (i.trainingSessions * i.trainingIntensity) / 7;
    var tdee = (bmr * i.activity) + stepsKcal + trainingKcalPerDay;

    var g = GOALS[i.goal];
    var targetCalories = tdee + g.delta;
    var proteinG = weightKg * g.proteinPerKg;
    var fatKcal = targetCalories * g.fatPct;
    var carbKcal = Math.max(0, targetCalories - proteinG * 4 - fatKcal);

    return {
      maintenance: Math.round(tdee),
      calories: Math.round(targetCalories),
      protein: Math.round(proteinG),
      carbs: Math.round(carbKcal / 4),
      fat: Math.round(fatKcal / 9),
      fibre: Math.round((targetCalories / 1000) * 14)
    };
  }

  // Steps target: the realistic daily target the client gave, kept between 3,000 and 20,000.
  // Calories use the everyday steps (steps without planned walks), the conservative choice.
  function stepsTarget(realisticSteps) {
    return Math.min(20000, Math.max(3000, Math.round(realisticSteps)));
  }

  var api = { GOALS: GOALS, calcTargets: calcTargets, stepsTarget: stepsTarget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BasicTargets = api;
})(typeof window !== 'undefined' ? window : this);
