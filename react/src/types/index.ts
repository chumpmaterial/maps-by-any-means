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

/**
 * Unit categories for empire building
 */
export type UnitCategory = 'Ships' | 'Fighters' | 'Bases' | 'Troops' | 'Civilian';

/**
 * A trait on a unit, optionally with a factor level
 */
export interface UnitTrait {
  name: string;
  factor?: number;  // only for factor traits (e.g. Carrier 2)
}

/**
 * Tech level type: 'E'=Early Years, 1–5=TL1–TL5, 'A'=Ancient
 * Players use TL1–5; Independents use E/1–5; Harbingers use 'A' only
 */
export type TechLevelType = 'E' | 1 | 2 | 3 | 4 | 5 | 'A';

/**
 * A unit in an empire's order of battle
 */
export interface EmpireUnit {
  id: string;
  name: string;
  category: UnitCategory;
  hullCode: string;     // category-specific code or "N/A"
  cost: number;
  isd: string;          // number as string, or "N/A"
  dv: number;
  as: number | '-';
  af: number | '-';
  cr: number | '-';
  cc: number | '-';
  traits: UnitTrait[];
  techLevel?: TechLevelType;  // undefined → treated as TL1 for player units, 'E' for independents
  parentUnitId?: string;      // ID of predecessor unit in upgrade chain
  isSuperseded?: boolean;     // true when a newer TL version exists (hidden in Add Units by default)
  researched?: boolean;       // true when available for purchase; set at campaign start or via tech advancement
}

/**
 * A custom empire with traits and units
 */
export interface Empire {
  id: string;
  name: string;
  advantages: [string, string];  // exactly 2 advantage traits
  disadvantage: string;          // exactly 1 disadvantage trait
  units: EmpireUnit[];
  recommendedEP?: number;
  recommendedYear?: number;
  recommendedForces?: Array<{ name: string; count: number }>;
}

/**
 * Optional campaign rule flags
 */
export interface CampaignRules {
  independentSystems: boolean;
  strangeNewWorlds: boolean;
  newHorizons: boolean;
  unexploredFrontiers: boolean;
  hostileGalaxy: boolean;
  ravagerFleets: boolean;
  harbingerThreats: boolean;
  wartimeEconomies: boolean;
  deepSpaceEncounters: boolean;
  perilousExploration: boolean;
  persistentRaiders: boolean;
  neutralFirstContact: boolean;
  grandFleets: boolean;
  ramming: boolean;
  extendedConstructionTimes: boolean;
  commandShips: boolean;
  prototyping: boolean;
  historicalTechAdvancement: boolean;
  improvementConstructionTimes: boolean;
  randomEvents: boolean;
}

/**
 * A misc income or expense entry added during a campaign turn
 */
export interface MiscEntry {
  id: string;
  description: string;
  amount: number;  // positive = income, negative = expense
}

/**
 * Text entries for a player's turn orders (or CM notes) for one turn
 */
export interface TurnOrderEntry {
  fleetDeployment: string;
  intel: string;
  movement: string;
  diplomatic: string;
  construction: string;
  investment: string;
  epSpent?: number;  // EP player plans to spend this turn
}

/**
 * A snapshot of what a player knows about a system at a given turn
 */
export interface SystemIntelSnapshot {
  turn: number;  // 0 = initial game state; N = captured at turn N
  ownerId?: string;  // player ID who owned the system at snapshot time
  attributes?: SystemAttributes;
  connectedLanes: Array<{ toSystemId: string; type: LaneType }>;
  units: Array<{ name: string; unitTemplateId: string; fleetId?: string; playerId?: string }>;
}

/**
 * A trade route established by a Convoy
 */
export interface TradeRoute {
  id: string;
  convoyUnitId: string;  // id of the CampaignUnit (Convoy) that established this route
  systemIds: string[];   // 1–3 system IDs forming the chain
}

/**
 * System fleet name constants — implicit fleets present at every owned system
 */
export const SYSTEM_FLEET_NAMES = ['On-Planet', 'Bases', 'Untasked Ships', 'Untasked Civilians'] as const;
export type SystemFleetName = typeof SYSTEM_FLEET_NAMES[number];

/**
 * A named fleet created by a player (distinct from system fleet buckets)
 */
export interface CampaignFleet {
  id: string;           // UUID — used as unit.fleetId for units in this fleet
  name: string;         // User-chosen name; must not match any SystemFleetName
  systemId: string;     // Current system location
  movedThisTurn: boolean;
}

