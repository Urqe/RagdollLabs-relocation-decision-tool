import type { ChildAges, Relationship } from '../types.ts';

export type LineKind = 'incomeTax' | 'employeeContribution' | 'employerContribution';

/** One annual amount in local currency. Employer lines never reduce take-home pay. */
export interface TaxLine {
  id: string;
  label: string;
  kind: LineKind;
  amount: number;
  /** Index of the earner this line belongs to; absent for joint (household) lines. */
  earner?: number;
  note?: string;
}

export interface TaxInput {
  /** Annual gross employment income per earner, local currency. One or two entries. */
  grossLocal: number[];
  /** Relationship of the two adults; 'unmarried' for a one-adult household. Each model decides what it means for tax. */
  relationship: Relationship;
  children: ChildAges;
  subdivision: string;
  /** All adults in the household, earning or not. Both adults are assumed to be parents of the children. */
  adults: number;
  /**
   * Earner who pays more than half of the household's running costs, or null if none does.
   * Used only where filing status depends on it (US head of household).
   */
  costPayer: number | null;
  /** Member of a church that levies church tax (Finland, Germany). Default false. */
  churchMember?: boolean;
}

export interface TaxResult {
  model: string;
  taxYear: number;
  currency: string;
  grossAnnual: number;
  lines: TaxLine[];
  /** Annual take-home: gross minus income taxes and employee contributions. */
  netAnnual: number;
  /** Plain-language simplifications that apply to this calculation. */
  notes: string[];
}

export interface Bracket {
  /** Lower bound of taxable income for this bracket. */
  from: number;
  rate: number;
}


export const childCount = (c: ChildAges): number => c.under14 + c.from14to16 + c.from17to24;
