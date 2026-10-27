# Sphinx

Project conventions live in [AGENTS.md](AGENTS.md); read it first.

- Tests: `npm test` (node:test via `scripts/run-suite.mjs`). Run `npm ci` first; the suite needs the pinned Pi SDK packages.
- Landing site: `site/` is a static Next.js export (`cd site && npm ci && npx next build`, output in `site/out`). It is not part of the npm package.
- The local questionnaire UI is a single template in `src/browser-page.js`; model text must enter the DOM as `textContent`.
- Questionnaire copy lives in two catalogs, `src/i18n.js` (EN) and `src/i18n-ko.js` (KO). Edit both together: `test/i18n.test.js` fails when their keys or placeholders differ.
