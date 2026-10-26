# ScanSafe: food barcode scanner

Scan a packaged food's barcode and see its allergens, "may contain" warnings,
diet compatibility, and a big **Safe / Not safe for you** banner based on your profile.
Product data comes from the free Open Food Facts database (no API key needed).

## Files

```
scansafe/
├── index.html   The page: Scan, History, and Settings screens
├── style.css    Colors, fonts, and layout (change colors at the top)
├── rules.js     ALL allergen and diet logic and word lists (edit this to change detection)
├── app.js       Camera scanning, database lookup, drawing results, history, settings
├── tests/
│   └── rules.test.js  Checks the allergen and diet logic (run: node tests/rules.test.js)
└── README.md    This file
```

Your saved settings and history are stored under the old name (`safebite-...`)
on purpose, so they keep working after the rename.

## 1. Open it in Antigravity

1. Put all the files (and the `tests` folder) in one folder, e.g. `Documents\scansafe`.
2. In Antigravity: **File → Open Folder** → pick `scansafe`.

## 2. Try it on your computer

Ask the Antigravity agent: *"Start a local web server in this folder and open index.html."*
(Or in its terminal: `npx serve .` then open the link it prints.)

On a laptop, type a barcode number in the box instead of scanning. Test numbers:

| Barcode | Product | Expect |
|---|---|---|
| 3017620422003 | Nutella | Contains milk, tree nuts (hazelnut), soy |
| 5449000000996 | Coca-Cola | Vegan: Yes, no allergens |
| 737628064502 | Thai peanut noodle kit | Contains peanuts |

## 3. Put it online so your phone can use the camera

Phone cameras only work on **https** pages, so use free GitHub Pages:

1. Go to github.com → **+** (top right) → **New repository** → name `scansafe` → **Public** → **Create repository**.
2. Click **uploading an existing file**, drag in all the files and the `tests` folder, click **Commit changes**.
3. Go to **Settings → Pages**. Under Branch pick **main** and **/ (root)** → **Save**.
4. Wait 1–2 minutes, refresh. Your link appears: `https://YOUR-USERNAME.github.io/scansafe/`

## 4. Test on your phone

1. Open the link in Chrome (Android) or Safari (iPhone).
2. **Settings** tab → pick allergies and diets.
3. **Scan** tab → **Scan a barcode** → allow the camera → hold the barcode inside the box.
4. Tip: Share → **Add to Home Screen** makes it look like a real app.

After changing code: upload the changed file to GitHub again, wait a minute, refresh the phone.

## How the checks work (for your write-up)

1. **Allergens:** first the database's allergen tags, then a whole-word keyword scan of
   the ingredients (with exceptions like "cocoa butter" and "coconut milk").
2. **May contain:** the database's trace tags plus sentences like "May contain…" or
   "Made in a facility that processes…", shown separately from real ingredients.
3. **Diets:** the database's ingredient analysis and labels first (vegan, vegetarian,
   halal, kosher, gluten-free), then keyword lists (gelatin, honey, lard, carmine…).
   Halal and kosher are only "Yes" with a label. Keto = 5 g carbs or less per 100 g.
4. **Never guesses safe:** missing data → **Unknown**, and the banner says
   "Can't confirm" instead of "Safe".

## Known limitations

- Some products (especially store brands) aren't in the database yet.
- Database info is community-entered and can be out of date.
- Keyword scanning can miss unusual ingredient names.

Always check the package label.