/**
 * A unit purchased by a player in a campaign
 */
export interface CampaignUnit {
  id: string;
  unitTemplateId: string;
  name: string;
  systemId?: string;
  fleetId?: string;
  carriedById?: string;  // ID of the CampaignUnit carrying this unit
  mothballed?: boolean;  // mothballed units cost 0 maintenance
  // Strategic statuses (persist across turns)
  crippled?: boolean;
  outOfSupply?: boolean;
  captured?: boolean;
  exhausted?: boolean;
}

/**
 * The ten turn phases within an active campaign turn
 */
export type TurnPhase =
  | 'economic' | 'turn_orders' | 'intel' | 'movement'
  | 'diplomacy' | 'combat' | 'supply' | 'construction'
  | 'tech' | 'end_of_turn';

/**
 * The eight diplomatic relation levels between empires ('Unmet' = no contact yet)
 */
export type DiplomacyLevel =
  | 'Unmet' | 'War' | 'Hostilities' | 'Neutral'
  | 'NonAggression' | 'Trade' | 'MutualDefense' | 'Alliance';

/**
 * Per-system campaign statuses (stored separately from the map System object)
 */
export interface SystemCampaignStatus {
  blockaded?: boolean;          // LEGACY — kept for backward compat with old saves; use blockadedBy for new saves
  blockadedBy?: string[];       // player IDs who have imposed a blockade; replaces blockaded for new saves
  inOpposition?: boolean;       // halves system output AND that system's trade income (same effect as blockaded; stacks with economicDisruption)
  economicDisruption?: boolean; // halves system output (stacks with blockaded/inOpposition → 25% total)
  rebellion?: boolean;          // zeroes system output entirely
  hasEnemyFleet?: boolean;      // any trade route touching this system yields 0 income
  industrialSabotage?: boolean; // RAW -1 on next Economic Phase income calc; auto-removed after
  guaranteedPirateRaid?: boolean; // behavior described in Movement Phase
  beachhead?: boolean;           // troops may land at this system without a beachhead established
}

/**
 * Campaign phase tracking
 */
export type CampaignPhase =
  | 'setup'
  | 'homeworld_selection'
  | 'system_purchase'
  | 'galaxy_state_setup'
  | 'lane_rolling'
  | 'unit_purchase'
  | 'unit_deployment'
  | 'trade_routes'
  | 'in_progress';

/**
 * A player in a campaign
 */
export interface CampaignPlayer {
  id: string;
  name: string;
  empire: Empire;
  teamColor?: string;
  homeworldId?: string;
  ownedSystemIds: string[];
  ep: number;
  sp: number;
  unspentSPBonus: number;
  units: CampaignUnit[];
  fleets?: CampaignFleet[];        // user-created named fleets (system fleets are implicit)
  tradeRoutes?: TradeRoute[];
  currentMiscEP?: number;          // total misc EP for THIS turn's Economic Phase (from last turn's pending entries)
  pendingMiscEntries?: MiscEntry[]; // entries added this turn; promoted to currentMiscEP next turn
  intel?: Record<string, SystemIntelSnapshot>;        // gameplay-acquired intel (updated each Intel Phase)
  initialIntel?: Record<string, SystemIntelSnapshot>; // intel at game start (all systems, for Fog of War reference)
  stolenUnits?: { sourceEmpireId: string; unit: EmpireUnit }[]; // unit designs stolen via Intel Phase
  techPool?: number;                  // cumulative EP invested in tech research
  techInvestment?: number;            // this turn's investment (set in Turn Orders, deducted on advance)
  currentTurnSystemIncome?: number;   // system income captured at Economic Phase start (used for TAC)
}

/**
 * Settings configured during campaign setup wizard
 */
export interface CampaignSettings {
  id: string;
  name: string;
  map: GameMap;
  playerCount: number;
  players: { name: string; empire: Empire }[];
  startingYear: number;
  startingEP: number;
  startingSP: number;
  useSystemIncomeEP: boolean;
  rules: CampaignRules;
}

/**
 * A unit list for independent/non-player factions (Harbinger, Independent System, Raider)
 */
export interface IndependentUnitList {
  id: string;
  name: string;
  units: EmpireUnit[];
}

/**
 * A fleet owned by the Campaign Master (not associated with any player)
 */
export interface CMFleet {
  id: string;
  name: string;
  color?: string;
  systemId?: string;
  sourceListId: string;  // which IndependentUnitList these units came from
  units: CampaignUnit[];
  independentSystemId?: string;  // set when this fleet belongs to an independent system
}

