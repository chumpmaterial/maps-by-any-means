import type { StarType, PlanetType, SystemType, SystemTrait, HexCoordinate, System, JumpLane, GameMap } from '../types';
import { hexDistance, getHexesInRadius, getNeighbors, hexKey, hexToPixel } from './hexUtils';
import { calculateAttributes } from '../data/systemData';
import { generateRandomTeamColor } from './colorUtils';
import { starTypes, planetTypeNames, traitInfo } from '../data/systemData';

export interface GenerationResult {
  map: GameMap;
  log: string[];
}

// ── Dice Roll Helpers ──────────────────────────────────────────────

function rollD10(): number {
  return Math.floor(Math.random() * 10) + 1;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function formatModifier(mod: number): string {
  if (mod > 0) return `+${mod}`;
  if (mod < 0) return `${mod}`;
  return '+0';
}

// ── Star Type Table (d10, no modifier) ─────────────────────────────

function rollStarType(log: string[]): StarType {
  const roll = rollD10();
  let star: StarType;
  if (roll <= 1) star = 'blue';
  else if (roll <= 2) star = 'white';
  else if (roll <= 3) star = 'yellow';
  else if (roll <= 5) star = 'orange';
  else if (roll <= 9) star = 'red';
  else star = 'dwarf';

  const info = starTypes[star];
  log.push(`  Star Type: d10=${roll} → ${info.name} (${info.code})`);
  return star;
}

// ── Star → Importance Modifier ─────────────────────────────────────

function getStarImportanceModifier(star: StarType): number {
  switch (star) {
    case 'blue': return -2;
    case 'dwarf': return -2;
    case 'red': return -1;
    case 'orange': return 0;
    case 'white': return 1;
    case 'yellow': return 2;
  }
}

// ── System Importance Table (d10 + star modifier) ──────────────────

function rollSystemImportance(star: StarType, log: string[]): { planetType: PlanetType; systemType: SystemType } {
  const base = rollD10();
  const mod = getStarImportanceModifier(star);
  const roll = base + mod;

  let result: { planetType: PlanetType; systemType: SystemType };
  if (roll <= 1) result = { planetType: 'extreme', systemType: 'unimportant' };
  else if (roll <= 3) result = { planetType: 'dead', systemType: 'unimportant' };
  else if (roll <= 6) result = { planetType: 'barren', systemType: 'minor' };
  else if (roll <= 8) result = { planetType: 'adaptable', systemType: 'minor' };
  else result = { planetType: 'garden', systemType: 'major' };

  const starInfo = starTypes[star];
  log.push(`  System Importance: d10=${base} ${formatModifier(mod)} (${starInfo.name}) = ${roll} → ${planetTypeNames[result.planetType]} / ${result.systemType}`);
  return result;
}

// ── Planet → Trait Modifier ────────────────────────────────────────

function getPlanetTraitModifier(planet: PlanetType): number {
  switch (planet) {
    case 'extreme': return -2;
    case 'dead': return -1;
    case 'barren': return 0;
    case 'adaptable': return 1;
    case 'garden': return 2;
    case 'homeworld': return 2;
  }
}

// ── System Traits Table (d10 + planet modifier) ────────────────────

const traitTable: { maxRoll: number; trait: SystemTrait }[] = [
  { maxRoll: 4, trait: 'mineral_rich' },
  { maxRoll: 5, trait: 'ancient_ruins' },
  { maxRoll: 6, trait: 'strategic_resources' },
  { maxRoll: 7, trait: 'automated_defenses' },
  { maxRoll: 8, trait: 'spy_satellites' },
  { maxRoll: 9, trait: 'fair_biosphere' },
  { maxRoll: 10, trait: 'scattered_survivors' },
];

function rollTrait(planetType: PlanetType): { trait: SystemTrait | null; base: number; mod: number; total: number } {
  const base = rollD10();
  const mod = getPlanetTraitModifier(planetType);
  const total = base + mod;

  if (total <= 3) return { trait: null, base, mod, total };
  if (total >= 11) return { trait: 'lost_colony', base, mod, total };
  for (const entry of traitTable) {
    if (total <= entry.maxRoll) return { trait: entry.trait, base, mod, total };
  }
  return { trait: 'lost_colony', base, mod, total };
}

function rollTraits(planetType: PlanetType, log: string[]): SystemTrait[] {
  const r1 = rollTrait(planetType);
  const r2 = rollTrait(planetType);
  const planetName = planetTypeNames[planetType];

  const formatTraitResult = (r: typeof r1, num: number) => {
    const traitName = r.trait ? traitInfo[r.trait].name : 'None';
    log.push(`  Trait Roll ${num}: d10=${r.base} ${formatModifier(r.mod)} (${planetName}) = ${r.total} → ${traitName}`);
  };

  formatTraitResult(r1, 1);
  formatTraitResult(r2, 2);

  const traits: SystemTrait[] = [];
  if (r1.trait) traits.push(r1.trait);
  if (r2.trait && r2.trait !== r1.trait) {
    traits.push(r2.trait);
  } else if (r2.trait && r2.trait === r1.trait) {
    log.push(`    (Duplicate trait ignored)`);
  }

  return traits;
}

// ── Star → Lane Modifier ──────────────────────────────────────────

function getStarLaneModifier(star: StarType): number {
  switch (star) {
    case 'dwarf': return -2;
    case 'red': return -1;
    case 'orange': return 0;
    case 'yellow': return 0;
    case 'white': return 1;
    case 'blue': return 2;
  }
}

// ── Jump Lane Count Table (d10 + star modifier) ────────────────────

function rollLaneCount(star: StarType, log: string[]): number {
  const base = rollD10();
  const mod = getStarLaneModifier(star);
  const roll = base + mod;

  let count: number;
  if (roll <= 1) count = 1;
  else if (roll <= 3) count = 2;
  else if (roll <= 7) count = 3;
  else if (roll <= 9) count = 4;
  else if (roll <= 10) count = 5;
  else count = 6;

  const starInfo = starTypes[star];
  log.push(`  Jump Lanes: d10=${base} ${formatModifier(mod)} (${starInfo.name}) = ${roll} → ${count} lanes`);
  return count;
}

// ── Hex Geometry Helpers ───────────────────────────────────────────

const center: HexCoordinate = { q: 0, r: 0 };

function getHexesAtRing(ring: number): HexCoordinate[] {
  if (ring === 0) return [{ q: 0, r: 0 }];
  return getHexesInRadius(ring).filter(h => hexDistance(center, h) === ring);
}

function getAngle(hex: HexCoordinate): number {
  const px = hexToPixel(hex);
  return Math.atan2(px.y, px.x);
}

function sortClockwise(hexes: HexCoordinate[]): HexCoordinate[] {
  return [...hexes].sort((a, b) => getAngle(a) - getAngle(b));
}

function getHomeworldPositions(ringCount: number): Map<string, number> {
  // All homeworlds go in the outer (final) ring, spaced equidistantly
  const positions = new Map<string, number>();
  const outerHexes = getHexesAtRing(ringCount);

  for (let i = 0; i < ringCount; i++) {
    const targetAngle = (2 * Math.PI / ringCount) * i - Math.PI / 2; // Start from top

    let bestHex = outerHexes[0];
    let bestDiff = Infinity;

    for (const hex of outerHexes) {
      const angle = getAngle(hex);
      let diff = Math.abs(angle - targetAngle);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestHex = hex;
      }
    }

    positions.set(hexKey(bestHex), i + 1);
  }

  return positions;
}

