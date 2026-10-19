import { finnishTax, type FiParams } from './fi.ts';
import { usTax, type UsParams } from './us.ts';
import type { TaxInput, TaxResult } from './types.ts';
import type { TaxJurisdiction } from '../types.ts';

export interface TaxParamSet {
  fi?: FiParams;
  us?: UsParams;
}

export class NoTaxModelError extends Error {
  constructor(model: string) {
    super(`No tax parameters loaded for model "${model}"`);
    this.name = 'NoTaxModelError';
  }
}

/** Gross-to-net for the jurisdiction. Throws rather than inventing a rate when parameters are missing. */
export function computeTax(j: TaxJurisdiction, input: Omit<TaxInput, 'subdivision'>, params: TaxParamSet): TaxResult {
  const full: TaxInput = { ...input, subdivision: j.subdivision };
  switch (j.model) {
    case 'fi':
      if (!params.fi) throw new NoTaxModelError('fi');
      return finnishTax(full, params.fi);
    case 'us':
      if (!params.us) throw new NoTaxModelError('us');
      return usTax(full, params.us);
  }
}

export type { TaxInput, TaxResult, TaxLine } from './types.ts';
