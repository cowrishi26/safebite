/* =====================================================================
   rules.js  —  ALL the food-safety logic lives in this one file.

   - Which allergens we check, and the ingredient words that reveal them
   - How each diet is decided (Yes / No / Unknown)
   - The overall "Safe for you" verdict

   To change what the app detects, edit the word lists below.
   Nothing in app.js needs to change.

   Golden rule: if the data is missing or unclear, the answer is
   "Unknown". We never guess "Safe".
   ===================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  // Build a regular expression that matches whole words/phrases only,
  // e.g. "egg" matches "egg" and "eggs" but NOT "eggplant".
  // Spaces in a phrase also match hyphens ("milk fat" = "milk-fat").
  // Longer phrases are tried first, so "gluten free oat" wins over "gluten free".
  function wordRegex(words) {
    const parts = [...words].sort((a, b) => b.length - a.length).map(w =>
      w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // escape special characters
       .replace(/ /g, '[\\s-]+'));                // space = space or hyphen
    return new RegExp('\\b(?:' + parts.join('|') + ')(?:e?s)?\\b', 'gi');
  }

  // Blank out every match of `re` with spaces of the same length,
  // so positions in the text stay the same (needed for highlighting).
  function mask(text, re) {
    return text.replace(re, m => ' '.repeat(m.length));
  }

  // Find which of `words` appear in `text`.
  // `notWords` are phrases removed first so they don't cause false alarms
  // (e.g. "cocoa butter" is not dairy, "coconut milk" is not milk).
  function findWords(text, words, notWords) {
    if (!text) return [];
    let t = text;
    if (notWords && notWords.length) t = mask(t, wordRegex(notWords));
    const hits = t.match(wordRegex(words)) || [];
    return [...new Set(hits.map(h => h.toLowerCase().replace(/[\s-]+/g, ' ')))];
  }

  // The ingredients text, preferring English.
  // Open Food Facts marks allergens like "_milk_"; the underscores would stop
  // whole-word matching, so they become spaces.
  function ingredientsText(p) {
    return (p.ingredients_text_en || p.ingredients_text || '').replace(/_/g, ' ').trim();
  }

  // Our word lists are English. Only trust "not found" when the text is English.
  function isEnglish(p) {
    return !!(p.ingredients_text_en || '').trim() || p.lang === 'en';
  }

  // Phrases like "May contain milk" or "Made in a facility that processes peanuts"
  // are warnings, not ingredients. We split them out so they count as "may contain".
  // "Packed in soybean oil" is NOT a warning: made/packed/etc. only count when
  // followed by a facility, factory, plant, line or (shared) equipment.
  const TRACE_PHRASE = /(may (?:also )?contain|contains? traces? of|traces? of|(?:made|manufactured|produced|processed|packed|packaged) (?:in|on) (?:a |the same |a shared )?(?:shared )?(?:facility|factory|plant|production line|line|equipment)|shares? (?:equipment|a facility))[^.;]*[.;]?/gi;
  function splitText(p) {
    const full = ingredientsText(p);
    const traces = (full.match(TRACE_PHRASE) || []).join(' ');
    return { ingredients: full.replace(TRACE_PHRASE, ' ').trim(), traces };
  }

  const has = (list, tag) => (list || []).includes(tag);
  const yes = reason => ({ status: 'yes', reason });
  const no = reason => ({ status: 'no', reason });
  const unknown = reason => ({ status: 'unknown', reason });
  const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);

  const NO_LIST = 'No ingredient list available';
  const NOT_ENGLISH = "Ingredients aren't in English, so we can't check them";

  // Join a list nicely: "milk, eggs and soy"
  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  // ---------------------------------------------------------------
  // ALLERGENS
  //   tags      = Open Food Facts "allergens_tags" values (checked first)
  //   traceTags = Open Food Facts "traces_tags" values ("may contain")
  //   words     = backup keywords searched in the ingredients text
  //   not       = phrases that look similar but are NOT this allergen
  // ---------------------------------------------------------------
  const ALLERGENS = [
    // ---- US top 9 ----
    { id: 'milk', name: 'milk', emoji: '🥛', tags: ['en:milk'],
      words: ['milk', 'butter', 'buttermilk', 'butterfat', 'cheese', 'cream', 'whey', 'casein', 'caseinate',
              'lactose', 'yogurt', 'yoghurt', 'ghee', 'curd', 'lactalbumin', 'lactoglobulin', 'lactoferrin',
              'milk fat', 'milkfat', 'milk powder', 'milk solids', 'dairy', 'lactic culture', 'lactic ferment',
              'kefir', 'paneer', 'quark', 'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'mascarpone'],
      // "lactic acid" is deliberately not listed: it is usually not from milk.
      not: ['cocoa butter', 'shea butter', 'peanut butter', 'nut butter', 'almond butter', 'cashew butter',
            'coconut milk', 'coconut cream', 'almond milk', 'oat milk', 'soy milk', 'soya milk', 'rice milk',
            'cashew milk', 'hemp milk', 'cream of tartar', 'milk thistle', 'dairy free', 'milk free',
            'lactose free'] },
    { id: 'eggs', name: 'eggs', emoji: '🥚', tags: ['en:eggs'],
      words: ['egg', 'yolk', 'albumen', 'albumin', 'ovalbumin', 'ovomucoid', 'ovomucin', 'ovotransferrin',
              'livetin', 'mayonnaise', 'meringue', 'lysozyme', 'eggnog', 'aioli'],
      not: ['egg free'] },
    { id: 'fish', name: 'fish', emoji: '🐟', tags: ['en:fish'],
      words: ['fish', 'anchovy', 'anchovies', 'tuna', 'salmon', 'cod', 'sardine', 'pollock', 'tilapia',
              'haddock', 'trout', 'mackerel', 'herring', 'fish sauce', 'fish oil', 'hake', 'halibut', 'catfish',
              'swordfish', 'snapper', 'bass', 'perch', 'pike', 'carp', 'sole', 'whitefish', 'bonito', 'surimi',
              'roe', 'caviar', 'dashi', 'katsuobushi', 'worcestershire'] },
    { id: 'shellfish', name: 'shellfish', emoji: '🦐', tags: ['en:crustaceans', 'en:molluscs'],
      words: ['shellfish', 'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'crawfish', 'krill', 'clam', 'oyster',
              'mussel', 'scallop', 'squid', 'octopus', 'calamari', 'langoustine', 'scampi', 'cuttlefish',
              'abalone', 'cockle', 'whelk', 'snail', 'escargot'] },
    { id: 'treenuts', name: 'tree nuts', emoji: '🌰', tags: ['en:nuts'],
      words: ['almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'filbert', 'pistachio', 'macadamia',
              'brazil nut', 'pine nut', 'chestnut', 'praline', 'marzipan', 'gianduja', 'frangipane', 'nougat',
              'tree nut', 'nut'],
      not: ['nut free', 'tree nut free'] },
    { id: 'peanuts', name: 'peanuts', emoji: '🥜', tags: ['en:peanuts'],
      words: ['peanut', 'groundnut', 'arachis', 'monkey nut'],
      not: ['peanut free'] },
    { id: 'wheat', name: 'wheat', emoji: '🌾', tags: [], traceTags: ['en:gluten'],
      words: ['wheat', 'semolina', 'durum', 'spelt', 'farina', 'couscous', 'bulgur', 'einkorn', 'kamut', 'seitan',
              'emmer', 'farro', 'freekeh', 'triticale', 'graham', 'panko', 'breadcrumb', 'bread crumb', 'orzo',
              'udon', 'matzo', 'matzah'],
      not: ['buckwheat', 'wheat free'] },
    { id: 'soy', name: 'soy', emoji: '🫘', tags: ['en:soybeans'],
      words: ['soy', 'soya', 'soybean', 'tofu', 'edamame', 'miso', 'tempeh', 'natto', 'shoyu', 'tamari', 'yuba'],
      not: ['soy free', 'soya free'] },
    { id: 'sesame', name: 'sesame', emoji: '⚪', tags: ['en:sesame-seeds'],
      words: ['sesame', 'tahini', 'gingelly', 'benne', 'halva', 'halvah', 'hummus', 'gomasio'],
      not: ['sesame free'] },
    // ---- extra allergens (EU list) ----
    { id: 'gluten', name: 'gluten', emoji: '🍞', tags: ['en:gluten'],
      words: ['gluten', 'wheat', 'barley', 'rye', 'malt', 'oat', 'triticale', 'semolina', 'durum', 'spelt',
              'farina', 'couscous', 'bulgur', 'seitan', 'einkorn', 'kamut', 'emmer', 'farro', 'freekeh', 'graham',
              'panko', 'breadcrumb', 'bread crumb', 'orzo', 'udon', 'matzo', 'matzah', "brewer's yeast"],
      not: ['gluten free oat', 'gluten free', 'buckwheat', 'wheat free'] },
    { id: 'mustard', name: 'mustard', emoji: '🟡', tags: ['en:mustard'],
      words: ['mustard'] },
    { id: 'celery', name: 'celery', emoji: '🥬', tags: ['en:celery'],
      words: ['celery', 'celeriac'] },
    { id: 'sulfites', name: 'sulfites', emoji: '🧪', tags: ['en:sulphur-dioxide-and-sulphites'],
      words: ['sulfite', 'sulphite', 'bisulfite', 'bisulphite', 'metabisulfite', 'metabisulphite',
              'sulfur dioxide', 'sulphur dioxide', 'e220', 'e221', 'e222', 'e223', 'e224', 'e226', 'e227', 'e228'] },
    { id: 'lupin', name: 'lupin', emoji: '🌼', tags: ['en:lupin'],
      words: ['lupin', 'lupine', 'lupini'] },
  ];

  // Check every allergen against a product.
  // Returns { milk: {status, reason, words}, eggs: {...}, ... }
  //   status: 'contains' | 'traces' (may contain) | 'clear' | 'unknown'
  function analyzeAllergens(p) {
    const split = splitText(p);
    const readable = !!split.ingredients && isEnglish(p);
    const tags = p.allergens_tags || [];
    const traces = p.traces_tags || [];
    const result = {};

    ALLERGENS.forEach(a => {
      const words = findWords(split.ingredients, a.words, a.not);
      const tagHit = a.tags.some(t => has(tags, t));
      const traceHit = (a.traceTags || a.tags).some(t => has(traces, t)) ||
                       findWords(split.traces, a.words, a.not).length > 0;

      if (tagHit || words.length) {
        result[a.id] = { status: 'contains', words,
          reason: words.length ? 'Ingredients list: ' + words.join(', ') : 'Listed as an allergen in the database' };
      } else if (traceHit) {
        result[a.id] = { status: 'traces', words, reason: '"May contain" warning on the package' };
      } else if (readable) {
        result[a.id] = { status: 'clear', words, reason: 'Not found in the ingredients' };
      } else {
        result[a.id] = { status: 'unknown', words, reason: split.ingredients ? NOT_ENGLISH : NO_LIST };
      }
    });
    return result;
  }

  // Where in the ingredients text each "contains" allergen word was found.
  // Uses the same exceptions as analyzeAllergens, so "cocoa butter" is never
  // returned for milk. Returns sorted, non-overlapping [start, end] ranges.
  function allergenMatches(p, al) {
    const full = ingredientsText(p);
    const base = mask(full, TRACE_PHRASE);
    const ranges = [];
    ALLERGENS.forEach(a => {
      if (!al[a.id] || al[a.id].status !== 'contains' || !al[a.id].words.length) return;
      const t = a.not && a.not.length ? mask(base, wordRegex(a.not)) : base;
      const re = wordRegex(a.words);
      let m;
      while ((m = re.exec(t))) ranges.push([m.index, m.index + m[0].length]);
    });
    ranges.sort((x, y) => x[0] - y[0]);
    const merged = [];
    ranges.forEach(r => {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    return merged;
  }

  // ---------------------------------------------------------------
  // DIET word lists (used when the database's own analysis is missing)
  // ---------------------------------------------------------------
  const MEAT = ['beef', 'pork', 'chicken', 'turkey', 'bacon', 'ham', 'lard', 'tallow', 'suet', 'veal',
                'lamb', 'mutton', 'duck', 'goose', 'venison', 'meat', 'pepperoni', 'salami', 'sausage',
                'prosciutto', 'chorizo', 'bone broth', 'beef broth', 'chicken broth', 'beef stock',
                'chicken stock', 'beef extract', 'chicken extract', 'animal fat', 'animal rennet',
                'rabbit', 'bison', 'boar', 'quail', 'pheasant', 'liver', 'tripe', 'offal', 'pancetta',
                'bresaola', 'mortadella', 'jerky', 'meatball', 'frankfurter', 'gammon', 'guanciale', 'lardon',
                'schmaltz', 'dripping'];
  // Not meat, but not vegetarian either (made from animals or insects)
  const NONVEG_OTHER = ['gelatin', 'gelatine', 'collagen', 'carmine', 'cochineal', 'e120', 'e441',
                        'isinglass', 'pepsin', 'e542'];
  // Vegetarian is fine with these, vegan is not
  const ANIMAL_OTHER = ['honey', 'beeswax', 'bee pollen', 'royal jelly', 'propolis', 'shellac', 'lanolin',
                        "confectioner's glaze", 'confectioners glaze', 'e901', 'e904', 'e913'];
  // Could be animal or plant based — makes vegetarian "Unknown"
  const MAYBE_ANIMAL = ['rennet', 'l cysteine', 'e920'];
  const MAYBE_ANIMAL_NOT = ['microbial rennet', 'vegetable rennet', 'vegetarian rennet'];
  const PORK = ['pork', 'bacon', 'ham', 'lard', 'pepperoni', 'prosciutto', 'chorizo', 'pancetta', 'gammon',
                'guanciale', 'lardon', 'mortadella'];
  const ALCOHOL = ['alcohol', 'wine', 'beer', 'rum', 'brandy', 'whiskey', 'whisky', 'vodka', 'liquor',
                   'liqueur', 'sake', 'mirin', 'bourbon', 'gin', 'cognac', 'sherry', 'ethanol', 'marsala',
                   'kirsch', 'tequila', 'cider', 'champagne'];
  const ALCOHOL_NOT = ['sugar alcohol', 'wine vinegar', 'alcohol free', 'non alcoholic', 'rum flavor',
                       'rum flavour', 'cider vinegar', 'sherry vinegar', 'champagne vinegar', 'root beer',
                       'ginger beer'];

  // Keto: max grams of carbohydrate per 100 g to count as keto-friendly. Change if you like.
  const KETO_MAX_CARBS = 5;

  const DIETS = [
    { id: 'vegetarian', name: 'vegetarian', label: 'Vegetarian', emoji: '🥕' },
    { id: 'vegan', name: 'vegan', label: 'Vegan', emoji: '🌱' },
    { id: 'pescatarian', name: 'pescatarian', label: 'Pescatarian', emoji: '🐠' },
    { id: 'glutenfree', name: 'gluten-free', label: 'Gluten-free', emoji: '🚫🍞' },
    { id: 'dairyfree', name: 'dairy-free', label: 'Dairy-free', emoji: '🚫🥛' },
    { id: 'nutfree', name: 'nut-free', label: 'Nut-free', emoji: '🚫🥜' },
    { id: 'halal', name: 'halal', label: 'Halal', emoji: '☪️' },
    { id: 'kosher', name: 'kosher', label: 'Kosher', emoji: '✡️' },
    { id: 'keto', name: 'keto/low-carb', label: 'Keto / low-carb', emoji: '🥑' },
  ];

  // Decide every diet. Needs the allergen results from analyzeAllergens().
  // Returns { vegan: {status:'yes'|'no'|'unknown', reason}, ... }
  function analyzeDiets(p, al) {
    const text = splitText(p).ingredients;          // ingredients without "may contain" sentences
    const readable = !!text && isEnglish(p);        // can we trust "not found" for keywords?
    const unreadable = text ? NOT_ENGLISH : NO_LIST;
    const an = p.ingredients_analysis_tags || [];   // e.g. en:vegan, en:non-vegetarian
    const labels = p.labels_tags || [];             // e.g. en:halal, en:gluten-free

    const meat = findWords(text, MEAT);
    const nonVegOther = findWords(text, NONVEG_OTHER);
    const animalOther = findWords(text, ANIMAL_OTHER);
    const maybeAnimal = findWords(text, MAYBE_ANIMAL, MAYBE_ANIMAL_NOT);
    const pork = findWords(text, PORK);
    const alcohol = findWords(text, ALCOHOL, ALCOHOL_NOT);
    const contains = id => al[id] && al[id].status === 'contains';
    const seafood = ['fish', 'shellfish'].filter(contains).map(id => NAME[id]);
    const out = {};

    // ---- Vegetarian: no meat, fish or gelatin ----
    if (meat.length || nonVegOther.length || seafood.length) {
      out.vegetarian = no('Contains ' + joinList([...meat, ...nonVegOther, ...seafood]));
    } else if (has(an, 'en:non-vegetarian')) {
      out.vegetarian = no('Database marks it non-vegetarian');
    } else if (has(labels, 'en:vegetarian') || has(labels, 'en:vegan')) {
      out.vegetarian = yes('Labeled vegetarian');
    } else if (has(an, 'en:vegetarian')) {
      out.vegetarian = yes('Database analysis: vegetarian');
    } else if (maybeAnimal.length || has(an, 'en:maybe-vegetarian')) {
      out.vegetarian = unknown('Some ingredients may be animal-based' + (maybeAnimal.length ? ' (' + maybeAnimal.join(', ') + ')' : ''));
    } else if (readable) {
      out.vegetarian = yes('No meat, fish or gelatin in the ingredients');
    } else {
      out.vegetarian = unknown(unreadable);
    }

    // ---- Vegan: no animal products at all (dairy, eggs, honey too) ----
    const dairyEgg = ['milk', 'eggs'].filter(contains).map(id => NAME[id]);
    if (out.vegetarian.status === 'no') {
      out.vegan = no(out.vegetarian.reason);
    } else if (dairyEgg.length || animalOther.length) {
      out.vegan = no('Contains ' + joinList([...dairyEgg, ...animalOther]));
    } else if (has(an, 'en:non-vegan')) {
      out.vegan = no('Database marks it non-vegan');
    } else if (has(labels, 'en:vegan')) {
      out.vegan = yes('Labeled vegan');
    } else if (has(an, 'en:vegan')) {
      out.vegan = yes('Database analysis: vegan');
    } else if (out.vegetarian.status === 'unknown') {
      out.vegan = unknown(out.vegetarian.reason);
    } else if (has(an, 'en:maybe-vegan')) {
      out.vegan = unknown('Some ingredients may be animal-based');
    } else if (readable) {
      out.vegan = yes('No animal products in the ingredients');
    } else {
      out.vegan = unknown(unreadable);
    }

    // ---- Pescatarian: no meat, but fish/seafood is OK ----
    if (meat.length || nonVegOther.length) {
      out.pescatarian = no('Contains ' + joinList([...meat, ...nonVegOther]));
    } else if (out.vegetarian.status === 'yes') {
      out.pescatarian = yes('Vegetarian, so pescatarian-friendly');
    } else if (seafood.length && readable) {
      out.pescatarian = yes('Has ' + joinList(seafood) + ' but no meat');
    } else {
      out.pescatarian = unknown(out.vegetarian.status === 'no' ? "Not vegetarian, and the source isn't clear" : out.vegetarian.reason);
    }

    // ---- "Free-from" diets built from allergen results ----
    function freeFrom(ids, labelTags, name) {
      const c = ids.filter(id => al[id].status === 'contains');
      if (c.length) return no('Contains ' + joinList(c.map(id => NAME[id])));
      const t = ids.filter(id => al[id].status === 'traces');
      if (t.length) return unknown('May contain ' + joinList(t.map(id => NAME[id])));
      if (labelTags.some(l => has(labels, l))) return yes('Labeled ' + name);
      if (ids.every(id => al[id].status === 'clear')) return yes('None in the ingredients');
      return unknown(al[ids.find(id => al[id].status !== 'clear')].reason);
    }
    out.glutenfree = freeFrom(['gluten', 'wheat'], ['en:gluten-free', 'en:no-gluten'], 'gluten-free');
    out.dairyfree = freeFrom(['milk'], ['en:no-milk', 'en:dairy-free', 'en:no-lactose-and-no-milk', 'en:vegan'], 'dairy-free');
    out.nutfree = freeFrom(['peanuts', 'treenuts'], ['en:nut-free', 'en:no-nuts', 'en:peanut-free'], 'nut-free');

    // ---- Halal: needs a halal label to be "Yes" ----
    if (pork.length || alcohol.length) {
      out.halal = no('Contains ' + joinList([...pork, ...alcohol]));
    } else if (has(labels, 'en:halal')) {
      out.halal = yes('Labeled halal');
    } else {
      out.halal = unknown(text ? 'Not labeled halal in the database' : NO_LIST);
    }

    // ---- Kosher: needs a kosher label to be "Yes" ----
    if (pork.length || contains('shellfish')) {
      out.kosher = no('Contains ' + joinList([...pork, ...(contains('shellfish') ? ['shellfish'] : [])]));
    } else if (meat.length && contains('milk')) {
      out.kosher = no('Mixes meat and dairy');
    } else if (has(labels, 'en:kosher')) {
      out.kosher = yes('Labeled kosher');
    } else {
      out.kosher = unknown(text ? 'Not labeled kosher in the database' : NO_LIST);
    }

    // ---- Keto / low-carb: from carbs per 100 g ----
    const carbs = p.nutriments ? p.nutriments.carbohydrates_100g : undefined;
    if (carbs === undefined || carbs === null || carbs === '' || isNaN(Number(carbs))) {
      out.keto = unknown('No carb information available');
    } else {
      const c = Math.round(Number(carbs) * 10) / 10;
      out.keto = c <= KETO_MAX_CARBS
        ? yes(c + ' g carbs per 100 g')
        : no(c + ' g carbs per 100 g (keto limit: ' + KETO_MAX_CARBS + ' g)');
    }

    return out;
  }

  // ---------------------------------------------------------------
  // The big "Safe for you" verdict, based on the user's profile.
  // profile = { allergies: ['milk', ...], diets: ['vegan', ...] }
  // level: 'safe' | 'unsafe' | 'caution' | 'unknown' | 'none' (no profile set)
  // ---------------------------------------------------------------
  function verdict(al, diets, profile) {
    const allergies = profile.allergies || [];
    const dietIds = profile.diets || [];
    if (!allergies.length && !dietIds.length) return { level: 'none', reasons: [] };

    const bad = [], caution = [], unsure = [];
    allergies.forEach(id => {
      const s = al[id];
      if (!s) return;
      if (s.status === 'contains') bad.push('Contains ' + NAME[id]);
      else if (s.status === 'traces') caution.push('May contain ' + NAME[id]);
      else if (s.status === 'unknown') unsure.push("Can't check for " + NAME[id] + ': ' + lowerFirst(s.reason));
    });
    dietIds.forEach(id => {
      const d = diets[id];
      if (!d) return;
      if (d.status === 'no') bad.push('Not ' + DIET_NAME[id] + ': ' + lowerFirst(d.reason));
      else if (d.status === 'unknown') unsure.push("Can't confirm " + DIET_NAME[id] + ': ' + lowerFirst(d.reason));
    });

    if (bad.length) return { level: 'unsafe', reasons: bad.concat(caution) };
    if (caution.length) return { level: 'caution', reasons: caution.concat(unsure) };
    if (unsure.length) return { level: 'unknown', reasons: unsure };
    return { level: 'safe', reasons: ['Nothing in this product conflicts with your profile'] };
  }

  // Quick name lookups
  const NAME = {};
  ALLERGENS.forEach(a => { NAME[a.id] = a.name; });
  const DIET_NAME = {};
  DIETS.forEach(d => { DIET_NAME[d.id] = d.name; });

  const Rules = { ALLERGENS, DIETS, analyzeAllergens, analyzeDiets, verdict, wordRegex, ingredientsText,
                  allergenMatches };
  if (typeof window !== 'undefined') window.Rules = Rules;      // browser
  if (typeof module !== 'undefined') module.exports = Rules;    // tests (Node)
})();
