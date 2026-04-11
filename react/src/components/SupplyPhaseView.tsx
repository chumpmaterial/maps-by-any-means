import { useState, useMemo, useEffect } from 'react';
import type { CampaignPlayer, CampaignUnit, EmpireUnit, GameMap, SystemCampaignStatus, DiplomacyLevel } from '../types';
import { computeSupplyResults } from '../utils/supplyUtils';
import type { SupplyFleetResult, SupplyResult } from '../utils/supplyUtils';
import { computeFactorTotal } from '../utils/combatUtils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SupplyPhaseViewProps {
  players: CampaignPlayer[];
  map: GameMap;
  systemStatuses: Record<string, SystemCampaignStatus>;
  systemOwnership: Record<string, string>;
  diplomacyRelations: Record<string, DiplomacyLevel>;
  currentTurn: number;
  onToggleUnitStatus: (playerId: string, unitId: string, status: StrategicStatus) => void;
  onDeleteUnit: (playerId: string, unitId: string) => void;
  onBulkSetOutOfSupply: (playerId: string, unitIds: string[], value: boolean) => void;
  onClearInSupplyStatuses: (clearByPlayer: { playerId: string; unitIds: string[] }[]) => void;
  onViewMap: () => void;
  onAdvance: () => void;
  onBack: () => void;
  canBack: boolean;
}

// ---------------------------------------------------------------------------
// Status badge config (mirrors FleetManagerView pattern)
// ---------------------------------------------------------------------------

type StrategicStatus = 'crippled' | 'outOfSupply' | 'captured' | 'exhausted' | 'mothballed';

