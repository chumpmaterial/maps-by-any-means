import type { GameMap, CampaignPlayer, SystemCampaignStatus, DiplomacyLevel, CampaignUnit } from '../types';

// ---------------------------------------------------------------------------
// Diplomacy helpers (authoritative copy — imported by CampaignMapView and
// CombatScenarioView instead of defining their own copies)
// ---------------------------------------------------------------------------

export function diplomacyKey(id1: string, id2: string): string {
  return [id1, id2].sort().join(':');
}

// ---------------------------------------------------------------------------
// Blockade helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the system has any blockade status (used for economic income
 * calculation where any blockader halves income, regardless of diplomacy).
 */
export function isEffectivelyBlockaded(status: SystemCampaignStatus): boolean {
  if (status.blockadedBy && status.blockadedBy.length > 0) return true;
  return status.blockaded ?? false;
}

/**
 * Returns true if the system is effectively blockaded against player P.
 *
 * New saves use blockadedBy: a system is blockaded against P when any
 * blockading player is at War or Hostilities with P.
 * Old saves with blockaded=true (no blockadedBy) fall through to the legacy flag.
 */
export function isBlockadedAgainst(
  status: SystemCampaignStatus,
  playerId: string,
  diplomacyRelations: Record<string, DiplomacyLevel>,
): boolean {
  if (status.blockadedBy && status.blockadedBy.length > 0) {
    return status.blockadedBy.some(blockerId => {
      const rel = diplomacyRelations[diplomacyKey(playerId, blockerId)] ?? 'Unmet';
      return rel === 'War' || rel === 'Hostilities';
    });
  }
  return status.blockaded ?? false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildSupplyAdj(map: GameMap): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const lane of map.jumpLanes) {
    if (lane.type !== 'major' && lane.type !== 'minor') continue;
    if (!adj.has(lane.from)) adj.set(lane.from, []);
    if (!adj.has(lane.to)) adj.set(lane.to, []);
    adj.get(lane.from)!.push(lane.to);
    adj.get(lane.to)!.push(lane.from);
  }
  return adj;
}

/**
 * Returns sets of systemIds where enemy or friendly fleets are present.
 * Only named fleets (CampaignFleet objects) count — system-fleet units do not
 * represent a mobile military force that can contest a transit lane.
 */
function computeSystemPresence(
  forPlayer: CampaignPlayer,
  allPlayers: CampaignPlayer[],
  diplomacyRelations: Record<string, DiplomacyLevel>,
): { enemySystems: Set<string>; friendlySystems: Set<string> } {
  const enemySystems = new Set<string>();
  const friendlySystems = new Set<string>();
  for (const player of allPlayers) {
    if (player.id === forPlayer.id) {
      for (const fleet of player.fleets ?? []) friendlySystems.add(fleet.systemId);
      continue;
    }
    const rel = diplomacyRelations[diplomacyKey(forPlayer.id, player.id)] ?? 'Unmet';
    if (rel === 'War' || rel === 'Hostilities') {
      for (const fleet of player.fleets ?? []) enemySystems.add(fleet.systemId);
    } else if (rel === 'MutualDefense' || rel === 'Alliance') {
      for (const fleet of player.fleets ?? []) friendlySystems.add(fleet.systemId);
    }
  }
  return { enemySystems, friendlySystems };
}

/**
 * BFS to check if `fromSystemId` can trace a valid supply route to any
 * system in `supplySources` within the allowed number of jumps.
 *
 * Rules:
 * - Only 'major' and 'minor' lanes
 * - Max depth: 3 (or 4 with Deep Range Logistics empire advantage)
 * - Cannot pass through a system blockaded against this player
 * - Cannot pass through a system with enemy fleets unless friendly fleets are also present
 * - If fromSystemId is itself in supplySources, returns true immediately
 *   (handles the case of a fleet at a blockaded supply source)
 */
