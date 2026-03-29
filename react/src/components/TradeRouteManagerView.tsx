import { useState, useEffect, useRef } from 'react';
import type { CampaignPlayer, CampaignUnit, GameMap, DiplomacyLevel, SystemCampaignStatus } from '../types';
import { SYSTEM_FLEET_NAMES } from '../types';
import { diplomacyKey, isEffectivelyBlockaded } from '../utils/supplyUtils';
import { resolveUnitTemplate } from '../utils/fleetUtils';

const DIPLOMACY_LEVELS: DiplomacyLevel[] = [
  'Unmet', 'War', 'Hostilities', 'Neutral', 'NonAggression', 'Trade', 'MutualDefense', 'Alliance',
];

function diplomacyRank(level: DiplomacyLevel): number {
  return DIPLOMACY_LEVELS.indexOf(level);
}

function isTradeOrBetter(rel: DiplomacyLevel): boolean {
  return diplomacyRank(rel) >= diplomacyRank('Trade');
}

function getConvoyLocation(convoy: CampaignUnit, player: CampaignPlayer, map: GameMap): string {
  const systemName = convoy.systemId
    ? (map.systems.find(s => s.id === convoy.systemId)?.name ?? convoy.systemId)
    : null;

  if (convoy.fleetId) {
    const fleetName = (SYSTEM_FLEET_NAMES as readonly string[]).includes(convoy.fleetId)
      ? convoy.fleetId
      : (player.fleets?.find(f => f.id === convoy.fleetId)?.name ?? convoy.fleetId);
    return systemName ? `${systemName} \u2014 ${fleetName}` : fleetName;
  }

  return systemName ?? 'Unknown location';
}