// ── System Generation ──────────────────────────────────────────────

interface GeneratedSystem {
  system: System;
  desiredLaneCount: number;
}

function generateSystem(
  position: HexCoordinate,
  name: string,
  isHub: boolean,
  homeworldIndex: number | undefined,
  log: string[],
): GeneratedSystem {
  const id = generateId();
  const posStr = `(${position.q}, ${position.r})`;

  if (isHub) {
    log.push(`[Hub] ${posStr}`);
    log.push(`  Star Type: Yellow (G) [fixed]`);

    const starType: StarType = 'yellow';
    const { planetType, systemType } = rollSystemImportance(starType, log);
    const traits = rollTraits(planetType, log);
    const attributes = calculateAttributes(planetType, traits);
    log.push(`  Jump Lanes: 6 [fixed]`);

    return {
      system: { id, name, type: systemType, position, starType, planetType, traits, attributes },
      desiredLaneCount: 6,
    };
  }

  if (homeworldIndex !== undefined) {
    log.push(`[${name}] ${posStr}`);
    log.push(`  Star Type: Yellow (G) [homeworld]`);
    log.push(`  Planet Type: Homeworld [fixed]`);
    log.push(`  Traits: None [homeworld]`);

    const starType: StarType = 'yellow';
    const laneCount = rollLaneCount(starType, log);
    const teamColor = generateRandomTeamColor();

    return {
      system: {
        id, name, type: 'homeworld', position, starType,
        planetType: 'homeworld', traits: [], attributes: calculateAttributes('homeworld'),
        teamColor,
      },
      desiredLaneCount: laneCount,
    };
  }

  log.push(`[${name}] ${posStr}`);
  const starType = rollStarType(log);
  const { planetType, systemType } = rollSystemImportance(starType, log);
  const traits = rollTraits(planetType, log);
  const attributes = calculateAttributes(planetType, traits);
  const laneCount = rollLaneCount(starType, log);

  return {
    system: { id, name, type: systemType, position, starType, planetType, traits, attributes },
    desiredLaneCount: laneCount,
  };
}

// ── Jump Lane Placement ────────────────────────────────────────────

