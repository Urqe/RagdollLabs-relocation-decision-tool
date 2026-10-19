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
  married: boolean;
  children: number;
  subdivision: string;
  /** All adults in the household, earning or not. Defaults to the number of earners. */
  adults?: number;
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

