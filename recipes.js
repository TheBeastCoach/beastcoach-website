// Beast Coach — Recipes data file
// Add a new recipe by copying the {...} block below and giving it a unique id.
// Save this file and re-upload it to your repo — you never need to touch portal.html for this.

const RECIPES = [
  {
    id: "ice-cream-sandwich",
    chip: "Ice Cream Sandwich",
    title: "Sweet Potato & Rice Cake Ice Cream Sandwich",
    desc: "A high-volume, satiating frozen snack that balances complex carbs and slow-digesting protein.",
    ingredients: ["2 plain thin rice cakes", "120g baked sweet potato (skin removed, chilled)", "100g non-fat plain Greek yogurt", "10g unsweetened dark cocoa powder", "Stevia or zero-calorie sweetener, to taste", "Splash of unsweetened almond milk, if needed to blend"],
    instructions: ["Blend or mash baked sweet potato, Greek yogurt, cocoa powder, and sweetener until completely smooth and thick.", "Spread evenly across the surface of one rice cake and top with the second.", "Freeze for 45 to 60 minutes until firm but biteable."],
    macros: [["230", "kcal"], ["13g", "Protein"], ["40g", "Carbs"], ["2g", "Fat"]]
  },
  {
    id: "protein-jellies",
    chip: "Protein Jellies",
    title: "Monster Energy Protein Jellies",
    desc: "A portable, zero-fat caffeine boost designed for pre-workout or afternoon energy.",
    ingredients: ["500ml Ultra/Zero-Sugar Monster Energy, chilled", "20g unflavored gelatin powder", "30g whey protein isolate or clear whey isolate, matching flavor", "60ml cold water"],
    instructions: ["Bloom gelatin in 60ml cold water for 5 minutes.", "Gently warm 150ml of Monster over low heat (do not boil); stir in bloomed gelatin until dissolved.", "Whisk protein isolate into remaining cold Monster, combine with the gelatin liquid, and pour into silicone molds.", "Chill in the fridge for 3 to 4 hours until set. Store uncovered or with a paper towel to prevent condensation."],
    macros: [["190", "kcal (batch)"], ["42g", "Protein"], ["2g", "Carbs"], ["0g", "Fat"]]
  },
  {
    id: "creme-brulee",
    chip: "Crème Brûlée",
    title: "High-Protein Crème Brûlée (Gelato Option)",
    desc: "A decadent custard dessert transformed into a macro-friendly evening staple.",
    ingredients: ["150g non-fat Greek yogurt (or liquid egg whites, cooked gently sous-vide style)", "25g vanilla casein or whey/casein blend protein powder", "1 egg yolk, optional, for authentic custardy mouthfeel", "1 tsp vanilla extract", "1 tbsp granular erythritol/allulose blend, for torching"],
    instructions: ["Whisk Greek yogurt, protein powder, vanilla extract, and egg yolk thoroughly until glossy and smooth. For gelato: churn in a mini ice-cream maker, or freeze 90 minutes, stirring every 30 minutes.", "Transfer into a shallow ramekin and level the top.", "Sprinkle granular sweetener evenly across the surface and caramelize using a kitchen blowtorch until crisp."],
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
    chip: "Cheeseburgers",
    title: "Savory Rice Cake Cheeseburgers",
    desc: "Satisfies burger cravings without the heavy refined-carb load of traditional brioche.",
    ingredients: ["2 large lightly salted rice cakes (or tomato/cheese flavored)", "150g extra-lean ground beef (95/5 or 96/4)", "1 slice low-fat burger cheese, e.g. light cheddar", "2 dill pickle slices, shredded lettuce, thin tomato slice", "15g light burger sauce (light mayo, sugar-free ketchup, mustard blend)", "Salt, black pepper, garlic powder, to taste"],
    instructions: ["Season and smash lean beef into a thin, wide patty in a hot non-stick pan; sear 2 minutes per side.", "Melt cheese slice on patty during the last 30 seconds of cooking.", "Layer sauce, pickles, lettuce, tomato, and cheesy patty between the two rice cakes. Eat immediately while crisp."],
    macros: [["330", "kcal"], ["38g", "Protein"], ["16g", "Carbs"], ["8g", "Fat"]]
  },
  {
    id: "protein-waffles",
    chip: "Protein Waffles",
    title: "Oat Flour Protein Waffles & Pancakes",
    desc: "A high-fiber, low-glycemic breakfast that holds up under sugar-free maple syrup.",
    ingredients: ["40g rolled oats, blended into fine flour", "30g whey/casein blend protein powder", "100g liquid egg whites", "1/2 tsp baking powder", "45ml unsweetened almond milk"],
    instructions: ["Blend all ingredients until smooth; let batter sit for 3 minutes to thicken.", "Pour into a preheated, non-stick waffle iron for 3 to 4 minutes, or flip in a skillet for pancakes."],
    macros: [["310", "kcal"], ["37g", "Protein"], ["30g", "Carbs"], ["4g", "Fat"]]
  },
  {
    id: "lamb-chimichurri",
    chip: "Lamb Chimichurri",
    title: "Lean Lamb Herb & Yogurt Chimichurri Sauce",
    desc: "A bright, acidic drizzle formulated to complement lamb cuts without pouring on olive oil calories.",
    ingredients: ["60g non-fat Greek yogurt", "1 tbsp fresh flat-leaf parsley, finely chopped", "1 tbsp fresh mint, finely chopped", "1 clove garlic, minced", "1 tbsp red wine vinegar or lemon juice", "1/2 tsp dried oregano, red pepper flakes, salt, and black pepper"],
    instructions: ["Whisk all ingredients in a small prep bowl until well incorporated.", "Let sit 10 minutes before spooning over grilled lamb backstrap or cutlets."],
    macros: [["45", "kcal (batch)"], ["6g", "Protein"], ["4g", "Carbs"], ["0.5g", "Fat"]]
  },
  {
    id: "pb-replacement",
    chip: "PB Replacement",
    title: "Sweet Potato Peanut Butter Replacement",
    desc: "A dense, high-volume alternative to traditional peanut butter that slashes dietary fat while keeping complex carbs high for training fuel.",
    ingredients: ["300g sweet potato, roasted or steamed, skin removed", "48g (about 4 tbsp) powdered peanut butter, e.g. PB2 or Macro Mike", "1/2 tsp ground cinnamon", "1 tsp vanilla extract", "Stevia or monk fruit sweetener, to taste", "2 to 3 tbsp unsweetened almond milk or water, optional, to reach desired consistency"],
    instructions: ["Roast (or steam) the sweet potato until fork-tender throughout; let cool slightly.", "Add the warm sweet potato, peanut butter powder, cinnamon, vanilla, and sweetener to a food processor or blender.", "Blend on high until completely silky and whipped, adding a splash of liquid only if needed to loosen the blades.", "Transfer to an airtight jar and chill. Thickens further in the fridge; stays fresh for 4 to 5 days."],
    macros: [["110", "kcal/serving"], ["7g", "Protein"], ["19g", "Carbs"], ["1.5g", "Fat"]]
  },
  {
    id: "choc-mousse",
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
    instructions: ["Blend the sweet potato, cacao powder, Greek yogurt, and almond milk until completely smooth.", "Pour into a Ninja Creami pint container and freeze solid (usually 20 to 24 hours).", "Process in the Ninja Creami on the ice cream setting until smooth and scoopable."],
    macros: [["~255", "kcal (est.)"], ["13g", "Protein"], ["47g", "Carbs"], ["1.5g", "Fat"]]
  }
];
