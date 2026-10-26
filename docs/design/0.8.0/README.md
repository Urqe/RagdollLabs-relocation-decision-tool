# 0.8.0 — discovery-first interface

## Audit and selected layout

The prior desktop first screen gave a permanent, long household form about a quarter of the viewport. Find then opened on a preference slider wall, Explore exposed the budget source table early, and Compare asked readers to derive differences from rows of figures. On a 390px phone the form and table consumed much of the initial journey. The three before captures record those states.

| Journey | Layout concept and chosen hierarchy |
| --- | --- |
| Find | Editorial promise → three starter briefs → optional preference editor → ranked place cards → detailed fit and checks. The existing calculation still uses the sample €50,000 household until edited; with no priority selected, ranking is explicitly by money. |
| Explore | Place name and climate-coded abstract visual → affordability conclusion → four budget balances and spending ribbon → fit → warnings → expandable cost sources and own figures. |
| Compare | Place cards with affordability, fit and check cues → income mode → detailed accessible table → add and share. The top cards do not claim a winner from close estimates. |

All three use the same quiet paper canvas, serif display, compact scenario strip, section eyebrow, cards and clear disclosure pattern. The visual is deliberately abstract, with warm/cool/mild palette selected from the city's observed warmest-month value. It is *not* city photography or a claim about a skyline. The adjacent climate text names the measured coldest-month mean and warmest-month average high, or says data is missing. No external image, font, icon library, or runtime service is fetched.

## Design system

- **Colour:** `--paper`, `--surface`, `--ink`, `--muted`, `--rule`, `--control`, `--focus`, `--moss`, `--cranberry`, `--amber` are the semantic tokens; dark mode swaps them under `prefers-color-scheme`. Financial ribbons keep category colours and label contrast tokens. Warm terracotta is a section accent, not a financial status colour.
- **Type:** system serif stack (Iowan, Palatino, Georgia) for large editorial titles and place names; native system sans for controls, body and figures. Titles scale with `clamp`; small uppercase eyebrows mark section purpose. All data remains text, including the bars' accessible labels.
- **Space and surfaces:** existing 4–48px spacing tokens; 12px control radius and ~17px result cards; broad 1440px maximum content area. Cards use borders and restrained shadows. A 390px breakpoint stacks starter briefs, place cards, hero and comparison cards.
- **Components:** pill primary link, native radio/select/input with visible focus, scenario disclosure, starter brief buttons, place illustration, result insight grid, labeled savings track, evidence disclosure, four budget tiles and a semantics-preserving comparison table. Existing source notes and tax details remain reachable from the cost disclosure.
- **Icon and motion policy:** no pictorial icon system; the brand mark is a typographic asterisk. No essential state depends on hover or motion. `prefers-reduced-motion` disables transitions and animation.

## Interaction notes

The root route opens Find. A starter brief sets deterministic preference weights and choices; “Make it mine” opens the detailed preference form. The sample household is stated before ranking and its scenario strip opens at every width. Shortlist checkboxes retain selection through rerenders and lead to a two or three city comparison. Both details sections are native keyboard-operable disclosure controls. On Explore, opening cost and sources persists while state changes rebuild the screen. A direct Explore or Compare link still opens its target. Existing data limitations, incomplete costs, per-city income warnings, tax sources and share privacy language remain in the interface.

The abstract place art is decoration with `aria-hidden`; the city name and climate figures are accessible text. Cards name why they fit, what they give up, estimated affordability and what to check. When no preference is set, they say so rather than inventing a strength. The mini savings track states its ratio in an `aria-label` and is absent for incomplete budgets. Numerical details and estimation limits remain available. The 0.8.1 usability review will test these journeys with independent users and refine any confusion; that study is outside this implementation release.

## Captures

Before (desktop): [Find](before-find-desktop.webp), [Explore](before-explore-desktop.webp), [Compare](before-compare-desktop.webp).

After:

| Journey | Desktop | 390px | Dark |
| --- | --- | --- | --- |
| Find | [desktop](after-find-desktop.webp) | [390px](after-find-mobile.webp) | [dark](after-find-dark.webp) |
| Explore | [desktop](after-explore-desktop.webp) | [390px](after-explore-mobile.webp) | [dark](after-explore-dark.webp) |
| Compare | [desktop](after-compare-desktop.webp) | [390px](after-compare-mobile.webp) | [dark](after-compare-dark.webp) |
