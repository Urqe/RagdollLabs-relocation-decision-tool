# Updating data

All data is static and versioned with the code. Nothing is fetched at runtime.

## Rules

- Every number is an Observation with a source id, period, retrieval date, geographic level, provenance and confidence.
- `null` means missing. Never use 0 as a placeholder.
- A national or regional value shown on a city uses `provenance: "inherited"` and the level it came from.
- No AI-generated or guessed figures in `data/`. Placeholder values belong in `fixtures/` with `"fixture": true`.

## Workflow

1. **Check what is due.** `npm run validate` fails when a source's `lastChecked` is older than its cadence allows (7 days daily, 45 monthly, 120 quarterly, 400 annual, 730 irregular). To publish anyway, add `"reviewDeferral": { "until": "<date>", "reason": "…" }` to the source; validation fails again once the date passes.
2. **Fetch by hand.** Download the source file and note its URL and retrieval date.
3. **Transform, don't retype.** Write or reuse a small script that turns the source file into Observations. Tax parameters are the exception: they are entered by hand in `data/tax/<country>/<year>.json`, each file lists the pages its values came from, and each country has unit tests against published examples.
4. **Validate.** `npm run check`. Review any large change against the previous values in the diff.
5. **Release.** Update `lastChecked` in `data/sources.json` and bump `dataVersion` in `data/release.json` (`<date>.<n>`). A new FX snapshot goes in `data/fx/<date>.json`; the newest file is used.

## Sources on different schedules

Values keep their own period; they are not forced to one reference date. The UI shows the period per row.

Three dates are kept apart:

- `lastChecked` on a source: when it was last reviewed for updates.
- `period` on an observation: the time the value describes.
- `date` on an FX snapshot: the day of the exchange rates.

## Tax parameter contract

Each file in `data/tax/` is checked against its model's schema in `src/data/tax-schemas.ts`: every parameter the model reads must be present, of the right type and within bounds, and related fields must agree (German tariff zones join up, phase-outs end after they start, one Portuguese "parcela a abater" per bracket). Each city's tax subdivision must exist in its model's file, and each non-euro currency needs an exchange rate. Adding a parameter to a model means adding it to the schema too.

## Tax parameters in this release

| Jurisdiction | Year | Notes |
| --- | --- | --- |
| Finland | 2026 | Matches Veronmaksajat's published 2026 payslip examples to the cent. Municipal rates: Helsinki 5.30% (council decision), Tampere 7.60% (city budget proposal, unchanged from 2025). |
| US federal | 2026 | IRS Rev. Proc. 2025-32; Social Security wage base from SSA. |
| Texas | 2026 | No state income tax. |
| Estonia | 2026 | Emta 2026 rates: 22% flat, €700 a month exemption for everyone. Matches a published calculator example (€2,000 a month → €1,658 net). |
| Germany | 2026 | §32a EStG tariff and 2026 social insurance values. Annual assessment, not monthly withholding. Tariff and solidarity surcharge match the published 2026 Grundtabelle at ten points. |
| Spain | 2026 | Madrid scale and minimums from Ley 13/2023 (BOCM); Valencian scale from Ley 5/2026 art. 18 (DOGV); 2026 low-income credit from RDL 5/2026. The low-income work reduction uses the 2025 rule (no 2026 change found). Joint filing for married couples (€3,400 reduction, personal minimum once) from the AEAT joint-filing pages. |
| Portugal | 2026 | IRS table and specific deduction from PwC's 2026 tax guide; brackets cross-checked against the published "parcela a abater" column. |
| California | 2025 schedules | FTB's 2026 estimated-tax instructions direct use of the 2025 schedules until 2026 ones are published. Update when FTB publishes them. |