/**
 * Phases within a single combat scenario
 */
export type CombatScenarioPhase =
  | 'setup'        // Force selection, scenario type, readiness
  | 'flagship'     // Flagship selection per side
  | 'task_force'   // Task Force construction
  | 'assignments'  // Formation Bonus, Fighter Assignments, Screening, Special Abilities, EW
  | 'fire_ff'      // Fighter vs Fighter
  | 'fire_sf'      // Ship vs Fighter
  | 'fire_ss'      // Ship vs Ship
  | 'special_ops'  // Capture
  | 'retreat'      // Retreat decisions + movement notes
  | 'recovery'     // Reset Task Force for next round
  | 'ground_combat' // Ground combat ATK comparison (replaces all fire sub-phases)
  | 'resolved';    // Combat concluded

export type CombatScenarioType = 'interception' | 'defensive' | 'pursuit' | 'ground_combat';

export type FighterAssignment = 'antiShip' | 'antiFighter' | 'defense';

/** −2=Bad, −1=Poor, 0=Normal, +1=Good, +2=Superb */
export type ReadinessLevel = -2 | -1 | 0 | 1 | 2;

export const READINESS_LABELS: Record<number, string> = {
  '-2': 'Bad (−2)',
  '-1': 'Poor (−1)',
  '0': 'Normal (0)',
  '1': 'Good (+1)',
  '2': 'Superb (+2)',
};

/**
 * Per-unit tactical + positional state within a combat scenario (cleared on entry/exit)
 */
export interface CombatUnitState {
  unitId: string;
  playerId: string;
  side: 'attacker' | 'defender';
  // Tactical statuses (cleared each Recovery Phase)
  isFlagship: boolean;
  formationBonus: boolean;
  disrupted: boolean;
  jammed: boolean;
  // Battle position
  inTaskForce: boolean;
  fighterAssignment: FighterAssignment | null;
  // Outcome tracking
  destroyed: boolean;
  capturedBySide: 'attacker' | 'defender' | null;
  exitedScenario: boolean;
  effectiveCarriedById: string | null;
  // Scenario-level damage state (applied on sub-phase advance)
  crippledInScenario?: boolean;
  pendingCripple?: { cost: number; firingSide: 'attacker' | 'defender' } | null;
  pendingDestroy?: { cost: number; firingSide: 'attacker' | 'defender' } | null;
}

/**
 * One force (attacker or defender) in a combat scenario
 */
export interface CombatForce {
  primaryPlayerId: string;
  alliedPlayerIds: string[];
  readiness: ReadinessLevel;
  retreatMovementNote: string;
}

/**
 * A full combat scenario persisted with the Campaign
 */
export interface CombatScenario {
  id: string;
  systemId: string;
  scenarioType: CombatScenarioType;
  attackerForce: CombatForce;
  defenderForce: CombatForce;
  phase: CombatScenarioPhase;
  turnNumber: number;
  subPhaseHits: Record<'attacker' | 'defender', number>;
  unitStates: Record<string, CombatUnitState>; // keyed by CampaignUnit.id
  attackerCapturedThisTurn: boolean;
  defenderCapturedThisTurn: boolean;
  prevAttackerFlagshipId: string | null;
  prevDefenderFlagshipId: string | null;
  winner: 'attacker' | 'defender' | 'mutual_retreat' | null;
  capturedUnits: Array<{ unitId: string; awardedToPlayerId: string | null; awardedToFleetId?: string | null }>;
  resolvedAt: string | null;
  // Snapshots taken just before advancing out of each fire sub-phase, used to restore state on Back
  firePhaseSnapshots?: {
    fire_ff?: { unitStates: Record<string, CombatUnitState>; subPhaseHits: Record<'attacker' | 'defender', number> };
    fire_sf?: { unitStates: Record<string, CombatUnitState>; subPhaseHits: Record<'attacker' | 'defender', number> };
  };
  // Captured at Begin Scenario — unit.crippled values at scenario start, used for the Resolution tally
  initialUnitSnapshot?: Record<string, { wasStrategicallyCrippled: boolean }>;
  // Set true when Apply Results is clicked — prevents double-apply on Review
  resultsApplied?: boolean;
  // Captured at Begin Scenario — players involved, before any combat; used to restore on Restart
  scenarioStartPlayersSnapshot?: Record<string, CampaignPlayer>;
}

/**
 * Complete campaign state
 */
