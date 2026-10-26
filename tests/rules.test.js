/* =====================================================================
   rules.test.js - checks the food-safety logic in rules.js.
   Run with:  node tests/rules.test.js
   No libraries needed. Exits with code 1 if any test fails.
   ===================================================================== */
'use strict';

const R = require('../rules.js');

let failed = 0;

// Run rules.js on a product and return everything a test might check
function check(product, profile) {
  const al = R.analyzeAllergens(product);
  const diets = R.analyzeDiets(product, al);
  const v = R.verdict(al, diets, profile || {});
  return { al, diets, level: v.level, reasons: v.reasons };
}

function test(name, fn) {
  let problems;
  try { problems = fn().filter(Boolean); } catch (e) { problems = ['threw: ' + e.message]; }
  if (problems.length) {
    failed++;
    console.log('FAIL  ' + name);
    problems.forEach(p => console.log('        - ' + p));
  } else {
    console.log('PASS  ' + name);
  }
}

// Returns an error message, or null if actual === expected
function expect(label, actual, expected) {
  return actual === expected ? null : `${label}: expected "${expected}", got "${actual}"`;
}

// ---------------------------------------------------------------

test('Non-English ingredients are never "safe"', () => {
  const r = check({ ingredients_text: 'Sucre, lait écrémé en poudre, lécithine de soja.', lang: 'fr' },
                  { allergies: ['milk', 'soy'], diets: [] });
  return [
    r.level === 'safe' ? 'verdict should not be "safe"' : null,
    expect('milk', r.al.milk.status, 'unknown'),
    expect('soy', r.al.soy.status, 'unknown'),
    expect('vegetarian', r.diets.vegetarian.status, 'unknown'),
  ];
});

test('"Dairy solids" counts as milk', () => {
  const r = check({ ingredients_text: 'Sugar, dairy solids, cocoa', lang: 'en' },
                  { allergies: ['milk'], diets: [] });
  return [expect('milk', r.al.milk.status, 'contains'), expect('verdict', r.level, 'unsafe')];
});

test('"Packed in soybean oil" is an ingredient, not a warning', () => {
  const r = check({ ingredients_text: 'Sardines packed in soybean oil, salt.', lang: 'en' },
                  { allergies: ['soy'], diets: [] });
  return [expect('soy', r.al.soy.status, 'contains'), expect('verdict', r.level, 'unsafe')];
});

test('Warning-only text is not an ingredient list', () => {
  const r = check({ ingredients_text_en: 'May contain milk.' });
  const others = R.ALLERGENS.filter(a => a.id !== 'milk' && r.al[a.id].status !== 'unknown');
  return [
    expect('milk', r.al.milk.status, 'traces'),
    others.length ? 'should be unknown: ' + others.map(a => `${a.id}=${r.al[a.id].status}`).join(', ') : null,
    expect('vegetarian', r.diets.vegetarian.status, 'unknown'),
    expect('vegan', r.diets.vegan.status, 'unknown'),
  ];
});

test('Nutella-style text: milk, hazelnuts and soy', () => {
  const r = check({ ingredients_text_en: 'Sugar, palm oil, hazelnuts 13%, skimmed milk powder 8.7%, ' +
    'fat-reduced cocoa 7.4%, emulsifier: lecithins (soya), vanillin.' });
  return [
    expect('milk', r.al.milk.status, 'contains'),
    expect('treenuts', r.al.treenuts.status, 'contains'),
    expect('soy', r.al.soy.status, 'contains'),
    expect('peanuts', r.al.peanuts.status, 'clear'),
  ];
});

test('Cocoa butter is not milk', () => {
  const r = check({ ingredients_text_en: 'Cocoa mass, sugar, cocoa butter' });
  return [expect('milk', r.al.milk.status, 'clear'), expect('vegan', r.diets.vegan.status, 'yes')];
});

test('Gelatin gummies are not vegetarian', () => {
  const r = check({ ingredients_text_en: 'Glucose syrup, sugar, gelatine, dextrose, citric acid, flavourings.' },
                  { allergies: [], diets: ['vegetarian'] });
  return [
    expect('vegetarian', r.diets.vegetarian.status, 'no'),
    expect('vegan', r.diets.vegan.status, 'no'),
    expect('verdict', r.level, 'unsafe'),
  ];
});

test('"Made in a facility that processes peanuts" is a may-contain warning', () => {
  const r = check({ ingredients_text_en: 'Sugar, cocoa butter. Made in a facility that processes peanuts.' },
                  { allergies: ['peanuts'], diets: [] });
  return [expect('peanuts', r.al.peanuts.status, 'traces'), expect('verdict', r.level, 'caution')];
});

test('Highlighting skips "cocoa butter" but marks real milk', () => {
  const p = { ingredients_text_en: 'Sugar, cocoa butter, whole milk powder' };
  const r = check(p);
  const marked = R.allergenMatches(p, r.al).map(([a, b]) => p.ingredients_text_en.slice(a, b).toLowerCase());
  return [
    marked.includes('butter') ? 'should not highlight "butter" in "cocoa butter"' : null,
    marked.includes('milk') || marked.includes('milk powder') ? null : 'should highlight milk, got: ' + marked.join(', '),
  ];
});

test('Allergens marked with underscores ("_milk_") are found', () => {
  const r = check({ ingredients_text_en: 'Sugar, _hazelnuts_ 13%, skimmed _milk_ powder, lecithins (_soya_)' });
  return [
    expect('milk', r.al.milk.status, 'contains'),
    expect('treenuts', r.al.treenuts.status, 'contains'),
    expect('soy', r.al.soy.status, 'contains'),
  ];
});

test('"Lactic acid" is not dairy', () => {
  const r = check({ ingredients_text_en: 'Water, vegetables, lactic acid, salt' });
  return [expect('milk', r.al.milk.status, 'clear')];
});

// ---------------------------------------------------------------

console.log(failed ? `\n${failed} test(s) failed.` : '\nAll tests passed.');
process.exit(failed ? 1 : 0);
