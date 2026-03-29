import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignFleet, CampaignPlayer, CampaignUnit, EmpireUnit, GameMap } from '../types';
import { SYSTEM_FLEET_NAMES } from '../types';
import { useConfirm } from '../hooks/useConfirm';
import { computeFleetBadges, getCarryCapacity, resolveUnitTemplate } from '../utils/fleetUtils';

type StrategicStatus = 'crippled' | 'outOfSupply' | 'captured' | 'exhausted' | 'mothballed';

const UNIT_STATUS_CONFIG: Array<{ key: StrategicStatus; label: string; title: string; activeCls: string }> = [
  { key: 'crippled',    label: 'C',    title: 'Crippled',      activeCls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  { key: 'outOfSupply', label: 'OOS',  title: 'Out of Supply', activeCls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { key: 'captured',    label: 'CAP',  title: 'Captured',      activeCls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { key: 'exhausted',   label: 'EX',   title: 'Exhausted',     activeCls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  { key: 'mothballed',  label: 'MOTH', title: 'Mothballed',    activeCls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
];

interface EditFleetViewProps {
  fleet: CampaignFleet;
  map: GameMap;
  onClose: () => void;
  onRenameFleet: (newName: string) => void;
  onDeleteFleet: () => void;
  onDeleteUnits: (templateId: string, count: number) => void;
  onReorderUnit: (unitId: string, dir: 'up' | 'down') => void;

  // Player fleet mode — provide player; units derived from player.units
  player?: CampaignPlayer;
  allPlayers?: CampaignPlayer[];
  onMoveUnitToFleet?: (unitId: string, newFleetId: string) => void;
  onAttachUnit?: (dependentUnitId: string, carrierUnitId: string | null) => void;

  // CM fleet mode — provide these instead of player
  unitPool?: EmpireUnit[];           // template pool for lookup
  directFleetUnits?: CampaignUnit[]; // units belonging to this fleet directly
  ownerLabel?: string;               // display name for the owner row
  ownerColor?: string;               // team color dot for the owner row
  fleetNamesToAvoid?: string[];      // other fleet names at this system (for rename validation)
  onToggleUnitStatus?: (unitId: string, status: StrategicStatus) => void;
}

// A unit is a dependent if it requires a carrier to move.
function isDependentUnit(template: EmpireUnit): boolean {
  return template.category === 'Fighters' || template.hullCode === 'AB' || template.category === 'Troops' || template.hullCode === 'OWP';
}

// ---------------------------------------------------------------------------
// Warning computation
// ---------------------------------------------------------------------------

interface FleetWarning {
  level: 'warn' | 'info';
  message: string;
  unitIds?: string[];
}

function computeWarnings(
  fleet: CampaignFleet,
  units: CampaignUnit[],
  getTemplate: (id: string) => EmpireUnit | undefined,
  isCivilian?: boolean,
): FleetWarning[] {
  const warnings: FleetWarning[] = [];

  if (fleet.movedThisTurn) {
    warnings.push({ level: 'warn', message: 'Fleet has already moved this turn.' });
  }

  const garrisonUnits = units.filter(u => {
    const t = getTemplate(u.unitTemplateId);
    return t?.traits.some(tr => tr.name === 'Garrison');
  });
  if (garrisonUnits.length > 0) {
    warnings.push({
      level: 'warn',
      message: 'Garrison troops present — this fleet cannot move without confirmation.',
      unitIds: garrisonUnits.map(u => u.id),
    });
  }

  const baseUnits = units.filter(u => {
    const t = getTemplate(u.unitTemplateId);
    return t?.category === 'Bases' && t.hullCode !== 'OWP';
  });
  if (baseUnits.length > 0) {
    warnings.push({
      level: 'warn',
      message: 'Bases cannot move.',
      unitIds: baseUnits.map(u => u.id),
    });
  }

  const fleetUnitIds = new Set(units.map(u => u.id));
  const unattachedDependents = units.filter(u => {
    if (u.carriedById && fleetUnitIds.has(u.carriedById)) return false;
    const t = getTemplate(u.unitTemplateId);
    if (!t) return false;
    return isDependentUnit(t);
  });
  if (unattachedDependents.length > 0) {
    warnings.push({
      level: 'warn',
      message: `${unattachedDependents.length} unit(s) (Fighters/Attack Boats/Troops/OWPs) are unattached — they cannot move without being attached to a carrier.`,
      unitIds: unattachedDependents.map(u => u.id),
    });
  }

  // Over-capacity carriers
  const overCapacityCarrierIds: string[] = [];
  for (const u of units) {
    const carrierTemplate = getTemplate(u.unitTemplateId);
    if (!carrierTemplate) continue;
    const carried = units.filter(cu => cu.carriedById === u.id);
    if (carried.length === 0) continue;
    const carriedWithTemplates = carried
      .map(cu => {
        const t = getTemplate(cu.unitTemplateId);
        return t ? { unit: cu, template: t } : null;
      })
      .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
    const capacityResult = getCarryCapacity(u, carrierTemplate, carriedWithTemplates);
    if (capacityResult.remaining < 0) overCapacityCarrierIds.push(u.id);
  }
  if (overCapacityCarrierIds.length > 0) {
    warnings.push({
      level: 'warn',
      message: `${overCapacityCarrierIds.length} carrier(s) exceed their carrying capacity.`,
      unitIds: overCapacityCarrierIds,
    });
  }

  // Category rule violations
  const categoryViolations: string[] = [];
  for (const u of units) {
    const carrierTemplate = getTemplate(u.unitTemplateId);
    if (!carrierTemplate) continue;
    const carried = units.filter(cu => cu.carriedById === u.id);
    if (carried.length === 0) continue;
    const carriedWithTemplates = carried
      .map(cu => {
        const t = getTemplate(cu.unitTemplateId);
        return t ? { unit: cu, template: t } : null;
      })
      .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
    const { allowedCategories } = getCarryCapacity(u, carrierTemplate, carriedWithTemplates);
    const wrong = carriedWithTemplates.filter(({ template: t }) => !allowedCategories.includes(t.category));
    if (wrong.length > 0) {
      const catNames = [...new Set(wrong.map(x => x.template.category))].join(', ');
      categoryViolations.push(`${carrierTemplate.name} carries ${catNames} unit(s) it is not designed to carry.`);
    }
  }
  if (categoryViolations.length > 0) {
    warnings.push({
      level: 'warn',
      message: `Attachment rule violations: ${categoryViolations.join(' ')}`,
    });
  }

  if (isCivilian) {
    warnings.push({ level: 'info', message: 'Civilian fleets cannot traverse Restricted lanes.' });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Inline name editor
// ---------------------------------------------------------------------------

function InlineNameEditor({
  value,
  onSave,
  validate,
}: {
  value: string;
  onSave: (name: string) => void;
  validate: (name: string) => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEdit = () => {
    setDraft(value);
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    const err = validate(trimmed);
    if (err) { setError(err); return; }
    onSave(trimmed);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setEditing(false); setError(null); }
  };

  if (!editing) {
    return (
      <button
        onClick={handleEdit}
        className="flex items-center gap-1 text-lg font-semibold hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400"
        title="Click to rename"
      >
        {value}
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => { setDraft(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          className="rounded border border-gray-300 px-2 py-1 text-lg font-semibold dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <button onClick={handleSave} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700">Save</button>
        <button onClick={() => { setEditing(false); setError(null); }} className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700">Cancel</button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unit row
// ---------------------------------------------------------------------------

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

function EditFleetUnitRow({
  unit,
  template,
  carriedUnits,
  isWarning,
  isDraggable,
  dropTargetKind,
  isDraggingOver,
  onDelete,
  onDetach,
  onDetachCarried,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDragLeaveCard,
  onDropOnCard,
  onDragStartCarried,
  onToggleStatus,
}: {
  unit: CampaignUnit;
  template: EmpireUnit;
  carriedUnits: Array<{ unit: CampaignUnit; template: EmpireUnit }>;
  isWarning: boolean;
  isDraggable: boolean;
  dropTargetKind: 'valid' | 'warn' | null;
  isDraggingOver: boolean;
  onDelete: () => void;
  onDetach: () => void;
  onDetachCarried: (depUnitId: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverCard: (e: React.DragEvent) => void;
  onDragLeaveCard: (e: React.DragEvent) => void;
  onDropOnCard: () => void;
  onDragStartCarried: (unitId: string, e: React.DragEvent) => void;
  onToggleStatus?: (status: StrategicStatus) => void;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isCarried = !!unit.carriedById;
  const isDropTarget = dropTargetKind !== null;

  let borderClass = 'border-transparent';
  if (isDraggingOver) {
    borderClass = dropTargetKind === 'warn'
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
    onDragStart(e);
  };

  return (
    <div
      draggable={isDraggable || undefined}
      onDragStart={isDraggable ? handleRowDragStart : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      className={`rounded border-l-2 py-2 pl-2 pr-1 ${borderClass} ${isDraggable ? 'cursor-grab select-none active:cursor-grabbing' : ''}`}
      onDragOver={isDropTarget ? onDragOverCard : undefined}
      onDragLeave={isDropTarget ? onDragLeaveCard : undefined}
      onDrop={isDropTarget ? (e) => { e.preventDefault(); onDropOnCard(); } : undefined}
    >
      <div className="flex items-center gap-2">
        {isDraggable ? (
          <GripIcon className="h-4 w-2.5 flex-shrink-0 text-gray-300 dark:text-gray-600" />
        ) : (
          <div className="w-2.5 flex-shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{template.name}</span>
          {template.hullCode !== 'N/A' && (
            <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">({template.hullCode})</span>
          )}
          {isCarried && (
            <span className="ml-2 text-xs italic text-gray-400 dark:text-gray-500">carried</span>
          )}
        </div>

        {isCarried && (
          <button
            onClick={onDetach}
            className="rounded px-1.5 py-0.5 text-xs text-blue-500 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950"
            title="Detach from carrier"
          >
            Detach
          </button>
        )}

        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col">
            <button
              onClick={onMoveUp}
              disabled={!onMoveUp}
              className="rounded px-0.5 text-[10px] leading-none text-gray-400 hover:text-gray-600 disabled:opacity-20 dark:hover:text-gray-300"
              title="Move unit up"
            >▲</button>
            <button
              onClick={onMoveDown}
              disabled={!onMoveDown}
              className="rounded px-0.5 text-[10px] leading-none text-gray-400 hover:text-gray-600 disabled:opacity-20 dark:hover:text-gray-300"
              title="Move unit down"
            >▼</button>
          </div>
        )}

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
        <div className="ml-10 mt-1 flex flex-wrap gap-1">
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

      <div className="ml-10 mt-1.5 flex flex-wrap gap-x-4 text-xs">
        {([
          ['DV', template.dv],
          ['AS', template.as],
          ['AF', template.af],
          ['CR', template.cr],
          ['CC', template.cc],
        ] as [string, string | number][]).map(([label, value]) => (
          <span key={label} className="text-gray-500 dark:text-gray-400">
            {label}:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{value}</span>
          </span>
        ))}
      </div>

      {template.traits.length > 0 ? (
        <div className="ml-10 mt-0.5 text-xs text-gray-400 dark:text-gray-500">
          {template.traits.map((tr, i) => (
            <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>
          ))}
        </div>
      ) : (
        <div className="ml-10 mt-0.5 text-xs italic text-gray-300 dark:text-gray-600">No traits</div>
      )}

      {isDraggable && !isCarried && (
        <p className="ml-10 mt-1 text-xs italic text-amber-600 dark:text-amber-400">
          Drag onto a carrier unit to attach
        </p>
      )}

      {carriedUnits.length > 0 && (
        <div className="ml-10 mt-2 space-y-1 border-l border-gray-200 pl-3 dark:border-gray-700">
          {carriedUnits.map(({ unit: cu, template: ct }) => {
            const depDraggable = isDependentUnit(ct);
            return (
              <div
                key={cu.id}
                draggable={depDraggable || undefined}
                onDragStart={depDraggable ? (e) => onDragStartCarried(cu.id, e) : undefined}
                className={`flex items-center gap-1.5 py-0.5 text-xs text-gray-600 dark:text-gray-300 ${depDraggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
              >
                {depDraggable && (
                  <GripIcon className="h-3 w-2 flex-shrink-0 text-gray-300 dark:text-gray-600" />
                )}
                <span className="flex-1">
                  ↳ {ct.name}{ct.hullCode !== 'N/A' ? ` (${ct.hullCode})` : ''}
                </span>
                <button
                  onClick={() => onDetachCarried(cu.id)}
                  className="rounded px-1 py-0.5 text-blue-400 hover:text-blue-600 dark:text-blue-500"
                >
                  detach ×
                </button>
              </div>
            );
          })}
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
// Main component
// ---------------------------------------------------------------------------

export function EditFleetView({
  fleet,
  map,
  onClose,
  onRenameFleet,
  onMoveUnitToFleet: _onMoveUnitToFleet,
  onAttachUnit,
  onDeleteFleet,
  onDeleteUnits,
  onReorderUnit,
  player,
  unitPool,
  directFleetUnits,
  ownerLabel,
  ownerColor,
  fleetNamesToAvoid,
  allPlayers,
  onToggleUnitStatus,
}: EditFleetViewProps) {
  const confirm = useConfirm();
  const [showDeleteFleetDialog, setShowDeleteFleetDialog] = useState(false);

  const [draggingUnitId, setDraggingUnitId] = useState<string | null>(null);
  const [validCarrierIds, setValidCarrierIds] = useState<Set<string>>(new Set());
  const [warnCarrierIds, setWarnCarrierIds] = useState<Set<string>>(new Set());
  const [dragOverUnitId, setDragOverUnitId] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollSpeedRef = useRef(0);
  const scrollAnimRef = useRef<number | null>(null);

  // Resolve fleet units and template pool — supports both player-fleet and CM-fleet modes
  const fleetUnits = directFleetUnits ?? (player?.units.filter(u => u.fleetId === fleet.id) ?? []);
  const getTemplate = (id: string): EmpireUnit | undefined =>
    unitPool?.find(t => t.id === id)
    ?? (player ? resolveUnitTemplate(player, id, allPlayers) : undefined);

  const badges = player
    ? computeFleetBadges(fleet, fleetUnits, player, allPlayers)
    : { isFast: false, isScout: false, isCivilian: false };

  const warnings = computeWarnings(fleet, fleetUnits, getTemplate, badges.isCivilian);
  const warnUnitIds = new Set(warnings.flatMap(w => w.unitIds ?? []));
  const isEmpty = fleetUnits.length === 0;

  // Fleet combat totals
  let totalDV = 0, totalAS = 0, totalAF = 0;
  const factorTotals: Record<string, number> = {};
  for (const u of fleetUnits) {
    const t = getTemplate(u.unitTemplateId);
    if (!t) continue;
    totalDV += parseFloat(String(t.dv)) || 0;
    totalAS += parseFloat(String(t.as)) || 0;
    totalAF += parseFloat(String(t.af)) || 0;
    for (const trait of t.traits) {
      if (trait.factor !== undefined && trait.factor > 0) {
        factorTotals[trait.name] = (factorTotals[trait.name] ?? 0) + trait.factor;
      }
    }
  }
  const factorEntries = Object.entries(factorTotals);

  const validateName = (name: string): string | null => {
    if (!name) return 'Name cannot be empty.';
    if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(name)) return 'That name is reserved for a system fleet.';
    if (fleetNamesToAvoid) {
      if (fleetNamesToAvoid.includes(name)) return 'A fleet with that name already exists.';
    } else if (player) {
      const duplicate = (player.fleets ?? []).find(f => f.id !== fleet.id && f.name === name);
      if (duplicate) return 'A fleet with that name already exists.';
    }
    return null;
  };

  const fleetUnitIds = new Set(fleetUnits.map(u => u.id));
  const topLevelUnits = fleetUnits.filter(u => !u.carriedById || !fleetUnitIds.has(u.carriedById));

  const carriedByCarrier = new Map<string, Array<{ unit: CampaignUnit; template: EmpireUnit }>>();
  for (const u of fleetUnits) {
    if (u.carriedById && fleetUnitIds.has(u.carriedById)) {
      if (!carriedByCarrier.has(u.carriedById)) carriedByCarrier.set(u.carriedById, []);
      const t = getTemplate(u.unitTemplateId);
      if (t) carriedByCarrier.get(u.carriedById)!.push({ unit: u, template: t });
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-scroll during drag
  // ---------------------------------------------------------------------------

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
    e.preventDefault();
    if (!draggingUnitId) return;
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

  // ---------------------------------------------------------------------------
  // Drag-to-attach handlers
  // ---------------------------------------------------------------------------

  const startDrag = (unitId: string) => {
    const draggingUnit = fleetUnits.find(u => u.id === unitId);
    const draggingTmpl = draggingUnit ? getTemplate(draggingUnit.unitTemplateId) : null;
    if (!draggingTmpl) return;
    setDraggingUnitId(unitId);

    const validIds = new Set<string>();
    const warnIds = new Set<string>();
    for (const u of fleetUnits) {
      if (u.id === unitId) continue;
      const carrierTmpl = getTemplate(u.unitTemplateId);
      if (!carrierTmpl) continue;
      const currentlyCarried = fleetUnits.filter(cu => cu.carriedById === u.id && cu.id !== unitId);
      const currentlyCarriedWithTemplates = currentlyCarried
        .map(cu => {
          const t = getTemplate(cu.unitTemplateId);
          return t ? { unit: cu, template: t } : null;
        })
        .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
      const { allowedCategories, remaining } = getCarryCapacity(u, carrierTmpl, currentlyCarriedWithTemplates);

      if (allowedCategories.length === 0) continue;

      const cost = draggingTmpl.hullCode === 'OWP' ? 2 : 1;
      const categoryOK = allowedCategories.includes(draggingTmpl.category);
      const capacityOK = remaining >= cost;

      if (categoryOK && capacityOK) {
        validIds.add(u.id);
      } else {
        warnIds.add(u.id);
      }
    }
    setValidCarrierIds(validIds);
    setWarnCarrierIds(warnIds);
    startDragScroll();
  };

  const endDrag = () => {
    setDraggingUnitId(null);
    setValidCarrierIds(new Set());
    setWarnCarrierIds(new Set());
    setDragOverUnitId(null);
    stopDragScroll();
  };

  const handleDropOnUnit = async (targetUnitId: string) => {
    if (!draggingUnitId) { endDrag(); return; }
    const draggingUnit = fleetUnits.find(u => u.id === draggingUnitId);
    const draggingTmpl = draggingUnit ? getTemplate(draggingUnit.unitTemplateId) : null;
    const targetUnit = fleetUnits.find(u => u.id === targetUnitId);
    const targetTmpl = targetUnit ? getTemplate(targetUnit.unitTemplateId) : null;

    if (!draggingUnit || !draggingTmpl || !targetUnit || !targetTmpl) { endDrag(); return; }

    const dragUnitId = draggingUnitId;

    const currentlyCarried = fleetUnits.filter(cu => cu.carriedById === targetUnitId && cu.id !== draggingUnitId);
    const currentlyCarriedWithTemplates = currentlyCarried
      .map(cu => {
        const t = getTemplate(cu.unitTemplateId);
        return t ? { unit: cu, template: t } : null;
      })
      .filter((x): x is { unit: CampaignUnit; template: EmpireUnit } => x !== null);
    const { remaining, allowedCategories } = getCarryCapacity(targetUnit, targetTmpl, currentlyCarriedWithTemplates);

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

    onAttachUnit?.(dragUnitId, targetUnitId);
  };

  // Resolve display info
  const displayOwnerLabel = ownerLabel ?? player?.name;
  const displayOwnerColor = ownerColor ?? player?.teamColor;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              ← Close
            </button>
            <InlineNameEditor value={fleet.name} onSave={onRenameFleet} validate={validateName} />
          </div>
          {/* Owner + badges */}
          {displayOwnerLabel && (
            <div className="flex items-center gap-2 pl-16">
              <span className="text-sm text-gray-500 dark:text-gray-400">Owner:</span>
              {displayOwnerColor && (
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: displayOwnerColor }} />
              )}
              <span className="text-sm dark:text-gray-200">{displayOwnerLabel}</span>
              {player && (
                <div className="ml-2 flex gap-1">
                  {badges.isFast && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">Fast</span>
                  )}
                  {badges.isCivilian && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">Civilian</span>
                  )}
                  {badges.isScout && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Scout</span>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Fleet combat totals */}
          {fleetUnits.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 pl-16 text-xs">
              <span className="text-gray-500 dark:text-gray-400">
                DV:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{totalDV}</span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                AS:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{totalAS}</span>
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                AF:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{totalAF}</span>
              </span>
              {factorEntries.length > 0 && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  {factorEntries.map(([name, total]) => (
                    <span key={name} className="text-gray-500 dark:text-gray-400">
                      {name}:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-200">{total}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => setShowDeleteFleetDialog(true)}
          disabled={!isEmpty}
          className="rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950"
          title={isEmpty ? 'Delete this fleet' : 'Remove all units before deleting'}
        >
          Delete Fleet
        </button>
      </div>

      {/* Warnings panel */}
      {warnings.length > 0 && (
        <div className="border-b border-gray-200 bg-amber-50 px-6 py-3 dark:border-gray-700 dark:bg-amber-950/20">
          <div className="space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className={`text-sm ${w.level === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'}`}>
                {w.level === 'warn' ? '⚠ ' : 'ℹ '}{w.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 gap-6 overflow-hidden px-6 py-4">
        {/* Unit list */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Units in this Fleet ({fleetUnits.length})
          </h3>

          <div
            ref={scrollContainerRef}
            className="flex-1 space-y-2 overflow-y-auto"
            onDragOver={handleScrollAreaDragOver}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                scrollSpeedRef.current = 0;
              }
            }}
          >
            {topLevelUnits.length === 0 ? (
              <p className="text-sm italic text-gray-400 dark:text-gray-500">No units assigned to this fleet.</p>
            ) : (
              topLevelUnits.map((u, index) => {
                const t = getTemplate(u.unitTemplateId);
                if (!t) return null;
                const carriedUnits = carriedByCarrier.get(u.id) ?? [];
                const isDependent = isDependentUnit(t);
                const dropTargetKind = draggingUnitId
                  ? validCarrierIds.has(u.id) ? 'valid' : warnCarrierIds.has(u.id) ? 'warn' : null
                  : null;

                return (
                  <EditFleetUnitRow
                    key={u.id}
                    unit={u}
                    template={t}
                    carriedUnits={carriedUnits}
                    isWarning={warnUnitIds.has(u.id)}
                    isDraggable={isDependent}
                    dropTargetKind={dropTargetKind}
                    isDraggingOver={dragOverUnitId === u.id}
                    onDelete={() => onDeleteUnits(u.unitTemplateId, 1)}
                    onDetach={() => onAttachUnit?.(u.id, null)}
                    onDetachCarried={depId => onAttachUnit?.(depId, null)}
                    onMoveUp={index > 0 ? () => onReorderUnit(u.id, 'up') : undefined}
                    onMoveDown={index < topLevelUnits.length - 1 ? () => onReorderUnit(u.id, 'down') : undefined}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; startDrag(u.id); }}
                    onDragEnd={endDrag}
                    onDragOverCard={(e) => { e.preventDefault(); setDragOverUnitId(u.id); }}
                    onDragLeaveCard={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverUnitId(null);
                    }}
                    onDropOnCard={() => handleDropOnUnit(u.id)}
                    onDragStartCarried={(unitId, e) => { e.dataTransfer.effectAllowed = 'move'; startDrag(unitId); }}
                    onToggleStatus={onToggleUnitStatus ? (status) => onToggleUnitStatus(u.id, status) : undefined}
                  />
                );
              })
            )}
          </div>

        </div>

        {/* Location sidebar */}
        <div className="w-56 flex-shrink-0">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Location</h3>
          <p className="text-sm dark:text-gray-200">
            {map.systems.find(s => s.id === fleet.systemId)?.name ?? fleet.systemId}
          </p>
          {fleet.movedThisTurn && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">⚠ Already moved this turn</p>
          )}
          {draggingUnitId && (
            <p className="mt-4 text-xs italic text-blue-500 dark:text-blue-400">
              Drop onto a highlighted carrier to attach.
              <br />
              <span className="text-amber-500 dark:text-amber-400">Amber</span> = rule violation (confirm required).
            </p>
          )}
        </div>
      </div>

      {/* Delete fleet confirmation */}
      {showDeleteFleetDialog && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-80 rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-2 font-semibold dark:text-white">Delete Fleet</h3>
            <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
              Delete the fleet "{fleet.name}"? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteFleetDialog(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDeleteFleet(); setShowDeleteFleetDialog(false); }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