export interface Campaign {
  settings: CampaignSettings;
  players: CampaignPlayer[];
  phase: CampaignPhase;
  currentTurn: number;
  // Extended runtime save fields (optional for backward compat)
  currentTurnPhase?: TurnPhase;
  currentPlayerIndex?: number;
  systemStatuses?: Record<string, SystemCampaignStatus>;
  cmFleets?: CMFleet[];
  turnOrders?: Record<string, TurnOrderEntry>;
  currentMap?: GameMap;           // live map state (may differ from settings.map after edits)
  createdAt: string;
  lastModified: string;
  diplomacyRelations?: Record<string, DiplomacyLevel>; // key: sorted player IDs joined with ":"
  diplomacyCooldowns?: Record<string, number>; // key: "${ownerId}:${targetId}" (directional, not sorted)
  activeCombatScenarios?: CombatScenario[];
  systemOwnership?: Record<string, string>; // systemId → playerId (campaign-mode ownership, independent of map editor)
  independentUnitLists?: IndependentUnitList[]; // campaign-level overrides of static JSON lists (for tech advances)
  history?: CampaignHistory;
  galaxyStateLog?: {
    independents: string[];
    raiderSystems: string[];
    independentChecked: Record<string, boolean>;
    raiderChecked: Record<string, boolean>;
  };
  independentSystemColors?: Record<string, string>;  // systemId → hex color
}

// ─── Campaign History ─────────────────────────────────────────────────────────

/** Complete mutable state snapshot at a phase boundary */
export interface CampaignSnapshot {
  players: CampaignPlayer[];
  map: GameMap;
  systemOwnership: Record<string, string>;
  systemStatuses: Record<string, SystemCampaignStatus>;
  cmFleets: CMFleet[];
  diplomacyRelations: Record<string, DiplomacyLevel>;
  diplomacyCooldowns: Record<string, number>;
  activeCombatScenarios: CombatScenario[];
  turnOrders: Record<string, TurnOrderEntry>;
  independentUnitListOverrides: IndependentUnitList[];
  independentSystemColors: Record<string, string>;
  galaxyStateLog: Campaign['galaxyStateLog'];
}

/** A snapshot taken at the start of a specific phase */
export interface PhaseHistoryEntry {
  turn: number;             // 0 for setup phases, 1+ for turn phases
  phase: CampaignPhase;
  turnPhase?: TurnPhase;    // only when phase === 'in_progress'
  timestamp: string;
  snapshot: CampaignSnapshot;
}

export interface CampaignHistory {
  entries: PhaseHistoryEntry[];
}

// ─── History Diff Types ───────────────────────────────────────────────────────

export type DiffChangeType = 'added' | 'removed' | 'changed';

export interface UnitDiff {
  type: DiffChangeType;
  playerId: string;
  playerName: string;
  unitName: string;
  templateName: string;
  unitClassName?: string;       // template/class name for grouping (e.g. "Icarus")
  systemId?: string;
  systemName?: string;
  fromFleetName?: string;       // populated when fleet assignment changed
  toFleetName?: string;         // populated when fleet assignment changed
  isReassignmentOnly?: boolean; // true when ONLY change was fleet reassignment
  details?: string;
}

export interface EPSPDiff {
  playerId: string;
  playerName: string;
  epBefore: number;
  epAfter: number;
  spBefore: number;
  spAfter: number;
}

export interface OwnershipDiff {
  systemId: string;
  systemName: string;
  previousOwner?: string;
  newOwner?: string;
}

export interface DiplomacyDiff {
  player1Name: string;
  player2Name: string;
  previousLevel: DiplomacyLevel;
  newLevel: DiplomacyLevel;
}

export interface SystemStatusDiff {
  systemId: string;
  systemName: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

export interface FleetDiff {
  type: DiffChangeType;
  ownerName: string;
  fleetName: string;
  systemName?: string;
  details?: string;
}

export interface TradeRouteDiff {
  type: DiffChangeType;
  playerName: string;
  systemNames: string[];
}

export interface TechDiff {
  playerId: string;
  playerName: string;
  techPoolBefore: number;
  techPoolAfter: number;
  unlockedUnits?: string[];
}

export interface PhaseDiff {
  units: UnitDiff[];
  epSp: EPSPDiff[];
  ownership: OwnershipDiff[];
  diplomacy: DiplomacyDiff[];
  systemStatuses: SystemStatusDiff[];
  fleets: FleetDiff[];
  tradeRoutes: TradeRouteDiff[];
  tech: TechDiff[];
}