export function canTraceSupplyRoute(
  fromSystemId: string,
  forPlayer: CampaignPlayer,
  allPlayers: CampaignPlayer[],
  supplySources: Set<string>,
  systemStatuses: Record<string, SystemCampaignStatus>,
  map: GameMap,
  diplomacyRelations: Record<string, DiplomacyLevel>,
  maxJumps?: number,
): boolean {
  const limit =
    maxJumps !== undefined
      ? maxJumps
      : forPlayer.empire?.advantages.includes('Deep Range Logistics')
        ? 4
        : 3;

  // Fleet at its own supply source is always in supply
  if (supplySources.has(fromSystemId)) return true;

  // Fleet at a blockaded system (and not a supply source) is cut off
  if (isBlockadedAgainst(systemStatuses[fromSystemId] ?? {}, forPlayer.id, diplomacyRelations)) return false;

  const adj = buildSupplyAdj(map);
  const { enemySystems, friendlySystems } = computeSystemPresence(
    forPlayer, allPlayers, diplomacyRelations,
  );

  const visited = new Set<string>([fromSystemId]);
  const queue: Array<{ sysId: string; depth: number }> = [
    { sysId: fromSystemId, depth: 0 },
  ];

  while (queue.length > 0) {
    const { sysId, depth } = queue.shift()!;
    if (depth >= limit) continue;

    for (const neighborId of (adj.get(sysId) ?? [])) {
      if (visited.has(neighborId)) continue;

      // Cannot pass through systems blockaded against this player
      if (isBlockadedAgainst(systemStatuses[neighborId] ?? {}, forPlayer.id, diplomacyRelations)) {
        continue;
      }

      // Cannot pass through systems with enemy fleets unless friendly fleets also present
      if (enemySystems.has(neighborId) && !friendlySystems.has(neighborId)) continue;

      if (supplySources.has(neighborId)) return true;

      visited.add(neighborId);
      queue.push({ sysId: neighborId, depth: depth + 1 });
    }
  }

  return false;
}

/**
 * Computes the set of systemIds that are Supply Sources for a given player.
 *
 * Pass 1 — Core Systems:
 *   Friendly-owned (player or MutualDefense/Alliance partner), P >= 5, not In Opposition.
 *
 * Pass 2 — Supply Depot cascade (iterate to fixed point):
 *   Systems with a Supply Depot unit that can trace a route to an existing Supply Source
 *   are added as sources themselves. Repeats until no new systems are added.
 */
