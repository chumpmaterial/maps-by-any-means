// Core VBAM Map Types

/**
 * Axial hex coordinates (q, r)
 * Using flat-top orientation to match VBAM PDF maps
 */
export interface HexCoordinate {
  q: number;
  r: number;
}

/**
 * System classification types from VBAM rules (System Importance)
 */
export type SystemType = 'homeworld' | 'major' | 'minor' | 'unimportant';

/**
 * Star types with their classification codes
 */
export type StarType = 'blue' | 'white' | 'yellow' | 'orange' | 'red' | 'dwarf';

/**
 * Planet types determine base attributes and system importance
 */
export type PlanetType = 'extreme' | 'dead' | 'barren' | 'adaptable' | 'garden' | 'homeworld';

/**
 * System traits that modify base attributes
 */
export type SystemTrait =
  | 'mineral_rich'        // +1 RAW
  | 'ancient_ruins'       // +1 RAW, +1 Morale
  | 'strategic_resources' // +2 RAW
  | 'automated_defenses'  // +1 Fortification
  | 'spy_satellites'      // +1 Intel
  | 'fair_biosphere'      // +2 Capacity, +1 Morale
  | 'scattered_survivors' // +1 Population
  | 'lost_colony';        // +2 Population, +1 Morale

/**
 * System attributes (current values, can differ from base due to traits/events)
 */
export interface SystemAttributes {
  capacity: number;      // 2-12 base
  raw: number;           // 1-5 base (Resources And Wealth)
  population: number;    // 1-10 base
  morale: number;        // 1-8 base
  intel: number;         // 0-6 base
  fortification: number; // 0-4 base
}

/**
 * A star system on the map
 */
export interface System {
  id: string;
  name: string;
  type: SystemType;
  position: HexCoordinate;
  teamColor?: string;  // Hex color for homeworlds (e.g., '#ff5500')
  owner?: string;      // System ID of owning homeworld (for non-homeworlds)

  // Optional fields for detailed system stats
  starType?: StarType;
  planetType?: PlanetType;
  traits?: SystemTrait[];
  attributes?: SystemAttributes;  // Current values (may differ from base due to traits/events)
}

/**
 * Jump lane types - determines visual style
 * - major: thick solid line (established trade routes)
 * - minor: thin solid line (secondary routes)
 * - restricted: dashed line (limited access)
 * - unexplored: light gray line (unknown territory) - default for standard play
 */
export type LaneType = 'major' | 'minor' | 'restricted' | 'unexplored';

/**
 * A jump lane connecting two systems
 */
export interface JumpLane {
  id: string;
  from: string; // system id
  to: string;   // system id
  type: LaneType; // default 'unexplored' for standard play
}

/**
 * A complete game map
 */
export interface GameMap {
  id: string;
  name: string;
  systems: System[];
  jumpLanes: JumpLane[];
  useTeamColors?: boolean;  // Global toggle for team color display
}

/**
 * Editor tool modes
 */
export type EditorTool = 'select' | 'addSystem' | 'removeSystem' | 'addLane' | 'removeLane';

/**
 * Viewport state for pan/zoom
 */
export interface ViewportState {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/**
 * A single name entry in a name list
 */
export interface NameEntry {
  name: string;
  enabled: boolean;
}

/**
 * A collection of names from a single source (file or default)
 */
export interface NameList {
  id: string;
  name: string;
  enabled: boolean;
  names: NameEntry[];
}

/**
 * Application-level settings for name list management
 */
export interface NameListSettings {
  allowDuplicates: boolean;
  lists: NameList[];
}