function placeLanes(
  systems: GeneratedSystem[],
  finalRing: number,
  log: string[],
): JumpLane[] {
  log.push('');
  log.push('=== Jump Lane Placement ===');

  const lanes: JumpLane[] = [];

  const posToSystem = new Map<string, GeneratedSystem>();
  for (const gs of systems) {
    posToSystem.set(hexKey(gs.system.position), gs);
  }

  const connectionCount = new Map<string, number>();
  for (const gs of systems) {
    connectionCount.set(gs.system.id, 0);
  }

  const existingLanes = new Set<string>();
  const lanePairKey = (a: string, b: string) => [a, b].sort().join('-');

  for (const gs of systems) {
    const systemRing = hexDistance(center, gs.system.position);
    let neededLanes = gs.desiredLaneCount;

    if (systemRing === finalRing) {
      neededLanes -= 1;
    }

    const currentConnections = connectionCount.get(gs.system.id) || 0;
    neededLanes -= currentConnections;

    if (neededLanes <= 0) {
      log.push(`${gs.system.name}: ${gs.desiredLaneCount} desired, ${currentConnections} existing${systemRing === finalRing ? ', -1 outer ring' : ''} → no new lanes needed`);
      continue;
    }

    const neighbors = getNeighbors(gs.system.position);
    const candidateNeighbors: GeneratedSystem[] = [];

    for (const neighborPos of neighbors) {
      const neighborGS = posToSystem.get(hexKey(neighborPos));
      if (!neighborGS) continue;
      const pairKey = lanePairKey(gs.system.id, neighborGS.system.id);
      if (existingLanes.has(pairKey)) continue;
      candidateNeighbors.push(neighborGS);
    }

    const lanesPlaced: string[] = [];

    for (let i = 0; i < neededLanes && candidateNeighbors.length > 0; i++) {
      let minConnections = Infinity;
      for (const candidate of candidateNeighbors) {
        const count = connectionCount.get(candidate.system.id) || 0;
        if (count < minConnections) minConnections = count;
      }

      const tied = candidateNeighbors.filter(
        c => (connectionCount.get(c.system.id) || 0) === minConnections
      );

      const chosen = tied[Math.floor(Math.random() * tied.length)];

      const lane: JumpLane = {
        id: generateId(),
        from: gs.system.id,
        to: chosen.system.id,
        type: 'unexplored',
      };
      lanes.push(lane);
      lanesPlaced.push(chosen.system.name);

      const pairKey = lanePairKey(gs.system.id, chosen.system.id);
      existingLanes.add(pairKey);
      connectionCount.set(gs.system.id, (connectionCount.get(gs.system.id) || 0) + 1);
      connectionCount.set(chosen.system.id, (connectionCount.get(chosen.system.id) || 0) + 1);

      const idx = candidateNeighbors.indexOf(chosen);
      candidateNeighbors.splice(idx, 1);
    }

    log.push(`${gs.system.name}: ${gs.desiredLaneCount} desired, ${currentConnections} existing${systemRing === finalRing ? ', -1 outer ring' : ''} → placed ${lanesPlaced.length} lane(s) to [${lanesPlaced.join(', ')}]`);
  }

  log.push(`Total lanes: ${lanes.length}`);
  return lanes;
}

// ── Main Entry Point ───────────────────────────────────────────────

const sizeNames: Record<number, string> = {
  2: 'Tiny', 3: 'Small', 4: 'Medium', 5: 'Large', 6: 'Huge',
};

export function generateMap(ringCount: number, mapName: string): GenerationResult {
  const log: string[] = [];
  const totalSystems = getHexesInRadius(ringCount).length;
  log.push(`=== Generating ${sizeNames[ringCount] || ''} Map ===`);
  log.push(`Rings: ${ringCount} | Systems: ${totalSystems} | Players: ${ringCount}`);
  log.push('');

  const homeworldPositions = getHomeworldPositions(ringCount);
  const generatedSystems: GeneratedSystem[] = [];
  let systemCounter = 1;
  let homeworldCounter = 1;

  // Generate Hub at center
  log.push('--- Hub ---');
  const hubGS = generateSystem({ q: 0, r: 0 }, 'Hub', true, undefined, log);
  generatedSystems.push(hubGS);

  // Generate ring by ring
  for (let ring = 1; ring <= ringCount; ring++) {
    log.push('');
    log.push(`--- Ring ${ring} (${getHexesAtRing(ring).length} systems) ---`);

    const ringHexes = sortClockwise(getHexesAtRing(ring));
    const startIdx = Math.floor(Math.random() * ringHexes.length);
    const ordered = [
      ...ringHexes.slice(startIdx),
      ...ringHexes.slice(0, startIdx),
    ];

    for (const hex of ordered) {
      const key = hexKey(hex);
      const hwIndex = homeworldPositions.get(key);

      let name: string;
      if (hwIndex !== undefined) {
        name = `Homeworld-${homeworldCounter++}`;
      } else {
        name = `System-${systemCounter++}`;
      }

      const gs = generateSystem(hex, name, false, hwIndex, log);
      generatedSystems.push(gs);
    }
  }

  // Place jump lanes
  const jumpLanes = placeLanes(generatedSystems, ringCount, log);

  const map: GameMap = {
    id: generateId(),
    name: mapName,
    systems: generatedSystems.map(gs => gs.system),
    jumpLanes,
  };

  return { map, log };
}
