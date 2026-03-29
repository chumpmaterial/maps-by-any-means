import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Home, Download, Clock, Anchor, TrendingUp, FlaskConical, Eye, Globe, Sun, Moon, SlidersHorizontal, Pencil } from 'lucide-react';

import type { Campaign, CampaignSettings, CampaignPlayer, CampaignFleet, CampaignUnit, CampaignPhase, TurnPhase, SystemCampaignStatus, System, JumpLane, LaneType, SystemType, EmpireUnit, UnitCategory, GameMap, MiscEntry, TurnOrderEntry, SystemIntelSnapshot, CMFleet, DiplomacyLevel, CombatScenario, IndependentUnitList, TechLevelType, CampaignHistory, CampaignSnapshot, PhaseHistoryEntry } from '../types';
import { SYSTEM_FLEET_NAMES } from '../types';
import { INDEPENDENT_UNIT_LISTS } from '../data/independentLists';
import { useTheme } from '../hooks/useTheme';
import { useMapState } from '../hooks/useMapState';
import { useNameLists } from '../hooks/useNameLists';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useConfirm } from '../hooks/useConfirm';
import { useDragScroll } from '../hooks/useDragScroll';
import { MapViewport } from './MapViewport';
import type { FleetOwnerIndicator, FleetSummaryInfo } from './MapViewport';
import { PropertyPanel } from './PropertyPanel';
import { EditFleetView } from './EditFleetView';
import { FleetManagerView, CM_TAB_ID } from './FleetManagerView';
import { TransferUnitView } from './TransferUnitView';
import { TradeRouteManagerView } from './TradeRouteManagerView';
import { AddUnitsView } from './AddUnitsView';
import { CombatScenarioView } from './CombatScenarioView';
import { SupplyPhaseView } from './SupplyPhaseView';
import { SystemsOverviewView } from './SystemsOverviewView';
import { TurnHistoryBrowser } from './TurnHistoryBrowser';
import { GalaxyStateSetupPanel } from './GalaxyStateSetupPanel';
import { SettingsModal } from './SettingsModal';
import { Toolbar } from './Toolbar';
import { useMapCapture } from '../hooks/useMapCapture';
import { CaptureButton } from './CaptureButton';
import { ClipModePanel } from './ClipModePanel';
import { generateRandomTeamColor } from '../utils/colorUtils';
import { computeFleetBadges, computeMovementPoints, findFleetPaths, canJoinSystemFleet, getCarryCapacity, resolveUnitTemplate } from '../utils/fleetUtils';
import { isEffectivelyBlockaded, diplomacyKey as supplyDiplomacyKey } from '../utils/supplyUtils';
import { saveCampaignToStorage, exportCampaignToFile } from '../utils/fileUtils';
import { computeTAC, getUpgradePoints, getTotalAP, nextTechLevel, nextTLIterator, STANDARD_TRAITS, FACTOR_TRAITS, TROOP_TRAITS, DEFAULT_UNITS } from '../data/unitData';

/** Returns true if the given ownership ID refers to an independent system rather than a player. */
function isIndependentId(id: string): boolean {
  return id.startsWith('independent:');
}

/** Returns the display name of an independent system given its ownership ID (e.g. 'independent:<sysId>'). */
function getIndependentSystemName(id: string, map: GameMap): string {
  const sysId = id.replace('independent:', '');
  return map.systems.find(s => s.id === sysId)?.name ?? 'Independent System';
}

interface CampaignMapViewProps {
  settings: CampaignSettings;
  savedCampaign?: Campaign;   // if provided, restores full campaign state instead of fresh init
  onNavigateHome: () => void;
}

export function CampaignMapView({ settings, savedCampaign, onNavigateHome }: CampaignMapViewProps) {
  const { theme, toggleTheme } = useTheme();
  const mapState = useMapState();
  const nameListHook = useNameLists();
  const confirm = useConfirm();
  const captureHook = useMapCapture();
  const svgRef = useRef<SVGSVGElement>(null) as React.RefObject<SVGSVGElement>;
  const [showSettings, setShowSettings] = useState(false);
  const [mapEditingMode, setMapEditingMode] = useState(false);
  const [mapSettings, setMapSettings] = useState({
    showTradeRoutes: false,
    showHexGrid: true,
    fogOfWar: false,
    fowPlayerId: null as string | null,
    blindExploration: false,
    showFleets: true,
  });
  const [unitPurchaseMapView, setUnitPurchaseMapView] = useState(false);
  const [generationLog] = useState<string[]>([]);
  const [activePillDropdown, setActivePillDropdown] = useState<'settings' | 'capture' | null>(null);

  // Campaign state
  const [phase, setPhase] = useState<CampaignPhase>('homeworld_selection');
  const [players, setPlayers] = useState<CampaignPlayer[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [tradeRoutePickChain, setTradeRoutePickChain] = useState<string[]>([]);

  const { tradeRouteLaneIds, tradeRouteSystemIds } = useMemo(() => {
    const lanes = mapState.map.jumpLanes;
    const pickSet = new Set(tradeRoutePickChain);

    // Compute lane IDs for consecutive pairs in the pick chain
    const pickLaneIds = new Set<string>();
    for (let i = 0; i + 1 < tradeRoutePickChain.length; i++) {
      const a = tradeRoutePickChain[i], b = tradeRoutePickChain[i + 1];
      const lane = lanes.find(l => (l.from === a && l.to === b) || (l.from === b && l.to === a));
      if (lane) pickLaneIds.add(lane.id);
    }

    if (!mapSettings.showTradeRoutes && pickSet.size === 0) return { tradeRouteLaneIds: undefined, tradeRouteSystemIds: undefined };
    if (!mapSettings.showTradeRoutes) return { tradeRouteLaneIds: pickLaneIds, tradeRouteSystemIds: pickSet };

    const laneIds = new Set<string>(pickLaneIds);
    const systemIds = new Set<string>(pickSet);
    for (const player of players) {
      for (const route of player.tradeRoutes ?? []) {
        for (const sid of route.systemIds) systemIds.add(sid);
        // Check ALL pairs (not just consecutive) to handle hub-spoke layouts
        for (let i = 0; i < route.systemIds.length; i++) {
          for (let j = i + 1; j < route.systemIds.length; j++) {
            const a = route.systemIds[i], b = route.systemIds[j];
            const lane = lanes.find(l =>
              (l.from === a && l.to === b) || (l.from === b && l.to === a)
            );
            if (lane) laneIds.add(lane.id);
          }
        }
      }
    }
    return { tradeRouteLaneIds: laneIds, tradeRouteSystemIds: systemIds };
  }, [mapSettings.showTradeRoutes, players, mapState.map.jumpLanes, tradeRoutePickChain]);

  // Campaign play mode state
  const [currentTurnPhase, setCurrentTurnPhase] = useState<TurnPhase>('economic');
  const [currentTurn, setCurrentTurn] = useState(1);
  const [turnPhaseMapView, setTurnPhaseMapView] = useState(false);
  const [showMiscIncomeModal, setShowMiscIncomeModal] = useState(false);
  const [systemStatuses, setSystemStatuses] = useState<Record<string, SystemCampaignStatus>>({});
  const [systemOwnership, setSystemOwnership] = useState<Record<string, string>>({});
  const [campaignHistory, setCampaignHistory] = useState<CampaignHistory>({ entries: [] });
  const [turnOrders, setTurnOrders] = useState<Record<string, TurnOrderEntry>>({});
  const [intelChecks, setIntelChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [movementChecks, setMovementChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [constructionChecks, setConstructionChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [investmentChecks, setInvestmentChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [diplomacyChecks, setDiplomacyChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [diplomacyRelations, setDiplomacyRelations] = useState<Record<string, DiplomacyLevel>>({});
  const [diplomacyCooldowns, setDiplomacyCooldowns] = useState<Record<string, number>>({});
  const [diplomacyCooldownsRaisedThisTurn, setDiplomacyCooldownsRaisedThisTurn] = useState<Record<string, boolean>>({});
  const [espionageFlow, setEspionageFlow] = useState<
    | { step: 'select_player' }
    | { step: 'select_system'; playerId: string }
    | null
  >(null);

  // Fleet management state
  const [fleetMoveMode, setFleetMoveMode] = useState<{ fleetId: string; playerId: string } | null>(null);
  const [editingFleet, setEditingFleet] = useState<{ fleetId: string; playerId: string } | null>(null);
  const [editingCMFleet, setEditingCMFleet] = useState<string | null>(null);
  const [cmFleetMoveMode, setCmFleetMoveMode] = useState<string | null>(null);
  const [showFleetManager, setShowFleetManager] = useState(false);
  const [showTradeRouteManager, setShowTradeRouteManager] = useState(false);
  const [tradeRoutePickMode, setTradeRoutePickMode] = useState(false);
  const [tradeRoutePickedSystemId, setTradeRoutePickedSystemId] = useState<string | null>(null);
  const [showSystemsOverview, setShowSystemsOverview] = useState(false);
  const [showHistoryBrowser, setShowHistoryBrowser] = useState(false);
  const [fleetManagerFocus, setFleetManagerFocus] = useState<{ playerId: string; systemId: string } | null>(null);
  const [showAddUnits, setShowAddUnits] = useState(false);
  const [addUnitsSystemId, setAddUnitsSystemId] = useState('');
  const [addUnitsPickMode, setAddUnitsPickMode] = useState(false);
  const [showAddToTechPoolModal, setShowAddToTechPoolModal] = useState(false);
  const [showStealUnitTechModal, setShowStealUnitTechModal] = useState(false);
  const [showTransferUnitModal, setShowTransferUnitModal] = useState(false);
  const [showForceAdvancementModal, setShowForceAdvancementModal] = useState(false);
  const [tradeRouteWarnings, setTradeRouteWarnings] = useState<Array<{ routeOwnerName: string; systemName: string; reason: string }>>([]);
  const [showTradeRouteWarningModal, setShowTradeRouteWarningModal] = useState(false);
  const addUnitsPickInitialIdRef = useRef<string | null>(null);
  const bypassTradeWarningRef = useRef(false);
  const [cmFleets, setCmFleets] = useState<CMFleet[]>([]);
  const [systemFleetOrder, setSystemFleetOrder] = useState<Record<string, string[]>>({});
  const [galaxyStateLog, setGalaxyStateLog] = useState<Campaign['galaxyStateLog']>(undefined);
  const [independentSystemColors, setIndependentSystemColors] = useState<Record<string, string>>({});
  const [pathSelectModal, setPathSelectModal] = useState<{
    paths: string[][];
    fleetId: string;
    playerId: string;
    dstSystemId: string;
  } | null>(null);

  // Combat scenario state
  const [activeCombatScenarios, setActiveCombatScenarios] = useState<CombatScenario[]>([]);
  const activeCombatScenariosRef = useRef<CombatScenario[]>([]);
  activeCombatScenariosRef.current = activeCombatScenarios;
  const [openScenarioId, setOpenScenarioId] = useState<string | null>(null);
  // Campaign-level overrides for independent unit lists (tech advances, custom units)
  const [independentUnitListOverrides, setIndependentUnitListOverrides] = useState<IndependentUnitList[]>([]);

  // Map centering requests (e.g. from combat encounter clicks)
  const centerNonceRef = useRef(0);
  const [centerRequest, setCenterRequest] = useState<{ systemId: string; nonce: number } | null>(null);
  const mapSettingsPillRef = useRef<HTMLDivElement>(null);

  // Rebuild ownedSystemIds on all players from the canonical systemOwnership record
  function rebuildOwnedSystemIds(prevPlayers: CampaignPlayer[], ownership: Record<string, string>): CampaignPlayer[] {
    const byPlayer: Record<string, string[]> = {};
    for (const [sysId, pid] of Object.entries(ownership)) {
      if (!pid || pid.startsWith('independent:')) continue;
      (byPlayer[pid] ??= []).push(sysId);
    }
    return prevPlayers.map(p => ({ ...p, ownedSystemIds: byPlayer[p.id] ?? [] }));
  }

  // Fleet indicators: per-system owner badges shown on the map in in_progress phase
  const fleetIndicators = useMemo((): Record<string, FleetOwnerIndicator[]> => {
    const result: Record<string, FleetOwnerIndicator[]> = {};
    const allIndieTemplates = INDEPENDENT_UNIT_LISTS.flatMap(l => l.units);

    const addCategory = (map: Partial<Record<string, number>>, cat: string) => {
      map[cat] = (map[cat] ?? 0) + 1;
    };

    // Process player fleets
    for (const player of players) {
      for (const fleet of player.fleets ?? []) {
        if (!fleet.systemId) continue;
        const systemId = fleet.systemId;
        const fleetUnits = player.units.filter(u => u.fleetId === fleet.id);

        const unitsByCategory: Partial<Record<string, number>> = {};
        let totalEP = 0;
        let highestCR: number | null = null;

        for (const unit of fleetUnits) {
          const tmpl = resolveUnitTemplate(player, unit.unitTemplateId, players);
          if (tmpl) {
            addCategory(unitsByCategory, tmpl.category);
            totalEP += tmpl.cost;
            if (typeof tmpl.cr === 'number') {
              highestCR = highestCR === null ? tmpl.cr : Math.max(highestCR, tmpl.cr);
            }
          }
        }

        const badges = computeFleetBadges(fleet, fleetUnits, player, players);
        const fleetSummary: FleetSummaryInfo = {
          id: fleet.id,
          name: fleet.name,
          isCMFleet: false,
          unitCount: fleetUnits.length,
          unitsByCategory,
          totalEP,
          highestCR,
          isFast: badges.isFast,
          isScout: badges.isScout,
          isCivilian: badges.isCivilian,
          movedThisTurn: fleet.movedThisTurn,
        };

        if (!result[systemId]) result[systemId] = [];
        let ownerEntry = result[systemId].find(o => o.ownerId === player.id);
        if (!ownerEntry) {
          ownerEntry = {
            ownerId: player.id,
            ownerName: player.name,
            color: player.teamColor ?? '#6b7280',
            fleets: [],
            totalFleets: 0,
            totalUnits: 0,
            unitsByCategory: {},
            totalEP: 0,
          };
          result[systemId].push(ownerEntry);
        }
        ownerEntry.fleets.push(fleetSummary);
        ownerEntry.totalFleets++;
        ownerEntry.totalUnits += fleetSummary.unitCount;
        for (const [cat, count] of Object.entries(fleetSummary.unitsByCategory)) {
          ownerEntry.unitsByCategory[cat] = (ownerEntry.unitsByCategory[cat] ?? 0) + (count ?? 0);
        }
        ownerEntry.totalEP += fleetSummary.totalEP;
      }

      // Also collect untasked units (On-Planet, Untasked Ships, Untasked Civilians) — not Bases
      const UNTASKED_FLEET_IDS = new Set(['On-Planet', 'Untasked Ships', 'Untasked Civilians']);
      for (const unit of player.units) {
        if (!unit.systemId || !unit.fleetId || !UNTASKED_FLEET_IDS.has(unit.fleetId)) continue;
        const tmpl = resolveUnitTemplate(player, unit.unitTemplateId, players);
        if (!tmpl) continue;
        const suffix = unit.fleetId === 'On-Planet' ? 'On-Planet' : 'Untasked';
        const catKey = `${tmpl.category} (${suffix})`;
        const sysId = unit.systemId;
        if (!result[sysId]) result[sysId] = [];
        let ownerEntry = result[sysId].find(o => o.ownerId === player.id);
        if (!ownerEntry) {
          ownerEntry = {
            ownerId: player.id,
            ownerName: player.name,
            color: player.teamColor ?? '#6b7280',
            fleets: [],
            totalFleets: 0,
            totalUnits: 0,
            unitsByCategory: {},
            totalEP: 0,
          };
          result[sysId].push(ownerEntry);
        }
        addCategory(ownerEntry.unitsByCategory, catKey);
        ownerEntry.totalUnits++;
        ownerEntry.totalEP += tmpl.cost;
      }
    }

    // Process CM fleets — each distinct color gets its own owner entry
    for (const fleet of cmFleets) {
      if (!fleet.systemId) continue;
      const systemId = fleet.systemId;
      const color = fleet.independentSystemId
        ? (independentSystemColors[fleet.independentSystemId] ?? fleet.color ?? '#6b7280')
        : (fleet.color ?? '#6b7280');
      const cmOwnerId = `cm-${color}`;

      const unitsByCategory: Partial<Record<string, number>> = {};
      let totalEP = 0;
      let highestCR: number | null = null;

      for (const unit of fleet.units) {
        const tmpl = allIndieTemplates.find(t => t.id === unit.unitTemplateId);
        if (tmpl) {
          addCategory(unitsByCategory, tmpl.category);
          totalEP += tmpl.cost;
          if (typeof tmpl.cr === 'number') {
            highestCR = highestCR === null ? tmpl.cr : Math.max(highestCR, tmpl.cr);
          }
        }
      }

      const fleetSummary: FleetSummaryInfo = {
        id: fleet.id,
        name: fleet.name,
        isCMFleet: true,
        unitCount: fleet.units.length,
        unitsByCategory,
        totalEP,
        highestCR,
        isFast: false,
        isScout: false,
        isCivilian: false,
        movedThisTurn: false,
      };

      if (!result[systemId]) result[systemId] = [];
      let cmOwner = result[systemId].find(o => o.ownerId === cmOwnerId);
      if (!cmOwner) {
        cmOwner = {
          ownerId: cmOwnerId,
          ownerName: 'CM',
          color,
          fleets: [],
          totalFleets: 0,
          totalUnits: 0,
          unitsByCategory: {},
          totalEP: 0,
        };
        result[systemId].push(cmOwner);
      }
      cmOwner.fleets.push(fleetSummary);
      cmOwner.totalFleets++;
      cmOwner.totalUnits += fleet.units.length;
      for (const [cat, count] of Object.entries(unitsByCategory)) {
        cmOwner.unitsByCategory[cat] = (cmOwner.unitsByCategory[cat] ?? 0) + (count ?? 0);
      }
      cmOwner.totalEP += totalEP;
    }

    // Sort and cap at 6 owners per system
    // Order: system owner first (if they have presence here), then descending total EP
    for (const systemId of Object.keys(result)) {
      const ownerIndicatorId = systemOwnership[systemId];

      result[systemId].sort((a, b) => {
        const aIsOwner = a.ownerId === ownerIndicatorId ? 1 : 0;
        const bIsOwner = b.ownerId === ownerIndicatorId ? 1 : 0;
        if (aIsOwner !== bIsOwner) return bIsOwner - aIsOwner;
        return b.totalEP - a.totalEP;
      });

      // No data cap — the badge component limits displayed triangles to BADGE_TRIANGLE_CAP (6)
    }

    return result;
  }, [players, cmFleets, systemOwnership, independentSystemColors]);

  // Initialize: load the map and set up players (or restore a saved campaign)
  useEffect(() => {
    if (savedCampaign) {
      // Restore full state from saved campaign
      mapState.loadMap(structuredClone(savedCampaign.currentMap ?? savedCampaign.settings.map));
      setPlayers(structuredClone(savedCampaign.players));
      setPhase(savedCampaign.phase);
      setCurrentTurn(savedCampaign.currentTurn);
      if (savedCampaign.currentTurnPhase) setCurrentTurnPhase(savedCampaign.currentTurnPhase);
      if (savedCampaign.currentPlayerIndex != null) setCurrentPlayerIndex(savedCampaign.currentPlayerIndex);
      if (savedCampaign.systemStatuses) setSystemStatuses(savedCampaign.systemStatuses);
      if (savedCampaign.cmFleets) setCmFleets(savedCampaign.cmFleets);
      if (savedCampaign.turnOrders) setTurnOrders(savedCampaign.turnOrders);
      if (savedCampaign.diplomacyRelations) setDiplomacyRelations(savedCampaign.diplomacyRelations);
      if (savedCampaign.diplomacyCooldowns) setDiplomacyCooldowns(savedCampaign.diplomacyCooldowns);
      if (savedCampaign.activeCombatScenarios) setActiveCombatScenarios(savedCampaign.activeCombatScenarios);
      if (savedCampaign.independentUnitLists) setIndependentUnitListOverrides(savedCampaign.independentUnitLists);
      if (savedCampaign.galaxyStateLog) setGalaxyStateLog(savedCampaign.galaxyStateLog);
      if (savedCampaign.independentSystemColors) setIndependentSystemColors(savedCampaign.independentSystemColors);
      if (savedCampaign.systemOwnership) {
        setSystemOwnership(savedCampaign.systemOwnership);
      } else {
        // Migrate old saves: rebuild systemOwnership from ownedSystemIds / homeworldId
        const migrated: Record<string, string> = {};
        for (const p of savedCampaign.players) {
          for (const sysId of p.ownedSystemIds) migrated[sysId] = p.id;
          if (p.homeworldId && !migrated[p.homeworldId]) migrated[p.homeworldId] = p.id;
        }
        setSystemOwnership(migrated);
      }
      // Restore or bootstrap history
      if (savedCampaign.history?.entries?.length) {
        setCampaignHistory(savedCampaign.history);
      } else {
        // Bootstrap: create one entry for the current phase so back works after next advance
        const snap: CampaignSnapshot = {
          players: structuredClone(savedCampaign.players),
          map: structuredClone(savedCampaign.currentMap ?? savedCampaign.settings.map),
          systemOwnership: structuredClone(savedCampaign.systemOwnership ?? {}),
          systemStatuses: structuredClone(savedCampaign.systemStatuses ?? {}),
          cmFleets: structuredClone(savedCampaign.cmFleets ?? []),
          diplomacyRelations: structuredClone(savedCampaign.diplomacyRelations ?? {}),
          diplomacyCooldowns: structuredClone(savedCampaign.diplomacyCooldowns ?? {}),
          activeCombatScenarios: structuredClone(savedCampaign.activeCombatScenarios ?? []),
          turnOrders: structuredClone(savedCampaign.turnOrders ?? {}),
          independentUnitListOverrides: structuredClone(savedCampaign.independentUnitLists ?? []),
          galaxyStateLog: savedCampaign.galaxyStateLog ? { ...savedCampaign.galaxyStateLog } : undefined,
          independentSystemColors: savedCampaign.independentSystemColors ? { ...savedCampaign.independentSystemColors } : undefined,
        };
        setCampaignHistory({
          entries: [{
            turn: savedCampaign.phase === 'in_progress' ? savedCampaign.currentTurn : 0,
            phase: savedCampaign.phase,
            turnPhase: savedCampaign.currentTurnPhase,
            timestamp: savedCampaign.lastModified,
            snapshot: snap,
          }],
        });
      }
    } else {
      // Fresh campaign init
      mapState.loadMap(structuredClone(settings.map));

      const initialPlayers: CampaignPlayer[] = settings.players.map((p) => ({
        id: Math.random().toString(36).substring(2, 11),
        name: p.name,
        empire: {
          ...p.empire,
          units: p.empire.units.map(u => ({
            ...u,
            researched:
              u.isd === 'N/A' ||
              (!isNaN(parseInt(u.isd)) && parseInt(u.isd) <= settings.startingYear),
          })),
        },
        teamColor: undefined,
        homeworldId: undefined,
        ownedSystemIds: [],
        ep: settings.startingEP,
        sp: settings.startingSP,
        unspentSPBonus: 0,
        units: [],
        fleets: [],
        tradeRoutes: [],
      }));
      setPlayers(initialPlayers);
      // Bootstrap history with initial snapshot for homeworld_selection
      setCampaignHistory({
        entries: [{
          turn: 0,
          phase: 'homeworld_selection',
          timestamp: new Date().toISOString(),
          snapshot: {
            players: structuredClone(initialPlayers),
            map: structuredClone(settings.map),
            systemOwnership: {},
            systemStatuses: {},
            cmFleets: [],
            diplomacyRelations: {},
            diplomacyCooldowns: {},
            activeCombatScenarios: [],
            turnOrders: {},
            independentUnitListOverrides: [],
            galaxyStateLog: undefined,
          },
        }],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the Campaign object from current state (used by autosave + export)
  const createdAt = useRef(savedCampaign?.createdAt ?? new Date().toISOString());
  const buildCampaignObject = useCallback((): Campaign => ({
    settings,
    players,
    phase,
    currentTurn,
    currentTurnPhase,
    currentPlayerIndex,
    systemStatuses,
    cmFleets,
    turnOrders,
    currentMap: mapState.map,
    createdAt: createdAt.current,
    lastModified: new Date().toISOString(),
    diplomacyRelations,
    diplomacyCooldowns,
    activeCombatScenarios,
    systemOwnership,
    independentUnitLists: independentUnitListOverrides.length > 0 ? independentUnitListOverrides : undefined,
    history: campaignHistory,
    galaxyStateLog: galaxyStateLog ?? undefined,
    independentSystemColors: Object.keys(independentSystemColors).length > 0 ? independentSystemColors : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [settings, phase, players, currentTurn, currentTurnPhase, currentPlayerIndex,
      systemStatuses, cmFleets, turnOrders, diplomacyRelations,
      diplomacyCooldowns, activeCombatScenarios, systemOwnership, mapState.map, independentUnitListOverrides, campaignHistory,
      galaxyStateLog, independentSystemColors]);

  // Autosave campaign state to localStorage whenever key state changes
  useEffect(() => {
    if (players.length === 0) return; // skip before init completes
    saveCampaignToStorage(buildCampaignObject());
  }, [players.length, buildCampaignObject]);

  // Build a snapshot of all current mutable state
  const buildCurrentSnapshot = useCallback((): CampaignSnapshot => ({
    players: structuredClone(players),
    map: structuredClone(mapState.map),
    systemOwnership: structuredClone(systemOwnership),
    systemStatuses: structuredClone(systemStatuses),
    cmFleets: structuredClone(cmFleets),
    diplomacyRelations: structuredClone(diplomacyRelations),
    diplomacyCooldowns: structuredClone(diplomacyCooldowns),
    activeCombatScenarios: structuredClone(activeCombatScenarios),
    turnOrders: structuredClone(turnOrders),
    independentUnitListOverrides: structuredClone(independentUnitListOverrides),
    independentSystemColors: { ...independentSystemColors },
    galaxyStateLog: galaxyStateLog ? { ...galaxyStateLog } : undefined,
  }), [players, mapState.map, systemOwnership, systemStatuses, cmFleets,
      diplomacyRelations, diplomacyCooldowns, activeCombatScenarios, turnOrders, independentUnitListOverrides,
      independentSystemColors, galaxyStateLog]);

  // Auto-capture a history snapshot when entering a new phase
  // Fires after React batches all state updates from advance handlers
  const historyPhaseKey = phase === 'in_progress' ? `${currentTurn}:in_progress:${currentTurnPhase}` : `0:${phase}`;
  useEffect(() => {
    if (players.length === 0) return; // skip before init
    const turn = phase === 'in_progress' ? currentTurn : 0;
    const tp = phase === 'in_progress' ? currentTurnPhase : undefined;
    const exists = campaignHistory.entries.some(e =>
      e.turn === turn && e.phase === phase && e.turnPhase === tp
    );
    if (!exists) {
      setCampaignHistory(prev => ({
        entries: [...prev.entries, {
          turn,
          phase,
          turnPhase: tp,
          timestamp: new Date().toISOString(),
          snapshot: buildCurrentSnapshot(),
        }],
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPhaseKey, players.length]);

  // Format a phase label for display
  const formatHistoryPhaseLabel = (entry: PhaseHistoryEntry): string => {
    if (entry.phase !== 'in_progress') {
      return entry.phase.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    const label = TURN_PHASES.find(p => p.value === entry.turnPhase)?.label ?? entry.turnPhase ?? '';
    return `Turn ${entry.turn} — ${label}`;
  };

  const canRevert = campaignHistory.entries.length >= 2;

  // Unified revert: go back to the previous phase (can cross turn boundaries)
  const handleRevertToPreviousPhase = useCallback(async () => {
    const entries = campaignHistory.entries;
    if (entries.length < 2) return;

    const previousEntry = entries[entries.length - 2];
    const currentEntry = entries[entries.length - 1];

    const currentLabel = formatHistoryPhaseLabel(currentEntry);
    const previousLabel = formatHistoryPhaseLabel(previousEntry);

    const confirmed = await confirm({
      title: 'Revert to Previous Phase',
      message: `Revert to the start of ${previousLabel}? All progress in ${currentLabel} will be lost.`,
      confirmLabel: 'Revert',
      variant: 'danger',
    });
    if (!confirmed) return;

    const snap = previousEntry.snapshot;
    setPlayers(structuredClone(snap.players));
    mapState.loadMap(structuredClone(snap.map));
    setSystemOwnership(structuredClone(snap.systemOwnership));
    setSystemStatuses(structuredClone(snap.systemStatuses));
    setCmFleets(structuredClone(snap.cmFleets));
    setDiplomacyRelations(structuredClone(snap.diplomacyRelations));
    setDiplomacyCooldowns(structuredClone(snap.diplomacyCooldowns));
    setActiveCombatScenarios(structuredClone(snap.activeCombatScenarios));
    setTurnOrders(structuredClone(snap.turnOrders));
    setIndependentUnitListOverrides(structuredClone(snap.independentUnitListOverrides));

    setPhase(previousEntry.phase);
    if (previousEntry.turnPhase) setCurrentTurnPhase(previousEntry.turnPhase);
    if (previousEntry.turn > 0) setCurrentTurn(previousEntry.turn);
    setCurrentPlayerIndex(0);
    setTurnPhaseMapView(false);

    // Pop the current entry from history
    setCampaignHistory(prev => ({ entries: prev.entries.slice(0, -1) }));
  }, [campaignHistory, confirm, mapState]);

  // Keyboard shortcuts - restrict delete in campaign mode unless map editing
  useKeyboardShortcuts(mapState, confirm, { campaignMode: true, mapEditingMode });

  // Dynamic browser tab title
  useEffect(() => {
    document.title = `${settings.name} - MBAM`;
  }, [settings.name]);

  // Get unassigned homeworld systems
  const getAvailableHomeworlds = useCallback(() => {
    const assignedHomeworldIds = new Set(players.map(p => p.homeworldId).filter(Boolean));
    return mapState.map.systems.filter(
      s => s.type === 'homeworld' && !assignedHomeworldIds.has(s.id)
    );
  }, [mapState.map.systems, players]);

  // Handle clicking a system during homeworld selection
  const handleSelectHomeworld = useCallback((systemId: string) => {
    if (phase !== 'homeworld_selection') return;

    const system = mapState.getSystem(systemId);
    if (!system || system.type !== 'homeworld') return;

    // Check it's not already assigned
    if (players.some(p => p.homeworldId === systemId)) return;

    // Assign homeworld to current player
    const teamColor = system.teamColor || generateRandomTeamColor();

    const newOwnership = { ...systemOwnership, [systemId]: players[currentPlayerIndex].id };
    setSystemOwnership(newOwnership);

    const updatedPlayers = rebuildOwnedSystemIds(
      players.map((p, i) => i === currentPlayerIndex ? { ...p, homeworldId: systemId, teamColor } : p),
      newOwnership
    );
    setPlayers(updatedPlayers);

    // Update the system's team color (keeps map editor coloring correct; do NOT set system.owner)
    mapState.updateSystem(systemId, { teamColor, owner: undefined });

    // Find next unassigned player (search all players, not just after current)
    const nextUnassigned = updatedPlayers.findIndex(p => !p.homeworldId);
    if (nextUnassigned !== -1) {
      setCurrentPlayerIndex(nextUnassigned);
    }
    // No need to auto-advance to system_purchase here — user clicks "Continue" button
  }, [phase, players, currentPlayerIndex, systemOwnership, mapState]);

  // Allow changing player color before finalizing
  const handleChangePlayerColor = (playerIndex: number, color: string) => {
    setPlayers(prev => {
      const next = [...prev];
      next[playerIndex] = { ...next[playerIndex], teamColor: color };
      return next;
    });

    // Update the homeworld system color too
    const player = players[playerIndex];
    if (player.homeworldId) {
      mapState.updateSystem(player.homeworldId, { teamColor: color });
    }
  };

  // Finish homeworld selection manually
  const handleFinishHomeworldSelection = () => {
    const allAssigned = players.every(p => !!p.homeworldId);
    if (!allAssigned) return;
    mapState.setUseTeamColors(true);
    setPhase('system_purchase');
    setCurrentPlayerIndex(0);
  };

  // --- System Purchase Phase ---

  // Get systems connected by jump lane to a player's owned systems that are not owned by anyone
  const getConnectedPurchasableSystems = useCallback((playerIndex: number): System[] => {
    const player = players[playerIndex];
    if (!player) return [];

    const allOwnedIds = new Set(players.flatMap(p => p.ownedSystemIds));
    const ownedSet = new Set(player.ownedSystemIds);

    const connectedSystems: System[] = [];
    const seenIds = new Set<string>();

    for (const lane of mapState.map.jumpLanes) {
      // Check if one end is owned by this player and the other is unowned
      let candidateId: string | null = null;
      if (ownedSet.has(lane.from) && !allOwnedIds.has(lane.to)) {
        candidateId = lane.to;
      } else if (ownedSet.has(lane.to) && !allOwnedIds.has(lane.from)) {
        candidateId = lane.from;
      }

      if (candidateId && !seenIds.has(candidateId)) {
        const system = mapState.getSystem(candidateId);
        if (system) {
          connectedSystems.push(system);
          seenIds.add(candidateId);
        }
      }
    }

    return connectedSystems;
  }, [players, mapState]);

  // Calculate system purchase cost: P × RAW
  const getSystemCost = (system: System): number => {
    if (!system.attributes) return 0;
    return system.attributes.population * system.attributes.raw;
  };

  // Purchase a system for the current player
  const handlePurchaseSystem = useCallback((systemId: string) => {
    const system = mapState.getSystem(systemId);
    if (!system || !system.attributes) return;

    const cost = system.attributes.population * system.attributes.raw;
    const player = players[currentPlayerIndex];
    if (!player || player.sp < cost) return;

    // Update systemOwnership and player SP/ownedSystemIds
    const newOwnership = { ...systemOwnership, [systemId]: player.id };
    setSystemOwnership(newOwnership);
    setPlayers(prev => rebuildOwnedSystemIds(
      prev.map((p, i) => i === currentPlayerIndex ? { ...p, sp: p.sp - cost } : p),
      newOwnership
    ));
  }, [players, currentPlayerIndex, systemOwnership, mapState]);

  const zeroUnownedSystemAttributes = useCallback((ownershipSnapshot: Record<string, string>) => {
    for (const system of mapState.map.systems) {
      const owner = ownershipSnapshot[system.id];
      if (!owner && system.attributes) {
        mapState.updateSystem(system.id, {
          attributes: {
            ...system.attributes,
            population: 0,
            morale: 0,
            intel: 0,
            fortification: 0,
          },
        });
      }
    }
  }, [mapState]);

  // Finish system purchase for all players: store unspent SP bonus, zero unowned planets
  const handleFinishAllPurchases = useCallback(() => {
    // Store unspent SP bonus for later EP calculation; don't add to EP yet
    const updatedPlayers = players.map(player => ({
      ...player,
      unspentSPBonus: player.sp * 10,
      sp: 0,
    }));
    setPlayers(updatedPlayers);

    if (settings.rules.independentSystems || settings.rules.hostileGalaxy) {
      setPhase('galaxy_state_setup');
      setCurrentPlayerIndex(0);
    } else {
      zeroUnownedSystemAttributes(systemOwnership);
      setPhase('lane_rolling');
      setCurrentPlayerIndex(0);
    }
  }, [players, settings.rules.independentSystems, settings.rules.hostileGalaxy, zeroUnownedSystemAttributes, systemOwnership]);

  const handleFinishGalaxyStateSetup = useCallback(() => {
    const log = galaxyStateLog ?? { independents: [], raiderSystems: [], independentChecked: {}, raiderChecked: {} };
    const newOwnership = { ...systemOwnership };
    for (const sysId of log.independents) {
      newOwnership[sysId] = `independent:${sysId}`;
    }
    setSystemOwnership(newOwnership);
    setPlayers(prev => rebuildOwnedSystemIds(prev, newOwnership));
    zeroUnownedSystemAttributes(newOwnership);
    setPhase('lane_rolling');
    setCurrentPlayerIndex(0);
  }, [galaxyStateLog, systemOwnership, zeroUnownedSystemAttributes]);

  const handleSetGalaxyStateLog = useCallback((patch: Partial<NonNullable<Campaign['galaxyStateLog']>>) => {
    setGalaxyStateLog(prev => {
      const base = prev ?? { independents: [], raiderSystems: [], independentChecked: {}, raiderChecked: {} };
      return { ...base, ...patch };
    });
  }, []);

  // Finish lane rolling: calculate EP, transition to unit_purchase
  const handleFinishLaneRolling = useCallback(() => {
    const updatedPlayers = players.map(player => {
      if (settings.useSystemIncomeEP) {
        const systemIncome = player.ownedSystemIds.reduce((sum, sysId) => {
          const sys = mapState.getSystem(sysId);
          if (!sys?.attributes) return sum;
          return sum + (sys.attributes.population * sys.attributes.raw);
        }, 0);
        return { ...player, ep: (systemIncome * 4) + player.unspentSPBonus };
      } else {
        return { ...player, ep: settings.startingEP };
      }
    });
    setPlayers(updatedPlayers);
    setPhase('unit_purchase');
    setCurrentPlayerIndex(0);
  }, [players, settings, mapState]);

  // Finish unit purchases: transition to unit_deployment
  // Players with exactly one owned system have all units auto-deployed to it.
  const handleFinishUnitPurchases = useCallback(() => {
    setPlayers(prev => prev.map(player => {
      if (player.ownedSystemIds.length !== 1) return player;
      const systemId = player.ownedSystemIds[0];
      const units = player.units.map(u => {
        if (u.systemId) return u;
        const template = resolveUnitTemplate(player, u.unitTemplateId, prev);
        if (!template) return u;
        return { ...u, systemId, fleetId: getFleetForUnit(template.category, template.name) };
      });
      return { ...player, units };
    }));
    setPhase('unit_deployment');
    setCurrentPlayerIndex(0);
  }, []);

  // Finish deployment: transition to trade_routes
  const handleFinishDeployment = useCallback(() => {
    setPhase('trade_routes');
    setCurrentPlayerIndex(0);
  }, []);

  // Set or overwrite a trade route for a Convoy
  const handleSetTradeRoute = useCallback((playerId: string, convoyUnitId: string, systemIds: string[]) => {
    setPlayers(prev => prev.map(player => {
      if (player.id !== playerId) return player;

      // Remember the convoy's old fleet before clearing it
      const convoy = player.units.find(u => u.id === convoyUnitId);
      const oldFleetId = convoy?.fleetId;

      // Remove convoy from its fleet / system (it now belongs to the trade route)
      const updatedUnits = player.units.map(u =>
        u.id === convoyUnitId ? { ...u, fleetId: undefined, systemId: undefined } : u
      );

      // Delete the old named fleet if it's now empty (system fleets are implicit — skip them)
      const isSystemFleet = !oldFleetId || (SYSTEM_FLEET_NAMES as readonly string[]).includes(oldFleetId);
      let updatedFleets = player.fleets ?? [];
      if (!isSystemFleet) {
        const remainingInFleet = updatedUnits.filter(u => u.fleetId === oldFleetId);
        if (remainingInFleet.length === 0) {
          updatedFleets = updatedFleets.filter(f => f.id !== oldFleetId);
        }
      }

      const existing = (player.tradeRoutes ?? []).filter(r => r.convoyUnitId !== convoyUnitId);
      return {
        ...player,
        units: updatedUnits,
        fleets: updatedFleets,
        tradeRoutes: [...existing, {
          id: Math.random().toString(36).substring(2, 11),
          convoyUnitId,
          systemIds,
        }],
      };
    }));
  }, []);

  // Clear a trade route for a Convoy
  const handleClearTradeRoute = useCallback((playerId: string, convoyUnitId: string) => {
    setPlayers(prev => prev.map(player => {
      if (player.id !== playerId) return player;
      return {
        ...player,
        tradeRoutes: (player.tradeRoutes ?? []).filter(r => r.convoyUnitId !== convoyUnitId),
      };
    }));
  }, []);

  // Recall a Convoy from a trade route to a specific system (dissolves the route)
  const handleRecallConvoy = useCallback((playerId: string, convoyUnitId: string, toSystemId: string) => {
    setPlayers(prev => prev.map(player => {
      if (player.id !== playerId) return player;

      const convoy = player.units.find(u => u.id === convoyUnitId);
      const oldFleetId = convoy?.fleetId;

      const updatedUnits = player.units.map(u =>
        u.id === convoyUnitId ? { ...u, fleetId: undefined, systemId: toSystemId } : u
      );

      const isSystemFleet = !oldFleetId || (SYSTEM_FLEET_NAMES as readonly string[]).includes(oldFleetId);
      let updatedFleets = player.fleets ?? [];
      if (!isSystemFleet) {
        const remainingInFleet = updatedUnits.filter(u => u.fleetId === oldFleetId);
        if (remainingInFleet.length === 0) {
          updatedFleets = updatedFleets.filter(f => f.id !== oldFleetId);
        }
      }

      return {
        ...player,
        units: updatedUnits,
        fleets: updatedFleets,
        tradeRoutes: (player.tradeRoutes ?? []).filter(r => r.convoyUnitId !== convoyUnitId),
      };
    }));
  }, []);

  // Finish trade routes: transition to in_progress, capture initialIntel for all players
  const handleFinishTradeRoutes = useCallback(() => {
    // Build initial intel snapshot (turn 0) for every system on the map
    const initIntel: Record<string, SystemIntelSnapshot> = {};
    for (const sys of mapState.map.systems) {
      const lanes = mapState.map.jumpLanes
        .filter(l => l.from === sys.id || l.to === sys.id)
        .map(l => ({ toSystemId: l.from === sys.id ? l.to : l.from, type: l.type as LaneType }));
      const ownerId = systemOwnership[sys.id];
      const unitsHere = players.flatMap(p =>
        p.units.filter(u => u.systemId === sys.id).map(u => ({ name: u.name, unitTemplateId: u.unitTemplateId }))
      );
      initIntel[sys.id] = {
        turn: 0,
        ownerId,
        attributes: sys.attributes ? { ...sys.attributes } : undefined,
        connectedLanes: lanes,
        units: unitsHere,
      };
    }
    setPlayers(prev => prev.map(p => ({ ...p, initialIntel: structuredClone(initIntel), intel: {} })));
    setPhase('in_progress');
    setCurrentTurnPhase('economic');
    setCurrentTurn(1);
    setTurnPhaseMapView(false);
  }, [players, systemOwnership, mapState.map]);

  // Update a system's campaign status flags
  const handleSetSystemStatus = useCallback((systemId: string, patch: Partial<SystemCampaignStatus>) => {
    setSystemStatuses(prev => ({
      ...prev,
      [systemId]: { ...prev[systemId], ...patch },
    }));
  }, []);

  // Destroy N units of a given template from a given fleet at a given system
  const handleDeleteUnits = useCallback((systemId: string, fleetKey: string, templateId: string, count: number, playerId?: string) => {
    setPlayers(prev => {
      if (playerId) {
        // Per-player delete (e.g. from a per-player system fleet entry)
        return prev.map(p => {
          if (p.id !== playerId) return p;
          const matching = p.units.filter(u =>
            u.systemId === systemId &&
            (u.fleetId ?? 'Unassigned') === fleetKey &&
            u.unitTemplateId === templateId
          );
          const removeIds = new Set(matching.slice(0, count).map(u => u.id));
          return { ...p, units: p.units.filter(u => !removeIds.has(u.id)) };
        });
      }
      let remaining = count;
      return prev.map(p => {
        if (remaining <= 0) return p;
        const matching = p.units.filter(u =>
          u.systemId === systemId &&
          (u.fleetId ?? 'Unassigned') === fleetKey &&
          u.unitTemplateId === templateId
        );
        const removeIds = new Set(matching.slice(0, remaining).map(u => u.id));
        remaining -= removeIds.size;
        return { ...p, units: p.units.filter(u => !removeIds.has(u.id)) };
      });
    });
  }, []);

  // --- Fleet Management Handlers ---

  // Create a new named fleet for a player at the given system
  const handleCreateFleet = useCallback((playerId: string, name: string, systemId: string) => {
    if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(name)) return;
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const dup = (p.fleets ?? []).find(f => f.name === name);
      if (dup) return p;
      const newFleet: CampaignFleet = {
        id: Math.random().toString(36).substring(2, 11),
        name,
        systemId,
        movedThisTurn: false,
      };
      return { ...p, fleets: [...(p.fleets ?? []), newFleet] };
    }));
  }, []);

  // Rename a fleet (validates uniqueness)
  const handleRenameFleet = useCallback((playerId: string, fleetId: string, newName: string) => {
    if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(newName)) return;
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const dup = (p.fleets ?? []).find(f => f.id !== fleetId && f.name === newName);
      if (dup) return p;
      return { ...p, fleets: (p.fleets ?? []).map(f => f.id !== fleetId ? f : { ...f, name: newName }) };
    }));
  }, []);

  // Reorder a fleet within a player's fleet list (swap by ID)
  const handleReorderFleet = useCallback((playerId: string, fromFleetId: string, targetFleetId: string) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const fleets = [...(p.fleets ?? [])];
      const fromIdx = fleets.findIndex(f => f.id === fromFleetId);
      const toIdx = fleets.findIndex(f => f.id === targetFleetId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return p;
      [fleets[fromIdx], fleets[toIdx]] = [fleets[toIdx], fleets[fromIdx]];
      return { ...p, fleets };
    }));
  }, []);

  // Reorder a top-level unit within a named fleet (swap adjacent positions)
  const handleReorderUnitInFleet = useCallback((playerId: string, fleetId: string, unitId: string, dir: 'up' | 'down') => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const fleetUnitIds = new Set(p.units.filter(u => u.fleetId === fleetId).map(u => u.id));
      const topLevel = p.units.filter(u => u.fleetId === fleetId && (!u.carriedById || !fleetUnitIds.has(u.carriedById)));
      const idx = topLevel.findIndex(u => u.id === unitId);
      if (idx === -1) return p;
      const newIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= topLevel.length) return p;
      const units = [...p.units];
      const fromPos = units.findIndex(u => u.id === topLevel[idx].id);
      const toPos = units.findIndex(u => u.id === topLevel[newIdx].id);
      if (fromPos === -1 || toPos === -1) return p;
      [units[fromPos], units[toPos]] = [units[toPos], units[fromPos]];
      return { ...p, units };
    }));
  }, []);

  // Delete a fleet (only if empty)
  const handleDeleteFleet = useCallback((playerId: string, fleetId: string) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const hasUnits = p.units.some(u => u.fleetId === fleetId);
      if (hasUnits) return p;
      return { ...p, fleets: (p.fleets ?? []).filter(f => f.id !== fleetId) };
    }));
    setEditingFleet(null);
  }, []);

  // System pick mode for Add Units: watch selectedSystemId changes
  useEffect(() => {
    if (!addUnitsPickMode) return;
    const current = mapState.selectedSystemId;
    if (current && current !== addUnitsPickInitialIdRef.current) {
      setAddUnitsSystemId(current);
      setAddUnitsPickMode(false);
      setShowAddUnits(true);
    }
  }, [addUnitsPickMode, mapState.selectedSystemId]);

  // Trade route pick mode: watch for system clicks
  useEffect(() => {
    if (!tradeRoutePickMode) return;
    const current = mapState.selectedSystemId;
    if (current) setTradeRoutePickedSystemId(current);
  }, [tradeRoutePickMode, mapState.selectedSystemId]);

  useEffect(() => {
    if (activePillDropdown !== 'settings') return;
    const handleMouseDown = (e: MouseEvent) => {
      if (mapSettingsPillRef.current && !mapSettingsPillRef.current.contains(e.target as Node)) {
        setActivePillDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [activePillDropdown]);

  const handleEnterAddUnitsPickMode = useCallback(() => {
    addUnitsPickInitialIdRef.current = mapState.selectedSystemId;
    setAddUnitsPickMode(true);
    setShowAddUnits(false);
  }, [mapState.selectedSystemId]);

  // Add units to the correct untasked fleet at a given system (no EP deduction)
  const handleAddPlayerUnits = useCallback((playerId: string, systemId: string, units: Array<{ templateId: string; name: string }>) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const newUnits: CampaignUnit[] = units.map(u => {
        // Look up template: own empire first, then stolen designs, then any other player's empire (allied units)
        const template: EmpireUnit | undefined =
          p.empire.units.find(t => t.id === u.templateId)
          ?? p.stolenUnits?.find(s => s.unit.id === u.templateId)?.unit
          ?? prev.flatMap(op => op.id !== p.id ? op.empire.units : []).find(t => t.id === u.templateId);
        const fleetId = template ? getFleetForUnit(template.category, template.name) : undefined;
        return {
          id: crypto.randomUUID(),
          unitTemplateId: u.templateId,
          name: u.name,
          systemId,
          fleetId,
        };
      });
      return { ...p, units: [...p.units, ...newUnits] };
    }));
  }, []);

  // Add units to a CM fleet
  const handleAddCMUnits = useCallback((fleetId: string, units: CampaignUnit[]) => {
    setCmFleets(prev => prev.map(f => f.id === fleetId ? { ...f, units: [...f.units, ...units] } : f));
  }, []);

  // Delete individual unit templates from a CM fleet
  const handleDeleteCMUnits = useCallback((fleetId: string, templateId: string, count: number) => {
    setCmFleets(prev => prev.map(f => {
      if (f.id !== fleetId) return f;
      let remaining = count;
      return {
        ...f,
        units: f.units.filter(u => {
          if (u.unitTemplateId !== templateId || remaining <= 0) return true;
          remaining--;
          return false;
        }),
      };
    }));
  }, []);

  // Rename a CM fleet
  const handleRenameCMFleet = useCallback((fleetId: string, name: string) => {
    setCmFleets(prev => prev.map(f => f.id === fleetId ? { ...f, name } : f));
  }, []);

  // Delete an entire CM fleet
  const handleDeleteEntireCMFleet = useCallback((fleetId: string) => {
    setCmFleets(prev => prev.filter(f => f.id !== fleetId));
    setEditingCMFleet(null);
  }, []);

  // Attach/detach a CM fleet unit to/from a carrier
  const handleAttachCMUnit = useCallback((fleetId: string, dependentUnitId: string, carrierId: string | null) => {
    setCmFleets(prev => prev.map(f => {
      if (f.id !== fleetId) return f;
      return { ...f, units: f.units.map(u => u.id === dependentUnitId ? { ...u, carriedById: carrierId ?? undefined } : u) };
    }));
  }, []);

  // Reorder a unit within a CM fleet
  const handleReorderCMUnit = useCallback((fleetId: string, unitId: string, dir: 'up' | 'down') => {
    setCmFleets(prev => prev.map(f => {
      if (f.id !== fleetId) return f;
      const units = [...f.units];
      const idx = units.findIndex(u => u.id === unitId);
      if (idx === -1) return f;
      const newIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= units.length) return f;
      [units[idx], units[newIdx]] = [units[newIdx], units[idx]];
      return { ...f, units };
    }));
  }, []);

  // Reorder any named fleet (player or CM) within a system's unified display order
  const handleReorderAnyFleet = useCallback((systemId: string, fromFleetId: string, targetFleetId: string) => {
    setSystemFleetOrder(prev => {
      const playerFleetIds = players.flatMap(p => (p.fleets ?? []).filter(f => f.systemId === systemId).map(f => f.id));
      const cmFleetIds = cmFleets.filter(f => f.systemId === systemId).map(f => f.id);
      const allNamedFleetIds = [...playerFleetIds, ...cmFleetIds];
      const currentOrder = prev[systemId] ?? allNamedFleetIds;
      // Sync: remove IDs that no longer exist, append any new ones
      const validSet = new Set(allNamedFleetIds);
      const synced = currentOrder.filter(id => validSet.has(id));
      for (const id of allNamedFleetIds) {
        if (!synced.includes(id)) synced.push(id);
      }
      const fromIdx = synced.indexOf(fromFleetId);
      const toIdx = synced.indexOf(targetFleetId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const newOrder = [...synced];
      const [moved] = newOrder.splice(fromIdx, 1);
      newOrder.splice(toIdx, 0, moved);
      return { ...prev, [systemId]: newOrder };
    });
  }, [players, cmFleets]);

  // Move a CM unit from one fleet to another
  const handleMoveCMUnitToFleet = useCallback((fromFleetId: string, unitId: string, toFleetId: string) => {
    setCmFleets(prev => {
      const fromFleet = prev.find(f => f.id === fromFleetId);
      if (!fromFleet) return prev;
      const unit = fromFleet.units.find(u => u.id === unitId);
      if (!unit) return prev;
      const toFleet = prev.find(f => f.id === toFleetId);
      if (!toFleet) return prev;
      const movedUnit = { ...unit, systemId: toFleet.systemId ?? unit.systemId };
      return prev.map(f => {
        if (f.id === fromFleetId) return { ...f, units: f.units.filter(u => u.id !== unitId) };
        if (f.id === toFleetId) return { ...f, units: [...f.units, movedUnit] };
        return f;
      });
    });
  }, []);

  // Move units of a template type from one CM fleet to another (condensed mode drag)
  const handleMoveCMTemplateToFleet = useCallback((fromFleetId: string, toFleetId: string, templateId: string, _systemId: string, count: number) => {
    setCmFleets(prev => {
      const fromFleet = prev.find(f => f.id === fromFleetId);
      const toFleet = prev.find(f => f.id === toFleetId);
      if (!fromFleet || !toFleet) return prev;
      let remaining = count;
      const toMove: typeof fromFleet.units = [];
      const kept: typeof fromFleet.units = [];
      for (const u of fromFleet.units) {
        if (u.unitTemplateId === templateId && remaining > 0) {
          toMove.push({ ...u, systemId: toFleet.systemId ?? u.systemId });
          remaining--;
        } else {
          kept.push(u);
        }
      }
      if (toMove.length === 0) return prev;
      return prev.map(f => {
        if (f.id === fromFleetId) return { ...f, units: kept };
        if (f.id === toFleetId) return { ...f, units: [...f.units, ...toMove] };
        return f;
      });
    });
  }, []);

  // Enter CM fleet move mode
  const handleEnterCMFleetMoveMode = useCallback((fleetId: string) => {
    setCmFleetMoveMode(fleetId);
    setEditingCMFleet(null);
  }, []);

  // Complete CM fleet move — teleport to target system (no movement point restrictions for CM)
  const handleCMFleetMoveTarget = useCallback((dstSystemId: string) => {
    if (!cmFleetMoveMode) return;
    const fleetId = cmFleetMoveMode;
    setCmFleets(prev => prev.map(f => {
      if (f.id !== fleetId) return f;
      return {
        ...f,
        systemId: dstSystemId,
        units: f.units.map(u => ({ ...u, systemId: dstSystemId })),
      };
    }));
    setCmFleetMoveMode(null);
  }, [cmFleetMoveMode]);

  // Change or clear campaign ownership of any system
  const handleSetIndependentSystemColor = useCallback((sysId: string, color: string) => {
    setIndependentSystemColors(prev => ({ ...prev, [sysId]: color }));
  }, []);

  const handleChangeSystemOwner = useCallback((systemId: string, newPlayerId: string | null) => {
    // Revert independent fleet ownership if this system was previously independent
    const prevOwner = systemOwnership[systemId];
    if (prevOwner && isIndependentId(prevOwner)) {
      setCmFleets(prev => prev.map(f =>
        f.independentSystemId === systemId ? { ...f, independentSystemId: undefined } : f
      ));
    }

    const newOwnership = { ...systemOwnership };
    if (!newPlayerId) {
      delete newOwnership[systemId];
    } else {
      newOwnership[systemId] = newPlayerId;
    }
    setSystemOwnership(newOwnership);
    setPlayers(prev => rebuildOwnedSystemIds(prev, newOwnership));
  }, [systemOwnership]);

  // Move a unit to a different fleet (validates category rules for system fleets)
  const handleMoveUnitToFleet = useCallback((playerId: string, unitId: string, newFleetId: string) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const unit = p.units.find(u => u.id === unitId);
      if (!unit) return p;
      const template = resolveUnitTemplate(p, unit.unitTemplateId, prev);
      if (!template) return p;
      // Check system fleet category rules
      if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(newFleetId)) {
        if (!canJoinSystemFleet(newFleetId, template.category, template.name)) return p;
      }
      return {
        ...p,
        units: p.units.map(u =>
          u.id !== unitId ? u : { ...u, fleetId: newFleetId, carriedById: undefined }
        ),
      };
    }));
  }, []);

  // Move N units of a given template from one fleet to another (used by drag-and-drop in PropertyPanel)
  const handleMoveTemplateToFleet = useCallback(async (playerId: string, templateId: string, fromFleetKey: string, toFleetKey: string, systemId: string, count: number) => {
    // Beachhead check: dropping Troops to On-Planet of a system the player doesn't own and isn't allied to
    if (toFleetKey === 'On-Planet') {
      const player = players.find(p => p.id === playerId);
      const template = player ? resolveUnitTemplate(player, templateId, players) : undefined;
      if (template?.category === 'Troops') {
        const ownerPlayerId = systemOwnership[systemId];
        const isOwner = ownerPlayerId === playerId;
        const relation = ownerPlayerId
          ? (diplomacyRelations[diplomacyKey(playerId, ownerPlayerId)] ?? 'Unmet')
          : 'Unmet';
        const isAllied = relation === 'Alliance';
        const hasBeachhead = systemStatuses[systemId]?.beachhead === true;
        if (!isOwner && !isAllied && !hasBeachhead) {
          const sys = mapState.getSystem(systemId);
          const confirmed = await confirm({
            title: 'No Beachhead Established',
            message: `${sys?.name ?? 'This system'} does not have a beachhead established. Move troops here anyway?`,
            confirmLabel: 'Move Anyway',
            variant: 'danger',
          });
          if (!confirmed) return;
        }
      }
    }

    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      // Validate target fleet exists if it's a named fleet
      const isNamedTarget = !(SYSTEM_FLEET_NAMES as readonly string[]).includes(toFleetKey);
      if (isNamedTarget && !(p.fleets ?? []).some(f => f.id === toFleetKey)) return p;
      // For system fleet targets, validate category rules using the first matching unit
      if (!isNamedTarget) {
        const sampleUnit = p.units.find(u => u.unitTemplateId === templateId && (u.fleetId ?? 'Unassigned') === fromFleetKey && u.systemId === systemId);
        if (sampleUnit) {
          const template = resolveUnitTemplate(p, templateId, prev);
          if (template && !canJoinSystemFleet(toFleetKey, template.category, template.name)) return p;
        }
      }
      let moved = 0;
      return {
        ...p,
        units: p.units.map(u => {
          if (u.unitTemplateId !== templateId || (u.fleetId ?? 'Unassigned') !== fromFleetKey || u.systemId !== systemId) return u;
          if (moved >= count) return u;
          moved++;
          return { ...u, fleetId: toFleetKey, carriedById: undefined };
        }),
      };
    }));
  }, [players, systemOwnership, diplomacyRelations, systemStatuses, mapState, confirm]);

  // Attach/detach a unit as carried by a carrier unit
  const handleAttachUnit = useCallback((playerId: string, dependentUnitId: string, carrierUnitId: string | null) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      return {
        ...p,
        units: p.units.map(u =>
          u.id !== dependentUnitId ? u : { ...u, carriedById: carrierUnitId ?? undefined }
        ),
      };
    }));
  }, []);

  // Open Fleet Manager, auto-focusing the relevant player tab and system based on current map selection
  const handleOpenFleetManager = useCallback(() => {
    const selectedSysId = mapState.selectedSystemId;
    if (selectedSysId) {
      // Prefer the owner of the system (skip independent systems — they have no player tab)
      const ownerPlayerId = systemOwnership[selectedSysId];
      if (ownerPlayerId && !isIndependentId(ownerPlayerId)) {
        setFleetManagerFocus({ playerId: ownerPlayerId, systemId: selectedSysId });
      } else {
        // Find player with highest AS total from fleets at this system
        let bestPlayerId: string | null = null;
        let bestAS = -1;
        for (const p of players) {
          const fleetIds = new Set((p.fleets ?? []).filter(f => f.systemId === selectedSysId).map(f => f.id));
          if (fleetIds.size === 0) continue;
          const totalAS = p.units
            .filter(u => u.fleetId && fleetIds.has(u.fleetId))
            .reduce((sum, u) => {
              const tmpl = resolveUnitTemplate(p, u.unitTemplateId, players);
              return sum + (typeof tmpl?.as === 'number' ? tmpl.as : 0);
            }, 0);
          if (totalAS > bestAS) { bestAS = totalAS; bestPlayerId = p.id; }
        }
        // Fall back to CM tab if no player has fleets here
        setFleetManagerFocus({ playerId: bestPlayerId ?? CM_TAB_ID, systemId: selectedSysId });
      }
    } else {
      setFleetManagerFocus(null);
    }
    setShowFleetManager(true);
  }, [mapState.selectedSystemId, systemOwnership, players]);

  // Enter fleet move mode
  const handleEnterFleetMoveMode = useCallback((playerId: string, fleetId: string) => {
    setFleetMoveMode({ fleetId, playerId });
    setEditingFleet(null); // Close edit view if open
  }, []);

  // Toggle a strategic status (crippled/outOfSupply/captured/exhausted) on a unit
  const handleToggleUnitStatus = useCallback((playerId: string, unitId: string, status: 'crippled' | 'outOfSupply' | 'captured' | 'exhausted' | 'mothballed') => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      return { ...p, units: p.units.map(u => u.id !== unitId ? u : { ...u, [status]: !u[status] }) };
    }));
  }, []);

  const handleDeleteUnit = useCallback((playerId: string, unitId: string) => {
    setPlayers(prev => prev.map(p =>
      p.id !== playerId ? p : { ...p, units: p.units.filter(u => u.id !== unitId) },
    ));
  }, []);

  const handleBulkSetOutOfSupply = useCallback((playerId: string, unitIds: string[], value: boolean) => {
    const idSet = new Set(unitIds);
    setPlayers(prev => prev.map(p =>
      p.id !== playerId ? p : {
        ...p,
        units: p.units.map(u => idSet.has(u.id) ? { ...u, outOfSupply: value } : u),
      },
    ));
  }, []);

  // Start a new combat scenario at a system
  const handleStartScenario = useCallback((systemId: string) => {
    const id = crypto.randomUUID();
    const newScenario: CombatScenario = {
      id,
      systemId,
      scenarioType: 'interception',
      attackerForce: { primaryPlayerId: '', alliedPlayerIds: [], readiness: 0, retreatMovementNote: '' },
      defenderForce: { primaryPlayerId: '', alliedPlayerIds: [], readiness: 0, retreatMovementNote: '' },
      phase: 'setup',
      turnNumber: 1,
      subPhaseHits: { attacker: 0, defender: 0 },
      unitStates: {},
      attackerCapturedThisTurn: false,
      defenderCapturedThisTurn: false,
      prevAttackerFlagshipId: null,
      prevDefenderFlagshipId: null,
      winner: null,
      capturedUnits: [],
      resolvedAt: null,
    };
    // Discard any existing unapplied scenario for this system before adding the new one
    setActiveCombatScenarios(prev => [...prev.filter(s => s.systemId !== systemId || !!s.resultsApplied), newScenario]);
    setOpenScenarioId(id);
  }, []);

  // Update a combat scenario (called on every state change from CombatScenarioView)
  const handleUpdateScenario = useCallback((updated: CombatScenario) => {
    // Read current state synchronously via ref (updaters inside setState run lazily)
    const old = activeCombatScenariosRef.current.find(s => s.id === updated.id);
    const justApplied = !!updated.resultsApplied && !old?.resultsApplied;

    setActiveCombatScenarios(prev => prev.map(s => s.id === updated.id ? updated : s));

    // Apply Results: remove destroyed; apply crippled flag; transfer captured units; clean empty fleets
    if (justApplied) {
      const destroyedUnitIds = new Set(
        Object.values(updated.unitStates)
          .filter(s => s.destroyed && s.capturedBySide === null)
          .map(s => s.unitId)
      );
      setPlayers(prev => {
        // Mutable working copy for capture transfers
        const next = prev.map(p => ({
          ...p,
          units: [...p.units],
          empire: { ...p.empire, units: [...p.empire.units] },
        }));

        // Transfer captured units from original owner to capturing player
        // Also copies the enemy unit template into the capturing empire so it renders correctly
        for (const award of updated.capturedUnits) {
          if (!award.awardedToPlayerId) continue;
          const origIdx = next.findIndex(p => p.id !== award.awardedToPlayerId && p.units.some(u => u.id === award.unitId));
          if (origIdx < 0) continue; // already transferred (e.g. reapply after Restart where snapshot didn't restore it)
          const origUnit = next[origIdx].units.find(u => u.id === award.unitId)!;
          const origTemplate = next[origIdx].empire.units.find(eu => eu.id === origUnit.unitTemplateId);
          next[origIdx] = { ...next[origIdx], units: next[origIdx].units.filter(u => u.id !== award.unitId) };
          const newOwnerIdx = next.findIndex(p => p.id === award.awardedToPlayerId);
          if (newOwnerIdx >= 0) {
            const newOwner = next[newOwnerIdx];
            // Copy the captured unit's template into the capturing empire if missing
            const hasTemplate = newOwner.empire.units.some(eu => eu.id === origUnit.unitTemplateId);
            if (!hasTemplate && origTemplate) {
              newOwner.empire = { ...newOwner.empire, units: [...newOwner.empire.units, origTemplate] };
            }
            next[newOwnerIdx] = { ...newOwner, units: [...newOwner.units, {
              ...origUnit, crippled: true, captured: true,
              systemId: updated.systemId, fleetId: award.awardedToFleetId ?? undefined,
            }]};
          }
        }

        const capturedUnitIds = new Set(updated.capturedUnits.map(c => c.unitId));
        return next.map(p => ({
          ...p,
          units: p.units
            .filter(u => !destroyedUnitIds.has(u.id))
            .map(u => {
              if (capturedUnitIds.has(u.id)) return u; // already flagged crippled/captured during transfer
              const state = updated.unitStates[u.id];
              if (state?.crippledInScenario && !u.crippled) return { ...u, crippled: true };
              return u;
            }),
          fleets: (p.fleets ?? []).filter(fleet => p.units.filter(u => !destroyedUnitIds.has(u.id)).some(u => u.fleetId === fleet.id)),
        }));
      });
      // Append retreat movement notes to turn orders for retreating players
      for (const side of ['attacker', 'defender'] as const) {
        const force = side === 'attacker' ? updated.attackerForce : updated.defenderForce;
        const note = force.retreatMovementNote.trim();
        if (!note) continue;
        const playerIds = [force.primaryPlayerId, ...force.alliedPlayerIds].filter(Boolean);
        setTurnOrders(prev => {
          const next = { ...prev };
          for (const pid of playerIds) {
            const existing = next[pid] ?? EMPTY_ORDER_ENTRY;
            const sep = existing.movement ? '\n' : '';
            next[pid] = { ...existing, movement: existing.movement + sep + `[Retreat] ${note}` };
          }
          return next;
        });
      }
      // Scenario stays in activeCombatScenarios — do NOT remove
    }
  }, []);

  // Actually execute a fleet move after user confirmation
  const confirmAndMoveFleet = useCallback(async (
    playerId: string,
    fleetId: string,
    path: string[],
    player: CampaignPlayer,
    fleet: CampaignFleet,
    fleetUnits: CampaignUnit[],
    hasBase: boolean,
    extraWarnings: string[] = [],
  ) => {
    const dstSystemId = path[path.length - 1];

    // Build warnings for the user
    const warnings: string[] = [...extraWarnings];
    if (fleet.movedThisTurn) warnings.push('Fleet has already moved this turn.');
    const mothballedCount = fleetUnits.filter(u => u.mothballed).length;
    if (mothballedCount > 0) warnings.push(`${mothballedCount} mothballed unit(s) in this fleet — mothballed units cannot move.`);
    const garrisonCount = fleetUnits.filter(u => {
      const t = resolveUnitTemplate(player, u.unitTemplateId, players);
      return t?.traits.some(tr => tr.name === 'Garrison');
    }).length;
    if (garrisonCount > 0) warnings.push(`${garrisonCount} Garrison troop(s) present — they should not normally move.`);
    if (hasBase) warnings.push('This fleet contains Bases which cannot move.');

    const fleetUnitIds = new Set(fleetUnits.map(u => u.id));
    const unattachedDeps = fleetUnits.filter(u => {
      if (u.carriedById && fleetUnitIds.has(u.carriedById)) return false;
      const t = resolveUnitTemplate(player, u.unitTemplateId, players);
      return t && (t.category === 'Fighters' || t.hullCode === 'AB' || t.category === 'Troops' || t.hullCode === 'OWP');
    }).length;
    if (unattachedDeps > 0) warnings.push(`${unattachedDeps} unit(s) (Fighters/Attack Boats/Troops/OWPs) are unattached — they cannot move without being attached to a carrier.`);

    // Attachment rule violations: wrong category or over capacity
    for (const carrier of fleetUnits) {
      const carrierTmpl = resolveUnitTemplate(player, carrier.unitTemplateId, players);
      if (!carrierTmpl) continue;
      const carried = fleetUnits.filter(cu => cu.carriedById === carrier.id);
      if (carried.length === 0) continue;
      const carriedWithTemplates = carried
        .map(cu => {
          const t = resolveUnitTemplate(player, cu.unitTemplateId, players);
          return t ? { unit: cu, template: t } : null;
        })
        .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
      const { allowedCategories, remaining } = getCarryCapacity(carrier, carrierTmpl, carriedWithTemplates);
      const wrongCat = carriedWithTemplates.filter(({ template: t }) => !allowedCategories.includes(t.category));
      if (wrongCat.length > 0) {
        const catNames = [...new Set(wrongCat.map(x => x.template.category))].join(', ');
        warnings.push(`${carrierTmpl.name} is carrying ${catNames} unit(s) it is not designed to carry.`);
      }
      if (remaining < 0) {
        warnings.push(`${carrierTmpl.name} is over carrying capacity by ${Math.abs(remaining)} slot(s).`);
      }
    }

    const dstName = mapState.map.systems.find(s => s.id === dstSystemId)?.name ?? dstSystemId;
    const message = warnings.length > 0
      ? `Move fleet "${fleet.name}" to ${dstName}?\n\nWarnings:\n• ${warnings.join('\n• ')}`
      : `Move fleet "${fleet.name}" to ${dstName}?`;

    const confirmed = await confirm({ title: 'Move Fleet', message, confirmLabel: 'Move', variant: 'confirm' });
    if (!confirmed) return;

    // Execute the move
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      return {
        ...p,
        fleets: (p.fleets ?? []).map(f =>
          f.id !== fleetId ? f : { ...f, systemId: dstSystemId, movedThisTurn: true }
        ),
        units: p.units.map(u =>
          u.fleetId !== fleetId ? u : { ...u, systemId: dstSystemId }
        ),
      };
    }));
  }, [mapState.map, confirm]);

  // Handle clicking a destination system in fleet move mode
  const handleFleetMoveTarget = useCallback(async (dstSystemId: string) => {
    if (!fleetMoveMode) return;
    const { fleetId, playerId } = fleetMoveMode;
    const player = players.find(p => p.id === playerId);
    if (!player) { setFleetMoveMode(null); return; }
    const fleet = (player.fleets ?? []).find(f => f.id === fleetId);
    if (!fleet) { setFleetMoveMode(null); return; }

    if (dstSystemId === fleet.systemId) { setFleetMoveMode(null); return; }

    const fleetUnits = player.units.filter(u => u.fleetId === fleetId);
    const movementPoints = computeMovementPoints(fleet, fleetUnits, player, players);
    const badges = computeFleetBadges(fleet, fleetUnits, player, players);

    // Check if fleet contains only immovable Bases (hard block).
    // OWPs (hullCode 'OWP') are transportable and do not count as immovable Bases.
    const hasNonBase = fleetUnits.some(u => {
      const t = resolveUnitTemplate(player, u.unitTemplateId, players);
      return t && t.category !== 'Bases';
    });
    const hasImmovableBase = fleetUnits.some(u => {
      const t = resolveUnitTemplate(player, u.unitTemplateId, players);
      return t?.category === 'Bases' && t.hullCode !== 'OWP';
    });
    const hasBase = hasImmovableBase; // used by confirmAndMoveFleet for the "Bases cannot move" warning

    // Find paths
    const paths = findFleetPaths(
      fleet.systemId,
      dstSystemId,
      mapState.map,
      movementPoints,
      { isCivilian: badges.isCivilian },
    );

    const extraWarnings: string[] = [];
    if (hasImmovableBase && !hasNonBase) extraWarnings.push('This fleet contains only Bases, which cannot normally move.');
    if (paths.length === 0) extraWarnings.push('No valid path found to that system within movement limits.');

    if (paths.length > 1) {
      // Multiple paths — show path selection modal
      setPathSelectModal({ paths, fleetId, playerId, dstSystemId });
      setFleetMoveMode(null);
      return;
    }

    // Single path (or no valid path — use direct destination as fallback)
    const chosenPath = paths.length > 0 ? paths[0] : [dstSystemId];
    await confirmAndMoveFleet(playerId, fleetId, chosenPath, player, fleet, fleetUnits, hasBase, extraWarnings);
    setFleetMoveMode(null);
  }, [fleetMoveMode, players, mapState.map, confirm, confirmAndMoveFleet]);

  // Confirm a path from the path selection modal then move
  const handleConfirmPath = useCallback(async (path: string[]) => {
    if (!pathSelectModal) return;
    const { fleetId, playerId } = pathSelectModal;
    const player = players.find(p => p.id === playerId);
    if (!player) { setPathSelectModal(null); return; }
    const fleet = (player.fleets ?? []).find(f => f.id === fleetId);
    if (!fleet) { setPathSelectModal(null); return; }
    const fleetUnits = player.units.filter(u => u.fleetId === fleetId);
    const hasBase = fleetUnits.some(u => {
      const t = resolveUnitTemplate(player, u.unitTemplateId, players);
      return t?.category === 'Bases' && t.hullCode !== 'OWP'; // OWPs are transportable
    });
    setPathSelectModal(null);
    await confirmAndMoveFleet(playerId, fleetId, path, player, fleet, fleetUnits, hasBase);
  }, [pathSelectModal, players, confirmAndMoveFleet]);

  // Add a pending misc entry to a player (applies next turn)
  const handleAddMiscEntry = useCallback((playerIndex: number, description: string, amount: number) => {
    const entry: MiscEntry = { id: Math.random().toString(36).substring(2, 11), description, amount };
    setPlayers(prev => prev.map((p, i) => i !== playerIndex ? p : {
      ...p,
      pendingMiscEntries: [...(p.pendingMiscEntries ?? []), entry],
    }));
  }, []);

  // Remove a pending misc entry from a player
  const handleRemoveMiscEntry = useCallback((playerIndex: number, entryId: string) => {
    setPlayers(prev => prev.map((p, i) => i !== playerIndex ? p : {
      ...p,
      pendingMiscEntries: (p.pendingMiscEntries ?? []).filter(e => e.id !== entryId),
    }));
  }, []);

  // Advance Economic Phase: save snapshot, apply income for ALL players, clear Industrial Sabotage, move to Turn Orders
  const handleAdvanceEconomicPhase = useCallback(() => {
    setPlayers(prev => prev.map(player => {
      const result = calcEconomicIncome(player, mapState.map, systemStatuses, prev);
      return { ...player, ep: player.ep + result.net, currentMiscEP: 0, currentTurnSystemIncome: result.systemTotal };
    }));
    // Auto-remove Industrial Sabotage from all systems after economic income is resolved
    setSystemStatuses(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].industrialSabotage) next[key] = { ...next[key], industrialSabotage: false };
      }
      return next;
    });
    setCurrentTurnPhase('turn_orders');
    setTurnPhaseMapView(false);
  }, [players, mapState.map, systemStatuses]);

  // Update turn orders / CM notes for a given key (player.id or 'cm')
  const handleUpdateTurnOrders = useCallback((key: string, entry: TurnOrderEntry) => {
    setTurnOrders(prev => ({ ...prev, [key]: entry }));
  }, []);

  // Set a player's tech investment for this turn (stored on the player, deducted on Turn Orders advance)
  const handleSetTechInvestment = useCallback((playerId: string, amount: number) => {
    setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, techInvestment: Math.max(0, amount) } : p));
  }, []);

  // Tech Phase: unlock a unit for a player (standard advancement — deducts TAC from techPool)
  const handleTechUnlockUnit = useCallback((playerId: string, unitId: string) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const tac = computeTAC(p.currentTurnSystemIncome ?? 0, p.empire.advantages as string[], p.empire.disadvantage);
      return {
        ...p,
        techPool: Math.max(0, (p.techPool ?? 0) - tac),
        empire: {
          ...p.empire,
          units: p.empire.units.map(u => u.id !== unitId ? u : { ...u, researched: true }),
        },
      };
    }));
  }, []);

  // Tech Phase: upgrade a unit for a player (standard advancement — deducts TAC from techPool)
  const handleTechUpgradeUnit = useCallback((playerId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const tac = computeTAC(p.currentTurnSystemIncome ?? 0, p.empire.advantages as string[], p.empire.disadvantage);
      const oldUnit = p.empire.units.find(u => u.id === unitId);
      if (!oldUnit) return p;
      const currentTL = typeof oldUnit.techLevel === 'number' ? oldUnit.techLevel : 1;
      const nextTL = nextTechLevel(currentTL as TechLevelType);
      if (nextTL === null) return p;
      const iteratorMatch = oldUnit.name.match(/^(.*?)(-[IVX]+)$/);
      const baseName = iteratorMatch ? iteratorMatch[1] : oldUnit.name;
      const newUnitName = `${baseName}${nextTLIterator(currentTL as TechLevelType)}`;
      const renamedOldName = iteratorMatch ? oldUnit.name : `${baseName}-I`;
      const upgradedUnit: EmpireUnit = {
        ...oldUnit,
        id: crypto.randomUUID(),
        name: newUnitName,
        techLevel: nextTL as TechLevelType,
        parentUnitId: oldUnit.id,
        isSuperseded: false,
        researched: true,
        dv: oldUnit.dv + dvDelta,
        as: typeof oldUnit.as === 'number' ? oldUnit.as + asDelta : oldUnit.as,
        af: typeof oldUnit.af === 'number' ? oldUnit.af + afDelta : oldUnit.af,
        traits: oldUnit.traits.map(tr =>
          tr.factor !== undefined && traitFactorDeltas[tr.name]
            ? { ...tr, factor: tr.factor + traitFactorDeltas[tr.name] }
            : tr
        ),
      };
      const updatedUnits = p.empire.units.map(u =>
        u.id !== unitId ? u : { ...u, name: renamedOldName, isSuperseded: true }
      );
      updatedUnits.push(upgradedUnit);
      return {
        ...p,
        techPool: Math.max(0, (p.techPool ?? 0) - tac),
        empire: { ...p.empire, units: updatedUnits },
      };
    }));
  }, []);

  // Tech Phase: upgrade a stolen unit design (deducts TAC; replaces the stolenUnits entry with the upgraded version)
  const handleTechUpgradeStolenUnit = useCallback((playerId: string, sourceEmpireId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const tac = computeTAC(p.currentTurnSystemIncome ?? 0, p.empire.advantages as string[], p.empire.disadvantage);
      const stolenEntry = (p.stolenUnits ?? []).find(s => s.sourceEmpireId === sourceEmpireId && s.unit.id === unitId);
      if (!stolenEntry) return p;
      const oldUnit = stolenEntry.unit;
      const currentTL = typeof oldUnit.techLevel === 'number' ? oldUnit.techLevel : 1;
      const nextTL = nextTechLevel(currentTL as TechLevelType);
      if (nextTL === null) return p;
      const iteratorMatch = oldUnit.name.match(/^(.*?)(-[IVX]+)$/);
      const baseName = iteratorMatch ? iteratorMatch[1] : oldUnit.name;
      const newUnitName = `${baseName}${nextTLIterator(currentTL as TechLevelType)}`;
      const upgradedUnit: EmpireUnit = {
        ...oldUnit,
        id: crypto.randomUUID(),
        name: newUnitName,
        techLevel: nextTL as TechLevelType,
        parentUnitId: oldUnit.id,
        isSuperseded: false,
        researched: true,
        dv: oldUnit.dv + dvDelta,
        as: typeof oldUnit.as === 'number' ? oldUnit.as + asDelta : oldUnit.as,
        af: typeof oldUnit.af === 'number' ? oldUnit.af + afDelta : oldUnit.af,
        traits: oldUnit.traits.map(tr =>
          tr.factor !== undefined && traitFactorDeltas[tr.name]
            ? { ...tr, factor: tr.factor + traitFactorDeltas[tr.name] }
            : tr
        ),
      };
      const updatedStolen = (p.stolenUnits ?? [])
        .filter(s => !(s.sourceEmpireId === sourceEmpireId && s.unit.id === unitId))
        .concat({ sourceEmpireId, unit: upgradedUnit });
      return { ...p, techPool: Math.max(0, (p.techPool ?? 0) - tac), stolenUnits: updatedStolen };
    }));
  }, []);

  // Force Tech Advancement: same as above but does NOT deduct TAC from techPool
  const handleForceTechUnlockUnit = useCallback((playerId: string, unitId: string) => {
    setPlayers(prev => prev.map(p =>
      p.id !== playerId ? p : {
        ...p,
        empire: {
          ...p.empire,
          units: p.empire.units.map(u => u.id !== unitId ? u : { ...u, researched: true }),
        },
      }
    ));
  }, []);

  const handleForceTechUpgradeUnit = useCallback((playerId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== playerId) return p;
      const oldUnit = p.empire.units.find(u => u.id === unitId);
      if (!oldUnit) return p;
      const currentTL = typeof oldUnit.techLevel === 'number' ? oldUnit.techLevel : 1;
      const nextTL = nextTechLevel(currentTL as TechLevelType);
      if (nextTL === null) return p;
      const iteratorMatch = oldUnit.name.match(/^(.*?)(-[IVX]+)$/);
      const baseName = iteratorMatch ? iteratorMatch[1] : oldUnit.name;
      const newUnitName = `${baseName}${nextTLIterator(currentTL as TechLevelType)}`;
      const renamedOldName = iteratorMatch ? oldUnit.name : `${baseName}-I`;
      const upgradedUnit: EmpireUnit = {
        ...oldUnit,
        id: crypto.randomUUID(),
        name: newUnitName,
        techLevel: nextTL as TechLevelType,
        parentUnitId: oldUnit.id,
        isSuperseded: false,
        researched: true,
        dv: oldUnit.dv + dvDelta,
        as: typeof oldUnit.as === 'number' ? oldUnit.as + asDelta : oldUnit.as,
        af: typeof oldUnit.af === 'number' ? oldUnit.af + afDelta : oldUnit.af,
        traits: oldUnit.traits.map(tr =>
          tr.factor !== undefined && traitFactorDeltas[tr.name]
            ? { ...tr, factor: tr.factor + traitFactorDeltas[tr.name] }
            : tr
        ),
      };
      const updatedUnits = p.empire.units.map(u =>
        u.id !== unitId ? u : { ...u, name: renamedOldName, isSuperseded: true }
      );
      updatedUnits.push(upgradedUnit);
      return { ...p, empire: { ...p.empire, units: updatedUnits } };
    }));
  }, []);

  // Force Tech Advancement: upgrade an independent unit in a list (stored in campaign.independentUnitLists override)
  const handleForceIndepUpgradeUnit = useCallback((listId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => {
    setIndependentUnitListOverrides(prev => {
      // Find the source list (from overrides or static)
      const sourceList = prev.find(l => l.id === listId) ?? INDEPENDENT_UNIT_LISTS.find(l => l.id === listId);
      if (!sourceList) return prev;
      const oldUnit = sourceList.units.find(u => u.id === unitId);
      if (!oldUnit) return prev;
      // Independent units start at 'E'; first upgrade makes [Name]-E + [Name]-I
      const currentTL = oldUnit.techLevel ?? 'E';
      const nextTL = nextTechLevel(currentTL, true);
      if (nextTL === null) return prev;
      const iteratorMatch = oldUnit.name.match(/^(.*?)(-[IVX]|-[EA])$/);
      const baseName = iteratorMatch ? iteratorMatch[1] : oldUnit.name;
      const newUnitName = `${baseName}${nextTLIterator(currentTL)}`;
      const renamedOldName = iteratorMatch ? oldUnit.name : `${baseName}-E`;
      const upgradedUnit: EmpireUnit = {
        ...oldUnit,
        id: crypto.randomUUID(),
        name: newUnitName,
        techLevel: nextTL as TechLevelType,
        parentUnitId: oldUnit.id,
        isSuperseded: false,
        dv: oldUnit.dv + dvDelta,
        as: typeof oldUnit.as === 'number' ? oldUnit.as + asDelta : oldUnit.as,
        af: typeof oldUnit.af === 'number' ? oldUnit.af + afDelta : oldUnit.af,
        traits: oldUnit.traits.map(tr =>
          tr.factor !== undefined && traitFactorDeltas[tr.name]
            ? { ...tr, factor: tr.factor + traitFactorDeltas[tr.name] }
            : tr
        ),
      };
      const updatedUnits = sourceList.units.map(u =>
        u.id !== unitId ? u : { ...u, name: renamedOldName, isSuperseded: true }
      );
      updatedUnits.push(upgradedUnit);
      const updatedList: IndependentUnitList = { ...sourceList, units: updatedUnits };
      const existingIdx = prev.findIndex(l => l.id === listId);
      if (existingIdx >= 0) {
        return prev.map((l, i) => i === existingIdx ? updatedList : l);
      }
      return [...prev, updatedList];
    });
  }, []);

  // Add a custom unit to a player's empire or an independent list
  const handleAddCustomUnit = useCallback((targetType: 'player' | 'independent', targetId: string, unit: EmpireUnit) => {
    if (targetType === 'player') {
      setPlayers(prev => prev.map(p =>
        p.id !== targetId ? p : { ...p, empire: { ...p.empire, units: [...p.empire.units, unit] } }
      ));
    } else {
      setIndependentUnitListOverrides(prev => {
        const sourceList = prev.find(l => l.id === targetId) ?? INDEPENDENT_UNIT_LISTS.find(l => l.id === targetId);
        if (!sourceList) return prev;
        const updatedList: IndependentUnitList = { ...sourceList, units: [...sourceList.units, unit] };
        const existingIdx = prev.findIndex(l => l.id === targetId);
        if (existingIdx >= 0) return prev.map((l, i) => i === existingIdx ? updatedList : l);
        return [...prev, updatedList];
      });
    }
  }, []);

  // Add to tech pool directly (admin tool — no EP deduction)
  const handleAddToTechPool = useCallback((playerId: string, amount: number) => {
    setPlayers(prev => prev.map(p =>
      p.id !== playerId ? p : { ...p, techPool: Math.max(0, (p.techPool ?? 0) + amount) }
    ));
  }, []);

  // Steal a unit design from another empire's force list
  const handleStealUnitTech = useCallback((receivingPlayerId: string, sourceEmpireId: string, unit: EmpireUnit) => {
    setPlayers(prev => prev.map(p => {
      if (p.id !== receivingPlayerId) return p;
      const alreadyStolen = (p.stolenUnits ?? []).some(
        s => s.sourceEmpireId === sourceEmpireId && s.unit.id === unit.id
      );
      if (alreadyStolen) return p; // no-op: duplicate
      return { ...p, stolenUnits: [...(p.stolenUnits ?? []), { sourceEmpireId, unit: structuredClone(unit) }] };
    }));
  }, []);

  // Transfer a unit from one empire to another (voluntary, no EP cost)
  const handleTransferUnit = useCallback((unitIds: string[], fromPlayerId: string, toPlayerId: string) => {
    setPlayers(prev => {
      const fromPlayer = prev.find(p => p.id === fromPlayerId);
      if (!fromPlayer) return prev;

      const unitsToTransfer = fromPlayer.units.filter(u => unitIds.includes(u.id));
      if (unitsToTransfer.length === 0) return prev;

      const transferredUnits = unitsToTransfer.map(unit => {
        // Resolve destination systemId: use unit.systemId or look up fleet.systemId
        let destSystemId: string | undefined = unit.systemId;
        if (!destSystemId && unit.fleetId) {
          const fleet = (fromPlayer.fleets ?? []).find(f => f.id === unit.fleetId);
          destSystemId = fleet?.systemId;
        }
        return {
          ...unit,
          id: Math.random().toString(36).substring(2, 11), // new ID to avoid collisions
          fleetId: undefined,
          systemId: destSystemId,
        };
      });

      const transferredSourceIds = new Set(unitsToTransfer.map(u => u.id));
      return prev.map(p => {
        if (p.id === fromPlayerId) {
          return { ...p, units: p.units.filter(u => !transferredSourceIds.has(u.id)) };
        }
        if (p.id === toPlayerId) {
          return { ...p, units: [...p.units, ...transferredUnits] };
        }
        return p;
      });
    });
  }, []);

  // Transfer units from a CM fleet to a player or independent system
  const handleCMTransfer = useCallback((unitIds: string[], fromFleetId: string, toTarget: string) => {
    let movedUnits: CampaignUnit[] = [];
    setCmFleets(prev => {
      movedUnits = prev.find(f => f.id === fromFleetId)?.units.filter(u => unitIds.includes(u.id)) ?? [];
      const updated = prev.map(f =>
        f.id !== fromFleetId ? f : { ...f, units: f.units.filter(u => !unitIds.includes(u.id)) }
      );
      if (toTarget.startsWith('independent:')) {
        const sysId = toTarget.replace('independent:', '');
        const existingFleet = updated.find(f => f.independentSystemId === sysId);
        if (existingFleet) {
          return updated.map(f =>
            f.id !== existingFleet.id ? f : { ...f, units: [...f.units, ...movedUnits] }
          );
        } else {
          const sysName = mapState.map.systems.find(s => s.id === sysId)?.name;
          const newFleet: CMFleet = {
            id: `cm-fleet-${Date.now()}`,
            name: sysName ? `${sysName} Fleet` : 'Fleet',
            systemId: undefined,
            independentSystemId: sysId,
            sourceListId: '',
            units: movedUnits,
          };
          return [...updated, newFleet];
        }
      }
      return updated;
    });
    if (!toTarget.startsWith('independent:')) {
      setPlayers(prev => prev.map(p =>
        p.id !== toTarget ? p : { ...p, units: [...p.units, ...movedUnits] }
      ));
    }
  }, [mapState.map.systems, setPlayers]);

  // Set diplomacy relation between two players (stored symmetrically)
  const handleSetRelation = useCallback((p1Id: string, p2Id: string, level: DiplomacyLevel) => {
    setDiplomacyRelations(prev => ({ ...prev, [diplomacyKey(p1Id, p2Id)]: level }));
  }, []);

  // Set a diplomatic cooldown (directional). If the new value is higher than the current,
  // mark as raised this turn (prevents auto-decrement on advance).
  const handleSetCooldown = useCallback((ownerId: string, targetId: string, value: number) => {
    const key = cooldownKey(ownerId, targetId);
    setDiplomacyCooldowns(prev => {
      const current = prev[key] ?? 0;
      if (value > current) {
        setDiplomacyCooldownsRaisedThisTurn(r => ({ ...r, [key]: true }));
      }
      return { ...prev, [key]: Math.max(0, value) };
    });
  }, []);

  // Select a system and request the viewport to center on it (used by combat encounter clicks)
  const handleCenterAndSelectSystem = useCallback((systemId: string) => {
    mapState.setSelectedSystemId(systemId);
    setCenterRequest({ systemId, nonce: ++centerNonceRef.current });
  }, [mapState]);

  // Apply Espionage Mission: update intel snapshot for a target system on behalf of a player
  const handleEspionageTarget = useCallback(async (systemId: string) => {
    if (!espionageFlow || espionageFlow.step !== 'select_system') return;
    const player = players.find(p => p.id === espionageFlow.playerId);
    const sys = mapState.map.systems.find(s => s.id === systemId);
    if (!player || !sys) return;
    const confirmed = await confirm({
      title: 'Apply Espionage Mission',
      message: `Apply Espionage Mission for ${player.name} to ${sys.name || systemId}?`,
      confirmLabel: 'Apply',
    });
    if (!confirmed) { setEspionageFlow(null); return; }
    const lanes = mapState.map.jumpLanes
      .filter(l => l.from === systemId || l.to === systemId)
      .map(l => ({ toSystemId: l.from === systemId ? l.to : l.from, type: l.type as LaneType }));
    const ownerId = systemOwnership[systemId];
    const unitsHere = players.flatMap(p =>
      p.units.filter(u => u.systemId === systemId).map(u => ({ name: u.name, unitTemplateId: u.unitTemplateId }))
    );
    const snap: SystemIntelSnapshot = {
      turn: currentTurn,
      ownerId,
      attributes: sys.attributes ? { ...sys.attributes } : undefined,
      connectedLanes: lanes,
      units: unitsHere,
    };
    setPlayers(prev => prev.map(p =>
      p.id === espionageFlow.playerId
        ? { ...p, intel: { ...(p.intel ?? {}), [systemId]: snap } }
        : p
    ));
    setEspionageFlow(null);
  }, [espionageFlow, players, mapState.map, currentTurn, confirm]);

  const galaxyStateHighlights = useMemo((): Record<string, 'independent' | 'raider' | 'both'> | null => {
    if (phase !== 'galaxy_state_setup') return null;
    if (!galaxyStateLog) return {};
    const result: Record<string, 'independent' | 'raider' | 'both'> = {};
    for (const id of galaxyStateLog.independents ?? []) result[id] = 'independent';
    for (const id of galaxyStateLog.raiderSystems ?? []) {
      result[id] = result[id] === 'independent' ? 'both' : 'raider';
    }
    return result;
  }, [phase, galaxyStateLog]);

  // Memoized Fog of War data for MapViewport
  const fowData = useMemo(() => {
    if (!mapSettings.fogOfWar || !mapSettings.fowPlayerId) return null;
    const player = players.find(p => p.id === mapSettings.fowPlayerId);
    if (!player) return null;
    return {
      intel: player.intel ?? {},
      initialIntel: player.initialIntel ?? {},
      currentTurn,
      blindExploration: mapSettings.blindExploration,
    };
  }, [mapSettings.fogOfWar, mapSettings.fowPlayerId, mapSettings.blindExploration, players, currentTurn]);

  // Stale systems for FOW fleet display: systemId → last-seen turn for systems with outdated intel
  const fowStaleSystems = useMemo((): Record<string, number> | null => {
    if (!mapSettings.fogOfWar || !mapSettings.fowPlayerId || !mapSettings.showFleets) return null;
    const player = players.find(p => p.id === mapSettings.fowPlayerId);
    if (!player) return null;
    const result: Record<string, number> = {};
    const sources = [player.intel ?? {}, player.initialIntel ?? {}];
    for (const source of sources) {
      for (const [systemId, snapshot] of Object.entries(source)) {
        if (snapshot.turn < currentTurn && !(systemId in result)) {
          result[systemId] = snapshot.turn;
        }
      }
    }
    return result;
  }, [mapSettings.fogOfWar, mapSettings.fowPlayerId, mapSettings.showFleets, players, currentTurn]);

  // FOW-aware fleet indicators: filters/replaces fleetIndicators based on the FOW player's intel
  const fowAwareFleetIndicators = useMemo((): Record<string, FleetOwnerIndicator[]> | null => {
    if (!mapSettings.fogOfWar || !mapSettings.fowPlayerId || !mapSettings.showFleets) return null;
    const fowPlayer = players.find(p => p.id === mapSettings.fowPlayerId);
    if (!fowPlayer) return null;

    const intelMap = fowPlayer.intel ?? {};
    const initialIntelMap = fowPlayer.initialIntel ?? {};

    // Collect all systemIds to consider: union of live fleetIndicators and intel with units
    const systemIds = new Set<string>([
      ...Object.keys(fleetIndicators),
      ...Object.entries(intelMap)
        .filter(([, snap]) => snap.units.length > 0)
        .map(([id]) => id),
      ...Object.entries(initialIntelMap)
        .filter(([, snap]) => snap.units.length > 0)
        .map(([id]) => id),
    ]);

    const result: Record<string, FleetOwnerIndicator[]> = {};

    for (const systemId of systemIds) {
      // Find the relevant snapshot (intel takes precedence over initialIntel)
      const snapshot = intelMap[systemId] ?? initialIntelMap[systemId];
      if (!snapshot) continue;  // no intel → drop

      // Current-turn (or future) intel → pass live indicators through unchanged.
      // Uses >= rather than === as a defensive guard: snapshot.turn should never exceed
      // currentTurn by design, but if it did, treating it as current is safer than stale.
      if (snapshot.turn >= currentTurn) {
        const live = fleetIndicators[systemId];
        if (live?.length) result[systemId] = live;
        continue;
      }

      // Outdated intel → own fleets live + enemy fleets from snapshot
      const indicators: FleetOwnerIndicator[] = [];

      // Own fleets: take the FOW player's live indicator as-is
      const ownLive = fleetIndicators[systemId]?.find(o => o.ownerId === mapSettings.fowPlayerId);
      if (ownLive) indicators.push(ownLive);

      // Enemy fleets: reconstruct from snapshot.units (drop units with no playerId)
      const unitsByPlayer: Record<string, typeof snapshot.units> = {};
      for (const unit of snapshot.units) {
        if (!unit.playerId || unit.playerId === mapSettings.fowPlayerId) continue;
        (unitsByPlayer[unit.playerId] ??= []).push(unit);
      }

      for (const [playerId, units] of Object.entries(unitsByPlayer)) {
        const player = players.find(p => p.id === playerId);
        if (!player) continue;  // player no longer in campaign

        // Group units by fleetId for fleet summaries
        const byFleet: Record<string, typeof units> = {};
        for (const unit of units) {
          const key = unit.fleetId ?? `__no_fleet__${playerId}`;
          (byFleet[key] ??= []).push(unit);
        }

        const ownerFleets: FleetSummaryInfo[] = [];
        const ownerUnitsByCategory: Partial<Record<string, number>> = {};
        let ownerTotalEP = 0;

        for (const [fleetKey, fleetUnits] of Object.entries(byFleet)) {
          const isNoFleet = fleetKey.startsWith('__no_fleet__');
          const existingFleet = isNoFleet
            ? null
            : player.fleets?.find(f => f.id === fleetKey);
          const fleetName = existingFleet?.name ?? player.name;

          const unitsByCategory: Partial<Record<string, number>> = {};
          let totalEP = 0;
          let highestCR: number | null = null;

          for (const unit of fleetUnits) {
            const tmpl =
              resolveUnitTemplate(player, unit.unitTemplateId, players) ??
              DEFAULT_UNITS.find(t => t.id === unit.unitTemplateId);
            if (tmpl) {
              unitsByCategory[tmpl.category] = (unitsByCategory[tmpl.category] ?? 0) + 1;
              totalEP += tmpl.cost;
              if (typeof tmpl.cr === 'number') {
                highestCR = highestCR === null ? tmpl.cr : Math.max(highestCR, tmpl.cr);
              }
            }
            // Accumulate into owner totals
            ownerTotalEP += tmpl?.cost ?? 0;
          }
          for (const [cat, cnt] of Object.entries(unitsByCategory)) {
            ownerUnitsByCategory[cat] = (ownerUnitsByCategory[cat] ?? 0) + (cnt ?? 0);
          }

          ownerFleets.push({
            id: `snapshot-${playerId}-${fleetKey}`,
            name: fleetName,
            isCMFleet: false,
            unitCount: fleetUnits.length,
            unitsByCategory,
            totalEP,
            highestCR,
            isFast: false,
            isScout: false,
            isCivilian: false,
            movedThisTurn: false,
          });
        }

        indicators.push({
          ownerId: playerId,
          ownerName: player.name,
          color: player.teamColor ?? '#6b7280',
          fleets: ownerFleets,
          totalFleets: ownerFleets.length,
          totalUnits: units.length,
          unitsByCategory: ownerUnitsByCategory,
          totalEP: ownerTotalEP,
        });
      }

      if (indicators.length > 0) result[systemId] = indicators;
    }

    return result;
  }, [mapSettings.fogOfWar, mapSettings.fowPlayerId, mapSettings.showFleets, players, fleetIndicators, currentTurn]);

  // Check all players' trade routes for enemy fleets or fallen relationships
  const checkTradeRouteWarnings = useCallback(() => {
    const warnings: Array<{ routeOwnerName: string; systemName: string; reason: string }> = [];

    for (const player of players) {
      for (const route of player.tradeRoutes ?? []) {
        for (const sysId of route.systemIds) {
          const sysName = mapState.map.systems.find(s => s.id === sysId)?.name ?? sysId;
          const ownerId = systemOwnership[sysId];

          // Check 1: relationship with system owner has fallen below Trade (skip independent systems)
          if (ownerId && ownerId !== player.id && !isIndependentId(ownerId)) {
            const rel = diplomacyRelations[diplomacyKey(player.id, ownerId)] ?? 'Unmet';
            if (DIPLOMACY_LEVELS.indexOf(rel) < DIPLOMACY_LEVELS.indexOf('Trade')) {
              const ownerName = players.find(p => p.id === ownerId)?.name ?? ownerId;
              warnings.push({
                routeOwnerName: player.name,
                systemName: sysName,
                reason: `Relationship with ${ownerName} (owner of ${sysName}) has fallen below Trade.`,
              });
            }
          }

          // Check 2: enemy fleet at this system
          for (const otherPlayer of players) {
            if (otherPlayer.id === player.id) continue;
            const rel = diplomacyRelations[diplomacyKey(player.id, otherPlayer.id)] ?? 'Unmet';
            const isEnemy = DIPLOMACY_LEVELS.indexOf(rel) <= DIPLOMACY_LEVELS.indexOf('Hostilities');
            if (!isEnemy) continue;
            const hasFleet = [...(otherPlayer.fleets ?? [])].some(f => f.systemId === sysId)
              || otherPlayer.units.some(u => !u.fleetId && u.systemId === sysId);
            if (hasFleet) {
              warnings.push({
                routeOwnerName: player.name,
                systemName: sysName,
                reason: `${otherPlayer.name} has a fleet at ${sysName} (enemy of ${player.name}).`,
              });
            }
          }
        }
      }
    }
    return warnings;
  }, [players, mapState.map.systems, systemOwnership, diplomacyRelations]);

  // Advance a placeholder turn phase (turn_orders through end_of_turn)
  const handleAdvanceTurnPhase = useCallback(async () => {
    // Intercept movement → next phase: check trade route warnings first
    if (currentTurnPhase === 'movement' && !bypassTradeWarningRef.current) {
      const warnings = checkTradeRouteWarnings();
      if (warnings.length > 0) {
        setTradeRouteWarnings(warnings);
        setShowTradeRouteWarningModal(true);
        return;
      }
    }
    bypassTradeWarningRef.current = false;

    if (currentTurnPhase !== 'turn_orders') {
      const isLastPhase = currentTurnPhase === 'end_of_turn';
      const phaseLabel = TURN_PHASES.find(p => p.value === currentTurnPhase)?.label ?? currentTurnPhase;
      const nextPhase = getTurnPhaseAfter(currentTurnPhase);
      const nextLabel = nextPhase ? (TURN_PHASES.find(p => p.value === nextPhase)?.label ?? nextPhase) : null;
      const confirmed = await confirm({
        title: isLastPhase ? 'End Turn' : 'Advance Phase',
        message: isLastPhase
          ? 'End this turn and begin the next?'
          : `Advance from ${phaseLabel} to ${nextLabel ?? 'next phase'}?`,
        confirmLabel: isLastPhase ? 'End Turn' : 'Advance',
        variant: 'confirm',
      });
      if (!confirmed) return;
    }
    if (currentTurnPhase === 'turn_orders') {
      const confirmed = await confirm({
        title: 'Advance to Intel Phase',
        message: 'Are you sure you want to advance? All orders will be saved.',
        confirmLabel: 'Advance',
      });
      if (!confirmed) return;
      // Deduct planned EP spending + tech investment for each player; add investment to tech pool
      setPlayers(prev => prev.map(p => {
        const spent = turnOrders[p.id]?.epSpent ?? 0;
        const techInvest = p.techInvestment ?? 0;
        return {
          ...p,
          ep: Math.max(0, p.ep - spent - techInvest),
          techPool: (p.techPool ?? 0) + techInvest,
          techInvestment: 0,
        };
      }));
      // Auto-populate intel for each player's owned/unit systems
      setPlayers(prev => prev.map(p => {
        const systemsToSnapshot = new Set<string>([
          ...p.ownedSystemIds,
          ...(p.homeworldId ? [p.homeworldId] : []),
          ...p.units.filter(u => u.systemId).map(u => u.systemId!),
        ]);
        const newIntel = { ...(p.intel ?? {}) };
        for (const sysId of systemsToSnapshot) {
          const sys = mapState.map.systems.find(s => s.id === sysId);
          if (!sys) continue;
          const lanes = mapState.map.jumpLanes
            .filter(l => l.from === sysId || l.to === sysId)
            .map(l => ({ toSystemId: l.from === sysId ? l.to : l.from, type: l.type as LaneType }));
          const ownerId = systemOwnership[sysId];
          const unitsHere = prev.flatMap(pp =>
            pp.units.filter(u => u.systemId === sysId).map(u => ({ name: u.name, unitTemplateId: u.unitTemplateId, fleetId: u.fleetId, playerId: pp.id }))
          );
          newIntel[sysId] = {
            turn: currentTurn,
            ownerId,
            attributes: sys.attributes ? { ...sys.attributes } : undefined,
            connectedLanes: lanes,
            units: unitsHere,
          };
        }
        return { ...p, intel: newIntel };
      }));
    }
    if (currentTurnPhase === 'end_of_turn') {
      // New turn: promote pending misc entries → currentMiscEP, clear orders, reset fleet movement
      setCurrentTurn(t => t + 1);
      setPlayers(prev => prev.map(p => ({
        ...p,
        currentMiscEP: (p.pendingMiscEntries ?? []).reduce((sum, e) => sum + e.amount, 0),
        pendingMiscEntries: [],
        fleets: (p.fleets ?? []).map(f => ({ ...f, movedThisTurn: false })),
      })));
      // Carry forward pending order lines (neither checked nor X'd); CM notes always carry entirely
      const filterOrderLines = (
        text: string,
        checksArr: Array<{ checked: boolean; xed: boolean }>,
      ) =>
        text.split('\n')
          .filter(l => l.trim() !== '')
          .filter((_, i) => { const c = checksArr[i]; return !c?.checked && !c?.xed; })
          .join('\n');

      setTurnOrders(prev => {
        const next: Record<string, TurnOrderEntry> = {};
        for (const [key, entry] of Object.entries(prev)) {
          if (key === 'cm') {
            next[key] = { ...entry, epSpent: 0 };
          } else {
            const carried: TurnOrderEntry = {
              fleetDeployment: entry.fleetDeployment,
              intel:        filterOrderLines(entry.intel,        intelChecks[key]        ?? []),
              movement:     filterOrderLines(entry.movement,     movementChecks[key]     ?? []),
              diplomatic:   filterOrderLines(entry.diplomatic,   diplomacyChecks[key]    ?? []),
              construction: filterOrderLines(entry.construction, constructionChecks[key] ?? []),
              investment:   filterOrderLines(entry.investment,   investmentChecks[key]   ?? []),
              epSpent: 0,
            };
            const hasContent = (['fleetDeployment', 'intel', 'movement', 'diplomatic', 'construction', 'investment'] as const)
              .some(k => carried[k] !== '');
            if (hasContent) next[key] = carried;
          }
        }
        return next;
      });
      setIntelChecks({});
      setMovementChecks({});
      setConstructionChecks({});
      setInvestmentChecks({});
      setDiplomacyChecks({});
      setCurrentTurnPhase('economic');
    } else {
      if (currentTurnPhase === 'diplomacy') {
        // Decrement each cooldown > 0 that was not raised this turn
        setDiplomacyCooldowns(prev => {
          const updated = { ...prev };
          for (const key of Object.keys(updated)) {
            if (updated[key] > 0 && !diplomacyCooldownsRaisedThisTurn[key]) {
              updated[key]--;
            }
          }
          return updated;
        });
        setDiplomacyCooldownsRaisedThisTurn({});
      }
      const next = getTurnPhaseAfter(currentTurnPhase);
      if (next) setCurrentTurnPhase(next);
    }
    setTurnPhaseMapView(false);
  }, [currentTurnPhase, players, turnOrders, mapState.map, currentTurn, confirm, diplomacyCooldownsRaisedThisTurn, checkTradeRouteWarnings, intelChecks, movementChecks, constructionChecks, investmentChecks, diplomacyChecks]);

  const handleAcknowledgeTradeRouteWarnings = useCallback(() => {
    setShowTradeRouteWarningModal(false);
    setTradeRouteWarnings([]);
    bypassTradeWarningRef.current = true;
    handleAdvanceTurnPhase();
  }, [handleAdvanceTurnPhase]);


  // Purchase a unit for the current player
  const handlePurchaseUnit = useCallback((unitTemplateId: string, unitName: string, unitCost: number) => {
    setPlayers(prev => {
      const next = [...prev];
      const player = next[currentPlayerIndex];
      if (player.ep < unitCost) return prev;
      next[currentPlayerIndex] = {
        ...player,
        ep: player.ep - unitCost,
        units: [...player.units, {
          id: Math.random().toString(36).substring(2, 11),
          unitTemplateId,
          name: unitName,
        }],
      };
      return next;
    });
  }, [currentPlayerIndex]);

  // Bulk purchase recommended forces for the current player
  const handleBulkPurchase = useCallback((units: Array<{ templateId: string; name: string; cost: number; count: number }>) => {
    setPlayers(prev => {
      const next = [...prev];
      const player = next[currentPlayerIndex];
      const totalCost = units.reduce((sum, u) => sum + u.cost * u.count, 0);
      if (player.ep < totalCost) return prev;
      const newUnits = units.flatMap(u =>
        Array.from({ length: u.count }, () => ({
          id: Math.random().toString(36).substring(2, 11),
          unitTemplateId: u.templateId,
          name: u.name,
        }))
      );
      next[currentPlayerIndex] = {
        ...player,
        ep: player.ep - totalCost,
        units: [...player.units, ...newUnits],
      };
      return next;
    });
  }, [currentPlayerIndex]);

  // Remove a purchased unit (refund)
  const handleRemoveUnit = useCallback((unitId: string, unitCost: number) => {
    setPlayers(prev => {
      const next = [...prev];
      const player = next[currentPlayerIndex];
      next[currentPlayerIndex] = {
        ...player,
        ep: player.ep + unitCost,
        units: player.units.filter(u => u.id !== unitId),
      };
      return next;
    });
  }, [currentPlayerIndex]);

  // Reorder purchased units within a category
  const handleReorderUnits = useCallback((category: string, fromTemplateId: string, toTemplateId: string) => {
    if (fromTemplateId === toTemplateId) return;
    setPlayers(prev => {
      const next = [...prev];
      const player = next[currentPlayerIndex];

      // Get all template IDs in this category in their current order (by first appearance)
      const seen = new Set<string>();
      const categoryTemplateOrder: string[] = [];
      for (const u of player.units) {
        if (!seen.has(u.unitTemplateId)) {
          const t = resolveUnitTemplate(player, u.unitTemplateId, prev);
          if (t?.category === category) {
            categoryTemplateOrder.push(u.unitTemplateId);
          }
          seen.add(u.unitTemplateId);
        }
      }

      // Reorder: move fromTemplateId to the position of toTemplateId
      const fromIdx = categoryTemplateOrder.indexOf(fromTemplateId);
      const toIdx = categoryTemplateOrder.indexOf(toTemplateId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      categoryTemplateOrder.splice(fromIdx, 1);
      categoryTemplateOrder.splice(toIdx, 0, fromTemplateId);

      // Rebuild the units array: non-category units stay in place,
      // category units are reordered by the new template order
      const categoryUnits = player.units.filter(u => {
        const t = resolveUnitTemplate(player, u.unitTemplateId, prev);
        return t?.category === category;
      });
      // Sort category units by new template order
      const sortedCategoryUnits = [...categoryUnits].sort((a, b) => {
        const aIdx = categoryTemplateOrder.indexOf(a.unitTemplateId);
        const bIdx = categoryTemplateOrder.indexOf(b.unitTemplateId);
        return aIdx - bIdx;
      });

      // Rebuild: insert category units back at their original positions
      const newUnits = [...player.units];
      let catIdx = 0;
      for (let i = 0; i < newUnits.length; i++) {
        const t = resolveUnitTemplate(player, newUnits[i].unitTemplateId, prev);
        if (t?.category === category) {
          newUnits[i] = sortedCategoryUnits[catIdx++];
        }
      }

      next[currentPlayerIndex] = { ...player, units: newUnits };
      return next;
    });
  }, [currentPlayerIndex]);

  // Deploy N units of a template to a system (assigns fleet based on category)
  const handleDeployUnits = useCallback((unitTemplateId: string, systemId: string, count: number) => {
    setPlayers(prev => {
      const next = [...prev];
      const player = next[currentPlayerIndex];
      const template = resolveUnitTemplate(player, unitTemplateId, prev);
      if (!template) return prev;
      const fleetId = getFleetForUnit(template.category, template.name);
      let deployed = 0;
      const units = player.units.map(u => {
        if (u.unitTemplateId === unitTemplateId && !u.systemId && deployed < count) {
          deployed++;
          return { ...u, systemId, fleetId };
        }
        return u;
      });
      next[currentPlayerIndex] = { ...player, units };
      return next;
    });
  }, [currentPlayerIndex]);

  // Reset all deployment: remove systemId and fleetId from every unit for all players
  const handleResetDeployment = useCallback(() => {
    setPlayers(prev => prev.map(player => ({
      ...player,
      units: player.units.map(u => ({ ...u, systemId: undefined, fleetId: undefined })),
    })));
  }, []);

  const currentTurnPhaseLabel = TURN_PHASES.find(p => p.value === currentTurnPhase)?.label ?? currentTurnPhase;

  return (
    <div className="relative flex h-screen flex-col">
      {/* Campaign Toolbar */}
      {mapEditingMode ? (
        <Toolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          mapState={mapState}
          onGenerationLog={() => {}}
          nameListHook={nameListHook}
          onShowSettings={() => setShowSettings(true)}
        />
      ) : (
        <CampaignToolbar
          campaignName={settings.name}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigateHome={onNavigateHome}
          currentTurn={phase === 'in_progress' ? currentTurn : undefined}
          currentTurnPhaseLabel={phase === 'in_progress' ? currentTurnPhaseLabel : undefined}
          onAddMiscEntry={phase === 'in_progress' ? () => setShowMiscIncomeModal(true) : undefined}
          espionageFlowActive={espionageFlow?.step === 'select_system'}
          onStartEspionage={() => setEspionageFlow({ step: 'select_player' })}
          onCancelEspionage={() => setEspionageFlow(null)}
          onOpenFleetManager={phase === 'in_progress' ? handleOpenFleetManager : undefined}
          onOpenTradeRoutes={phase === 'in_progress' ? () => setShowTradeRouteManager(true) : undefined}
          onOpenAddUnits={(phase === 'in_progress' || phase === 'galaxy_state_setup') ? () => { setAddUnitsSystemId(mapState.selectedSystemId ?? ''); setShowAddUnits(true); } : undefined}
          onOpenTransferUnit={phase === 'in_progress' ? () => setShowTransferUnitModal(true) : undefined}
          onOpenAddToTechPool={phase === 'in_progress' ? () => setShowAddToTechPoolModal(true) : undefined}
          onOpenForceAdvancement={phase === 'in_progress' ? () => setShowForceAdvancementModal(true) : undefined}
          onOpenSystems={phase === 'in_progress' ? () => setShowSystemsOverview(true) : undefined}
          onExportSave={() => exportCampaignToFile(buildCampaignObject())}
          onOpenHistory={() => setShowHistoryBrowser(true)}
          onOpenStealUnitTech={phase === 'in_progress' ? () => setShowStealUnitTechModal(true) : undefined}
        />
      )}

      {/* Main Content Area */}
      {phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase === 'economic' ? (
        <EconomicPhaseView
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={setCurrentPlayerIndex}
          mapState={mapState}
          systemStatuses={systemStatuses}
          currentTurn={currentTurn}
          onAdvancePhase={handleAdvanceEconomicPhase}
          onRevertPhase={handleRevertToPreviousPhase}
          onViewMap={() => setTurnPhaseMapView(true)}
          canRevert={canRevert}
        />
      ) : phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase === 'turn_orders' ? (
        <TurnOrdersPhaseView
          players={players}
          turnOrders={turnOrders}
          onUpdateOrders={handleUpdateTurnOrders}
          onSetTechInvestment={handleSetTechInvestment}
          currentTurn={currentTurn}
          onAdvancePhase={handleAdvanceTurnPhase}
          onRevertPhase={handleRevertToPreviousPhase}
          onViewMap={() => setTurnPhaseMapView(true)}
          canRevert={canRevert}
        />
      ) : phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase === 'diplomacy' ? (
        <DiplomacyPhaseView
          players={players}
          systemOwnership={systemOwnership}
          turnOrders={turnOrders}
          onUpdateOrders={handleUpdateTurnOrders}
          diplomacyChecks={diplomacyChecks}
          onUpdateDiplomacyChecks={(key, checks) => setDiplomacyChecks(prev => ({ ...prev, [key]: checks }))}
          diplomacyRelations={diplomacyRelations}
          onSetRelation={handleSetRelation}
          diplomacyCooldowns={diplomacyCooldowns}
          onSetCooldown={handleSetCooldown}
          map={mapState.map}
          onViewMap={() => setTurnPhaseMapView(true)}
          onAdvance={handleAdvanceTurnPhase}
          canRevert={canRevert}
          onRevert={handleRevertToPreviousPhase}
          currentTurn={currentTurn}
        />
      ) : phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase === 'supply' ? (
        <SupplyPhaseView
          players={players}
          map={mapState.map}
          systemStatuses={systemStatuses}
          systemOwnership={systemOwnership}
          diplomacyRelations={diplomacyRelations ?? {}}
          currentTurn={currentTurn}
          onToggleUnitStatus={handleToggleUnitStatus}
          onDeleteUnit={handleDeleteUnit}
          onBulkSetOutOfSupply={handleBulkSetOutOfSupply}
          onViewMap={() => setTurnPhaseMapView(true)}
          onAdvance={handleAdvanceTurnPhase}
          onBack={handleRevertToPreviousPhase}
          canBack={canRevert}
        />
      ) : phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase === 'tech' ? (
        <TechPhaseView
          players={players}
          settings={settings}
          onAdvancePhase={handleAdvanceTurnPhase}
          onRevertPhase={handleRevertToPreviousPhase}
          onViewMap={() => setTurnPhaseMapView(true)}
          canRevert={canRevert}
          onUnlockUnit={handleTechUnlockUnit}
          onUpgradeUnit={handleTechUpgradeUnit}
          onUpgradeStolenUnit={handleTechUpgradeStolenUnit}
        />
      ) : phase === 'in_progress' && !mapEditingMode && !turnPhaseMapView && currentTurnPhase !== 'intel' && currentTurnPhase !== 'movement' && currentTurnPhase !== 'construction' && currentTurnPhase !== 'diplomacy' && currentTurnPhase !== 'combat' && currentTurnPhase !== 'supply' && currentTurnPhase !== 'tech' && currentTurnPhase !== 'end_of_turn' ? (
        <TurnPhaseView
          turnPhase={currentTurnPhase}
          onAdvance={handleAdvanceTurnPhase}
          onBack={handleRevertToPreviousPhase}
          onViewMap={() => setTurnPhaseMapView(true)}
          canBack={canRevert}
        />
      ) : phase === 'galaxy_state_setup' && !mapEditingMode ? (
        <GalaxyStateSetupPanel
          players={players}
          map={mapState.map}
          systemOwnership={systemOwnership}
          settings={settings}
          galaxyStateLog={galaxyStateLog}
          onSetLog={handleSetGalaxyStateLog}
          onFinish={handleFinishGalaxyStateSetup}
          onOpenAddUnits={() => {
            setAddUnitsSystemId('');
            setShowAddUnits(true);
          }}
        />
      ) : phase === 'unit_purchase' && !mapEditingMode && !unitPurchaseMapView ? (
        <UnitPurchaseView
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={setCurrentPlayerIndex}
          settings={settings}
          onPurchaseUnit={handlePurchaseUnit}
          onBulkPurchase={handleBulkPurchase}
          onRemoveUnit={handleRemoveUnit}
          onReorderUnits={handleReorderUnits}
          onFinish={handleFinishUnitPurchases}
          onBack={handleRevertToPreviousPhase}
          onViewMap={() => setUnitPurchaseMapView(true)}
        />
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {/* Campaign Phase Panel (left sidebar) */}
          {!mapEditingMode && !unitPurchaseMapView && (
            phase === 'in_progress' && currentTurnPhase === 'intel' ? (
              <IntelPhasePanel
                players={players}
                turnOrders={turnOrders}
                onUpdateOrders={handleUpdateTurnOrders}
                intelChecks={intelChecks}
                onUpdateIntelChecks={(key, checks) => setIntelChecks(prev => ({ ...prev, [key]: checks }))}
              />
            ) : phase === 'in_progress' && currentTurnPhase === 'movement' ? (
              <MovementPhasePanel
                players={players}
                turnOrders={turnOrders}
                onUpdateOrders={handleUpdateTurnOrders}
                movementChecks={movementChecks}
                onUpdateMovementChecks={(key, checks) => setMovementChecks(prev => ({ ...prev, [key]: checks }))}
                map={mapState.map}
                systemStatuses={systemStatuses}
              />
            ) : phase === 'in_progress' && currentTurnPhase === 'construction' ? (
              <ConstructionPhasePanel
                players={players}
                turnOrders={turnOrders}
                onUpdateOrders={handleUpdateTurnOrders}
                constructionChecks={constructionChecks}
                onUpdateConstructionChecks={(key, checks) => setConstructionChecks(prev => ({ ...prev, [key]: checks }))}
              />
            ) : phase === 'in_progress' && currentTurnPhase === 'combat' ? (
              <CombatPhasePanel
                players={players}
                diplomacyRelations={diplomacyRelations}
                map={mapState.map}
                onSelectSystem={handleCenterAndSelectSystem}
                onStartScenario={handleStartScenario}
                activeScenarios={activeCombatScenarios.filter(s => !s.resultsApplied)}
                resolvedScenarios={activeCombatScenarios.filter(s => !!s.resultsApplied)}
                onResumeScenario={(systemId) => {
                  const s = activeCombatScenarios.find(sc => sc.systemId === systemId && !sc.resultsApplied);
                  if (s) setOpenScenarioId(s.id);
                }}
                onReviewScenario={(scenarioId) => setOpenScenarioId(scenarioId)}
              />
            ) : phase === 'in_progress' && currentTurnPhase === 'end_of_turn' ? (
              <EndOfTurnPhasePanel
                players={players}
                turnOrders={turnOrders}
                onUpdateOrders={handleUpdateTurnOrders}
                investmentChecks={investmentChecks}
                onUpdateInvestmentChecks={(key, checks) => setInvestmentChecks(prev => ({ ...prev, [key]: checks }))}
                map={mapState.map}
                systemStatuses={systemStatuses}
                systemOwnership={systemOwnership}
                onSelectSystem={handleCenterAndSelectSystem}
              />
            ) : <CampaignPhasePanel
              phase={phase}
              players={players}
              currentPlayerIndex={currentPlayerIndex}
              settings={settings}
              onSelectPlayer={setCurrentPlayerIndex}
              onSelectHomeworld={handleSelectHomeworld}
              onChangePlayerColor={handleChangePlayerColor}
              onFinishHomeworldSelection={handleFinishHomeworldSelection}
              availableHomeworlds={getAvailableHomeworlds()}
              selectedSystemId={mapState.selectedSystemId}
              mapState={mapState}
              onPurchaseSystem={handlePurchaseSystem}
              onFinishAllPurchases={handleFinishAllPurchases}
              getConnectedPurchasableSystems={getConnectedPurchasableSystems}
              getSystemCost={getSystemCost}
              confirm={confirm}
              onFinishLaneRolling={handleFinishLaneRolling}
              onDeployUnits={handleDeployUnits}
              onResetDeployment={handleResetDeployment}
              onFinishDeployment={handleFinishDeployment}
              onSetTradeRoute={handleSetTradeRoute}
              onClearTradeRoute={handleClearTradeRoute}
              onFinishTradeRoutes={handleFinishTradeRoutes}
              canRevert={canRevert}
              onRevert={handleRevertToPreviousPhase}
            />
          )}

          {/* Map Viewport (center) */}
          <div className="relative flex-1 bg-gray-200 dark:bg-gray-800">
            <MapViewport
              mapState={mapState}
              generationLog={generationLog}
              campaignMode={!mapEditingMode}
              mapEditingMode={mapEditingMode}
              showHexGrid={mapSettings.showHexGrid}
              tradeRouteLaneIds={tradeRouteLaneIds}
              tradeRouteSystemIds={tradeRouteSystemIds}
              fowData={fowData}
              espionageMode={espionageFlow?.step === 'select_system'}
              onEspionageTarget={handleEspionageTarget}
              fleetMoveMode={fleetMoveMode}
              onFleetMoveTarget={handleFleetMoveTarget}
              cmFleetMoveMode={!!cmFleetMoveMode}
              onCMFleetMoveTarget={handleCMFleetMoveTarget}
              fleetIndicators={phase === 'in_progress' && mapSettings.showFleets
                ? (fowAwareFleetIndicators ?? fleetIndicators)
                : undefined}
              staleSystems={phase === 'in_progress' ? fowStaleSystems ?? undefined : undefined}
              onFleetMove={phase === 'in_progress' ? handleEnterFleetMoveMode : undefined}
              onCMFleetMove={phase === 'in_progress' ? handleEnterCMFleetMoveMode : undefined}
              requestCenter={centerRequest}
              systemOwnership={phase !== 'homeworld_selection' ? systemOwnership : undefined}
              campaignPlayers={players}
              svgRef={svgRef}
              clipModeActive={captureHook.clipModeActive}
              clipSelectedSystemIds={captureHook.clipSelectedSystemIds}
              onClipToggleSystem={captureHook.toggleClipSystem}
              galaxyStateHighlights={galaxyStateHighlights}
              independentSystemColors={independentSystemColors}
            />
            {/* Map control pill */}
            {phase === 'in_progress' && (
              <div
                ref={mapSettingsPillRef}
                className="absolute bottom-[5.5rem] left-4 flex items-center gap-1 rounded bg-black/50 px-1.5 py-1"
              >
                {/* Map Settings */}
                <div className="relative">
                  <button
                    onClick={() => setActivePillDropdown(d => d === 'settings' ? null : 'settings')}
                    className="flex items-center justify-center rounded p-0.5 text-white hover:bg-white/20"
                    title="Map settings"
                  >
                    <SlidersHorizontal size={20} />
                  </button>
                  {activePillDropdown === 'settings' && (
                    <div className="absolute bottom-full left-0 z-50 mb-1 w-52 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                      <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={mapSettings.showTradeRoutes}
                          onChange={e => setMapSettings(s => ({ ...s, showTradeRoutes: e.target.checked }))}
                        />
                        Trade Routes
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={mapSettings.showHexGrid}
                          onChange={e => setMapSettings(s => ({ ...s, showHexGrid: e.target.checked }))}
                        />
                        Hex Grid
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={mapSettings.showFleets}
                          onChange={e => setMapSettings(s => ({ ...s, showFleets: e.target.checked }))}
                        />
                        Show Fleets
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                        <input
                          type="checkbox"
                          checked={mapSettings.fogOfWar}
                          onChange={e => setMapSettings(s => ({ ...s, fogOfWar: e.target.checked, fowPlayerId: null }))}
                        />
                        Fog of War
                      </label>
                      {mapSettings.fogOfWar && (
                        <>
                          <div className="px-4 py-1">
                            <select
                              value={mapSettings.fowPlayerId ?? ''}
                              onChange={e => setMapSettings(s => ({ ...s, fowPlayerId: e.target.value || null }))}
                              className="w-full rounded border border-gray-300 p-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            >
                              <option value="">Select player…</option>
                              {players.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          <label className="flex cursor-pointer items-center gap-2 px-6 py-1.5 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800">
                            <input
                              type="checkbox"
                              checked={mapSettings.blindExploration}
                              onChange={e => setMapSettings(s => ({ ...s, blindExploration: e.target.checked }))}
                            />
                            Blind Exploration
                          </label>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {/* Map Editing Mode */}
                <button
                  onClick={() => setMapEditingMode(o => !o)}
                  className="flex items-center justify-center rounded p-0.5 hover:bg-white/20"
                  title={mapEditingMode ? 'Exit map editing' : 'Map editing mode'}
                >
                  <Pencil size={20} className={mapEditingMode ? 'text-amber-400' : 'text-white'} />
                </button>
                {/* Capture button */}
                <CaptureButton
                  disabled={mapState.map.systems.length === 0}
                  onFullMap={() => captureHook.captureFullMap(svgRef, mapState.map, mapState.selectedSystemId, fowData)}
                  onClipMode={() => captureHook.enterClipMode()}
                  buttonClassName="flex items-center justify-center rounded p-0.5 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                  open={activePillDropdown === 'capture'}
                  onOpenChange={v => setActivePillDropdown(v ? 'capture' : null)}
                />
              </div>
            )}
          </div>

          {/* Property Panel (right sidebar) */}
          <PropertyPanel
            mapState={mapState}
            nameListHook={nameListHook}
            campaignMode={true}
            mapEditingMode={mapEditingMode}
            players={players}
            systemStatuses={phase === 'in_progress' ? systemStatuses : undefined}
            onSetSystemStatus={phase === 'in_progress' ? handleSetSystemStatus : undefined}
            fowData={fowData}
            onDeleteUnits={phase === 'in_progress' ? handleDeleteUnits : undefined}
            onCreateFleet={phase === 'in_progress' ? handleCreateFleet : undefined}
            onEditFleet={phase === 'in_progress' ? (pid, fid) => setEditingFleet({ playerId: pid, fleetId: fid }) : undefined}
            onMoveFleet={phase === 'in_progress' ? handleEnterFleetMoveMode : undefined}
            fleetDisplayOrder={mapState.selectedSystemId ? systemFleetOrder[mapState.selectedSystemId] : undefined}
            onReorderAnyFleet={phase === 'in_progress' && mapState.selectedSystemId ? (from, to) => handleReorderAnyFleet(mapState.selectedSystemId!, from, to) : undefined}
            onMoveUnitToFleet={phase === 'in_progress' ? handleMoveUnitToFleet : undefined}
            onMoveTemplateToFleet={phase === 'in_progress' ? handleMoveTemplateToFleet : undefined}
            systemOwnership={systemOwnership}
            onChangeSystemOwner={phase === 'in_progress' ? handleChangeSystemOwner : undefined}
            independentSystemColors={independentSystemColors}
            onSetIndependentSystemColor={phase === 'in_progress' ? handleSetIndependentSystemColor : undefined}
            cmFleets={cmFleets}
            independentLists={INDEPENDENT_UNIT_LISTS}
            onEditCMFleet={phase === 'in_progress' ? (id) => setEditingCMFleet(id) : undefined}
            onMoveCMFleet={phase === 'in_progress' ? handleEnterCMFleetMoveMode : undefined}
            onDeleteCMUnits={phase === 'in_progress' ? handleDeleteCMUnits : undefined}
            onMoveCMTemplateToFleet={phase === 'in_progress' ? (fromId, toId, templateId, count) => handleMoveCMTemplateToFleet(fromId, toId, templateId, '', count) : undefined}
          />

          {/* Add Units system pick mode banner */}
          {addUnitsPickMode && (
            <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-blue-300 bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
              <span>Click a system to select it for Add Units</span>
              <button
                onClick={() => { setAddUnitsPickMode(false); setShowAddUnits(true); }}
                className="rounded border border-blue-400 bg-blue-500 px-3 py-1 text-xs hover:bg-blue-400"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Floating back button when viewing map during unit purchase */}
          {unitPurchaseMapView && (
            <button
              onClick={() => setUnitPurchaseMapView(false)}
              className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <span>&#8592;</span>
              Back to Unit Purchases
            </button>
          )}

          {/* Floating phase navigation (intel phase main view, or any phase map view) */}
          {phase === 'in_progress' && !mapEditingMode && (currentTurnPhase === 'intel' || currentTurnPhase === 'movement' || currentTurnPhase === 'construction' || currentTurnPhase === 'combat' || currentTurnPhase === 'end_of_turn' || turnPhaseMapView) && (
            <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2">
              <button
                onClick={handleRevertToPreviousPhase}
                disabled={!canRevert}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium shadow-lg hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                ← Back
              </button>
              {turnPhaseMapView && (
                <button
                  onClick={() => setTurnPhaseMapView(false)}
                  className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium shadow-lg hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Return to {currentTurnPhaseLabel}
                </button>
              )}
              <button
                onClick={currentTurnPhase === 'economic' ? handleAdvanceEconomicPhase : handleAdvanceTurnPhase}
                className="rounded-lg border border-blue-600 bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-blue-700"
              >
                {currentTurnPhase === 'end_of_turn' ? 'End Turn →' : 'Advance Phase →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Espionage Player Select Modal */}
      {espionageFlow?.step === 'select_player' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h2 className="mb-4 text-base font-semibold dark:text-gray-100">Apply Espionage Mission — Select Player</h2>
            <div className="space-y-2">
              {players.map(p => (
                <button
                  key={p.id}
                  onClick={() => setEspionageFlow({ step: 'select_system', playerId: p.id })}
                  className="flex w-full items-center gap-3 rounded border border-gray-200 px-4 py-2.5 text-left text-sm hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {p.teamColor && (
                    <span className="inline-block h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                  )}
                  {p.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setEspionageFlow(null)}
              className="mt-4 w-full rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Fleet Move Mode indicator */}
      {fleetMoveMode && (() => {
        const p = players.find(pp => pp.id === fleetMoveMode.playerId);
        const f = (p?.fleets ?? []).find(ff => ff.id === fleetMoveMode.fleetId);
        return createPortal(
          <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-blue-300 bg-blue-600 px-5 py-2.5 text-sm text-white shadow-lg">
            <span>Moving fleet: <strong>{f?.name ?? '…'}</strong> — click a destination system</span>
            <button
              onClick={() => setFleetMoveMode(null)}
              className="ml-2 rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30"
            >
              Cancel
            </button>
          </div>,
          document.body
        );
      })()}

      {/* CM Fleet Move Mode indicator */}
      {cmFleetMoveMode && (() => {
        const f = cmFleets.find(ff => ff.id === cmFleetMoveMode);
        return createPortal(
          <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-gray-400 bg-gray-700 px-5 py-2.5 text-sm text-white shadow-lg">
            <span>Moving CM fleet: <strong>{f?.name ?? '…'}</strong> — click a destination system</span>
            <button
              onClick={() => setCmFleetMoveMode(null)}
              className="ml-2 rounded bg-white/20 px-3 py-1 text-xs hover:bg-white/30"
            >
              Cancel
            </button>
          </div>,
          document.body
        );
      })()}

      {/* Path Selection Modal */}
      {pathSelectModal && createPortal(
        <PathSelectModal
          paths={pathSelectModal.paths}
          map={mapState.map}
          onSelect={path => handleConfirmPath(path)}
          onCancel={() => setPathSelectModal(null)}
        />,
        document.body
      )}

      {/* Trade Route Manager fullscreen overlay (also mounted during pick mode so the floating panel renders) */}
      {(showTradeRouteManager || tradeRoutePickMode) && (
        <TradeRouteManagerView
          players={players}
          initialPlayerId={players[currentPlayerIndex]?.id}
          map={mapState.map}
          diplomacyRelations={diplomacyRelations}
          systemOwnership={systemOwnership}
          systemStatuses={systemStatuses}
          inPickMode={tradeRoutePickMode}
          pickedSystemId={tradeRoutePickedSystemId}
          onEnterPickMode={() => { setTradeRoutePickMode(true); setTradeRoutePickedSystemId(null); setShowTradeRouteManager(false); mapState.setSelectedSystemId(null); }}
          onExitPickMode={() => { setTradeRoutePickMode(false); setTradeRoutePickedSystemId(null); setShowTradeRouteManager(true); }}
          onSetTradeRoute={handleSetTradeRoute}
          onClearTradeRoute={handleClearTradeRoute}
          onRecallConvoy={handleRecallConvoy}
          onPickChainChange={setTradeRoutePickChain}
          onCenterSystem={(id) => { setShowTradeRouteManager(false); setTradeRoutePickMode(false); setTradeRoutePickChain([]); handleCenterAndSelectSystem(id); }}
          onClose={() => { setShowTradeRouteManager(false); setTradeRoutePickMode(false); setTradeRoutePickChain([]); }}
        />
      )}

      {/* Fleet Manager fullscreen overlay */}
      {showFleetManager && (
        <FleetManagerView
          players={players}
          map={mapState.map}
          initialPlayerId={fleetManagerFocus?.playerId}
          initialSystemId={fleetManagerFocus?.systemId}
          onClose={() => { setShowFleetManager(false); setFleetManagerFocus(null); }}
          onMoveUnitToFleet={handleMoveUnitToFleet}
          onAttachUnit={handleAttachUnit}
          onMoveTemplateToFleet={handleMoveTemplateToFleet}
          onCreateFleet={handleCreateFleet}
          onDeleteUnits={handleDeleteUnits}
          onReorderFleet={handleReorderFleet}
          onReorderUnit={handleReorderUnitInFleet}
          onEditFleet={(pid, fid) => { setShowFleetManager(false); setEditingFleet({ playerId: pid, fleetId: fid }); }}
          onMoveFleet={(pid, fid) => { setShowFleetManager(false); handleEnterFleetMoveMode(pid, fid); }}
          cmFleets={cmFleets}
          independentLists={INDEPENDENT_UNIT_LISTS}
          onEditCMFleet={(id) => { setShowFleetManager(false); setEditingCMFleet(id); }}
          onDeleteCMFleet={(id) => setCmFleets(prev => prev.filter(f => f.id !== id))}
          onMoveCMFleet={(id) => { setShowFleetManager(false); handleEnterCMFleetMoveMode(id); }}
          onUpdateCMFleetColor={(id, color) => setCmFleets(prev => prev.map(f => f.id === id ? { ...f, color } : f))}
          onDeleteCMUnits={handleDeleteCMUnits}
          onReorderCMUnit={handleReorderCMUnit}
          onAttachCMUnit={handleAttachCMUnit}
          onMoveCMUnitToFleet={handleMoveCMUnitToFleet}
          onMoveCMTemplateToFleet={handleMoveCMTemplateToFleet}
          turnOrders={turnOrders}
          onUpdateOrders={handleUpdateTurnOrders}
          onToggleUnitStatus={handleToggleUnitStatus}
        />
      )}

      {/* Systems Overview fullscreen overlay */}
      {showSystemsOverview && (
        <SystemsOverviewView
          map={mapState.map}
          players={players}
          systemOwnership={systemOwnership}
          systemStatuses={systemStatuses}
          onSelectSystem={(id) => { setShowSystemsOverview(false); handleCenterAndSelectSystem(id); }}
          onClose={() => setShowSystemsOverview(false)}
        />
      )}

      {/* Add Units fullscreen overlay */}
      {showAddUnits && (
        <AddUnitsView
          players={players}
          allPlayers={players}
          diplomacyRelations={diplomacyRelations}
          map={mapState.map}
          settings={settings}
          systemOwnership={systemOwnership}
          turnOrders={turnOrders}
          onUpdateOrders={handleUpdateTurnOrders}
          independentLists={INDEPENDENT_UNIT_LISTS}
          cmFleets={cmFleets}
          systemStatuses={systemStatuses}
          selectedSystemId={addUnitsSystemId}
          onSelectOnMap={handleEnterAddUnitsPickMode}
          onAddPlayerUnits={handleAddPlayerUnits}
          onAddCMUnits={handleAddCMUnits}
          onCreateCMFleet={(fleet) => setCmFleets(prev => [...prev, fleet])}
          onEditCMFleet={(id, updates) => setCmFleets(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f))}
          onDeleteCMFleet={(id) => setCmFleets(prev => prev.filter(f => f.id !== id))}
          onClose={() => setShowAddUnits(false)}
        />
      )}

      {/* Edit Fleet fullscreen overlay */}
      {editingFleet && (() => {
        const ep = players.find(p => p.id === editingFleet.playerId);
        const ef = (ep?.fleets ?? []).find(f => f.id === editingFleet.fleetId);
        if (!ep || !ef) return null;
        return (
          <EditFleetView
            fleet={ef}
            player={ep}
            allPlayers={players}
            map={mapState.map}
            onClose={() => setEditingFleet(null)}
            onRenameFleet={name => handleRenameFleet(ep.id, ef.id, name)}
            onMoveUnitToFleet={(unitId, newFleetId) => handleMoveUnitToFleet(ep.id, unitId, newFleetId)}
            onAttachUnit={(depId, carrierId) => handleAttachUnit(ep.id, depId, carrierId)}
            onDeleteFleet={() => handleDeleteFleet(ep.id, ef.id)}
            onDeleteUnits={(templateId, count) => handleDeleteUnits(
              ef.systemId,
              ef.id,
              templateId,
              count,
            )}
            onReorderUnit={(unitId, dir) => handleReorderUnitInFleet(ep.id, ef.id, unitId, dir)}
            onToggleUnitStatus={(unitId, status) => handleToggleUnitStatus(ep.id, unitId, status)}
          />
        );
      })()}

      {/* Edit CM Fleet fullscreen overlay */}
      {editingCMFleet && (() => {
        const cf = cmFleets.find(f => f.id === editingCMFleet);
        if (!cf) return null;
        const allIndieUnits = INDEPENDENT_UNIT_LISTS.flatMap(l => l.units);
        const asCampaignFleet = { id: cf.id, name: cf.name, systemId: cf.systemId ?? '', movedThisTurn: false };
        const otherFleetNames = cmFleets
          .filter(f => f.id !== cf.id && f.systemId === cf.systemId)
          .map(f => f.name);
        return (
          <EditFleetView
            fleet={asCampaignFleet}
            map={mapState.map}
            unitPool={allIndieUnits}
            directFleetUnits={cf.units}
            ownerLabel="Campaign Master"
            ownerColor={cf.color}
            fleetNamesToAvoid={otherFleetNames}
            onClose={() => setEditingCMFleet(null)}
            onRenameFleet={name => handleRenameCMFleet(editingCMFleet, name)}
            onAttachUnit={(depId, carrierId) => handleAttachCMUnit(editingCMFleet, depId, carrierId)}
            onDeleteFleet={() => handleDeleteEntireCMFleet(editingCMFleet)}
            onDeleteUnits={(templateId, count) => handleDeleteCMUnits(editingCMFleet, templateId, count)}
            onReorderUnit={(unitId, dir) => handleReorderCMUnit(editingCMFleet, unitId, dir)}
          />
        );
      })()}

      {/* Combat Scenario fullscreen overlay */}
      {openScenarioId && (() => {
        const scenario = activeCombatScenarios.find(s => s.id === openScenarioId);
        if (!scenario) return null;
        return (
          <CombatScenarioView
            scenario={scenario}
            players={players}
            map={mapState.map}
            diplomacyRelations={diplomacyRelations}
            systemOwnership={systemOwnership}
            onUpdate={handleUpdateScenario}
            onClose={() => setOpenScenarioId(null)}
          />
        );
      })()}

      {/* Misc Income Modal */}
      {showMiscIncomeModal && (
        <MiscIncomeModal
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={setCurrentPlayerIndex}
          onAddEntry={handleAddMiscEntry}
          onRemoveEntry={handleRemoveMiscEntry}
          onClose={() => setShowMiscIncomeModal(false)}
          currentTurn={currentTurn}
        />
      )}

      {/* Add to Tech Pool modal */}
      {showAddToTechPoolModal && (
        <AddToTechPoolModal
          players={players}
          onAdd={handleAddToTechPool}
          onClose={() => setShowAddToTechPoolModal(false)}
        />
      )}

      {/* Steal Unit Tech modal */}
      {showStealUnitTechModal && (
        <StealUnitTechModal
          players={players}
          onSteal={handleStealUnitTech}
          onClose={() => setShowStealUnitTechModal(false)}
        />
      )}

      {/* Transfer Unit modal */}
      {showTransferUnitModal && (
        <TransferUnitView
          players={players}
          map={mapState.map}
          onTransfer={handleTransferUnit}
          onClose={() => setShowTransferUnitModal(false)}
          cmFleets={cmFleets}
          systemOwnership={systemOwnership}
          onCMTransfer={handleCMTransfer}
        />
      )}

      {/* Trade Route Warning Modal */}
      {showTradeRouteWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
              <h2 className="text-base font-semibold text-amber-700 dark:text-amber-400">Trade Route Warnings</h2>
              <button onClick={() => setShowTradeRouteWarningModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">The following trade routes have issues. Routes are not automatically dissolved — review them manually.</p>
              <div className="space-y-2">
                {tradeRouteWarnings.map((w, i) => (
                  <div key={i} className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
                    <span className="font-medium text-amber-800 dark:text-amber-300">{w.routeOwnerName}</span>
                    <span className="text-amber-700 dark:text-amber-400"> — {w.reason}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowTradeRouteWarningModal(false)}
                  className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  Go Back
                </button>
                <button
                  onClick={handleAcknowledgeTradeRouteWarnings}
                  className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Acknowledge & Advance
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Force Tech Advancement modal */}
      {showForceAdvancementModal && (
        <ForceAdvancementModal
          players={players}
          settings={settings}
          independentListOverrides={independentUnitListOverrides}
          onUnlockUnit={handleForceTechUnlockUnit}
          onUpgradeUnit={handleForceTechUpgradeUnit}
          onUpgradeIndepUnit={handleForceIndepUpgradeUnit}
          onAddCustomUnit={handleAddCustomUnit}
          onClose={() => setShowForceAdvancementModal(false)}
        />
      )}

      {/* Turn History Browser fullscreen overlay */}
      {showHistoryBrowser && (
        <TurnHistoryBrowser
          history={campaignHistory}
          currentSnapshot={buildCurrentSnapshot()}
          players={players}
          map={mapState.map}
          onClose={() => setShowHistoryBrowser(false)}
        />
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        nameListHook={nameListHook}
        captureHook={captureHook}
      />

      {/* Clip Mode Panel */}
      {captureHook.clipModeActive && (
        <div className="absolute bottom-28 left-4 z-40">
          <ClipModePanel
            captureHook={captureHook}
            systems={mapState.map.systems}
            onCapture={() => captureHook.captureClipMap(svgRef, mapState.map)}
          />
        </div>
      )}

      {/* Capture toast — portal ensures it appears above fullscreen sub-views */}
      {captureHook.toastMessage && createPortal(
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-white/90 dark:text-gray-900">
          {captureHook.toastMessage}
        </div>,
        document.body,
      )}
    </div>
  );
}

// --- Path Selection Modal ---

function PathSelectModal({
  paths,
  map,
  onSelect,
  onCancel,
}: {
  paths: string[][];
  map: GameMap;
  onSelect: (path: string[]) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(0);

  const systemName = (id: string) => map.systems.find(s => s.id === id)?.name ?? id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-4 text-base font-semibold dark:text-gray-100">Multiple Routes Available</h2>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {paths.map((path, i) => (
            <label key={i} className="flex items-start gap-3 cursor-pointer rounded border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
              <input
                type="radio"
                name="path"
                checked={selected === i}
                onChange={() => setSelected(i)}
                className="mt-0.5 flex-shrink-0"
              />
              <span className="text-sm dark:text-gray-200">
                {path.map(systemName).join(' → ')}
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(paths[selected])}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Confirm Route
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Campaign Toolbar ---

const TURN_PHASES: { value: TurnPhase; label: string }[] = [
  { value: 'economic',     label: 'Economic Phase' },
  { value: 'turn_orders',  label: 'Turn Orders Phase' },
  { value: 'intel',        label: 'Intel Phase' },
  { value: 'movement',     label: 'Movement Phase' },
  { value: 'diplomacy',    label: 'Diplomacy Phase' },
  { value: 'combat',       label: 'Combat Phase' },
  { value: 'supply',       label: 'Supply Phase' },
  { value: 'construction', label: 'Construction Phase' },
  { value: 'tech',         label: 'Tech Phase' },
  { value: 'end_of_turn',  label: 'End of Turn Phase' },
];

interface CampaignToolbarProps {
  campaignName: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigateHome: () => void;
  currentTurn?: number;
  currentTurnPhaseLabel?: string;
  onAddMiscEntry?: () => void;
  espionageFlowActive?: boolean;
  onStartEspionage?: () => void;
  onCancelEspionage?: () => void;
  onOpenFleetManager?: () => void;
  onOpenTradeRoutes?: () => void;
  onOpenAddUnits?: () => void;
  onOpenTransferUnit?: () => void;
  onOpenAddToTechPool?: () => void;
  onOpenForceAdvancement?: () => void;
  onOpenSystems?: () => void;
  onExportSave?: () => void;
  onOpenHistory?: () => void;
  onOpenStealUnitTech?: () => void;
}

function CampaignToolbar({
  campaignName,
  theme,
  onToggleTheme,
  onNavigateHome,
  currentTurn,
  currentTurnPhaseLabel,
  onAddMiscEntry,
  espionageFlowActive,
  onStartEspionage,
  onCancelEspionage,
  onOpenFleetManager,
  onOpenTradeRoutes,
  onOpenAddUnits,
  onOpenTransferUnit,
  onOpenAddToTechPool,
  onOpenForceAdvancement,
  onOpenSystems,
  onExportSave,
  onOpenHistory,
  onOpenStealUnitTech,
}: CampaignToolbarProps) {
  const [activeDropdown, setActiveDropdown] = useState<'economy' | 'intel' | 'fleets' | 'tech' | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <div ref={toolbarRef} className="relative flex items-center justify-between border-b border-gray-300 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
      {/* Left section */}
      <div className="flex items-center gap-2">
        <button
          onClick={onNavigateHome}
          className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
          title="Return to Main Menu"
        >
          <Home size={16} className="shrink-0" />
          Home
        </button>
        <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
        {onExportSave && (
          <button
            onClick={onExportSave}
            className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
            title="Export campaign to file"
          >
            <Download size={16} className="shrink-0" />
            Export Save
          </button>
        )}
        {onOpenHistory && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            <button
              onClick={onOpenHistory}
              className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
              title="View campaign history"
            >
              <Clock size={16} className="shrink-0" />
              History
            </button>
          </>
        )}

        {/* Fleets dropdown (in_progress only) */}
        {(onOpenFleetManager || onOpenAddUnits || onOpenTransferUnit) && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(d => d === 'fleets' ? null : 'fleets')}
                className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
              >
                <Anchor size={16} className="shrink-0" />
                Fleets
                <svg className={`h-3 w-3 transition-transform ${activeDropdown === 'fleets' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {activeDropdown === 'fleets' && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[10rem] rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  {onOpenFleetManager && (
                    <button
                      onClick={() => { onOpenFleetManager(); setActiveDropdown(null); }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Fleet Manager
                    </button>
                  )}
                  {onOpenAddUnits && (
                    <button
                      onClick={() => { onOpenAddUnits(); setActiveDropdown(null); }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Add Units
                    </button>
                  )}
                  {onOpenTransferUnit && (
                    <button
                      onClick={() => { onOpenTransferUnit(); setActiveDropdown(null); }}
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Transfer Unit
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Campaign actions section */}
        {onAddMiscEntry && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(o => o === 'economy' ? null : 'economy')}
                className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
              >
                <TrendingUp size={16} className="shrink-0" />
                Economy
                <svg className={`h-3 w-3 transition-transform ${activeDropdown === 'economy' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {activeDropdown === 'economy' && (
                <div className="absolute left-0 z-50 mt-1 w-52 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  {onOpenTradeRoutes && (
                    <button
                      onClick={() => { setActiveDropdown(null); onOpenTradeRoutes(); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Manage Trade Routes
                    </button>
                  )}
                  <button
                    onClick={() => { setActiveDropdown(null); onAddMiscEntry(); }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Add Misc. Income/Expense
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Tech dropdown (always visible in in_progress) */}
        {(onOpenAddToTechPool || onOpenForceAdvancement) && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            <div className="relative">
              <button
                onClick={() => setActiveDropdown(o => o === 'tech' ? null : 'tech')}
                className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
              >
                <FlaskConical size={16} className="shrink-0" />
                Tech
                <svg className={`h-3 w-3 transition-transform ${activeDropdown === 'tech' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {activeDropdown === 'tech' && (
                <div className="absolute left-0 z-50 mt-1 w-52 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  {onOpenAddToTechPool && (
                    <button
                      onClick={() => { setActiveDropdown(null); onOpenAddToTechPool(); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Add/Remove from Tech Pool
                    </button>
                  )}
                  {onOpenForceAdvancement && (
                    <button
                      onClick={() => { setActiveDropdown(null); onOpenForceAdvancement(); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Force Tech Advancement
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Intel dropdown */}
        {onStartEspionage && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            {espionageFlowActive ? (
              <span className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                Click a system on the map…
                <button
                  onClick={onCancelEspionage}
                  className="rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-50 dark:hover:bg-amber-900/30"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setActiveDropdown(o => o === 'intel' ? null : 'intel')}
                  className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
                >
                  <Eye size={16} className="shrink-0" />
                  Intel
                  <svg className={`h-3 w-3 transition-transform ${activeDropdown === 'intel' ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {activeDropdown === 'intel' && (
                  <div className="absolute left-0 z-50 mt-1 w-56 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                    <button
                      onClick={() => { setActiveDropdown(null); onStartEspionage(); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Apply Espionage Mission
                    </button>
                    <button
                      onClick={() => { setActiveDropdown(null); onOpenStealUnitTech?.(); }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Steal Unit Tech
                    </button>
                    <button
                      disabled
                      className="w-full cursor-not-allowed px-4 py-2 text-left text-sm opacity-40 dark:text-gray-200"
                    >
                      Apply Tech Sabotage
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Systems button (always in in_progress) */}
        {onOpenSystems && (
          <>
            <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            <button
              onClick={onOpenSystems}
              className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
            >
              <Globe size={16} className="shrink-0" />
              Systems
            </button>
          </>
        )}
      </div>

      {/* Center: campaign name — absolutely centered so it's independent of left/right section widths */}
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-sm font-medium dark:text-gray-200">
        {campaignName}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        {/* Turn counter + phase label */}
        {currentTurn !== undefined && currentTurnPhaseLabel && (
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Turn {currentTurn} · {currentTurnPhaseLabel}
          </span>
        )}

        <button
          onClick={onToggleTheme}
          className="flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-200"
        >
          {theme === 'light'
            ? <><Sun size={16} className="shrink-0" />Light</>
            : <><Moon size={16} className="shrink-0" />Dark</>
          }
        </button>
      </div>
    </div>
  );
}

// --- Diplomacy helpers ---

const diplomacyKey = supplyDiplomacyKey;

function cooldownKey(ownerId: string, targetId: string): string {
  return `${ownerId}:${targetId}`;
}

/**
 * Returns the diplomatic contact level between two players:
 * - 'full': there is a path of non-unexplored lanes from p1's systems to p2's systems,
 *   not passing through systems owned by players at War or Hostilities with either side.
 * - 'limited': a unit with the Diplomatic trait from one player is at the other player's system.
 * - 'none': no contact.
 */
function computeDiplomaticContact(
  p1: CampaignPlayer,
  p2: CampaignPlayer,
  allPlayers: CampaignPlayer[],
  map: GameMap,
  getRelation: (id1: string, id2: string) => DiplomacyLevel,
): 'full' | 'limited' | 'none' {
  const p2Systems = new Set(p2.ownedSystemIds);

  // Systems owned by players hostile to either p1 or p2 block the BFS path
  const blockedSystems = new Set<string>();
  for (const other of allPlayers) {
    if (other.id === p1.id || other.id === p2.id) continue;
    const r1 = getRelation(other.id, p1.id);
    const r2 = getRelation(other.id, p2.id);
    if (r1 === 'War' || r1 === 'Hostilities' || r2 === 'War' || r2 === 'Hostilities') {
      for (const sysId of other.ownedSystemIds) blockedSystems.add(sysId);
    }
  }

  // BFS from p1's owned systems through non-unexplored lanes
  const visited = new Set<string>(p1.ownedSystemIds);
  const queue = [...p1.ownedSystemIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (p2Systems.has(current)) return 'full';
    for (const lane of map.jumpLanes) {
      if (lane.type === 'unexplored') continue;
      const neighbor = lane.from === current ? lane.to : lane.to === current ? lane.from : null;
      if (!neighbor || visited.has(neighbor) || blockedSystems.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }

  // Check for limited contact: Diplomatic-trait unit from one side at the other side's system
  const hasDiplUnit = (owner: CampaignPlayer, atPlayer: CampaignPlayer): boolean => {
    const targets = new Set(atPlayer.ownedSystemIds);
    return owner.units.some(u => {
      if (!u.systemId || !targets.has(u.systemId)) return false;
      return resolveUnitTemplate(owner, u.unitTemplateId, allPlayers)?.traits.some(tr => tr.name === 'Diplomatic') ?? false;
    });
  };
  if (hasDiplUnit(p1, p2) || hasDiplUnit(p2, p1)) return 'limited';

  return 'none';
}

// --- Turn phase order helpers ---

const TURN_PHASE_ORDER: TurnPhase[] = [
  'economic', 'turn_orders', 'intel', 'movement', 'diplomacy',
  'combat', 'supply', 'construction', 'tech', 'end_of_turn',
];

function getTurnPhaseAfter(p: TurnPhase): TurnPhase | null {
  const idx = TURN_PHASE_ORDER.indexOf(p);
  return idx >= 0 && idx < TURN_PHASE_ORDER.length - 1 ? TURN_PHASE_ORDER[idx + 1] : null;
}

// --- Turn Orders Phase ---

const EMPTY_ORDER_ENTRY: TurnOrderEntry = {
  fleetDeployment: '', intel: '', movement: '', diplomatic: '', construction: '', investment: '',
  epSpent: 0,
};

const ORDER_FIELDS: { key: keyof TurnOrderEntry; playerLabel: string; cmLabel: string }[] = [
  { key: 'fleetDeployment', playerLabel: 'Fleet Deployment Orders', cmLabel: 'Fleet Deployment Notes' },
  { key: 'intel',           playerLabel: 'Intel Orders',            cmLabel: 'Intel Notes' },
  { key: 'movement',        playerLabel: 'Movement Orders',         cmLabel: 'Movement Notes' },
  { key: 'diplomatic',      playerLabel: 'Diplomatic Orders',       cmLabel: 'Diplomatic Notes' },
  { key: 'construction',    playerLabel: 'Construction Orders',     cmLabel: 'Construction Notes' },
  { key: 'investment',      playerLabel: 'Investment Orders',       cmLabel: 'Investment Notes' },
];

interface TurnOrdersPhaseViewProps {
  players: CampaignPlayer[];
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  onSetTechInvestment: (playerId: string, amount: number) => void;
  currentTurn: number;
  onAdvancePhase: () => void;
  onRevertPhase: () => void;
  onViewMap: () => void;
  canRevert: boolean;
}

function TurnOrdersPhaseView({
  players,
  turnOrders,
  onUpdateOrders,
  onSetTechInvestment,
  currentTurn,
  onAdvancePhase,
  onRevertPhase,
  onViewMap,
  canRevert,
}: TurnOrdersPhaseViewProps) {
  // Tab indices 0..N-1 = players, N = CM
  const [activeTab, setActiveTab] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const cmTabIndex = players.length;
  const isCM = activeTab === cmTabIndex;

  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-gray-900">
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <button
          onClick={onRevertPhase}
          disabled={!canRevert}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <h2 className="text-base font-semibold dark:text-gray-100">
          Turn Orders Phase — Turn {currentTurn}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onViewMap}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Map View
          </button>
          <button
            onClick={() => {
              const overBudget = players.filter(p => ((turnOrders[p.id]?.epSpent ?? 0) + (p.techInvestment ?? 0)) > p.ep);
              if (overBudget.length > 0) {
                setValidationError(`Total EP Spent (including Tech Investment) exceeds available EP for: ${overBudget.map(p => p.name).join(', ')}`);
                return;
              }
              setValidationError(null);
              onAdvancePhase();
            }}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Advance Phase →
          </button>
        </div>
      </div>

      {/* Validation error banner */}
      {validationError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {validationError}
        </div>
      )}

      {/* Player + CM tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            className={`flex items-center gap-2 px-4 py-2 text-sm ${
              activeTab === i
                ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {p.teamColor && (
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
            )}
            <span className="flex flex-col items-start leading-tight">
              <span>{p.name}</span>
              <span className="text-[11px] font-normal opacity-60">{p.empire.name}</span>
            </span>
          </button>
        ))}
        <button
          onClick={() => setActiveTab(cmTabIndex)}
          className={`flex items-center gap-2 px-4 py-2 text-sm ${
            isCM
              ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
          CM
        </button>
      </div>

      {/* Order / Notes fields */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {ORDER_FIELDS.map(field => (
            <div key={field.key}>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {isCM ? field.cmLabel : field.playerLabel}
              </label>
              <textarea
                className="h-20 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry[field.key as keyof TurnOrderEntry] as string}
                onChange={e => onUpdateOrders(activeKey, { ...entry, [field.key]: e.target.value })}
                placeholder={isCM ? `${field.cmLabel}…` : `${field.playerLabel}…`}
              />
            </div>
          ))}

          {/* Tech Investment + EP Budget section (player tabs only) */}
          {!isCM && (() => {
            const player = players[activeTab];
            if (!player) return null;
            const spent = entry.epSpent ?? 0;
            const techInvest = player.techInvestment ?? 0;
            const totalSpent = spent + techInvest;
            const overBudget = totalSpent > player.ep;
            const income = player.currentTurnSystemIncome ?? 0;
            const tac = computeTAC(income, player.empire.advantages as string[], player.empire.disadvantage);
            const overHalfIncome = techInvest > Math.floor(income / 2);
            return (
              <div className="space-y-3">
                <div className="rounded border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
                  <h3 className="mb-3 text-sm font-semibold text-blue-700 dark:text-blue-300">Tech Investment</h3>
                  <div className="mb-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
                    <span>Tech Pool: <span className="font-semibold text-gray-900 dark:text-gray-100">{player.techPool ?? 0} EP</span></span>
                    <span>TAC: <span className="font-semibold text-gray-900 dark:text-gray-100">{income > 0 ? tac : '—'} EP</span></span>
                    {income === 0 && <span className="text-xs text-gray-400">(Advance Economic Phase first to compute TAC)</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-600 dark:text-gray-400">Invest this turn:</label>
                    <input
                      type="number"
                      min={0}
                      value={techInvest}
                      onChange={e => onSetTechInvestment(player.id, parseInt(e.target.value) || 0)}
                      className="w-24 rounded border border-gray-300 p-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <span className="text-xs text-gray-400">EP</span>
                  </div>
                  {overHalfIncome && income > 0 && (
                    <p className="mt-2 text-xs text-orange-600 dark:text-orange-400">
                      Warning: Tech Investment exceeds 50% of system income this turn ({Math.floor(income / 2)} EP max recommended).
                    </p>
                  )}
                </div>

                <div className="rounded border border-gray-200 bg-gray-50 px-4 pt-4 pb-6 dark:border-gray-700 dark:bg-gray-800">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">EP Budget</h3>
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Available EP: <span className="font-semibold text-gray-900 dark:text-gray-100">{player.ep}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600 dark:text-gray-400">Total EP Spent:</label>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          value={totalSpent}
                          onChange={e => {
                            setValidationError(null);
                            const total = Math.max(0, parseInt(e.target.value) || 0);
                            onUpdateOrders(activeKey, { ...entry, epSpent: Math.max(0, total - techInvest) });
                          }}
                          className={`w-24 rounded border p-1 text-sm ${
                            overBudget
                              ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-600 dark:bg-red-900/30 dark:text-red-400'
                              : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
                          }`}
                        />
                        {techInvest > 0 && (
                          <span className="absolute left-0 top-full mt-0.5 whitespace-nowrap text-xs text-blue-600 dark:text-blue-400">
                            +Tech: {techInvest} EP
                          </span>
                        )}
                      </div>
                      {overBudget && (
                        <span className="text-xs text-red-600 dark:text-red-400">Exceeds available EP</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// --- Intel Phase Panel ---

interface IntelPhasePanelProps {
  players: CampaignPlayer[];
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  intelChecks: Record<string, Array<{ checked: boolean; xed: boolean }>>;
  onUpdateIntelChecks: (key: string, checks: Array<{ checked: boolean; xed: boolean }>) => void;
}

function IntelPhasePanel({
  players,
  turnOrders,
  onUpdateOrders,
  intelChecks,
  onUpdateIntelChecks,
}: IntelPhasePanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const cmTabIndex = players.length;
  const { ref: tabBarRef, onMouseDown: tabBarMouseDown, onClickCapture: tabBarClickCapture } = useDragScroll();
  const isCM = activeTab === cmTabIndex;

  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  // Edit mode per tab
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const isEditing = editMode[activeKey] ?? false;

  const intelText = entry.intel;
  const lines = intelText.split('\n').filter(l => l.trim() !== '');
  const checks = intelChecks[activeKey] ?? [];

  const handleDoneEditing = () => {
    setEditMode(prev => ({ ...prev, [activeKey]: false }));
    // Reset checks for this tab since text may have changed
    onUpdateIntelChecks(activeKey, []);
  };

  const toggleCheck = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    onUpdateIntelChecks(activeKey, updated);
  };

  const toggleXed = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    onUpdateIntelChecks(activeKey, updated);
  };

  return (
    <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Tab bar */}
      <div ref={tabBarRef} onMouseDown={tabBarMouseDown} onClickCapture={tabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            title={`${p.name} (${p.empire.name})`}
            className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
              activeTab === i
                ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {p.teamColor && (
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
            )}
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(cmTabIndex)}
          className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
            isCM
              ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
          CM
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isCM ? (
          // CM tab: directly editable Intel Notes
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Intel Notes
            </label>
            <textarea
              className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              value={entry.intel}
              onChange={e => onUpdateOrders(activeKey, { ...entry, intel: e.target.value })}
              placeholder="CM intel notes…"
            />
          </div>
        ) : (
          // Player tab: Intel Orders checklist or edit mode
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Intel Orders
              </span>
              {isEditing ? (
                <button
                  onClick={handleDoneEditing}
                  className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Done
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(prev => ({ ...prev, [activeKey]: true }))}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <textarea
                className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry.intel}
                onChange={e => onUpdateOrders(activeKey, { ...entry, intel: e.target.value })}
                placeholder="One order per line…"
                autoFocus
              />
            ) : lines.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No intel orders</p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((line, i) => {
                  const state = checks[i] ?? { checked: false, xed: false };
                  return (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleCheck(i)}
                        disabled={state.xed}
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                          state.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                        } ${state.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                        title={state.xed ? 'Cannot check — X is active' : state.checked ? 'Uncheck' : 'Check'}
                      >
                        {state.checked ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect width="16" height="16" rx="2" fill="currentColor" />
                            <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" fill="white" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </button>
                      {/* Line text */}
                      <span className={`min-w-0 flex-1 break-words text-sm ${
                        state.checked ? 'text-green-600 line-through dark:text-green-500' :
                        state.xed ? 'text-red-600 line-through dark:text-red-500' :
                        'dark:text-gray-200'
                      }`}>
                        {line}
                      </span>
                      {/* X button */}
                      <button
                        onClick={() => toggleXed(i)}
                        disabled={state.checked}
                        className={`mt-0.5 flex-shrink-0 text-sm leading-none ${
                          state.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
                        } ${state.xed ? 'font-bold text-red-600 dark:text-red-500' : 'text-gray-300 hover:text-red-500 dark:text-gray-600'}`}
                        title={state.checked ? 'Cannot X — checkbox is active' : state.xed ? 'Remove X' : 'Mark as failed'}
                      >
                        ✗
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// --- End of Turn Phase Panel ---

interface EndOfTurnPhasePanelProps {
  players: CampaignPlayer[];
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  investmentChecks: Record<string, Array<{ checked: boolean; xed: boolean }>>;
  onUpdateInvestmentChecks: (key: string, checks: Array<{ checked: boolean; xed: boolean }>) => void;
  map: GameMap;
  systemStatuses: Record<string, SystemCampaignStatus>;
  systemOwnership: Record<string, string>;
  onSelectSystem: (systemId: string) => void;
}

function EndOfTurnPhasePanel({
  players,
  turnOrders,
  onUpdateOrders,
  investmentChecks,
  onUpdateInvestmentChecks,
  map,
  systemStatuses,
  systemOwnership,
  onSelectSystem,
}: EndOfTurnPhasePanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const cmTabIndex = players.length;
  const { ref: tabBarRef, onMouseDown: tabBarMouseDown, onClickCapture: tabBarClickCapture } = useDragScroll();
  const isCM = activeTab === cmTabIndex;

  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  // Edit mode per tab
  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const isEditing = editMode[activeKey] ?? false;

  const investmentText = entry.investment;
  const lines = investmentText.split('\n').filter(l => l.trim() !== '');
  const checks = investmentChecks[activeKey] ?? [];

  const handleDoneEditing = () => {
    setEditMode(prev => ({ ...prev, [activeKey]: false }));
    onUpdateInvestmentChecks(activeKey, []);
  };

  const toggleCheck = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    onUpdateInvestmentChecks(activeKey, updated);
  };

  const toggleXed = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    onUpdateInvestmentChecks(activeKey, updated);
  };

  // Morale check: player-owned systems with hasEnemyFleet or inOpposition
  const [moraleResolved, setMoraleResolved] = useState<Record<string, boolean>>({});
  const moraleCheckSystems = useMemo(() => {
    return map.systems.filter(sys => {
      const ownerId = systemOwnership[sys.id];
      if (!ownerId) return false; // unowned — skip
      const status = systemStatuses[sys.id];
      if (!status) return false;
      return (status.hasEnemyFleet ?? false) || (status.inOpposition ?? false);
    });
  }, [map.systems, systemOwnership, systemStatuses]);

  return (
    <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Tab bar */}
      <div ref={tabBarRef} onMouseDown={tabBarMouseDown} onClickCapture={tabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            title={`${p.name} (${p.empire.name})`}
            className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
              activeTab === i
                ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {p.teamColor && (
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
            )}
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(cmTabIndex)}
          className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
            isCM
              ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
          CM
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isCM ? (
          // CM tab: Investment Notes + Morale Checks
          <div className="space-y-6">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Investment Notes
              </label>
              <textarea
                className="h-40 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry.investment}
                onChange={e => onUpdateOrders(activeKey, { ...entry, investment: e.target.value })}
                placeholder="CM investment notes…"
              />
            </div>

            {/* Morale Check section */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Morale Checks
              </label>
              {moraleCheckSystems.length === 0 ? (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">No systems require morale checks</p>
              ) : (
                <ul className="space-y-1.5">
                  {moraleCheckSystems.map(sys => {
                    const ownerId = systemOwnership[sys.id];
                    const owner = players.find(p => p.id === ownerId);
                    const resolved = moraleResolved[sys.id] ?? false;
                    return (
                      <li key={sys.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={resolved}
                          onChange={() => setMoraleResolved(prev => ({ ...prev, [sys.id]: !prev[sys.id] }))}
                          className="h-4 w-4 cursor-pointer rounded"
                        />
                        <button
                          onClick={() => onSelectSystem(sys.id)}
                          className={`text-sm ${resolved ? 'text-gray-400 line-through dark:text-gray-500' : 'cursor-pointer text-blue-600 hover:underline dark:text-blue-400'}`}
                        >
                          {sys.name || sys.id}
                        </button>
                        {owner && owner.teamColor && (
                          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: owner.teamColor }} title={owner.name} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : (
          // Player tab: Investment Orders checklist or edit mode
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Investment Orders
              </span>
              {isEditing ? (
                <button
                  onClick={handleDoneEditing}
                  className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Done
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(prev => ({ ...prev, [activeKey]: true }))}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <textarea
                className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry.investment}
                onChange={e => onUpdateOrders(activeKey, { ...entry, investment: e.target.value })}
                placeholder="One order per line…"
                autoFocus
              />
            ) : lines.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No investment orders</p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((line, i) => {
                  const state = checks[i] ?? { checked: false, xed: false };
                  return (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleCheck(i)}
                        disabled={state.xed}
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                          state.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                        } ${state.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                        title={state.xed ? 'Cannot check — X is active' : state.checked ? 'Uncheck' : 'Check'}
                      >
                        {state.checked ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect width="16" height="16" rx="2" fill="currentColor" />
                            <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" fill="white" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </button>
                      {/* Line text */}
                      <span className={`min-w-0 flex-1 break-words text-sm ${
                        state.checked ? 'text-green-600 line-through dark:text-green-500' :
                        state.xed ? 'text-red-600 line-through dark:text-red-500' :
                        'dark:text-gray-200'
                      }`}>
                        {line}
                      </span>
                      {/* X button */}
                      <button
                        onClick={() => toggleXed(i)}
                        disabled={state.checked}
                        className={`mt-0.5 flex-shrink-0 text-sm leading-none ${
                          state.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
                        } ${state.xed ? 'font-bold text-red-600 dark:text-red-500' : 'text-gray-300 hover:text-red-500 dark:text-gray-600'}`}
                        title={state.checked ? 'Cannot X — checkbox is active' : state.xed ? 'Remove X' : 'Mark as failed'}
                      >
                        &#10007;
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Movement Phase Panel ---

interface MovementPhasePanelProps {
  players: CampaignPlayer[];
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  movementChecks: Record<string, Array<{ checked: boolean; xed: boolean }>>;
  onUpdateMovementChecks: (key: string, checks: Array<{ checked: boolean; xed: boolean }>) => void;
  map: GameMap;
  systemStatuses: Record<string, SystemCampaignStatus>;
}

function MovementPhasePanel({
  players,
  turnOrders,
  onUpdateOrders,
  movementChecks,
  onUpdateMovementChecks,
  map,
  systemStatuses,
}: MovementPhasePanelProps) {
  const cmTabIndex = players.length;
  const [activeTab, setActiveTab] = useState(0);
  const { ref: tabBarRef, onMouseDown: tabBarMouseDown, onClickCapture: tabBarClickCapture } = useDragScroll();

  const isCM = activeTab === cmTabIndex;
  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const isEditing = editMode[activeKey] ?? false;

  const movementText = entry.movement;
  const lines = movementText.split('\n').filter(l => l.trim() !== '');
  const checks = movementChecks[activeKey] ?? [];

  const handleDoneEditing = () => {
    setEditMode(prev => ({ ...prev, [activeKey]: false }));
    onUpdateMovementChecks(activeKey, []);
  };

  const toggleCheck = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    onUpdateMovementChecks(activeKey, updated);
  };

  const toggleXed = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    onUpdateMovementChecks(activeKey, updated);
  };

  return (
    <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Tab bar */}
      <div ref={tabBarRef} onMouseDown={tabBarMouseDown} onClickCapture={tabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            title={`${p.name} (${p.empire.name})`}
            className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
              activeTab === i
                ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {p.teamColor && (
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
            )}
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(cmTabIndex)}
          className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
            isCM
              ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
          CM
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isCM ? (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Movement Notes
            </label>
            <textarea
              className="h-48 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              value={entry.movement}
              onChange={e => onUpdateOrders(activeKey, { ...entry, movement: e.target.value })}
              placeholder="CM movement notes…"
            />
            {/* Raider checks */}
            <div className="mt-4 space-y-1">
              {players.map(player => {
                const atRiskMap = new Map<string, Set<string>>();
                for (const unit of player.units) {
                  if (!unit.systemId) continue;
                  const t = resolveUnitTemplate(player, unit.unitTemplateId, players);
                  if (t?.category === 'Civilian' && t?.name === 'Convoy') {
                    if (!atRiskMap.has(unit.systemId)) atRiskMap.set(unit.systemId, new Set());
                    atRiskMap.get(unit.systemId)!.add('Convoy');
                  }
                }
                for (const route of player.tradeRoutes ?? []) {
                  for (const sid of route.systemIds) {
                    if (!atRiskMap.has(sid)) atRiskMap.set(sid, new Set());
                    atRiskMap.get(sid)!.add('Trade Route');
                  }
                }
                const riskEntries: Array<{ id: string; name: string; reasons: string[] }> = [];
                for (const [sid, reasons] of atRiskMap) {
                  const sys = map.systems.find(s => s.id === sid);
                  if (!sys) continue;
                  if ((sys.attributes?.population ?? 0) >= 5) continue;
                  const pop = sys.attributes?.population ?? 0;
                  const raw = sys.attributes?.raw ?? 0;
                  let policeTotal = 0;
                  for (const p of players) {
                    for (const u of p.units) {
                      if (u.systemId !== sid) continue;
                      const t = resolveUnitTemplate(p, u.unitTemplateId, players);
                      if (t?.traits.some(tr => tr.name === 'Police')) policeTotal += t.cost;
                    }
                  }
                  if (policeTotal >= pop * raw) continue;
                  riskEntries.push({ id: sid, name: sys.name, reasons: [...reasons] });
                }
                return (
                  <div key={player.id}>
                    <div className="mt-3 mb-1 flex items-center gap-1.5 text-sm font-semibold dark:text-gray-100">
                      {player.teamColor && (
                        <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: player.teamColor }} />
                      )}
                      {player.name}
                    </div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Raider Check Required
                    </div>
                    {riskEntries.length === 0 ? (
                      <p className="text-xs italic text-gray-400 dark:text-gray-500">No systems require a raider check.</p>
                    ) : (
                      <div className="space-y-1">
                        {riskEntries.map(riskEntry => (
                          <div key={riskEntry.id} className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm dark:text-gray-200">{riskEntry.name}</span>
                            {riskEntry.reasons.map(r => (
                              <span key={r} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                                {r}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Guaranteed Pirate Raid
              </div>
              {(() => {
                const guaranteed = map.systems.filter(s => systemStatuses[s.id]?.guaranteedPirateRaid === true);
                return guaranteed.length === 0 ? (
                  <p className="text-xs italic text-gray-400 dark:text-gray-500">No guaranteed pirate raids.</p>
                ) : (
                  <div className="mt-1 space-y-1">
                    {guaranteed.map(s => (
                      <div key={s.id} className="text-sm dark:text-gray-200">{s.name}</div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Movement Orders
              </span>
              {isEditing ? (
                <button
                  onClick={handleDoneEditing}
                  className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Done
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(prev => ({ ...prev, [activeKey]: true }))}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <textarea
                className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry.movement}
                onChange={e => onUpdateOrders(activeKey, { ...entry, movement: e.target.value })}
                placeholder="One order per line…"
                autoFocus
              />
            ) : lines.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No movement orders</p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((line, i) => {
                  const state = checks[i] ?? { checked: false, xed: false };
                  return (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      <button
                        onClick={() => toggleCheck(i)}
                        disabled={state.xed}
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                          state.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                        } ${state.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                        title={state.xed ? 'Cannot check — X is active' : state.checked ? 'Uncheck' : 'Check'}
                      >
                        {state.checked ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect width="16" height="16" rx="2" fill="currentColor" />
                            <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" fill="white" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </button>
                      <span className={`min-w-0 flex-1 break-words text-sm ${
                        state.checked ? 'text-green-600 line-through dark:text-green-500' :
                        state.xed ? 'text-red-600 line-through dark:text-red-500' :
                        'dark:text-gray-200'
                      }`}>
                        {line}
                      </span>
                      <button
                        onClick={() => toggleXed(i)}
                        disabled={state.checked}
                        className={`mt-0.5 flex-shrink-0 text-sm leading-none ${
                          state.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
                        } ${state.xed ? 'font-bold text-red-600 dark:text-red-500' : 'text-gray-300 hover:text-red-500 dark:text-gray-600'}`}
                        title={state.checked ? 'Cannot X — checkbox is active' : state.xed ? 'Remove X' : 'Mark as failed'}
                      >
                        ✗
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Diplomacy Phase View ---

const DIPLOMACY_LEVELS: DiplomacyLevel[] = [
  'Unmet', 'War', 'Hostilities', 'Neutral', 'NonAggression', 'Trade', 'MutualDefense', 'Alliance',
];

const DIPLOMACY_LEVEL_LABELS: Record<DiplomacyLevel, string> = {
  Unmet: 'Unmet',
  War: 'War',
  Hostilities: 'Hostilities',
  Neutral: 'Neutral',
  NonAggression: 'Non-Aggression Pact',
  Trade: 'Trade Agreement',
  MutualDefense: 'Mutual Defense Pact',
  Alliance: 'Alliance',
};

const CONTACT_BADGE: Record<'full' | 'limited' | 'none', { label: string; cls: string }> = {
  full:    { label: 'Full Contact', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' },
  limited: { label: 'Limited',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
  none:    { label: 'No Contact',   cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700/60 dark:text-gray-400' },
};

interface DiplomacyPhaseViewProps {
  players: CampaignPlayer[];
  systemOwnership: Record<string, string>;
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  diplomacyChecks: Record<string, Array<{ checked: boolean; xed: boolean }>>;
  onUpdateDiplomacyChecks: (key: string, checks: Array<{ checked: boolean; xed: boolean }>) => void;
  diplomacyRelations: Record<string, DiplomacyLevel>;
  onSetRelation: (p1Id: string, p2Id: string, level: DiplomacyLevel) => void;
  diplomacyCooldowns: Record<string, number>;
  onSetCooldown: (ownerId: string, targetId: string, value: number) => void;
  map: GameMap;
  onViewMap: () => void;
  onAdvance: () => void;
  canRevert: boolean;
  onRevert: () => void;
  currentTurn: number;
}

function DiplomacyPhaseView({
  players,
  systemOwnership,
  turnOrders,
  onUpdateOrders,
  diplomacyChecks,
  onUpdateDiplomacyChecks,
  diplomacyRelations,
  onSetRelation,
  diplomacyCooldowns,
  onSetCooldown,
  map,
  onViewMap,
  onAdvance,
  canRevert,
  onRevert,
  currentTurn,
}: DiplomacyPhaseViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  const cmTabIndex = players.length;
  const { ref: tabBarRef, onMouseDown: tabBarMouseDown, onClickCapture: tabBarClickCapture } = useDragScroll();
  const isCM = activeTab === cmTabIndex;
  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const isEditing = editMode[activeKey] ?? false;

  const diplomaticText = entry.diplomatic;
  const lines = diplomaticText.split('\n').filter(l => l.trim() !== '');
  const checks = diplomacyChecks[activeKey] ?? [];

  const getRelation = (p1Id: string, p2Id: string): DiplomacyLevel =>
    diplomacyRelations[diplomacyKey(p1Id, p2Id)] ?? 'Unmet';

  const getContact = (p1: CampaignPlayer, p2: CampaignPlayer) =>
    computeDiplomaticContact(p1, p2, players, map, getRelation);

  const getCooldown = (ownerId: string, targetId: string): number =>
    diplomacyCooldowns[cooldownKey(ownerId, targetId)] ?? 0;

  const handleDoneEditing = () => {
    setEditMode(prev => ({ ...prev, [activeKey]: false }));
    onUpdateDiplomacyChecks(activeKey, []);
  };

  const toggleCheck = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    onUpdateDiplomacyChecks(activeKey, updated);
  };

  const toggleXed = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    onUpdateDiplomacyChecks(activeKey, updated);
  };

  const getTraitBadges = (player: CampaignPlayer) => {
    const badges: { label: string; color: string }[] = [];
    if (player.empire.advantages.includes('Charismatic'))
      badges.push({ label: 'Charismatic', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' });
    if (player.empire.advantages.includes('Aggressive'))
      badges.push({ label: 'Aggressive', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' });
    if (player.empire.disadvantage === 'Xenophobic')
      badges.push({ label: 'Xenophobic', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' });
    return badges;
  };

  // First Contact: systems where unmet parties share a presence
  type FirstContactEntry =
    | { kind: 'player-player'; id: string; name: string; presentPlayers: CampaignPlayer[] }
    | { kind: 'player-independent'; id: string; name: string; independentId: string; independentName: string };
  const firstContactSystems: FirstContactEntry[] = [];
  for (const sys of map.systems) {
    const ownerId = systemOwnership[sys.id];
    if (ownerId && isIndependentId(ownerId)) {
      // player-independent: any player with presence (fleet units) and Unmet relation to this independent
      const presentPlayerIds = new Set<string>();
      for (const p of players) {
        if (p.units.some(u => u.systemId === sys.id)) presentPlayerIds.add(p.id);
      }
      const hasUnmetPlayer = players.some(
        p => presentPlayerIds.has(p.id) && getRelation(p.id, ownerId) === 'Unmet'
      );
      if (hasUnmetPlayer) {
        firstContactSystems.push({
          kind: 'player-independent',
          id: sys.id,
          name: sys.name,
          independentId: ownerId,
          independentName: getIndependentSystemName(ownerId, map),
        });
      }
    } else {
      // player-player: two or more unmet players with a presence (fleet or ownership)
      const presentIds = new Set<string>();
      if (ownerId) presentIds.add(ownerId);
      for (const p of players) {
        if (p.units.some(u => u.systemId === sys.id)) presentIds.add(p.id);
      }
      const present = players.filter(p => presentIds.has(p.id));
      let hasUnmet = false;
      outer: for (let i = 0; i < present.length; i++) {
        for (let j = i + 1; j < present.length; j++) {
          if (getRelation(present[i].id, present[j].id) === 'Unmet') { hasUnmet = true; break outer; }
        }
      }
      if (hasUnmet) firstContactSystems.push({ kind: 'player-player', id: sys.id, name: sys.name, presentPlayers: present });
    }
  }

  const activePlayer = players[activeTab];

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-gray-900">
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <button
          onClick={onRevert}
          disabled={!canRevert}
          className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <h2 className="text-base font-semibold dark:text-gray-100">
          Diplomacy Phase — Turn {currentTurn}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onViewMap}
            className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Map View
          </button>
          <button
            onClick={onAdvance}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Advance Phase →
          </button>
        </div>
      </div>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
          {/* Tab bar */}
          <div ref={tabBarRef} onMouseDown={tabBarMouseDown} onClickCapture={tabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
            {players.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActiveTab(i)}
                className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
                  activeTab === i
                    ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
                title={`${p.name} (${p.empire.name})`}
              >
                {p.teamColor && (
                  <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                )}
                {p.name}
              </button>
            ))}
            <button
              onClick={() => setActiveTab(cmTabIndex)}
              className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
                isCM
                  ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
              CM
            </button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto p-4">
            {isCM ? (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Diplomacy Notes
                </label>
                <textarea
                  className="h-48 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  value={entry.diplomatic}
                  onChange={e => onUpdateOrders(activeKey, { ...entry, diplomatic: e.target.value })}
                  placeholder="CM diplomacy notes…"
                />
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Diplomacy Orders
                  </span>
                  {isEditing ? (
                    <button
                      onClick={handleDoneEditing}
                      className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => setEditMode(prev => ({ ...prev, [activeKey]: true }))}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <textarea
                    className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    value={entry.diplomatic}
                    onChange={e => onUpdateOrders(activeKey, { ...entry, diplomatic: e.target.value })}
                    placeholder="One order per line…"
                    autoFocus
                  />
                ) : lines.length === 0 ? (
                  <p className="text-sm italic text-gray-400 dark:text-gray-500">No diplomacy orders</p>
                ) : (
                  <ul className="space-y-1.5">
                    {lines.map((line, i) => {
                      const state = checks[i] ?? { checked: false, xed: false };
                      return (
                        <li key={i} className="flex min-w-0 items-start gap-2">
                          <button
                            onClick={() => toggleCheck(i)}
                            disabled={state.xed}
                            className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                              state.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                            } ${state.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                            title={state.xed ? 'Cannot check — X is active' : state.checked ? 'Uncheck' : 'Check'}
                          >
                            {state.checked ? (
                              <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                                <rect width="16" height="16" rx="2" fill="currentColor" />
                                <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" fill="white" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                                <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            )}
                          </button>
                          <span className={`min-w-0 flex-1 break-words text-sm ${
                            state.checked ? 'text-green-600 line-through dark:text-green-500' :
                            state.xed ? 'text-red-600 line-through dark:text-red-500' :
                            'dark:text-gray-200'
                          }`}>
                            {line}
                          </span>
                          <button
                            onClick={() => toggleXed(i)}
                            disabled={state.checked}
                            className={`mt-0.5 flex-shrink-0 text-sm leading-none ${
                              state.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
                            } ${state.xed ? 'font-bold text-red-600 dark:text-red-500' : 'text-gray-300 hover:text-red-500 dark:text-gray-600'}`}
                            title={state.checked ? 'Cannot X — checkbox is active' : state.xed ? 'Remove X' : 'Mark as failed'}
                          >
                            ✗
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* First Contact section */}
                {(() => {
                  const relevantContacts = firstContactSystems.filter(fc => {
                    if (fc.kind === 'player-player') {
                      return fc.presentPlayers.some(p => p.id === activePlayer.id);
                    }
                    return getRelation(activePlayer.id, fc.independentId) === 'Unmet';
                  });
                  if (relevantContacts.length === 0) return null;
                  return (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        First Contact
                      </div>
                      <div className="space-y-2">
                        {relevantContacts.map(fc => (
                          <div key={fc.id} className="rounded border border-amber-200 bg-amber-50 p-2 dark:border-amber-800/40 dark:bg-amber-900/20">
                            <div className="mb-1 text-sm font-medium dark:text-gray-100">{fc.name}</div>
                            {fc.kind === 'player-player' ? (
                              <div className="flex flex-wrap gap-2">
                                {fc.presentPlayers.map(p => (
                                  <span key={p.id} className="flex items-center gap-1 text-xs dark:text-gray-300">
                                    {p.teamColor && (
                                      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                                    )}
                                    {p.name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                First contact — Independent faction
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {isCM ? (
            /* CM tab: all pairwise relations overview */
            <div className="mx-auto max-w-2xl">
              <h3 className="mb-4 text-base font-semibold dark:text-gray-100">All Relations</h3>
              {players.length < 2 ? (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">No player pairs to display.</p>
              ) : (
                <div className="space-y-2">
                  {players.flatMap((p1, i) =>
                    players.slice(i + 1).map(p2 => {
                      const rel = getRelation(p1.id, p2.id);
                      const contact = getContact(p1, p2);
                      const contactInfo = CONTACT_BADGE[contact];
                      const cd12 = getCooldown(p1.id, p2.id);
                      const cd21 = getCooldown(p2.id, p1.id);
                      return (
                        <div key={`${p1.id}-${p2.id}`} className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                          {/* Row 1: names + relation select */}
                          <div className="flex items-center gap-3">
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                              {p1.teamColor && <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p1.teamColor }} />}
                              <span className="text-sm dark:text-gray-200">{p1.name}</span>
                              <span className="text-gray-400 dark:text-gray-500">↔</span>
                              {p2.teamColor && <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p2.teamColor }} />}
                              <span className="text-sm dark:text-gray-200">{p2.name}</span>
                            </div>
                            <select
                              value={rel}
                              onChange={e => onSetRelation(p1.id, p2.id, e.target.value as DiplomacyLevel)}
                              className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                            >
                              {DIPLOMACY_LEVELS.map(lvl => (
                                <option key={lvl} value={lvl}>{DIPLOMACY_LEVEL_LABELS[lvl]}</option>
                              ))}
                            </select>
                          </div>
                          {/* Row 2: contact + cooldowns */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-3">
                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${contactInfo.cls}`}>
                              {contactInfo.label}
                            </span>
                            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              {p1.name} →
                              <input
                                type="number"
                                min={0}
                                value={cd12}
                                onChange={e => onSetCooldown(p1.id, p2.id, parseInt(e.target.value) || 0)}
                                className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-center text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                              />
                            </label>
                            <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              {p2.name} →
                              <input
                                type="number"
                                min={0}
                                value={cd21}
                                onChange={e => onSetCooldown(p2.id, p1.id, parseInt(e.target.value) || 0)}
                                className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-center text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ) : activePlayer ? (
            /* Player tab: that player's relations with all others */
            <div className="mx-auto max-w-2xl">
              {/* Active player header */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                {activePlayer.teamColor && (
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: activePlayer.teamColor }} />
                )}
                <h3 className="text-base font-semibold dark:text-gray-100">{activePlayer.name}</h3>
                {getTraitBadges(activePlayer).map(b => (
                  <span key={b.label} className={`rounded px-1.5 py-0.5 text-xs font-medium ${b.color}`}>{b.label}</span>
                ))}
                <span className="text-sm text-gray-500 dark:text-gray-400">— {activePlayer.empire.name}</span>
              </div>

              {players.filter(p => p.id !== activePlayer.id).length === 0 ? (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">No other players.</p>
              ) : (
                <div className="space-y-2">
                  {players.filter(p => p.id !== activePlayer.id).map(other => {
                    const rel = getRelation(activePlayer.id, other.id);
                    const otherBadges = getTraitBadges(other);
                    const contact = getContact(activePlayer, other);
                    const contactInfo = CONTACT_BADGE[contact];
                    const cooldownOut = getCooldown(activePlayer.id, other.id);
                    const cooldownIn  = getCooldown(other.id, activePlayer.id);
                    return (
                      <div key={other.id} className="rounded border border-gray-200 px-3 py-2.5 dark:border-gray-700">
                        {/* Row 1: name + relation */}
                        <div className="flex items-center gap-3">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            {other.teamColor && (
                              <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: other.teamColor }} />
                            )}
                            <span className="text-sm font-medium dark:text-gray-200">{other.name}</span>
                            {otherBadges.map(b => (
                              <span key={b.label} className={`rounded px-1.5 py-0.5 text-xs ${b.color}`}>{b.label}</span>
                            ))}
                            <span className="text-xs text-gray-400 dark:text-gray-500">({other.empire.name})</span>
                          </div>
                          <select
                            value={rel}
                            onChange={e => onSetRelation(activePlayer.id, other.id, e.target.value as DiplomacyLevel)}
                            className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                          >
                            {DIPLOMACY_LEVELS.map(lvl => (
                              <option key={lvl} value={lvl}>{DIPLOMACY_LEVEL_LABELS[lvl]}</option>
                            ))}
                          </select>
                        </div>
                        {/* Row 2: contact badge + cooldowns */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-3">
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${contactInfo.cls}`}>
                            {contactInfo.label}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            Cooldown →
                            <input
                              type="number"
                              min={0}
                              value={cooldownOut}
                              onChange={e => onSetCooldown(activePlayer.id, other.id, parseInt(e.target.value) || 0)}
                              className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </label>
                          {cooldownIn > 0 && (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              ← {cooldownIn} (their cooldown)
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Independent Relations */}
              {(() => {
                const independentSystems = Object.entries(systemOwnership)
                  .filter(([, ownerId]) => isIndependentId(ownerId))
                  .map(([sysId, independentId]) => ({
                    independentId,
                    systemId: sysId,
                    systemName: map.systems.find(s => s.id === sysId)?.name ?? sysId,
                  }));
                if (independentSystems.length === 0) return null;
                return (
                  <div className="mt-6">
                    <h4 className="mb-3 text-sm font-semibold dark:text-gray-200">Independent Systems</h4>
                    <div className="space-y-2">
                      {independentSystems.map(({ independentId, systemName }) => {
                        const rel = getRelation(activePlayer.id, independentId);
                        return (
                          <div key={independentId} className="rounded border border-gray-200 px-3 py-2.5 dark:border-gray-700">
                            <div className="flex items-center gap-3">
                              <div className="flex min-w-0 flex-1 flex-col">
                                <span className="text-sm font-medium dark:text-gray-200">{systemName}</span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">Independent System</span>
                              </div>
                              <select
                                value={rel}
                                onChange={e => onSetRelation(activePlayer.id, independentId, e.target.value as DiplomacyLevel)}
                                className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                              >
                                {DIPLOMACY_LEVELS.map(lvl => (
                                  <option key={lvl} value={lvl}>{DIPLOMACY_LEVEL_LABELS[lvl]}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --- Construction Phase Panel ---

interface ConstructionPhasePanelProps {
  players: CampaignPlayer[];
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  constructionChecks: Record<string, Array<{ checked: boolean; xed: boolean }>>;
  onUpdateConstructionChecks: (key: string, checks: Array<{ checked: boolean; xed: boolean }>) => void;
}

function ConstructionPhasePanel({ players, turnOrders, onUpdateOrders, constructionChecks, onUpdateConstructionChecks }: ConstructionPhasePanelProps) {
  const cmTabIndex = players.length;
  const [activeTab, setActiveTab] = useState(0);
  const { ref: tabBarRef, onMouseDown: tabBarMouseDown, onClickCapture: tabBarClickCapture } = useDragScroll();

  const isCM = activeTab === cmTabIndex;
  const activeKey = isCM ? 'cm' : (players[activeTab]?.id ?? 'cm');
  const entry = turnOrders[activeKey] ?? EMPTY_ORDER_ENTRY;

  const [editMode, setEditMode] = useState<Record<string, boolean>>({});
  const isEditing = editMode[activeKey] ?? false;

  const constructionText = entry.construction;
  const lines = constructionText.split('\n').filter(l => l.trim() !== '');
  const checks = constructionChecks[activeKey] ?? [];

  const handleDoneEditing = () => {
    setEditMode(prev => ({ ...prev, [activeKey]: false }));
    onUpdateConstructionChecks(activeKey, []);
  };

  const toggleCheck = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    onUpdateConstructionChecks(activeKey, updated);
  };

  const toggleXed = (lineIdx: number) => {
    const current = checks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...checks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    onUpdateConstructionChecks(activeKey, updated);
  };

  return (
    <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Reminder banner */}
      <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-300">
        Remember to apply new unit purchases via <strong>Fleets → Add Units</strong>, respecting system and shipyard construction limits.
      </div>

      {/* Tab bar */}
      <div ref={tabBarRef} onMouseDown={tabBarMouseDown} onClickCapture={tabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            title={`${p.name} (${p.empire.name})`}
            className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
              activeTab === i
                ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {p.teamColor && (
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
            )}
            {p.name}
          </button>
        ))}
        <button
          onClick={() => setActiveTab(cmTabIndex)}
          className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
            isCM
              ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
          CM
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {isCM ? (
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Construction Notes
            </label>
            <textarea
              className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              value={entry.construction}
              onChange={e => onUpdateOrders(activeKey, { ...entry, construction: e.target.value })}
              placeholder="CM construction notes…"
            />
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Construction Orders
              </span>
              {isEditing ? (
                <button
                  onClick={handleDoneEditing}
                  className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Done
                </button>
              ) : (
                <button
                  onClick={() => setEditMode(prev => ({ ...prev, [activeKey]: true }))}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <textarea
                className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                value={entry.construction}
                onChange={e => onUpdateOrders(activeKey, { ...entry, construction: e.target.value })}
                placeholder="One order per line…"
                autoFocus
              />
            ) : lines.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No construction orders</p>
            ) : (
              <ul className="space-y-1.5">
                {lines.map((line, i) => {
                  const state = checks[i] ?? { checked: false, xed: false };
                  return (
                    <li key={i} className="flex min-w-0 items-start gap-2">
                      <button
                        onClick={() => toggleCheck(i)}
                        disabled={state.xed}
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                          state.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                        } ${state.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                        title={state.xed ? 'Cannot check — X is active' : state.checked ? 'Uncheck' : 'Check'}
                      >
                        {state.checked ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect width="16" height="16" rx="2" fill="currentColor" />
                            <path d="M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z" fill="white" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                            <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        )}
                      </button>
                      <span className={`min-w-0 flex-1 break-words text-sm ${
                        state.checked ? 'text-green-600 line-through dark:text-green-500' :
                        state.xed ? 'text-red-600 line-through dark:text-red-500' :
                        'dark:text-gray-200'
                      }`}>
                        {line}
                      </span>
                      <button
                        onClick={() => toggleXed(i)}
                        disabled={state.checked}
                        className={`mt-0.5 flex-shrink-0 text-sm leading-none ${
                          state.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer'
                        } ${state.xed ? 'font-bold text-red-600 dark:text-red-500' : 'text-gray-300 hover:text-red-500 dark:text-gray-600'}`}
                        title={state.checked ? 'Cannot X — checkbox is active' : state.xed ? 'Remove X' : 'Mark as failed'}
                      >
                        ✗
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// --- Combat Phase Panel ---

interface CombatPhasePanelProps {
  players: CampaignPlayer[];
  diplomacyRelations: Record<string, DiplomacyLevel>;
  map: GameMap;
  onSelectSystem: (systemId: string) => void;
  onStartScenario: (systemId: string) => void;
  activeScenarios: CombatScenario[];
  onResumeScenario: (systemId: string) => void;
  onReviewScenario: (scenarioId: string) => void;
  resolvedScenarios: CombatScenario[];
}

interface EncounterEntry {
  player: CampaignPlayer;
  asTotal: number;
  dvTotal: number;
  unitCount: number;
}

interface Encounter {
  systemId: string;
  systemName: string;
  entries: EncounterEntry[];
  type: 'war' | 'neutral' | 'allied';
}

function CombatPhasePanel({ players, diplomacyRelations, map, onSelectSystem, onStartScenario, activeScenarios, onResumeScenario, onReviewScenario, resolvedScenarios }: CombatPhasePanelProps) {
  const confirm = useConfirm();
  const [expanded, setExpanded] = useState<Record<'war' | 'neutral' | 'allied', boolean>>({
    war: true,
    neutral: true,
    allied: true,
  });
  const [showFilter, setShowFilter] = useState(false);
  const [filterPlayerId, setFilterPlayerId] = useState<string | null>(null);
  const [hideResolved, setHideResolved] = useState(false);
  const [openReviewDropdown, setOpenReviewDropdown] = useState<string | null>(null);
  const [reviewDropdownPos, setReviewDropdownPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!openReviewDropdown) return;
    const close = () => setOpenReviewDropdown(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openReviewDropdown]);

  const resolvedSystemIds = useMemo(() => new Set(resolvedScenarios.map(s => s.systemId)), [resolvedScenarios]);

  const encounters = useMemo((): Encounter[] => {
    const result: Encounter[] = [];
    for (const system of map.systems) {
      const presentEntries: EncounterEntry[] = [];
      for (const player of players) {
        const fleetsHere = (player.fleets ?? []).filter(f => f.systemId === system.id);
        if (fleetsHere.length === 0) continue;
        const fleetIdSet = new Set(fleetsHere.map(f => f.id));
        const unitsHere = player.units.filter(u => !u.mothballed && u.fleetId && fleetIdSet.has(u.fleetId));
        if (unitsHere.length === 0) continue;

        let asTotal = 0;
        let dvTotal = 0;
        for (const unit of unitsHere) {
          const tmpl = resolveUnitTemplate(player, unit.unitTemplateId, players);
          if (tmpl && tmpl.category !== 'Troops') {
            if (typeof tmpl.as === 'number') asTotal += tmpl.as;
            dvTotal += tmpl.dv;
          }
        }
        presentEntries.push({ player, asTotal, dvTotal, unitCount: unitsHere.length });
      }

      if (presentEntries.length >= 2) {
        presentEntries.sort((a, b) => b.asTotal !== a.asTotal ? b.asTotal - a.asTotal : b.dvTotal - a.dvTotal);
        const playerIds = presentEntries.map(e => e.player.id);
        let type: 'war' | 'neutral' | 'allied' = 'allied';
        let isWar = false;
        let isNeutral = false;
        outer: for (let i = 0; i < playerIds.length; i++) {
          for (let j = i + 1; j < playerIds.length; j++) {
            const rel = diplomacyRelations[diplomacyKey(playerIds[i], playerIds[j])] ?? 'Unmet';
            if (rel === 'War' || rel === 'Hostilities') { isWar = true; break outer; }
            if (rel === 'Neutral' || rel === 'Unmet') isNeutral = true;
          }
        }
        if (isWar) type = 'war';
        else if (isNeutral) type = 'neutral';
        result.push({ systemId: system.id, systemName: system.name || system.id, entries: presentEntries, type });
      } else if (resolvedSystemIds.has(system.id) && !result.some(e => e.systemId === system.id)) {
        // Keep resolved scenarios visible even if fleets are gone
        result.push({ systemId: system.id, systemName: system.name || system.id, entries: [], type: 'war' });
      }
    }
    // Also catch resolved scenarios for systems not yet iterated (edge case)
    for (const systemId of resolvedSystemIds) {
      if (!result.some(e => e.systemId === systemId)) {
        const system = map.systems.find(s => s.id === systemId);
        if (system) result.push({ systemId, systemName: system.name || systemId, entries: [], type: 'war' });
      }
    }
    return result;
  }, [players, diplomacyRelations, map.systems, resolvedSystemIds]);

  let visibleEncounters = filterPlayerId
    ? encounters.filter(enc => enc.entries.some(e => e.player.id === filterPlayerId) || resolvedSystemIds.has(enc.systemId))
    : encounters;
  const activeScenarioSystemIds = useMemo(() => new Set(activeScenarios.map(s => s.systemId)), [activeScenarios]);
  if (hideResolved) {
    visibleEncounters = visibleEncounters.filter(enc => !resolvedSystemIds.has(enc.systemId) || activeScenarioSystemIds.has(enc.systemId));
  }

  const warEncounters = visibleEncounters.filter(e => e.type === 'war');
  const neutralEncounters = visibleEncounters.filter(e => e.type === 'neutral');
  const alliedEncounters = visibleEncounters.filter(e => e.type === 'allied');

  const renderSection = (
    label: string,
    sectionEncounters: Encounter[],
    isExpanded: boolean,
    onToggle: () => void,
    headerCls: string,
    isAllied: boolean,
  ) => (
    <div>
      <button
        onClick={onToggle}
        className={`flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide ${headerCls}`}
      >
        <span>{label} ({sectionEncounters.length})</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </button>
      {isExpanded && (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {sectionEncounters.map(enc => {
            const activeScenarioObj = !isAllied ? (activeScenarios.find(s => s.systemId === enc.systemId) ?? null) : null;
            const encResolvedScenarios = resolvedScenarios.filter(s => s.systemId === enc.systemId);
            const showSetup = !!activeScenarioObj && activeScenarioObj.phase === 'setup';
            const showResume = !!activeScenarioObj && activeScenarioObj.phase !== 'setup';
            const hasReviewItems = encResolvedScenarios.length > 0;
            const isReviewOpen = openReviewDropdown === enc.systemId;
            return (
              <div
                key={enc.systemId}
                className="cursor-pointer px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                onClick={() => onSelectSystem(enc.systemId)}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{enc.systemName}</span>
                  {hasReviewItems && (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">Resolved</span>
                  )}
                </div>
                {enc.entries.map(entry => (
                  <div key={entry.player.id} className="mb-0.5 flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: entry.player.teamColor ?? '#6b7280' }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.player.name}</span>
                    <span className="font-mono tabular-nums">AS:{entry.asTotal}</span>
                    <span className="font-mono tabular-nums">DV:{entry.dvTotal}</span>
                    <span className="text-gray-400 dark:text-gray-500">({entry.unitCount})</span>
                  </div>
                ))}
                {!isAllied && (hasReviewItems || activeScenarioObj) && (
                  <div className="mt-1.5 flex gap-1">
                    {hasReviewItems && (
                      <div className="relative flex-1">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (isReviewOpen) { setOpenReviewDropdown(null); return; }
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setReviewDropdownPos({ top: rect.bottom + 2, left: rect.left });
                            setOpenReviewDropdown(enc.systemId);
                          }}
                          className="flex w-full items-center justify-center gap-1 rounded border border-green-400 px-1 py-1 text-xs text-green-700 hover:bg-green-50 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-900/20"
                        >
                          Review ▾
                        </button>
                        {isReviewOpen && reviewDropdownPos && createPortal(
                          <div
                            className="fixed z-[9999] rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
                            style={{ top: reviewDropdownPos.top, left: reviewDropdownPos.left, maxHeight: '240px', overflowY: 'auto' }}
                            onClick={e => e.stopPropagation()}
                          >
                            {encResolvedScenarios.map(s => {
                              const typeLabel = s.scenarioType === 'defensive' ? 'Defense' : s.scenarioType === 'pursuit' ? 'Pursuit' : s.scenarioType === 'ground_combat' ? 'Ground Combat' : 'Interception';
                              const winLabel = s.winner === 'attacker' ? 'Attacker wins' : s.winner === 'defender' ? 'Defender wins' : s.winner === 'mutual_retreat' ? 'Mutual Retreat' : 'Undetermined';
                              const atkPlayer = players.find(p => p.id === s.attackerForce.primaryPlayerId);
                              const defPlayer = players.find(p => p.id === s.defenderForce.primaryPlayerId);
                              return (
                                <button
                                  key={s.id}
                                  onClick={() => { setOpenReviewDropdown(null); onReviewScenario(s.id); }}
                                  className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800"
                                >
                                  <div className="whitespace-nowrap font-semibold text-gray-800 dark:text-gray-100">{typeLabel} · {winLabel}</div>
                                  <div className="mt-0.5 flex items-center gap-2">
                                    <span className={`flex items-center gap-1 font-semibold ${s.winner === 'attacker' ? 'text-green-600 dark:text-green-400' : s.winner === 'defender' ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: atkPlayer?.teamColor ?? '#6b7280' }} />
                                      {atkPlayer?.name ?? '—'}
                                    </span>
                                    <span className="text-gray-300 dark:text-gray-600">vs</span>
                                    <span className={`flex items-center gap-1 font-semibold ${s.winner === 'defender' ? 'text-green-600 dark:text-green-400' : s.winner === 'attacker' ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                                      <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: defPlayer?.teamColor ?? '#6b7280' }} />
                                      {defPlayer?.name ?? '—'}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>,
                          document.body
                        )}
                      </div>
                    )}
                    {showSetup && (
                      <button
                        onClick={e => { e.stopPropagation(); onResumeScenario(enc.systemId); }}
                        className="flex-1 rounded border border-blue-400 px-1 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20"
                      >
                        Setup
                      </button>
                    )}
                    {showResume && (
                      <button
                        onClick={e => { e.stopPropagation(); onResumeScenario(enc.systemId); }}
                        className="flex-1 rounded border border-blue-400 px-1 py-1 text-xs text-blue-700 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={async e => {
                        e.stopPropagation();
                        const hasActive = !!activeScenarioObj;
                        const warningMsg = hasActive
                          ? 'A scenario is already in progress or awaiting results. Starting a new one will discard it. Continue?'
                          : 'Start a new combat scenario for this system?';
                        const ok = await confirm({ title: 'Start Scenario?', message: warningMsg, confirmLabel: 'Start', variant: hasActive ? 'danger' : undefined });
                        if (ok) onStartScenario(enc.systemId);
                      }}
                      className="flex-1 rounded border border-gray-300 px-1 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Start
                    </button>
                  </div>
                )}
                {!isAllied && !hasReviewItems && !activeScenarioObj && (
                  <div className="mt-1.5">
                    <button
                      onClick={e => { e.stopPropagation(); onStartScenario(enc.systemId); }}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Start Combat Scenario
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Combat Phase</span>
        <button
          onClick={() => { setShowFilter(prev => !prev); if (showFilter) { setFilterPlayerId(null); setHideResolved(false); } }}
          className={`rounded px-2 py-0.5 text-xs ${showFilter ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
        >
          Filter
        </button>
      </div>

      {/* Player filter + Hide Resolved */}
      {showFilter && (
        <div className="space-y-2 border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <select
            value={filterPlayerId ?? ''}
            onChange={e => setFilterPlayerId(e.target.value || null)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">All Players</option>
            {players.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={hideResolved}
              onChange={e => setHideResolved(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Hide Resolved
          </label>
        </div>
      )}

      {/* Encounter lists */}
      <div className="flex-1 divide-y divide-gray-200 overflow-y-auto dark:divide-gray-700">
        {encounters.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No encounters this turn.</p>
        ) : visibleEncounters.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">No encounters match the current filter.</p>
        ) : (
          <>
            {warEncounters.length > 0 && renderSection(
              'War Encounters', warEncounters, expanded.war,
              () => setExpanded(prev => ({ ...prev, war: !prev.war })),
              'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20',
              false,
            )}
            {neutralEncounters.length > 0 && renderSection(
              'Neutral Encounters', neutralEncounters, expanded.neutral,
              () => setExpanded(prev => ({ ...prev, neutral: !prev.neutral })),
              'text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20',
              false,
            )}
            {alliedEncounters.length > 0 && renderSection(
              'Allied Encounters', alliedEncounters, expanded.allied,
              () => setExpanded(prev => ({ ...prev, allied: !prev.allied })),
              'text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20',
              true,
            )}
          </>
        )}
      </div>
    </aside>
  );
}

// --- Shared tech unit stat display ---

// Columns: name | hull | cost | DV | AS | AF | CR | CC | traits | badge
// Fixed hull column (2.25rem) prevents per-row auto sizing causing column drift; hull codes are max 3 chars at text-sm.
// Fixed last column prevents misalignment between the header (empty badge) and data rows (badge content)
const TECH_UNIT_COLS = 'minmax(0,2fr) 2.25rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem 2.5rem minmax(0,3fr) 4.5rem';
const UNIT_CATEGORY_ORDER: UnitCategory[] = ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'];

function TechUnitHeader() {
  return (
    <div style={{ gridTemplateColumns: TECH_UNIT_COLS }} className="grid gap-x-2 border-b border-gray-200 px-3 py-1 text-xs font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500">
      <span>Unit</span>
      <span>Hull</span>
      <span className="text-right">Cost</span>
      <span className="text-right">DV</span>
      <span className="text-right">AS</span>
      <span className="text-right">AF</span>
      <span className="text-right">CR</span>
      <span className="text-right">CC</span>
      <span className="pl-3">Traits</span>
      <span />
    </div>
  );
}

function TechUnitRow({ unit, badge, onClick, selected, disabled }: {
  unit: EmpireUnit;
  badge?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      role={onClick && !disabled ? 'button' : undefined}
      onClick={disabled ? undefined : onClick}
      style={{ gridTemplateColumns: TECH_UNIT_COLS }}
      className={`grid items-center gap-x-2 px-3 py-1.5 ${onClick && !disabled ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''} ${selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${disabled ? 'opacity-40' : ''}`}
    >
      <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{unit.name}</span>
      <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
        {unit.hullCode !== 'N/A' ? unit.hullCode : ''}
      </span>
      <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{unit.cost}</span>
      {(['dv', 'as', 'af', 'cr', 'cc'] as const).map(stat => (
        <span key={stat} className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">
          {unit[stat] === '-' ? '—' : String(unit[stat])}
        </span>
      ))}
      <span className="truncate pl-3 text-xs text-gray-400 dark:text-gray-500">
        {unit.traits.map(t => t.factor !== undefined ? `${t.name} ${t.factor}` : t.name).join(', ')}
      </span>
      <div className="text-right">{badge}</div>
    </div>
  );
}

function TechUnitList({ units, getBadge, onClickUnit, selectedUnitId, getDisabled }: {
  units: EmpireUnit[];
  getBadge: (unit: EmpireUnit) => React.ReactNode;
  onClickUnit: (unit: EmpireUnit) => void;
  selectedUnitId?: string;
  getDisabled?: (unit: EmpireUnit) => boolean;
}) {
  const byCategory = UNIT_CATEGORY_ORDER
    .map(cat => ({ cat, units: units.filter(u => u.category === cat) }))
    .filter(g => g.units.length > 0);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (cat: string) => setCollapsed(prev => {
    const next = new Set(prev);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    return next;
  });

  return (
    <div className="overflow-hidden rounded border border-gray-200 dark:border-gray-700">
      <TechUnitHeader />
      {byCategory.map(({ cat, units: catUnits }) => (
        <Fragment key={cat}>
          <button
            type="button"
            onClick={() => toggle(cat)}
            className="flex w-full items-center gap-1.5 border-t border-gray-200 bg-gray-50 px-3 py-1 text-left dark:border-gray-700 dark:bg-gray-800/60"
          >
            <svg className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${collapsed.has(cat) ? '-rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{cat}</span>
            <span className="text-xs text-gray-400">({catUnits.length})</span>
          </button>
          {!collapsed.has(cat) && catUnits.map(unit => (
            <TechUnitRow
              key={unit.id}
              unit={unit}
              badge={getBadge(unit)}
              onClick={() => onClickUnit(unit)}
              selected={selectedUnitId === unit.id}
              disabled={getDisabled?.(unit)}
            />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

// --- Shared upgrade allocation sub-component ---

interface UpgradeAllocatorProps {
  unit: EmpireUnit;
  upgradePoints: number;
  onConfirm: (dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => void;
  onCancel: () => void;
}

function UpgradeAllocator({ unit, upgradePoints, onConfirm, onCancel }: UpgradeAllocatorProps) {
  const [dvDelta, setDvDelta] = useState(0);
  const [asDelta, setAsDelta] = useState(0);
  const [afDelta, setAfDelta] = useState(0);
  const [traitFactorDeltas, setTraitFactorDeltas] = useState<Record<string, number>>({});

  const factorTraits = unit.traits.filter(t => t.factor !== undefined);
  const apUsed = dvDelta + asDelta + afDelta + Object.values(traitFactorDeltas).reduce((s, v) => s + v * 2, 0);
  const apRemaining = upgradePoints - apUsed;
  const hasStats = typeof unit.as === 'number' || typeof unit.af === 'number';

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Upgrade Points: <span className={`font-bold ${apRemaining < 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-700 dark:text-green-400'}`}>{apRemaining} AP remaining</span>
        {apRemaining < 0 && <span className="ml-2 text-xs text-orange-500">(over budget — confirm anyway to proceed)</span>}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* DV — always editable */}
        <div className="flex items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
          <span className="w-8 text-xs font-semibold text-gray-600 dark:text-gray-400">DV</span>
          <span className="text-sm text-gray-800 dark:text-gray-200">{unit.dv}</span>
          <span className="text-xs text-gray-400">→</span>
          <span className="font-semibold text-blue-600 dark:text-blue-400">{unit.dv + dvDelta}</span>
          <div className="ml-auto flex gap-1">
            <button onClick={() => setDvDelta(d => Math.max(0, d - 1))} disabled={dvDelta <= 0} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">−</button>
            <button onClick={() => setDvDelta(d => d + 1)} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
          </div>
        </div>

        {/* AS — only if numeric */}
        {typeof unit.as === 'number' && (
          <div className="flex items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
            <span className="w-8 text-xs font-semibold text-gray-600 dark:text-gray-400">AS</span>
            <span className="text-sm text-gray-800 dark:text-gray-200">{unit.as}</span>
            <span className="text-xs text-gray-400">→</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{(unit.as as number) + asDelta}</span>
            <div className="ml-auto flex gap-1">
              <button onClick={() => setAsDelta(d => Math.max(0, d - 1))} disabled={asDelta <= 0} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">−</button>
              <button onClick={() => setAsDelta(d => d + 1)} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
            </div>
          </div>
        )}

        {/* AF — only if numeric */}
        {typeof unit.af === 'number' && (
          <div className="flex items-center gap-2 rounded border border-gray-200 p-2 dark:border-gray-700">
            <span className="w-8 text-xs font-semibold text-gray-600 dark:text-gray-400">AF</span>
            <span className="text-sm text-gray-800 dark:text-gray-200">{unit.af}</span>
            <span className="text-xs text-gray-400">→</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{(unit.af as number) + afDelta}</span>
            <div className="ml-auto flex gap-1">
              <button onClick={() => setAfDelta(d => Math.max(0, d - 1))} disabled={afDelta <= 0} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">−</button>
              <button onClick={() => setAfDelta(d => d + 1)} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
            </div>
          </div>
        )}
      </div>

      {/* Factor trait upgrades (2 AP per +1 factor) */}
      {factorTraits.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">Trait Factors (2 AP per +1):</p>
          <div className="flex flex-wrap gap-2">
            {factorTraits.map(tr => {
              const delta = traitFactorDeltas[tr.name] ?? 0;
              return (
                <div key={tr.name} className="flex items-center gap-2 rounded border border-gray-200 px-2 py-1 dark:border-gray-700">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{tr.name} {tr.factor}</span>
                  <span className="text-xs text-gray-400">→</span>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{(tr.factor ?? 0) + delta}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setTraitFactorDeltas(d => ({ ...d, [tr.name]: Math.max(0, (d[tr.name] ?? 0) - 1) }))} disabled={(traitFactorDeltas[tr.name] ?? 0) <= 0} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700">−</button>
                    <button onClick={() => setTraitFactorDeltas(d => ({ ...d, [tr.name]: (d[tr.name] ?? 0) + 1 }))} className="rounded px-1.5 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasStats && factorTraits.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">This unit has no upgradeable stats or factor traits. You can still confirm to apply the upgrade.</p>
      )}

      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
        <button
          onClick={() => onConfirm(dvDelta, asDelta, afDelta, traitFactorDeltas)}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Confirm Upgrade
        </button>
      </div>
    </div>
  );
}

// --- TechPhaseView ---

interface TechPhaseViewProps {
  players: CampaignPlayer[];
  settings: CampaignSettings;
  onAdvancePhase: () => void;
  onRevertPhase: () => void;
  onViewMap: () => void;
  canRevert: boolean;
  onUnlockUnit: (playerId: string, unitId: string) => void;
  onUpgradeUnit: (playerId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => void;
  onUpgradeStolenUnit: (playerId: string, sourceEmpireId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => void;
}

function TechPhaseView({
  players,
  settings: _settings,
  onAdvancePhase,
  onRevertPhase,
  onViewMap,
  canRevert,
  onUnlockUnit,
  onUpgradeUnit,
  onUpgradeStolenUnit,
}: TechPhaseViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  type SubMode = 'overview' | 'choosing' | 'unlock' | 'upgrade';
  const [subMode, setSubMode] = useState<SubMode>('overview');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [selectedStolenEntry, setSelectedStolenEntry] = useState<{ sourceEmpireId: string; unit: EmpireUnit } | null>(null);

  const player = players[activeTab];
  const income = player?.currentTurnSystemIncome ?? 0;
  const tac = player ? computeTAC(income, player.empire.advantages as string[], player.empire.disadvantage) : 0;
  const techPool = player?.techPool ?? 0;
  const canAdvance = income > 0 && techPool >= tac;

  // Reset subMode when switching tabs
  const handleTabChange = (idx: number) => {
    setActiveTab(idx);
    setSubMode('overview');
    setSelectedUnitId(null);
    setSelectedStolenEntry(null);
  };

  if (!player) return null;

  // Locked units = in force list but not yet researched
  const lockedUnits = player.empire.units.filter(unit =>
    !unit.isSuperseded && !unit.researched
  );

  // Upgradeable own units = researched, not superseded, techLevel < 5
  const upgradeableUnits = player.empire.units.filter(unit => {
    if (unit.isSuperseded) return false;
    if (!unit.researched) return false;
    const tl = typeof unit.techLevel === 'number' ? unit.techLevel : (unit.techLevel === 'E' ? 0 : 1);
    return tl < 5;
  });

  // Upgradeable stolen units = not superseded, techLevel < 5
  const upgradeableStolenEntries = (player.stolenUnits ?? []).filter(s => {
    if (s.unit.isSuperseded) return false;
    const tl = typeof s.unit.techLevel === 'number' ? s.unit.techLevel : 1;
    return tl < 5;
  });

  // Active unit for the upgrade allocator (own or stolen)
  const activeUpgradeUnit = selectedStolenEntry?.unit ?? (selectedUnitId ? player.empire.units.find(u => u.id === selectedUnitId) : null) ?? null;
  const activeUpgradeTL = activeUpgradeUnit ? (typeof activeUpgradeUnit.techLevel === 'number' ? activeUpgradeUnit.techLevel : 1) : 1;
  const activeUpgradeNextTL = activeUpgradeUnit ? nextTechLevel(activeUpgradeTL as TechLevelType) : null;
  const upgradePoints = activeUpgradeUnit && activeUpgradeNextTL
    ? getUpgradePoints(activeUpgradeUnit.hullCode, activeUpgradeUnit.category, activeUpgradeNextTL)
    : 0;

  const handleConfirmUnlock = (unitId: string) => {
    onUnlockUnit(player.id, unitId);
    setSubMode('overview');
    setSelectedUnitId(null);
  };

  const handleConfirmUpgrade = (dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => {
    if (selectedStolenEntry) {
      onUpgradeStolenUnit(player.id, selectedStolenEntry.sourceEmpireId, selectedStolenEntry.unit.id, dvDelta, asDelta, afDelta, traitFactorDeltas);
      setSelectedStolenEntry(null);
    } else if (selectedUnitId) {
      onUpgradeUnit(player.id, selectedUnitId, dvDelta, asDelta, afDelta, traitFactorDeltas);
      setSelectedUnitId(null);
    }
    setSubMode('overview');
  };

  return (
    <div className="flex flex-1 flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <button onClick={onRevertPhase} disabled={!canRevert} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">← Back</button>
        <h2 className="text-base font-semibold dark:text-gray-100">Tech Phase</h2>
        <div className="flex gap-2">
          <button onClick={onViewMap} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">Map View</button>
          <button onClick={onAdvancePhase} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">Advance Phase →</button>
        </div>
      </div>

      {/* Player tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => handleTabChange(i)}
            className={`flex items-center gap-2 px-4 py-2 text-sm ${activeTab === i ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {p.teamColor && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />}
            <span className="flex flex-col items-start leading-tight">
              <span>{p.name}</span>
              <span className="text-[11px] font-normal opacity-60">{p.empire.name}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* Status row */}
          <div className="flex flex-wrap gap-6 rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Tech Pool: <span className="font-bold text-gray-900 dark:text-gray-100">{techPool} EP</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              TAC: <span className="font-bold text-gray-900 dark:text-gray-100">{income > 0 ? `${tac} EP` : '—'}</span>
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Last Investment: <span className="font-bold text-gray-900 dark:text-gray-100">{player.techInvestment ?? 0} EP</span>
            </div>
            {income === 0 && (
              <p className="w-full text-xs text-gray-400">TAC cannot be computed — no system income recorded for this turn.</p>
            )}
          </div>

          {/* Advancement available banner + claim flow */}
          {income > 0 && canAdvance && subMode === 'overview' && (
            <div className="rounded border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30">
              <p className="mb-3 text-sm font-medium text-green-800 dark:text-green-300">
                Tech Advancement available! Tech Pool ({techPool} EP) ≥ TAC ({tac} EP).
              </p>
              <button
                onClick={() => setSubMode('choosing')}
                className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                Claim Advancement
              </button>
            </div>
          )}

          {income > 0 && !canAdvance && subMode === 'overview' && (
            <div className="rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No advancement available. Tech Pool: {techPool} EP / TAC: {tac} EP.
                {techPool > 0 && tac > 0 && ` Need ${tac - techPool} more EP.`}
              </p>
            </div>
          )}

          {/* Choose advancement type */}
          {subMode === 'choosing' && (
            <div className="rounded border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30 space-y-3">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Choose your advancement:</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setSubMode('unlock')}
                  disabled={lockedUnits.length === 0}
                  className="flex-1 rounded border border-blue-300 bg-white px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-950"
                >
                  Unlock a Unit
                  <span className="ml-1 text-xs text-blue-400">({lockedUnits.length} available)</span>
                </button>
                <button
                  onClick={() => setSubMode('upgrade')}
                  disabled={upgradeableUnits.length === 0 && upgradeableStolenEntries.length === 0}
                  className="flex-1 rounded border border-blue-300 bg-white px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-950"
                >
                  Upgrade a Unit
                  <span className="ml-1 text-xs text-blue-400">({upgradeableUnits.length + upgradeableStolenEntries.length} available)</span>
                </button>
              </div>
              <button onClick={() => setSubMode('overview')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
            </div>
          )}

          {/* Unlock list */}
          {subMode === 'unlock' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a unit to unlock:</p>
                <button onClick={() => setSubMode('choosing')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
              </div>
              {lockedUnits.length === 0
                ? <p className="text-sm text-gray-400">No locked units available to unlock.</p>
                : <TechUnitList
                    units={lockedUnits}
                    getBadge={() => null}
                    onClickUnit={unit => handleConfirmUnlock(unit.id)}
                  />
              }
            </div>
          )}

          {/* Upgrade list */}
          {subMode === 'upgrade' && !selectedUnitId && !selectedStolenEntry && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a unit to upgrade:</p>
                <button onClick={() => setSubMode('choosing')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
              </div>
              <TechUnitList
                units={upgradeableUnits}
                getBadge={unit => {
                  const currentTL = typeof unit.techLevel === 'number' ? unit.techLevel : 1;
                  const nextTL = nextTechLevel(currentTL as TechLevelType);
                  const pts = nextTL ? getUpgradePoints(unit.hullCode, unit.category, nextTL) : 0;
                  return (
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap text-xs text-blue-500">TL{currentTL}→{nextTL}</span>
                      <span className="whitespace-nowrap text-xs text-green-600 dark:text-green-400">+{pts} AP</span>
                    </div>
                  );
                }}
                onClickUnit={unit => setSelectedUnitId(unit.id)}
              />
              {upgradeableStolenEntries.length > 0 && (
                <>
                  <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">Stolen Designs</p>
                  <TechUnitList
                    units={upgradeableStolenEntries.map(s => s.unit)}
                    getBadge={unit => {
                      const currentTL = typeof unit.techLevel === 'number' ? unit.techLevel : 1;
                      const nextTL = nextTechLevel(currentTL as TechLevelType);
                      const pts = nextTL ? getUpgradePoints(unit.hullCode, unit.category, nextTL) : 0;
                      return (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="whitespace-nowrap text-xs text-blue-500">TL{currentTL}→{nextTL}</span>
                          <span className="whitespace-nowrap text-xs text-green-600 dark:text-green-400">+{pts} AP</span>
                        </div>
                      );
                    }}
                    onClickUnit={unit => {
                      const entry = (player.stolenUnits ?? []).find(s => s.unit.id === unit.id);
                      if (entry) setSelectedStolenEntry(entry);
                    }}
                  />
                </>
              )}
            </div>
          )}

          {/* Upgrade allocator */}
          {subMode === 'upgrade' && activeUpgradeUnit && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Upgrading: <span className="font-bold">{activeUpgradeUnit.name}</span>
                  {selectedStolenEntry && <span className="ml-2 text-xs text-purple-500">Stolen Design</span>}
                  <span className="ml-2 text-xs text-blue-500">TL{activeUpgradeTL} → TL{activeUpgradeNextTL} (+{upgradePoints} AP)</span>
                </p>
                <button onClick={() => { setSelectedUnitId(null); setSelectedStolenEntry(null); }} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
              </div>
              <UpgradeAllocator
                unit={activeUpgradeUnit}
                upgradePoints={upgradePoints}
                onConfirm={handleConfirmUpgrade}
                onCancel={() => { setSelectedUnitId(null); setSelectedStolenEntry(null); setSubMode('choosing'); }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- TurnPhaseView (generic placeholder for phases 2–10) ---

interface TurnPhaseViewProps {
  turnPhase: TurnPhase;
  onAdvance: () => void;
  onBack: () => void;
  onViewMap: () => void;
  canBack: boolean;
}

function TurnPhaseView({ turnPhase, onAdvance, onBack, onViewMap, canBack }: TurnPhaseViewProps) {
  const label = TURN_PHASES.find(p => p.value === turnPhase)?.label ?? turnPhase;
  const isLastPhase = turnPhase === 'end_of_turn';
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-white dark:bg-gray-900">
      <h2 className="text-2xl font-semibold dark:text-gray-100">{label}</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">This phase has no functionality yet.</p>
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={!canBack}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={onViewMap}
          className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Map View
        </button>
        <button
          onClick={onAdvance}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {isLastPhase ? 'End Turn →' : 'Advance Phase →'}
        </button>
      </div>
    </div>
  );
}

// --- Economic Phase helpers & view ---

interface SystemIncomeRow {
  systemId: string;
  name: string;
  population: number;
  raw: number;
  base: number;
  income: number;
  rebellion: boolean;
  blockaded: boolean;
  disruption: boolean;
}

interface TradeContribution {
  systemId: string;
  name: string;
  pop: number;
  income: number;
  deduped: boolean;
}

interface TradeRouteRow {
  convoyUnitId: string;
  systemNames: string[];
  blockedByEnemy: boolean;
  contributions: TradeContribution[];
  routeSubtotal: number;
  routeTotal: number;
  freeTraders: boolean;
}

interface EconomicIncomeResult {
  systemRows: SystemIncomeRow[];
  systemTotal: number;
  tradeRows: TradeRouteRow[];
  tradeTotal: number;
  maintenanceCost: number;
  maintenance: number;
  misc: number;
  net: number;
}

function calcEconomicIncome(
  player: CampaignPlayer,
  map: GameMap,
  systemStatuses: Record<string, SystemCampaignStatus>,
  allPlayers?: CampaignPlayer[],
): EconomicIncomeResult {
  // System Income
  const systemRows: SystemIncomeRow[] = [];
  let systemTotal = 0;

  for (const sysId of player.ownedSystemIds) {
    const sys = map.systems.find(s => s.id === sysId);
    if (!sys || !sys.attributes) continue;
    const status = systemStatuses[sysId] ?? {};
    const pop = sys.attributes.population;
    const raw = Math.max(0, sys.attributes.raw - (status.industrialSabotage ? 1 : 0));
    const base = pop * raw;
    let income = base;
    const rebellion = status.rebellion ?? false;
    const blockaded = isEffectivelyBlockaded(status) || (status.inOpposition ?? false);
    const disruption = status.economicDisruption ?? false;
    if (rebellion) {
      income = 0;
    } else {
      if (blockaded) income = Math.ceil(income / 2);
      if (disruption) income = Math.ceil(income / 2);
    }
    systemRows.push({ systemId: sysId, name: sys.name || sysId, population: pop, raw, base, income, rebellion, blockaded, disruption });
    systemTotal += income;
  }

  // Trade Income
  const tradeRows: TradeRouteRow[] = [];
  let tradeTotal = 0;
  const countedSystemIds = new Set<string>();
  const hasFreeTraders = player.empire.advantages.includes('Free Traders');

  for (const route of (player.tradeRoutes ?? [])) {
    const blockedByEnemy = route.systemIds.some(sid => systemStatuses[sid]?.hasEnemyFleet);
    const contributions: TradeContribution[] = [];
    let routeSubtotal = 0;
    for (const sid of route.systemIds) {
      const sys = map.systems.find(s => s.id === sid);
      const status = systemStatuses[sid] ?? {};
      const pop = sys?.attributes?.population ?? 0;
      const deduped = countedSystemIds.has(sid);
      let income = 0;
      if (!blockedByEnemy && !deduped) {
        income = (isEffectivelyBlockaded(status) || status.inOpposition) ? Math.ceil(pop / 2) : pop;
        routeSubtotal += income;
        countedSystemIds.add(sid);
      }
      contributions.push({ systemId: sid, name: sys?.name || sid, pop, income, deduped });
    }
    let routeTotal = routeSubtotal;
    const freeTraders = hasFreeTraders && !blockedByEnemy && routeSubtotal > 0;
    if (freeTraders) routeTotal = Math.ceil(routeSubtotal * 1.5);
    tradeTotal += routeTotal;
    tradeRows.push({
      convoyUnitId: route.convoyUnitId,
      systemNames: route.systemIds.map(sid => map.systems.find(s => s.id === sid)?.name || sid),
      blockedByEnemy,
      contributions,
      routeSubtotal,
      routeTotal,
      freeTraders,
    });
  }

  // Maintenance
  let maintenanceCost = 0;
  for (const unit of player.units) {
    if (unit.mothballed) continue;
    const template = resolveUnitTemplate(player, unit.unitTemplateId, allPlayers);
    maintenanceCost += template?.cost ?? 0;
  }
  const maintenance = Math.ceil(maintenanceCost * 0.1);

  const misc = player.currentMiscEP ?? 0;
  const net = systemTotal + tradeTotal - maintenance + misc;

  return { systemRows, systemTotal, tradeRows, tradeTotal, maintenanceCost, maintenance, misc, net };
}

interface EconomicPhaseViewProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  mapState: ReturnType<typeof useMapState>;
  systemStatuses: Record<string, SystemCampaignStatus>;
  currentTurn: number;
  onAdvancePhase: () => void;
  onRevertPhase: () => void;
  onViewMap: () => void;
  canRevert: boolean;
}

function buildEconomicCopyText(player: CampaignPlayer, result: EconomicIncomeResult, currentTurn: number): string {
  const lines: string[] = [];
  lines.push(`Economic Phase — ${player.name} (Turn ${currentTurn})`);
  lines.push('');
  lines.push(`SYSTEM INCOME: +${result.systemTotal} EP`);
  for (const row of result.systemRows) {
    const statusTags = [
      row.rebellion ? '[Rebellion]' : '',
      row.blockaded && !row.rebellion ? '[Blockaded]' : '',
      row.disruption && !row.rebellion ? '[Disruption]' : '',
    ].filter(Boolean).join(' ');
    const tag = statusTags ? ` ${statusTags}` : '';
    const formula = row.rebellion
      ? `P${row.population}×RAW${row.raw} = ${row.base} → 0 EP`
      : (row.blockaded || row.disruption)
        ? `P${row.population}×RAW${row.raw} = ${row.base} → ${row.income} EP`
        : `P${row.population}×RAW${row.raw} = ${row.income} EP`;
    lines.push(`  ${row.name}${tag}: ${formula}`);
  }
  lines.push('');
  lines.push(`TRADE INCOME: +${result.tradeTotal} EP`);
  result.tradeRows.forEach((row, idx) => {
    const routeName = `Route ${idx + 1}: ${row.systemNames.join(' → ')}`;
    if (row.blockedByEnemy) {
      lines.push(`  ${routeName}: 0 EP [Enemy Fleet]`);
    } else {
      const contribs = row.contributions
        .filter(c => !c.deduped)
        .map(c => `${c.name}: P${c.pop} = ${c.income} EP`)
        .join(', ');
      const ft = row.freeTraders ? ` [Free Traders: ${row.routeSubtotal} × 1.5 → ${row.routeTotal} EP]` : '';
      lines.push(`  ${routeName}: ${row.routeTotal} EP (${contribs})${ft}`);
    }
  });
  lines.push('');
  lines.push(`MAINTENANCE: −${result.maintenance} EP`);
  lines.push(`  ${player.units.filter(u => !u.mothballed).length} active unit(s) — cost ${result.maintenanceCost} EP × 10% = ${result.maintenance} EP`);
  lines.push('');
  const miscSign = result.misc >= 0 ? '+' : '';
  lines.push(`MISC: ${miscSign}${result.misc} EP`);
  lines.push('');
  const netSign = result.net >= 0 ? '+' : '';
  lines.push(`NET: ${netSign}${result.net} EP`);
  lines.push(`Current EP: ${player.ep} → New EP: ${player.ep + result.net}`);
  return lines.join('\n');
}

function EconomicPhaseView({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  mapState,
  systemStatuses,
  currentTurn,
  onAdvancePhase,
  onRevertPhase,
  onViewMap,
  canRevert,
}: EconomicPhaseViewProps) {
  const [copied, setCopied] = useState<number | null>(null);
  const player = players[currentPlayerIndex];
  if (!player) return null;
  const result = calcEconomicIncome(player, mapState.map, systemStatuses, players);
  const newEP = player.ep + result.net;

  // Check if any player would go negative after advancing
  const anyNegative = players.some(p => {
    const r = calcEconomicIncome(p, mapState.map, systemStatuses, players);
    return p.ep + r.net < 0;
  });

  const handleCopy = (idx: number) => {
    const p = players[idx];
    if (!p) return;
    const r = calcEconomicIncome(p, mapState.map, systemStatuses, players);
    const text = buildEconomicCopyText(p, r, currentTurn);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={onRevertPhase}
          disabled={!canRevert}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ← Back
        </button>
        <span className="text-sm font-medium dark:text-gray-200">
          Economic Phase — Turn {currentTurn}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onViewMap}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Map View
          </button>
          <button
            onClick={onAdvancePhase}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          >
            Advance Phase →
          </button>
        </div>
      </div>

      {/* Negative EP warning */}
      {anyNegative && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Warning: one or more players will have negative EP after this phase. At the Construction Phase, players must scrap military units to cover any deficit.
        </div>
      )}

      {/* Player Tabs */}
      <div className="flex border-b border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        {players.map((p, i) => {
          const r = calcEconomicIncome(p, mapState.map, systemStatuses, players);
          const nextEP = p.ep + r.net;
          return (
            <button
              key={p.id}
              onClick={() => onSelectPlayer(i)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm ${
                i === currentPlayerIndex
                  ? 'border-blue-500 font-semibold text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {p.teamColor && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.teamColor }} />
              )}
              <span className="flex flex-col items-start leading-tight">
                <span>{p.name}</span>
                <span className="text-[11px] font-normal opacity-60">{p.empire.name}</span>
              </span>
              <span className={`text-xs ${nextEP < 0 ? 'text-red-500 dark:text-red-400' : 'opacity-75'}`}>
                EP: {p.ep} → {nextEP}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold dark:text-gray-100">{player.name}</h2>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{player.empire.name}</p>
          </div>
          <button
            onClick={() => handleCopy(currentPlayerIndex)}
            className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {copied === currentPlayerIndex ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* System Income */}
        <div className="mb-4 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between rounded-t bg-gray-50 px-4 py-2 dark:bg-gray-800">
            <span className="text-sm font-semibold dark:text-gray-200">System Income</span>
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">+{result.systemTotal} EP</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {result.systemRows.length === 0 && (
              <p className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">No owned systems with attributes</p>
            )}
            {result.systemRows.map(row => (
              <div key={row.systemId} className="flex items-center justify-between px-4 py-1.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="dark:text-gray-200">{row.name}</span>
                  {row.rebellion && <span className="rounded bg-red-100 px-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">Rebellion</span>}
                  {row.blockaded && !row.rebellion && <span className="rounded bg-amber-100 px-1 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Blockaded</span>}
                  {row.disruption && !row.rebellion && <span className="rounded bg-orange-100 px-1 text-xs text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">Disruption</span>}
                </div>
                <span className="text-gray-500 dark:text-gray-400">
                  {row.rebellion ? (
                    <span>P{row.population}×RAW{row.raw} = {row.base} → <span className="font-medium text-gray-700 dark:text-gray-300">0 EP</span></span>
                  ) : (row.blockaded || row.disruption) ? (
                    <span>P{row.population}×RAW{row.raw} = {row.base} → <span className="font-medium text-gray-700 dark:text-gray-300">{row.income} EP</span></span>
                  ) : (
                    <span className="font-medium text-gray-700 dark:text-gray-300">P{row.population}×RAW{row.raw} = {row.income} EP</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Trade Income */}
        <div className="mb-4 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between rounded-t bg-gray-50 px-4 py-2 dark:bg-gray-800">
            <span className="text-sm font-semibold dark:text-gray-200">Trade Income</span>
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">+{result.tradeTotal} EP</span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {result.tradeRows.length === 0 && (
              <p className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">No trade routes established</p>
            )}
            {result.tradeRows.map((row, idx) => (
              <div key={row.convoyUnitId} className="px-4 py-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="dark:text-gray-200">Route {idx + 1}: {row.systemNames.join(' → ')}</span>
                    {row.blockedByEnemy && <span className="rounded bg-red-100 px-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">Enemy Fleet</span>}
                    {row.freeTraders && <span className="rounded bg-blue-100 px-1 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">Free Traders</span>}
                  </div>
                  <span className="font-medium text-gray-700 dark:text-gray-300">{row.routeTotal} EP</span>
                </div>
                <div className="mt-0.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                  {row.blockedByEnemy ? (
                    <span>Route blocked — enemy fleet in system</span>
                  ) : (
                    <>
                      {row.contributions.map(c => (
                        <span key={c.systemId} className={c.deduped ? 'opacity-50 line-through' : ''}>
                          {c.name}: P{c.pop} = {c.income} EP{' '}
                        </span>
                      ))}
                      {row.freeTraders && row.routeSubtotal !== row.routeTotal && (
                        <span className="ml-1 text-blue-600 dark:text-blue-400">
                          ({row.routeSubtotal} × 1.5 → {row.routeTotal} EP)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Maintenance */}
        <div className="mb-4 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between rounded-t bg-gray-50 px-4 py-2 dark:bg-gray-800">
            <span className="text-sm font-semibold dark:text-gray-200">Maintenance</span>
            <span className="text-sm font-semibold text-red-600 dark:text-red-400">−{result.maintenance} EP</span>
          </div>
          <div className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
            {player.units.filter(u => !u.mothballed).length} active unit(s) — total cost {result.maintenanceCost} EP × 10% = {result.maintenance} EP
          </div>
        </div>

        {/* Misc (read-only, from previous turn's entries) */}
        <div className="mb-4 rounded border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between rounded-t bg-gray-50 px-4 py-2 dark:bg-gray-800">
            <span className="text-sm font-semibold dark:text-gray-200">Misc. Income / Expenses</span>
            <span className={`text-sm font-semibold ${result.misc >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {result.misc >= 0 ? '+' : ''}{result.misc} EP
            </span>
          </div>
          <p className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            {result.misc === 0 ? 'No misc. entries from previous turn.' : 'From previous turn\'s misc. entries.'}
          </p>
        </div>

        {/* Summary */}
        <div className="rounded border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium dark:text-gray-200">Net this turn:</span>
            <span className={`font-bold ${result.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {result.net >= 0 ? '+' : ''}{result.net} EP
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
            <span>Current EP: {player.ep}</span>
            <span>→</span>
            <span className={newEP < 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'dark:text-gray-200'}>
              New EP: {newEP}
            </span>
          </div>
          {newEP < 0 && (
            <div className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
              This player would go below 0 EP. At the Construction Phase, military units must be scrapped to cover the deficit.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Add to Tech Pool Modal ---

function AddToTechPoolModal({
  players,
  onAdd,
  onClose,
}: {
  players: CampaignPlayer[];
  onAdd: (playerId: string, amount: number) => void;
  onClose: () => void;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState(players[0]?.id ?? '');
  const [amountStr, setAmountStr] = useState('');

  const handleConfirm = () => {
    const amount = parseInt(amountStr);
    if (!selectedPlayerId || isNaN(amount) || amount === 0) return;
    onAdd(selectedPlayerId, amount);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold dark:text-gray-100">Add/Remove from Tech Pool</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            Admin tool — adds EP directly to Tech Pool without deducting from player EP.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Player</label>
            <select
              value={selectedPlayerId}
              onChange={e => setSelectedPlayerId(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name} (Pool: {p.techPool ?? 0} EP)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Amount (EP)</label>
            <input
              type="number"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirm()}
              placeholder="e.g. 10 or -5"
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
            <button
              onClick={handleConfirm}
              disabled={!selectedPlayerId || !amountStr || parseInt(amountStr) === 0 || isNaN(parseInt(amountStr))}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Reusable player picker with color + empire ---

function PlayerPicker({
  players,
  value,
  onChange,
  placeholder,
  excludeId,
}: {
  players: CampaignPlayer[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  excludeId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = excludeId ? players.filter(p => p.id !== excludeId) : players;
  const selected = players.find(p => p.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        {selected ? (
          <>
            {selected.teamColor && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: selected.teamColor }} />}
            <span className="flex-1 text-left">{selected.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{selected.empire.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-gray-400">{placeholder ?? '— Select —'}</span>
        )}
        <svg className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {placeholder && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {placeholder}
            </button>
          )}
          {options.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 ${p.id === value ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
            >
              {p.teamColor && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.teamColor }} />}
              <span className="flex-1 text-left">{p.name}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{p.empire.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Steal Unit Tech View (fullscreen) ---

function StealUnitTechModal({
  players,
  onSteal,
  onClose,
}: {
  players: CampaignPlayer[];
  onSteal: (receivingPlayerId: string, sourceEmpireId: string, unit: EmpireUnit) => void;
  onClose: () => void;
}) {
  const [receivingPlayerId, setReceivingPlayerId] = useState(players[0]?.id ?? '');
  const [targetPlayerId, setTargetPlayerId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');

  const receivingPlayer = players.find(p => p.id === receivingPlayerId);
  const targetPlayer = players.find(p => p.id === targetPlayerId);

  // Own unit designs from target (researched, not superseded)
  const targetOwnUnits = (targetPlayer?.empire.units ?? [])
    .filter(u => u.researched === true && !u.isSuperseded);

  // Stolen designs the target holds (with original sourceEmpireId), not superseded
  const targetStolenUnits = (targetPlayer?.stolenUnits ?? [])
    .filter(s => !s.unit.isSuperseded);

  // Lookup map: unit.id → stolen entry (only for stolen units)
  const stolenById = new Map(targetStolenUnits.map(s => [s.unit.id, s]));

  // Combined list: own first, then stolen — TechUnitList preserves within-category order
  // so stolen units naturally appear at the end of each category group
  const allUnits = [...targetOwnUnits, ...targetStolenUnits.map(s => s.unit)];

  const getEffectiveSourceId = (unit: EmpireUnit) =>
    stolenById.get(unit.id)?.sourceEmpireId ?? targetPlayerId;

  const isAlreadyStolen = (unit: EmpireUnit) =>
    (receivingPlayer?.stolenUnits ?? []).some(
      s => s.sourceEmpireId === getEffectiveSourceId(unit) && s.unit.id === unit.id
    );

  const selectedUnit = allUnits.find(u => u.id === selectedUnitId) ?? null;
  const canConfirm = !!receivingPlayerId && !!targetPlayerId && !!selectedUnit && !isAlreadyStolen(selectedUnit);

  const handleConfirm = () => {
    if (!selectedUnit) return;
    onSteal(receivingPlayerId, getEffectiveSourceId(selectedUnit), selectedUnit);
    onClose();
  };

  const handleReceiverChange = (id: string) => { setReceivingPlayerId(id); setSelectedUnitId(''); };
  const handleTargetChange = (id: string) => { setTargetPlayerId(id); setSelectedUnitId(''); };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          ← Close
        </button>
        <h1 className="flex-1 text-center text-base font-semibold dark:text-gray-100">Steal Unit Tech</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Receiving:</span>
            <PlayerPicker players={players} value={receivingPlayerId} onChange={handleReceiverChange} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Target:</span>
            <PlayerPicker
              players={players}
              value={targetPlayerId}
              onChange={handleTargetChange}
              placeholder="— Select target —"
              excludeId={receivingPlayerId}
            />
          </div>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
          >
            Steal Design →
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {!targetPlayerId ? (
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            Select a target empire to view stealable unit designs.
          </div>
        ) : allUnits.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            No stealable unit designs found for this empire.
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            <div className="mb-2 flex items-center gap-2">
              {targetPlayer?.teamColor && (
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: targetPlayer.teamColor }} />
              )}
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {targetPlayer?.name} — {targetPlayer?.empire.name}
              </span>
              {targetStolenUnits.length > 0 && (
                <span className="text-xs text-gray-400">
                  ({targetStolenUnits.length} stolen design{targetStolenUnits.length !== 1 ? 's' : ''} included at end of each category)
                </span>
              )}
            </div>
            <TechUnitList
              units={allUnits}
              selectedUnitId={selectedUnitId}
              getBadge={unit => {
                const stolenEntry = stolenById.get(unit.id);
                const alreadyStolenByReceiver = isAlreadyStolen(unit);
                const sourceEmpireName = stolenEntry
                  ? (players.find(p => p.id === stolenEntry.sourceEmpireId)?.empire.name ?? stolenEntry.sourceEmpireId)
                  : null;
                return (
                  <span className="flex items-center gap-1 justify-end">
                    {sourceEmpireName && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                        Via: {sourceEmpireName}
                      </span>
                    )}
                    {alreadyStolenByReceiver && (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        Already Stolen
                      </span>
                    )}
                  </span>
                );
              }}
              onClickUnit={unit => setSelectedUnitId(prev => prev === unit.id ? '' : unit.id)}
              getDisabled={unit => isAlreadyStolen(unit)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// --- Transfer Unit Modal ---

// --- Force Tech Advancement Modal ---

function ForceAdvancementModal({
  players,
  settings: _settings,
  independentListOverrides,
  onUnlockUnit,
  onUpgradeUnit,
  onUpgradeIndepUnit,
  onAddCustomUnit,
  onClose,
}: {
  players: CampaignPlayer[];
  settings: CampaignSettings;
  independentListOverrides: IndependentUnitList[];
  onUnlockUnit: (playerId: string, unitId: string) => void;
  onUpgradeUnit: (playerId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => void;
  onUpgradeIndepUnit: (listId: string, unitId: string, dvDelta: number, asDelta: number, afDelta: number, traitFactorDeltas: Record<string, number>) => void;
  onAddCustomUnit: (targetType: 'player' | 'independent', targetId: string, unit: EmpireUnit) => void;
  onClose: () => void;
}) {
  // tabs: player indices + 'cm'
  type TabId = number | 'cm';
  const [activeTab, setActiveTab] = useState<TabId>(0);
  type SubMode = 'overview' | 'choosing' | 'unlock' | 'upgrade' | 'custom';
  const [subMode, setSubMode] = useState<SubMode>('overview');
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  // CM sub-tab
  const [cmSubTab, setCmSubTab] = useState(0);

  // Effective independent lists (override takes priority over static)
  const effectiveIndepLists = INDEPENDENT_UNIT_LISTS.map(staticList => {
    const override = independentListOverrides.find(o => o.id === staticList.id);
    return override ?? staticList;
  });

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setSubMode('overview');
    setSelectedUnitId(null);
  };

  // --- Player tab content ---
  const renderPlayerTab = (player: CampaignPlayer) => {
    const lockedUnits = player.empire.units.filter(unit =>
      !unit.isSuperseded && !unit.researched
    );
    const upgradeableUnits = player.empire.units.filter(unit => {
      if (unit.isSuperseded) return false;
      if (!unit.researched) return false;
      const tl = typeof unit.techLevel === 'number' ? unit.techLevel : (unit.techLevel === 'E' ? 0 : 1);
      return tl < 5;
    });
    const selectedUnit = selectedUnitId ? player.empire.units.find(u => u.id === selectedUnitId) : null;
    const selectedUnitTL = selectedUnit ? (typeof selectedUnit.techLevel === 'number' ? selectedUnit.techLevel : 1) : 1;
    const selectedUnitNextTL = selectedUnit ? nextTechLevel(selectedUnitTL as TechLevelType) : null;
    const upgradePoints = selectedUnit && selectedUnitNextTL
      ? getUpgradePoints(selectedUnit.hullCode, selectedUnit.category, selectedUnitNextTL)
      : 0;

    if (subMode === 'choosing') {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Choose advancement type (no TAC deduction):</p>
          <div className="flex gap-3">
            <button
              onClick={() => setSubMode('unlock')}
              disabled={lockedUnits.length === 0}
              className="flex-1 rounded border border-blue-300 bg-white px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300"
            >
              Unlock a Unit <span className="ml-1 text-xs text-blue-400">({lockedUnits.length})</span>
            </button>
            <button
              onClick={() => setSubMode('upgrade')}
              disabled={upgradeableUnits.length === 0}
              className="flex-1 rounded border border-blue-300 bg-white px-4 py-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40 dark:border-blue-700 dark:bg-gray-900 dark:text-blue-300"
            >
              Upgrade a Unit <span className="ml-1 text-xs text-blue-400">({upgradeableUnits.length})</span>
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSubMode('custom')} className="text-xs text-purple-600 hover:underline dark:text-purple-400">+ Custom Unit</button>
            <button onClick={() => setSubMode('overview')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
          </div>
        </div>
      );
    }

    if (subMode === 'unlock') {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a unit to unlock:</p>
            <button onClick={() => setSubMode('choosing')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
          </div>
          {lockedUnits.length === 0
            ? <p className="text-sm text-gray-400">No locked units.</p>
            : <TechUnitList
                units={lockedUnits}
                getBadge={() => null}
                onClickUnit={unit => { onUnlockUnit(player.id, unit.id); setSubMode('overview'); }}
              />
          }
        </div>
      );
    }

    if (subMode === 'upgrade' && !selectedUnitId) {
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a unit to upgrade:</p>
            <button onClick={() => setSubMode('choosing')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
          </div>
          <TechUnitList
            units={upgradeableUnits}
            getBadge={unit => {
              const currentTL = typeof unit.techLevel === 'number' ? unit.techLevel : 1;
              const nextTL = nextTechLevel(currentTL as TechLevelType);
              const pts = nextTL ? getUpgradePoints(unit.hullCode, unit.category, nextTL) : 0;
              return (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="whitespace-nowrap text-xs text-blue-500">TL{currentTL}→{nextTL}</span>
                  <span className="whitespace-nowrap text-xs text-green-600 dark:text-green-400">+{pts} AP</span>
                </div>
              );
            }}
            onClickUnit={unit => setSelectedUnitId(unit.id)}
          />
        </div>
      );
    }

    if (subMode === 'upgrade' && selectedUnit) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Upgrading: <span className="font-bold">{selectedUnit.name}</span>
              <span className="ml-2 text-xs text-blue-500">TL{selectedUnitTL} → TL{selectedUnitNextTL} (+{upgradePoints} AP)</span>
            </p>
            <button onClick={() => setSelectedUnitId(null)} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
          </div>
          <UpgradeAllocator
            unit={selectedUnit}
            upgradePoints={upgradePoints}
            onConfirm={(dv, as_, af, traitDeltas) => {
              onUpgradeUnit(player.id, selectedUnit.id, dv, as_, af, traitDeltas);
              setSubMode('overview');
              setSelectedUnitId(null);
            }}
            onCancel={() => { setSelectedUnitId(null); setSubMode('choosing'); }}
          />
        </div>
      );
    }

    if (subMode === 'custom') {
      return (
        <CustomUnitForm
          players={players}
          independentLists={effectiveIndepLists}
          defaultTargetType="player"
          defaultTargetId={player.id}
          onAdd={(targetType, targetId, unit) => {
            onAddCustomUnit(targetType, targetId, unit);
            setSubMode('overview');
          }}
          onCancel={() => setSubMode('overview')}
        />
      );
    }

    // overview
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          {player.teamColor && <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: player.teamColor }} />}
          <h3 className="text-base font-semibold dark:text-gray-100">{player.name}</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">— {player.empire.name}</span>
        </div>
        <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          Tech Pool: <span className="font-bold text-gray-900 dark:text-gray-100">{player.techPool ?? 0} EP</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setSubMode('choosing')}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Force Advancement
          </button>
          <button
            onClick={() => setSubMode('custom')}
            className="rounded border border-purple-300 px-4 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950"
          >
            + Custom Unit
          </button>
        </div>
      </div>
    );
  };

  // --- CM tab content ---
  const renderCMTab = () => {
    const currentList = effectiveIndepLists[cmSubTab];
    if (!currentList) return null;
    const isHarbinger = currentList.id === 'harbinger';

    return (
      <div className="space-y-4">
        {/* CM sub-tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {effectiveIndepLists.map((list, i) => (
            <button
              key={list.id}
              onClick={() => { setCmSubTab(i); setSubMode('overview'); setSelectedUnitId(null); }}
              className={`px-4 py-2 text-sm ${cmSubTab === i ? 'border-b-2 border-blue-500 font-medium text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              {list.name}
            </button>
          ))}
        </div>

        {isHarbinger ? (
          <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            Harbinger units start at Ancient tech and cannot be upgraded.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Upgrade flow for independent lists */}
            {subMode === 'upgrade' && !selectedUnitId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a unit to upgrade:</p>
                  <button onClick={() => setSubMode('overview')} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
                </div>
                {currentList.units.filter(u => !u.isSuperseded).length === 0
                  ? <p className="text-sm text-gray-400">No upgradeable units.</p>
                  : <TechUnitList
                      units={currentList.units.filter(u => !u.isSuperseded)}
                      getBadge={unit => {
                        const currentTL = unit.techLevel ?? 'E';
                        const nextTL = nextTechLevel(currentTL, true);
                        const pts = typeof nextTL === 'number' ? getUpgradePoints(unit.hullCode, unit.category, nextTL) : 0;
                        return (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="whitespace-nowrap text-xs text-blue-500">
                              {currentTL === 'E' ? 'E' : `TL${currentTL}`}→{nextTL !== null ? `TL${nextTL}` : '—'}
                            </span>
                            {nextTL !== null && <span className="whitespace-nowrap text-xs text-green-600 dark:text-green-400">+{pts} AP</span>}
                          </div>
                        );
                      }}
                      onClickUnit={unit => setSelectedUnitId(unit.id)}
                    />
                }
              </div>
            )}

            {subMode === 'upgrade' && selectedUnitId && (() => {
              const unit = currentList.units.find(u => u.id === selectedUnitId);
              if (!unit) return null;
              const currentTL = unit.techLevel ?? 'E';
              const nextTL = nextTechLevel(currentTL, true);
              const pts = typeof nextTL === 'number' ? getUpgradePoints(unit.hullCode, unit.category, nextTL) : 0;
              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Upgrading: <span className="font-bold">{unit.name}</span>
                      <span className="ml-2 text-xs text-blue-500">{currentTL === 'E' ? 'E' : `TL${currentTL}`} → TL{nextTL} (+{pts} AP)</span>
                    </p>
                    <button onClick={() => setSelectedUnitId(null)} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
                  </div>
                  <UpgradeAllocator
                    unit={unit}
                    upgradePoints={pts}
                    onConfirm={(dv, as_, af, traitDeltas) => {
                      onUpgradeIndepUnit(currentList.id, unit.id, dv, as_, af, traitDeltas);
                      setSubMode('overview');
                      setSelectedUnitId(null);
                    }}
                    onCancel={() => { setSelectedUnitId(null); setSubMode('overview'); }}
                  />
                </div>
              );
            })()}

            {subMode === 'custom' && (
              <CustomUnitForm
                players={players}
                independentLists={effectiveIndepLists}
                defaultTargetType="independent"
                defaultTargetId={currentList.id}
                onAdd={(targetType, targetId, unit) => {
                  onAddCustomUnit(targetType, targetId, unit);
                  setSubMode('overview');
                }}
                onCancel={() => setSubMode('overview')}
              />
            )}

            {(subMode === 'overview' || (subMode !== 'upgrade' && subMode !== 'custom')) && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setSubMode('upgrade'); setSelectedUnitId(null); }}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Upgrade Unit
                </button>
                <button
                  onClick={() => setSubMode('custom')}
                  className="rounded border border-purple-300 px-4 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950"
                >
                  + Custom Unit
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const activePlayer = typeof activeTab === 'number' ? players[activeTab] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          ← Close
        </button>
        <h2 className="flex-1 text-center text-base font-semibold dark:text-gray-100">Force Tech Advancement</h2>
      </div>

      {/* Tabs: players + CM */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => handleTabChange(i)}
            className={`flex items-center gap-2 px-4 py-2 text-sm whitespace-nowrap ${activeTab === i ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {p.teamColor && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />}
            <span className="flex flex-col items-start leading-tight">
              <span>{p.name}</span>
              <span className="text-[11px] font-normal opacity-60">{p.empire.name}</span>
            </span>
          </button>
        ))}
        <button
          onClick={() => handleTabChange('cm')}
          className={`px-4 py-2 text-sm whitespace-nowrap ${activeTab === 'cm' ? 'border-b-2 border-gray-600 font-medium text-gray-800 dark:text-gray-200' : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'}`}
        >
          Campaign Master
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          {activeTab === 'cm' ? renderCMTab() : activePlayer ? renderPlayerTab(activePlayer) : null}
        </div>
      </div>
    </div>
  );
}

// --- Custom Unit Creation Form ---

const SHIP_HULL_CODES = ['AB','CT','FF','DD','CL','CW','CA','BC','BB','DN','SD','TN'] as const;
const FIGHTER_HULL_CODES = ['LF','MF','HF','SHF'] as const;
const BASE_HULL_CODES = ['OWP','BS1','BS2','BS3','BS4'] as const;

/** Decode a Hull/Type select key into hullCode + category. */
function decodeHullType(key: string): { hullCode: string; category: UnitCategory } {
  if (key.startsWith('special:')) return { hullCode: 'N/A', category: key.slice(8) as UnitCategory };
  const hull = key.slice(5);
  if ((FIGHTER_HULL_CODES as readonly string[]).includes(hull)) return { hullCode: hull, category: 'Fighters' };
  if ((BASE_HULL_CODES as readonly string[]).includes(hull)) return { hullCode: hull, category: 'Bases' };
  return { hullCode: hull, category: 'Ships' };
}

const PLAYER_TL_OPTIONS: Array<{ value: TechLevelType; label: string }> = [
  { value: 1, label: 'TL1' }, { value: 2, label: 'TL2' }, { value: 3, label: 'TL3' },
  { value: 4, label: 'TL4' }, { value: 5, label: 'TL5' },
];
const ALL_TL_OPTIONS: Array<{ value: TechLevelType; label: string }> = [
  { value: 'E', label: 'TL-E (Early)' },
  ...PLAYER_TL_OPTIONS,
  { value: 'A', label: 'TL-A (Ancient)' },
];

/**
 * Number-only input with scroll-to-increment and ▲▼ arrow buttons.
 * Only accepts digits (and empty). When the value is '-' (e.g. forced by Troops mode),
 * renders as a plain disabled text input instead.
 */
function SmartStatInput({
  value,
  onChange,
  disabled = false,
  min,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  min?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isDash = value === '-';
  const isNumericOrEmpty = !isDash && (value === '' || /^\d+$/.test(value));
  const showArrows = !disabled && !isDash && isNumericOrEmpty;

  // Mutable refs so the wheel handler always sees fresh values without re-registering.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const minRef = useRef(min);
  minRef.current = min;

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      const v = valueRef.current;
      if (v === '-' || !(v === '' || /^\d+$/.test(v))) return;
      e.preventDefault();
      const num = v === '' ? 0 : parseInt(v);
      if (e.deltaY < 0) {
        onChangeRef.current(String(num + 1));
      } else {
        const next = num - 1;
        if (minRef.current !== undefined && next < minRef.current) return;
        onChangeRef.current(String(next));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional; uses refs for fresh values

  // When value is '-', render a plain disabled text input
  if (isDash) {
    return (
      <input
        type="text"
        value="-"
        readOnly
        disabled
        className="w-full rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:border-gray-600 dark:disabled:bg-gray-700/50 dark:disabled:text-gray-500"
      />
    );
  }

  const getNum = () => value === '' ? 0 : (parseInt(value) || 0);
  const increment = () => onChange(String(getNum() + 1));
  const decrement = () => {
    const next = getNum() - 1;
    if (min !== undefined && next < min) return;
    onChange(String(next));
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => {
          const v = e.target.value;
          if (v === '' || /^\d+$/.test(v)) onChange(v);
        }}
        disabled={disabled}
        className={`w-full rounded border border-gray-300 py-1 text-right text-sm tabular-nums dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-700/50 dark:disabled:text-gray-500 ${showArrows ? 'pl-2 pr-6' : 'px-2'}`}
      />
      {showArrows && (
        <div className="absolute inset-y-0 right-0 flex flex-col overflow-hidden rounded-r border-l border-gray-200 dark:border-gray-600">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); increment(); }}
            className="flex flex-1 w-5 items-center justify-center text-[9px] leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >▲</button>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={e => { e.preventDefault(); decrement(); }}
            className="flex flex-1 w-5 items-center justify-center text-[9px] leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >▼</button>
        </div>
      )}
    </div>
  );
}

function CustomUnitForm({
  players,
  independentLists,
  defaultTargetType,
  defaultTargetId,
  onAdd,
  onCancel,
}: {
  players: CampaignPlayer[];
  independentLists: IndependentUnitList[];
  defaultTargetType: 'player' | 'independent';
  defaultTargetId: string;
  onAdd: (targetType: 'player' | 'independent', targetId: string, unit: EmpireUnit) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [hullTypeKey, setHullTypeKey] = useState<string>('hull:FF');
  const [tl, setTl] = useState<TechLevelType>(1);
  const [dvStr, setDvStr] = useState('');
  const [asStr, setAsStr] = useState('');
  const [afStr, setAfStr] = useState('');
  const [crStr, setCrStr] = useState('');
  const [ccStr, setCcStr] = useState('');
  const [traits, setTraits] = useState<Array<{ name: string; factor: string }>>([]);
  const [targetType, setTargetType] = useState<'player' | 'independent'>(defaultTargetType);
  const [targetId, setTargetId] = useState(defaultTargetId);

  const { hullCode, category } = decodeHullType(hullTypeKey);
  const isTroops = category === 'Troops';
  const isTroopCivilian = category === 'Troops' || category === 'Civilian';
  const tlOptions = isTroopCivilian ? PLAYER_TL_OPTIONS : ALL_TL_OPTIONS;

  const handleHullTypeChange = (key: string) => {
    const { category: newCat } = decodeHullType(key);
    setHullTypeKey(key);
    if ((newCat === 'Troops' || newCat === 'Civilian') && (tl === 'E' || tl === 'A')) setTl(1);
    // Clear traits that are invalid for the new category
    if (newCat === 'Troops') {
      setTraits(prev => prev.filter(t => !t.name || (TROOP_TRAITS as readonly string[]).includes(t.name)));
    } else {
      setTraits(prev => prev.filter(t => !t.name || (STANDARD_TRAITS as readonly string[]).includes(t.name) || (FACTOR_TRAITS as readonly string[]).includes(t.name)));
    }
  };

  const apBudget = getTotalAP(hullCode, category, tl);
  const dv = parseInt(dvStr) || 0;
  const as_ = asStr === '-' ? '-' : (parseInt(asStr) || 0);
  const af = (isTroops || afStr === '-') ? '-' : (parseInt(afStr) || 0);
  // CR and CC do not contribute to AP
  // Trait AP: non-factor traits cost 2 AP each; factor traits cost 2 AP per factor level (trait itself is free)
  const traitAP = traits.reduce((sum, t) => {
    const isFactor = (FACTOR_TRAITS as readonly string[]).includes(t.name);
    if (isFactor) return sum + (parseInt(t.factor) || 0) * 2;
    return sum + (t.name ? 2 : 0);
  }, 0);
  const apUsed = dv + (typeof as_ === 'number' ? as_ : 0) + (typeof af === 'number' ? af : 0)
    + traitAP;
  const apRemaining = apBudget - apUsed;

  const handleAddTrait = () => setTraits(prev => [...prev, { name: '', factor: '' }]);
  const handleRemoveTrait = (i: number) => setTraits(prev => prev.filter((_, idx) => idx !== i));
  const handleTraitChange = (i: number, field: 'name' | 'factor', value: string) => {
    setTraits(prev => prev.map((t, idx) => {
      if (idx !== i) return t;
      if (field === 'name') {
        const isFactor = (FACTOR_TRAITS as readonly string[]).includes(value);
        return { name: value, factor: isFactor ? t.factor : '' };
      }
      return { ...t, [field]: value };
    }));
  };
  const selectedTraitNames = new Set(traits.map(t => t.name));

  const handleConfirm = () => {
    if (!name.trim()) return;
    const unit: EmpireUnit = {
      id: crypto.randomUUID(),
      name: name.trim(),
      hullCode,
      category,
      cost: 0,
      isd: 'N/A',
      researched: true,
      dv,
      as: asStr === '-' ? '-' : (parseInt(asStr) || 0),
      af: (isTroops || afStr === '-') ? '-' : (parseInt(afStr) || 0),
      cr: (isTroops || !crStr) ? '-' : (parseInt(crStr) || 0),
      cc: (isTroops || !ccStr) ? '-' : (parseInt(ccStr) || 0),
      traits: traits.filter(t => t.name.trim()).map(t => ({
        name: t.name.trim(),
        factor: t.factor ? parseFloat(t.factor) : undefined,
      })),
      techLevel: tl,
      isSuperseded: false,
    };
    onAdd(targetType, targetId, unit);
  };

  const statFields: Array<{ label: string; val: string; set: (v: string) => void; disabled: boolean }> = [
    { label: 'DV',                      val: dvStr,              set: setDvStr, disabled: false     },
    { label: isTroops ? 'ATK' : 'AS',   val: asStr,              set: setAsStr, disabled: false     },
    { label: 'AF',                       val: isTroops ? '-' : afStr, set: setAfStr, disabled: isTroops },
    { label: 'CR',                       val: isTroops ? '-' : crStr, set: setCrStr, disabled: isTroops },
    { label: 'CC',                       val: isTroops ? '-' : ccStr, set: setCcStr, disabled: isTroops },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-purple-700 dark:text-purple-300">Create Custom Unit</p>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:underline dark:text-gray-400">← Back</button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Unit Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Icarus"
            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Hull / Type</label>
          <select
            value={hullTypeKey}
            onChange={e => handleHullTypeChange(e.target.value)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <optgroup label="Ships">
              {SHIP_HULL_CODES.map(c => <option key={c} value={`hull:${c}`}>{c}</option>)}
            </optgroup>
            <optgroup label="Fighters">
              {FIGHTER_HULL_CODES.map(c => <option key={c} value={`hull:${c}`}>{c}</option>)}
            </optgroup>
            <optgroup label="Bases">
              {BASE_HULL_CODES.map(c => <option key={c} value={`hull:${c}`}>{c}</option>)}
            </optgroup>
            <optgroup label="Special">
              <option value="special:Troops">Troops</option>
              <option value="special:Civilian">Civilian</option>
            </optgroup>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Tech Level</label>
          <select
            value={String(tl)}
            onChange={e => setTl(e.target.value === 'E' ? 'E' : e.target.value === 'A' ? 'A' : parseInt(e.target.value) as TechLevelType)}
            className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            {tlOptions.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            AP Budget: <span className={`font-bold ${apRemaining < 0 ? 'text-orange-600' : 'text-green-700 dark:text-green-400'}`}>{apRemaining} remaining</span>
          </label>
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            Total: {apBudget} AP (DV / {isTroops ? 'ATK' : 'AS'}{!isTroops ? ' / AF' : ''}: 1 AP each · Traits: 2 AP · Factor: 2 AP/level · CR/CC: free)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {statFields.map(s => (
          <div key={s.label}>
            <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{s.label}</label>
            <SmartStatInput value={s.val} onChange={s.set} disabled={s.disabled} min={0} />
          </div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Traits</p>
          <button onClick={handleAddTrait} className="text-xs text-blue-600 hover:underline dark:text-blue-400">+ Add Trait</button>
        </div>
        {traits.map((t, i) => {
          const hasFactor = (FACTOR_TRAITS as readonly string[]).includes(t.name);
          return (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select
                value={t.name}
                onChange={e => handleTraitChange(i, 'name', e.target.value)}
                className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Select trait...</option>
                {isTroops ? (
                  <optgroup label="Troop">
                    {TROOP_TRAITS.map(tn => (
                      <option key={tn} value={tn} disabled={selectedTraitNames.has(tn) && tn !== t.name}>{tn}</option>
                    ))}
                  </optgroup>
                ) : (
                  <>
                    <optgroup label="Standard">
                      {STANDARD_TRAITS.map(tn => (
                        <option key={tn} value={tn} disabled={selectedTraitNames.has(tn) && tn !== t.name}>{tn}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Factor">
                      {FACTOR_TRAITS.map(tn => (
                        <option key={tn} value={tn} disabled={selectedTraitNames.has(tn) && tn !== t.name}>{tn}</option>
                      ))}
                    </optgroup>
                  </>
                )}
              </select>
              {hasFactor && (
                <div className="w-20">
                  <SmartStatInput value={t.factor} onChange={v => handleTraitChange(i, 'factor', v)} min={1} />
                </div>
              )}
              <button onClick={() => handleRemoveTrait(i)} className="text-gray-400 hover:text-red-500">✕</button>
            </div>
          );
        })}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Add to List</label>
        <select
          value={`${targetType}:${targetId}`}
          onChange={e => {
            const [type, id] = e.target.value.split(':') as ['player' | 'independent', string];
            setTargetType(type);
            setTargetId(id);
          }}
          className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <optgroup label="Player Lists">
            {players.map(p => <option key={p.id} value={`player:${p.id}`}>{p.name}'s Empire</option>)}
          </optgroup>
          <optgroup label="Independent Lists">
            {independentLists.map(l => <option key={l.id} value={`independent:${l.id}`}>{l.name}</option>)}
          </optgroup>
        </select>
      </div>

      {apRemaining < 0 && (
        <div className="rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-400">
          Unit is over AP budget by {Math.abs(apRemaining)} AP. You can still create it.
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded border border-gray-300 px-4 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="rounded bg-purple-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          Create Unit
        </button>
      </div>
    </div>
  );
}

// --- Misc Income Modal ---

interface MiscIncomeModalProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  onAddEntry: (playerIndex: number, description: string, amount: number) => void;
  onRemoveEntry: (playerIndex: number, entryId: string) => void;
  onClose: () => void;
  currentTurn: number;
}

function MiscIncomeModal({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  onAddEntry,
  onRemoveEntry,
  onClose,
  currentTurn,
}: MiscIncomeModalProps) {
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');

  const player = players[currentPlayerIndex];
  const pending = player?.pendingMiscEntries ?? [];
  const pendingTotal = pending.reduce((s, e) => s + e.amount, 0);

  const handleAdd = () => {
    const amount = parseInt(amountStr);
    if (!description.trim() || isNaN(amount) || amount === 0) return;
    onAddEntry(currentPlayerIndex, description.trim(), amount);
    setDescription('');
    setAmountStr('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-gray-300 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold dark:text-gray-100">Misc. Income / Expenses</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
        </div>

        {/* Note */}
        <div className="border-b border-gray-100 bg-amber-50 px-5 py-2 text-xs text-amber-800 dark:border-gray-700 dark:bg-amber-900/20 dark:text-amber-400">
          Entries added here will apply to <strong>Turn {currentTurn + 1}</strong>'s Economic Phase.
        </div>

        {/* Player Tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {players.map((p, i) => {
            const tot = (p.pendingMiscEntries ?? []).reduce((s, e) => s + e.amount, 0);
            return (
              <button
                key={p.id}
                onClick={() => onSelectPlayer(i)}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm ${
                  i === currentPlayerIndex
                    ? 'border-blue-500 font-semibold text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {p.teamColor && <span className="h-2 w-2 rounded-full" style={{ background: p.teamColor }} />}
                <span>{p.name}</span>
                {tot !== 0 && (
                  <span className={`text-xs ${tot > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {tot > 0 ? '+' : ''}{tot}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="p-5">
          {/* Existing entries */}
          {pending.length > 0 ? (
            <div className="mb-4 divide-y divide-gray-100 rounded border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
              {pending.map(entry => (
                <div key={entry.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="flex-1 dark:text-gray-200">{entry.description}</span>
                  <span className={`mx-3 font-medium ${entry.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                    {entry.amount >= 0 ? '+' : ''}{entry.amount} EP
                  </span>
                  <button
                    onClick={() => onRemoveEntry(currentPlayerIndex, entry.id)}
                    className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                  >✕</button>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-1.5 text-sm font-semibold">
                <span className="dark:text-gray-200">Total (next turn):</span>
                <span className={pendingTotal >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}>
                  {pendingTotal >= 0 ? '+' : ''}{pendingTotal} EP
                </span>
              </div>
            </div>
          ) : (
            <p className="mb-4 text-sm text-gray-400 dark:text-gray-500">No entries yet for {player?.name}.</p>
          )}

          {/* Add new entry */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <input
              type="number"
              placeholder="±EP"
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              className="w-20 rounded border border-gray-300 px-2 py-1.5 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              onClick={handleAdd}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Add
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Positive for income, negative for expense.</p>
        </div>
      </div>
    </div>
  );
}

// --- Campaign Phase Panel (left sidebar) ---

interface CampaignPhasePanelProps {
  phase: CampaignPhase;
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  settings: CampaignSettings;
  onSelectPlayer: (index: number) => void;
  onSelectHomeworld: (systemId: string) => void;
  onChangePlayerColor: (playerIndex: number, color: string) => void;
  onFinishHomeworldSelection: () => void;
  availableHomeworlds: ReturnType<ReturnType<typeof useMapState>['getSystem']>[];
  selectedSystemId: string | null;
  mapState: ReturnType<typeof useMapState>;
  onPurchaseSystem: (systemId: string) => void;
  onFinishAllPurchases: () => void;
  getConnectedPurchasableSystems: (playerIndex: number) => System[];
  getSystemCost: (system: System) => number;
  confirm: ReturnType<typeof useConfirm>;
  onFinishLaneRolling: () => void;
  onDeployUnits: (unitTemplateId: string, systemId: string, count: number) => void;
  onResetDeployment: () => void;
  onFinishDeployment: () => void;
  onSetTradeRoute: (playerId: string, convoyUnitId: string, systemIds: string[]) => void;
  onClearTradeRoute: (playerId: string, convoyUnitId: string) => void;
  onFinishTradeRoutes: () => void;
  canRevert: boolean;
  onRevert: () => void;
}

function CampaignPhasePanel({
  phase,
  players,
  currentPlayerIndex,
  settings: _settings,
  onSelectPlayer,
  onSelectHomeworld,
  onChangePlayerColor,
  onFinishHomeworldSelection,
  availableHomeworlds,
  selectedSystemId,
  mapState,
  onPurchaseSystem,
  onFinishAllPurchases,
  getConnectedPurchasableSystems,
  getSystemCost,
  confirm,
  onFinishLaneRolling,
  onDeployUnits,
  onResetDeployment,
  onFinishDeployment,
  onSetTradeRoute,
  onClearTradeRoute,
  onFinishTradeRoutes,
  canRevert,
  onRevert,
}: CampaignPhasePanelProps) {
  return (
    <aside className="w-72 overflow-y-auto border-r border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      {/* Revert to previous phase button */}
      {canRevert && phase !== 'in_progress' && (
        <button
          onClick={onRevert}
          className="mb-3 flex w-full items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <span>&#8592;</span>
          <span>Back to Previous Phase</span>
        </button>
      )}
      {phase === 'homeworld_selection' && (
        <HomeworldSelectionPanel
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={onSelectPlayer}
          onSelectHomeworld={onSelectHomeworld}
          onChangePlayerColor={onChangePlayerColor}
          onFinish={onFinishHomeworldSelection}
          availableHomeworlds={availableHomeworlds}
          selectedSystemId={selectedSystemId}
          mapState={mapState}
        />
      )}

      {phase === 'system_purchase' && (
        <SystemPurchasePanel
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={onSelectPlayer}
          mapState={mapState}
          selectedSystemId={selectedSystemId}
          onPurchaseSystem={onPurchaseSystem}
          onFinishAllPurchases={onFinishAllPurchases}
          getConnectedPurchasableSystems={getConnectedPurchasableSystems}
          getSystemCost={getSystemCost}
          confirm={confirm}
        />
      )}

      {phase === 'lane_rolling' && (
        <LaneRollingPanel
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={onSelectPlayer}
          mapState={mapState}
          onFinish={onFinishLaneRolling}
          confirm={confirm}
        />
      )}



      {phase === 'unit_deployment' && (
        <UnitDeploymentPanel
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={onSelectPlayer}
          mapState={mapState}
          onDeployUnits={onDeployUnits}
          onResetDeployment={onResetDeployment}
          onFinish={onFinishDeployment}
        />
      )}

      {phase === 'trade_routes' && (
        <TradeRoutesPanel
          players={players}
          currentPlayerIndex={currentPlayerIndex}
          onSelectPlayer={onSelectPlayer}
          mapState={mapState}
          onSetTradeRoute={onSetTradeRoute}
          onClearTradeRoute={onClearTradeRoute}
          onFinish={onFinishTradeRoutes}
        />
      )}

      {phase === 'in_progress' && (
        <div>
          <h2 className="mb-3 text-base font-semibold dark:text-gray-100">Campaign</h2>
          <div className="space-y-2">
            {players.map((player) => {
              const pendingTotal = (player.pendingMiscEntries ?? []).reduce((s, e) => s + e.amount, 0);
              return (
                <div key={player.id} className="rounded border border-gray-200 p-2 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {player.teamColor && (
                        <span className="h-2 w-2 rounded-full" style={{ background: player.teamColor }} />
                      )}
                      <span className="text-xs font-medium dark:text-gray-200">{player.name}</span>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{player.ep} EP</span>
                  </div>
                  {pendingTotal !== 0 && (
                    <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      Next turn misc: {pendingTotal > 0 ? '+' : ''}{pendingTotal} EP
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

// --- Homeworld Selection Panel ---

interface HomeworldSelectionPanelProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  onSelectHomeworld: (systemId: string) => void;
  onChangePlayerColor: (playerIndex: number, color: string) => void;
  onFinish: () => void;
  availableHomeworlds: ReturnType<ReturnType<typeof useMapState>['getSystem']>[];
  selectedSystemId: string | null;
  mapState: ReturnType<typeof useMapState>;
}

function HomeworldSelectionPanel({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  onSelectHomeworld,
  onChangePlayerColor,
  onFinish,
  availableHomeworlds,
  selectedSystemId,
  mapState,
}: HomeworldSelectionPanelProps) {
  const allAssigned = players.every(p => !!p.homeworldId);

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold dark:text-gray-100">Homeworld Selection</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Each player must select a homeworld system. Click a player, then click an available homeworld on the map or use the "Assign Selected" button.
      </p>

      {/* Player list */}
      <div className="mb-4 space-y-2">
        {players.map((player, i) => {
          const homeworld = player.homeworldId ? mapState.getSystem(player.homeworldId) : null;
          const isActive = i === currentPlayerIndex;

          return (
            <div
              key={player.id}
              onClick={() => !player.homeworldId && onSelectPlayer(i)}
              className={`rounded border p-3 ${
                isActive && !player.homeworldId
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : player.homeworldId
                    ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                    : 'cursor-pointer border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium dark:text-gray-100">
                    {player.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {player.empire?.name}
                  </p>
                </div>
                {player.teamColor && (
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={player.teamColor}
                      onChange={(e) => {
                        e.stopPropagation();
                        onChangePlayerColor(i, e.target.value);
                      }}
                      className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
                      title="Change team color"
                    />
                  </div>
                )}
              </div>
              {homeworld && (
                <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                  Homeworld: {homeworld.name || `(${homeworld.position.q}, ${homeworld.position.r})`}
                </p>
              )}
              {!player.homeworldId && isActive && (
                <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
                  Awaiting homeworld selection...
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Assign selected system button */}
      {!allAssigned && selectedSystemId && (
        <AssignHomeworldButton
          selectedSystemId={selectedSystemId}
          availableHomeworlds={availableHomeworlds}
          currentPlayer={players[currentPlayerIndex]}
          onAssign={onSelectHomeworld}
          mapState={mapState}
        />
      )}

      {/* Available homeworlds list */}
      {!allAssigned && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium dark:text-gray-200">Available Homeworlds</h3>
          <div className="space-y-1">
            {availableHomeworlds.map(hw => {
              if (!hw) return null;
              return (
                <button
                  key={hw.id}
                  onClick={() => {
                    mapState.setSelectedSystemId(hw.id);
                    mapState.setSelectedLaneId(null);
                  }}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  {hw.name || `Homeworld (${hw.position.q}, ${hw.position.r})`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Finish button */}
      {allAssigned && (
        <button
          onClick={onFinish}
          className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          Continue to System Purchase
        </button>
      )}
    </div>
  );
}

// --- System Purchase Panel ---

interface SystemPurchasePanelProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  mapState: ReturnType<typeof useMapState>;
  selectedSystemId: string | null;
  onPurchaseSystem: (systemId: string) => void;
  onFinishAllPurchases: () => void;
  getConnectedPurchasableSystems: (playerIndex: number) => System[];
  getSystemCost: (system: System) => number;
  confirm: ReturnType<typeof useConfirm>;
}

function SystemPurchasePanel({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  mapState,
  selectedSystemId,
  onPurchaseSystem,
  onFinishAllPurchases,
  getConnectedPurchasableSystems,
  getSystemCost,
  confirm,
}: SystemPurchasePanelProps) {
  const currentPlayer = players[currentPlayerIndex];
  const purchasableSystems = getConnectedPurchasableSystems(currentPlayerIndex);
  const canAffordAny = purchasableSystems.some(s => getSystemCost(s) <= currentPlayer.sp);

  const anyUnspentSP = players.some(p => p.sp > 0);

  const handleFinishClick = async () => {
    if (anyUnspentSP) {
      const playersWithSP = players.filter(p => p.sp > 0);
      const confirmed = await confirm({
        title: 'Finish System Purchases',
        message: (
          <div>
            <p className="mb-3">Unspent SP will be converted to EP (10 EP per SP):</p>
            <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-700/50">
              {playersWithSP.map(p => (
                <div key={p.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.teamColor && (
                      <div
                        className="h-3 w-3 rounded-full border border-gray-400"
                        style={{ backgroundColor: p.teamColor }}
                      />
                    )}
                    <span className="font-medium dark:text-gray-200">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-green-600 dark:text-green-400">{p.sp} SP</span>
                    <span className="text-gray-400">→</span>
                    <span className="font-medium text-amber-600 dark:text-amber-400">+{p.sp * 10} EP</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
        confirmLabel: 'Finish Purchases',
        variant: 'confirm',
      });
      if (!confirmed) return;
    }
    onFinishAllPurchases();
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold dark:text-gray-100">System Purchase</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Select a player, then purchase connected systems. Cost = Population x RAW.
      </p>

      {/* Player selector - click to switch */}
      <div className="mb-4 space-y-1">
        {players.map((player, i) => {
          const isActive = i === currentPlayerIndex;
          const bonusEP = player.sp * 10;
          return (
            <button
              key={player.id}
              onClick={() => onSelectPlayer(i)}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                isActive
                  ? 'border border-blue-500 bg-blue-50 font-medium dark:bg-blue-900/20'
                  : 'border border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {player.teamColor && (
                  <div
                    className="h-3 w-3 rounded-full border border-gray-400"
                    style={{ backgroundColor: player.teamColor }}
                  />
                )}
                <span className="dark:text-gray-200">{player.name}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-500 dark:text-gray-400">
                  {player.ownedSystemIds.length} sys
                </span>
                <span className={`font-medium ${player.sp > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                  {player.sp} SP
                </span>
                {bonusEP > 0 && (
                  <span className="text-amber-600 dark:text-amber-400" title="EP gained from unspent SP if purchases finish now">
                    +{bonusEP} EP
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Current player info */}
      <div className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-900/20">
        <p className="text-sm font-medium dark:text-gray-100">
          Purchasing for {currentPlayer.name}
        </p>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {currentPlayer.sp} SP remaining | {currentPlayer.ownedSystemIds.length} system{currentPlayer.ownedSystemIds.length !== 1 ? 's' : ''} owned
        </p>
      </div>

      {/* Purchase button for selected system */}
      {selectedSystemId && (
        <PurchaseSystemButton
          selectedSystemId={selectedSystemId}
          purchasableSystems={purchasableSystems}
          currentPlayer={currentPlayer}
          mapState={mapState}
          getSystemCost={getSystemCost}
          onPurchase={onPurchaseSystem}
        />
      )}

      {/* Available systems to purchase */}
      {purchasableSystems.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium dark:text-gray-200">Connected Systems</h3>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {purchasableSystems.map(system => {
              const cost = getSystemCost(system);
              const canAfford = currentPlayer.sp >= cost;
              return (
                <button
                  key={system.id}
                  onClick={() => {
                    mapState.setSelectedSystemId(system.id);
                    mapState.setSelectedLaneId(null);
                  }}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    selectedSystemId === system.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="dark:text-gray-200">
                      {system.name || `(${system.position.q}, ${system.position.r})`}
                    </span>
                    <span className={`text-xs font-medium ${canAfford ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                      {cost} SP
                    </span>
                  </div>
                  {system.attributes && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      P:{system.attributes.population} x RAW:{system.attributes.raw} = {cost} SP
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Status messages */}
      {currentPlayer.sp === 0 && (
        <div className="mt-4 rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {currentPlayer.name} has no SP remaining.
        </div>
      )}

      {currentPlayer.sp > 0 && purchasableSystems.length === 0 && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          No connected systems available to purchase.
        </div>
      )}

      {currentPlayer.sp > 0 && purchasableSystems.length > 0 && !canAffordAny && (
        <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          Not enough SP to purchase any connected system.
        </div>
      )}

      {/* Finish all purchases button */}
      <div className="mt-6">
        <button
          onClick={handleFinishClick}
          className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          Finish System Purchases
        </button>
      </div>
    </div>
  );
}

// --- Lane Rolling Panel ---

function getImportanceModifier(type: SystemType): number {
  switch (type) {
    case 'unimportant': return -1;
    case 'minor': return 0;
    case 'major': return 1;
    case 'homeworld': return 1;
    default: return 0;
  }
}

function getLaneResult(finalRoll: number): LaneType {
  if (finalRoll <= 3) return 'restricted';
  if (finalRoll <= 7) return 'minor';
  return 'major';
}

function getLaneTypeColor(type: LaneType): string {
  switch (type) {
    case 'major': return 'text-green-600 dark:text-green-400';
    case 'minor': return 'text-gray-600 dark:text-gray-300';
    case 'restricted': return 'text-red-600 dark:text-red-400';
    default: return 'text-gray-500 dark:text-gray-400';
  }
}

interface RolledLaneResult {
  laneId: string;
  d10: number;
  modifier: number;
  finalRoll: number;
  result: LaneType;
}

interface LaneRollingPanelProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  mapState: ReturnType<typeof useMapState>;
  onFinish: () => void;
  confirm: ReturnType<typeof useConfirm>;
}

function LaneRollingPanel({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  mapState,
  onFinish,
  confirm,
}: LaneRollingPanelProps) {
  const [rolledLanes, setRolledLanes] = useState<Record<string, RolledLaneResult>>({});
  const [skippedLanes, setSkippedLanes] = useState<Set<string>>(new Set());

  // Get lanes where both endpoints are owned by a specific player
  const getPlayerLanes = (playerIndex: number): { lane: JumpLane; systemA: System; systemB: System }[] => {
    const player = players[playerIndex];
    if (!player) return [];
    const ownedSet = new Set(player.ownedSystemIds);
    const result: { lane: JumpLane; systemA: System; systemB: System }[] = [];

    for (const lane of mapState.map.jumpLanes) {
      if (ownedSet.has(lane.from) && ownedSet.has(lane.to)) {
        const systemA = mapState.getSystem(lane.from);
        const systemB = mapState.getSystem(lane.to);
        if (systemA && systemB) {
          result.push({ lane, systemA, systemB });
        }
      }
    }
    return result;
  };

  const playerLanes = getPlayerLanes(currentPlayerIndex);

  // Count total unrolled lanes across all players
  const totalUnrolledAcrossAll = players.reduce((count, _, i) => {
    const lanes = getPlayerLanes(i);
    return count + lanes.filter(({ lane }) => !rolledLanes[lane.id] && !skippedLanes.has(lane.id)).length;
  }, 0);

  const handleRoll = (laneId: string, systemA: System, systemB: System) => {
    const d10 = Math.floor(Math.random() * 10) + 1;
    const modA = getImportanceModifier(systemA.type);
    const modB = getImportanceModifier(systemB.type);
    const modifier = modA + modB;
    const finalRoll = d10 + modifier;
    const result = getLaneResult(finalRoll);

    setRolledLanes(prev => ({
      ...prev,
      [laneId]: { laneId, d10, modifier, finalRoll, result },
    }));

    mapState.updateJumpLane(laneId, { type: result });
  };

  const handleSkip = (laneId: string) => {
    setSkippedLanes(prev => new Set([...prev, laneId]));
  };

  const handleFinishClick = async () => {
    if (totalUnrolledAcrossAll > 0) {
      const confirmed = await confirm({
        title: 'Finish Lane Rolling',
        message: `${totalUnrolledAcrossAll} lane(s) have not been rolled. Skipped lanes can still be set manually via the property panel. Continue?`,
        confirmLabel: 'Finish',
        variant: 'confirm',
      });
      if (!confirmed) return;
    }
    onFinish();
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold dark:text-gray-100">Lane Quality Rolling</h2>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Roll d10 for each lane. System importance modifies the result.
      </p>

      {/* Player selector */}
      <div className="mb-4 space-y-1">
        {players.map((player, i) => {
          const isActive = i === currentPlayerIndex;
          const lanes = getPlayerLanes(i);
          const rolled = lanes.filter(({ lane }) => rolledLanes[lane.id]).length;
          const skipped = lanes.filter(({ lane }) => skippedLanes.has(lane.id)).length;
          const remaining = lanes.length - rolled - skipped;
          return (
            <button
              key={player.id}
              onClick={() => onSelectPlayer(i)}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                isActive
                  ? 'border border-blue-500 bg-blue-50 font-medium dark:bg-blue-900/20'
                  : 'border border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {player.teamColor && (
                  <div
                    className="h-3 w-3 rounded-full border border-gray-400"
                    style={{ backgroundColor: player.teamColor }}
                  />
                )}
                <span className="dark:text-gray-200">{player.name}</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {lanes.length === 0 ? 'No lanes' : remaining > 0 ? `${remaining} left` : 'Done'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Lane list */}
      {playerLanes.length === 0 ? (
        <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {players[currentPlayerIndex]?.name} has no lanes to roll (both endpoints must be owned).
        </div>
      ) : (
        <div className="space-y-2">
          {playerLanes.map(({ lane, systemA, systemB }) => {
            const rolled = rolledLanes[lane.id];
            const isSkipped = skippedLanes.has(lane.id);
            const modA = getImportanceModifier(systemA.type);
            const modB = getImportanceModifier(systemB.type);
            const totalMod = modA + modB;

            return (
              <div
                key={lane.id}
                className={`rounded border p-3 ${
                  rolled
                    ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                    : isSkipped
                      ? 'border-gray-200 bg-gray-50/50 opacity-60 dark:border-gray-700 dark:bg-gray-800/30'
                      : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                {/* System names */}
                <div className="mb-1 text-sm font-medium dark:text-gray-200">
                  {systemA.name || 'Unnamed'} ↔ {systemB.name || 'Unnamed'}
                </div>

                {/* Modifier info */}
                <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  Modifier: {totalMod >= 0 ? '+' : ''}{totalMod}
                  <span className="ml-1">
                    ({systemA.type} {modA >= 0 ? '+' : ''}{modA}, {systemB.type} {modB >= 0 ? '+' : ''}{modB})
                  </span>
                </div>

                {rolled ? (
                  /* Show roll result */
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-gray-500 dark:text-gray-400">
                      d10: {rolled.d10} {rolled.modifier >= 0 ? '+' : ''}{rolled.modifier} = {rolled.finalRoll}
                    </span>
                    <span className="mx-1">→</span>
                    <span className={`font-semibold capitalize ${getLaneTypeColor(rolled.result)}`}>
                      {rolled.result}
                    </span>
                  </div>
                ) : isSkipped ? (
                  <div className="text-xs italic text-gray-400 dark:text-gray-500">Skipped</div>
                ) : (
                  /* Roll / Skip buttons */
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRoll(lane.id, systemA, systemB)}
                      className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                    >
                      Roll
                    </button>
                    <button
                      onClick={() => handleSkip(lane.id)}
                      className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finish button */}
      <div className="mt-6">
        <button
          onClick={handleFinishClick}
          className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          Finish Lane Rolling
        </button>
      </div>
    </div>
  );
}

// Fleet assignment based on unit category/name
function getFleetForUnit(category: UnitCategory, unitName: string): string {
  switch (category) {
    case 'Ships':    return 'Untasked Ships';
    case 'Fighters': return 'Untasked Ships';
    case 'Bases':    return 'Bases';
    case 'Troops':   return 'On-Planet';
    case 'Civilian':
      if (unitName === 'Supply Depot' || unitName === 'Shipyard') return 'Bases';
      return 'Untasked Civilians';
    default:         return 'Untasked Civilians';
  }
}

// --- Unit Card Components ---

function UnitStatBlock({ unit }: { unit: EmpireUnit }) {
  return (
    <>
      <div className="flex flex-wrap gap-x-2 text-xs text-gray-500 dark:text-gray-400">
        <span>DV:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{unit.dv}</span></span>
        {unit.as !== '-' && <span>AS:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{unit.as}</span></span>}
        {unit.af !== '-' && <span>AF:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{unit.af}</span></span>}
        {unit.cr !== '-' && <span>CR:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{unit.cr}</span></span>}
        {unit.cc !== '-' && <span>CC:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{unit.cc}</span></span>}
      </div>
      {unit.traits.length > 0 ? (
        <>
          <div className="my-2 mx-auto w-2/3 border-t border-gray-200 dark:border-gray-700" />
          <div className="pb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
            {unit.traits.map((t, i) => (
              <span key={i}>{i > 0 && ', '}{t.name}{t.factor ? ` ${t.factor}` : ''}</span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="my-2 mx-auto w-2/3 border-t border-gray-200 dark:border-gray-700" />
          <div className="pb-1 text-[11px] italic text-gray-500 dark:text-gray-400">No traits</div>
        </>
      )}
    </>
  );
}

function AvailableUnitCard({ unit, canAfford, onBuy }: {
  unit: EmpireUnit;
  canAfford: boolean;
  onBuy: () => void;
}) {
  return (
    <div className="flex w-48 flex-col rounded border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium dark:text-gray-200">
            {unit.name}
            {unit.hullCode !== 'N/A' && (
              <span className="ml-1 font-normal text-gray-400">({unit.hullCode})</span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{unit.cost} EP</span>
      </div>
      <UnitStatBlock unit={unit} />
      <div className="mt-auto pt-1.5">
        <button
          onClick={onBuy}
          disabled={!canAfford}
          className="w-full rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Buy
        </button>
      </div>
    </div>
  );
}

function PurchasedUnitCard({ ref, template, unitInstance, count, onRefund, templateId, dragOverId, onDragStart, onDragOver, onDrop, onDragEnd }: {
  ref?: React.Ref<HTMLDivElement>;
  template: EmpireUnit;
  unitInstance: { id: string; name: string };
  count: number;
  onRefund: () => void;
  templateId: string;
  dragOverId: string | null;
  onDragStart: (templateId: string) => void;
  onDragOver: (e: React.DragEvent, templateId: string) => void;
  onDrop: (templateId: string) => void;
  onDragEnd: () => void;
}) {
  const isDragOver = dragOverId === templateId;
  return (
    <div
      ref={ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(templateId);
      }}
      onDragOver={(e) => onDragOver(e, templateId)}
      onDrop={() => onDrop(templateId)}
      onDragEnd={onDragEnd}
      className={`flex w-48 cursor-grab flex-col rounded border p-2 active:cursor-grabbing ${
        isDragOver
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
          : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
      }`}
    >
      <div className="mb-1 flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <svg className="h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
            </svg>
            <span className="truncate text-sm font-medium dark:text-gray-200">
              {unitInstance.name}
              {template.hullCode !== 'N/A' && (
                <span className="ml-1 font-normal text-gray-400">({template.hullCode})</span>
              )}
            </span>
            {count > 1 && (
              <span className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400">x{count}</span>
            )}
          </div>
        </div>
      </div>
      <UnitStatBlock unit={template} />
      <div className="mt-auto pt-1.5">
        <button
          onClick={onRefund}
          className="w-full rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
        >
          Refund
        </button>
      </div>
    </div>
  );
}

// --- Collapsible Category ---

function CollapsibleCategory({ title, rightLabel, children, open: controlledOpen, onToggle }: {
  title: string;
  rightLabel?: string;
  children: React.ReactNode;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [internalOpen, setInternalOpen] = useState(true);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const toggle = onToggle ?? (() => setInternalOpen(o => !o));
  return (
    <div>
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="currentColor" viewBox="0 0 20 20"
        >
          <path d="M6 4l8 6-8 6V4z" />
        </svg>
        <span className="flex-1">{title}</span>
        {rightLabel && (
          <span className="font-medium text-amber-600 dark:text-amber-400">{rightLabel}</span>
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

// --- Unit Purchase View (fullscreen) ---

interface UnitPurchaseViewProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  settings: CampaignSettings;
  onPurchaseUnit: (unitTemplateId: string, unitName: string, unitCost: number) => void;
  onBulkPurchase: (units: Array<{ templateId: string; name: string; cost: number; count: number }>) => void;
  onRemoveUnit: (unitId: string, unitCost: number) => void;
  onReorderUnits: (category: string, fromTemplateId: string, toTemplateId: string) => void;
  onFinish: () => void;
  onBack: () => void;
  onViewMap: () => void;
}

function UnitPurchaseView({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  settings,
  onPurchaseUnit,
  onBulkPurchase,
  onRemoveUnit,
  onReorderUnits,
  onFinish,
  onBack,
  onViewMap,
}: UnitPurchaseViewProps) {
  const currentPlayer = players[currentPlayerIndex];
  if (!currentPlayer?.empire) return null;
  const empire = currentPlayer.empire;

  // Recommended forces button visibility & affordability
  const showRecommendedButton = !!(
    empire.recommendedForces?.length &&
    settings.startingEP >= (empire.recommendedEP ?? Infinity) &&
    settings.startingYear >= (empire.recommendedYear ?? Infinity)
  );
  const canUseRecommended = currentPlayer.ep >= (empire.recommendedEP ?? Infinity);

  const handleUseRecommendedForces = () => {
    if (!empire.recommendedForces) return;
    const units = empire.recommendedForces.flatMap(({ name, count }) => {
      const template = empire.units.find(u => u.name === name);
      if (!template) return [];
      return [{ templateId: template.id, name: template.name, cost: template.cost, count }];
    });
    onBulkPurchase(units);
  };

  // Purchased category open/closed state (all start open)
  const [purchasedCategoryOpen, setPurchasedCategoryOpen] = useState<Record<string, boolean>>({});
  const togglePurchasedCategory = (cat: string) => {
    setPurchasedCategoryOpen(prev => ({ ...prev, [cat]: !(prev[cat] ?? true) }));
  };
  const isCategoryOpen = (cat: string) => purchasedCategoryOpen[cat] ?? true;

  // Scroll-to-template after purchase
  const purchasedScrollRef = useRef<HTMLDivElement>(null);
  const [scrollToTemplateId, setScrollToTemplateId] = useState<string | null>(null);
  const purchasedRowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleBuyUnit = (unitTemplateId: string, unitName: string, unitCost: number) => {
    const template = resolveUnitTemplate(currentPlayer, unitTemplateId, players);
    if (template) {
      setPurchasedCategoryOpen(prev => ({ ...prev, [template.category]: true }));
    }
    setScrollToTemplateId(unitTemplateId);
    onPurchaseUnit(unitTemplateId, unitName, unitCost);
  };

  useEffect(() => {
    if (!scrollToTemplateId) return;
    requestAnimationFrame(() => {
      const row = purchasedRowRefs.current[scrollToTemplateId];
      if (row && purchasedScrollRef.current) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      setScrollToTemplateId(null);
    });
  }, [scrollToTemplateId, currentPlayer.units.length]);

  // Drag-and-drop state for purchased unit reordering
  const [dragTemplateId, setDragTemplateId] = useState<string | null>(null);
  const [dragOverTemplateId, setDragOverTemplateId] = useState<string | null>(null);
  const [dragCategory, setDragCategory] = useState<string | null>(null);

  const handleDragStart = (category: string, templateId: string) => {
    setDragTemplateId(templateId);
    setDragCategory(category);
  };
  const handleDragOver = (e: React.DragEvent, templateId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTemplateId(templateId);
  };
  const handleDrop = (category: string, targetTemplateId: string) => {
    if (dragTemplateId && dragCategory === category && dragTemplateId !== targetTemplateId) {
      onReorderUnits(category, dragTemplateId, targetTemplateId);
    }
    setDragTemplateId(null);
    setDragOverTemplateId(null);
    setDragCategory(null);
  };
  const handleDragEnd = () => {
    setDragTemplateId(null);
    setDragOverTemplateId(null);
    setDragCategory(null);
  };

  // Filter units by ISD ≤ starting year
  const availableUnits = currentPlayer.empire.units.filter(unit => {
    if (unit.isd === 'N/A') return true;
    const isd = parseInt(unit.isd);
    return !isNaN(isd) && isd <= settings.startingYear;
  });

  // Group available units by category
  const unitsByCategory = availableUnits.reduce<Record<string, typeof availableUnits>>((acc, unit) => {
    if (!acc[unit.category]) acc[unit.category] = [];
    acc[unit.category].push(unit);
    return acc;
  }, {});

  // Count purchased units by template
  const purchasedCounts = currentPlayer.units.reduce<Record<string, number>>((acc, u) => {
    acc[u.unitTemplateId] = (acc[u.unitTemplateId] || 0) + 1;
    return acc;
  }, {});

  const totalEPSpent = currentPlayer.units.reduce((sum, u) => {
    const t = resolveUnitTemplate(currentPlayer, u.unitTemplateId, players);
    return sum + (t?.cost ?? 0);
  }, 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* Header: title + player tabs + EP */}
      <div className="shrink-0 border-b border-gray-200 px-6 py-4 dark:border-gray-700">
        <div className="mx-auto max-w-6xl">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-xl font-semibold dark:text-gray-100">Unit Purchase</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Units with ISD after {settings.startingYear} are not available.
            </p>
          </div>
          <div className="rounded border border-blue-300 bg-blue-50 px-4 py-2 dark:border-blue-700 dark:bg-blue-900/20">
            <span className="text-sm font-medium dark:text-gray-100">{currentPlayer.name}</span>
            <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">{currentPlayer.ep} EP</span>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
              ({currentPlayer.units.length} unit{currentPlayer.units.length !== 1 ? 's' : ''})
            </span>
          </div>
        </div>

        {/* Player tabs (horizontal) */}
        <div className="flex flex-wrap gap-2">
          {players.map((player, i) => {
            const isActive = i === currentPlayerIndex;
            return (
              <button
                key={player.id}
                onClick={() => onSelectPlayer(i)}
                className={`flex items-center gap-2 rounded px-4 py-2 text-sm ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {player.teamColor && (
                  <div
                    className={`h-3 w-3 rounded-full border ${isActive ? 'border-blue-300' : 'border-gray-400'}`}
                    style={{ backgroundColor: player.teamColor }}
                  />
                )}
                <span>{player.name}</span>
                <span className={`text-xs ${isActive ? 'text-blue-200' : 'text-gray-500 dark:text-gray-400'}`}>
                  {player.ep} EP
                </span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      {/* Recommended forces bar */}
      {showRecommendedButton && (
        <div className="shrink-0 border-b border-gray-200 bg-amber-50 px-6 py-2 dark:border-gray-700 dark:bg-amber-900/10">
          <div className="mx-auto flex max-w-6xl items-center gap-4">
            <button
              onClick={handleUseRecommendedForces}
              disabled={!canUseRecommended}
              className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
                canUseRecommended
                  ? 'bg-amber-500 text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'
                  : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
              }`}
            >
              Use Recommended Units
            </button>
            <span className="text-sm text-amber-700 dark:text-amber-400">
              {canUseRecommended
                ? `Purchase the standard ${empire.recommendedYear} force list (${empire.recommendedEP} EP)`
                : `Requires ${empire.recommendedEP} EP — current player has insufficient funds`}
            </span>
          </div>
        </div>
      )}

      {/* Content: available (top) + purchased (bottom) */}
      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col">
        {/* Available units */}
        <div className="flex min-h-0 flex-1 flex-col">
          <h3 className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Available Units
          </h3>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {Object.entries(unitsByCategory).map(([category, units]) => (
              <CollapsibleCategory key={category} title={category}>
                <div className="flex flex-wrap gap-2">
                  {units.map(unit => (
                    <AvailableUnitCard
                      key={unit.id}
                      unit={unit}
                      canAfford={currentPlayer.ep >= unit.cost}
                      onBuy={() => handleBuyUnit(unit.id, unit.name, unit.cost)}
                    />
                  ))}
                </div>
              </CollapsibleCategory>
            ))}
          </div>
        </div>

        {/* Purchased units */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <h3 className="mb-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Purchased ({currentPlayer.units.length}) <span className="font-medium text-amber-600 dark:text-amber-400">{totalEPSpent} EP</span>
          </h3>
          <div ref={purchasedScrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {currentPlayer.units.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">No units purchased yet.</p>
            ) : (
              Object.entries(
                Object.entries(purchasedCounts).reduce<Record<string, { templateId: string; count: number }[]>>((acc, [templateId, count]) => {
                  const template = resolveUnitTemplate(currentPlayer, templateId, players);
                  const cat = template?.category || 'Other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push({ templateId, count });
                  return acc;
                }, {})
              ).map(([category, entries]) => {
                const categoryCost = entries.reduce((sum, { templateId, count }) => {
                  const t = resolveUnitTemplate(currentPlayer, templateId, players);
                  return sum + (t?.cost ?? 0) * count;
                }, 0);
                return (
                  <CollapsibleCategory
                    key={category}
                    title={category}
                    rightLabel={`${categoryCost} EP`}
                    open={isCategoryOpen(category)}
                    onToggle={() => togglePurchasedCategory(category)}
                  >
                    <div className="flex flex-wrap gap-2">
                      {entries.map(({ templateId, count }) => {
                        const template = resolveUnitTemplate(currentPlayer, templateId, players);
                        const unitInstance = currentPlayer.units.find(u => u.unitTemplateId === templateId);
                        if (!unitInstance || !template) return null;
                        return (
                          <PurchasedUnitCard
                            key={templateId}
                            ref={(el) => { purchasedRowRefs.current[templateId] = el; }}
                            template={template}
                            unitInstance={unitInstance}
                            count={count}
                            onRefund={() => onRemoveUnit(unitInstance.id, template.cost)}
                            templateId={templateId}
                            dragOverId={dragCategory === category ? dragOverTemplateId : null}
                            onDragStart={(tid) => handleDragStart(category, tid)}
                            onDragOver={handleDragOver}
                            onDrop={(tid) => handleDrop(category, tid)}
                            onDragEnd={handleDragEnd}
                          />
                        );
                      })}
                    </div>
                  </CollapsibleCategory>
                );
              })
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Footer: Back + Finish */}
      <div className="shrink-0 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <div className="mx-auto flex max-w-6xl justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          <span>&#8592;</span>
          <span>Back to Lane Rolling</span>
        </button>
        <button
          onClick={onViewMap}
          className="flex items-center gap-1 rounded border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          View Map
        </button>
        <button
          onClick={onFinish}
          className="rounded bg-green-600 px-6 py-2 text-sm text-white hover:bg-green-700"
        >
          Finish Unit Purchases
        </button>
        </div>
      </div>
    </div>
  );
}

// --- Unit Deployment Panel ---

const DEPLOY_CATEGORIES: UnitCategory[] = ['Civilian', 'Ships', 'Fighters', 'Bases', 'Troops'];

interface PendingDeploy {
  systemId: string;
  systemName: string;
  templateId: string;
  unitName: string;
  maxCount: number;
  deployCount: number;
}

interface DeploymentRowProps {
  template: EmpireUnit;
  count: number;
  selected: boolean;
  onClick: () => void;
}

function DeploymentRow({ template, count, selected, onClick }: DeploymentRowProps) {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = () => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top, left: rect.right + 8 });
    }
  };

  return (
    <div className="relative">
      <button
        ref={rowRef}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltipPos(null)}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-sm transition-colors ${
          selected
            ? 'border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
            : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
        }`}
      >
        <span className="font-medium dark:text-gray-200">{template.name}</span>
        {template.hullCode !== 'N/A' && (
          <span className="text-xs text-gray-500 dark:text-gray-400">({template.hullCode})</span>
        )}
        <span className="ml-auto text-xs font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
      </button>
      {tooltipPos && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] w-52 rounded border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-950"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          <div className="mb-1.5 border-b border-gray-200 pb-1.5 dark:border-gray-700">
            <span className="text-sm font-semibold dark:text-gray-100">{template.name}</span>
            {template.hullCode !== 'N/A' && (
              <span className="ml-1.5 text-xs text-gray-500 dark:text-gray-400">({template.hullCode})</span>
            )}
          </div>
          <UnitStatBlock unit={template} />
        </div>,
        document.body
      )}
    </div>
  );
}

interface UnitDeploymentPanelProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  mapState: ReturnType<typeof useMapState>;
  onDeployUnits: (unitTemplateId: string, systemId: string, count: number) => void;
  onResetDeployment: () => void;
  onFinish: () => void;
}

function UnitDeploymentPanel({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  mapState,
  onDeployUnits,
  onResetDeployment,
  onFinish,
}: UnitDeploymentPanelProps) {
  const currentPlayer = players[currentPlayerIndex];
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<PendingDeploy | null>(null);

  // Count undeployed units by template id
  const undeployedCounts = currentPlayer.units
    .filter(u => !u.systemId)
    .reduce<Record<string, number>>((acc, u) => {
      acc[u.unitTemplateId] = (acc[u.unitTemplateId] || 0) + 1;
      return acc;
    }, {});

  // Group templates that have undeployed units by category
  const templatesByCategory = DEPLOY_CATEGORIES.reduce<Record<string, { template: EmpireUnit; count: number }[]>>(
    (acc, cat) => {
      const rows = currentPlayer.empire.units
        .filter(t => t.category === cat && (undeployedCounts[t.id] ?? 0) > 0)
        .map(t => ({ template: t, count: undeployedCounts[t.id] }));
      if (rows.length > 0) acc[cat] = rows;
      return acc;
    },
    {}
  );

  const totalUndeployedAcrossAll = players.reduce(
    (sum, p) => sum + p.units.filter(u => !u.systemId).length,
    0
  );

  const selectedTemplate = selectedTemplateId
    ? resolveUnitTemplate(currentPlayer, selectedTemplateId, players)
    : null;

  // Detect when user clicks an owned system on the map
  useEffect(() => {
    if (!selectedTemplateId || !mapState.selectedSystemId) return;
    const systemId = mapState.selectedSystemId;
    if (!currentPlayer.ownedSystemIds.includes(systemId)) return;
    const remaining = undeployedCounts[selectedTemplateId] ?? 0;
    if (remaining === 0) return;
    const sys = mapState.getSystem(systemId);
    const template = resolveUnitTemplate(currentPlayer, selectedTemplateId, players);
    if (!template || !sys) return;
    setPendingDeploy({
      systemId,
      systemName: sys.name || 'Unnamed System',
      templateId: selectedTemplateId,
      unitName: template.name,
      maxCount: remaining,
      deployCount: 1,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapState.selectedSystemId]);

  // Reset selection when switching players
  const handleSelectPlayer = (i: number) => {
    setSelectedTemplateId(null);
    setPendingDeploy(null);
    onSelectPlayer(i);
  };

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold dark:text-gray-100">Unit Deployment</h2>

      {/* Player tabs */}
      <div className="mb-3 space-y-1">
        {players.map((player, i) => {
          const isActive = i === currentPlayerIndex;
          const undeployed = player.units.filter(u => !u.systemId).length;
          return (
            <button
              key={player.id}
              onClick={() => handleSelectPlayer(i)}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                isActive
                  ? 'border border-blue-500 bg-blue-50 font-medium dark:bg-blue-900/20'
                  : 'border border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {player.teamColor && (
                  <div className="h-3 w-3 rounded-full border border-gray-400" style={{ backgroundColor: player.teamColor }} />
                )}
                <span className="dark:text-gray-200">{player.name}</span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {undeployed === 0 ? 'All deployed' : `${undeployed} to place`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Instruction banner when a class is selected */}
      {selectedTemplate && !pendingDeploy && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          Click an owned system on the map to deploy <strong>{selectedTemplate.name}</strong>
        </div>
      )}

      {/* Unit classes by category */}
      <div className="space-y-1">
        {DEPLOY_CATEGORIES.map(cat => {
          const rows = templatesByCategory[cat];
          if (!rows) return null;
          return (
            <CollapsibleCategory key={cat} title={cat}>
              <div className="space-y-1">
                {rows.map(({ template, count }) => (
                  <DeploymentRow
                    key={template.id}
                    template={template}
                    count={count}
                    selected={selectedTemplateId === template.id}
                    onClick={() => {
                      const newId = selectedTemplateId === template.id ? null : template.id;
                      setSelectedTemplateId(newId);
                      if (newId !== null) {
                        mapState.setSelectedSystemId(null);
                      }
                    }}
                  />
                ))}
              </div>
            </CollapsibleCategory>
          );
        })}
        {Object.keys(templatesByCategory).length === 0 && (
          <p className="py-2 text-center text-sm text-gray-400 dark:text-gray-500">All units deployed.</p>
        )}
      </div>

      {/* Deployment confirmation dialog */}
      {pendingDeploy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-72 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-base font-semibold dark:text-gray-100">Deploy to {pendingDeploy.systemName}</h3>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              How many <span className="font-medium text-gray-700 dark:text-gray-300">{pendingDeploy.unitName}</span> units?
            </p>
            <input
              type="number"
              min={1}
              max={pendingDeploy.maxCount}
              value={pendingDeploy.deployCount}
              onChange={e => setPendingDeploy(prev => prev && ({
                ...prev,
                deployCount: Math.max(1, Math.min(prev.maxCount, parseInt(e.target.value) || 1)),
              }))}
              className="mb-4 w-full rounded border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600 dark:text-gray-100"
            />
            <p className="mb-4 text-xs text-gray-400 dark:text-gray-500">
              {pendingDeploy.maxCount} available
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingDeploy(null)}
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDeployUnits(pendingDeploy.templateId, pendingDeploy.systemId, pendingDeploy.deployCount);
                  setPendingDeploy(null);
                  setSelectedTemplateId(null);
                }}
                className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer buttons */}
      <div className="mt-6 space-y-2">
        <button
          onClick={onFinish}
          disabled={totalUndeployedAcrossAll > 0}
          className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Finish Deployment
        </button>
        <button
          onClick={onResetDeployment}
          className="w-full rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Reset All Deployment
        </button>
        {totalUndeployedAcrossAll > 0 && (
          <p className="mt-1 text-center text-xs text-amber-600 dark:text-amber-400">
            {totalUndeployedAcrossAll} unit(s) must be deployed before continuing
          </p>
        )}
      </div>
    </div>
  );
}

// --- Trade Routes Panel ---

function isValidChain(systemIds: string[], jumpLanes: JumpLane[]): boolean {
  if (systemIds.length <= 1) return true;
  const hasLane = (a: string, b: string) => jumpLanes.some(
    l => (l.from === a && l.to === b) || (l.from === b && l.to === a)
  );
  if (systemIds.length === 2) return hasLane(systemIds[0], systemIds[1]);
  const [a, b, c] = systemIds;
  return (hasLane(a, b) && hasLane(b, c))  // a–b–c
      || (hasLane(a, c) && hasLane(c, b))  // a–c–b (c is middle)
      || (hasLane(b, a) && hasLane(a, c)); // b–a–c (a is middle)
}

function getRouteLanes(systemIds: string[], jumpLanes: JumpLane[]): JumpLane[] {
  if (systemIds.length <= 1) return [];
  const getLane = (a: string, b: string) => jumpLanes.find(
    l => (l.from === a && l.to === b) || (l.from === b && l.to === a)
  );
  if (systemIds.length === 2) {
    const lane = getLane(systemIds[0], systemIds[1]);
    return lane ? [lane] : [];
  }
  const [a, b, c] = systemIds;
  if (getLane(a, b) && getLane(b, c)) return [getLane(a, b)!, getLane(b, c)!];
  if (getLane(a, c) && getLane(c, b)) return [getLane(a, c)!, getLane(c, b)!];
  if (getLane(b, a) && getLane(a, c)) return [getLane(b, a)!, getLane(a, c)!];
  return [];
}

interface TradeRoutesPanelProps {
  players: CampaignPlayer[];
  currentPlayerIndex: number;
  onSelectPlayer: (index: number) => void;
  mapState: ReturnType<typeof useMapState>;
  onSetTradeRoute: (playerId: string, convoyUnitId: string, systemIds: string[]) => void;
  onClearTradeRoute: (playerId: string, convoyUnitId: string) => void;
  onFinish: () => void;
}

function TradeRoutesPanel({
  players,
  currentPlayerIndex,
  onSelectPlayer,
  mapState,
  onSetTradeRoute,
  onClearTradeRoute,
  onFinish,
}: TradeRoutesPanelProps) {
  const currentPlayer = players[currentPlayerIndex];
  const [selectedConvoyId, setSelectedConvoyId] = useState<string | null>(null);
  const [pendingSystemIds, setPendingSystemIds] = useState<string[]>([]);

  // Deployed Convoys for the current player
  const convoys = currentPlayer.units.filter(u => {
    const template = resolveUnitTemplate(currentPlayer, u.unitTemplateId, players);
    return template?.name === 'Convoy' && u.systemId;
  });

  const selectedConvoy = selectedConvoyId
    ? currentPlayer.units.find(u => u.id === selectedConvoyId) ?? null
    : null;

  const isEstablishing = selectedConvoyId !== null;

  // Detect owned system clicks on the map while establishing a route
  useEffect(() => {
    if (!isEstablishing || !mapState.selectedSystemId || !selectedConvoy?.systemId) return;
    const systemId = mapState.selectedSystemId;
    mapState.setSelectedSystemId(null);

    if (pendingSystemIds.includes(systemId)) {
      // Deselect — but never remove the Convoy's home system
      if (systemId === selectedConvoy.systemId) return;
      setPendingSystemIds(prev => prev.filter(s => s !== systemId));
    } else {
      if (pendingSystemIds.length >= 3) return;
      setPendingSystemIds(prev => [...prev, systemId]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapState.selectedSystemId]);

  const startEstablishing = (convoyId: string) => {
    const convoy = currentPlayer.units.find(u => u.id === convoyId);
    if (!convoy?.systemId) return;
    const existing = (currentPlayer.tradeRoutes ?? []).find(r => r.convoyUnitId === convoyId);
    setPendingSystemIds(existing?.systemIds ?? [convoy.systemId]);
    setSelectedConvoyId(convoyId);
    mapState.setSelectedSystemId(null);
  };

  const cancelEstablishing = () => {
    setSelectedConvoyId(null);
    setPendingSystemIds([]);
  };

  const confirmRoute = () => {
    if (!selectedConvoyId) return;
    onSetTradeRoute(currentPlayer.id, selectedConvoyId, pendingSystemIds);
    setSelectedConvoyId(null);
    setPendingSystemIds([]);
  };

  const handleSelectPlayer = (i: number) => {
    setSelectedConvoyId(null);
    setPendingSystemIds([]);
    onSelectPlayer(i);
  };

  // Validation & warnings
  const chainValid = isValidChain(pendingSystemIds, mapState.map.jumpLanes);
  const hasFreeTraders = currentPlayer.empire.advantages.includes('Free Traders');
  const routeLanes = chainValid ? getRouteLanes(pendingSystemIds, mapState.map.jumpLanes) : [];
  const warnings: string[] = [];
  if (pendingSystemIds.length > 1 && !chainValid) {
    warnings.push('Selected systems do not form a connected chain.');
  }
  if (chainValid && routeLanes.length > 0) {
    const hasNonMajor = routeLanes.some(l => l.type !== 'major');
    const hasMinor = routeLanes.some(l => l.type === 'minor');
    const hasBadLane = routeLanes.some(l => l.type === 'restricted' || l.type === 'unexplored');
    if (!hasFreeTraders && hasNonMajor) {
      warnings.push('This empire requires Major lanes. Route includes non-major lane(s).');
    } else if (hasFreeTraders && hasMinor) {
      // Free Traders allows minor — only warn about restricted/unexplored
    }
    if (hasBadLane) {
      warnings.push('Route includes restricted or unexplored lane(s).');
    }
  }
  const nonOwnedSystems = pendingSystemIds.filter(id => !currentPlayer.ownedSystemIds.includes(id));
  if (nonOwnedSystems.length > 0) {
    const names = nonOwnedSystems.map(id => mapState.getSystem(id)?.name ?? id).join(', ');
    warnings.push(`Route includes systems not owned by this empire: ${names}.`);
  }
  if (selectedConvoy?.systemId && !pendingSystemIds.includes(selectedConvoy.systemId)) {
    warnings.push(`Convoy's home system (${mapState.getSystem(selectedConvoy.systemId)?.name ?? selectedConvoy.systemId}) is not in the route.`);
  }

  const noConvoysDeployed = convoys.length === 0;
  const unrouted = convoys.filter(c =>
    !(currentPlayer.tradeRoutes ?? []).some(r => r.convoyUnitId === c.id)
  );

  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold dark:text-gray-100">Trade Routes</h2>

      {/* Player tabs */}
      <div className="mb-3 space-y-1">
        {players.map((player, i) => {
          const isActive = i === currentPlayerIndex;
          const pConvoys = player.units.filter(u => {
            const t = resolveUnitTemplate(player, u.unitTemplateId, players);
            return t?.name === 'Convoy' && u.systemId;
          });
          const pRouted = (player.tradeRoutes ?? []).length;
          return (
            <button
              key={player.id}
              onClick={() => handleSelectPlayer(i)}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                isActive
                  ? 'border border-blue-500 bg-blue-50 font-medium dark:bg-blue-900/20'
                  : 'border border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {player.teamColor && (
                  <div className="h-3 w-3 rounded-full border border-gray-400" style={{ backgroundColor: player.teamColor }} />
                )}
                <span className="dark:text-gray-200">{player.name}</span>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {pRouted}/{pConvoys.length} routed
              </span>
            </button>
          );
        })}
      </div>

      {noConvoysDeployed && !isEstablishing && (
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          No Convoys deployed — no trade routes to establish.
        </p>
      )}

      {/* Route establishment UI */}
      {isEstablishing && selectedConvoy && (
        <div className="mb-3">
          <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Click owned systems on the map to add to the route (max 3 total). Click an added system again to remove it.
          </div>

          {/* Selected systems */}
          <div className="mb-2 space-y-1">
            {pendingSystemIds.map(sysId => {
              const sys = mapState.getSystem(sysId);
              const isHome = sysId === selectedConvoy.systemId;
              return (
                <div
                  key={sysId}
                  className="flex items-center justify-between rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700"
                >
                  <span className="text-gray-700 dark:text-gray-300">{sys?.name ?? sysId}</span>
                  {isHome ? (
                    <span className="text-gray-400 dark:text-gray-500">Convoy</span>
                  ) : (
                    <button
                      onClick={() => setPendingSystemIds(prev => prev.filter(s => s !== sysId))}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mb-2 text-right text-xs text-gray-400 dark:text-gray-500">
            {pendingSystemIds.length}/3 systems
          </p>

          {/* Warnings */}
          {warnings.map(w => (
            <div key={w} className="mb-2 rounded border border-yellow-300 bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
              ⚠ {w}
            </div>
          ))}

          <div className="flex gap-2">
            <button
              onClick={cancelEstablishing}
              className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={confirmRoute}
              className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Convoy list */}
      {!isEstablishing && !noConvoysDeployed && (
        <div className="mb-3 space-y-2">
          {convoys.map(convoy => {
            const route = (currentPlayer.tradeRoutes ?? []).find(r => r.convoyUnitId === convoy.id);
            const homeSystem = mapState.getSystem(convoy.systemId!);
            return (
              <div key={convoy.id} className="rounded border border-gray-200 p-2 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium dark:text-gray-200">{convoy.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{homeSystem?.name ?? convoy.systemId}</p>
                  </div>
                  <button
                    onClick={() => startEstablishing(convoy.id)}
                    className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20"
                  >
                    {route ? 'Edit' : 'Establish'}
                  </button>
                </div>
                {route && (
                  <div className="mt-1.5 border-t border-gray-100 pt-1.5 dark:border-gray-700">
                    <div className="space-y-0.5">
                      {route.systemIds.map(sId => (
                        <p key={sId} className="text-xs text-gray-600 dark:text-gray-400">
                          · {mapState.getSystem(sId)?.name ?? sId}
                        </p>
                      ))}
                    </div>
                    <button
                      onClick={() => onClearTradeRoute(currentPlayer.id, convoy.id)}
                      className="mt-1 text-xs text-red-500 hover:underline dark:text-red-400"
                    >
                      Clear route
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finish */}
      <div className="mt-4">
        <button
          onClick={onFinish}
          className="w-full rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          Finish Setup
        </button>
        {!isEstablishing && unrouted.length > 0 && (
          <p className="mt-1 text-center text-xs text-amber-600 dark:text-amber-400">
            {unrouted.length} Convoy{unrouted.length > 1 ? 's' : ''} without a trade route
          </p>
        )}
      </div>
    </div>
  );
}

// --- Purchase System Button ---

interface PurchaseSystemButtonProps {
  selectedSystemId: string;
  purchasableSystems: System[];
  currentPlayer: CampaignPlayer;
  mapState: ReturnType<typeof useMapState>;
  getSystemCost: (system: System) => number;
  onPurchase: (systemId: string) => void;
}

function PurchaseSystemButton({
  selectedSystemId,
  purchasableSystems,
  currentPlayer,
  mapState,
  getSystemCost,
  onPurchase,
}: PurchaseSystemButtonProps) {
  const system = mapState.getSystem(selectedSystemId);
  if (!system) return null;

  const isPurchasable = purchasableSystems.some(s => s.id === selectedSystemId);
  if (!isPurchasable) {
    // Check if it's an already-owned system
    if (currentPlayer.ownedSystemIds.includes(selectedSystemId)) {
      return null; // Don't show anything for owned systems
    }
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        This system is not connected to your territory by a jump lane.
      </div>
    );
  }

  const cost = getSystemCost(system);
  const canAfford = currentPlayer.sp >= cost;

  if (!canAfford) {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
        Not enough SP ({currentPlayer.sp} SP, need {cost} SP)
      </div>
    );
  }

  return (
    <button
      onClick={() => onPurchase(selectedSystemId)}
      className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
    >
      Purchase {system.name || 'System'} for {cost} SP
    </button>
  );
}

// --- Assign Homeworld Button ---

interface AssignHomeworldButtonProps {
  selectedSystemId: string;
  availableHomeworlds: ReturnType<ReturnType<typeof useMapState>['getSystem']>[];
  currentPlayer: CampaignPlayer;
  onAssign: (systemId: string) => void;
  mapState: ReturnType<typeof useMapState>;
}

function AssignHomeworldButton({
  selectedSystemId,
  availableHomeworlds,
  currentPlayer,
  onAssign,
  mapState,
}: AssignHomeworldButtonProps) {
  const system = mapState.getSystem(selectedSystemId);
  if (!system) return null;

  const isAvailableHomeworld = availableHomeworlds.some(hw => hw?.id === selectedSystemId);

  if (!isAvailableHomeworld) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
        Selected system is not an available homeworld.
      </div>
    );
  }

  if (currentPlayer.homeworldId) {
    return (
      <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
        {currentPlayer.name} already has a homeworld assigned. Select another player.
      </div>
    );
  }

  return (
    <button
      onClick={() => onAssign(selectedSystemId)}
      className="w-full rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
    >
      Assign {system.name || 'Selected Homeworld'} to {currentPlayer.name}
    </button>
  );
}
