import { useState } from 'react';
import { useDragScroll } from '../hooks/useDragScroll';
import type { CampaignPlayer, CampaignSettings, CampaignUnit, CMFleet, DiplomacyLevel, EmpireUnit, GameMap, IndependentUnitList, System, SystemCampaignStatus, TurnOrderEntry } from '../types';
import { diplomacyKey } from '../utils/supplyUtils';
import { resolveUnitTemplate } from '../utils/fleetUtils';

interface CartItem {
  templateId: string;
  name: string;
  cost: number;
  count: number;
}

interface AddUnitsViewProps {
  players: CampaignPlayer[];
  allPlayers: CampaignPlayer[];
  diplomacyRelations: Record<string, DiplomacyLevel>;
  map: GameMap;
  settings: CampaignSettings;
  systemOwnership: Record<string, string>;
  turnOrders: Record<string, TurnOrderEntry>;
  onUpdateOrders: (key: string, entry: TurnOrderEntry) => void;
  independentLists: IndependentUnitList[];
  cmFleets: CMFleet[];
  systemStatuses: Record<string, SystemCampaignStatus>;
  selectedSystemId: string;
  onSelectOnMap: () => void;
  onAddPlayerUnits: (playerId: string, systemId: string, units: Array<{ templateId: string; name: string }>) => void;
  onAddCMUnits: (fleetId: string, units: CampaignUnit[]) => void;
  onCreateCMFleet: (fleet: CMFleet) => void;
  onEditCMFleet: (id: string, updates: Partial<CMFleet>) => void;
  onDeleteCMFleet: (id: string) => void;
  onClose: () => void;
}

const EMPTY_ORDER_ENTRY: TurnOrderEntry = {
  fleetDeployment: '', intel: '', movement: '', diplomatic: '', construction: '', investment: '',
  epSpent: 0,
};

const CM_FLEET_COLORS = [
  '#6b7280','#ef4444','#f97316','#eab308',
  '#22c55e','#3b82f6','#8b5cf6','#ec4899',
  '#ffffff','#000000',
];

const UNIT_CATEGORY_ORDER = ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'] as const;

interface ConstructionLimits {
  shipyardCP: number;
  shipyardDemand: number;       // nonAtmCost + atmOverflow
  shipyardSoftOver: boolean;    // nonAtmCost overflows Shipyard but has Planetary as destination
  shipyardHardOver: boolean;    // atm truly can't fit in leftover Shipyard either
  planetaryCP: number;
  planetaryDemand: number;      // nonAtmOverflow×2 + atmCost + troopCost
  planetarySoftOver: boolean;   // atm overflows Planetary but has Shipyard as destination
  planetaryHardOver: boolean;   // non-atm/troops overflow Planetary with no fallback
  troopCPLimit: number;
  troopCost: number;
  hasTroops: boolean;
  nonAtmOverflow: number;       // for note text: non-atm EP overflowing Shipyard → Planetary
  atmOverflow: number;          // for note text: atm EP overflowing Planetary → Shipyard
}

function computeConstructionLimits(
  player: CampaignPlayer,
  system: System,
  cart: CartItem[],
  allPlayers?: CampaignPlayer[],
): ConstructionLimits | null {
  const attrs = system.attributes;
  if (!attrs) return null;

  const { population: P, raw: RAW } = attrs;

  const isIndustrious = player.empire.advantages.includes('Industrious');
  const isCorrupt = player.empire.disadvantage === 'Corrupt';
  const isVolunteerArmy = player.empire.disadvantage === 'Volunteer Army';
  const traitMult = isIndustrious ? 1.5 : isCorrupt ? 0.5 : 1.0;

  const shipyardCount = player.units.filter(u =>
    u.systemId === system.id && resolveUnitTemplate(player, u.unitTemplateId, allPlayers)?.name === 'Shipyard'
  ).length;

  const shipyardCP = Math.ceil(shipyardCount * 24 * traitMult);
  const planetaryCP = Math.ceil(P * RAW * 0.5 * traitMult);
  const troopCPLimit = Math.ceil(P * (isVolunteerArmy ? 0.5 : 1.0));

  let nonAtmCost = 0;
  let atmCost = 0;
  let troopCost = 0;

  for (const item of cart) {
    const template = resolveUnitTemplate(player, item.templateId, allPlayers);
    if (!template || template.name === 'Convoy') continue;
    const total = item.cost * item.count;
    if (template.category === 'Troops') troopCost += total;
    else if (template.traits.some(t => t.name === 'Atmospheric')) atmCost += total;
    else nonAtmCost += total;
  }

  // Non-atm uses Shipyard first; overflow goes to Planetary at 2×.
  const nonAtmOverflow = Math.max(0, nonAtmCost - shipyardCP);
  const planetaryDemand = nonAtmOverflow * 2 + atmCost + troopCost;

  // On Planetary, non-atm overflow and troops have no fallback → they take priority.
  // Atm gets remaining Planetary CP; excess flows to Shipyard at 1×.
  let remPlanetary = planetaryCP;
  remPlanetary -= Math.min(nonAtmOverflow * 2, remPlanetary);
  remPlanetary -= Math.min(troopCost, remPlanetary);
  const atmOverflow = Math.max(0, atmCost - remPlanetary);

  // How much leftover Shipyard capacity is available for atm overflow?
  const remShipyardAfterNonAtm = Math.max(0, shipyardCP - Math.min(nonAtmCost, shipyardCP));
  const atmTrulyOver = Math.max(0, atmOverflow - remShipyardAfterNonAtm);

  const shipyardDemand = nonAtmCost + atmOverflow;

  // Soft overflow = overflowing but a valid destination exists.
  // Hard overflow = demand with truly nowhere left to go.
  const shipyardSoftOver = nonAtmOverflow > 0 && atmTrulyOver === 0;
  const shipyardHardOver = atmTrulyOver > 0;

  // On Planetary, non-atm + troops have no fallback — their unmet demand is hard.
  const planetaryHardDemand = nonAtmOverflow * 2 + troopCost;
  const planetarySoftOver = planetaryHardDemand <= planetaryCP && planetaryDemand > planetaryCP;
  const planetaryHardOver = planetaryHardDemand > planetaryCP;

  return {
    shipyardCP,
    shipyardDemand,
    shipyardSoftOver,
    shipyardHardOver,
    planetaryCP,
    planetaryDemand,
    planetarySoftOver,
    planetaryHardOver,
    troopCPLimit,
    troopCost,
    hasTroops: troopCost > 0,
    nonAtmOverflow,
    atmOverflow,
  };
}

