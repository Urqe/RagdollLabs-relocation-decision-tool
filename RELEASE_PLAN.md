# Release plan

Feature releases and maintenance releases alternate. Every feature release is followed by one maintenance release that reviews the code and the UX of what just shipped. The next feature release starts only after that maintenance release is validated.

Baseline: **v0.1.0**, milestone 1 (foundations and money core), shipped 2026-10-19.

## Product objective

The app supports three connected journeys:

1. **Explore:** enter income and household, pick a city, and see the life that income supports there.
2. **Find:** enter income and preferences, and discover cities that combine affordability with personal fit.
3. **Compare:** weigh a shortlist side by side, including a different salary per city for different job offers.

Take-home pay and living costs serve these journeys; they are not the product on their own. The roadmap therefore runs the whole journey on a small pilot set of cities first, and expands coverage afterwards.

Correctness is not traded for speed:

- Wrong calculations or misleading behaviour are fixed promptly, and high-severity calculation errors block further model expansion.
- Deliberate simplifications are fine when documented, applied consistently and suitable for the supported household scenario.
- More precision and more places come after the whole journey works.
- Estimates before hard data (owner decision, 2026-10-21): where no official or primary source is at hand, a figure published elsewhere can be used as an **unverified estimate**. Two or more published claims that agree are used as their value or range; a single claim is used at low confidence and says it stands alone; with no published claim at all the value stays missing, never guessed. Every unverified estimate is labelled as such in the app, lists its sources, and is replaced or confirmed with hard data in the verification release before 1.0.0. `npm run estimates` lists them.

"Matches reference cases within €1 a month" checks that a calculation is implemented correctly. It does not claim that real-world take-home or savings are accurate to €1.

## How a release is run

When the owner says "move on to the next release":

1. Take the first release below that is not **Completed**. Never skip one. If it is already **In progress**, carry on from where it stopped.
2. Set its status to **In progress** in this file.
3. Build everything in its scope. Anything that turns out not to fit is moved to a later release or to the backlog, with a one-line reason, rather than dropped silently.
4. Check: `npm run check`, `npm run build:fixtures` (or `npm run build` once fixtures are retired), `npm run e2e`, and screenshots of every changed screen on desktop, at 390 px and in dark mode.
5. Commit to `main` with the release number in the message, push, and confirm the GitHub Actions run passes and deploys.
6. Set the status to **Completed**, with the date and commit hash, and bump `version` in `package.json` to match.

Work goes straight to `main`. The site is not shared until the owner decides, so there are no pull requests or branches unless asked for.

A **corrective release** (such as 0.2.2) fixes findings from a follow-up review. It adds no features, its findings live in `docs/reviews/<version>.md`, and it is validated like a maintenance release.

## What a maintenance release is

A maintenance release adds no new features. It reviews the previous feature release, fixes what the review finds, and writes the findings to `docs/reviews/<version>.md`. The review can be run first on its own; its findings then become the release's items.

A green test suite is necessary but not enough. The review looks at the new code, what its data actually means, which household scenarios it supports, how it interacts with earlier features, and whether the tests could pass while the result is wrong.

**Code review**

- Every new calculation has unit tests, including edge cases (zero income, missing data, two earners).
- `npm run boundaries` passes, and no core module reads browser globals.
- No dead code, unused exports, or commented-out blocks.
- Data: validation passes, no overdue source without a dated deferral, every new value has source, period and confidence, and no fixture values have leaked into `data/`.
- Tax parameters: each changed value links to its source and is covered by a test.
- CI: no failing or new warning annotations; GitHub Actions versions are current.
- Size: report the compiled JS and `data/release.json` sizes in the review. There is no fixed budget since 2026-10-20 (the 150 kB and 500 kB limits applied to the first version); the owner says if the app feels slower.

**Household and tax review**

- Supported scenarios tested: single adult, two earners, one earner with a non-earning partner, single parent, and couples with children, married and unmarried.
- Equivalent ways of entering the same household give the same result (for example a partner entered with €0 income or as a non-earning adult; income entries in a different order).
- Hidden or disabled controls cannot affect results.
- At least one reference case per model comes from outside the model's own parameters: an official calculator, a published worked example or an official table. Each records its inputs, tax year, source and expected result.
- Annual assessment and monthly withholding are not mixed up; exclusions and employment assumptions are written down.

**Data review**

- Every value matches the household and market it is used for: what kind of rent (existing leases, new leases or listings), which percentile or average, which area, which room definition, and which charges are included.
- Inherited values (national figures used for a city) are labelled as such.
- Derived values name their inputs and the transformation.
- Low confidence explains the limitation; it never stands in for evidence.

**UX review**

