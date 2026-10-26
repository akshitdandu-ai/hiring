import { R01 } from './R01';
import { R02 } from './R02';
import { R03 } from './R03';
import { R04 } from './R04';
import { R05 } from './R05';
import { R06 } from './R06';
import { R07 } from './R07';
import { R08 } from './R08';
import { R09 } from './R09';
import { R10 } from './R10';
import type { Rule } from './types';

export const RULES: Array<[string, Rule]> = [
  ['R-01', R01],
  ['R-02', R02],
  ['R-03', R03],
  ['R-04', R04],
  ['R-05', R05],
  ['R-06', R06],
  ['R-07', R07],
  ['R-08', R08],
  ['R-09', R09],
  ['R-10', R10],
];
export type { Rule, RuleContext, RuleOutput } from './types';
