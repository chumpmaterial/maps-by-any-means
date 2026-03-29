import { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignFleet, CampaignPlayer, CampaignUnit, CMFleet, EmpireUnit, GameMap, IndependentUnitList, TurnOrderEntry } from '../types';
import { SYSTEM_FLEET_NAMES } from '../types';
import { useConfirm } from '../hooks/useConfirm';
import { computeFleetBadges, getCarryCapacity, canJoinSystemFleet, resolveUnitTemplate } from '../utils/fleetUtils';
import { unitStatusKey, computeEffectiveStats } from '../utils/combatUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FleetManagerViewProps {
  players: CampaignPlayer[];
  map: GameMap;
  onClose: () => void;
  onMoveUnitToFleet: (playerId: string, unitId: string, newFleetId: string) => void;
  onAttachUnit: (playerId: string, dependentUnitId: string, carrierUnitId: string | null) => void;
  onMoveTemplateToFleet: (playerId: string, templateId: string, fromFleetKey: string, toFleetKey: string, systemId: string, count: number) => void;
  onCreateFleet: (playerId: string, name: string, systemId: string) => void;
  onDeleteUnits: (systemId: string, fleetKey: string, templateId: string, count: number) => void;
  onReorderFleet: (playerId: string, fromFleetId: string, targetFleetId: string) => void;
  onReorderUnit: (playerId: string, fleetId: string, unitId: string, dir: 'up' | 'down') => void;
  onEditFleet: (playerId: string, fleetId: string) => void;
  onMoveFleet: (playerId: string, fleetId: string) => void;
  cmFleets?: CMFleet[];
  independentLists?: IndependentUnitList[];
  onEditCMFleet?: (id: string) => void;
  onDeleteCMFleet?: (id: string) => void;
  onMoveCMFleet?: (id: string) => void;
  onUpdateCMFleetColor?: (id: string, color: string) => void;
  onDeleteCMUnits?: (fleetId: string, templateId: string, count: number) => void;
  onReorderCMUnit?: (fleetId: string, unitId: string, dir: 'up' | 'down') => void;
  onAttachCMUnit?: (fleetId: string, depUnitId: string, carrierId: string | null) => void;
  onMoveCMUnitToFleet?: (fromFleetId: string, unitId: string, toFleetId: string) => void;
  onMoveCMTemplateToFleet?: (fromFleetId: string, toFleetId: string, templateId: string, systemId: string, count: number) => void;
  turnOrders?: Record<string, TurnOrderEntry>;
  onUpdateOrders?: (key: string, entry: TurnOrderEntry) => void;
  onToggleUnitStatus?: (playerId: string, unitId: string, status: 'crippled' | 'outOfSupply' | 'captured' | 'exhausted') => void;
  initialPlayerId?: string;
  initialSystemId?: string;
}

interface FMDragState {
  unitId: string;
  playerId: string;
  fleetKey: string;
  systemId: string;
  validCarrierIds: Set<string>;
  warnCarrierIds: Set<string>;
  validFleetKeys: Set<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDependentUnit(template: EmpireUnit): boolean {
  return (
    template.category === 'Fighters' ||
    template.hullCode === 'AB' ||
    template.category === 'Troops' ||
    template.hullCode === 'OWP'
  );
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" className={className ?? 'h-4 w-2.5'} fill="currentColor">
      <circle cx="2.5" cy="2"  r="1.5" /><circle cx="7.5" cy="2"  r="1.5" />
      <circle cx="2.5" cy="6"  r="1.5" /><circle cx="7.5" cy="6"  r="1.5" />
      <circle cx="2.5" cy="10" r="1.5" /><circle cx="7.5" cy="10" r="1.5" />
      <circle cx="2.5" cy="14" r="1.5" /><circle cx="7.5" cy="14" r="1.5" />
    </svg>
  );
}

type StrategicStatus = 'crippled' | 'outOfSupply' | 'captured' | 'exhausted' | 'mothballed';