- Screenshots of every screen: desktop, 390 px, dark mode.
- Full keyboard pass: every control reachable, visible focus, no traps, focus kept sensibly after navigation and rerendering.
- Automated accessibility checks on changed screens.
- Copy pass: plain language, sentence case, no jargon, every balance and band defined.
- States: empty, incomplete data, low confidence, error, and no-match (once Find exists). Every suggested action in a message actually exists.
- Contrast checked on new colours in both themes; nothing relies on colour alone.
- Narrow-width check: no horizontal scrolling, tap targets at least 40 px.

**Validated when** every finding is fixed or explicitly deferred with a reason, CI is green, and the review file is committed.

## Roadmap

| Version | Type | Theme | Status |
| --- | --- | --- | --- |
| 0.1.0 | Feature | Foundations and money core | Completed 2026-10-19 (5eaf615) |
| 0.1.1 | Maintenance | Review of 0.1.0 | Completed 2026-10-19 (38d2867) |
| 0.2.0 | Feature | Tax models: Estonia, Germany, Spain, Portugal; Helsinki added | Completed 2026-10-19 (5b7593e) |
| 0.2.1 | Maintenance | Review of 0.2.0 | Completed 2026-10-19 (ed6a50a) |
| 0.2.2 | Corrective | Household correctness, reset and data validation | Completed 2026-10-19 (337bdbe) |
| 0.3.0 | Feature | Pilot Explore on real data: Helsinki, Berlin, Madrid, Austin, Hermosillo; Mexico tax model; lifestyle presets priced per city | Completed 2026-10-19 (40c7a70) |
| 0.3.1 | Maintenance | Review of 0.3.0; official calculator cross-checks for pilot countries | Completed 2026-10-19 (218bb47) |
| 0.4.0 | Feature | Preference data and explainable fit in Explore (pilot cities) | Completed 2026-10-19 (88729a4) |
| 0.4.1 | Maintenance | Review of 0.4.0 | Completed 2026-10-20 (5b92a0a) |
| 0.5.0 | Feature | Find cities and basic Compare (pilot cities) | Completed 2026-10-20 (9cd7760) |
| 0.5.1 | Maintenance | Review of the whole Explore → Find → Compare journey | Completed 2026-10-20 (59d9c25) |
| 0.6.0 | Feature | Expansion, Europe: Tampere, Tallinn, Valencia, Lisbon, Porto; Portuguese joint taxation; city picker | Completed 2026-10-21 (6a2e6b1) |
| 0.6.1 | Maintenance | Review of 0.6.0; cross-checks for Portugal and Estonia; first unverified estimates | Completed 2026-10-21 (a50729b) |
| 0.7.0 | Feature | Expansion, North America: Hermosillo rent and utilities, car costs everywhere, Mexico City, Mérida, La Paz, Canada tax model, Toronto, Sacramento; fixtures retired | Completed 2026-10-21 (4aed96d) |
| 0.7.1 | Maintenance | Review of 0.7.0; cross-check for Canada; cost realism for North America (metro prices, tips, car-dependent cities) | Not started |
| 0.8.0–0.9.x | Feature / maintenance | Chosen from use of the working product | Not planned |
| 0.9.x | Feature | Childcare data (lowest priority) | Not started |
| 0.9.x (last) | Verification | Unverified estimates replaced or confirmed with hard data | Not started |
| 1.0.0 | Feature | First shareable release | Not started |
| 1.0.1 | Maintenance | Review of 1.0.0 | Not started |

The previous plan put Canada and Mexico tax models in 0.3.0, real cost data in 0.4.0 and 0.5.0, Explore completion in 0.6.0, and preferences, Find and Compare in 0.7.0 to 0.9.0. That scope was reassigned on 2026-10-19 after the follow-up review in [docs/reviews/0.2.2.md](docs/reviews/0.2.2.md); nothing from it was dropped.

## Releases

### 0.1.0 — Foundations and money core

**Status:** Completed 2026-10-19 (5eaf615)

Static TypeScript app with no runtime dependencies; Finland and US (federal, Texas, California) 2026 tax models; budget engine with scenario ranges and affordability bands; data validation; Explore screen on labelled development fixtures; CI that tests and deploys to GitHub Pages.

### 0.1.1 — Maintenance: review of 0.1.0

**Status:** Completed 2026-10-19 (38d2867). All 19 findings and 4 carried-over items fixed; none deferred.

Findings and their status are tracked in [docs/reviews/0.1.1.md](docs/reviews/0.1.1.md). IDs below refer to that file.

**Wrong or misleading figures, unusable controls**

- R1 Desktop household form can be collapsed by keyboard and not reopened by mouse: make it a plain section on desktop.
- R2 Monthly income mode: changing payments per year must keep the typed monthly amount and recalculate the annual figure.
- R3 Discretionary presets: label them as per adult with children at 30%, or show the household total.

**Accessibility and confusing UX**

