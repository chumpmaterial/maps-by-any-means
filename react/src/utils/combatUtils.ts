import type {
  CampaignUnit,
  CampaignPlayer,
  CombatScenario,
  CombatUnitState,
  Empire,
  CMFleet,
} from '../types';
import type { EmpireUnit } from '../types';

/** Hull codes that qualify for Wolfpacks advantage */
const WOLFPACK_HULL_CODES = new Set(['AB', 'CT', 'FF', 'DD']);

/**
 * Compute effective DV/AS/AF for a unit in combat.
 * All rounding uses Math.ceil().
 *
 * Order of operations:
 *  1. Wolfpacks empire advantage (+1 AS/AF for eligible hulls if not crippled)
 *  2. Crippled penalties (DV/AS/AF -50% with trait exceptions)
 *  3. OOS penalties (same -50%, stacks with Crippled for AS/AF)
 *  4. Captured (AS=0, AF=0)
 *  5. Formation Bonus / Disrupted on DV
 *  6. Jammed on AS/AF
 */
export function computeEffectiveStats(
  unit: CampaignUnit,
  template: EmpireUnit,
  unitState: CombatUnitState | undefined,
  flagshipEmpire: Empire | null,
): { dv: number; as: number; af: number } {
  let dv = template.dv;
  let as = template.as === '-' ? 0 : (template.as as number);
  let af = template.af === '-' ? 0 : (template.af as number);

  // Consolidate cripple sources: strategic status OR scenario-level cripple
  const isCrippled = unit.crippled || !!unitState?.crippledInScenario;

  // 1. Wolfpacks: flagship empire advantage applies +1 AS/AF to non-crippled AB/CT/FF/DD
  const isWolfpackEligible =
    !isCrippled &&
    flagshipEmpire?.advantages.includes('Wolfpacks') &&
    WOLFPACK_HULL_CODES.has(template.hullCode);
  if (isWolfpackEligible) {
    as += 1;
    af += 1;
  }

  // Check traits
  const hasArmored   = template.traits.some(t => t.name === 'Armored');
  const hasGunship   = template.traits.some(t => t.name === 'Gunship');
  const hasCarronade = template.traits.some(t => t.name === 'Carronade');

  // 2. Crippled DV penalty (Crippled OR OOS, don't stack for DV)
  if ((isCrippled && !hasArmored) || unit.outOfSupply) {
    dv = Math.ceil(dv * 0.5);
  }

  // 3. Crippled AS/AF penalties (stack with OOS)
  if (isCrippled && !hasGunship) {
    as = Math.ceil(as * 0.5);
  }
  if (unit.outOfSupply) {
    as = Math.ceil(as * 0.5);
  }
  if (isCrippled && !hasCarronade) {
    af = Math.ceil(af * 0.5);
  }
  if (unit.outOfSupply) {
    af = Math.ceil(af * 0.5);
  }

  // 4. Captured: AS and AF are non-functional (strategic flag OR in-scenario capture)
  if (unit.captured || unitState?.capturedBySide != null) {
    as = 0;
    af = 0;
  }

  // 5. Formation Bonus / Disrupted affect DV
  if (unitState?.formationBonus && unitState?.disrupted) {
    // Cancel each other — no net DV change
  } else if (unitState?.formationBonus) {
    dv = Math.ceil(dv * 1.5);
  } else if (unitState?.disrupted) {
    dv = Math.ceil(dv * 0.5);
  }

  // 6. Jammed: AS and AF -50%
  if (unitState?.jammed) {
    as = Math.ceil(as * 0.5);
    af = Math.ceil(af * 0.5);
  }

  return { dv, as, af };
}

/**
 * Compute the total of a named factor trait across all units.
 * Crippled (non-captured) units have their factor value halved (ceil).
 * Captured units contribute 0 to all factor traits.
 */
export function computeFactorTotal(
  units: CampaignUnit[],
  templates: Map<string, EmpireUnit>,
  traitName: string,
): number {
  let total = 0;
  for (const unit of units) {
    if (unit.captured) continue;
    const template = templates.get(unit.unitTemplateId);
    if (!template) continue;
    const trait = template.traits.find(t => t.name === traitName);
    if (!trait || !trait.factor) continue;
    let value = trait.factor;
    if (unit.crippled) value = Math.ceil(value * 0.5);
    total += value;
  }
  return total;
}

/** Units on one side of the scenario with their resolved template + faction info */
export interface SideUnitInfo {
  unit: CampaignUnit;
  state: CombatUnitState;
  template: EmpireUnit;
  player?: CampaignPlayer;     // undefined for CM/independent faction units
  factionId: string;            // player.id | "independent:sysId" | "cm:color"
  factionLabel: string;         // player name | system name | fleet name
  factionColor: string;         // hex color for UI accents
}

