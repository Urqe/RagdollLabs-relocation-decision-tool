import { describe, test } from 'node:test';
import { finnishTax, type FiParams } from '../../src/core/tax/fi.ts';
import { germanTariff, germanTax, type DeParams } from '../../src/core/tax/de.ts';
import { usTax, type UsParams } from '../../src/core/tax/us.ts';
import { mexicanTax, type MxParams } from '../../src/core/tax/mx.ts';
import type { TaxResult } from '../../src/core/tax/types.ts';
import { loadJson, near, taxInput } from './helpers.ts';

/**
 * Reference cases from the official calculators (review 0.3.1, T6; docs/reviews/0.3.1-calculator-cases.md),
 * run in a browser on 2026-10-20. Single adult, no children, no church membership, wage income only, 2026.
 * Tolerance: €1 a month, or the local equivalent.
 */
const line = (r: TaxResult, ...ids: string[]): number => r.lines.filter((l) => ids.includes(l.id)).reduce((s, l) => s + l.amount, 0);
const one = (gross: number, subdivision: string) => taxInput({ grossLocal: [gross], subdivision });

describe('official calculator reference cases (T6)', () => {
  test('Finland: Vero, veroprosenttilaskuri 2026, Helsinki, wages €60,000', () => {
    // "Koko vuonna maksettava vero" €12,706.76: state, municipal, health-care, daily allowance and Yle together.
    // Pension €4,380.00 and unemployment €534.00 shown as deductions; daily allowance €528.00.
    const r = finnishTax(one(60000, 'helsinki'), loadJson<FiParams>('data/tax/fi/2026.json'));
    near(line(r, 'fi.state', 'fi.municipal', 'fi.healthCare', 'fi.dailyAllowance', 'fi.yle'), 12706.76, 12);
    near(line(r, 'fi.pension'), 4380, 12);
    near(line(r, 'fi.unemployment'), 534, 12);
    near(line(r, 'fi.dailyAllowance'), 528, 12);
    near(r.netAnnual, 60000 - 12706.76 - 4380 - 534, 12);
  });

  test('Germany: BMF Einkommensteuer-Rechner 2026 and Lohnsteuer-Rechner 2026, Berlin, €60,000', () => {
    const de = loadJson<DeParams>('data/tax/de/2026.json');
    // Einkommensteuer on the app's taxable income €46,674 (single): €9,399.00, no solidarity surcharge.
    near(germanTariff(46674, de.tariff), 9399, 0);
    const r = germanTax(one(60000, 'berlin'), de);
    near(line(r, 'de.income'), 9399, 0);
    near(line(r, 'de.soli'), 0, 0);
    // Lohnsteuer for the whole year (tax class I, 2.9% supplementary rate, childless surcharge): €9,389.00.
    // The payroll formula's Vorsorgepauschale differs slightly from the assessment; within €1 a month.
    near(line(r, 'de.income'), 9389, 12);
  });

  test('United States: IRS 2026 standard deduction and rate schedule, Texas, single, $90,000', () => {
    // $90,000 − $16,100 = $73,900 taxable; 10% to $12,400, 12% to $50,400, 22% above → $10,970.
    const r = usTax(one(90000, 'tx'), loadJson<UsParams>('data/tax/us/2026.json'));
    near(line(r, 'us.federal'), 10970, 0.01);
    near(line(r, 'us.socialSecurity'), 5580, 0.01);
    near(line(r, 'us.medicare'), 1305, 0.01);
    near(r.netAnnual, 72145, 0.01);
  });

  test('Mexico: SAT Anexo 8 RMF 2026 annual tariff (C.II), Hermosillo, MXN 300,000 a year', () => {
    // SAT has no anonymous payroll calculator. Worked from the published límite inferior and cuota fija:
    // taxable 294,721.05 after the exempt bonus (30 UMA) and premium (15 UMA);
    // 22,282.14 + 21.36% × (294,721.05 − 210,403.70) = 40,292.33.
    const r = mexicanTax(one(300000, 'son'), loadJson<MxParams>('data/tax/mx/2026.json'));
    near(line(r, 'mx.isr'), 40292.33, 0.02);
  });
});
