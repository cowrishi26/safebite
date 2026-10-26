# ScanSafe Workspace Rules

## Architecture & Conventions
- **Food-safety logic** lives exclusively in `rules.js`. It must remain environment-agnostic so it works in both the browser (`window.Rules`) and Node tests (`module.exports`).
- **UI, camera scanning, and Open Food Facts lookups** live in `app.js`, `index.html`, and `style.css`.
- **Golden Rule**: Missing or non-English ingredient data must always resolve to `unknown`, never `safe`.
- **Backwards-Compatible Storage**: Keep `localStorage` keys prefixed with `safebite-` (`safebite-profile`, `safebite-history`) so existing user profiles and scan history are preserved.

## Testing Workflow
- Run `node tests/rules.test.js` before committing any changes to verify all allergen, trace, diet, and ingredient-highlighting checks pass.
