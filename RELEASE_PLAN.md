# Release plan

Feature releases and maintenance releases alternate. Every feature release is followed by one maintenance release that reviews the code and the UX of what just shipped. The next feature release starts only after that maintenance release is validated.

Baseline: **v0.1.0**, milestone 1 (foundations and money core), shipped 2026-10-19.

## How a release is run

When the owner says "move on to the next release":

1. Take the first release below whose status is **Not started**. Never skip one.
2. Set its status to **In progress** in this file.
3. Build everything in its scope. Anything that turns out not to fit is moved to a later release or to the backlog, with a one-line reason, rather than dropped silently.
4. Check: `npm run check`, `npm run build:fixtures` (or `npm run build` once fixtures are retired), `npm run e2e`, and screenshots of every changed screen on desktop, at 390 px and in dark mode.
5. Commit to `main` with the release number in the message, push, and confirm the GitHub Actions run passes and deploys.
6. Set the status to **Completed**, with the date and commit hash, and bump `version` in `package.json` to match.

Work goes straight to `main`. The site is not shared until the owner decides, so there are no pull requests or branches unless asked for.

## What a maintenance release is

A maintenance release adds no new features. It reviews the previous feature release, fixes what the review finds, and writes the findings to `docs/reviews/<version>.md`.

**Code review**

- Every new calculation has unit tests, including edge cases (zero income, missing data, two earners).
- `npm run boundaries` passes, and no core module reads browser globals.
- No dead code, unused exports, or commented-out blocks.
- Data: validation passes, no overdue sources, every new value has source, period and confidence, and no fixture values have leaked into `data/`.
- Tax parameters: each changed value links to its source and is covered by a test.
- CI: no failing or new warning annotations; GitHub Actions versions are current.
- Size: `data/release.json` and the compiled JS stay within budget (500 kB and 150 kB uncompressed).

**UX review**

- Screenshots of every screen: desktop, 390 px, dark mode.
- Full keyboard pass: every control reachable, visible focus, no traps.
- Copy pass: plain language, sentence case, no jargon, every balance and band defined.
- States: empty, incomplete data, low confidence, error, and no-match (once Find exists).
- Contrast checked on new colours in both themes; nothing relies on colour alone.
- Narrow-width check: no horizontal scrolling, tap targets at least 40 px.

**Validated when** every finding is fixed or explicitly deferred to the backlog with a reason, CI is green, and the review file is committed.

## Roadmap

| Version | Type | Theme | Status |
| --- | --- | --- | --- |
| 0.1.0 | Feature | Foundations and money core | Completed 2026-10-19 (5eaf615) |
| 0.1.1 | Maintenance | Review of 0.1.0 | Not started |
| 0.2.0 | Feature | Tax models: Estonia, Germany, Spain, Portugal | Not started |
| 0.2.1 | Maintenance | Review of 0.2.0 | Not started |
| 0.3.0 | Feature | Tax models: Canada (Ontario), Mexico | Not started |
| 0.3.1 | Maintenance | Review of 0.3.0 | Not started |
| 0.4.0 | Feature | Real cost data: European cities | Not started |
| 0.4.1 | Maintenance | Review of 0.4.0 | Not started |
| 0.5.0 | Feature | Real cost data: North American cities; fixtures retired | Not started |
| 0.5.1 | Maintenance | Review of 0.5.0 | Not started |
| 0.6.0 | Feature | Explore complete, household panel and methodology | Not started |
| 0.6.1 | Maintenance | Review of 0.6.0 | Not started |
| 0.7.0 | Feature | Preference data and fit in Explore | Not started |
| 0.7.1 | Maintenance | Review of 0.7.0 | Not started |
| 0.8.0 | Feature | Find cities | Not started |
| 0.8.1 | Maintenance | Review of 0.8.0 | Not started |
| 0.9.0 | Feature | Compare cities | Not started |
| 0.9.1 | Maintenance | Review of 0.9.0 | Not started |
| 1.0.0 | Feature | Accessibility, polish and first shareable release | Not started |
| 1.0.1 | Maintenance | Review of 1.0.0 | Not started |

## Releases

### 0.1.0 — Foundations and money core

**Status:** Completed 2026-10-19 (5eaf615)

Static TypeScript app with no runtime dependencies; Finland and US (federal, Texas, California) 2026 tax models; budget engine with scenario ranges and affordability bands; data validation; Explore screen on labelled development fixtures; CI that tests and deploys to GitHub Pages.

### 0.1.1 — Maintenance: review of 0.1.0

**Status:** Not started

Standard code and UX review, plus these known items:

- Confirm Tampere's 2026 municipal tax rate (7.60%) against Verohallinto's official list.
- Update GitHub Actions to versions that run on Node 24 (CI warns that Node 20 actions are deprecated), and pin the runner image ahead of the ubuntu-latest move to Ubuntu 26.
- Add a `package-lock.json` generated in CI, so installs are reproducible.
- On phones the household panel fills the first screen; start it collapsed after the first visit and show a one-line summary instead.
- California exemption-credit phase-out for head-of-household filers is not modelled; find the threshold or record why it is deferred.

### 0.2.0 — Tax models: Estonia, Germany, Spain, Portugal

**Status:** Not started

- Gross-to-net for Estonia (confirm the 2026 rate with the Estonian Tax and Customs Board), Germany (with income splitting for married couples, solidarity surcharge, statutory social insurance, optional church tax), Spain (state plus Madrid and Valencia regional scales, social security), and Portugal (IRS scale, social security).
- Each model: parameters in `data/tax/<country>/2026.json` with source links, and tests against published examples or official calculators at five income levels, single and two earners.
- Employer contributions shown separately for each.

**Done when** every model matches its reference cases within €1 a month and the four countries appear in the release with development-fixture costs.

### 0.3.0 — Tax models: Canada (Ontario), Mexico

**Status:** Not started

- Canada: federal and Ontario income tax, CPP and EI employee contributions, Ontario health premium.
- Mexico: ISR on employment income, IMSS employee contributions; one model for Mexico City, Sonora and Yucatán, with state payroll taxes shown as employer costs.
- FX snapshot refreshed and dated.

**Done when** both models match reference cases within the equivalent of €1 a month, and all eight countries compute take-home.

### 0.4.0 — Real cost data: European cities

**Status:** Not started

- Production data for Helsinki, Tampere, Tallinn, Berlin, Madrid, Valencia, Lisbon and Porto: rent by bedroom count (and central/outer where the source separates them), utilities, internet, groceries, transit, car, healthcare out of pocket, childcare, service price level.
- Import scripts for each source (Statistics Finland, SERPAVI and INE Spain, INE Portugal, Zensus 2022, Eurostat, OECD), not hand-typed values.
- Tallinn rent marked low confidence, with a prompt to confirm or enter rent.
- Development fixtures removed for these cities.

**Done when** each of the eight cities has every essential category sourced or marked low confidence, validation passes, and the Sources page lists every new source with its licence.

### 0.5.0 — Real cost data: North American cities; fixtures retired

**Status:** Not started

- Production data for Toronto, Austin, Sacramento, Mexico City, Hermosillo and Mérida (CMHC, HUD Fair Market Rents, BEA price parities, INEGI and others).
- Mexican rents marked low confidence, with the same confirm-or-enter prompt.
- Deploy builds without fixtures; the fixture banner and the `--with-fixtures` CI step are removed.

**Done when** all 14 cities run on production data and no fixture reaches the deployed site.

### 0.6.0 — Explore complete, household panel and methodology

**Status:** Not started

- Data notes on every result: inherited values, low confidence, uprated figures.
- Household panel: phone summary bar that opens the full form; monthly income mode reviewed.
- Methodology page: per-country tax model notes and simplifications; full source list.
- City picker grouped by country with search.

**Done when** the Explore journey works end to end for all 14 cities on desktop and phone, and every number on the page can be traced to its source in two clicks or fewer.

### 0.7.0 — Preference data and fit in Explore

**Status:** Not started

- Indicator data for the eight dimensions (safety, personal liberty, governance, healthcare, community, food and dining, climate, everyday convenience), with national values labelled as national.
- Matching core: normalisation against fixed reference bounds, weights, desired attributes, fit bands, explanations.
- Explore shows fit per dimension, strongest matches and compromises.

**Done when** matching unit tests cover missing data, all-zero weights and ties, and Explore shows fit for all 14 cities.

### 0.8.0 — Find cities

**Status:** Not started

- Preference cards with five-step importance sliders and desired-attribute controls.
- Must-haves applied before ranking; excluded cities listed with reasons.
- Results with fit band, affordability band, strongest matches and compromises; sort by fit or by money left over.

**Done when** the Find journey passes its end-to-end test, including a no-match state with a one-click relax.

### 0.9.0 — Compare cities

**Status:** Not started

- Up to three cities side by side; add, replace and remove on desktop and phone.
- Same income everywhere, or a different gross income per city for job offers.
- City-specific overrides marked and resettable; shareable URL that leaves out income unless the user opts in.

**Done when** the Compare journey passes its end-to-end test at desktop width and 390 px.

### 1.0.0 — Accessibility, polish and first shareable release

**Status:** Not started

- Automated accessibility checks on every screen; full keyboard journey as an end-to-end test.
- Copy and visual polish across all screens.
- Data release v1.0 with a changelog of sources and dates.

**Done when** all checks pass and the owner agrees the URL can be shared.

## Backlog (not scheduled)

- More cities and countries.
- Reverse-solve: gross salary needed to match another city's savings.
- Self-employment and special expatriate tax regimes.
- Live exchange rates.
