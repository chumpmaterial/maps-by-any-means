import type { CampaignFleet, CampaignUnit, CampaignPlayer, EmpireUnit, GameMap, UnitCategory } from '../types';

// ---------------------------------------------------------------------------
// Template resolution — handles own + stolen + allied unit designs
// ---------------------------------------------------------------------------

/**
 * Resolve a unit template by ID for a player.
 * Checks in order: own empire units → stolen unit designs → other players' empires (allied).
 */
export function resolveUnitTemplate(
  player: CampaignPlayer,
  templateId: string,
  allPlayers?: CampaignPlayer[],
): EmpireUnit | undefined {
  return (
    player.empire.units.find(t => t.id === templateId)
    ?? player.stolenUnits?.find(s => s.unit.id === templateId)?.unit
    ?? allPlayers?.flatMap(p => p.id !== player.id ? p.empire.units : []).find(t => t.id === templateId)
  );
}

// ---------------------------------------------------------------------------
// Fleet badge computation
// ---------------------------------------------------------------------------

export interface FleetBadges {
  isFast: boolean;
  isCivilian: boolean;
  isScout: boolean;
}

/**
 * Compute display badges for a named fleet.
 * Only independent units (not carried by another unit in this fleet) count.
 */
export function computeFleetBadges(
  _fleet: CampaignFleet,
  units: CampaignUnit[],
  player: CampaignPlayer,
  allPlayers?: CampaignPlayer[],
): FleetBadges {
  const fleetUnitIds = new Set(units.map(u => u.id));

  // Independent = not carried by another unit in this fleet
  const independentUnits = units.filter(u => !u.carriedById || !fleetUnitIds.has(u.carriedById));
  const independentTemplates = independentUnits
    .map(u => resolveUnitTemplate(player, u.unitTemplateId, allPlayers))
    .filter((t): t is EmpireUnit => !!t);

  const shipTemplates = independentTemplates.filter(t => t.category === 'Ships');
  const isFast =
    shipTemplates.length > 0 &&
    shipTemplates.every(t => t.traits.some(tr => tr.name === 'Fast'));

  const isCivilian =
    independentTemplates.length > 0 &&
    independentTemplates.every(t => t.category === 'Civilian');

  const isScout = independentTemplates.some(t => t.traits.some(tr => tr.name === 'Scout'));

  return { isFast, isCivilian, isScout };
}

// ---------------------------------------------------------------------------
// Movement point computation
// ---------------------------------------------------------------------------

export interface MovementPoints {
  minorLimit: number;
  majorLimit: number;
}

/**
 * Compute how many jump lanes a fleet can traverse.
 * Minor lanes count as 1; major-only paths count against majorLimit.
 */
export function computeMovementPoints(
  fleet: CampaignFleet,
  units: CampaignUnit[],
  player: CampaignPlayer,
  allPlayers?: CampaignPlayer[],
): MovementPoints {
  const { isFast } = computeFleetBadges(fleet, units, player, allPlayers);
  const hasFastDrive = player.empire.advantages.includes('Fast Drive Systems');
  const bonus = (isFast ? 1 : 0) + (hasFastDrive ? 1 : 0);
  return { minorLimit: 1 + bonus, majorLimit: 3 + bonus };
}

// ---------------------------------------------------------------------------
// Carrier capacity
// ---------------------------------------------------------------------------

export interface CarryCapacityResult {
  /** Remaining slot capacity. Negative if over capacity. */
  remaining: number;
  allowedCategories: UnitCategory[];
}

/**
 * Returns how many more dependent units a carrier unit can accept
 * and which categories are allowed.
 *
 * OWP (hullCode 'OWP') units cost 2 slots each; all others cost 1.
 * OWPs can only be carried by Convoys and Supply-trait ships.
 * `remaining` may be negative if currently over capacity.
 */