- R4 Empty or invalid income: mark the field invalid and replace stale results with a prompt.
- R5 Unknown city in a link: say the city isn't in this release instead of showing another city.
- R6 Control borders to at least 3:1 contrast in both themes.
- R7 Groceries ribbon label to at least 4.5:1 contrast.
- R8 Phones: household form collapsed after the first visit, with a one-line summary.
- R9 Tests for the Finnish Yle tax between the threshold and the cap.

**Tidy-up**

- R10 Ribbon summary read once, not twice, by screen readers.
- R11 Page title per city and screen.
- R12 Hide the household form on the "How it works" page.
- R13 Thousands separators for income amounts.
- R14 Plain wording for the household-size note on groceries.
- R15 Remove dead code (`sumDeductions`, `toEurRange`, `uid`).
- R16 Store band messages without the band name instead of stripping it.
- R17 Version the data release separately from the exchange-rate date.
- R18 Boundary check to cover `export … from` and dynamic `import()`.

**Carried over from 0.1.0**

- C1 Confirm Tampere's 2026 municipal tax rate (7.60%) against Verohallinto's official list.
- C2 GitHub Actions on Node 24 versions; pin the runner image ahead of the move to Ubuntu 26.
- C3 `package-lock.json` generated in CI.
- C4 California head-of-household exemption-credit phase-out: model it or record why it is deferred.

**Validated when** every item above is fixed or deferred with a reason in the review file, CI is green, and screenshots of Explore and "How it works" on desktop, at 390 px and in dark mode show no remaining finding.

### 0.2.0 — Tax models: Estonia, Germany, Spain, Portugal; Helsinki added

**Status:** Completed 2026-10-19 (5b7593e)

**Notes for the 0.2.1 review**

- Official calculator cases were not reachable for Germany, Spain or Portugal. Tests use published anchors (Estonian €2,000 example, German tariff at €50,000, Portuguese "parcela a abater" column) plus cases worked by hand from the parameter files. Cross-check at least one case per country against the official calculators (BMF, AEAT, Portal das Finanças) from a machine that can reach them.
- Spanish regional scales and minimums come from secondary sources; confirm against the BOCM and DOGV. The 2026 low-income work reduction is not yet published; the 2025 rule is used.
- Portugal assumes the €250 general family expenses deduction is reached.
- Germany models the annual assessment, not monthly withholding.

- Helsinki added to the city picker, as the home baseline. Its 2026 tax rate is already in the Finnish model; costs use development fixtures until 0.4.0, like the other cities.
- Gross-to-net for Estonia (confirm the 2026 rate with the Estonian Tax and Customs Board), Germany (with income splitting for married couples, solidarity surcharge, statutory social insurance, optional church tax), Spain (state plus Madrid and Valencia regional scales, social security), and Portugal (IRS scale, social security).
- Each model: parameters in `data/tax/<country>/2026.json` with source links, and tests against published examples or official calculators at five income levels, single and two earners.
- Employer contributions shown separately for each.

**Done when** every model matches its reference cases within €1 a month, and Helsinki and the four countries appear in the release with development-fixture costs.

### 0.2.1 — Maintenance: review of 0.2.0

**Status:** Completed 2026-10-19 (ed6a50a). Seven findings fixed, two deferred to the backlog.

Findings are tracked in [docs/reviews/0.2.1.md](docs/reviews/0.2.1.md). S2 (Spanish child allowance) was later reopened as F2 in [docs/reviews/0.2.2.md](docs/reviews/0.2.2.md): the fix allocates the allowance by number of income entries rather than by household and filing arrangement. The German tariff-table checks (S4) confirm the tariff on taxable income, not the whole gross-to-net calculation.

### 0.2.2 — Corrective: household correctness, reset and data validation

**Status:** Completed 2026-10-19 (337bdbe). F1–F5, F7, F9–F11 fixed; F6 and F8 fixed in their 0.2.2 parts with the rest in 0.3.0 as planned. Two findings added during the release (F12 Portugal child deduction, F13 Sources table width) and fixed. Portuguese joint taxation moved to 0.6.0.

Findings, reproductions and acceptance are in [docs/reviews/0.2.2.md](docs/reviews/0.2.2.md). IDs below refer to that file. No tax or cost coverage is added until this release is validated.

**Wrong or misleading figures**

- F1 One household normalizer: valid combinations defined once, applied after every household edit and on profile restore; hidden controls cannot affect results.
- F2 Spain: separate household members, income recipients and filing arrangement. Individual filing for everyone; joint filing only for married couples, implemented in full and used when lower. If joint filing does not fit, individual filing only, labelled.
- F3 US: relationship type (married, registered partnership, unmarried) replaces the married checkbox; head of household only with a confirmation question; entry order never decides eligibility. Check Texas and California follow federal status.
- F4 Children by age band (under 14, 14–16, 17 and over), used consistently by cost scaling and tax credits.

**Misleading states and controls**