/**
 * Returns all units participating on a given side of a combat scenario,
 * along with their CombatUnitState, template, and owning faction.
 * Pass cmFleets + indieTemplates to include CM/independent fleet units.
 */
export function getSideUnits(
  scenario: CombatScenario,
  side: 'attacker' | 'defender',
  players: CampaignPlayer[],
  cmFleets?: CMFleet[],
  indieTemplates?: EmpireUnit[],
): SideUnitInfo[] {
  const force = side === 'attacker' ? scenario.attackerForce : scenario.defenderForce;
  const sideIds = new Set([force.primaryPlayerId, ...force.alliedPlayerIds]);
  const result: SideUnitInfo[] = [];

  for (const player of players) {
    if (!sideIds.has(player.id)) continue;
    // Build a template map: own empire + stolen unit designs + allied empire units
    const templateMap = new Map(player.empire.units.map(u => [u.id, u]));
    for (const s of player.stolenUnits ?? []) templateMap.set(s.unit.id, s.unit);
    for (const op of players) {
      if (op.id !== player.id) for (const u of op.empire.units) if (!templateMap.has(u.id)) templateMap.set(u.id, u);
    }
    for (const unit of player.units) {
      const state = scenario.unitStates[unit.id];
      if (!state || state.side !== side) continue;
      const template = templateMap.get(unit.unitTemplateId);
      if (!template) continue;
      result.push({ unit, state, template, player, factionId: player.id, factionLabel: player.name, factionColor: player.teamColor ?? '#9ca3af' });
    }
  }

  // Also include captured units that now fight for this side.
  for (const player of players) {
    if (sideIds.has(player.id)) continue; // already processed above
    const templateMap = new Map(player.empire.units.map(u => [u.id, u]));
    for (const s of player.stolenUnits ?? []) templateMap.set(s.unit.id, s.unit);
    for (const unit of player.units) {
      const state = scenario.unitStates[unit.id];
      if (!state || state.side !== side || !state.capturedBySide) continue;
      const template = templateMap.get(unit.unitTemplateId);
      if (!template) continue;
      // Attribute the captured unit to the awarding player for display purposes
      const award = scenario.capturedUnits.find(c => c.unitId === unit.id);
      const capturingPlayer =
        (award?.awardedToPlayerId ? players.find(p => p.id === award.awardedToPlayerId) : null)
        ?? players.find(p => p.id === force.primaryPlayerId)
        ?? player;
      result.push({ unit, state, template, player: capturingPlayer, factionId: capturingPlayer.id, factionLabel: capturingPlayer.name, factionColor: capturingPlayer.teamColor ?? '#9ca3af' });
    }
  }

  // CM / independent fleet units
  if (cmFleets?.length && indieTemplates?.length) {
    const indieTemplateMap = new Map(indieTemplates.map(t => [t.id, t]));
    for (const fleet of cmFleets) {
      const factionId = fleet.independentSystemId
        ? `independent:${fleet.independentSystemId}`
        : `cm:${fleet.color ?? 'gray'}`;
      if (!sideIds.has(factionId)) continue;
      const factionLabel = fleet.name;
      const factionColor = fleet.color ?? '#9ca3af';
      for (const unit of fleet.units) {
        const state = scenario.unitStates[unit.id];
        if (!state || state.side !== side) continue;
        const template = indieTemplateMap.get(unit.unitTemplateId);
        if (!template) continue;
        result.push({ unit, state, template, player: undefined, factionId, factionLabel, factionColor });
      }
    }
  }

  return result;
}

/**
 * Returns the Empire of the player who owns the Flagship on the given side, or null.
 */
export function getFlagshipEmpire(
  scenario: CombatScenario,
  side: 'attacker' | 'defender',
  players: CampaignPlayer[],
): Empire | null {
  for (const [, state] of Object.entries(scenario.unitStates)) {
    if (state.side !== side || !state.isFlagship) continue;
    const player = players.find(p => p.id === state.playerId);
    return player?.empire ?? null;
  }
  return null;
}

/**
 * Build the initial unitStates Record for a scenario.
 * Units belonging to attacker-force factions are on side 'attacker'; defender-force on 'defender'.
 * Only units currently at the scenario's system are included.
 * Pass cmFleets + indieTemplates to include CM/independent fleet units.
 */