export function getCarryCapacity(
  _carrier: CampaignUnit,
  carrierTemplate: EmpireUnit,
  currentCarried: Array<{ unit: CampaignUnit; template: EmpireUnit }>,
): CarryCapacityResult {
  // OWPs cost 2 slots, all other units cost 1
  const slotsUsed = currentCarried.reduce(
    (sum, { template }) => sum + (template.hullCode === 'OWP' ? 2 : 1),
    0,
  );

  // Convoy: 6 slots, any category (OWPs allowed, cost 2 slots)
  if (carrierTemplate.category === 'Civilian' && carrierTemplate.name === 'Convoy') {
    return { remaining: 6 - slotsUsed, allowedCategories: ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'] };
  }

  // Check trait-based carriers
  for (const trait of carrierTemplate.traits) {
    const factor = trait.factor ?? 1;
    switch (trait.name) {
      case 'Carrier':
        return { remaining: factor - slotsUsed, allowedCategories: ['Fighters'] };
      case 'Tender':
        return { remaining: factor - slotsUsed, allowedCategories: ['Ships'] };
      case 'Assault':
        return { remaining: factor - slotsUsed, allowedCategories: ['Troops'] };
      case 'Supply':
        // Supply ships can carry OWPs (Bases), cost 2 slots each
        return { remaining: factor - slotsUsed, allowedCategories: ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'] };
      case 'Hospital':
        return { remaining: factor - slotsUsed, allowedCategories: ['Troops'] };
    }
  }

  return { remaining: 0, allowedCategories: [] };
}

// ---------------------------------------------------------------------------
// BFS pathfinding
// ---------------------------------------------------------------------------

/**
 * Returns all shortest valid paths from srcSystemId to dstSystemId.
 * Each path is an ordered list of systemIds: [src, ..., dst].
 *
 * Rules:
 * - Cannot traverse 'unexplored' lanes (impassable).
 * - If isCivilian, cannot traverse 'restricted' lanes.
 * - Path length (number of lanes = path.length - 1) must not exceed:
 *     - majorLimit if ALL lanes on the path are 'major'
 *     - minorLimit otherwise
 * - BFS terminates at majorLimit depth.
 * - Returns all paths of minimum length; empty array = no valid path.
 */
export function findFleetPaths(
  srcSystemId: string,
  dstSystemId: string,
  map: GameMap,
  movementPoints: MovementPoints,
  fleetFlags: { isCivilian: boolean },
): string[][] {
  if (srcSystemId === dstSystemId) return [[srcSystemId]];

  const { minorLimit, majorLimit } = movementPoints;

  // Adjacency list: systemId → [{ neighborId, laneType }]
  type Edge = { neighborId: string; laneType: string };
  const adj = new Map<string, Edge[]>();
  for (const lane of map.jumpLanes) {
    if (lane.type === 'unexplored') continue;
    if (fleetFlags.isCivilian && lane.type === 'restricted') continue;

    if (!adj.has(lane.from)) adj.set(lane.from, []);
    if (!adj.has(lane.to)) adj.set(lane.to, []);
    adj.get(lane.from)!.push({ neighborId: lane.to, laneType: lane.type });
    adj.get(lane.to)!.push({ neighborId: lane.from, laneType: lane.type });
  }

  // BFS tracking: state = { systemId, path, allMajor }
  interface State {
    systemId: string;
    path: string[];
    allMajor: boolean;
  }

  const queue: State[] = [{ systemId: srcSystemId, path: [srcSystemId], allMajor: true }];
  const results: string[][] = [];
  let foundDepth: number | null = null;

  // visited[systemId] = minimum depth at which we first visited it
  const visited = new Map<string, number>();
  visited.set(srcSystemId, 0);

  while (queue.length > 0) {
    const { systemId, path, allMajor } = queue.shift()!;
    const depth = path.length - 1;

    // Prune: already found a result at this depth — only continue at same depth
    if (foundDepth !== null && depth > foundDepth) break;

    // Prune: exceeded major limit (the maximum possible)
    if (depth >= majorLimit) continue;

    const edges = adj.get(systemId) ?? [];
    for (const { neighborId, laneType } of edges) {
      if (path.includes(neighborId)) continue; // no cycles

      const newDepth = depth + 1;
      const newAllMajor = allMajor && laneType === 'major';

      // Check movement point limits
      const limit = newAllMajor ? majorLimit : minorLimit;
      if (newDepth > limit) continue;

      const newPath = [...path, neighborId];

      if (neighborId === dstSystemId) {
        foundDepth = newDepth;
        results.push(newPath);
        continue;
      }

      // Allow visiting a node again only if at same or better depth
      const prevVisit = visited.get(neighborId);
      if (prevVisit === undefined || newDepth <= prevVisit) {
        visited.set(neighborId, newDepth);
        queue.push({ systemId: neighborId, path: newPath, allMajor: newAllMajor });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// System fleet category membership check
// ---------------------------------------------------------------------------

/**
 * Returns true if a unit of the given template category+name can join the named system fleet.
 */
export function canJoinSystemFleet(
  fleetName: string,
  category: UnitCategory,
  unitName: string,
): boolean {
  switch (fleetName) {
    case 'On-Planet':
      return category === 'Troops';
    case 'Bases':
      return category === 'Bases' || category === 'Fighters' || (category === 'Civilian' && (unitName === 'Shipyard' || unitName === 'Supply Depot'));
    case 'Untasked Ships':
      return category === 'Ships' || category === 'Fighters';
    case 'Untasked Civilians':
      return category === 'Civilian' && unitName !== 'Shipyard' && unitName !== 'Supply Depot';
    default:
      return true; // Named user fleets accept any category
  }
}
