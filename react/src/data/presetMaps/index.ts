import type { GameMap } from '../../types';

// Import blank maps
import blankTiny from './blanks/tiny.json';
import blankSmall from './blanks/small.json';
import blankMedium from './blanks/medium.json';
import blankLarge from './blanks/large.json';
import blankHuge from './blanks/huge.json';

// Import standard maps
import standardTiny from './standard/tiny.json';
import standardSmall from './standard/small.json';
import standardMedium from './standard/medium.json';
import standardLarge from './standard/large.json';
import standardHuge from './standard/huge.json';

// Import scenario maps
import oldEnemiesTiny from './scenarios/old_enemies_tiny.json';
import slayingTheGiantSmall from './scenarios/slaying_the_giant_small.json';

export type PresetMapCategory = 'blanks' | 'standard' | 'scenarios';

// Export all preset maps organized by category
export const presetMaps: Record<PresetMapCategory, GameMap[]> = {
  blanks: [
    blankTiny as GameMap,
    blankSmall as GameMap,
    blankMedium as GameMap,
    blankLarge as GameMap,
    blankHuge as GameMap,
  ],
  standard: [
    standardTiny as GameMap,
    standardSmall as GameMap,
    standardMedium as GameMap,
    standardLarge as GameMap,
    standardHuge as GameMap,
  ],
  scenarios: [
    oldEnemiesTiny as GameMap,
    slayingTheGiantSmall as GameMap,
  ],
};

// Helper to get a preset map by ID
export function getPresetMapById(id: string): GameMap | undefined {
  for (const category of Object.values(presetMaps)) {
    const map = category.find(m => m.id === id);
    if (map) return map;
  }
  return undefined;
}
