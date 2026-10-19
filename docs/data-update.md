# Updating data

All data is static and versioned with the code. Nothing is fetched at runtime.

## Rules

- Every number is an Observation with a source id, period, retrieval date, geographic level, provenance and confidence.
- `null` means missing. Never use 0 as a placeholder.
- A national or regional value shown on a city uses `provenance: "inherited"` and the level it came from.
- No AI-generated or guessed figures in `data/`. Placeholder values belong in `fixtures/` with `"fixture": true`.

## Workflow

1. **Check what is due.** `npm run validate` prints sources whose `lastChecked` is older than their cadence allows.
2. **Fetch by hand.** Download the source file and note its URL and retrieval date.
3. **Transform, don't retype.** Write or reuse a small script that turns the source file into Observations. Tax parameters are the exception: they are entered by hand in `data/tax/<country>/<year>.json`, each file lists the pages its values came from, and each country has unit tests against published examples.
4. **Validate.** `npm run check`. Review any large change against the previous values in the diff.
5. **Release.** Update `lastChecked` in `data/sources.json`. A new FX snapshot goes in `data/fx/<date>.json`; the newest file is used.

## Sources on different schedules

Values keep their own period; they are not forced to one reference date. The UI shows the period per row.

## Tax parameters in this release

| Jurisdiction | Year | Notes |
| --- | --- | --- |
| Finland | 2026 | Matches Veronmaksajat's published 2026 payslip examples to the cent. Municipal rates: Helsinki 5.30% (council decision), Tampere 7.60% (city budget proposal, unchanged from 2025). |
| US federal | 2026 | IRS Rev. Proc. 2025-32; Social Security wage base from SSA. |
| Texas | 2026 | No state income tax. |
| California | 2025 schedules | FTB's 2026 estimated-tax instructions direct use of the 2025 schedules until 2026 ones are published. Update when FTB publishes them. |