export function initScenarioUnitStates(
  scenario: CombatScenario,
  players: CampaignPlayer[],
  cmFleets?: CMFleet[],
  indieTemplates?: EmpireUnit[],
): Record<string, CombatUnitState> {
  const attackerIds = new Set([
    scenario.attackerForce.primaryPlayerId,
    ...scenario.attackerForce.alliedPlayerIds,
  ]);
  const defenderIds = new Set([
    scenario.defenderForce.primaryPlayerId,
    ...scenario.defenderForce.alliedPlayerIds,
  ]);

  const states: Record<string, CombatUnitState> = {};

  for (const player of players) {
    const isAttacker = attackerIds.has(player.id);
    const isDefender = defenderIds.has(player.id);
    if (!isAttacker && !isDefender) continue;
    const side: 'attacker' | 'defender' = isAttacker ? 'attacker' : 'defender';

    for (const unit of player.units) {
      if (unit.systemId !== scenario.systemId) continue;
      if (unit.mothballed) continue;
      const template =
        player.empire.units.find(t => t.id === unit.unitTemplateId)
        ?? player.stolenUnits?.find(s => s.unit.id === unit.unitTemplateId)?.unit
        ?? players.flatMap(p => p.id !== player.id ? p.empire.units : []).find(t => t.id === unit.unitTemplateId);
      if (scenario.scenarioType === 'ground_combat') {
        if (template?.category !== 'Troops') continue;
      } else {
        if (template?.category === 'Troops') continue;
      }
      const isOnPlanet = scenario.scenarioType === 'ground_combat' && unit.fleetId === 'On-Planet';
      states[unit.id] = {
        unitId: unit.id,
        playerId: player.id,
        side,
        isFlagship: false,
        formationBonus: false,
        disrupted: false,
        jammed: false,
        inTaskForce: isOnPlanet,
        fighterAssignment: null,
        destroyed: false,
        capturedBySide: null,
        exitedScenario: false,
        effectiveCarriedById: unit.carriedById ?? null,
      };
    }
  }

  // CM / independent fleet units
  if (cmFleets?.length && indieTemplates?.length) {
    const indieTemplateMap = new Map(indieTemplates.map(t => [t.id, t]));
    for (const fleet of cmFleets) {
      if (fleet.systemId !== scenario.systemId) continue;
      const factionId = fleet.independentSystemId
        ? `independent:${fleet.independentSystemId}`
        : `cm:${fleet.color ?? 'gray'}`;
      const isAttacker = attackerIds.has(factionId);
      const isDefender = defenderIds.has(factionId);
      if (!isAttacker && !isDefender) continue;
      const side: 'attacker' | 'defender' = isAttacker ? 'attacker' : 'defender';
      for (const unit of fleet.units) {
        if (unit.mothballed) continue;
        const template = indieTemplateMap.get(unit.unitTemplateId);
        if (scenario.scenarioType === 'ground_combat') {
          if (template?.category !== 'Troops') continue;
        } else {
          if (template?.category === 'Troops') continue;
        }
        const isOnPlanet = scenario.scenarioType === 'ground_combat' && unit.fleetId === 'On-Planet';
        states[unit.id] = {
          unitId: unit.id,
          playerId: factionId,
          side,
          isFlagship: false,
          formationBonus: false,
          disrupted: false,
          jammed: false,
          inTaskForce: isOnPlanet,
          fighterAssignment: null,
          destroyed: false,
          capturedBySide: null,
          exitedScenario: false,
          effectiveCarriedById: unit.carriedById ?? null,
        };
      }
    }
  }

  return states;
}

/**
 * Build a template lookup Map from a list of players, optionally including indie templates.
 */
export function buildTemplateMap(players: CampaignPlayer[], indieTemplates?: EmpireUnit[]): Map<string, EmpireUnit> {
  const map = new Map<string, EmpireUnit>();
  for (const player of players) {
    for (const unit of player.empire.units) {
      map.set(unit.id, unit);
    }
  }
  if (indieTemplates) {
    for (const tmpl of indieTemplates) {
      if (!map.has(tmpl.id)) map.set(tmpl.id, tmpl);
    }
  }
  return map;
}

/**
 * Compute effective ATK (= AS) for a troop unit in Ground Combat.
 * On-Planet (no fleetId) or Marines trait → full AS.
 * Non-On-Planet without Marines → ATK halved (ceil).
 * Crippled → additional halving (ceil).
 */
export function computeGroundATK(
  unit: CampaignUnit,
  template: EmpireUnit,
  unitState: CombatUnitState,
): number {
  if (unitState.destroyed || unitState.exitedScenario) return 0;
  const baseAS = template.as === '-' ? 0 : (template.as as number);
  const isOnPlanet = unit.fleetId === 'On-Planet';
  const hasMarines = template.traits.some(t => t.name === 'Marines');
  let atk = (isOnPlanet || hasMarines) ? baseAS : Math.ceil(baseAS * 0.5);
  const isCrippled = unit.crippled || !!unitState.crippledInScenario;
  if (isCrippled) atk = Math.ceil(atk * 0.5);
  return atk;
}

/**
 * Returns a condensed status key string for a unit, e.g. "C,OOS" or "" for no statuses.
 */
export function unitStatusKey(unit: CampaignUnit): string {
  const parts: string[] = [];
  if (unit.crippled)    parts.push('C');
  if (unit.outOfSupply) parts.push('OOS');
  if (unit.captured)    parts.push('CAP');
  if (unit.exhausted)   parts.push('EX');
  return parts.join(',');
}