/** Returns '#000000' or '#ffffff' for maximum contrast against a hex background color. */
function getContrastText(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return '#000000';
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

/** EP income a single system contributes to a trade route. */
function computeSystemTradeIncome(
  systemId: string,
  map: GameMap,
  systemStatuses: Record<string, SystemCampaignStatus>,
): number {
  const sys = map.systems.find(s => s.id === systemId);
  const pop = sys?.attributes?.population ?? 0;
  const status = systemStatuses[systemId] ?? {};
  return (isEffectivelyBlockaded(status) || status.inOpposition) ? Math.ceil(pop / 2) : pop;
}

/** Compute total EP for a single route (includes Free Traders bonus, enemy-fleet zero-out). */
function computeRouteTotal(
  systemIds: string[],
  map: GameMap,
  systemStatuses: Record<string, SystemCampaignStatus>,
  hasFreeTraders: boolean,
): { total: number; blockedByEnemy: boolean } {
  const blockedByEnemy = systemIds.some(sid => systemStatuses[sid]?.hasEnemyFleet);
  if (blockedByEnemy) return { total: 0, blockedByEnemy: true };
  const subtotal = systemIds.reduce((s, id) => s + computeSystemTradeIncome(id, map, systemStatuses), 0);
  const total = hasFreeTraders && subtotal > 0 ? Math.ceil(subtotal * 1.5) : subtotal;
  return { total, blockedByEnemy: false };
}

// ---------------------------------------------------------------------------
// TradeRouteManagerView
// ---------------------------------------------------------------------------

interface TradeRouteManagerViewProps {
  players: CampaignPlayer[];
  initialPlayerId?: string;
  map: GameMap;
  diplomacyRelations: Record<string, DiplomacyLevel>;
  systemOwnership: Record<string, string>;
  systemStatuses?: Record<string, SystemCampaignStatus>;
  inPickMode: boolean;
  pickedSystemId: string | null;
  onEnterPickMode: () => void;
  onExitPickMode: () => void;
  onSetTradeRoute: (playerId: string, convoyUnitId: string, systemIds: string[]) => void;
  onClearTradeRoute: (playerId: string, convoyUnitId: string) => void;
  onRecallConvoy: (playerId: string, convoyUnitId: string, toSystemId: string) => void;
  onPickChainChange?: (systemIds: string[]) => void;
  onCenterSystem?: (systemId: string) => void;
  onClose: () => void;
}

export function TradeRouteManagerView({
  players,
  initialPlayerId,
  map,
  diplomacyRelations,
  systemOwnership,
  systemStatuses = {},
  inPickMode,
  pickedSystemId,
  onEnterPickMode,
  onExitPickMode,
  onSetTradeRoute,
  onClearTradeRoute,
  onRecallConvoy,
  onPickChainChange,
  onCenterSystem,
  onClose,
}: TradeRouteManagerViewProps) {
  const [viewingPlayerId, setViewingPlayerId] = useState<string>(
    initialPlayerId ?? players[0]?.id ?? ''
  );
  const [selectedConvoyId, setSelectedConvoyId] = useState<string | null>(null);
  const [pickPlayerId, setPickPlayerId] = useState<string>('');
  const [pickChain, setPickChain] = useState<string[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);

  // Drag-to-scroll for the pill row
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const pillDragging = useRef(false);
  const pillDragStartX = useRef(0);
  const pillScrollStart = useRef(0);

  const onPillMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    pillDragging.current = true;
    pillDragStartX.current = e.clientX;
    pillScrollStart.current = pillContainerRef.current?.scrollLeft ?? 0;
    e.preventDefault();
  };
  const onPillMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pillDragging.current) return;
    const dx = e.clientX - pillDragStartX.current;
    if (pillContainerRef.current) pillContainerRef.current.scrollLeft = pillScrollStart.current - dx;
  };
  const onPillMouseUp = () => { pillDragging.current = false; };
  const onPillMouseLeave = () => { pillDragging.current = false; };

  const viewingPlayer = players.find(p => p.id === viewingPlayerId) ?? players[0];

  // Reset convoy selection when switching players
  useEffect(() => {
    setSelectedConvoyId(null);
  }, [viewingPlayerId]);

  const convoys = (viewingPlayer?.units ?? []).filter(u => {
    const template = resolveUnitTemplate(viewingPlayer!, u.unitTemplateId, players);
    return template?.name === 'Convoy';
  });

  // Notify parent of pick chain changes so the map can highlight them
  useEffect(() => {
    onPickChainChange?.(pickChain);
  }, [pickChain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle system click during pick mode
  useEffect(() => {
    if (!inPickMode || !pickedSystemId || !selectedConvoyId) return;

    const pickingPlayer = players.find(p => p.id === pickPlayerId);
    if (!pickingPlayer) return;

    const owner = systemOwnership[pickedSystemId];
    const sys = map.systems.find(s => s.id === pickedSystemId);
    const sysName = sys?.name ?? pickedSystemId;

    // Hard blocks
    if (pickChain.includes(pickedSystemId)) {
      setPickError(`${sysName} is already in the route.`);
      return;
    }
    if (pickChain.length >= 3) {
      setPickError('A route can have at most 3 systems. Use Undo Last or Confirm Route.');
      return;
    }

    // Soft warnings — collect but still add the system
    const warnings: string[] = [];

    if (!owner) {
      warnings.push(`${sysName} is unowned.`);
    } else if (owner !== pickingPlayer.id) {
      const rel = diplomacyRelations[diplomacyKey(pickingPlayer.id, owner)] ?? 'Unmet';
      if (!isTradeOrBetter(rel)) {
        const ownerPlayer = players.find(p => p.id === owner);
        warnings.push(`Insufficient diplomacy with ${ownerPlayer?.name ?? owner} for ${sysName}.`);
      }
    }

    if (pickChain.length > 0) {
      const lastId = pickChain[pickChain.length - 1];
      const connectingLane = map.jumpLanes.find(l =>
        (l.from === lastId && l.to === pickedSystemId) || (l.from === pickedSystemId && l.to === lastId)
      );
      if (!connectingLane) {
        const lastSys = map.systems.find(s => s.id === lastId);
        warnings.push(`${sysName} is not adjacent to ${lastSys?.name ?? lastId}.`);
      } else if (connectingLane.type === 'restricted' || connectingLane.type === 'unexplored') {
        warnings.push(`Lane to ${sysName} is ${connectingLane.type}.`);
      } else {
        const hasFreeTraders = pickingPlayer.empire.advantages.includes('Free Traders');
        if (!hasFreeTraders && connectingLane.type !== 'major') {
          warnings.push(`Lane to ${sysName} is ${connectingLane.type} — this empire requires Major lanes.`);
        }
      }
    }

    setPickError(warnings.length > 0 ? warnings.join(' ') : null);
    setPickChain(prev => [...prev, pickedSystemId]);
  }, [pickedSystemId, inPickMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStartEstablish = (convoyId: string) => {
    const convoy = viewingPlayer?.units.find(u => u.id === convoyId);
    setSelectedConvoyId(convoyId);
    setPickPlayerId(viewingPlayer!.id);
    setPickChain(convoy?.systemId ? [convoy.systemId] : []);
    setPickError(null);
    onEnterPickMode();
  };

  const handleConfirmRoute = () => {
    if (!selectedConvoyId || pickChain.length === 0) return;
    onSetTradeRoute(pickPlayerId, selectedConvoyId, pickChain);
    setPickChain([]);
    onPickChainChange?.([]);
    setSelectedConvoyId(null);
    onExitPickMode();
  };

  const handleCancelPick = () => {
    setPickChain([]);
    onPickChainChange?.([]);
    setPickError(null);
    setSelectedConvoyId(null);
    onExitPickMode();
  };

  const handleUndoLast = () => {
    setPickChain(prev => prev.slice(0, -1));
    setPickError(null);
  };

  const getRoute = (convoyId: string) =>
    (viewingPlayer?.tradeRoutes ?? []).find(r => r.convoyUnitId === convoyId);

  const getSystemName = (id: string) =>
    map.systems.find(s => s.id === id)?.name ?? id;

  // Floating pick panel (shown over map when in pick mode)
  if (inPickMode) {
    const convoyUnit = viewingPlayer?.units.find(u => u.id === selectedConvoyId);
    const convoyHomeMissing = convoyUnit?.systemId && !pickChain.includes(convoyUnit.systemId);

    return (
      <div className="absolute bottom-20 left-1/2 z-20 w-80 -translate-x-1/2 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <p className="text-sm font-semibold dark:text-gray-100">Establishing Trade Route</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Click systems on the map to build a chain (1–3 systems)</p>
        </div>
        <div className="space-y-2 px-4 py-3">
          {pickChain.length === 0 && (
            <p className="text-sm italic text-gray-400 dark:text-gray-500">No systems selected yet.</p>
          )}
          {pickChain.map((id, i) => (
            <div key={id} className="flex items-center gap-2 text-sm dark:text-gray-200">
              <span className="text-gray-400 dark:text-gray-500">{i + 1}.</span>
              {getSystemName(id)}
            </div>
          ))}
          {convoyHomeMissing && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              ⚠ Convoy's home system ({getSystemName(convoyUnit!.systemId!)}) is not in the route.
            </div>
          )}
          {pickError && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              ⚠ {pickError}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            onClick={handleUndoLast}
            disabled={pickChain.length === 0}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Undo Last
          </button>
          <button
            onClick={handleCancelPick}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmRoute}
            disabled={pickChain.length === 0}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Confirm Route
          </button>
        </div>
      </div>
    );
  }

  // Trade summary for the viewing player
  const hasFreeTraders = viewingPlayer?.empire.advantages.includes('Free Traders') ?? false;
  const allRoutes = viewingPlayer?.tradeRoutes ?? [];
  const grandTotal = allRoutes.reduce((sum, route) => {
    const { total } = computeRouteTotal(route.systemIds, map, systemStatuses, hasFreeTraders);
    return sum + total;
  }, 0);

  // Modal
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50">
      <div className="flex w-full max-w-4xl flex-col rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900" style={{ maxHeight: '85vh' }}>

        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 px-6 py-3 dark:border-gray-700">
          {/* Left: close + title — fixed, never shrinks */}
          <div className="flex flex-shrink-0 items-center gap-4">
            <button
              onClick={onClose}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              ← Close
            </button>
            <h1 className="text-base font-semibold dark:text-gray-100">Manage Trade Routes</h1>
          </div>

          {/* Player pill row — scrollable, drag-pannable, never wraps */}
          <div
            ref={pillContainerRef}
            className="flex min-w-0 flex-1 cursor-grab select-none items-center gap-1 overflow-x-auto pb-1.5 pt-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-400 [&::-webkit-scrollbar-thumb]:hover:bg-gray-500 [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-gray-500 dark:[&::-webkit-scrollbar-thumb]:hover:bg-gray-400 dark:[&::-webkit-scrollbar-track]:bg-transparent"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgb(156 163 175) transparent' }}
            onMouseDown={onPillMouseDown}
            onMouseMove={onPillMouseMove}
            onMouseUp={onPillMouseUp}
            onMouseLeave={onPillMouseLeave}
          >
            {players.map(p => (
              <button
                key={p.id}
                onClick={() => setViewingPlayerId(p.id)}
                className={`flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                  p.id === viewingPlayerId
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                {p.teamColor && (
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: p.teamColor }}
                  />
                )}
                <span className="flex flex-col items-start leading-tight">
                  <span>{p.name}</span>
                  {p.empire?.name && (
                    <span className="text-[11px] font-normal opacity-70">{p.empire.name}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">

          {/* Left panel: Summary + Convoy list */}
          <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-gray-200 p-4 dark:border-gray-700">

            {/* Trade Summary */}
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Trade Summary
            </p>
            <div className="flex items-baseline justify-between text-sm dark:text-gray-200">
              <span className="text-gray-600 dark:text-gray-400">
                {allRoutes.length} route{allRoutes.length !== 1 ? 's' : ''}
              </span>
              <span className="font-semibold text-green-600 dark:text-green-400">{grandTotal} EP</span>
            </div>

            <div className="my-4 border-t border-gray-200 dark:border-gray-700" />

            {/* Convoys list */}
            <div className="mb-3 flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Convoys</p>
              {hasFreeTraders && (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Free Traders
                </span>
              )}
            </div>
            {convoys.length === 0 && (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No Convoy units found.</p>
            )}
            {convoys.map(convoy => {
              const route = getRoute(convoy.id);
              const subtext = route
                ? route.systemIds.map(getSystemName).join(' \u2192 ')
                : getConvoyLocation(convoy, viewingPlayer!, map);

              let routeEP: number | null = null;
              if (route) {
                const { total } = computeRouteTotal(route.systemIds, map, systemStatuses, hasFreeTraders);
                routeEP = total;
              }
              const epBlocked = route
                ? route.systemIds.some(sid => systemStatuses[sid]?.hasEnemyFleet)
                : false;

              return (
                <button
                  key={convoy.id}
                  onClick={() => setSelectedConvoyId(convoy.id)}
                  className={`mb-2 flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm ${
                    selectedConvoyId === convoy.id
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
                      : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                  } dark:text-gray-200`}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{route ? 'Trade Route' : (convoy.name ?? 'Convoy')}</span>
                    <span className="mt-0.5 w-full truncate text-xs text-gray-500 dark:text-gray-400">
                      {route ? (
                        <span className="text-blue-600 dark:text-blue-400">{subtext}</span>
                      ) : subtext}
                    </span>
                  </div>
                  {routeEP !== null && (
                    <span className={`flex-shrink-0 text-xs font-semibold ${epBlocked ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {routeEP} EP
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right panel: Selected convoy details */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedConvoyId && (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">Select a Convoy to manage its route.</p>
            )}
            {selectedConvoyId && (() => {
              const convoy = convoys.find(c => c.id === selectedConvoyId);
              const route = getRoute(selectedConvoyId);
              if (!convoy) return null;
              return (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold dark:text-gray-100">{route ? 'Trade Route' : (convoy.name ?? 'Convoy')}</h2>

                  {!route && (
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Location: <span className="text-gray-700 dark:text-gray-200">{getConvoyLocation(convoy, viewingPlayer!, map)}</span>
                    </p>
                  )}

                  {route ? (() => {
                    const blockedByEnemy = route.systemIds.some(sid => systemStatuses[sid]?.hasEnemyFleet);
                    const systemIncomes = route.systemIds.map(id => ({
                      id,
                      income: blockedByEnemy ? 0 : computeSystemTradeIncome(id, map, systemStatuses),
                    }));
                    const routeSubtotal = systemIncomes.reduce((s, x) => s + x.income, 0);
                    const routeTotal = hasFreeTraders && !blockedByEnemy && routeSubtotal > 0
                      ? Math.ceil(routeSubtotal * 1.5)
                      : routeSubtotal;

                    return (
                      <>
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Current Route</p>
                          <div className="flex flex-wrap items-start gap-3">
                            {route.systemIds.map((id, i) => {
                              const owner = systemOwnership[id];
                              const ownerColor = players.find(p => p.id === owner)?.teamColor;
                              const bgColor = ownerColor ?? '#e5e7eb';
                              const textColor = ownerColor ? getContrastText(ownerColor) : '#374151';
                              const inc = systemIncomes[i].income;
                              return (
                                <div key={id} className="flex items-start gap-3">
                                  {i > 0 && <span className="mt-1.5 text-gray-400 dark:text-gray-500">→</span>}
                                  <div className="flex flex-col items-center gap-1">
                                    <button
                                      onClick={() => { onCenterSystem?.(id); }}
                                      title={`Center map on ${getSystemName(id)}`}
                                      className="rounded px-2.5 py-1 text-sm font-medium transition-opacity hover:opacity-75"
                                      style={{ backgroundColor: bgColor, color: textColor }}
                                    >
                                      {getSystemName(id)}
                                    </button>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {blockedByEnemy ? '0 EP' : `${inc} EP`}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* EP income summary */}
                          <div className="mt-3 space-y-0.5 text-sm dark:text-gray-200">
                            {blockedByEnemy && (
                              <p className="font-medium text-red-600 dark:text-red-400">⚠ Enemy fleet present — route yields 0 EP</p>
                            )}
                            {!blockedByEnemy && hasFreeTraders && routeSubtotal > 0 && (
                              <p className="text-gray-600 dark:text-gray-400">
                                Subtotal: {routeSubtotal} EP
                                <span className="ml-2 text-green-600 dark:text-green-400">× 1.5 (Free Traders)</span>
                              </p>
                            )}
                            <p className="font-semibold">
                              Total: {routeTotal} EP
                            </p>
                          </div>
                        </div>

                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recall Convoy To</p>
                          <div className="flex flex-wrap gap-2">
                            {route.systemIds.map(id => (
                              <button
                                key={id}
                                onClick={() => onRecallConvoy(viewingPlayer!.id, selectedConvoyId, id)}
                                className="rounded border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40"
                              >
                                Recall to {getSystemName(id)}
                              </button>
                            ))}
                          </div>
                          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Recalling dissolves the trade route and places the Convoy at the chosen system.</p>
                        </div>
                      </>
                    );
                  })() : (
                    <div>
                      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">This Convoy has no trade route assigned.</p>
                      <button
                        onClick={() => handleStartEstablish(selectedConvoyId)}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Establish Route on Map
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
