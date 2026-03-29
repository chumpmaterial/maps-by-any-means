import type { UnitCategory, EmpireUnit, TechLevelType } from '../types';

export const HULL_CODES: Record<UnitCategory, string[]> = {
  Ships: ['AB', 'CT', 'FF', 'DD', 'CL', 'CW', 'CA', 'BC', 'BB', 'DN', 'SD', 'TN'],
  Fighters: ['LF', 'MF', 'HF', 'SHF'],
  Bases: ['OWP', 'BS1', 'BS2', 'BS3', 'BS4'],
  Troops: [],
  Civilian: [],
};

/** Standard (non-factor, non-troop) traits */
export const STANDARD_TRAITS = [
  'Armored',
  'Atmospheric',
  'Bombardment',
  'Carronade',
  'Diplomatic',
  'Fast',
  'Gunship',
  'Police',
  'Q-Ship',
  'Regenerating',
  'Stealth',
] as const;

/** Factor traits — have a numeric level (e.g. Carrier 2) */
export const FACTOR_TRAITS = [
  'Assault',
  'Carrier',
  'Disruptor',
  'Guardian',
  'Hospital',
  'Jammer',
  'Scout',
  'Supply',
  'Tender',
] as const;

/** Troop-only traits */
export const TROOP_TRAITS = [
  'Garrison',
  'Marines',
  'Peacekeepers',
  'Special Forces',
] as const;

export const DEFAULT_UNITS: EmpireUnit[] = [
  // Civilian defaults
  { id: 'default-convoy', name: 'Convoy', category: 'Civilian', hullCode: 'N/A', cost: 20, isd: 'N/A', dv: 10, as: 0, af: 0, cr: 0, cc: 0, traits: [] },
  { id: 'default-shipyard', name: 'Shipyard', category: 'Civilian', hullCode: 'N/A', cost: 20, isd: 'N/A', dv: 10, as: 0, af: 0, cr: 0, cc: 0, traits: [] },
  { id: 'default-supply-depot', name: 'Supply Depot', category: 'Civilian', hullCode: 'N/A', cost: 20, isd: 'N/A', dv: 10, as: 0, af: 0, cr: 0, cc: 0, traits: [] },
  // Troops defaults
  { id: 'default-militia', name: 'Militia', category: 'Troops', hullCode: 'N/A', cost: 1, isd: 'N/A', dv: 4, as: 4, af: '-', cr: '-', cc: '-', traits: [{ name: 'Garrison' }] },
];

// ---------------------------------------------------------------------------
// Tech Level Upgrade Table
// ---------------------------------------------------------------------------

interface TechEntry {
  total: number;      // total AP budget at this tech level (non-parenthetical)
  upgradeAP: number;  // upgrade points gained when advancing TO this level (parenthetical)
}

interface TechRow {
  E:   TechEntry;
  tl1: TechEntry;
  tl2: TechEntry;
  tl3: TechEntry;
  tl4: TechEntry;
  tl5: TechEntry;
  A:   TechEntry;
}