export function computeSupplySources(
  forPlayer: CampaignPlayer,
  allPlayers: CampaignPlayer[],
  systemStatuses: Record<string, SystemCampaignStatus>,
  map: GameMap,
  diplomacyRelations: Record<string, DiplomacyLevel>,
  systemOwnership: Record<string, string>,
): Set<string> {
  const sources = new Set<string>();

  // Friendly owner IDs: player + MutualDefense/Alliance partners
  const friendlyOwnerIds = new Set<string>([forPlayer.id]);
  for (const p of allPlayers) {
    if (p.id === forPlayer.id) continue;
    const rel = diplomacyRelations[diplomacyKey(forPlayer.id, p.id)] ?? 'Unmet';
    if (rel === 'MutualDefense' || rel === 'Alliance') friendlyOwnerIds.add(p.id);
  }

  // Pass 1: Core Systems
  for (const sys of map.systems) {
    const ownerId = systemOwnership[sys.id];
    if (!ownerId || !friendlyOwnerIds.has(ownerId)) continue;
    if ((sys.attributes?.population ?? 0) < 5) continue;
    if (systemStatuses[sys.id]?.inOpposition) continue;
    sources.add(sys.id);
  }

  // Pass 2: Supply Depot cascade
  // Find systemIds where forPlayer has a Supply Depot unit
  const depotSystemIds = new Set<string>();
  for (const unit of forPlayer.units) {
    if (unit.unitTemplateId !== 'default-supply-depot') continue;
    if (unit.systemId) {
      depotSystemIds.add(unit.systemId);
    } else if (unit.fleetId) {
      const fleet = (forPlayer.fleets ?? []).find(f => f.id === unit.fleetId);
      if (fleet) depotSystemIds.add(fleet.systemId);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const depotSysId of depotSystemIds) {
      if (sources.has(depotSysId)) continue;
      if (canTraceSupplyRoute(depotSysId, forPlayer, allPlayers, sources, systemStatuses, map, diplomacyRelations)) {
        sources.add(depotSysId);
        changed = true;
      }
    }
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface SupplyFleetResult {
  /** Fleet ID (named fleet ID or `sys-<systemId>` for garrison groups) */
  fleetId: string;
  fleetName: string;
  systemId: string;
  systemName: string;
  /** Population stat of the system — only populated for friendly-owned systems */
  systemPopulation?: number;
  inSupply: boolean;
  units: CampaignUnit[];
}

export interface SupplyPlayerResult {
  playerId: string;
  inSupplyFleets: SupplyFleetResult[];
  outOfSupplyFleets: SupplyFleetResult[];
}

export interface SupplyResult {
  byPlayer: SupplyPlayerResult[];
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Computes the supply status of every fleet/garrison for every player.
 *
 * Named fleets are checked individually. System-fleet units (no fleetId) are
 * grouped per system into a single "Garrison" entry.
 */
export function computeSupplyResults(
  players: CampaignPlayer[],
  map: GameMap,
  systemStatuses: Record<string, SystemCampaignStatus>,
  systemOwnership: Record<string, string>,
  diplomacyRelations: Record<string, DiplomacyLevel>,
): SupplyResult {
  const byPlayer: SupplyPlayerResult[] = [];

  for (const player of players) {
    const supplySources = computeSupplySources(
      player, players, systemStatuses, map, diplomacyRelations, systemOwnership,
    );

    // Friendly-owned system IDs for showing P stat
    const friendlyOwnerIds = new Set<string>([player.id]);
    for (const p of players) {
      if (p.id === player.id) continue;
      const rel = diplomacyRelations[diplomacyKey(player.id, p.id)] ?? 'Unmet';
      if (rel === 'MutualDefense' || rel === 'Alliance') friendlyOwnerIds.add(p.id);
    }
    const friendlySystemIds = new Set<string>(
      Object.entries(systemOwnership)
        .filter(([, ownerId]) => friendlyOwnerIds.has(ownerId))
        .map(([sysId]) => sysId),
    );

    const inSupplyFleets: SupplyFleetResult[] = [];
    const outOfSupplyFleets: SupplyFleetResult[] = [];

    // Named fleets
    for (const fleet of player.fleets ?? []) {
      const units = player.units.filter(u => u.fleetId === fleet.id);
      const sys = map.systems.find(s => s.id === fleet.systemId);
      const inSupply = canTraceSupplyRoute(
        fleet.systemId, player, players, supplySources, systemStatuses, map, diplomacyRelations,
      );
      const result: SupplyFleetResult = {
        fleetId: fleet.id,
        fleetName: fleet.name,
        systemId: fleet.systemId,
        systemName: sys?.name || fleet.systemId,
        systemPopulation: friendlySystemIds.has(fleet.systemId) ? sys?.attributes?.population : undefined,
        inSupply,
        units,
      };
      (inSupply ? inSupplyFleets : outOfSupplyFleets).push(result);
    }

    // System-fleet units (no fleetId), grouped by systemId
    const garrisonBySystem = new Map<string, CampaignUnit[]>();
    for (const unit of player.units) {
      if (unit.fleetId || !unit.systemId) continue;
      if (!garrisonBySystem.has(unit.systemId)) garrisonBySystem.set(unit.systemId, []);
      garrisonBySystem.get(unit.systemId)!.push(unit);
    }
    for (const [sysId, units] of garrisonBySystem) {
      const sys = map.systems.find(s => s.id === sysId);
      const inSupply = canTraceSupplyRoute(
        sysId, player, players, supplySources, systemStatuses, map, diplomacyRelations,
      );
      const result: SupplyFleetResult = {
        fleetId: `sys-${sysId}`,
        fleetName: `${sys?.name || sysId} (Garrison)`,
        systemId: sysId,
        systemName: sys?.name || sysId,
        systemPopulation: friendlySystemIds.has(sysId) ? sys?.attributes?.population : undefined,
        inSupply,
        units,
      };
      (inSupply ? inSupplyFleets : outOfSupplyFleets).push(result);
    }

    byPlayer.push({ playerId: player.id, inSupplyFleets, outOfSupplyFleets });
  }

  return { byPlayer };
}
