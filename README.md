# RagdollLabs relocation decision tool

A static web app for comparing cities as places to live: what a household's income turns into after tax, what living there costs, and what is left over. It also matches cities to what matters to you (safety, climate, healthcare and so on), ranks them, and compares two or three side by side.

It is a personal planning tool. Estimates are not tax or immigration advice, and the app does not judge whether a salary is available locally or whether anyone may live or work there.

## Status

Version 0.5.1. See [RELEASE_PLAN.md](RELEASE_PLAN.md) for what comes next and [docs/reviews/](docs/reviews/) for review findings.

- Real 2026 employee tax and contribution rules for Finland, the US (federal, Texas, California), Estonia, Germany, Spain (Madrid, Valencia), Portugal and Mexico (Sonora).
- Households of one or two adults, married, registered partners or neither, with children by age band. Each model applies only the joint filing and child rules it supports, and says which in the pay detail.
- Budget engine with scenario ranges, double-count rules and affordability bands. A budget with a missing essential cost shows a partial balance, never estimated savings.
- Sourced cost data for the pilot cities: Helsinki, Berlin, Madrid, Austin and Hermosillo, including the Mexican tax model. Every cost row names its source and explains how it was estimated; a cost without a usable source is shown as missing and can be entered.
- Lifestyle presets (Budget, Moderate, Rich lifestyle) priced per city.
- Fit with what matters to you: set the importance of eight areas (safety, personal liberty, governance, healthcare, community, food and dining, climate, getting around) and see how well each pilot city matches, area by area, with sources. Missing data is shown as a range. It is a match to your preferences, not a quality-of-life rating.
- Find cities: the pilot cities ranked by fit or by money left over, with essentials applied first, left-out cities listed with reasons, and a one-click relax when nothing matches.
- Compare: two or three cities side by side for the same household, with the same income everywhere or a salary per city for job offers, and a share link that carries salaries only if you choose.
- Other cities remain **development previews** on placeholder costs, listed apart and clearly labelled.

## Run it

Needs Node 22.18 or later (TypeScript runs natively in Node; there is no bundler).

```sh
npm install
npm run check            # type-check, module boundaries, data validation, unit tests
npm run build:fixtures   # build dist/ including development fixtures
npm run serve            # http://localhost:4173/RagdollLabs-relocation-decision-tool/
npm run e2e              # end-to-end tests (needs: npx playwright install chromium)
```

## How it is built

- No runtime dependencies. TypeScript compiled by `tsc` to native ES modules; plain DOM rendering.
- `src/core` — pure calculations (money, tax, budget). No browser APIs; enforced by `npm run boundaries`.
- `src/data` — data validators and release indexing.
- `src/state` — profile, routing and local persistence.
- `src/ui` — screens.
- `data/` — production datasets and tax parameters, each value with source, period and confidence.
- `fixtures/` — development-only data. Every file is marked `"fixture": true`; validation fails if fixtures appear in `data/`.

Hash routing (`#/explore/fi-tampere`) keeps deep links working on GitHub Pages.

## Deploying

The workflow in `.github/workflows/ci.yml` tests every push and deploys `main` to GitHub Pages. Pages must be switched on once: repository **Settings → Pages → Source: GitHub Actions**.

## Data

See [docs/data-update.md](docs/data-update.md) for how data is added and refreshed.