/** Unit Tech Level Upgrade Table keyed by hull code. Source: VBAM Unit Tech Level Upgrade Table PDF. */
export const TECH_LEVEL_TABLE: Record<string, TechRow> = {
  // Ships
  AB:  { E:{total:5,upgradeAP:0}, tl1:{total:6,upgradeAP:1},  tl2:{total:7,upgradeAP:1},  tl3:{total:8,upgradeAP:1},  tl4:{total:9,upgradeAP:1},  tl5:{total:10,upgradeAP:1}, A:{total:12,upgradeAP:0} },
  CT:  { E:{total:5,upgradeAP:0}, tl1:{total:6,upgradeAP:1},  tl2:{total:7,upgradeAP:1},  tl3:{total:8,upgradeAP:1},  tl4:{total:9,upgradeAP:1},  tl5:{total:10,upgradeAP:1}, A:{total:12,upgradeAP:0} },
  FF:  { E:{total:7,upgradeAP:0}, tl1:{total:8,upgradeAP:1},  tl2:{total:9,upgradeAP:1},  tl3:{total:10,upgradeAP:1}, tl4:{total:11,upgradeAP:1}, tl5:{total:12,upgradeAP:1}, A:{total:16,upgradeAP:0} },
  DD:  { E:{total:9,upgradeAP:0}, tl1:{total:10,upgradeAP:1}, tl2:{total:11,upgradeAP:1}, tl3:{total:13,upgradeAP:2}, tl4:{total:14,upgradeAP:1}, tl5:{total:15,upgradeAP:1}, A:{total:20,upgradeAP:0} },
  CL:  { E:{total:11,upgradeAP:0},tl1:{total:12,upgradeAP:1}, tl2:{total:14,upgradeAP:2}, tl3:{total:15,upgradeAP:1}, tl4:{total:17,upgradeAP:2}, tl5:{total:18,upgradeAP:1}, A:{total:24,upgradeAP:0} },
  CW:  { E:{total:13,upgradeAP:0},tl1:{total:14,upgradeAP:1}, tl2:{total:16,upgradeAP:2}, tl3:{total:18,upgradeAP:2}, tl4:{total:19,upgradeAP:1}, tl5:{total:21,upgradeAP:2}, A:{total:28,upgradeAP:0} },
  CA:  { E:{total:14,upgradeAP:0},tl1:{total:16,upgradeAP:2}, tl2:{total:18,upgradeAP:2}, tl3:{total:20,upgradeAP:2}, tl4:{total:22,upgradeAP:2}, tl5:{total:24,upgradeAP:2}, A:{total:32,upgradeAP:0} },
  BC:  { E:{total:16,upgradeAP:0},tl1:{total:18,upgradeAP:2}, tl2:{total:20,upgradeAP:2}, tl3:{total:23,upgradeAP:3}, tl4:{total:25,upgradeAP:2}, tl5:{total:27,upgradeAP:2}, A:{total:36,upgradeAP:0} },
  BB:  { E:{total:18,upgradeAP:0},tl1:{total:20,upgradeAP:2}, tl2:{total:23,upgradeAP:3}, tl3:{total:25,upgradeAP:2}, tl4:{total:28,upgradeAP:3}, tl5:{total:30,upgradeAP:2}, A:{total:40,upgradeAP:0} },
  DN:  { E:{total:22,upgradeAP:0},tl1:{total:24,upgradeAP:2}, tl2:{total:27,upgradeAP:3}, tl3:{total:30,upgradeAP:3}, tl4:{total:33,upgradeAP:3}, tl5:{total:36,upgradeAP:3}, A:{total:48,upgradeAP:0} },
  SD:  { E:{total:27,upgradeAP:0},tl1:{total:30,upgradeAP:3}, tl2:{total:34,upgradeAP:4}, tl3:{total:38,upgradeAP:4}, tl4:{total:41,upgradeAP:3}, tl5:{total:45,upgradeAP:4}, A:{total:60,upgradeAP:0} },
  TN:  { E:{total:36,upgradeAP:0},tl1:{total:40,upgradeAP:4}, tl2:{total:45,upgradeAP:5}, tl3:{total:50,upgradeAP:5}, tl4:{total:55,upgradeAP:5}, tl5:{total:60,upgradeAP:5}, A:{total:80,upgradeAP:0} },
  // Fighters
  LF:  { E:{total:5,upgradeAP:0}, tl1:{total:6,upgradeAP:1},  tl2:{total:7,upgradeAP:1},  tl3:{total:8,upgradeAP:1},  tl4:{total:9,upgradeAP:1},  tl5:{total:10,upgradeAP:1}, A:{total:12,upgradeAP:0} },
  MF:  { E:{total:7,upgradeAP:0}, tl1:{total:8,upgradeAP:1},  tl2:{total:9,upgradeAP:1},  tl3:{total:10,upgradeAP:1}, tl4:{total:11,upgradeAP:1}, tl5:{total:12,upgradeAP:1}, A:{total:16,upgradeAP:0} },
  HF:  { E:{total:9,upgradeAP:0}, tl1:{total:10,upgradeAP:1}, tl2:{total:11,upgradeAP:1}, tl3:{total:13,upgradeAP:2}, tl4:{total:14,upgradeAP:1}, tl5:{total:15,upgradeAP:1}, A:{total:20,upgradeAP:0} },
  SHF: { E:{total:11,upgradeAP:0},tl1:{total:12,upgradeAP:1}, tl2:{total:14,upgradeAP:2}, tl3:{total:15,upgradeAP:1}, tl4:{total:17,upgradeAP:2}, tl5:{total:18,upgradeAP:1}, A:{total:24,upgradeAP:0} },
  // Bases
  OWP: { E:{total:9,upgradeAP:0}, tl1:{total:10,upgradeAP:1}, tl2:{total:11,upgradeAP:1}, tl3:{total:13,upgradeAP:2}, tl4:{total:14,upgradeAP:1}, tl5:{total:15,upgradeAP:1}, A:{total:20,upgradeAP:0} },
  BS1: { E:{total:18,upgradeAP:0},tl1:{total:20,upgradeAP:2}, tl2:{total:23,upgradeAP:3}, tl3:{total:25,upgradeAP:2}, tl4:{total:28,upgradeAP:3}, tl5:{total:30,upgradeAP:2}, A:{total:40,upgradeAP:0} },
  BS2: { E:{total:27,upgradeAP:0},tl1:{total:30,upgradeAP:3}, tl2:{total:34,upgradeAP:4}, tl3:{total:38,upgradeAP:4}, tl4:{total:41,upgradeAP:3}, tl5:{total:45,upgradeAP:4}, A:{total:60,upgradeAP:0} },
  BS3: { E:{total:36,upgradeAP:0},tl1:{total:40,upgradeAP:4}, tl2:{total:45,upgradeAP:5}, tl3:{total:50,upgradeAP:5}, tl4:{total:55,upgradeAP:5}, tl5:{total:60,upgradeAP:5}, A:{total:80,upgradeAP:0} },
  BS4: { E:{total:45,upgradeAP:0},tl1:{total:50,upgradeAP:5}, tl2:{total:56,upgradeAP:6}, tl3:{total:63,upgradeAP:7}, tl4:{total:69,upgradeAP:6}, tl5:{total:75,upgradeAP:6}, A:{total:100,upgradeAP:0} },
};

