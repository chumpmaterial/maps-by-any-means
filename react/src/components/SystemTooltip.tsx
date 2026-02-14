import type { System, SystemType, StarType, PlanetType } from '../types';

interface SystemTooltipProps {
  system: System;
  x: number;
  y: number;
}

const systemTypeLabels: Record<SystemType, string> = {
  homeworld: 'Homeworld',
  major: 'Major System',
  minor: 'Minor System',
  unimportant: 'Unimportant System',
};

const starTypeLabels: Record<StarType, string> = {
  blue: 'Blue Giant (A)',
  white: 'White (F)',
  yellow: 'Yellow (G)',
  orange: 'Orange (K)',
  red: 'Red Star (M)',
  dwarf: 'Dwarf Star (D)',
};

const planetTypeLabels: Record<PlanetType, string> = {
  extreme: 'Extreme',
  dead: 'Dead',
  barren: 'Barren',
  adaptable: 'Adaptable',
  garden: 'Garden',
  homeworld: 'Homeworld',
};

export function SystemTooltip({ system, x, y }: SystemTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-50 max-w-56 rounded bg-gray-900 px-3 py-2 text-xs text-gray-100 shadow-lg"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-semibold text-white">
        {system.name || 'Unnamed'}
      </div>
      <div className="mt-1 text-gray-300">
        {systemTypeLabels[system.type]}
      </div>
      {system.starType && (
        <div className="text-gray-400">
          Star: {starTypeLabels[system.starType]}
        </div>
      )}
      {system.planetType && (
        <div className="text-gray-400">
          Planet: {planetTypeLabels[system.planetType]}
        </div>
      )}
      <div className="mt-1 text-gray-500">
        Hex ({system.position.q}, {system.position.r})
      </div>
    </div>
  );
}