- F5 "Clear my data" resets the whole scenario, including every city's overrides.
- F6 Incomplete budgets show a partial balance naming the missing categories, stay out of definitive affordability bands, and suggest only actions that exist. Inputs for missing categories follow in 0.3.0.
- F7 Daycare count and limits follow the number of children; review the live-update approach for the same pattern.

**Data contract and robustness**

- F8 Per-country tax parameter schemas; overdue sources fail CI unless the source has a dated deferral; source-review date kept separate from observation period and FX date. Cost-data checks follow in 0.3.0.
- F9 Malformed link encoding shows the invalid-link state.
- F10 Every restored profile field validated and normalized; safe fallback on malformed or old-schema data.
- F11 README status updated to list all current tax models.

**Validated when** every finding above is fixed or explicitly deferred with a reason in the review file, the equivalent-household tests from the household and tax review pass for all six existing models, and CI is green.

### 0.3.0 — Pilot Explore on real data

**Status:** Completed 2026-10-19 (40c7a70)

**Notes for the 0.3.1 review**

- Gaps shown as missing, with an input to enter your own figure: Hermosillo rent, utilities and childcare (no usable free source found); car costs everywhere except Austin.
- Read from sites that republish official tables, because the official endpoints were unreachable from the build environment: Statistics Finland 15fa (vuokra-arvio.fi), HUD Fair Market Rents (propmetrics.co), Child Care Aware Texas prices (FOX 7). Check each against the original.
- Only city-wide rents: no source gave a usable central/outer split. Rents per m² are converted with app floor-area assumptions; electricity use is an app assumption.
- Imports are curated inputs plus derivation scripts (`scripts/derive-costs.ts`, `scripts/derive-price-levels.ts`), not automatic downloads: the build shell cannot reach the statistics sites. Validation fails if a city file drifts from its inputs.
- Lifestyle presets are priced from average spending in Finland, the home baseline, rather than a euro-area average: ICP 2021 has no EU aggregate. Budget and Rich lifestyle are half and double (app assumptions).
- Groceries and phone and internet use the same price-level method; phone and internet replaces the internet line and includes devices and mobile.
- Helsinki childcare uses the highest fee; the fee is income-dependent and could be modelled.
- WebKit (desktop and iPad) runs only in CI: its browser cannot be installed here. Accessibility checks are in-house (names, ids, headings, overflow, keyboard), not axe-core, which cannot be installed here.
- Mexico: reference cases are worked by hand from the published tariff; the SAT calculator cross-check is part of 0.3.1.

The pilot set shows real differences in tax system, living costs, climate and everyday life: **Helsinki, Berlin, Madrid, Austin and Hermosillo**. Mexico is a location of high personal interest, so the Mexican tax model is part of the pilot.

**Mexico tax model**

- ISR on employment income, the employment subsidy where it applies, and IMSS employee contributions, for 2026.
- Gross-income and contribution-base assumptions written down before implementation: aguinaldo and vacation premium, exempt portions, the UMA-based caps on the IMSS base.
- Sonora's state payroll tax shown as an employer cost. The model is national, so Mexico City and La Paz (Baja California Sur) only need their state payroll tax rates when they are added.
- Independent reference cases, including at least one from the SAT calculator or a published SAT example.

**Real cost data for the five pilot cities**

- Rent, utilities, internet, groceries, transit, car, healthcare out of pocket, childcare and service price level, from documented sources (Statistics Finland, Zensus 2022, SERPAVI and INE Spain, HUD Fair Market Rents, BEA regional price parities, INEGI and others).
- Each rent series records: existing leases, new leases or listings; observation period and retrieval date; geography; mean, median or percentile; bedroom or room definition; furnished or not; included charges; any adjustment to the target period. Zensus 2022 (existing tenancies) and HUD Fair Market Rents (40th-percentile gross rent) are labelled for what they measure, not presented as what a newcomer will pay.
- Bedrooms and total rooms kept apart; no central/outer split unless the source has one; a city-wide fallback only when metadata says the value is city-wide; included utilities handled consistently.
- Healthcare and childcare use a clearly described representative scenario where full modelling is out of scope, labelled as such.
- Hermosillo rent marked low confidence, with a prompt to confirm or enter rent.
- Imports repeatable where a source allows; documented curated inputs where it does not; reviewed diffs, source and licence records, and a dated data release with a changelog. No brittle scraping to avoid a documented manual step.
- FX snapshot refreshed and dated, including MXN.

**Lifestyle presets priced per city**