/** Get the TechRow key from a TechLevelType */
function tlKey(tl: TechLevelType): keyof TechRow {
  if (tl === 'E') return 'E';
  if (tl === 'A') return 'A';
  return `tl${tl}` as keyof TechRow;
}

/**
 * Returns upgrade points when advancing a unit TO the given numeric TL.
 * Troops/Civilian always get 2 AP per TL; others look up TECH_LEVEL_TABLE by hull code.
 */
export function getUpgradePoints(hullCode: string, category: UnitCategory, toLevel: number): number {
  if (category === 'Troops' || category === 'Civilian') return 2;
  const row = TECH_LEVEL_TABLE[hullCode];
  if (!row) return 0;
  const key = tlKey(toLevel as TechLevelType);
  return row[key].upgradeAP;
}

/**
 * Returns total AP budget for a given tech level and hull code (used for custom unit creation).
 * Troops/Civilian: 2 × (numeric TL − 1) since they start at TL1.
 */
export function getTotalAP(hullCode: string, category: UnitCategory, tl: TechLevelType): number {
  if (category === 'Troops' || category === 'Civilian') {
    if (typeof tl === 'number') return 2 * (tl - 1);
    return 0; // E/A not applicable for Troops/Civilian
  }
  const row = TECH_LEVEL_TABLE[hullCode];
  if (!row) return 0;
  return row[tlKey(tl)].total;
}

/**
 * Computes Tech Advancement Cost (TAC) for a player.
 * TAC = ceil(systemIncome × 2 × traitModifier)
 * −30% for 'Brilliant' advantage; +30% for 'Uncreative' disadvantage.
 */
export function computeTAC(systemIncome: number, advantages: string[], disadvantage: string): number {
  let modifier = 1;
  if (advantages.includes('Brilliant')) modifier *= 0.7;
  if (disadvantage === 'Uncreative') modifier *= 1.3;
  return Math.ceil(systemIncome * 2 * modifier);
}

/**
 * Returns the next TL iterator suffix for a unit being upgraded.
 * E.g. a unit currently TL1 → '-II'; TL2 → '-III'; etc.
 * For independents upgrading from 'E': returns '-I'.
 */
export function nextTLIterator(currentLevel: TechLevelType | undefined): string {
  const level = currentLevel ?? 1;
  if (level === 'E') return '-I';
  if (level === 1) return '-II';
  if (level === 2) return '-III';
  if (level === 3) return '-IV';
  if (level === 4) return '-V';
  return '-V'; // already at max
}

/**
 * Returns the next numeric TL after the given level.
 * For players: TL1→2, ..., TL4→5. Returns null if already at max (5).
 * For independents: 'E'→1, TL1→2, ..., TL4→5.
 */
export function nextTechLevel(currentLevel: TechLevelType | undefined, isIndependent = false): number | null {
  const level = currentLevel ?? (isIndependent ? 'E' : 1);
  if (level === 'E') return 1;
  if (typeof level === 'number' && level < 5) return level + 1;
  return null; // already at max or Ancient
}

export function createEmptyUnit(category: UnitCategory): EmpireUnit {
  const hullCodes = HULL_CODES[category];
  const isTroops = category === 'Troops';

  return {
    id: crypto.randomUUID(),
    name: '',
    category,
    hullCode: hullCodes.length > 0 ? hullCodes[0] : 'N/A',
    cost: 0,
    isd: '3000',
    dv: 0,
    as: 0,
    af: isTroops ? '-' : 0,
    cr: isTroops ? '-' : 0,
    cc: isTroops ? '-' : 0,
    traits: [],
  };
}
