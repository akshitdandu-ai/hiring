import type { Booking, Finding } from '../../model/types';
import type { CarrierOutcome } from '../carrierEngine';
import type { Totals } from '../deriveTotals';

export interface RuleContext {
  booking: Booking;
  /** Local date at midnight. */
  today: Date;
  /** yyyy-MM-dd of `today` */
  todayISO: string;
  carrier: CarrierOutcome;
  totals: Totals;
}

export interface RuleOutput {
  findings: Finding[];
  /** Set when the rule could not run because of missing/invalid data. */
  couldNotCheck?: string;
}

export type Rule = (ctx: RuleContext) => RuleOutput;

export const NO_ITEMS = 'the booking has no items';