- Discretionary presets renamed **Budget**, **Moderate** and **Rich lifestyle**, each with a one-line description in the form.
- Each preset is a defined basket, not a euro amount: for example meals out and coffees a month, a gym membership, clothing, streaming and leisure, and one or more trips a year. The basket is written down once in `data/` with quantities per adult equivalent.
- Each item is priced from local data for each pilot city, so the same lifestyle costs what it costs there. The breakdown shows the basket items and their source.
- Free sources rarely price these items at city level. Use the most local free source for each item: Eurostat category price levels for European countries, BEA regional price parities for US metro areas, INEGI prices for Mexico. Where only a national value exists, label it as inherited. Where an item has no source, mark it as missing and do not fall back to a flat amount silently.
- The current method (a flat amount scaled by a service price index) remains only as a labelled fallback for cities without basket prices.
- "My own amount" stays.

**Explore and methodology**

- Inputs for missing essential categories (childcare, healthcare, transport) and a way to describe included charges when overriding rent (F6).
- Cost-data validation: category units and currencies, and links between cities, regions, countries, tax models and FX rates (F8).
- Data notes on every result: inherited values, low confidence, uprated figures. Methodology notes per tax model and per source ship with the numbers.
- Non-pilot cities appear only under a separate "development preview" heading, and fixture budgets never enter rankings or comparisons.
- WebKit added to the end-to-end suite for the Explore journey, plus an iPad-width layout check.

**Done when** each pilot city has, for every essential category, a usable sourced value, a documented derivation or an explicit missing state; missing costs prevent definitive affordability claims; the Mexico model matches its reference cases within the equivalent of €1 a month; each lifestyle preset is priced item by item for every pilot city, with any missing or inherited item labelled; and every number on the Explore page traces to its source in two clicks or fewer.

### 0.3.1 — Maintenance: review of 0.3.0

**Status:** Completed 2026-10-19 (218bb47). Four findings fixed (T1–T4); T5, T6 and T8 deferred to the owner because they need a browser; T7 (Hermosillo gaps) deferred to 0.6.0. Findings in [docs/reviews/0.3.1.md](docs/reviews/0.3.1.md).

Standard maintenance review, plus the official calculator cross-check moved from the backlog (S7 in review 0.2.1): at least one case per pilot country (Finland, Germany, Spain, US, Mexico) against Verohallinto, BMF, AEAT, IRS and SAT tools or published examples, recorded as reference cases with inputs, tax year and date checked. If the build environment cannot reach a calculator, the owner runs the cases and they are committed as test data.

### 0.4.0 — Preference data and explainable fit in Explore

**Status:** Completed 2026-10-19 (88729a4). Eight dimensions, 13 indicators from 13 new sources; fit, per-area scores, best matches, compromises, missing data, sensitive areas and national figures shown in Explore for all five pilot cities. Gaps moved to the backlog: residents born abroad for Hermosillo, commuting by car for Austin and Hermosillo, and indicators for food variety and close local community.

Notes for the 0.4.1 review:

