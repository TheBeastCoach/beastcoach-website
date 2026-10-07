// Beast Coach — Recipes data file
// Add a new recipe by copying the {...} block below and giving it a unique id.
// Save this file and re-upload it to your repo — you never need to touch portal.html for this.

const RECIPES = [
  {
    id: "ice-cream-sandwich",
    chip: "Sweet Potato Brownie Ice Cream Sandwich",
    image: "recipe-img/ice-cream-sandwich.jpg",
    title: "Sweet Potato Brownie Ice Cream Sandwich",
    desc: "A high-volume, satiating frozen snack that balances complex carbs and slow-digesting protein.",
    ingredients: ["2 plain thin rice cakes (optional)", "120g baked sweet potato (skin removed, chilled)", "100g non-fat plain Greek yogurt", "10g unsweetened dark cocoa powder", "Stevia or zero-calorie sweetener to taste, or 1 tbsp honey", "Up to 200ml unsweetened almond milk, if needed to blend", "Splash of vanilla extract"],
    instructions: ["Blend the sweet potato, Greek yogurt, cocoa powder, sweetener or honey, vanilla, and almond milk until completely smooth.", "Pour into a Ninja Creami pint container, level the top, and freeze flat for at least 16 hours.", "Process in the Ninja Creami on the Lite Ice Cream setting. If it comes out crumbly or powdery, add a splash of almond milk and re-spin.", "Spread a thick layer between two rice cakes and eat straight away, or skip the rice cakes and eat it from the pint."],
    macros: [["230", "kcal"], ["13g", "Protein"], ["40g", "Carbs"], ["2g", "Fat"]]
  },
  {
    id: "protein-jellies",
    chip: "Protein Jellies",
    image: "recipe-img/protein-jellies.jpg",
    title: "Monster Energy Protein Jellies",
    desc: "A portable, zero-fat caffeine boost designed for pre-workout or afternoon energy.",
    ingredients: ["500ml Ultra/Zero-Sugar Monster Energy, chilled", "20g unflavored gelatin powder", "30g whey protein isolate or clear whey isolate, matching flavor", "60ml cold water"],
    instructions: ["Bloom the gelatin in 60ml cold water for 5 minutes.", "Gently warm 150ml of the Monster over low heat (do not boil), then stir in the bloomed gelatin until fully dissolved.", "Whisk the protein isolate into the remaining 350ml cold Monster (let it go flat first, or skim the foam), then slowly pour in the warm gelatin liquid while whisking.", "Pour into silicone molds and chill for 3 to 4 hours until set. Store uncovered or with a paper towel over them to prevent condensation."],
    macros: [["190", "kcal (batch)"], ["42g", "Protein"], ["2g", "Carbs"], ["0g", "Fat"]]
  },
  {
    id: "creme-brulee",
    image: "recipe-img/creme-brulee.jpg",
    chip: "Crème Brûlée",
    title: "High-Protein Crème Brûlée (Gelato Option)",
    desc: "A decadent custard dessert transformed into a macro-friendly evening staple.",
    ingredients: ["150g non-fat Greek yogurt (or liquid egg whites, cooked gently sous-vide style)", "25g vanilla casein or whey/casein blend protein powder", "1 pasteurised egg yolk, optional, for authentic custardy mouthfeel (it isn't cooked)", "1 tsp vanilla extract", "1 tbsp granular erythritol/allulose blend, for torching"],
    instructions: ["Whisk the Greek yogurt, protein powder, vanilla extract, and egg yolk (if using) until glossy and smooth.", "Spoon into a shallow ramekin, level the top, and chill for at least 30 minutes so it firms up.", "Sprinkle the granular sweetener evenly over the surface and torch until golden and crisp. Gelato option: skip the torch and churn the mix in a mini ice-cream maker, or freeze for 90 minutes, stirring every 30 minutes."],
    macros: [["245", "kcal"], ["34g", "Protein"], ["7g", "Carbs"], ["6g", "Fat"]]
  },
  {
    id: "recovery-hot-chocolate",
    chip: "Recovery Hot Chocolate",
    title: "High-Magnesium Recovery Hot Chocolate",
    desc: "Designed for post-workout neural recovery and deeper sleep quality.",
    ingredients: ["250ml unsweetened almond milk", "15g raw organic cacao powder", "15g pumpkin seed meal / powdered pumpkin seeds", "10g ground chia seeds", "1 scoop (25g) unflavored or chocolate collagen/casein powder", "Pinch of pink Himalayan sea salt, plus zero-calorie sweetener to taste"],
    instructions: ["Whisk almond milk, cacao, finely ground pumpkin seeds, and chia seeds in a small saucepan over medium-low heat.", "Simmer gently for 2 to 3 minutes until the chia and seeds slightly thicken the liquid.", "Remove from heat, whisk in protein/collagen vigorously until dissolved, and serve hot."],
    macros: [["275", "kcal"], ["31g", "Protein"], ["8g", "Carbs"], ["12g", "Fat"]]
  },
  {
    id: "cheeseburgers",
    image: "recipe-img/cheeseburgers.jpg",
    chip: "Cheeseburgers",
    title: "Savory Rice Cake Cheeseburgers",
    desc: "Satisfies burger cravings without the heavy refined-carb load of traditional brioche.",
    ingredients: ["2 large lightly salted rice cakes (or tomato/cheese flavored)", "150g extra-lean ground beef (95/5 or 96/4)", "1 slice low-fat burger cheese, e.g. light cheddar", "2 dill pickle slices, shredded lettuce, thin tomato slice", "15g light burger sauce (light mayo, sugar-free ketchup, mustard blend)", "Salt, black pepper, garlic powder, to taste"],
    instructions: ["Season and smash lean beef into a thin, wide patty in a hot non-stick pan; sear 2 minutes per side.", "Melt cheese slice on patty during the last 30 seconds of cooking.", "Layer sauce, pickles, lettuce, tomato, and cheesy patty between the two rice cakes. Eat immediately while crisp."],
    macros: [["330", "kcal"], ["38g", "Protein"], ["16g", "Carbs"], ["8g", "Fat"]]
  },
  {
    id: "protein-waffles",
    image: "recipe-img/protein-waffles.jpg",
    chip: "Protein Waffles",
    title: "Oat Flour Protein Waffles & Pancakes",
    desc: "A high-fiber, low-glycemic breakfast that holds up under sugar-free maple syrup.",
    ingredients: ["40g rolled oats, blended into fine flour", "30g whey/casein blend protein powder", "100g liquid egg whites", "1/2 tsp baking powder", "45ml unsweetened almond milk"],
    instructions: ["Blend all ingredients until smooth, then let the batter sit for 3 minutes to thicken.", "Waffles: pour into a preheated, greased waffle iron and cook for 3 to 4 minutes. Pancakes: cook in a non-stick pan over medium heat for 2 to 3 minutes until bubbles form, then flip and cook 1 to 2 minutes more."],
    macros: [["310", "kcal"], ["37g", "Protein"], ["30g", "Carbs"], ["4g", "Fat"]]
  },
  {
    id: "lamb-chimichurri",
    image: "recipe-img/lamb-chimichurri.jpg",
    chip: "Lamb Chimichurri",
    title: "Lean Lamb Herb & Yogurt Chimichurri Sauce",
    desc: "A bright, acidic drizzle formulated to complement lamb cuts without pouring on olive oil calories.",
    ingredients: ["60g non-fat Greek yogurt", "1 tbsp fresh flat-leaf parsley, finely chopped", "1 tbsp fresh mint, finely chopped", "1 clove garlic, minced", "1 tbsp red wine vinegar or lemon juice", "1/2 tsp dried oregano, red pepper flakes, salt, and black pepper"],
    instructions: ["Whisk all ingredients in a small prep bowl until well incorporated.", "Let sit 10 minutes before spooning over grilled lamb backstrap or cutlets."],
    macros: [["45", "kcal (batch)"], ["6g", "Protein"], ["4g", "Carbs"], ["0.5g", "Fat"]]
  },
  {
    id: "pb-replacement",
    image: "recipe-img/pb-replacement.jpg",
    chip: "PB Replacement",
    title: "Sweet Potato Peanut Butter Replacement",
    desc: "A dense, high-volume alternative to traditional peanut butter that slashes dietary fat while keeping complex carbs high for training fuel.",
    ingredients: ["300g sweet potato, roasted or steamed, skin removed", "48g (about 4 tbsp) powdered peanut butter, e.g. PB2 or Macro Mike", "1/2 tsp ground cinnamon", "1 tsp vanilla extract", "Stevia or monk fruit sweetener, to taste", "2 to 3 tbsp unsweetened almond milk or water, optional, to reach desired consistency"],
    instructions: ["Roast (or steam) the sweet potato until fork-tender throughout; let cool slightly.", "Add the warm sweet potato, peanut butter powder, cinnamon, vanilla, and sweetener to a food processor or blender.", "Blend on high until completely silky and whipped, adding a splash of liquid only if needed to loosen the blades.", "Transfer to an airtight jar and chill. Thickens further in the fridge; stays fresh for 4 to 5 days."],
    macros: [["~50", "kcal per 40g"], ["3g", "Protein"], ["8g", "Carbs"], ["0.5g", "Fat"]]
  },
  {
    id: "choc-mousse",
    image: "recipe-img/choc-mousse.jpg",
    chip: "Choc Mousse",
    title: "High-Protein Chocolate Mousse",
    desc: "An ultra-lean dessert hack using cooked egg whites as an odorless, neutral-flavor aerating agent that whips into a thick, glossy pudding.",
    ingredients: ["200g liquid egg whites, carton or fresh", "1 scoop (30g) chocolate whey/casein blend, or whey isolate", "2 heaped tsp (10g) unsweetened baking cocoa powder", "2 heaped tsp (10g) sugar-free hot chocolate powder, e.g. Avalanche or Jarrah", "1 heaped tbsp (30g) low-fat or non-fat plain Greek yogurt", "Optional: 1 to 2 tbsp cold water or unsweetened almond milk, plus zero-calorie sweetener if extra sweetness is preferred"],
    instructions: ["Microwave the egg whites in a bowl in 45-second intervals, stirring between bursts until just set (soft-scrambled, not browned or rubbery). Alternatively, steam or soft-poach them.", "Allow the cooked whites to cool for 5 minutes so they don't curdle the protein powder.", "Transfer the cooked egg whites, protein powder, cocoa powder, hot chocolate mix, Greek yogurt, and sweetener into a high-speed blender or bullet blender.", "Blend on high for 60 to 90 seconds, stopping to scrape down the sides, until velvety and uniform.", "Pour into a bowl or ramekin and refrigerate for 2 to 4 hours to chill and set into a firm, spoonable mousse."],
    macros: [["275", "kcal"], ["49g", "Protein"], ["13g", "Carbs"], ["3.5g", "Fat"]]
  },
  {
    id: "creami-sweet-potato",
    chip: "Creami Sweet Potato",
    title: "Ninja Creami Sweet Potato & Cacao \"Ice Cream\"",
    desc: "A simple, no-added-sugar frozen dessert made in the Ninja Creami, using sweet potato as the base instead of cream or bananas.",
    ingredients: ["200g sweet potato, cooked and cooled", "1 tbsp cacao powder", "100g low-fat Greek yogurt", "Splash of unsweetened almond milk, to blend"],
    instructions: ["Blend the sweet potato, cacao powder, Greek yogurt, and almond milk until completely smooth.", "Pour into a Ninja Creami pint container, level the top, and freeze flat for at least 16 hours (24 is ideal).", "Process on the Lite Ice Cream setting. If it comes out crumbly or powdery, add a splash of almond milk and re-spin."],
    macros: [["~255", "kcal (est.)"], ["13g", "Protein"], ["47g", "Carbs"], ["1.5g", "Fat"]]
  },
  {
    id: "chia-lemon-creatine-tonic",
    image: "recipe-img/chia-lemon-creatine-tonic.jpg",
    chip: "Chia Lemon Tonic",
    title: "Chia, Lemon & Honey Creatine Tonic",
    desc: "A thick, tangy between-meals tonic that doubles as an easy way to get your daily creatine down without the chalky aftertaste.",
    ingredients: ["12g chia seeds", "250ml boiling hot water", "Juice of 1 whole lemon", "1 tsp honey", "1 serving (5g) creatine monohydrate"],
    instructions: ["Add the chia seeds to a glass and pour over the hot water.", "Stir in the lemon juice, honey, and creatine.", "Let it sit for 5 minutes, stirring once halfway, so the chia swells and thickens the drink, then drink it. Creatine adds no meaningful calories, so the macros are for the chia, lemon, and honey."],
    macros: [["90", "kcal"], ["2g", "Protein"], ["15g", "Carbs"], ["3.5g", "Fat"]]
  },
  {
    id: "cacao-chia-pumpkin-smoothie",
    chip: "Magnesium Smoothie",
    image: "recipe-img/magnesium-smoothie.jpg",
    title: "Magnesium Smoothie",
    desc: "A magnesium-rich seed and cacao blend stirred into a chocolate-strawberry protein smoothie. Chia brings fiber and omega-3s, raw cacao brings magnesium and polyphenols, and pumpkin seeds bring magnesium, zinc, and plant protein on top of the shake's whey.",
    ingredients: ["12g chia seeds", "1 tbsp (about 5g) raw cacao powder", "30g pumpkin seeds (pepitas)", "1 scoop (30g) chocolate protein powder", "100g strawberries", "200ml almond milk"],
    instructions: ["Blend the chia seeds, cacao powder, pumpkin seeds, protein powder, strawberries, and almond milk until smooth. (The chia, cacao, and pumpkin seed trio also works as an add-in for any smoothie.)", "Drink straight away, or let it sit a few minutes if you want the chia to thicken it."],
    macros: [["415", "kcal"], ["38g", "Protein"], ["23g", "Carbs"], ["23g", "Fat"]]
  }
];
