import type { StarType, PlanetType, SystemType, SystemTrait, SystemAttributes } from '../types';

/**
 * Star type display information
 */
export const starTypes: Record<StarType, { name: string; code: string }> = {
  blue: { name: 'Blue Giant', code: 'A' },
  white: { name: 'White', code: 'F' },
  yellow: { name: 'Yellow', code: 'G' },
  orange: { name: 'Orange', code: 'K' },
  red: { name: 'Red Star', code: 'M' },
  dwarf: { name: 'Dwarf Star', code: 'D' },
};

/**
 * Planet type to system importance mapping
 * Per VBAM rules, importance is always derived from planet type.
 * Homeworld planet type maps to the custom Homeworld importance level.
 */
export const planetTypeImportance: Record<PlanetType, SystemType> = {
  extreme: 'unimportant',
  dead: 'unimportant',
  barren: 'minor',
  adaptable: 'minor',
  garden: 'major',
  homeworld: 'homeworld',
};

/**
 * Planet type display names
 */
export const planetTypeNames: Record<PlanetType, string> = {
  extreme: 'Extreme',
  dead: 'Dead',
  barren: 'Barren',
  adaptable: 'Adaptable',
  garden: 'Garden',
  homeworld: 'Homeworld',
};

/**
 * Base attributes by planet type (from VBAM rules)
 */
export const baseAttributes: Record<PlanetType, SystemAttributes> = {
  extreme: {
    capacity: 2,
    raw: 1,
    population: 1,
    morale: 1,
    intel: 0,
    fortification: 0,
  },
  dead: {
    capacity: 4,
    raw: 1,
    population: 2,
    morale: 2,
    intel: 0,
    fortification: 0,
  },
  barren: {
    capacity: 6,
    raw: 2,
    population: 3,
    morale: 2,
    intel: 1,
    fortification: 0,
  },
  adaptable: {
    capacity: 8,
    raw: 2,
    population: 4,
    morale: 3,
    intel: 2,
    fortification: 1,
  },
  garden: {
    capacity: 10,
    raw: 3,
    population: 6,
    morale: 5,
    intel: 4,
    fortification: 2,
  },
  homeworld: {
    capacity: 12,
    raw: 5,
    population: 10,
    morale: 8,
    intel: 6,
    fortification: 4,
  },
};

/**
 * System trait display info and attribute modifiers
 */
export const traitInfo: Record<SystemTrait, { name: string; modifiers: Partial<SystemAttributes> }> = {
  mineral_rich: {
    name: 'Mineral Rich',
    modifiers: { raw: 1 },
  },
  ancient_ruins: {
    name: 'Ancient Ruins',
    modifiers: { raw: 1, morale: 1 },
  },
  strategic_resources: {
    name: 'Strategic Resources',
    modifiers: { raw: 2 },
  },
  automated_defenses: {
    name: 'Automated Defenses',
    modifiers: { fortification: 1 },
  },
  spy_satellites: {
    name: 'Spy Satellites',
    modifiers: { intel: 1 },
  },
  fair_biosphere: {
    name: 'Fair Biosphere',
    modifiers: { capacity: 2, morale: 1 },
  },
  scattered_survivors: {
    name: 'Scattered Survivors',
    modifiers: { population: 1 },
  },
  lost_colony: {
    name: 'Lost Colony',
    modifiers: { population: 2, morale: 1 },
  },
};

/**
 * All available system traits
 */
export const allTraits: SystemTrait[] = [
  'mineral_rich',
  'ancient_ruins',
  'strategic_resources',
  'automated_defenses',
  'spy_satellites',
  'fair_biosphere',
  'scattered_survivors',
  'lost_colony',
];

/**
 * Calculate attributes from planet type + traits
 */
export function calculateAttributes(planetType: PlanetType, traits: SystemTrait[] = []): SystemAttributes {
  const base = { ...baseAttributes[planetType] };

  for (const trait of traits) {
    const info = traitInfo[trait];
    if (info) {
      for (const [key, value] of Object.entries(info.modifiers)) {
        const attrKey = key as keyof SystemAttributes;
        base[attrKey] = (base[attrKey] || 0) + (value || 0);
      }
    }
  }

  return base;
}

/**
 * Check if attributes have been manually overridden from calculated values
 */
export function hasCustomAttributes(
  current: SystemAttributes | undefined,
  planetType: PlanetType | undefined,
  traits: SystemTrait[] = []
): boolean {
  if (!current || !planetType) return false;

  const calculated = calculateAttributes(planetType, traits);

  return (
    current.capacity !== calculated.capacity ||
    current.raw !== calculated.raw ||
    current.population !== calculated.population ||
    current.morale !== calculated.morale ||
    current.intel !== calculated.intel ||
    current.fortification !== calculated.fortification
  );
}