- Several measures are national (homicides, governance, healthcare, eating-out prices). Mexico's homicide rate in particular varies widely by state; check whether a Sonora or Hermosillo figure from INEGI can replace it.
- Berlin's "born abroad" is foreign citizens, not foreign-born, and is marked low confidence. Madrid's car share is from 2011.
- Bounds in `data/preferences.json` are editorial; review whether each band label reads fairly for the five cities (for example Helsinki's climate scores low for anyone who avoids dark winters, by design).
- "Essential" (importance 4) also acts as a must-have check in Explore; Find in 0.5.0 uses the same rule to exclude cities.
- Life expectancy and out-of-pocket share are proxies for healthcare quality and cost, and say so.

- Indicator data for the eight dimensions (safety, personal liberty, governance, healthcare, community, food and dining, climate, everyday convenience) for the pilot cities, each marked as a measured indicator or an editorial proxy; national values labelled as national.
- Desired attributes separate from importance, with compact controls first. For example climate: preferred temperature, seasons, tolerance for heat or darkness; community: local integration, international networks, street life; food: variety, particular cuisines, affordability; convenience: walking, public transport or car.
- Matching core: fixed, documented normalisation bounds; explicit handling of missing indicators; coverage shown beside fit; must-haves applied before weighted ranking; no double counting of strongly overlapping dimensions; deterministic ties; sensible result when all weights are zero.
- Explore shows fit per dimension, strongest matches, main compromises, important missing information, and the assumptions most likely to change the conclusion. The score is never presented as a universal quality-of-life ranking.

**Done when** unit tests show that removing an indicator cannot improve a city's fit, that changing an irrelevant criterion leaves the ranking alone, that ties and all-zero weights behave as documented, and that close results are shown as close; and Explore shows fit for all five pilot cities.

### 0.4.1 — Maintenance: review of 0.4.0

**Status:** Completed 2026-10-20 (5b92a0a). Fourteen findings fixed (V1–V14, V14 on the same day after the owner's check); V15 moved to the backlog.

Findings in [docs/reviews/0.4.1.md](docs/reviews/0.4.1.md). V1–V14 fixed; V15 (Berlin born abroad) moved to the backlog because its source could not be read in the build environment.

**Notes for 0.5.0**

- Find uses `mustHaveExclusions(fit, essential, def, prefs)`; an essential area with every choice at "No preference" excludes no city.
- Best matches now require every part of an area to score at least 45; weak parts are listed in `fit.weakSpots`.
- Compiled JavaScript is 135.5 kB. (The size budget was retired on 2026-10-20.)

### 0.5.0 — Find cities and basic Compare

**Status:** Completed 2026-10-20 (9cd7760). Find and Compare for the five pilot cities, end-to-end tested at desktop, tablet and 390 px in Chromium and, in CI, WebKit. Nothing moved out of scope.

**Notes for the 0.5.1 review**

- Find ranks with `rankCities` (`src/core/rank/rank.ts`). By fit: the low end of the range, then the high end, then the name. By money: estimated savings in euros at the ECB rate; incomplete budgets are listed after the ranking. "Too close to call" is under 5 fit points or under €50 a month (an app choice).
- The no-match relax turns every "Essential" into "Very" in one click. It does not suggest which essential to drop; check whether that reads well.
- The preference cards on Find and the selects in the household panel edit the same preferences; the panel copy is hidden on Find. Check whether two forms for one thing confuse.
- A salary set in Compare is a per-city override for the session, like the user's own figures: it applies in Explore and Find, is marked in both, and is lost on reload (overrides are not saved). Check whether losing it on reload surprises.
- A shared link carries salaries only when ticked (`?pay=`); opening it sets them for that visit, never in the saved household, and the address drops them. The household itself is never in the link.
- Savings across currencies are compared at the ECB rate, with no adjustment for prices; the costs are already local.
- Compiled JavaScript 171.3 kB (46.6 kB compressed); no budget since 2026-10-20.


**Find**

- Preference cards with five-step importance sliders and the desired-attribute controls from 0.4.0.
- Must-haves applied before ranking; excluded cities listed with reasons.
- Results with fit band, affordability band, strongest matches and compromises; sort by fit or by money left over. Incomplete budgets are never ranked as definitively affordable.

**Compare**

- Two or three cities side by side; add, replace and remove on desktop and phone.
- Same household by default; same income everywhere or a different gross income per city for job offers.
- City-specific overrides marked and resettable.
- Shareable URL that leaves out income unless the user opts in.

**Done when** the Find journey passes its end-to-end test, including a no-match state with a one-click relax, and the Compare journey passes its end-to-end test at desktop width and 390 px, in Chromium and WebKit. If Compare grows beyond this basic scope, it moves to its own release.

### 0.5.1 — Maintenance: review of the whole journey

**Status:** Completed 2026-10-20 (59d9c25). Eleven findings fixed (W1–W11), none deferred.

Findings in [docs/reviews/0.5.1.md](docs/reviews/0.5.1.md).

**Notes for 0.6.0**

- A city's own salary is used only when it has one income per earner (`salaryFits` in `src/core/budget/city-result.ts`); it never changes the household. `pruneSalaries` drops the ones that no longer fit when the number of earners changes.
- The essential bar and "too close to call" are judged on the figures shown (whole fit points, savings to the nearest €10).
- `relaxOptions` reruns the ranking once per essential; with 15 cities that is still cheap, but keep it out of any per-keystroke path.
- Compiled JavaScript 178.1 kB (48.6 kB compressed).

Standard maintenance review of 0.5.0, plus an end-to-end review of Explore → Find → Compare on the pilot cities: whether the journeys connect, whether results are understandable, and whether matching and affordability tell a consistent story.

### 0.6.0 — Expansion: Europe

**Status:** Completed 2026-10-21 (6a2e6b1). All five cities on production data; Tallinn utilities, Lisbon and Porto water and Valencia car commuting moved to the backlog (no usable free source found).

Split from the original 0.6.0 on 2026-10-21, as the plan allowed: ten cities of sourced data and a new tax model were too much for one release. North America is in 0.7.0.

- Real cost data and preference indicators for Tampere, Tallinn, Valencia, Lisbon and Porto, to the same acceptance as 0.3.0.
- Portugal: optional joint taxation for married and unmarried partners (deferred from 0.2.2, F12).
- City picker grouped by country with search.

**Done when** the ten European and pilot cities run on production data through Explore, Find and Compare, and none of the five is a development preview any longer.

**Notes for the 0.6.1 review**

- Climate normals for the five cities come from Wikipedia tables that cite FMI, the Estonian Weather Service, AEMET and IPMA; FMI's own page needed the owner's approval and could not be read. Check each against the original, as V14 did. Tallinn's table does not name its station.
- Read from republications because the original could not be fetched: idealista's Valencia figure came from its province page (the city page refused), SUMA fares from ValenciaMove and redtransporte.com (Metrovalencia blocks automated reading), Navegante prices from a news report.
- Tallinn: rent from KV.EE listings via Adaur (low confidence, no split by size); utilities are missing, so its budget is incomplete. Lisbon and Porto: utilities are electricity only, water and waste are not included and the row says so. Valencia has no car-commuting figure.
- Eurostat labels Valencia, Lisbon and Porto (and Madrid, ES001C) as "greater city": check whether Madrid's 0.4.0 basis ("of the city") is accurate.
- Portuguese joint taxation is checked against hand-worked cases only; the official calculator cross-check is part of 0.6.1. Unmarried partners count only when entered as registered partners (união de facto).
- Estonia's employer social-tax minimum base (€886) may be the 2025 minimum wage; it does not affect take-home.
- `npm run import:statfin` now covers Tampere, and the World Bank import keeps hand-kept notes such as `notComparable`. Each city's cost inputs keep their own retrieval date.
- Compiled JavaScript 186.4 kB (50.7 kB compressed); `release.json` 183.6 kB in the production build.

### 0.6.1 — Maintenance: review of 0.6.0

**Status:** Completed 2026-10-21 (a50729b). Six findings: Y1–Y4 and Y6 fixed; Y5 (climate normals against the originals) moved to the verification release. Findings in [docs/reviews/0.6.1.md](docs/reviews/0.6.1.md).

Standard maintenance review, including regression of the pilot cities, plus official calculator cross-checks for Portugal and Estonia. Also, as the first use of the estimate rule: unverified estimates for Tallinn's utilities, Lisbon and Porto water, and Valencia's car commuting, so these gaps close before 0.7.0.

### 0.7.0 — Expansion: North America

**Status:** Completed 2026-10-21 (4aed96d). All 15 cities on production data; Estonia's car cost and the new cities' childcare stay missing (no published figure; childcare moved to the childcare release by the owner).

Priorities set by the owner on 2026-10-21: every city first becomes usable for adults without children, with unverified estimates where no hard data is at hand; precision and childcare come later.

1. Hermosillo rent and utilities, as unverified estimates where needed (from review 0.3.1, T7).
2. Car costs for every country: the monthly cost of owning a new, non-luxury five-seat sedan or hatchback, from national estimates. Each is split into owning (depreciation and loan interest) and running (fuel, insurance, maintenance, tax and inspection); the budget counts the full cost and notes what remains once the car is paid off.
3. Mexico City, Mérida and La Paz (Baja California Sur): costs and preference indicators to the same acceptance as 0.3.0, with state payroll tax rates for Mexico City, Yucatán and Baja California Sur.
4. Canada (Ontario) tax model: federal and Ontario income tax, CPP and EI employee contributions, Ontario health premium, with gross-income and contribution-base assumptions written down first. Toronto's costs and indicators.
5. Sacramento on production data.
6. Deploy builds without fixtures; the fixture banner, the development-preview heading and the `--with-fixtures` CI step are removed.

Childcare for Hermosillo and the new cities is not in scope; it moves to the childcare release below.

**Done when** all 15 cities in eight countries run on production data (hard data or labelled estimates) through Explore, Find and Compare for adults without children, every country has a car cost with the paid-off note, and no fixture reaches the deployed site.

**Notes for the 0.7.1 review**

- Most new figures are unverified estimates from cost-of-living sites (Expatistan, livingcost.org, Nomad List) or republications; `npm run estimates` lists all of them. The Mexican rents use a centre/elsewhere split from those sites; the city-wide value is the midpoint, a choice of this release.
- Sacramento's HUD rents and Toronto's listing rents are read through republications and labelled unverified; Austin's HUD rents, read the same way in 0.3.0, are not labelled yet: make them consistent.
- Car costs: US from AAA's small sedan (the running share is AAA's all-vehicle split); Spain and Portugal take depreciation as 30 to 40% of the total from German figures; Canada's figure is a mid-size sedan in its first year. Estonia has no published figure and stays missing, so a household with a car in Tallinn gets an incomplete transport cost.
- Canada (Ontario): matches RCGT's $60,000 example and a published $80,000 calculator case to the dollar; spouse and eligible-dependant amounts are hand-worked. The Ontario tax reduction for low incomes is not modelled. Official calculator cross-check (CRA) is part of 0.7.1.
- Mérida's climate normals are for 1951–2010; Sacramento's lifestyle prices are national because BEA's regional price parities could not be read; Toronto and Mexican cities have no car-commuting figure.
- Fixtures are retired: no `fixtures/` tree, no `--with-fixtures` build, no preview UI. Validation still rejects anything marked as a fixture in `data/`.
- Childcare is missing for the four Mexican cities, Toronto and Sacramento, by the owner's priority.
- Compiled JavaScript 192.5 kB (52.3 kB compressed); `release.json` 357.4 kB, up from 194.4 kB, mostly from the estimates' bases and the five new cities.

### 0.7.1 — Maintenance: review of 0.7.0

**Status:** Not started

Standard maintenance review, including regression of the earlier cities, plus an official calculator cross-check for Canada.

**Cost realism for North America** (owner, 2026-10-21). The owner's check: on the same salary, Sacramento came out ahead of Helsinki, which does not match experience. The review found the default household and national prices make US cities look cheaper than they are:

- **Metro price levels for US cities.** Groceries and the lifestyle categories now use US national prices from the 2021 international comparison. Scale them by the BEA Regional Price Parities for each metro area (goods for groceries and clothing, services for eating out and leisure). Look for an equivalent for Canada; if there is none, record that and leave Toronto on national prices.
- **Tips on eating out in the US and Canada.** Menu prices exclude the usual tip on table service. Add it to eating out as an unverified estimate under the estimate rule, with the share of eating out that is table service stated.
- **Car-dependent cities.** Where most commuters drive (the commuting indicator the app already has), Explore, Find and Compare say so when the household has no car, and the budget shows what one car would cost there. Whether to change the default to one car in those cities is decided in the review, with the reason recorded.
- **Price updates.** Check whether moving the 2021 price levels forward with overall inflation understates categories that rose faster (eating out in particular); use category inflation where it is published.

Done when Helsinki without a car against Sacramento with one is shown plainly, and the change in each US and Canadian city's figures is recorded in the review.

### 0.8.0–0.9.x — Improvements chosen from use

**Status:** Not planned

Planned once the full journey has been used. The last of these releases is the verification release below. Candidates: richer comparison and sharing, better household and cost estimates (for example healthcare and childcare by income or eligibility), Mexican regional cost differences, and backlog items.

### 0.9.x — Childcare data

**Status:** Not started

Lowest priority (owner decision, 2026-10-21). Childcare for every city still missing it (Hermosillo and the cities added in 0.7.0), estimates allowed; then, if worth it, childcare by income or eligibility where the rules depend on them.

### 0.9.x — Data verification

**Status:** Not started

Every unverified estimate (`npm run estimates`) is replaced with hard data from an official or primary source, or confirmed by one, or kept with the reason it cannot be; nothing stays unverified without a recorded decision. Values read from republications are checked against the original. A maintenance review of the changes follows as usual.

### 1.0.0 — First shareable release

**Status:** Not started

- All three journeys working across every supported city, with documented limitations.
- Final accessibility audit on every screen; full keyboard journey as an end-to-end test.
- Copy and visual polish across all screens.
- Data release v1.0 with a changelog of sources and dates.
- Independent tax reference cases in place for every country.

**Done when** all checks pass and the owner agrees the URL can be shared.

## Backlog (not scheduled)

- Per-city church tax rate in Germany if a city outside Berlin is added. (From review 0.2.1, S8.)
- Check HUD's FY2026 Fair Market Rents for Travis County by hand in a browser; HUD blocks automated requests. (From review 0.3.1, T5.)
- Run the five official calculator cases in docs/reviews/0.3.1-calculator-cases.md and add the results as reference tests. (From review 0.3.1, T6.)
- Residents born abroad for Hermosillo (INEGI census) and commuting by car for Hermosillo (INEGI origin-destination survey). (From 0.4.0.)
- **Needs a browser:** commuting by car for Austin, ACS 2024 1-year table S0801 (car, truck or van; public transport; worked from home) for the city of Austin on data.census.gov. The Census API now needs a key, and the Census Reporter profile does not show modes. Count car commuters among people who travel to work, to match the Urban Audit figures. (From 0.4.0; checked 2026-10-20.)
- Indicators for food variety and for a close local community; both options are offered and shown as "not covered" until then. (From 0.4.0.)
- Replace Berlin's foreign-citizen share with the Zensus 2022 share born abroad once the census table can be read at the source. (From review 0.4.1, V15.)
- A Hermosillo homicide rate, if INEGI's municipal tables can be read; the Sonora rate is used now. (From review 0.4.1, V5.)
- Central and outer rents for cities without an official split, from listing sites' district averages (estimates allowed). (Owner, 2026-10-21.)
- A household choice between a new car and a car already owned, changing the budget rather than only the note. (Owner, 2026-10-21.)
- Pension top-up: an optional line for countries whose public pension replaces a smaller share of pay (OECD *Pensions at a Glance* net replacement rates), so that savings are compared like with like. For example, a US household saving into a 401(k) to match Finland's earnings-related pension. (Owner, 2026-10-21.)
- Health insurance deductibles: a bad-year view of US healthcare costs (deductible and out-of-pocket maximum), not only the average out-of-pocket spend. (Owner, 2026-10-21.)
- More cities and countries.
- Reverse-solve: gross salary needed to match another city's savings.
- Self-employment and special expatriate tax regimes.
- Live exchange rates.

The official calculator cross-check (review 0.2.1, S7) moved from the backlog to 0.3.1 and 0.6.1.
