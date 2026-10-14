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
    desc: "A magnesium-and-protein-dense seed, strawberry, and cottage cheese shake. Flaxseed, chia, and pepitas bring magnesium, zinc, fiber, and omega-3s, while liquid egg whites and low-fat cottage cheese push you past 30g of protein before the milk even goes in.",
    ingredients: ["10g ground flaxseed", "12g chia seeds", "30g pumpkin seeds (pepitas)", "50g pasteurized liquid egg whites", "100g low-fat cottage cheese", "100g frozen strawberries", "150–200ml ultra-filtered high-protein skim milk (or standard skim/light milk for a lighter protein version)", "4–5 ice cubes", "Stevia or a few drops of liquid monk fruit, to taste (optional)"],
    instructions: ["Blend the flaxseed, chia seeds, pepitas, and milk on high for 30–45 seconds first, so the seeds fully break down.", "Add the cottage cheese, liquid egg whites, strawberries, and ice, then blend again until velvety and aerated.", "Taste and add stevia or monk fruit if you want to balance the tartness of the berries and cottage cheese. 200ml of ultra-filtered high-protein milk (e.g. Fairlife) gets you to roughly 43g protein; swap in standard skim milk instead for a lighter ~36–38g protein version."],
    macros: [["500", "kcal"], ["43g", "Protein"], ["30g", "Carbs"], ["25g", "Fat"]]
  },
  {
    id: "spiced-pumpkin-latte-creami",
    chip: "Spiced Pumpkin Latte Creami",
    image: "recipe-img/spiced-pumpkin-latte-creami.jpg",
    title: "Spiced Pumpkin Latte Creami",
    desc: "A Ninja Creami pumpkin-spice latte, built from roasted butternut pumpkin, cottage cheese, and Greek yoghurt instead of cream and sugar — espresso and warm spice give it full coffee-shop flavour for a fraction of the kcal. Base stats: ~235 kcal, 23.5g protein, 2.5g fat, 27g carbs (optional waffle cone: add 57 kcal).",
    ingredients: ["100g roasted butternut pumpkin (roasted until soft and naturally sweet)", "100g low-fat cottage cheese", "100g fat-free Greek yoghurt", "1.5 tsp (10g) honey", "1 tsp instant espresso powder (or 15ml cooled espresso)", "1/2 tsp pumpkin pie spice blend (optional: cinnamon only)", "1/2 tsp vanilla extract", "30–50ml unsweetened almond milk (to reach pint fill line if needed)"],
    instructions: ["Cook: Roast the butternut pumpkin in the oven until tender and lightly caramelised, then let it cool slightly.", "Blend: Add the roasted butternut pumpkin, cottage cheese, Greek yoghurt, honey, espresso powder, pumpkin pie spice blend (or cinnamon only), and vanilla into a food processor. Blend until silky smooth to completely break down the cottage cheese curds.", "Prep Pint: Pour the mixture into your Ninja Creami pint (top up with a splash of unsweetened almond milk to the max fill line if needed) and freeze flat for at least 16–24 hours (up to 60+ hours).", "Spin: Process on the Light Ice Cream setting. If slightly powdery on the first run, add a splash of almond milk and run a Re-spin.", "Serve: Enjoy straight from the pint, or scoop into a cone (optional: adds 57 kcal)."],
    macros: [["235", "kcal"], ["23.5g", "Protein"], ["27g", "Carbs"], ["2.5g", "Fat"]]
  },
  {
    id: "zooper-dooper-protein-pops",
    chip: "Zooper Dooper Protein Pops",
    image: "recipe-img/zooper-dooper-protein-pops.jpg",
    title: "Zooper Dooper Protein Pops",
    desc: "A clever reseal hack that turns Zooper Doopers into high-protein ice pops — pour most of the juice out, pipe in a cottage cheese and Greek yoghurt base, then heat-seal the tube shut with a hair straightener. Two methods below: a soft-serve swirl version using the Ninja Creami, or a fast, no-pre-freeze blender version. Makes ~8–10 resealed tubes, about 55–60 kcal and 5.5–6g protein each.",
    ingredients: ["200g low-fat cottage cheese (adds casein for a creamy, slow-melting texture)", "200g low-fat Greek yoghurt (Chobani Fit, YoPRO, or plain low-fat)", "50–75ml unsweetened almond milk (a light splash to loosen the blend)", "1.5–2 tbsp honey (~30g, or adjust to taste)", "1 tsp vanilla extract", "Small pinch of salt (balances the tang and brings out the honey/vanilla)", "8–10 Zooper Dooper tubes (snip the top, pour out ~75% of the liquid, leaving the bottom 25% for flavor contrast)"],
    instructions: [
      "Method 1 — Ninja Creami Route (soft-serve swirl texture, best for an ultra-smooth, aerated mouthfeel before re-freezing):",
      "1. Blend Base and Freeze Pint: Add the cottage cheese, Greek yoghurt, almond milk, honey, vanilla, and salt to a blender. Blend until silky with no curds remaining. Pour into a standard Ninja Creami pint and freeze solid for 24 hours.",
      "2. Spin to Soft Serve: Run the frozen pint on the Lite Ice Cream cycle. If it looks chalky or powdery, add 1 tablespoon of almond milk to the center and run a Re-spin cycle until it reaches soft-serve consistency.",
      "3. Pipe and Seal: Transfer the churned soft serve directly into a piping bag. Snip the tip and pipe into the prepped Zooper Dooper tubes on top of the remaining juice. Wipe the top inner rim clean and dry.",
      "4. Heat-Seal and Reset: Clamp a hair straightener set to low/medium heat (around 120–140°C) across the dry plastic opening for 3–5 seconds to fuse the seam — use low heat to avoid melting through. Stand upright in the freezer for 1–2 hours to firm back up.",
      "Method 2 — Direct Blender Route (classic ice-pole texture, fastest, no 24-hour pint pre-freeze required):",
      "1. Blend Smooth: Add all ingredients into a high-speed blender or bullet blender. Blend on high for 45–60 seconds until completely emulsified and glossy, ensuring all cottage cheese curds are fully liquefied.",
      "2. Fill Tubes via Piping Bag: Pour the liquid batter directly into a piping bag. Snip a small opening and pipe the mix directly into each Zooper Dooper tube, leaving about 2cm of head space at the top.",
      "3. Wipe and Heat-Seal: Wipe any excess liquid from the top inside seal with paper towel — this is crucial, as it won't fuse if wet. Clamp the dry plastic edge with the hair straightener for 3–5 seconds until heat-fused shut.",
      "4. Freeze Solid: Shake gently to settle the mixture into the remaining Zooper Dooper juice, then lay flat or stand upright in the freezer for 4–6 hours until completely frozen."
    ],
    macros: [["55–60", "kcal"], ["5.5–6g", "Protein"], ["7g", "Carbs"], ["0.6–0.8g", "Fat"]]
  },
  {
    id: "blackberry-magnesium-smoothie",
    chip: "Blackberry Magnesium Smoothie",
    image: "recipe-img/blackberry-magnesium-smoothie.jpg",
    title: "Blackberry Magnesium Smoothie",
    desc: "An all-natural, seed-and-berry smoothie built around magnesium and recovery, not just protein. Pepitas, chia, cottage cheese, Greek yoghurt, and egg whites bring the protein, while frozen blackberries add fibre and a serious anthocyanin dose. Magnesium: about 250mg per serve (roughly 60% of a typical daily target) — 170mg from the pepitas, 40mg from the chia, 20mg from the blackberries. Inflammation support: Cyanidin-3-glucoside from the blackberries is a powerful anthocyanin that helps blunt exercise-induced oxidative stress and down-regulate COX-2 enzymes; the chia contributes roughly 2,100mg of plant omega-3 (ALA) to counter systemic pro-inflammatory eicosanoids; and the combined zinc (over 2.3mg) and magnesium support muscle relaxation and tissue repair without the gut issues some magnesium supplements cause.",
    ingredients: ["30g pumpkin seeds (pepitas)", "12g chia seeds", "50g pasteurized liquid egg whites", "100g low-fat cottage cheese", "50g low-fat Greek yoghurt", "100g frozen blackberries", "~120ml unsweetened almond milk (a splash to blend)", "3–4 ice cubes"],
    instructions: ["Blend the pumpkin seeds, chia seeds, and almond milk on high for 30–45 seconds first, so the seeds fully break down before anything else goes in.", "Add the cottage cheese, Greek yoghurt, egg whites, frozen blackberries, and ice, then blend again until smooth and aerated.", "Taste and adjust — add a touch more almond milk if it's too thick, or a few extra blackberries for more tartness."],
    macros: [["430", "kcal"], ["35.7g", "Protein"], ["24.9g", "Carbs (11.2g fiber)"], ["22.2g", "Fat"]]
  }
];
