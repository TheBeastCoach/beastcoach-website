// One-time split of the recipe data. Moves the full recipes (ingredients, method, notes, macros) out of the public
// recipes.js into api/_recipes-full.js, which is served only by api/recipes.js after a sign-in check.
// Run once from the repo root: node scripts/split-recipes.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'recipes.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src + ';this.RECIPES = RECIPES;', sandbox);
const full = JSON.parse(JSON.stringify(sandbox.RECIPES));
const out = '// Full recipes (gated). Ingredients, quantities, method and notes. Never copy this into a public file.\n' +
  '// Served only by api/recipes.js, after it checks the caller\'s Supabase sign-in. This module has no handler.\n' +
  'module.exports = ' + JSON.stringify(full, null, 2) + ';\n';
fs.writeFileSync(path.join(ROOT, 'api/_recipes-full.js'), out);
console.log('wrote api/_recipes-full.js with', full.length, 'recipes');