const UNIT_STATUS_CONFIG: Array<{ key: StrategicStatus; label: string; title: string; activeCls: string }> = [
  { key: 'crippled',    label: 'C',    title: 'Crippled',      activeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  { key: 'outOfSupply', label: 'OOS',  title: 'Out of Supply', activeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { key: 'captured',    label: 'CAP',  title: 'Captured',      activeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { key: 'exhausted',   label: 'EX',   title: 'Exhausted',     activeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  { key: 'mothballed',  label: 'MOTH', title: 'Mothballed',    activeCls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
];

// ---------------------------------------------------------------------------
// FMUnitRow
// ---------------------------------------------------------------------------

function FMUnitRow({
  unit,
  template,
  carriedUnits,
  getTemplate,
  fleetUnits,
  isWarning,
  dragState,
  dragOverCarrierId,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  onAttachDropdown,
  onDetach,
  onDetachCarried,
  onDragStart,
  onDragEnd,
  onSetDragOverCarrier,
  onDropOnCarrier,
  onToggleStatus,
}: {
  unit: CampaignUnit;
  template: EmpireUnit;
  carriedUnits: Array<{ unit: CampaignUnit; template: EmpireUnit }>;
  getTemplate: (id: string) => EmpireUnit | undefined;
  fleetUnits: CampaignUnit[];
  isWarning: boolean;
  dragState: FMDragState | null;
  dragOverCarrierId: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAttachDropdown: (carrierId: string) => void;
  onDetach: () => void;
  onDetachCarried: (depId: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSetDragOverCarrier: (id: string | null) => void;
  onDropOnCarrier: (carrierId: string) => void;
  onToggleStatus?: (status: StrategicStatus) => void;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const isCarried = !!unit.carriedById;
  const isDependent = isDependentUnit(template);

  const dropTargetKind = dragState
    ? dragState.validCarrierIds.has(unit.id)
      ? 'valid'
      : dragState.warnCarrierIds.has(unit.id)
      ? 'warn'
      : null
    : null;
  const isDraggingOver = dragOverCarrierId === unit.id;

  // Carriers in same fleet for the Attach dropdown
  const carriersInFleet = isDependent && !isCarried
    ? fleetUnits.filter(u => {
        if (u.id === unit.id) return false;
        const ct = getTemplate(u.unitTemplateId);
        if (!ct) return false;
        const cwt = fleetUnits
          .filter(cu => cu.carriedById === u.id && cu.id !== unit.id)
          .map(cu => {
            const t = getTemplate(cu.unitTemplateId);
            return t ? { unit: cu, template: t } : null;
          })
          .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
        const { allowedCategories } = getCarryCapacity(u, ct, cwt);
        return allowedCategories.length > 0;
      })
    : [];

  let borderClass = 'border-transparent';
  if (isDraggingOver) {
    borderClass =
      dropTargetKind === 'warn'
        ? 'border-amber-400 bg-amber-50/60 dark:border-amber-500 dark:bg-amber-950/20'
        : 'border-blue-400 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-900/20';
  } else if (dropTargetKind === 'warn') {
    borderClass = 'border-amber-200 dark:border-amber-800';
  } else if (dropTargetKind === 'valid') {
    borderClass = 'border-blue-200 dark:border-blue-800';
  } else if (isWarning) {
    borderClass = 'border-amber-400 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-950/20';
  }

  const handleRowDragStart = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    onDragStart();
  };

  return (
    <div
      draggable
      onDragStart={handleRowDragStart}
      onDragEnd={onDragEnd}
      className={`cursor-grab select-none rounded border-l-2 py-1.5 pl-2 pr-1 active:cursor-grabbing ${borderClass}`}
      onDragOver={dropTargetKind !== null ? (e) => { e.preventDefault(); onSetDragOverCarrier(unit.id); } : undefined}
      onDragLeave={dropTargetKind !== null ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onSetDragOverCarrier(null); } : undefined}
      onDrop={dropTargetKind !== null ? (e) => { e.preventDefault(); onDropOnCarrier(unit.id); } : undefined}
    >
      <div className="flex items-center gap-1.5">
        {/* Visual grip indicator */}
        <GripIcon className="h-4 w-2.5 flex-shrink-0 text-gray-300 dark:text-gray-600" />

        {/* Name + hull + stats — all inline, left-aligned */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
            {unit.name || template.name}
          </span>
          {template.hullCode !== 'N/A' && (
            <span className="text-xs text-gray-400 dark:text-gray-500">({template.hullCode})</span>
          )}
          {isCarried && (
            <span className="text-xs italic text-gray-400 dark:text-gray-500">carried</span>
          )}
          {(['dv', 'as', 'af', 'cr', 'cc'] as const).map(stat => {
            const v = template[stat];
            const display = v === '-' ? '—' : String(v);
            return (
              <span key={stat} className="text-xs text-gray-500 dark:text-gray-400">
                {stat.toUpperCase()}:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{display}</span>
              </span>
            );
          })}
        </div>

        {/* Action buttons — right side */}
        {isCarried && (
          <button
            onClick={onDetach}
            className="rounded px-1.5 py-0.5 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950"
          >
            Detach
          </button>
        )}

        {isDependent && !isCarried && carriersInFleet.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowAttachMenu(o => !o)}
              className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Attach ▾
            </button>
            {showAttachMenu && (
              <div className="absolute right-0 z-30 mt-1 min-w-[10rem] rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {carriersInFleet.map(c => {
                  const ct = getTemplate(c.unitTemplateId);
                  return ct ? (
                    <button
                      key={c.id}
                      onClick={() => { onAttachDropdown(c.id); setShowAttachMenu(false); }}
                      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      {ct.name}
                    </button>
                  ) : null;
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded px-0.5 text-[10px] leading-none text-gray-400 hover:text-gray-600 disabled:opacity-20 dark:hover:text-gray-300"
          >▲</button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded px-0.5 text-[10px] leading-none text-gray-400 hover:text-gray-600 disabled:opacity-20 dark:hover:text-gray-300"
          >▼</button>
        </div>

        <button
          onClick={() => setShowDeleteDialog(true)}
          className="rounded p-0.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400"
          title="Destroy unit"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M6 2a1 1 0 00-1 1H3a1 1 0 000 2h10a1 1 0 000-2h-2a1 1 0 00-1-1H6zM4 7a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1z" />
          </svg>
        </button>
      </div>

      {/* Strategic status badges */}
      {(unit.crippled || unit.outOfSupply || unit.captured || unit.exhausted || unit.mothballed || onToggleStatus) && (
        <div className="ml-6 mt-0.5 flex flex-wrap gap-1">
          {UNIT_STATUS_CONFIG.map(({ key, label, title, activeCls }) => {
            if (key === 'exhausted' && !template.traits.some(tr => tr.name === 'Supply')) return null;
            if (key === 'mothballed' && template.category !== 'Ships' && template.category !== 'Fighters') return null;
            const active = !!unit[key];
            if (!onToggleStatus && !active) return null;
            return onToggleStatus ? (
              <button
                key={key}
                onClick={() => onToggleStatus(key)}
                title={active ? `Remove ${title}` : `Mark ${title}`}
                className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  active
                    ? `${activeCls} hover:opacity-75`
                    : 'bg-gray-50 text-gray-400 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ) : (
              <span key={key} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium ${activeCls}`}>
                {label}
              </span>
            );
          })}
        </div>
      )}

      {template.traits.length > 0 && (
        <div className="ml-6 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {template.traits.map((tr, i) => (
            <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>
          ))}
        </div>
      )}

      {carriedUnits.length > 0 && (
        <div className="ml-6 mt-1 space-y-0.5 border-l border-gray-200 pl-2 dark:border-gray-700">
          {carriedUnits.map(({ unit: cu, template: ct }) => (
            <div key={cu.id} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
              <span className="flex-1">↳ {ct.name}{ct.hullCode !== 'N/A' ? ` (${ct.hullCode})` : ''}</span>
              <button
                onClick={() => onDetachCarried(cu.id)}
                className="rounded px-1 py-0.5 text-blue-400 hover:text-blue-600 dark:text-blue-500"
              >
                detach ×
              </button>
            </div>
          ))}
        </div>
      )}

      {showDeleteDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-2 text-sm font-semibold dark:text-white">Destroy Unit</h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              Destroy 1× {template.name}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete(); setShowDeleteDialog(false); }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Destroy
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FMFleetSection
// ---------------------------------------------------------------------------

function FMFleetSection({
  fleetKey,
  fleetName,
  fleet,
  player,
  allPlayers,
  unitPool,
  fleetColor,
  fleetUnits,
  systemId,
  condensedView,
  dragState,
  dragOverCarrierId,
  dragOverFleetKey,
  isNamed,
  onEditFleet,
  onMoveFleet,
  onColorChange,
  onReorderFleet,
  onAttachUnit,
  onDeleteUnit,
  onReorderUnit,
  onDragStartUnit,
  onDragEndUnit,
  onSetDragOverCarrier,
  onDropOnCarrier,
  onSetDragOverFleet,
  onDropOnFleet,
  onDropTemplateOnFleet,
  onToggleUnitStatus,
}: {
  fleetKey: string;
  fleetName: string;
  fleet: CampaignFleet | null;
  player?: CampaignPlayer;
  allPlayers?: CampaignPlayer[];
  unitPool?: EmpireUnit[];
  fleetColor?: string;
  fleetUnits: CampaignUnit[];
  systemId: string;
  condensedView: boolean;
  dragState: FMDragState | null;
  dragOverCarrierId: string | null;
  dragOverFleetKey: string | null;
  isNamed: boolean;
  onEditFleet?: () => void;
  onMoveFleet?: () => void;
  onColorChange?: (color: string) => void;
  onReorderFleet: (fromId: string, toId: string) => void;
  onAttachUnit: (depId: string, carrierId: string | null) => void;
  onDeleteUnit: (templateId: string, fleetKey: string, systemId: string, count: number) => void;
  onReorderUnit: (unitId: string, dir: 'up' | 'down') => void;
  onDragStartUnit: (unitId: string) => void;
  onDragEndUnit: () => void;
  onSetDragOverCarrier: (id: string | null) => void;
  onDropOnCarrier: (carrierId: string) => void;
  onSetDragOverFleet: (key: string | null) => void;
  onDropOnFleet: (fleetKey: string) => void;
  onDropTemplateOnFleet: (templateId: string, templateName: string, fromFleetKey: string, count: number) => void;
  onToggleUnitStatus?: (playerId: string, unitId: string, status: StrategicStatus) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [draggingTemplateId, setDraggingTemplateId] = useState<string | null>(null);
  const [isTemplateDragActive, setIsTemplateDragActive] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Close the actions menu when clicking outside it
  useEffect(() => {
    if (!showActionsMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showActionsMenu]);

  // Template lookup helper — uses unitPool when available (CM fleets), falls back to
  // resolveUnitTemplate (own empire → stolen → allPlayers' empires) so transferred,
  // stolen, and allied-build units all display correctly.
  const getT = (id: string): EmpireUnit | undefined =>
    unitPool?.find(et => et.id === id)
    ?? (player ? resolveUnitTemplate(player, id, allPlayers) : undefined);

  const isFleetDropTarget =
    dragState !== null &&
    dragState.validFleetKeys.has(fleetKey) &&
    dragState.fleetKey !== fleetKey &&
    dragState.systemId === systemId;
  const isDragOverFleet = dragOverFleetKey === fleetKey;

  // Combat totals
  let totalDV = 0, totalAS = 0, totalAF = 0, totalCost = 0;
  const factorTotals: Record<string, number> = {};
  for (const u of fleetUnits) {
    const t = getT(u.unitTemplateId);
    if (!t) continue;
    totalDV += parseFloat(String(t.dv)) || 0;
    totalAS += parseFloat(String(t.as)) || 0;
    totalAF += parseFloat(String(t.af)) || 0;
    totalCost += t.cost;
    for (const tr of t.traits) {
      if (tr.factor !== undefined && tr.factor > 0) {
        factorTotals[tr.name] = (factorTotals[tr.name] ?? 0) + tr.factor;
      }
    }
  }

  const badges = fleet && player ? computeFleetBadges(fleet, fleetUnits, player, allPlayers) : null;
  const hasActions = isNamed && (!!onEditFleet || !!onMoveFleet || !!onColorChange);

  // Warning unit IDs
  const fleetUnitIds = new Set(fleetUnits.map(u => u.id));
  const warnUnitIds = new Set<string>();
  for (const u of fleetUnits) {
    const t = getT(u.unitTemplateId);
    if (!t) continue;
    if (isDependentUnit(t) && (!u.carriedById || !fleetUnitIds.has(u.carriedById))) warnUnitIds.add(u.id);
    if (t.traits.some(tr => tr.name === 'Garrison')) warnUnitIds.add(u.id);
    if (t.category === 'Bases' && t.hullCode !== 'OWP') warnUnitIds.add(u.id);
  }
  for (const u of fleetUnits) {
    const ct = getT(u.unitTemplateId);
    if (!ct) continue;
    const carried = fleetUnits.filter(cu => cu.carriedById === u.id);
    if (carried.length === 0) continue;
    const cwt = carried.map(cu => {
      const t = getT(cu.unitTemplateId);
      return t ? { unit: cu, template: t } : null;
    }).filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
    const { remaining } = getCarryCapacity(u, ct, cwt);
    if (remaining < 0) warnUnitIds.add(u.id);
  }

  // Category breakdown for the fleet summary line
  const catOrder = ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'] as const;
  const catCounts: Partial<Record<string, number>> = {};
  for (const u of fleetUnits) {
    const t = getT(u.unitTemplateId);
    if (!t) continue;
    catCounts[t.category] = (catCounts[t.category] ?? 0) + 1;
  }
  const catSummaryParts = catOrder
    .filter(cat => (catCounts[cat] ?? 0) > 0)
    .map(cat => `${catCounts[cat]} ${cat}`);

  const crOf = (u: CampaignUnit) => {
    const t = getT(u.unitTemplateId);
    return !t || t.cr === '-' ? -1 : Number(t.cr);
  };
  const topLevelUnits = fleetUnits
    .filter(u => !u.carriedById || !fleetUnitIds.has(u.carriedById))
    .sort((a, b) => {
      const crDiff = crOf(b) - crOf(a);
      if (crDiff !== 0) return crDiff;
      const ta = getT(a.unitTemplateId);
      const tb = getT(b.unitTemplateId);
      return (ta?.name ?? '').localeCompare(tb?.name ?? '');
    });
  const carriedByCarrier = new Map<string, Array<{ unit: CampaignUnit; template: EmpireUnit }>>();
  for (const u of fleetUnits) {
    if (u.carriedById && fleetUnitIds.has(u.carriedById)) {
      if (!carriedByCarrier.has(u.carriedById)) carriedByCarrier.set(u.carriedById, []);
      const t = getT(u.unitTemplateId);
      if (t) carriedByCarrier.get(u.carriedById)!.push({ unit: u, template: t });
    }
  }

  // Condensed view: group all units (including carried) by template + status combo
  const condensedRows = (() => {
    const map = new Map<string, { template: EmpireUnit; statusKey: string; count: number; sampleUnit: CampaignUnit }>();
    for (const u of fleetUnits) {
      const t = getT(u.unitTemplateId);
      if (!t) continue;
      const sk = unitStatusKey(u);
      const rowKey = `${t.id}|${sk}`;
      if (!map.has(rowKey)) map.set(rowKey, { template: t, statusKey: sk, count: 0, sampleUnit: u });
      map.get(rowKey)!.count++;
    }
    const crOf = (t: EmpireUnit) => t.cr === '-' ? -1 : Number(t.cr);
    return [...map.values()].sort((a, b) => {
      const crDiff = crOf(b.template) - crOf(a.template);
      if (crDiff !== 0) return crDiff;
      const nameDiff = a.template.name.localeCompare(b.template.name);
      return nameDiff !== 0 ? nameDiff : a.statusKey.localeCompare(b.statusKey);
    });
  })();

  const handleHeaderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (e.dataTransfer.types.includes('application/fleet-reorder') && isNamed) {
      onSetDragOverFleet(fleetKey);
    } else if (e.dataTransfer.types.includes('application/template-move')) {
      setIsTemplateDragActive(true);
    } else if (isFleetDropTarget) {
      onSetDragOverFleet(fleetKey);
    }
  };

  const handleHeaderDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onSetDragOverFleet(null);
      // isTemplateDragActive cleared by outer card's onDragLeave
    }
  };

  const handleHeaderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSetDragOverFleet(null);
    setIsTemplateDragActive(false);
    if (e.dataTransfer.types.includes('application/fleet-reorder') && isNamed) {
      const raw = e.dataTransfer.getData('application/fleet-reorder');
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as { fleetId: string };
        if (data.fleetId !== fleetKey) onReorderFleet(data.fleetId, fleetKey);
      } catch { /* ignore */ }
      return;
    }
    if (e.dataTransfer.types.includes('application/template-move')) {
      const raw = e.dataTransfer.getData('application/template-move');
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as { templateId: string; templateName: string; fromFleetKey: string; count: number };
        if (data.fromFleetKey !== fleetKey) {
          onDropTemplateOnFleet(data.templateId, data.templateName, data.fromFleetKey, data.count);
        }
      } catch { /* ignore */ }
      return;
    }
    if (isFleetDropTarget) onDropOnFleet(fleetKey);
  };

  // Fleet body drop handler: catches template-move AND unit inter-fleet drops on the body area
  const handleBodyDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/template-move')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsTemplateDragActive(true);
    } else if (isFleetDropTarget) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      onSetDragOverFleet(fleetKey);
    }
  };

  const handleBodyDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/template-move')) {
      e.preventDefault();
      e.stopPropagation();
      setIsTemplateDragActive(false);
      const raw = e.dataTransfer.getData('application/template-move');
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as { templateId: string; templateName: string; fromFleetKey: string; count: number };
        if (data.fromFleetKey !== fleetKey) {
          onDropTemplateOnFleet(data.templateId, data.templateName, data.fromFleetKey, data.count);
        }
      } catch { /* ignore */ }
    } else if (isFleetDropTarget) {
      e.preventDefault();
      e.stopPropagation();
      onSetDragOverFleet(null);
      onDropOnFleet(fleetKey);
    }
  };

  // Outer card: clears both template and unit drag highlights on leave
  const handleOuterDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsTemplateDragActive(false);
      onSetDragOverFleet(null);
    }
  };

  const isAnyDropTarget = isFleetDropTarget;
  const headerBg = isDragOverFleet && isFleetDropTarget
    ? 'bg-blue-50 dark:bg-blue-900/20'
    : '';
  const headerBorder = isAnyDropTarget
    ? 'border border-blue-300 dark:border-blue-700'
    : 'border border-transparent';

  return (
    <div
      className={`mb-0 rounded transition-shadow ${isTemplateDragActive || (isDragOverFleet && isFleetDropTarget) ? 'ring-2 ring-blue-300 dark:ring-blue-600' : ''}`}
      onDragLeave={handleOuterDragLeave}
    >
      {/* Fleet header */}
      <div
        className={`rounded px-2 py-1.5 ${headerBg} ${headerBorder}`}
        onDragOver={handleHeaderDragOver}
        onDragLeave={handleHeaderDragLeave}
        onDrop={handleHeaderDrop}
      >
        {/* Row 1: name + actions menu */}
        <div className="flex items-center gap-2">
          {isNamed && fleet && (
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/fleet-reorder', JSON.stringify({ fleetId: fleet.id }));
              }}
              onDragEnd={() => onSetDragOverFleet(null)}
              className="flex-shrink-0 cursor-grab select-none text-gray-300 hover:text-gray-500 active:cursor-grabbing dark:text-gray-600 dark:hover:text-gray-400"
              title="Drag to reorder fleets"
            >
              <GripIcon />
            </div>
          )}

          {(player?.teamColor ?? fleetColor) && (
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: player?.teamColor ?? fleetColor }} />
          )}

          <button
            onClick={() => setExpanded(e => !e)}
            className="min-w-0 flex-1 text-left"
          >
            <div className="text-sm font-medium dark:text-gray-100">
              {fleetName}
              <span className="ml-1 text-gray-400 dark:text-gray-600">{expanded ? '−' : '+'}</span>
            </div>
          </button>

          {hasActions && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                onClick={() => setShowActionsMenu(o => !o)}
                title="Fleet actions"
                className="rounded px-1.5 py-0.5 text-sm leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                ···
              </button>
              {showActionsMenu && (
                <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded border border-gray-200 bg-white p-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  {onEditFleet && (
                    <button
                      onClick={() => { onEditFleet(); setShowActionsMenu(false); }}
                      className="w-full rounded px-3 py-1.5 text-left text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                    >
                      Edit Fleet
                    </button>
                  )}
                  {onMoveFleet && (
                    <button
                      onClick={() => { onMoveFleet(); setShowActionsMenu(false); }}
                      className="w-full rounded px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      Move Fleet
                    </button>
                  )}
                  {onColorChange && (
                    <div className="mt-1 border-t border-gray-100 pt-1.5 dark:border-gray-700">
                      <p className="mb-1 px-2 text-xs text-gray-500 dark:text-gray-400">Fleet Color</p>
                      <div className="flex flex-wrap gap-1 px-2">
                        {['#6b7280','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#ffffff','#000000'].map(c => (
                          <button
                            key={c}
                            onClick={() => { onColorChange(c); setShowActionsMenu(false); }}
                            className={`h-5 w-5 rounded-full border-2 ${(fleetColor ?? '') === c ? 'border-blue-500' : 'border-transparent hover:border-gray-400'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                        <div className="relative">
                          <button
                            onClick={() => colorInputRef.current?.click()}
                            title="Custom color…"
                            className="h-5 w-5 rounded-full border-2 border-gray-300 hover:border-gray-500"
                            style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                          />
                          <input
                            ref={colorInputRef}
                            type="color"
                            value={fleetColor ?? '#6b7280'}
                            onChange={e => { onColorChange(e.target.value); }}
                            className="absolute opacity-0"
                            style={{ width: 0, height: 0, top: 0, left: 0 }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2: summary + badges + combat stats */}
        {fleetUnits.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-xs">
            <span className="text-gray-400 dark:text-gray-500">
              {fleetUnits.length} unit{fleetUnits.length !== 1 ? 's' : ''} · {totalCost} EP
              {catSummaryParts.length > 0 && ` · ${catSummaryParts.join(' · ')}`}
            </span>
            {badges && (
              <>
                {badges.isFast && <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Fast</span>}
                {badges.isCivilian && <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">Civilian</span>}
                {badges.isScout && <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Scout</span>}
                {fleet?.movedThisTurn && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Moved</span>}
              </>
            )}
            <span className="ml-auto shrink-0 text-gray-500 dark:text-gray-400">
              DV:<span className="font-semibold text-gray-700 dark:text-gray-200">{totalDV}</span>
              {' '}AS:<span className="font-semibold text-gray-700 dark:text-gray-200">{totalAS}</span>
              {' '}AF:<span className="font-semibold text-gray-700 dark:text-gray-200">{totalAF}</span>
              {Object.entries(factorTotals).map(([name, total]) => (
                <span key={name} className="ml-2">{name}:<span className="font-semibold text-gray-700 dark:text-gray-200">{total}</span></span>
              ))}
            </span>
          </div>
        )}
      </div>

      {/* Fleet body — also a template-move drop target */}
      {expanded && (
        <div
          className="ml-4 mt-1 space-y-1"
          onDragOver={handleBodyDragOver}
          onDrop={handleBodyDrop}
        >
          {fleetUnits.length === 0 ? (
            <p className="py-1 text-xs italic text-gray-400 dark:text-gray-500">Empty fleet</p>
          ) : condensedView ? (
            /* Condensed mode: grid layout — fixed columns so stats align across all rows */
            (() => {
              // Shared column template: grip | name (fixed) | ×count | DV AS AF CR CC | traits
              // DV/AS/AF wider (3rem) to fit "4 (8)" modified-stat format; CR/CC unchanged
              const cols = '0.75rem 10rem 1.75rem 3rem 3rem 3rem 1.25rem 1.25rem 1fr';
              return (
                <>
                  {/* Column headers — same grid template as data rows */}
                  <div
                    className="mb-0.5 grid items-center gap-x-1 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500"
                    style={{ gridTemplateColumns: cols }}
                  >
                    <div />
                    <div>Class</div>
                    <div className="text-right">×</div>
                    <div className="text-right">DV</div>
                    <div className="text-right">AS</div>
                    <div className="text-right">AF</div>
                    <div className="text-right">CR</div>
                    <div className="text-right">CC</div>
                    <div className="pl-2">Traits</div>
                  </div>
                  {condensedRows.map(({ template: t, statusKey: sk, count, sampleUnit }) => {
                    const eff = computeEffectiveStats(sampleUnit, t, undefined, null);
                    const fmtDV = eff.dv !== t.dv ? `${eff.dv} (${t.dv})` : String(t.dv);
                    const fmtAS = t.as === '-' ? '—' : eff.as !== (t.as as number) ? `${eff.as} (${t.as})` : String(t.as);
                    const fmtAF = t.af === '-' ? '—' : eff.af !== (t.af as number) ? `${eff.af} (${t.af})` : String(t.af);
                    return (
                      <div
                        key={`${t.id}|${sk}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/template-move', JSON.stringify({
                            templateId: t.id,
                            templateName: t.name,
                            fromFleetKey: fleetKey,
                            count,
                          }));
                          setDraggingTemplateId(t.id);
                        }}
                        onDragEnd={() => setDraggingTemplateId(null)}
                        className={`grid cursor-grab select-none items-center gap-x-1 rounded py-0.5 px-1 active:cursor-grabbing ${
                          draggingTemplateId === t.id ? 'opacity-40' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                        style={{ gridTemplateColumns: cols }}
                        title="Drag onto another fleet to move"
                      >
                        <GripIcon className="h-3.5 w-3 text-gray-300 dark:text-gray-600" />
                        <div className="flex min-w-0 items-center gap-1">
                          {(() => {
                            const iterMatch = t.name.match(/^(.*?)(-[IVX]+|-[EI])$/);
                            return iterMatch ? (
                              <>
                                <span className="truncate text-sm text-gray-800 dark:text-gray-100">{iterMatch[1]}</span>
                                <span className="shrink-0 text-sm text-gray-800 dark:text-gray-100">{iterMatch[2]}</span>
                              </>
                            ) : (
                              <span className="truncate text-sm text-gray-800 dark:text-gray-100">{t.name}</span>
                            );
                          })()}
                          {t.hullCode !== 'N/A' && (
                            <span className="shrink-0 text-sm text-gray-800 dark:text-gray-100">({t.hullCode})</span>
                          )}
                          {sk && (
                            <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-red-600 dark:text-red-400">({sk})</span>
                          )}
                        </div>
                        <span className="text-right text-xs font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
                        <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{fmtDV}</span>
                        <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{fmtAS}</span>
                        <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{fmtAF}</span>
                        <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{t.cr === '-' ? '—' : String(t.cr)}</span>
                        <span className="text-right text-xs tabular-nums text-gray-600 dark:text-gray-300">{t.cc === '-' ? '—' : String(t.cc)}</span>
                        <span className="pl-2 text-xs text-gray-400 dark:text-gray-500">
                          {t.traits.map((tr, i) => (
                            <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </>
              );
            })()
          ) : (
            /* Detailed mode: individual unit rows */
            topLevelUnits.map((u, idx) => {
              const t = getT(u.unitTemplateId);
              if (!t) return null;
              return (
                <FMUnitRow
                  key={u.id}
                  unit={u}
                  template={t}
                  carriedUnits={carriedByCarrier.get(u.id) ?? []}
                  getTemplate={getT}
                  fleetUnits={fleetUnits}
                  isWarning={warnUnitIds.has(u.id)}
                  dragState={dragState}
                  dragOverCarrierId={dragOverCarrierId}
                  canMoveUp={idx > 0 && isNamed}
                  canMoveDown={idx < topLevelUnits.length - 1 && isNamed}
                  onMoveUp={() => onReorderUnit(u.id, 'up')}
                  onMoveDown={() => onReorderUnit(u.id, 'down')}
                  onDelete={() => onDeleteUnit(t.id, fleetKey, systemId, 1)}
                  onAttachDropdown={(carrierId) => onAttachUnit(u.id, carrierId)}
                  onDetach={() => onAttachUnit(u.id, null)}
                  onDetachCarried={(depId) => onAttachUnit(depId, null)}
                  onDragStart={() => onDragStartUnit(u.id)}
                  onDragEnd={onDragEndUnit}
                  onSetDragOverCarrier={onSetDragOverCarrier}
                  onDropOnCarrier={onDropOnCarrier}
                  onToggleStatus={onToggleUnitStatus && player ? (status) => onToggleUnitStatus(player.id, u.id, status) : undefined}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const CM_TAB_ID = '__cm__';

export function FleetManagerView({
  players,
  map,
  onClose,
  onMoveUnitToFleet,
  onAttachUnit,
  onMoveTemplateToFleet,
  onCreateFleet,
  onDeleteUnits,
  onReorderFleet,
  onReorderUnit,
  onEditFleet,
  onMoveFleet,
  cmFleets = [],
  independentLists = [],
  onEditCMFleet,
  onDeleteCMFleet: _onDeleteCMFleet,
  onMoveCMFleet,
  onUpdateCMFleetColor,
  onDeleteCMUnits,
  onReorderCMUnit,
  onAttachCMUnit,
  onMoveCMUnitToFleet,
  onMoveCMTemplateToFleet,
  turnOrders,
  onUpdateOrders,
  onToggleUnitStatus,
  initialPlayerId,
  initialSystemId,
}: FleetManagerViewProps) {
  const confirm = useConfirm();

  const [selectedPlayerId, setSelectedPlayerId] = useState(() => initialPlayerId ?? players[0]?.id ?? '');
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(() => {
    if (!initialSystemId) return new Set();
    const key = initialPlayerId === CM_TAB_ID ? `cm:${initialSystemId}` : initialSystemId;
    return new Set([key]);
  });
  const [condensedView, setCondensedView] = useState(true);
  const [dragState, setDragState] = useState<FMDragState | null>(null);
  const [dragOverCarrierId, setDragOverCarrierId] = useState<string | null>(null);
  const [dragOverFleetKey, setDragOverFleetKey] = useState<string | null>(null);
  const [creatingFleetInSystem, setCreatingFleetInSystem] = useState<string | null>(null);
  const [newFleetName, setNewFleetName] = useState('');
  const [pendingTemplateMove, setPendingTemplateMove] = useState<{
    templateId: string;
    templateName: string;
    fromFleetKey: string;
    toFleetKey: string;
    toFleetName: string;
    systemId: string;
    maxCount: number;
    isCM?: boolean;
  } | null>(null);
  const [templateMoveCount, setTemplateMoveCount] = useState(1);
  const [fleetOrderChecks, setFleetOrderChecks] = useState<Array<{ checked: boolean; xed: boolean }>>([]);
  const [isOrdersExpanded, setIsOrdersExpanded] = useState(true);
  const [isEditingOrders, setIsEditingOrders] = useState(false);

  // All indie units (for CM fleet template lookups)
  const allIndieUnits = independentLists.flatMap(l => l.units);

  const isCMTab = selectedPlayerId === CM_TAB_ID;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const newFleetInputRef = useRef<HTMLInputElement>(null);
  const scrollSpeedRef = useRef(0);
  const scrollAnimRef = useRef<number | null>(null);

  const player = players.find(p => p.id === selectedPlayerId) ?? players[0];

  const playerSystems = useMemo(() => {
    if (!player) return [];

    type SysEntry = {
      systemId: string;
      namedFleets: CampaignFleet[];
      systemFleetKeys: Set<string>;
      categoryMap: Record<string, number>;
    };
    const sysMap = new Map<string, SysEntry>();

    const getOrCreate = (sid: string): SysEntry => {
      if (!sysMap.has(sid)) {
        sysMap.set(sid, { systemId: sid, namedFleets: [], systemFleetKeys: new Set(), categoryMap: {} });
      }
      return sysMap.get(sid)!;
    };

    for (const fleet of player.fleets ?? []) {
      if (!fleet.systemId) continue;
      const sysEntry = getOrCreate(fleet.systemId);
      sysEntry.namedFleets.push(fleet);
      // Any system with a named fleet always shows On-Planet (mirrors PropertyPanel behaviour)
      sysEntry.systemFleetKeys.add('On-Planet');
    }

    for (const unit of player.units) {
      if (!unit.systemId) continue;
      const entry = getOrCreate(unit.systemId);
      const template = resolveUnitTemplate(player, unit.unitTemplateId, players);
      if (template) {
        entry.categoryMap[template.category] = (entry.categoryMap[template.category] ?? 0) + 1;
      }
      const fleetKey = unit.fleetId ?? 'Unassigned';
      const isSystemFleet = (SYSTEM_FLEET_NAMES as readonly string[]).includes(fleetKey) || !unit.fleetId;
      if (isSystemFleet) entry.systemFleetKeys.add(fleetKey);
    }

    const ownedIds = new Set([
      ...(player.ownedSystemIds ?? []),
      ...(player.homeworldId ? [player.homeworldId] : []),
    ]);
    const entries = [...sysMap.values()];
    entries.sort((a, b) => {
      const aOwned = ownedIds.has(a.systemId);
      const bOwned = ownedIds.has(b.systemId);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      const aName = map.systems.find(s => s.id === a.systemId)?.name ?? a.systemId;
      const bName = map.systems.find(s => s.id === b.systemId)?.name ?? b.systemId;
      return aName.localeCompare(bName);
    });
    return entries;
  }, [player, map]);

  const toggleSystem = (systemId: string) => {
    setExpandedSystems(prev => {
      const next = new Set(prev);
      next.has(systemId) ? next.delete(systemId) : next.add(systemId);
      return next;
    });
  };

  // --- Auto-scroll during drag ---

  const startDragScroll = () => {
    const tick = () => {
      if (scrollContainerRef.current && scrollSpeedRef.current !== 0) {
        scrollContainerRef.current.scrollTop += scrollSpeedRef.current;
      }
      scrollAnimRef.current = requestAnimationFrame(tick);
    };
    scrollAnimRef.current = requestAnimationFrame(tick);
  };

  const stopDragScroll = () => {
    if (scrollAnimRef.current !== null) {
      cancelAnimationFrame(scrollAnimRef.current);
      scrollAnimRef.current = null;
    }
    scrollSpeedRef.current = 0;
  };

  const handleScrollAreaDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragState) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const threshold = 80;
    const mouseY = e.clientY;
    if (mouseY < rect.top + threshold) {
      const ratio = Math.max(0, 1 - (mouseY - rect.top) / threshold);
      scrollSpeedRef.current = -(2 + 13 * ratio);
    } else if (mouseY > rect.bottom - threshold) {
      const ratio = Math.max(0, 1 - (rect.bottom - mouseY) / threshold);
      scrollSpeedRef.current = 2 + 13 * ratio;
    } else {
      scrollSpeedRef.current = 0;
    }
  };

  // --- New fleet creation ---

  const handleStartCreateFleet = (systemId: string) => {
    setCreatingFleetInSystem(systemId);
    setNewFleetName('');
    setTimeout(() => newFleetInputRef.current?.focus(), 0);
  };

  const handleConfirmCreateFleet = () => {
    if (!creatingFleetInSystem || !newFleetName.trim() || !player) return;
    onCreateFleet(player.id, newFleetName.trim(), creatingFleetInSystem);
    setCreatingFleetInSystem(null);
    setNewFleetName('');
  };

  const handleCancelCreateFleet = () => {
    setCreatingFleetInSystem(null);
    setNewFleetName('');
  };

  const handleDropTemplateOnFleet = (
    templateId: string,
    templateName: string,
    fromFleetKey: string,
    toFleetKey: string,
    toFleetName: string,
    systemId: string,
    count: number,
    isCM?: boolean,
  ) => {
    setTemplateMoveCount(1);
    setPendingTemplateMove({ templateId, templateName, fromFleetKey, toFleetKey, toFleetName, systemId, maxCount: count, isCM });
  };

  const confirmTemplateMove = () => {
    if (!pendingTemplateMove) return;
    if (pendingTemplateMove.isCM) {
      onMoveCMTemplateToFleet?.(
        pendingTemplateMove.fromFleetKey,
        pendingTemplateMove.toFleetKey,
        pendingTemplateMove.templateId,
        pendingTemplateMove.systemId,
        templateMoveCount,
      );
    } else {
      if (!player) return;
      onMoveTemplateToFleet(
        player.id,
        pendingTemplateMove.templateId,
        pendingTemplateMove.fromFleetKey,
        pendingTemplateMove.toFleetKey,
        pendingTemplateMove.systemId,
        templateMoveCount,
      );
    }
    setPendingTemplateMove(null);
  };

  // --- Drag handlers ---

  const startDrag = (unitId: string, playerId: string) => {
    const p = players.find(pp => pp.id === playerId);
    if (!p) return;
    const unit = p.units.find(u => u.id === unitId);
    if (!unit?.systemId) return;
    const template = resolveUnitTemplate(p, unit.unitTemplateId, players);
    if (!template) return;

    const fleetKey = unit.fleetId ?? 'Unassigned';
    const fleetUnits = p.units.filter(u => u.systemId === unit.systemId && (u.fleetId ?? 'Unassigned') === fleetKey);

    const validCarrierIds = new Set<string>();
    const warnCarrierIds = new Set<string>();
    for (const u of fleetUnits) {
      if (u.id === unitId) continue;
      const ct = resolveUnitTemplate(p, u.unitTemplateId, players);
      if (!ct) continue;
      const cwt = fleetUnits
        .filter(cu => cu.carriedById === u.id && cu.id !== unitId)
        .map(cu => {
          const t = resolveUnitTemplate(p, cu.unitTemplateId, players);
          return t ? { unit: cu, template: t } : null;
        })
        .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
      const { allowedCategories, remaining } = getCarryCapacity(u, ct, cwt);
      if (allowedCategories.length === 0) continue;
      const cost = template.hullCode === 'OWP' ? 2 : 1;
      if (allowedCategories.includes(template.category) && remaining >= cost) {
        validCarrierIds.add(u.id);
      } else {
        warnCarrierIds.add(u.id);
      }
    }

    const validFleetKeys = new Set<string>();
    for (const f of p.fleets ?? []) {
      if (f.systemId === unit.systemId && f.id !== fleetKey) validFleetKeys.add(f.id);
    }
    for (const sfn of SYSTEM_FLEET_NAMES) {
      if (sfn !== fleetKey && canJoinSystemFleet(sfn, template.category, template.name)) {
        validFleetKeys.add(sfn);
      }
    }

    setDragState({ unitId, playerId, fleetKey, systemId: unit.systemId, validCarrierIds, warnCarrierIds, validFleetKeys });
    startDragScroll();
  };

  const startCMDrag = (unitId: string, cmFleetId: string) => {
    const fleet = cmFleets.find(f => f.id === cmFleetId);
    if (!fleet) return;
    const unit = fleet.units.find(u => u.id === unitId);
    if (!unit?.systemId) return;
    const template = allIndieUnits.find(t => t.id === unit.unitTemplateId);
    if (!template) return;

    const fleetKey = cmFleetId;
    const fleetUnitsHere = fleet.units;

    const validCarrierIds = new Set<string>();
    const warnCarrierIds = new Set<string>();
    for (const u of fleetUnitsHere) {
      if (u.id === unitId) continue;
      const ct = allIndieUnits.find(et => et.id === u.unitTemplateId);
      if (!ct) continue;
      const cwt = fleetUnitsHere
        .filter(cu => cu.carriedById === u.id && cu.id !== unitId)
        .map(cu => {
          const t = allIndieUnits.find(et => et.id === cu.unitTemplateId);
          return t ? { unit: cu, template: t } : null;
        })
        .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
      const { allowedCategories, remaining } = getCarryCapacity(u, ct, cwt);
      if (allowedCategories.length === 0) continue;
      const cost = template.hullCode === 'OWP' ? 2 : 1;
      if (allowedCategories.includes(template.category) && remaining >= cost) {
        validCarrierIds.add(u.id);
      } else {
        warnCarrierIds.add(u.id);
      }
    }

    // Valid fleet targets: other CM fleets at the same system
    const validFleetKeys = new Set<string>();
    for (const f of cmFleets) {
      if (f.id !== cmFleetId && f.systemId === fleet.systemId) {
        validFleetKeys.add(f.id);
      }
    }

    setDragState({ unitId, playerId: '__cm__', fleetKey, systemId: fleet.systemId ?? '', validCarrierIds, warnCarrierIds, validFleetKeys });
    startDragScroll();
  };

  const endDrag = () => {
    setDragState(null);
    setDragOverCarrierId(null);
    setDragOverFleetKey(null);
    stopDragScroll();
  };

  const handleDropOnCarrier = async (targetCarrierId: string) => {
    if (!dragState) return;

    // CM fleet carrier drop
    if (dragState.playerId === '__cm__') {
      const cmFleet = cmFleets.find(f => f.id === dragState.fleetKey);
      if (!cmFleet) { endDrag(); return; }
      const draggingUnit = cmFleet.units.find(u => u.id === dragState.unitId);
      const draggingTmpl = draggingUnit ? allIndieUnits.find(t => t.id === draggingUnit.unitTemplateId) : null;
      const targetUnit = cmFleet.units.find(u => u.id === targetCarrierId);
      const targetTmpl = targetUnit ? allIndieUnits.find(t => t.id === targetUnit.unitTemplateId) : null;
      if (!draggingUnit || !draggingTmpl || !targetUnit || !targetTmpl) { endDrag(); return; }
      const cwt = cmFleet.units
        .filter(cu => cu.carriedById === targetCarrierId && cu.id !== dragState.unitId)
        .map(cu => {
          const t = allIndieUnits.find(et => et.id === cu.unitTemplateId);
          return t ? { unit: cu, template: t } : null;
        })
        .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
      const { remaining, allowedCategories } = getCarryCapacity(targetUnit, targetTmpl, cwt);
      endDrag();
      const cost = draggingTmpl.hullCode === 'OWP' ? 2 : 1;
      const violations: string[] = [];
      if (!allowedCategories.includes(draggingTmpl.category)) {
        const allowed = allowedCategories.length > 0 ? allowedCategories.join(', ') : 'nothing';
        violations.push(`${targetTmpl.name} is not designed to carry ${draggingTmpl.category} units (it can carry: ${allowed}).`);
      }
      if (remaining < cost) {
        const slots = remaining <= 0 ? 'no remaining slots' : `only ${remaining} slot${remaining === 1 ? '' : 's'} remaining (${cost} needed)`;
        violations.push(`${targetTmpl.name} does not have enough carrying capacity (${slots}).`);
      }
      if (violations.length > 0) {
        const confirmed = await confirm({
          title: 'Attach Unit — Rule Violation',
          message: (
            <div>
              <ul className="list-disc space-y-1 pl-4">
                {violations.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
              <p className="mt-2 font-medium">Attach anyway?</p>
            </div>
          ),
          confirmLabel: 'Attach Anyway',
          variant: 'confirm',
        });
        if (!confirmed) return;
      }
      onAttachCMUnit?.(dragState.fleetKey, dragState.unitId, targetCarrierId);
      return;
    }

    const p = players.find(pp => pp.id === dragState.playerId);
    if (!p) { endDrag(); return; }

    const fleetUnits = p.units.filter(u =>
      u.systemId === dragState.systemId && (u.fleetId ?? 'Unassigned') === dragState.fleetKey
    );

    const draggingUnit = fleetUnits.find(u => u.id === dragState.unitId);
    const draggingTmpl = draggingUnit ? resolveUnitTemplate(p, draggingUnit.unitTemplateId, players) : null;
    const targetUnit = fleetUnits.find(u => u.id === targetCarrierId);
    const targetTmpl = targetUnit ? resolveUnitTemplate(p, targetUnit.unitTemplateId, players) : null;

    if (!draggingUnit || !draggingTmpl || !targetUnit || !targetTmpl) { endDrag(); return; }

    const unitIdToAttach = dragState.unitId;
    const cwt = fleetUnits
      .filter(cu => cu.carriedById === targetCarrierId && cu.id !== dragState.unitId)
      .map(cu => {
        const t = resolveUnitTemplate(p, cu.unitTemplateId, players);
        return t ? { unit: cu, template: t } : null;
      })
      .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
    const { remaining, allowedCategories } = getCarryCapacity(targetUnit, targetTmpl, cwt);

    endDrag();

    const cost = draggingTmpl.hullCode === 'OWP' ? 2 : 1;
    const violations: string[] = [];
    if (!allowedCategories.includes(draggingTmpl.category)) {
      const allowed = allowedCategories.length > 0 ? allowedCategories.join(', ') : 'nothing';
      violations.push(`${targetTmpl.name} is not designed to carry ${draggingTmpl.category} units (it can carry: ${allowed}).`);
    }
    if (remaining < cost) {
      const slots = remaining <= 0
        ? 'no remaining slots'
        : `only ${remaining} slot${remaining === 1 ? '' : 's'} remaining (${cost} needed)`;
      violations.push(`${targetTmpl.name} does not have enough carrying capacity (${slots}).`);
    }

    if (violations.length > 0) {
      const confirmed = await confirm({
        title: 'Attach Unit — Rule Violation',
        message: (
          <div>
            <ul className="list-disc space-y-1 pl-4">
              {violations.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
            <p className="mt-2 font-medium">Attach anyway?</p>
          </div>
        ),
        confirmLabel: 'Attach Anyway',
        variant: 'confirm',
      });
      if (!confirmed) return;
    }

    onAttachUnit(dragState.playerId, unitIdToAttach, targetCarrierId);
  };

  const handleDropOnFleet = (targetFleetKey: string) => {
    if (!dragState) return;
    if (dragState.playerId === '__cm__') {
      onMoveCMUnitToFleet?.(dragState.fleetKey, dragState.unitId, targetFleetKey);
    } else {
      onMoveUnitToFleet(dragState.playerId, dragState.unitId, targetFleetKey);
    }
    endDrag();
  };

  // Fleet Deployment Orders for the active tab
  const ordersText = isCMTab
    ? (turnOrders?.['cm']?.fleetDeployment ?? '')
    : (turnOrders?.[player?.id ?? '']?.fleetDeployment ?? '');
  const ordersLabel = isCMTab ? 'Fleet Deployment Notes' : 'Fleet Deployment Orders';
  const ordersLines = ordersText.split('\n').filter(l => l.trim());

  // Sync check array and reset editing state when tab or orders change
  useEffect(() => {
    const lines = (isCMTab
      ? (turnOrders?.['cm']?.fleetDeployment ?? '')
      : (turnOrders?.[player?.id ?? '']?.fleetDeployment ?? '')
    ).split('\n').filter(l => l.trim());
    setFleetOrderChecks(lines.map(() => ({ checked: false, xed: false })));
    setIsEditingOrders(false);
  }, [selectedPlayerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!player) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ← Close
          </button>
          <h1 className="text-base font-semibold dark:text-gray-100">Fleet Manager</h1>
          <button
            onClick={() => setCondensedView(v => !v)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              condensedView
                ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            }`}
            title={condensedView ? 'Switch to detailed view' : 'Switch to condensed view'}
          >
            {condensedView ? 'Detailed' : 'Condensed'}
          </button>
        </div>

        {/* Player tabs + CM tab */}
        <div className="flex items-center gap-1">
          {players.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedPlayerId(p.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                p.id === selectedPlayerId
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {p.teamColor && (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
              )}
              <span className="flex flex-col items-start leading-tight">
                <span>{p.name}</span>
                <span className="text-[11px] font-normal opacity-70">{p.empire.name}</span>
              </span>
            </button>
          ))}
          <button
            onClick={() => setSelectedPlayerId(CM_TAB_ID)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
              isCMTab
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-400" />
            CM
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
        onDragOver={handleScrollAreaDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) scrollSpeedRef.current = 0; }}
      >
        {/* Fleet Deployment Orders / Notes — always sticky at top */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          {/* Header row: collapse toggle + label + Edit/Done */}
          <div className="group flex items-center gap-2 px-6 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800">
            <button
              onClick={() => setIsOrdersExpanded(v => !v)}
              className="flex flex-1 items-center gap-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-200"
            >
              <span className={`text-xs transition-transform ${isOrdersExpanded ? 'rotate-90' : ''}`}>▶</span>
              <span>{ordersLabel}</span>
            </button>
            {!isCMTab && onUpdateOrders && (
              isEditingOrders ? (
                <button
                  onClick={() => setIsEditingOrders(false)}
                  className="rounded border border-blue-400 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                >
                  Done
                </button>
              ) : (
                <button
                  onClick={() => { setIsEditingOrders(true); setIsOrdersExpanded(true); }}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  Edit
                </button>
              )
            )}
          </div>

          {/* Content (when expanded) */}
          {isOrdersExpanded && (
            <div className="px-6 pb-3">
              {isCMTab ? (
                /* CM tab: always-editable text area */
                <textarea
                  className="h-20 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  value={ordersText}
                  onChange={e => {
                    const cur = turnOrders?.['cm'] ?? { fleetDeployment: '', intel: '', movement: '', diplomatic: '', construction: '', investment: '' };
                    onUpdateOrders?.('cm', { ...cur, fleetDeployment: e.target.value });
                  }}
                  placeholder="Fleet deployment notes…"
                />
              ) : isEditingOrders ? (
                /* Player tab — edit mode */
                <textarea
                  className="h-24 w-full resize-y rounded border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  value={ordersText}
                  onChange={e => {
                    const key = player?.id ?? '';
                    const cur = turnOrders?.[key] ?? { fleetDeployment: '', intel: '', movement: '', diplomatic: '', construction: '', investment: '' };
                    onUpdateOrders?.(key, { ...cur, fleetDeployment: e.target.value });
                  }}
                  placeholder="One order per line…"
                  autoFocus
                />
              ) : ordersLines.length === 0 ? (
                /* Player tab — no orders yet */
                <p className="text-sm italic text-gray-400 dark:text-gray-500">No fleet deployment orders entered.</p>
              ) : (
                /* Player tab — checklist view */
                <ul className="space-y-1.5">
                  {ordersLines.map((line, i) => {
                    const chk = fleetOrderChecks[i] ?? { checked: false, xed: false };
                    return (
                      <li key={i} className="flex min-w-0 items-start gap-2">
                        <button
                          onClick={() => setFleetOrderChecks(prev => prev.map((c, j) =>
                            j === i ? { checked: !c.checked, xed: false } : c
                          ))}
                          disabled={chk.xed}
                          title={chk.xed ? 'Cannot check — X is active' : chk.checked ? 'Uncheck' : 'Check'}
                          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                            chk.xed ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30'
                          } ${chk.checked ? 'text-green-600' : 'text-gray-400 dark:text-gray-500'}`}
                        >
                          {chk.checked ? (
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
                        <button
                          onClick={() => setFleetOrderChecks(prev => prev.map((c, j) =>
                            j === i ? { xed: !c.xed, checked: false } : c
                          ))}
                          disabled={chk.checked}
                          title={chk.checked ? 'Cannot X — checkbox is active' : chk.xed ? 'Remove X' : 'Mark as failed'}
                          className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-base leading-none ${
                            chk.checked ? 'cursor-not-allowed opacity-30' : 'cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30'
                          } ${chk.xed ? 'text-red-600' : 'text-gray-400 dark:text-gray-500'}`}
                        >
                          {chk.xed ? (
                            <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                              <rect width="16" height="16" rx="2" fill="currentColor" />
                              <path d="M5 5l6 6M11 5l-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 16 16" className="h-4 w-4 flex-shrink-0" aria-hidden>
                              <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                          )}
                        </button>
                        <span className={`min-w-0 flex-1 break-words text-sm ${
                          chk.checked ? 'text-green-600 line-through dark:text-green-500' :
                          chk.xed    ? 'text-red-600 line-through dark:text-red-500' :
                          'dark:text-gray-200'
                        }`}>{line}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="p-6">
        {isCMTab ? (
          /* CM Fleets View — same structure as player tab */
          <div>
            {cmFleets.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No CM fleets created. Use Fleets → Add Units to create CM fleets.</p>
            ) : (
              <div className="space-y-3">
                {Array.from(new Set(cmFleets.map(f => f.systemId ?? ''))).sort((a, b) => {
                  const na = map.systems.find(s => s.id === a)?.name ?? a;
                  const nb = map.systems.find(s => s.id === b)?.name ?? b;
                  return na.localeCompare(nb);
                }).map(sysId => {
                  const systemName = map.systems.find(s => s.id === sysId)?.name ?? (sysId || 'No system');
                  const fleetsHere = cmFleets.filter(f => (f.systemId ?? '') === sysId);
                  const isExpanded = expandedSystems.has('cm:' + sysId);
                  return (
                    <div key={sysId || '__none__'} className="rounded-lg border border-gray-200 dark:border-gray-700">
                      <button
                        onClick={() => toggleSystem('cm:' + sysId)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <span className="text-xs text-gray-400 dark:text-gray-600">{isExpanded ? '▼' : '▶'}</span>
                        <span className="flex-1 text-sm font-semibold dark:text-gray-100">{systemName}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {fleetsHere.length} Fleet{fleetsHere.length !== 1 ? 's' : ''}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">
                          <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {fleetsHere.map(cmFleet => {
                              const asCampaignFleet: CampaignFleet = { id: cmFleet.id, name: cmFleet.name, systemId: cmFleet.systemId ?? '', movedThisTurn: false };
                              return (
                                <div key={cmFleet.id} className="rounded border border-gray-100 p-2 dark:border-gray-800">
                                  <FMFleetSection
                                    fleetKey={cmFleet.id}
                                    fleetName={cmFleet.name}
                                    fleet={asCampaignFleet}
                                    unitPool={allIndieUnits}
                                    fleetColor={cmFleet.color}
                                    fleetUnits={cmFleet.units}
                                    systemId={sysId}
                                    condensedView={condensedView}
                                    dragState={dragState}
                                    dragOverCarrierId={dragOverCarrierId}
                                    dragOverFleetKey={dragOverFleetKey}
                                    isNamed={true}
                                    onEditFleet={onEditCMFleet ? () => onEditCMFleet(cmFleet.id) : undefined}
                                    onMoveFleet={onMoveCMFleet ? () => onMoveCMFleet(cmFleet.id) : undefined}
                                    onColorChange={onUpdateCMFleetColor ? (color) => onUpdateCMFleetColor(cmFleet.id, color) : undefined}
                                    onReorderFleet={() => {}}
                                    onAttachUnit={(depId, carrierId) => onAttachCMUnit?.(cmFleet.id, depId, carrierId)}
                                    onDeleteUnit={(templateId, _fk, _sid, count) => onDeleteCMUnits?.(cmFleet.id, templateId, count)}
                                    onReorderUnit={(unitId, dir) => onReorderCMUnit?.(cmFleet.id, unitId, dir)}
                                    onDragStartUnit={(unitId) => startCMDrag(unitId, cmFleet.id)}
                                    onDragEndUnit={endDrag}
                                    onSetDragOverCarrier={setDragOverCarrierId}
                                    onDropOnCarrier={handleDropOnCarrier}
                                    onSetDragOverFleet={setDragOverFleetKey}
                                    onDropOnFleet={handleDropOnFleet}
                                    onDropTemplateOnFleet={(templateId, templateName, fromFleetKey, count) =>
                                      handleDropTemplateOnFleet(templateId, templateName, fromFleetKey, cmFleet.id, cmFleet.name, sysId, count, true)
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : playerSystems.length === 0 ? (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No fleets or units deployed.</p>
        ) : (
          <div className="space-y-3">
            {playerSystems.map(sys => {
              const systemName = map.systems.find(s => s.id === sys.systemId)?.name ?? sys.systemId;
              const isExpanded = expandedSystems.has(sys.systemId);

              const catSummary = Object.entries(sys.categoryMap)
                .filter(([, count]) => count > 0)
                .map(([cat, count]) => `${count} ${cat}`)
                .join(' · ');

              const totalFleetCount = sys.namedFleets.length + sys.systemFleetKeys.size;

              const systemTotalCost = player.units
                .filter(u => u.systemId === sys.systemId)
                .reduce((sum, u) => {
                  const t = resolveUnitTemplate(player, u.unitTemplateId, players);
                  return sum + (t?.cost ?? 0);
                }, 0);

              return (
                <div key={sys.systemId} className="rounded-lg border border-gray-200 dark:border-gray-700">
                  {/* System header */}
                  <button
                    onClick={() => toggleSystem(sys.systemId)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <span className="text-xs text-gray-400 dark:text-gray-600">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span className="flex-1 text-sm font-semibold dark:text-gray-100">{systemName}</span>
                    {catSummary && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">{catSummary}</span>
                    )}
                    {systemTotalCost > 0 && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">{systemTotalCost} EP</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {totalFleetCount} Fleet{totalFleetCount !== 1 ? 's' : ''}
                    </span>
                  </button>

                  {/* Fleet grid */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-700">
                      {/* New fleet creation */}
                      <div className="mb-3">
                        {creatingFleetInSystem === sys.systemId ? (
                          <div className="flex items-center gap-2">
                            <input
                              ref={newFleetInputRef}
                              type="text"
                              value={newFleetName}
                              onChange={e => setNewFleetName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleConfirmCreateFleet();
                                if (e.key === 'Escape') handleCancelCreateFleet();
                              }}
                              placeholder="Fleet name…"
                              className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                            />
                            <button
                              onClick={handleConfirmCreateFleet}
                              disabled={!newFleetName.trim()}
                              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
                            >
                              Create
                            </button>
                            <button
                              onClick={handleCancelCreateFleet}
                              className="rounded px-2 py-1 text-sm hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartCreateFleet(sys.systemId)}
                            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
                          >
                            + New Fleet
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {sys.namedFleets.map(fleet => {
                          const fleetUnits = player.units.filter(u => u.fleetId === fleet.id);
                          return (
                            <div key={fleet.id} className="rounded border border-gray-100 p-2 dark:border-gray-800">
                              <FMFleetSection
                                fleetKey={fleet.id}
                                fleetName={fleet.name}
                                fleet={fleet}
                                player={player}
                                allPlayers={players}
                                fleetUnits={fleetUnits}
                                systemId={sys.systemId}
                                condensedView={condensedView}
                                dragState={dragState}
                                dragOverCarrierId={dragOverCarrierId}
                                dragOverFleetKey={dragOverFleetKey}
                                isNamed={true}
                                onEditFleet={() => onEditFleet(player.id, fleet.id)}
                                onMoveFleet={() => onMoveFleet(player.id, fleet.id)}
                                onReorderFleet={(fromId, toId) => onReorderFleet(player.id, fromId, toId)}
                                onAttachUnit={(depId, carrierId) => onAttachUnit(player.id, depId, carrierId)}
                                onDeleteUnit={(templateId, fk, sid, count) => onDeleteUnits(sid, fk, templateId, count)}
                                onReorderUnit={(unitId, dir) => onReorderUnit(player.id, fleet.id, unitId, dir)}
                                onDragStartUnit={(unitId) => startDrag(unitId, player.id)}
                                onDragEndUnit={endDrag}
                                onSetDragOverCarrier={setDragOverCarrierId}
                                onDropOnCarrier={handleDropOnCarrier}
                                onSetDragOverFleet={setDragOverFleetKey}
                                onDropOnFleet={handleDropOnFleet}
                                onDropTemplateOnFleet={(templateId, templateName, fromFleetKey, count) =>
                                  handleDropTemplateOnFleet(templateId, templateName, fromFleetKey, fleet.id, fleet.name, sys.systemId, count)
                                }
                                onToggleUnitStatus={onToggleUnitStatus}
                              />
                            </div>
                          );
                        })}

                        {[...sys.systemFleetKeys].map(fleetKey => {
                          const fleetUnits = player.units.filter(u =>
                            u.systemId === sys.systemId &&
                            (u.fleetId ?? 'Unassigned') === fleetKey
                          );
                          if (fleetUnits.length === 0 && fleetKey !== 'On-Planet') return null;
                          return (
                            <div key={fleetKey} className="rounded border border-gray-100 p-2 dark:border-gray-800">
                              <FMFleetSection
                                fleetKey={fleetKey}
                                fleetName={fleetKey}
                                fleet={null}
                                player={player}
                                allPlayers={players}
                                fleetUnits={fleetUnits}
                                systemId={sys.systemId}
                                condensedView={condensedView}
                                dragState={dragState}
                                dragOverCarrierId={dragOverCarrierId}
                                dragOverFleetKey={dragOverFleetKey}
                                isNamed={false}
                                onReorderFleet={() => {}}
                                onAttachUnit={(depId, carrierId) => onAttachUnit(player.id, depId, carrierId)}
                                onDeleteUnit={(templateId, fk, sid, count) => onDeleteUnits(sid, fk, templateId, count)}
                                onReorderUnit={() => {}}
                                onDragStartUnit={(unitId) => startDrag(unitId, player.id)}
                                onDragEndUnit={endDrag}
                                onSetDragOverCarrier={setDragOverCarrierId}
                                onDropOnCarrier={handleDropOnCarrier}
                                onSetDragOverFleet={setDragOverFleetKey}
                                onDropOnFleet={handleDropOnFleet}
                                onDropTemplateOnFleet={(templateId, templateName, fromFleetKey, count) =>
                                  handleDropTemplateOnFleet(templateId, templateName, fromFleetKey, fleetKey, fleetKey, sys.systemId, count)
                                }
                                onToggleUnitStatus={onToggleUnitStatus}
                              />
                            </div>
                          );
                        })}

                        {/* During a drag, show empty system-fleet drop targets for valid destinations not yet on screen */}
                        {dragState && dragState.systemId === sys.systemId &&
                          (SYSTEM_FLEET_NAMES as readonly string[])
                            .filter(sfn => dragState.validFleetKeys.has(sfn) && !sys.systemFleetKeys.has(sfn))
                            .map(sfn => (
                              <div key={`empty-drop-${sfn}`} className="rounded border border-gray-100 p-2 dark:border-gray-800">
                                <FMFleetSection
                                  fleetKey={sfn}
                                  fleetName={sfn}
                                  fleet={null}
                                  player={player}
                                  allPlayers={players}
                                  fleetUnits={[]}
                                  systemId={sys.systemId}
                                  condensedView={condensedView}
                                  dragState={dragState}
                                  dragOverCarrierId={dragOverCarrierId}
                                  dragOverFleetKey={dragOverFleetKey}
                                  isNamed={false}
                                  onReorderFleet={() => {}}
                                  onAttachUnit={() => {}}
                                  onDeleteUnit={() => {}}
                                  onReorderUnit={() => {}}
                                  onDragStartUnit={() => {}}
                                  onDragEndUnit={endDrag}
                                  onSetDragOverCarrier={setDragOverCarrierId}
                                  onDropOnCarrier={handleDropOnCarrier}
                                  onSetDragOverFleet={setDragOverFleetKey}
                                  onDropOnFleet={handleDropOnFleet}
                                  onDropTemplateOnFleet={(templateId, templateName, fromFleetKey, count) =>
                                    handleDropTemplateOnFleet(templateId, templateName, fromFleetKey, sfn, sfn, sys.systemId, count)
                                  }
                                />
                              </div>
                            ))
                        }
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>{/* end p-6 */}
      </div>

      {/* Quantity picker for condensed-mode template moves */}
      {pendingTemplateMove && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold dark:text-white">Move Units</h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {pendingTemplateMove.templateName} → {pendingTemplateMove.toFleetName}
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 dark:text-gray-400">How many to move?</label>
              <input
                type="number"
                min={1}
                max={pendingTemplateMove.maxCount}
                value={templateMoveCount}
                onChange={e => setTemplateMoveCount(Math.min(pendingTemplateMove.maxCount, Math.max(1, Number(e.target.value) || 1)))}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmTemplateMove();
                  if (e.key === 'Escape') setPendingTemplateMove(null);
                }}
                className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                autoFocus
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">of {pendingTemplateMove.maxCount}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingTemplateMove(null)}
                className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={confirmTemplateMove}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
              >
                Move
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