const UNIT_STATUS_CONFIG: Array<{
  key: StrategicStatus;
  label: string;
  title: string;
  activeCls: string;
}> = [
  { key: 'crippled',    label: 'C',    title: 'Crippled',      activeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  { key: 'outOfSupply', label: 'OOS',  title: 'Out of Supply', activeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { key: 'captured',    label: 'CAP',  title: 'Captured',      activeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { key: 'exhausted',   label: 'EX',   title: 'Exhausted',     activeCls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
];

// ---------------------------------------------------------------------------
// UnitRow
// ---------------------------------------------------------------------------

function UnitRow({
  unit,
  template,
  onToggleStatus,
  onDelete,
}: {
  unit: CampaignUnit;
  template: EmpireUnit | undefined;
  onToggleStatus: (unitId: string, status: StrategicStatus) => void;
  onDelete: (unitId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const supplyTrait = template?.traits.find(t => t.name === 'Supply');
  const hasSupplyTrait = !!supplyTrait;

  return (
    <div className="flex items-center gap-2 rounded border border-gray-100 bg-white px-3 py-1.5 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
      <span className="flex-1 text-sm dark:text-gray-200">{unit.name}</span>
      {supplyTrait?.factor !== undefined && (
        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
          Supply: {supplyTrait.factor}
        </span>
      )}

      {/* Status badges / toggle buttons */}
      <div className="flex gap-1">
        {UNIT_STATUS_CONFIG.map(({ key, label, title, activeCls }) => {
          if (key === 'exhausted' && !hasSupplyTrait) return null;
          if (key === 'mothballed' && template?.category !== 'Ships' && template?.category !== 'Fighters') return null;
          const isActive = !!unit[key];
          return (
            <button
              key={key}
              title={`Toggle ${title}`}
              onClick={() => onToggleStatus(unit.id, key)}
              className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                isActive
                  ? activeCls
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-500 dark:hover:bg-gray-600'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Delete */}
      {confirmDelete ? (
        <div className="flex gap-1">
          <button
            onClick={() => onDelete(unit.id)}
            className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
          >
            Confirm
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          title="Delete unit"
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 hover:border-red-400 hover:text-red-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-red-500 dark:hover:text-red-400"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OOS Fleet Card
// ---------------------------------------------------------------------------

function OOSFleetCard({
  fleet,
  player,
  onToggleStatus,
  onDelete,
  onMarkAllOOS,
}: {
  fleet: SupplyFleetResult;
  player: CampaignPlayer;
  onToggleStatus: (unitId: string, status: StrategicStatus) => void;
  onDelete: (unitId: string) => void;
  onMarkAllOOS: (unitIds: string[]) => void;
}) {
  // Resolve units live from player so status badges update immediately on toggle
  const liveUnits = fleet.fleetId.startsWith('sys-')
    ? player.units.filter(u => !u.fleetId && u.systemId === fleet.systemId)
    : player.units.filter(u => u.fleetId === fleet.fleetId);
  const unitIds = liveUnits.map(u => u.id);

  // Build a template map for this player's empire units
  const templateMap = useMemo(() => {
    const m = new Map<string, EmpireUnit>();
    for (const et of player.empire?.units ?? []) m.set(et.id, et);
    return m;
  }, [player.empire?.units]);

  const totalSupply = computeFactorTotal(liveUnits, templateMap, 'Supply');

  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
      {/* Fleet header — click to collapse */}
      <div
        className="flex cursor-pointer items-center justify-between px-3 py-2 select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 dark:text-gray-500">{collapsed ? '▶' : '▼'}</span>
          <span className="font-medium text-sm dark:text-gray-200">{fleet.fleetName}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">@ {fleet.systemName}</span>
          {fleet.systemPopulation !== undefined && (
            <span
              className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
              title="System Population"
            >
              Population: {fleet.systemPopulation}
            </span>
          )}
          {totalSupply > 0 && (
            <span
              className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
              title="Total Supply Factors"
            >
              Supply: {totalSupply}
            </span>
          )}
        </div>
        {!collapsed && unitIds.length > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onMarkAllOOS(unitIds); }}
            className="rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-900/30"
          >
            Mark All OOS
          </button>
        )}
      </div>

      {/* Unit list */}
      {!collapsed && (
        <div className="space-y-1 border-t border-red-200 p-2 dark:border-red-900/40">
          {liveUnits.length === 0 ? (
            <p className="px-1 text-xs text-gray-400 dark:text-gray-500">No units</p>
          ) : (
            liveUnits.map(unit => (
              <UnitRow
                key={unit.id}
                unit={unit}
                template={templateMap.get(unit.unitTemplateId)}
                onToggleStatus={onToggleStatus}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-player content
// ---------------------------------------------------------------------------

function PlayerSupplyContent({
  player,
  playerResult,
  onToggleUnitStatus,
  onDeleteUnit,
  onBulkSetOutOfSupply,
}: {
  player: CampaignPlayer;
  playerResult: ReturnType<typeof computeSupplyResults>['byPlayer'][number];
  onToggleUnitStatus: (playerId: string, unitId: string, status: StrategicStatus) => void;
  onDeleteUnit: (playerId: string, unitId: string) => void;
  onBulkSetOutOfSupply: (playerId: string, unitIds: string[], value: boolean) => void;
}) {
  const [inSupplyExpanded, setInSupplyExpanded] = useState(false);

  const toggleStatus = (unitId: string, status: StrategicStatus) =>
    onToggleUnitStatus(player.id, unitId, status);
  const deleteUnit = (unitId: string) => onDeleteUnit(player.id, unitId);

  return (
    <div className="space-y-4">
      {/* Out of Supply section */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-400">
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs dark:bg-red-900/40">
            {playerResult.outOfSupplyFleets.length}
          </span>
          Out of Supply Fleets
        </h3>
        {playerResult.outOfSupplyFleets.length === 0 ? (
          <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400">
            All fleets are in supply.
          </p>
        ) : (
          <div className="space-y-2">
            {playerResult.outOfSupplyFleets.map(fleet => (
              <OOSFleetCard
                key={fleet.fleetId}
                fleet={fleet}
                player={player}
                onToggleStatus={toggleStatus}
                onDelete={deleteUnit}
                onMarkAllOOS={unitIds => onBulkSetOutOfSupply(player.id, unitIds, true)}
              />
            ))}
          </div>
        )}
      </div>

      {/* In Supply section (collapsible) */}
      <div>
        <button
          onClick={() => setInSupplyExpanded(e => !e)}
          className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400"
        >
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs dark:bg-green-900/40">
            {playerResult.inSupplyFleets.length}
          </span>
          In Supply Fleets
          <span className="text-xs text-gray-400">{inSupplyExpanded ? '−' : '+'}</span>
        </button>
        {inSupplyExpanded && (
          <div className="mt-2 flex flex-wrap gap-2">
            {playerResult.inSupplyFleets.map(fleet => (
              <span
                key={fleet.fleetId}
                className="rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400"
              >
                {fleet.fleetName}
                <span className="ml-1 text-gray-400">@ {fleet.systemName}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function SupplyPhaseView({
  players,
  map,
  systemStatuses,
  systemOwnership,
  diplomacyRelations,
  currentTurn,
  onToggleUnitStatus,
  onDeleteUnit,
  onBulkSetOutOfSupply,
  onClearInSupplyStatuses,
  onViewMap,
  onAdvance,
  onBack,
  canBack,
}: SupplyPhaseViewProps) {
  const [activePlayerIdx, setActivePlayerIdx] = useState(0);

  // Compute supply on mount; user can recompute after manual changes
  const initialResult = useMemo(
    () => computeSupplyResults(players, map, systemStatuses, systemOwnership, diplomacyRelations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // intentionally run only on mount
  );
  const [supplyResult, setSupplyResult] = useState<SupplyResult>(initialResult);

  // On mount: clear OOS and EX from every unit in an in-supply fleet
  useEffect(() => {
    const clearByPlayer = initialResult.byPlayer
      .map(r => ({
        playerId: r.playerId,
        unitIds: r.inSupplyFleets.flatMap(f => f.units.map(u => u.id)),
      }))
      .filter(r => r.unitIds.length > 0);
    if (clearByPlayer.length > 0) onClearInSupplyStatuses(clearByPlayer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRecompute = () => {
    setSupplyResult(
      computeSupplyResults(players, map, systemStatuses, systemOwnership, diplomacyRelations),
    );
  };

  const activePlayer = players[activePlayerIdx];
  const activeResult = supplyResult.byPlayer.find(r => r.playerId === activePlayer?.id);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* Top action bar */}
      <div className="flex items-center justify-between border-b border-gray-300 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <button
          onClick={onBack}
          disabled={!canBack}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ← Back
        </button>
        <span className="text-sm font-medium dark:text-gray-200">
          Supply Phase — Turn {currentTurn}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onViewMap}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Map View
          </button>
          <button
            onClick={handleRecompute}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Recompute
          </button>
          <button
            onClick={onAdvance}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          >
            Advance Phase →
          </button>
        </div>
      </div>

      {/* Player tabs */}
      <div className="flex border-b border-gray-300 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        {players.map((p, i) => {
          const result = supplyResult.byPlayer.find(r => r.playerId === p.id);
          const oosCount = result?.outOfSupplyFleets.length ?? 0;
          return (
            <button
              key={p.id}
              onClick={() => setActivePlayerIdx(i)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm ${
                i === activePlayerIdx
                  ? 'border-blue-500 font-semibold text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {p.teamColor && (
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.teamColor }} />
              )}
              <span>{p.name}</span>
              {oosCount > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
                  {oosCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activePlayer && activeResult ? (
          <PlayerSupplyContent
            player={activePlayer}
            playerResult={activeResult}
            onToggleUnitStatus={onToggleUnitStatus}
            onDeleteUnit={onDeleteUnit}
            onBulkSetOutOfSupply={onBulkSetOutOfSupply}
          />
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500">No player selected.</p>
        )}
      </div>
    </div>
  );
}