export function AddUnitsView({
  players,
  allPlayers,
  diplomacyRelations,
  map,
  settings,
  systemOwnership,
  turnOrders,
  onUpdateOrders,
  independentLists,
  cmFleets,
  systemStatuses,
  selectedSystemId,
  onSelectOnMap,
  onAddPlayerUnits,
  onAddCMUnits,
  onCreateCMFleet,
  onClose,
}: AddUnitsViewProps) {
  const cmTabIndex = players.length;

  // Sidebar state
  const [sidebarTab, setSidebarTab] = useState(0);
  const [constructionChecks, setConstructionChecks] = useState<Record<string, Array<{ checked: boolean; xed: boolean }>>>({});
  const [sidebarEditMode, setSidebarEditMode] = useState<Record<string, boolean>>({});
  const { ref: sidebarTabBarRef, onMouseDown: sidebarTabBarMouseDown, onClickCapture: sidebarTabBarClickCapture } = useDragScroll();

  // Main area state
  const [activeTab, setActiveTab] = useState(0);
  const { ref: mainTabBarRef, onMouseDown: mainTabBarMouseDown, onClickCapture: mainTabBarClickCapture } = useDragScroll();
  const [showAllUnits, setShowAllUnits] = useState(false);
  const [showAlliedUnits, setShowAlliedUnits] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);

  // CM tab state
  const [cmSubTab, setCmSubTab] = useState(0);
  const [selectedCMFleetId, setSelectedCMFleetId] = useState<string>('');
  const [showNewFleetForm, setShowNewFleetForm] = useState(false);
  const [newFleetName, setNewFleetName] = useState('');
  const [newFleetColor, setNewFleetColor] = useState('#6b7280');

  // Category collapse state
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  // Shared column template for unit table rows (name | EP | DV AS AF CR CC | [spacer] | traits | +/-)
  // Last column is fixed (4rem) to prevent the auto-size widget from offsetting the stat headers
  const unitCols = 'minmax(4rem,1fr) 3rem repeat(5, 1.75rem) 0.75rem minmax(3rem,1fr) 4rem';

  const isCMTab = activeTab === cmTabIndex;
  const activePlayer = isCMTab ? null : players[activeTab];

  // Clear cart when switching tabs
  const handleSetTab = (tab: number) => {
    setActiveTab(tab);
    setCart([]);
    setShowNewFleetForm(false);
  };

  // Sidebar key and entry
  const sidebarKey = sidebarTab === players.length ? 'cm' : (players[sidebarTab]?.id ?? 'cm');
  const sidebarEntry = turnOrders[sidebarKey] ?? EMPTY_ORDER_ENTRY;
  const sidebarIsCM = sidebarTab === players.length;
  const sidebarIsEditing = sidebarEditMode[sidebarKey] ?? false;

  const constructionText = sidebarEntry.construction;
  const constructionLines = constructionText.split('\n').filter(l => l.trim() !== '');
  const sidebarChecks = constructionChecks[sidebarKey] ?? [];

  const handleDoneEditing = () => {
    setSidebarEditMode(prev => ({ ...prev, [sidebarKey]: false }));
    setConstructionChecks(prev => ({ ...prev, [sidebarKey]: [] }));
  };

  const toggleCheck = (lineIdx: number) => {
    const current = sidebarChecks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...sidebarChecks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { checked: !current.checked, xed: false };
    setConstructionChecks(prev => ({ ...prev, [sidebarKey]: updated }));
  };

  const toggleXed = (lineIdx: number) => {
    const current = sidebarChecks[lineIdx] ?? { checked: false, xed: false };
    const updated = [...sidebarChecks];
    while (updated.length <= lineIdx) updated.push({ checked: false, xed: false });
    updated[lineIdx] = { xed: !current.xed, checked: false };
    setConstructionChecks(prev => ({ ...prev, [sidebarKey]: updated }));
  };

  // Selected system info
  const selectedSystem = map.systems.find(s => s.id === selectedSystemId);
  const systemOwner = selectedSystemId
    ? players.find(p => systemOwnership[selectedSystemId] === p.id)
    : undefined;

  // Ownership warning
  const ownershipWarning = activePlayer && selectedSystemId
    ? systemOwnership[selectedSystemId] !== activePlayer.id
    : false;

  // Unit filtering
  const getAvailableUnits = (player: CampaignPlayer): EmpireUnit[] => {
    if (showAllUnits) return player.empire.units;
    return player.empire.units.filter(u => u.researched === true && !u.isSuperseded);
  };

  // Compute current Alliance-level allies for the active player
  const getAllies = (): CampaignPlayer[] => {
    if (!activePlayer) return [];
    return allPlayers.filter(p => {
      if (p.id === activePlayer.id) return false;
      const rel = diplomacyRelations[diplomacyKey(activePlayer.id, p.id)] ?? 'Unmet';
      return rel === 'Alliance';
    });
  };

  // 125% cost (rounded up). EmpireUnit.cost is already a number.
  const alliedCost = (baseCost: number): number => Math.ceil(baseCost * 1.25);

  // Check if a stolen unit is currently available via an active alliance (for dedup)
  const isStolenUnitCoveredByAlliance = (stolen: { sourceEmpireId: string; unit: EmpireUnit }): boolean => {
    if (!activePlayer) return false;
    const rel = diplomacyRelations[diplomacyKey(activePlayer.id, stolen.sourceEmpireId)] ?? 'Unmet';
    return rel === 'Alliance';
  };

  const isUnitLocked = (unit: EmpireUnit): boolean => !unit.researched;

  // Cart operations
  const addToCart = (unit: EmpireUnit) => {
    setCart(prev => {
      const existing = prev.find(c => c.templateId === unit.id);
      if (existing) return prev.map(c => c.templateId === unit.id ? { ...c, count: c.count + 1 } : c);
      return [...prev, { templateId: unit.id, name: unit.name, cost: unit.cost, count: 1 }];
    });
  };

  const removeFromCart = (templateId: string) => {
    setCart(prev => {
      const existing = prev.find(c => c.templateId === templateId);
      if (!existing) return prev;
      if (existing.count <= 1) return prev.filter(c => c.templateId !== templateId);
      return prev.map(c => c.templateId === templateId ? { ...c, count: c.count - 1 } : c);
    });
  };

  const cartTotal = cart.reduce((sum, c) => sum + c.cost * c.count, 0);
  const cartTotalCount = cart.reduce((sum, c) => sum + c.count, 0);

  // Add Units action
  const handleAddUnits = () => {
    if (!selectedSystemId || cart.length === 0) return;

    if (!isCMTab && activePlayer) {
      const units = cart.flatMap(c =>
        Array.from({ length: c.count }, () => ({ templateId: c.templateId, name: c.name }))
      );
      onAddPlayerUnits(activePlayer.id, selectedSystemId, units);
      setCart([]);
    } else if (isCMTab && selectedCMFleetId) {
      const newUnits: CampaignUnit[] = cart.flatMap(c =>
        Array.from({ length: c.count }, () => ({
          id: crypto.randomUUID(),
          unitTemplateId: c.templateId,
          name: c.name,
          systemId: selectedSystemId,
        }))
      );
      onAddCMUnits(selectedCMFleetId, newUnits);
      setCart([]);
    }
  };

  const canAddUnits = selectedSystemId && cart.length > 0 && (
    !isCMTab ||
    (!showNewFleetForm && selectedCMFleetId !== '')
  );

  const constructionLimits: ConstructionLimits | null = (!isCMTab && activePlayer && selectedSystem)
    ? computeConstructionLimits(activePlayer, selectedSystem, cart, allPlayers)
    : null;

  // Group units by category
  const groupByCategory = (units: EmpireUnit[]) => {
    const grouped: Partial<Record<string, EmpireUnit[]>> = {};
    for (const cat of UNIT_CATEGORY_ORDER) {
      const matching = units.filter(u => u.category === cat);
      if (matching.length > 0) grouped[cat] = matching;
    }
    return grouped;
  };

  // CM fleets at selected system
  const cmFleetsAtSystem = cmFleets.filter(f => f.systemId === selectedSystemId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ← Close
          </button>
          <h2 className="text-base font-semibold dark:text-gray-100">Add Units</h2>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar: Construction Orders */}
        <aside className="flex w-72 flex-col overflow-hidden border-r border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="shrink-0 border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
            Construction Orders
          </div>

          {/* Sidebar tabs */}
          <div ref={sidebarTabBarRef} onMouseDown={sidebarTabBarMouseDown} onClickCapture={sidebarTabBarClickCapture} className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700">
            {players.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setSidebarTab(i)}
                className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
                  sidebarTab === i
                    ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {p.teamColor && (
                  <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                )}
                <span className="flex flex-col items-start leading-tight">
                  <span>{p.name}</span>
                  <span className="text-[10px] font-normal opacity-60">{p.empire.name}</span>
                </span>
              </button>
            ))}
            <button
              onClick={() => setSidebarTab(players.length)}
              className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2 text-xs ${
                sidebarTab === players.length
                  ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
              CM
            </button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto p-3">
            {sidebarIsCM ? (
              /* CM tab: notes textarea (toned down) + Raiders section below */
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Construction Notes
                  </label>
                  <textarea
                    className="h-28 w-full resize-y overflow-y-auto rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    value={sidebarEntry.construction}
                    onChange={e => onUpdateOrders(sidebarKey, { ...sidebarEntry, construction: e.target.value })}
                    placeholder="CM construction notes…"
                  />
                </div>

                {/* Raiders section (same logic as MovementPhasePanel) */}
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Raiders
                  </div>
                  <div className="space-y-1">
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
                          <div className="mt-2 mb-0.5 flex items-center gap-1 text-xs font-semibold dark:text-gray-100">
                            {player.teamColor && (
                              <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: player.teamColor }} />
                            )}
                            {player.name}
                          </div>
                          {riskEntries.length === 0 ? (
                            <p className="text-xs italic text-gray-400 dark:text-gray-500">No raider checks required.</p>
                          ) : (
                            <div className="space-y-0.5">
                              {riskEntries.map(entry => (
                                <div key={entry.id} className="flex flex-wrap items-center gap-1">
                                  <span className="text-xs dark:text-gray-200">{entry.name}</span>
                                  {entry.reasons.map(r => (
                                    <span key={r} className="rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
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
                  </div>

                  <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Guaranteed Pirate Raid
                  </div>
                  {(() => {
                    const guaranteed = map.systems.filter(s => systemStatuses[s.id]?.guaranteedPirateRaid === true);
                    return guaranteed.length === 0 ? (
                      <p className="mt-0.5 text-xs italic text-gray-400 dark:text-gray-500">No guaranteed pirate raids.</p>
                    ) : (
                      <div className="mt-1 space-y-0.5">
                        {guaranteed.map(s => (
                          <div key={s.id} className="text-xs dark:text-gray-200">{s.name}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              /* Player tab: checklist with Edit/Done */
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Construction Orders
                  </span>
                  {sidebarIsEditing ? (
                    <button
                      onClick={handleDoneEditing}
                      className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      onClick={() => setSidebarEditMode(prev => ({ ...prev, [sidebarKey]: true }))}
                      className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {sidebarIsEditing ? (
                  <textarea
                    className="h-64 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    value={sidebarEntry.construction}
                    onChange={e => onUpdateOrders(sidebarKey, { ...sidebarEntry, construction: e.target.value })}
                    placeholder="What are you building this turn?"
                    autoFocus
                  />
                ) : constructionLines.length === 0 ? (
                  <p className="text-xs italic text-gray-400 dark:text-gray-500">No construction orders. Click Edit to add.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {constructionLines.map((line, idx) => {
                      const state = sidebarChecks[idx] ?? { checked: false, xed: false };
                      return (
                        <li
                          key={idx}
                          className={`flex items-start gap-2 text-sm ${
                            state.checked ? 'text-green-600 line-through opacity-60 dark:text-green-400' :
                            state.xed ? 'text-red-500 line-through opacity-60 dark:text-red-400' :
                            'dark:text-gray-200'
                          }`}
                        >
                          <button
                            onClick={() => toggleCheck(idx)}
                            title="Check"
                            className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-xs leading-none ${
                              state.checked
                                ? 'border-green-500 bg-green-500 text-white dark:border-green-600 dark:bg-green-600'
                                : 'border-gray-300 hover:border-green-400 dark:border-gray-600 dark:hover:border-green-500'
                            }`}
                          >
                            {state.checked ? '✓' : ''}
                          </button>
                          <button
                            onClick={() => toggleXed(idx)}
                            title="Mark failed"
                            className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-xs leading-none ${
                              state.xed
                                ? 'border-red-500 bg-red-500 text-white dark:border-red-600 dark:bg-red-600'
                                : 'border-gray-300 hover:border-red-400 dark:border-gray-600 dark:hover:border-red-500'
                            }`}
                          >
                            {state.xed ? '✗' : ''}
                          </button>
                          <span className="flex-1">{line}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* System selector row */}
          <div className="shrink-0 border-b border-gray-200 px-6 py-3 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">System:</span>
              {selectedSystem ? (
                <>
                  <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-800">
                    {systemOwner?.teamColor && (
                      <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: systemOwner.teamColor }} />
                    )}
                    <span className="text-sm font-semibold dark:text-gray-100">{selectedSystem.name}</span>
                    {systemOwner && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">· {systemOwner.name}</span>
                    )}
                    {!systemOwner && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">· Unowned</span>
                    )}
                  </div>
                  <button
                    onClick={onSelectOnMap}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    Change…
                  </button>
                </>
              ) : (
                <button
                  onClick={onSelectOnMap}
                  className="flex items-center gap-2 rounded border border-blue-400 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40"
                >
                  Select System on Map →
                </button>
              )}
            </div>
          </div>

          {/* Player/CM tabs + Show All toggle */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 dark:border-gray-700">
            <div ref={mainTabBarRef} onMouseDown={mainTabBarMouseDown} onClickCapture={mainTabBarClickCapture} className="flex overflow-x-auto">
              {players.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => handleSetTab(i)}
                  className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm ${
                    activeTab === i
                      ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {p.teamColor && (
                    <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                  )}
                  <span className="flex flex-col items-start leading-tight">
                    <span>{p.name}</span>
                    <span className="text-[11px] font-normal opacity-60">{p.empire.name}</span>
                  </span>
                </button>
              ))}
              <button
                onClick={() => handleSetTab(cmTabIndex)}
                className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm ${
                  isCMTab
                    ? 'border-b-2 border-blue-600 font-medium text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-400" />
                CM
              </button>
            </div>
            {!isCMTab && (
              <div className="flex items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={showAlliedUnits}
                    onChange={e => setShowAlliedUnits(e.target.checked)}
                    className="rounded"
                  />
                  Show Allied/Stolen Units
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={showAllUnits}
                    onChange={e => setShowAllUnits(e.target.checked)}
                    className="rounded"
                  />
                  Show All Units
                </label>
              </div>
            )}
          </div>

          {/* Main scrollable area */}
          <div className="flex flex-1 overflow-hidden">

            {/* Unit list */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {!selectedSystemId && (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">Select a system using the button above to add units.</p>
              )}

              {selectedSystemId && !isCMTab && activePlayer && (
                <>
                  {ownershipWarning && (
                    <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                      You don't own this system. Units will still be added.
                    </div>
                  )}
                  {(() => {
                    type TaggedUnit = {
                      unit: EmpireUnit;
                      rowKey: string;
                      effectiveCost: number;
                      tag?: { label: string; colorClass: string; sourceLabel: string };
                    };

                    const ownEntries: TaggedUnit[] = getAvailableUnits(activePlayer).map(unit => ({
                      unit, rowKey: unit.id, effectiveCost: unit.cost ?? 0,
                    }));

                    const stolenEntries: TaggedUnit[] = !showAlliedUnits ? [] :
                      (activePlayer.stolenUnits ?? [])
                        .filter(s => showAllUnits || !isStolenUnitCoveredByAlliance(s))
                        .map(({ sourceEmpireId, unit }) => ({
                          unit,
                          rowKey: `stolen-${sourceEmpireId}-${unit.id}`,
                          effectiveCost: alliedCost(unit.cost ?? 0),
                          tag: {
                            label: 'Stolen',
                            colorClass: 'text-purple-600 dark:text-purple-400',
                            sourceLabel: allPlayers.find(p => p.id === sourceEmpireId)?.empire.name ?? sourceEmpireId,
                          },
                        }));

                    const alliedEntries: TaggedUnit[] = !showAlliedUnits ? [] :
                      getAllies().flatMap(ally => {
                        const allyUnits = showAllUnits
                          ? ally.empire.units.filter(u => u.researched === true)
                          : ally.empire.units.filter(u => u.researched === true && !u.isSuperseded);
                        return allyUnits.map(unit => ({
                          unit,
                          rowKey: `ally-${ally.id}-${unit.id}`,
                          effectiveCost: alliedCost(unit.cost ?? 0),
                          tag: {
                            label: 'Allied',
                            colorClass: 'text-green-600 dark:text-green-400',
                            sourceLabel: ally.empire.name,
                          },
                        }));
                      });

                    // Merge: own first, then stolen, then allied — within each category this preserves order
                    const allEntries = [...ownEntries, ...stolenEntries, ...alliedEntries];

                    const grouped: Partial<Record<string, TaggedUnit[]>> = {};
                    for (const cat of UNIT_CATEGORY_ORDER) {
                      const catEntries = allEntries.filter(e => e.unit.category === cat);
                      if (catEntries.length > 0) grouped[cat] = catEntries;
                    }
                    const entries = Object.entries(grouped);

                    if (entries.length === 0) {
                      return <p className="text-sm italic text-gray-400 dark:text-gray-500">No units available.</p>;
                    }
                    return (
                      <div className="space-y-3">
                        {entries.map(([cat, catEntries]) => {
                          const isCollapsed = collapsedCategories.has(cat);
                          return (
                            <div key={cat}>
                              <button
                                onClick={() => toggleCategory(cat)}
                                className="mb-1 flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              >
                                <span className={`inline-block text-[9px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                                {cat}
                                <span className="font-normal normal-case text-gray-400 dark:text-gray-500">({catEntries!.length})</span>
                              </button>
                              {!isCollapsed && (
                                <div className="grid grid-cols-2 gap-x-4">
                                  {[0, 1].map(col => (
                                    <div
                                      key={col}
                                      style={{ gridTemplateColumns: unitCols }}
                                      className="grid items-center gap-x-1 border-b border-gray-100 px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-800 dark:text-gray-500"
                                    >
                                      <div>Name</div>
                                      <div className="text-right">EP</div>
                                      <div className="text-right">DV</div>
                                      <div className="text-right">AS</div>
                                      <div className="text-right">AF</div>
                                      <div className="text-right">CR</div>
                                      <div className="text-right">CC</div>
                                      <div />
                                      <div>Traits</div>
                                      <div />
                                    </div>
                                  ))}
                                  {catEntries!.map(({ unit, rowKey, effectiveCost, tag }) => {
                                    const locked = !tag && isUnitLocked(unit);
                                    const inCart = cart.find(c => c.templateId === unit.id);
                                    const cartUnit: EmpireUnit = tag ? { ...unit, cost: effectiveCost } : unit;
                                    return (
                                      <div
                                        key={rowKey}
                                        style={{ gridTemplateColumns: unitCols }}
                                        className={`grid items-center gap-x-1 rounded px-2 py-1 ${locked ? 'opacity-50' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                                      >
                                        <div className="min-w-0">
                                          <div className={`truncate text-sm font-medium ${locked ? 'text-gray-400 dark:text-gray-500' : 'dark:text-gray-100'}`}>
                                            {unit.name}
                                            {unit.hullCode !== 'N/A' && <span className="font-normal"> ({unit.hullCode})</span>}
                                            {locked && <span className="ml-1 text-xs font-normal text-gray-400"> ISD {unit.isd}</span>}
                                          </div>
                                          {tag && (
                                            <div className={`text-[11px] leading-tight ${tag.colorClass}`}>{tag.label} · {tag.sourceLabel}</div>
                                          )}
                                        </div>
                                        <span
                                          className={`text-right text-xs font-bold text-gray-700 dark:text-gray-300 ${tag ? 'italic' : ''}`}
                                          title={tag ? `${unit.cost} base × 1.25 surcharge = ${effectiveCost} EP` : undefined}
                                        >{effectiveCost}</span>
                                        {(['dv', 'as', 'af', 'cr', 'cc'] as const).map(stat => (
                                          <span key={stat} className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">
                                            {unit[stat] === '-' ? '—' : String(unit[stat])}
                                          </span>
                                        ))}
                                        <span />
                                        <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                                          {unit.traits.map(t => t.factor ? `${t.name} ${t.factor}` : t.name).join(', ')}
                                        </span>
                                        <div className="flex items-center justify-end gap-0.5">
                                          {inCart ? (
                                            <>
                                              <button onClick={() => removeFromCart(unit.id)} className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">−</button>
                                              <span className="w-4 text-center text-xs font-medium dark:text-gray-200">{inCart.count}</span>
                                              <button onClick={() => !locked && addToCart(cartUnit)} disabled={locked} className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-700">+</button>
                                            </>
                                          ) : (
                                            <button onClick={() => !locked && addToCart(cartUnit)} disabled={locked} className="flex h-5 w-5 items-center justify-center rounded border border-blue-400 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40">+</button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}

              {selectedSystemId && isCMTab && (
                <>
                  <div className="mb-4 flex gap-1">
                    {independentLists.map((list, i) => (
                      <button
                        key={list.id}
                        onClick={() => { setCmSubTab(i); setCart([]); }}
                        className={`rounded px-3 py-1.5 text-sm ${
                          cmSubTab === i
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {list.name.replace(' Force List', '')}
                      </button>
                    ))}
                  </div>

                  <div className="mb-4 rounded border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Target Fleet</div>
                    {!showNewFleetForm ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedCMFleetId}
                          onChange={e => setSelectedCMFleetId(e.target.value)}
                          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="">— Select a fleet —</option>
                          {cmFleetsAtSystem.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { setShowNewFleetForm(true); setSelectedCMFleetId(''); }}
                          className="whitespace-nowrap rounded border border-gray-300 px-2 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          + New Fleet
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Fleet name…"
                          value={newFleetName}
                          onChange={e => setNewFleetName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newFleetName.trim() && selectedSystemId) {
                              const newId = crypto.randomUUID();
                              onCreateCMFleet({
                                id: newId,
                                name: newFleetName.trim(),
                                color: newFleetColor,
                                systemId: selectedSystemId,
                                sourceListId: independentLists[cmSubTab]?.id ?? 'independent',
                                units: [],
                              });
                              setSelectedCMFleetId(newId);
                              setShowNewFleetForm(false);
                              setNewFleetName('');
                            }
                            if (e.key === 'Escape') { setShowNewFleetForm(false); setNewFleetName(''); }
                          }}
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                          autoFocus
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">Color:</span>
                          <div className="flex flex-wrap items-center gap-1">
                            {CM_FLEET_COLORS.map(c => (
                              <button
                                key={c}
                                onClick={() => setNewFleetColor(c)}
                                className={`h-5 w-5 rounded-full border-2 ${newFleetColor === c ? 'border-blue-500' : 'border-transparent hover:border-gray-400'}`}
                                style={{ backgroundColor: c }}
                              />
                            ))}
                            <div className="relative inline-block">
                              <button
                                type="button"
                                onClick={() => { const el = document.getElementById('add-units-color-input') as HTMLInputElement | null; el?.click(); }}
                                title="Custom color…"
                                className="h-5 w-5 rounded-full border-2 border-gray-300 hover:border-gray-500"
                                style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                              />
                              <input
                                id="add-units-color-input"
                                type="color"
                                value={newFleetColor}
                                onChange={e => setNewFleetColor(e.target.value)}
                                className="absolute opacity-0"
                                style={{ width: 0, height: 0, top: 0, left: 0 }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => { setShowNewFleetForm(false); setNewFleetName(''); }}
                            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              if (!newFleetName.trim() || !selectedSystemId) return;
                              const newId = crypto.randomUUID();
                              onCreateCMFleet({
                                id: newId,
                                name: newFleetName.trim(),
                                color: newFleetColor,
                                systemId: selectedSystemId,
                                sourceListId: independentLists[cmSubTab]?.id ?? 'independent',
                                units: [],
                              });
                              setSelectedCMFleetId(newId);
                              setShowNewFleetForm(false);
                              setNewFleetName('');
                            }}
                            disabled={!newFleetName.trim() || !selectedSystemId}
                            className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Create Fleet
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {(() => {
                    const list = independentLists[cmSubTab];
                    if (!list || list.units.length === 0) {
                      return <p className="text-sm italic text-gray-400 dark:text-gray-500">No units defined for this force list yet.</p>;
                    }
                    const grouped = groupByCategory(list.units);
                    const entries = Object.entries(grouped);
                    return (
                      <div className="space-y-3">
                        {entries.map(([cat, catUnits]) => {
                          const isCollapsed = collapsedCategories.has(cat);
                          return (
                            <div key={cat}>
                              <button
                                onClick={() => toggleCategory(cat)}
                                className="mb-1 flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              >
                                <span className={`inline-block text-[9px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                                {cat}
                                <span className="font-normal normal-case text-gray-400 dark:text-gray-500">({catUnits!.length})</span>
                              </button>
                              {!isCollapsed && (
                                <div className="grid grid-cols-2 gap-x-4">
                                  {[0, 1].map(col => (
                                    <div
                                      key={col}
                                      style={{ gridTemplateColumns: unitCols }}
                                      className="grid items-center gap-x-1 border-b border-gray-100 px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-800 dark:text-gray-500"
                                    >
                                      <div>Name</div>
                                      <div className="text-right">EP</div>
                                      <div className="text-right">DV</div>
                                      <div className="text-right">AS</div>
                                      <div className="text-right">AF</div>
                                      <div className="text-right">CR</div>
                                      <div className="text-right">CC</div>
                                      <div />
                                      <div>Traits</div>
                                      <div />
                                    </div>
                                  ))}
                                  {catUnits!.map(unit => {
                                    const inCart = cart.find(c => c.templateId === unit.id);
                                    return (
                                      <div
                                        key={unit.id}
                                        style={{ gridTemplateColumns: unitCols }}
                                        className="grid items-center gap-x-1 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                                      >
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-medium dark:text-gray-100">
                                            {unit.name}
                                            {unit.hullCode !== 'N/A' && <span className="font-normal"> ({unit.hullCode})</span>}
                                          </div>
                                        </div>
                                        <span className="text-right text-xs font-bold text-gray-700 dark:text-gray-300">{unit.cost}</span>
                                        {(['dv', 'as', 'af', 'cr', 'cc'] as const).map(stat => (
                                          <span key={stat} className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">
                                            {unit[stat] === '-' ? '—' : String(unit[stat])}
                                          </span>
                                        ))}
                                        <span />
                                        <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                                          {unit.traits.map(t => t.factor ? `${t.name} ${t.factor}` : t.name).join(', ')}
                                        </span>
                                        <div className="flex items-center justify-end gap-0.5">
                                          {inCart ? (
                                            <>
                                              <button onClick={() => removeFromCart(unit.id)} className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">−</button>
                                              <span className="w-4 text-center text-xs font-medium dark:text-gray-200">{inCart.count}</span>
                                              <button onClick={() => addToCart(unit)} className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700">+</button>
                                            </>
                                          ) : (
                                            <button onClick={() => addToCart(unit)} className="flex h-5 w-5 items-center justify-center rounded border border-blue-400 bg-blue-50 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40">+</button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Right: Cart + action buttons */}
            <div className="flex w-64 flex-col border-l border-gray-200 dark:border-gray-700">
              <div className="shrink-0 border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                Cart
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {cart.length === 0 ? (
                  <p className="text-xs italic text-gray-400 dark:text-gray-500">No units staged.</p>
                ) : (
                  <div className="space-y-1.5">
                    {cart.map(item => (
                      <div key={item.templateId} className="flex items-center gap-2">
                        <div className="flex-1">
                          <span className="text-xs font-medium dark:text-gray-200">{item.count}× {item.name}</span>
                          <div className="text-xs text-gray-400">{item.cost * item.count} EP</div>
                        </div>
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => removeFromCart(item.templateId)} className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">−</button>
                          <button
                            onClick={() => {
                              const unit = (activePlayer?.empire.units ?? independentLists[cmSubTab]?.units ?? []).find(u => u.id === item.templateId);
                              if (unit) { addToCart(unit); return; }
                              // Allied/stolen units: not in own units or independent lists
                              const stolen = (activePlayer?.stolenUnits ?? []).find(s => s.unit.id === item.templateId);
                              if (stolen) { addToCart({ ...stolen.unit, cost: alliedCost(stolen.unit.cost ?? 0) }); return; }
                              const allyUnit = getAllies().flatMap(a => a.empire.units).find(u => u.id === item.templateId);
                              if (allyUnit) { addToCart({ ...allyUnit, cost: alliedCost(allyUnit.cost ?? 0) }); return; }
                            }}
                            className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >+</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-gray-200 p-3 dark:border-gray-700">
                {cart.length > 0 && (
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{cartTotalCount} unit{cartTotalCount !== 1 ? 's' : ''}</span>
                    <span className="font-semibold dark:text-gray-100">{cartTotal} EP</span>
                  </div>
                )}
                {constructionLimits && (
                  <div className="mb-2 rounded border border-gray-200 p-2 dark:border-gray-700">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Construction Points</p>
                    <div className="space-y-1">
                      {/* Shipyard row */}
                      {(() => {
                        const { shipyardDemand, shipyardCP, shipyardSoftOver, shipyardHardOver, nonAtmOverflow, atmOverflow } = constructionLimits;
                        const displayDemand = shipyardSoftOver ? shipyardCP : shipyardDemand;
                        const valueText = `${displayDemand} / ${shipyardCP}`;
                        return (
                          <div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 dark:text-gray-400">Shipyard</span>
                              {shipyardHardOver ? (
                                <span className="font-semibold text-red-600 dark:text-red-400">{valueText}</span>
                              ) : shipyardSoftOver ? (
                                <span className="font-semibold text-amber-600 dark:text-amber-400">({valueText})</span>
                              ) : (
                                <span className="text-gray-700 dark:text-gray-300">{valueText}</span>
                              )}
                            </div>
                            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                              <div
                                className={`h-full rounded-full transition-all ${shipyardHardOver ? 'bg-red-500' : shipyardSoftOver ? 'bg-amber-500' : 'bg-blue-500'}`}
                                style={{ width: `${shipyardCP > 0 ? Math.min(shipyardDemand / shipyardCP * 100, 100) : (shipyardDemand > 0 ? 100 : 0)}%` }}
                              />
                            </div>
                            {nonAtmOverflow > 0 && (
                              <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                                {nonAtmOverflow} CP non-atm → Planetary (×2)
                              </p>
                            )}
                            {atmOverflow > 0 && (
                              <p className="mt-0.5 text-xs text-blue-500 dark:text-blue-400">
                                {atmOverflow} CP atm ← Planetary
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      {/* Planetary row */}
                      {(() => {
                        const { planetaryDemand, planetaryCP, planetarySoftOver, planetaryHardOver, atmOverflow } = constructionLimits;
                        const displayDemand = planetarySoftOver ? planetaryCP : planetaryDemand;
                        const valueText = `${displayDemand} / ${planetaryCP}`;
                        return (
                          <div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 dark:text-gray-400">Planetary</span>
                              {planetaryHardOver ? (
                                <span className="font-semibold text-red-600 dark:text-red-400">{valueText}</span>
                              ) : planetarySoftOver ? (
                                <span className="font-semibold text-amber-600 dark:text-amber-400">({valueText})</span>
                              ) : (
                                <span className="text-gray-700 dark:text-gray-300">{valueText}</span>
                              )}
                            </div>
                            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                              <div
                                className={`h-full rounded-full transition-all ${planetaryHardOver ? 'bg-red-500' : planetarySoftOver ? 'bg-amber-500' : 'bg-green-500'}`}
                                style={{ width: `${planetaryCP > 0 ? Math.min(planetaryDemand / planetaryCP * 100, 100) : (planetaryDemand > 0 ? 100 : 0)}%` }}
                              />
                            </div>
                            {atmOverflow > 0 && (
                              <p className="mt-0.5 text-xs text-blue-500 dark:text-blue-400">
                                {atmOverflow} CP atm → Shipyard
                              </p>
                            )}
                            {planetaryHardOver && (
                              <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                                {planetaryDemand - planetaryCP} CP over limit
                              </p>
                            )}
                          </div>
                        );
                      })()}
                      {/* Troop CP row — only shown if troops are in cart */}
                      {constructionLimits.hasTroops && (() => {
                        const { troopCost, troopCPLimit } = constructionLimits;
                        const over = troopCost > troopCPLimit;
                        return (
                          <div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-600 dark:text-gray-400">Troops</span>
                              <span className={over ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}>
                                {troopCost} / {troopCPLimit}
                              </span>
                            </div>
                            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                              <div
                                className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-orange-400'}`}
                                style={{ width: `${troopCPLimit > 0 ? Math.min(troopCost / troopCPLimit * 100, 100) : (troopCost > 0 ? 100 : 0)}%` }}
                              />
                            </div>
                            {over && (
                              <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                                {troopCost - troopCPLimit} CP over population limit
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
                <button
                  onClick={handleAddUnits}
                  disabled={!canAddUnits}
                  className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
                >
                  Add Units
                </button>
                {!selectedSystemId && (
                  <p className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">Select a system first</p>
                )}
                {isCMTab && selectedSystemId && !showNewFleetForm && !selectedCMFleetId && (
                  <p className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">Select or create a fleet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
