import type { Empire } from '../../types';

import brindakiLeague from './brindaki_league.json';
import graalStarKingdoms from './graal_star_kingdoms.json';
import humanUnion from './human_union.json';
import jainKhanate from './jain_khanate.json';
import kiliRepublics from './kili_republics.json';
import loranDominion from './loran_dominion.json';
import rallaxIntelligence from './rallax_intelligence.json';
import senorianFederation from './senorian_federation.json';
import tirelonSynod from './tirelon_synod.json';
import yuletarriImperium from './yuletarri_imperium.json';

export const presetEmpires: Empire[] = [
  brindakiLeague as unknown as Empire,
  graalStarKingdoms as unknown as Empire,
  humanUnion as unknown as Empire,
  jainKhanate as unknown as Empire,
  kiliRepublics as unknown as Empire,
  loranDominion as unknown as Empire,
  rallaxIntelligence as unknown as Empire,
  senorianFederation as unknown as Empire,
  tirelonSynod as unknown as Empire,
  yuletarriImperium as unknown as Empire,
];
