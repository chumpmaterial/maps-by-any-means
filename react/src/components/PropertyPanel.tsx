import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { useMapState } from '../hooks/useMapState';
import { useConfirm } from '../hooks/useConfirm';
import type { SystemType, LaneType, StarType, PlanetType, SystemTrait, SystemAttributes, CampaignPlayer, CampaignFleet, EmpireUnit, UnitCategory, SystemCampaignStatus, SystemIntelSnapshot, CMFleet, IndependentUnitList } from '../types';
import { SYSTEM_FLEET_NAMES } from '../types';
import type { FowData } from './MapViewport';
import { computeFleetBadges, resolveUnitTemplate } from '../utils/fleetUtils';
import type { useNameLists } from '../hooks/useNameLists';
import { generateRandomTeamColor } from '../utils/colorUtils';
import { ColorSelect } from './ColorSelect';
import {
  traitInfo,
  allTraits,
  calculateAttributes,
  hasCustomAttributes,
  planetTypeImportance,
} from '../data/systemData';
import { presetSystemsByImportance } from '../data/presetSystems';
import type { PresetSystem } from '../data/presetSystems';

interface PropertyPanelProps {
  mapState: ReturnType<typeof useMapState>;
  nameListHook: ReturnType<typeof useNameLists>;
  campaignMode?: boolean;
  mapEditingMode?: boolean;
  players?: CampaignPlayer[];
  systemStatuses?: Record<string, SystemCampaignStatus>;
  onSetSystemStatus?: (systemId: string, patch: Partial<SystemCampaignStatus>) => void;
  fowData?: FowData | null;
  onDeleteUnits?: (systemId: string, fleetKey: string, templateId: string, count: number, playerId?: string) => void;
  onCreateFleet?: (playerId: string, name: string, systemId: string) => void;
  onEditFleet?: (playerId: string, fleetId: string) => void;
  onMoveFleet?: (playerId: string, fleetId: string) => void;
  fleetDisplayOrder?: string[];
  onReorderAnyFleet?: (fromFleetId: string, targetFleetId: string) => void;
  onMoveUnitToFleet?: (playerId: string, unitId: string, newFleetId: string) => void;
  onMoveTemplateToFleet?: (playerId: string, templateId: string, fromFleetKey: string, toFleetKey: string, systemId: string, count: number) => void;
  systemOwnership?: Record<string, string>;
  onChangeSystemOwner?: (systemId: string, newPlayerId: string | null) => void;
  independentSystemColors?: Record<string, string>;
  onSetIndependentSystemColor?: (sysId: string, color: string) => void;
  cmFleets?: CMFleet[];
  independentLists?: IndependentUnitList[];
  onEditCMFleet?: (fleetId: string) => void;
  onMoveCMFleet?: (fleetId: string) => void;
  onDeleteCMUnits?: (fleetId: string, templateId: string, count: number) => void;
  onMoveCMTemplateToFleet?: (fromFleetId: string, toFleetId: string, templateId: string, count: number) => void;
}

const systemTypes: { value: SystemType; label: string }[] = [
  { value: 'homeworld', label: 'Homeworld' },
  { value: 'major', label: 'Major System' },
  { value: 'minor', label: 'Minor System' },
  { value: 'unimportant', label: 'Unimportant System' },
];

const laneTypes: { value: LaneType; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'unexplored', label: 'Unexplored' },
];

const starTypeOptions: { value: StarType; label: string }[] = [
  { value: 'blue', label: 'Blue Giant (A)' },
  { value: 'white', label: 'White (F)' },
  { value: 'yellow', label: 'Yellow (G)' },
  { value: 'orange', label: 'Orange (K)' },
  { value: 'red', label: 'Red Star (M)' },
  { value: 'dwarf', label: 'Dwarf Star (D)' },
];

const planetTypeOptions: { value: PlanetType; label: string }[] = [
  { value: 'extreme', label: 'Extreme' },
  { value: 'dead', label: 'Dead' },
  { value: 'barren', label: 'Barren' },
  { value: 'adaptable', label: 'Adaptable' },
  { value: 'garden', label: 'Garden' },
  { value: 'homeworld', label: 'Homeworld' },
];

// Attribute abbreviations for display
const attrAbbrev: Record<keyof SystemAttributes, string> = {
  capacity: 'CAP',
  raw: 'RAW',
  population: 'POP',
  morale: 'MOR',
  intel: 'INT',
  fortification: 'FOR',
};

// Format trait modifiers for display (e.g., "+1 RAW, +1 MOR")
function formatTraitModifiers(trait: SystemTrait): string {
  const mods = traitInfo[trait].modifiers;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(mods)) {
    if (value) {
      const abbr = attrAbbrev[key as keyof SystemAttributes];
      parts.push(`+${value} ${abbr}`);
    }
  }
  return parts.join(', ');
}

export function PropertyPanel({ mapState, nameListHook, campaignMode = false, mapEditingMode = false, players, systemStatuses, onSetSystemStatus, fowData, onDeleteUnits, onCreateFleet, onEditFleet, onMoveFleet, fleetDisplayOrder, onReorderAnyFleet, onMoveUnitToFleet, onMoveTemplateToFleet, systemOwnership, onChangeSystemOwner, cmFleets, independentLists, onEditCMFleet, onMoveCMFleet, onDeleteCMUnits, onMoveCMTemplateToFleet }: PropertyPanelProps) {
  const confirm = useConfirm();
  const {
    selectedSystemId,
    selectedLaneId,
    getSystem,
    getJumpLane,
    updateJumpLane,
    removeJumpLane,
  } = mapState;

  const selectedSystem = selectedSystemId ? getSystem(selectedSystemId) : null;
  const selectedLane = selectedLaneId ? getJumpLane(selectedLaneId) : null;

  // Nothing selected
  if (!selectedSystem && !selectedLane) {
    return (
      <aside className="w-64 border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a system or jump lane to view its properties
        </p>
      </aside>
    );
  }

  // Jump Lane selected
  if (selectedLane) {
    const fromSystem = getSystem(selectedLane.from);
    const toSystem = getSystem(selectedLane.to);

    return (
      <aside className="w-64 border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-4 text-lg font-semibold">Jump Lane Properties</h2>

        <div className="space-y-4">
          {/* From System (read-only) */}
          <div>
            <label className="mb-1 block text-sm font-medium">From</label>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {fromSystem?.name || 'Unknown'}
            </p>
          </div>

          {/* To System (read-only) */}
          <div>
            <label className="mb-1 block text-sm font-medium">To</label>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {toSystem?.name || 'Unknown'}
            </p>
          </div>

          {/* Lane Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Lane Type</label>
            <select
              value={selectedLane.type || 'unexplored'}
              onChange={(e) => updateJumpLane(selectedLane.id, { type: e.target.value as LaneType })}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {laneTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Delete button (hidden in campaign mode unless map editing) */}
          {(!campaignMode || mapEditingMode) && (
            <div className="pt-4">
              <button
                onClick={async () => {
                  const confirmed = await confirm({ title: 'Delete Lane', message: 'Delete this jump lane?' });
                  if (confirmed) {
                    removeJumpLane(selectedLane.id);
                  }
                }}
                className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
              >
                Delete Lane
              </button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  // System selected
  if (!selectedSystem) return null;

  return (
    <SystemPropertiesPanel
      mapState={mapState}
      selectedSystem={selectedSystem}
      nameListHook={nameListHook}
      campaignMode={campaignMode}
      mapEditingMode={mapEditingMode}
      players={players}
      systemStatuses={systemStatuses}
      onSetSystemStatus={onSetSystemStatus}
      fowData={fowData}
      onDeleteUnits={onDeleteUnits}
      onCreateFleet={onCreateFleet}
      onEditFleet={onEditFleet}
      onMoveFleet={onMoveFleet}
      fleetDisplayOrder={fleetDisplayOrder}
      onReorderAnyFleet={onReorderAnyFleet}
      onMoveUnitToFleet={onMoveUnitToFleet}
      onMoveTemplateToFleet={onMoveTemplateToFleet}
      systemOwnership={systemOwnership}
      onChangeSystemOwner={onChangeSystemOwner}
      cmFleets={cmFleets}
      independentLists={independentLists}
      onEditCMFleet={onEditCMFleet}
      onMoveCMFleet={onMoveCMFleet}
      onDeleteCMUnits={onDeleteCMUnits}
      onMoveCMTemplateToFleet={onMoveCMTemplateToFleet}
    />
  );
}

// Fleet unit row with hull code + portal tooltip
function FleetUnitRow({ template, count, onDelete, draggable: isDraggable, onDragStart }: { template: EmpireUnit; count: number; onDelete?: (n: number) => void; draggable?: boolean; onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void }) {
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCount, setDeleteCount] = useState(1);
  const rowRef = useRef<HTMLDivElement>(null);

  const TOOLTIP_WIDTH = 208; // w-52
  const handleMouseEnter = () => {
    if (deleteOpen) return;
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      const spaceRight = window.innerWidth - rect.right - 8;
      const left = spaceRight >= TOOLTIP_WIDTH ? rect.right + 8 : rect.left - TOOLTIP_WIDTH - 8;
      setTooltipPos({ top: rect.top, left });
    }
  };

  const openDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTooltipPos(null);
    setDeleteCount(1);
    setDeleteOpen(true);
  };

  return (
    <div
      ref={rowRef}
      draggable={isDraggable || undefined}
      onDragStart={isDraggable ? onDragStart : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTooltipPos(null)}
      className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
    >
      <span className="text-gray-700 dark:text-gray-300">{template.name}</span>
      {template.hullCode !== 'N/A' && (
        <span className="text-gray-400 dark:text-gray-500">({template.hullCode})</span>
      )}
      {count > 1 && (
        <span className="font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
      )}
      {onDelete && (
        <button
          onClick={openDelete}
          className="flex-shrink-0 rounded p-0.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400"
          title={`Destroy ${template.name}`}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
            <path d="M6 2a1 1 0 00-1 1H3a1 1 0 000 2h10a1 1 0 000-2h-2a1 1 0 00-1-1H6zM4 7a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1zm4 0a1 1 0 011 1v4a1 1 0 01-2 0V8a1 1 0 011-1z" />
          </svg>
        </button>
      )}
      {deleteOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold dark:text-white">Destroy Units</h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
              {template.name}{template.hullCode !== 'N/A' ? ` (${template.hullCode})` : ''}
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 dark:text-gray-400">How many to destroy?</label>
              <input
                type="number"
                min={1}
                max={count}
                value={deleteCount}
                onChange={e => setDeleteCount(Math.min(count, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                autoFocus
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">of {count}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteOpen(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete!(deleteCount); setDeleteOpen(false); }}
                className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              >
                Destroy
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
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
          <div className="flex flex-wrap gap-x-2 text-xs text-gray-500 dark:text-gray-400">
            <span>DV:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{template.dv}</span></span>
            {template.as !== '-' && <span>AS:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{template.as}</span></span>}
            {template.af !== '-' && <span>AF:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{template.af}</span></span>}
            {template.cr !== '-' && <span>CR:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{template.cr}</span></span>}
            {template.cc !== '-' && <span>CC:<span className="ml-0.5 font-semibold text-gray-700 dark:text-gray-300">{template.cc}</span></span>}
          </div>
          {template.traits.length > 0 ? (
            <>
              <div className="my-1.5 mx-auto w-2/3 border-t border-gray-200 dark:border-gray-700" />
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {template.traits.map((t, i) => (
                  <span key={i}>{i > 0 && ', '}{t.name}{t.factor ? ` ${t.factor}` : ''}</span>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="my-1.5 mx-auto w-2/3 border-t border-gray-200 dark:border-gray-700" />
              <div className="text-[11px] italic text-gray-500 dark:text-gray-400">No traits</div>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

const FLEET_CATEGORY_ORDER: UnitCategory[] = ['Civilian', 'Ships', 'Fighters', 'Bases', 'Troops'];

// A single collapsible fleet entry — unified for both named and system fleets
interface FleetEntryProps {
  name: string;
  fleetKey: string;
  unitRows: Array<{ template: EmpireUnit; count: number; playerId?: string }>;
  onDeleteUnitsByTemplate?: (templateId: string, count: number) => void;
  ownerColors?: string[];     // colored dots shown before the fleet name
  subtitleBadges?: string;    // extra subtitle line, e.g. "Fast Fleet · Scout Fleet"
  onEdit?: () => void;
  onMove?: () => void;
  moveDisabled?: boolean;
  moveTitle?: string;
  gripDraggable?: boolean;    // shows a drag handle for fleet reordering
  onGripDragStart?: (e: React.DragEvent) => void;
  reorderDragOver?: boolean;  // highlight when being targeted for fleet reorder drop
  dragEnabled?: boolean;      // when true, unit rows are draggable (requires playerId in unitRows)
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

function FleetEntry({ name, fleetKey, unitRows, onDeleteUnitsByTemplate, ownerColors, subtitleBadges, onEdit, onMove, moveDisabled, moveTitle, gripDraggable, onGripDragStart, reorderDragOver, dragEnabled, isDragOver, onDragOver, onDragLeave, onDrop }: FleetEntryProps) {
  const [open, setOpen] = useState(false);

  // Category counts (omit zeros)
  const categoryCounts: Partial<Record<UnitCategory, number>> = {};
  for (const { template, count } of unitRows) {
    categoryCounts[template.category] = (categoryCounts[template.category] ?? 0) + count;
  }
  const categoryParts = FLEET_CATEGORY_ORDER
    .filter(cat => (categoryCounts[cat] ?? 0) > 0)
    .map(cat => `${categoryCounts[cat]} ${cat}`);

  // Highest CR
  const highestCR = unitRows.reduce((best, { template }) => {
    if (template.cr === '-') return best;
    return Math.max(best, template.cr as number);
  }, -Infinity);
  const crDisplay = highestCR > -Infinity ? highestCR : null;

  const hasButtons = !!(onEdit || onMove);

  return (
    <div
      className={isDragOver ? 'rounded ring-1 ring-blue-400 bg-blue-50/60 dark:bg-blue-900/20 dark:ring-blue-600' : reorderDragOver ? 'rounded ring-1 ring-green-400 bg-green-50/40 dark:bg-green-900/10 dark:ring-green-600' : ''}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-start">
        {gripDraggable && (
          <span
            draggable
            onDragStart={onGripDragStart}
            className="flex-shrink-0 cursor-grab select-none px-0.5 py-1 text-sm text-gray-300 hover:text-gray-500 active:cursor-grabbing dark:text-gray-600 dark:hover:text-gray-400"
            title="Drag to reorder fleet"
          >⠿</span>
        )}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(o => !o)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
          className={`flex flex-1 cursor-pointer items-start justify-between gap-1 rounded px-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800 ${hasButtons ? 'py-1.5' : 'py-1'}`}
        >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {ownerColors?.map((color, i) => (
              <span key={i} className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
            ))}
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{name}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
            {unitRows.length === 0 ? (
              <span className="italic">Empty</span>
            ) : (
              <>
                {categoryParts.join(', ')}
                {crDisplay !== null && <span className="ml-1">· CR {crDisplay}</span>}
              </>
            )}
          </div>
          {subtitleBadges && (
            <div className="mt-0.5 text-[11px] italic text-gray-400 dark:text-gray-500">{subtitleBadges}</div>
          )}
        </div>
        <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Edit fleet"
            >
              Edit
            </button>
          )}
          {onMove && (
            <button
              onClick={e => { e.stopPropagation(); if (!moveDisabled) onMove(); }}
              disabled={moveDisabled}
              className="rounded px-1.5 py-0.5 text-[11px] text-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-blue-950"
              title={moveTitle ?? 'Move fleet'}
            >
              Move
            </button>
          )}
          <span className="ml-0.5 text-gray-400 dark:text-gray-500">{open ? '−' : '+'}</span>
        </div>
        </div>
      </div>
      {open && unitRows.length > 0 && (
        <div className="mt-1 pl-2">
          {/* Hull code breakdown by category */}
          <div className="space-y-2">
            {FLEET_CATEGORY_ORDER
              .filter(cat => (categoryCounts[cat] ?? 0) > 0)
              .map(cat => {
                const hullBuckets: { key: string; label: string; count: number }[] = [];
                const seen: Record<string, number> = {};
                for (const { template, count } of unitRows) {
                  if (template.category !== cat) continue;
                  const key = template.hullCode !== 'N/A' ? template.hullCode : '__none__';
                  if (seen[key] === undefined) {
                    seen[key] = hullBuckets.length;
                    hullBuckets.push({
                      key,
                      label: template.hullCode !== 'N/A' ? template.hullCode : 'No hull code',
                      count: 0,
                    });
                  }
                  hullBuckets[seen[key]].count += count;
                }
                return (
                  <div key={cat}>
                    <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{cat}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-2">
                      {hullBuckets.map(({ key, label, count }) => (
                        <span key={key} className="text-xs text-gray-600 dark:text-gray-300">
                          {label} <span className="font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
          {/* Unit list with tooltips */}
          <div className="mt-2 space-y-0.5 border-t border-gray-200 pt-2 dark:border-gray-700">
            {unitRows.map(({ template, count, playerId }) => (
              <FleetUnitRow
                key={`${template.id}-${playerId ?? ''}`}
                template={template}
                count={count}
                onDelete={onDeleteUnitsByTemplate ? (n) => onDeleteUnitsByTemplate(template.id, n) : undefined}
                draggable={dragEnabled && !!playerId}
                onDragStart={dragEnabled && playerId ? (e) => {
                  e.dataTransfer.setData('text/plain', JSON.stringify({ templateId: template.id, templateName: template.name, playerId, fromFleetKey: fleetKey, count }));
                  e.dataTransfer.effectAllowed = 'move';
                } : undefined}
              />
            ))}
          </div>
        </div>
      )}
      {open && unitRows.length === 0 && (
        <p className="mt-0.5 py-0.5 pl-2 text-xs italic text-gray-400 dark:text-gray-600">Empty</p>
      )}
    </div>
  );
}

// Custom player picker dropdown with team color swatches
function PlayerColorSelect({ players, value, onChange }: {
  players: CampaignPlayer[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !(btnRef.current?.contains(e.target as Node)) &&
        !(dropRef.current?.contains(e.target as Node))
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggleOpen = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
    setOpen(o => !o);
  };

  const selected = players.find(p => p.id === value);

  return (
    <div className="mb-1">
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="flex w-full items-center gap-1.5 rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      >
        {selected?.teamColor && (
          <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: selected.teamColor }} />
        )}
        <span className={`flex-1 text-left ${!selected ? 'text-gray-400 dark:text-gray-500' : ''}`}>
          {selected?.name ?? 'Select player…'}
        </span>
        <span className="text-gray-400 dark:text-gray-500">▾</span>
      </button>
      {open && dropPos && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] overflow-hidden rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          style={{ top: dropPos.top, left: dropPos.left, width: dropPos.width }}
        >
          {players.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${value === p.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
            >
              {p.teamColor ? (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
              ) : (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full border border-gray-300 dark:border-gray-600" />
              )}
              <span className="dark:text-gray-200">{p.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Fleets section for the System Properties panel
interface FleetsSectionProps {
  players: CampaignPlayer[];
  systemId: string;
  systemOwnership?: Record<string, string>;
  onDeleteUnits?: (fleetKey: string, templateId: string, count: number, playerId?: string) => void;
  onCreateFleet?: (playerId: string, name: string, systemId: string) => void;
  onEditFleet?: (playerId: string, fleetId: string) => void;
  onMoveFleet?: (playerId: string, fleetId: string) => void;
  fleetDisplayOrder?: string[];
  onReorderAnyFleet?: (fromFleetId: string, targetFleetId: string) => void;
  onMoveTemplateToFleet?: (playerId: string, templateId: string, fromFleetKey: string, toFleetKey: string, count: number) => void;
  cmFleets?: CMFleet[];
  independentLists?: IndependentUnitList[];
  onEditCMFleet?: (fleetId: string) => void;
  onMoveCMFleet?: (fleetId: string) => void;
  onDeleteCMUnits?: (fleetId: string, templateId: string, count: number) => void;
  onMoveCMTemplateToFleet?: (fromFleetId: string, toFleetId: string, templateId: string, count: number) => void;
}

interface PendingDrop {
  templateId: string;
  templateName: string;
  playerId: string;
  fromFleetKey: string;
  toFleetKey: string;
  maxCount: number;
}

function FleetsSection({ players, systemId, systemOwnership, onDeleteUnits, onCreateFleet, onEditFleet, onMoveFleet, fleetDisplayOrder, onReorderAnyFleet, onMoveTemplateToFleet, cmFleets, independentLists, onEditCMFleet, onMoveCMFleet, onDeleteCMUnits, onMoveCMTemplateToFleet }: FleetsSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [newFleetName, setNewFleetName] = useState('');
  const [newFleetPlayerId, setNewFleetPlayerId] = useState('');
  const [showNewFleetInput, setShowNewFleetInput] = useState(false);
  const [newFleetError, setNewFleetError] = useState<string | null>(null);
  const [dragOverFleet, setDragOverFleet] = useState<string | null>(null);
  const [reorderDragOverKey, setReorderDragOverKey] = useState<string | null>(null);

  // Close the new-fleet form whenever the selected system changes
  useEffect(() => {
    setShowNewFleetInput(false);
    setNewFleetName('');
    setNewFleetPlayerId('');
    setNewFleetError(null);
  }, [systemId]);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const [dropCount, setDropCount] = useState(1);

  // Build per-player system fleet map: fleetName → playerId → rows
  // Each player gets their own separate entry for each system fleet they occupy.
  const perPlayerSysFleets = new Map<string, Map<string, Array<{ template: EmpireUnit; count: number }>>>();

  const ensureSysFleetEntry = (fleetName: string, playerId: string) => {
    if (!perPlayerSysFleets.has(fleetName)) perPlayerSysFleets.set(fleetName, new Map());
    const byPlayer = perPlayerSysFleets.get(fleetName)!;
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, []);
    return byPlayer.get(playerId)!;
  };

  for (const player of players) {
    for (const unit of player.units) {
      if (unit.systemId !== systemId) continue;
      const template = resolveUnitTemplate(player, unit.unitTemplateId, players);
      if (!template) continue;
      const isSystemFleet = !unit.fleetId || (SYSTEM_FLEET_NAMES as readonly string[]).includes(unit.fleetId);
      if (!isSystemFleet) continue;
      const fleetName = unit.fleetId ?? 'Unassigned';
      const rows = ensureSysFleetEntry(fleetName, player.id);
      const existing = rows.find(r => r.template.id === template.id);
      if (existing) { existing.count += 1; } else { rows.push({ template, count: 1 }); }
    }
  }

  // Always show On-Planet for the system owner (even if empty)
  const ownerPlayerId = systemOwnership?.[systemId];
  if (ownerPlayerId) {
    ensureSysFleetEntry('On-Planet', ownerPlayerId);
  }
  // Also ensure On-Planet for any player who has units at this system
  for (const player of players) {
    if (player.units.some(u => u.systemId === systemId)) {
      ensureSysFleetEntry('On-Planet', player.id);
    }
  }

  // Named fleets at this system (across all players)
  const namedFleetsHere: Array<{ fleet: CampaignFleet; player: CampaignPlayer; unitRows: Array<{ template: EmpireUnit; count: number; playerId: string }> }> = [];
  for (const player of players) {
    for (const fleet of (player.fleets ?? [])) {
      if (fleet.systemId !== systemId) continue;
      const fleetUnitMap: Record<string, { template: EmpireUnit; count: number; playerId: string }> = {};
      for (const unit of player.units) {
        if (unit.fleetId !== fleet.id) continue;
        const template = resolveUnitTemplate(player, unit.unitTemplateId, players);
        if (!template) continue;
        if (!fleetUnitMap[template.id]) fleetUnitMap[template.id] = { template, count: 0, playerId: player.id };
        fleetUnitMap[template.id].count += 1;
      }
      namedFleetsHere.push({ fleet, player, unitRows: Object.values(fleetUnitMap) });
    }
  }
  // Do not sort alphabetically — display in player order → player.fleets array order (supports reordering)

  // Smart default player for new fleet creation:
  // 1. System owner, 2. Sole owner of all fleets at this system, 3. None (ambiguous)
  const defaultNewFleetPlayerId = (() => {
    const ownerPid = systemOwnership?.[systemId];
    if (ownerPid) return ownerPid;
    const fleetPlayerIds = new Set(namedFleetsHere.map(f => f.player.id));
    if (fleetPlayerIds.size === 1) return [...fleetPlayerIds][0];
    return '';
  })();

  // CM fleets at this system + unit rows map for unified rendering
  const cmFleetsHereList = (cmFleets ?? []).filter(f => f.systemId === systemId);
  const allIndie = (independentLists ?? []).flatMap(l => l.units);
  const cmUnitRowsMap = new Map<string, Array<{ template: EmpireUnit; count: number; playerId: string }>>();
  for (const fleet of cmFleetsHereList) {
    const unitMap: Record<string, { template: EmpireUnit; count: number; playerId: string }> = {};
    for (const unit of fleet.units) {
      const tmpl = allIndie.find(u => u.id === unit.unitTemplateId);
      if (!tmpl) continue;
      if (!unitMap[tmpl.id]) unitMap[tmpl.id] = { template: tmpl, count: 0, playerId: 'cm' };
      unitMap[tmpl.id].count += 1;
    }
    cmUnitRowsMap.set(fleet.id, Object.values(unitMap));
  }

  // Unified ordered fleet ID list (player named + CM named), sorted by fleetDisplayOrder if provided
  const defaultOrderedIds = [
    ...namedFleetsHere.map(x => x.fleet.id),
    ...cmFleetsHereList.map(f => f.id),
  ];
  const orderedFleetIds = fleetDisplayOrder
    ? [
        ...fleetDisplayOrder.filter(id => defaultOrderedIds.includes(id)),
        ...defaultOrderedIds.filter(id => !fleetDisplayOrder.includes(id)),
      ]
    : defaultOrderedIds;

  const hasSysFleets = perPlayerSysFleets.size > 0;
  if (namedFleetsHere.length === 0 && cmFleetsHereList.length === 0 && !hasSysFleets) return null;

  const handleCreateFleet = () => {
    const name = newFleetName.trim();
    if (!name) { setNewFleetError('Fleet name cannot be empty.'); return; }
    if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(name)) { setNewFleetError('That name is reserved.'); return; }
    const targetPlayerId = players.length === 1 ? players[0].id : newFleetPlayerId;
    if (!targetPlayerId) { setNewFleetError('Please select a player.'); return; }
    const player = players.find(p => p.id === targetPlayerId);
    if (!player) return;
    const dup = (player.fleets ?? []).find(f => f.name === name);
    if (dup) { setNewFleetError('A fleet with that name already exists for this player.'); return; }
    onCreateFleet?.(targetPlayerId, name, systemId);
    setNewFleetName('');
    setNewFleetPlayerId('');
    setNewFleetError(null);
    setShowNewFleetInput(false);
  };

  // Drag & drop helpers
  const makeDragOver = (fleetKey: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (e.dataTransfer.types.includes('application/fleet-reorder')) {
      setReorderDragOverKey(fleetKey);
    } else {
      setDragOverFleet(fleetKey);
    }
  };
  const handleDragLeave = () => { setDragOverFleet(null); setReorderDragOverKey(null); };
  const makeDrop = (targetFleetKey: string, targetPlayerId?: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFleet(null);
    setReorderDragOverKey(null);
    // Fleet reorder drop
    if (e.dataTransfer.types.includes('application/fleet-reorder')) {
      const raw = e.dataTransfer.getData('application/fleet-reorder');
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as { fleetId: string; playerId: string };
        if (data.fleetId === targetFleetKey) return;
        if ((SYSTEM_FLEET_NAMES as readonly string[]).includes(targetFleetKey)) return;
        onReorderAnyFleet?.(data.fleetId, targetFleetKey);
      } catch { /* ignore */ }
      return;
    }
    // Unit drop
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { templateId: string; templateName: string; playerId: string; fromFleetKey: string; count: number };
      if (data.fromFleetKey === targetFleetKey) return;
      // CM fleet to CM fleet drop
      if (data.playerId === 'cm') {
        if (data.count > 1) {
          setDropCount(data.count);
          setPendingDrop({ templateId: data.templateId, templateName: data.templateName, playerId: 'cm', fromFleetKey: data.fromFleetKey, toFleetKey: targetFleetKey, maxCount: data.count });
        } else {
          onMoveCMTemplateToFleet?.(data.fromFleetKey, targetFleetKey, data.templateId, 1);
        }
        return;
      }
      // Named fleet targets only accept drops from the same player
      if (targetPlayerId && data.playerId !== targetPlayerId) return;
      if (data.count > 1) {
        // Show picker modal
        setDropCount(data.count);
        setPendingDrop({ templateId: data.templateId, templateName: data.templateName, playerId: data.playerId, fromFleetKey: data.fromFleetKey, toFleetKey: targetFleetKey, maxCount: data.count });
      } else {
        onMoveTemplateToFleet?.(data.playerId, data.templateId, data.fromFleetKey, targetFleetKey, 1);
      }
    } catch { /* ignore bad drag data */ }
  };

  return (
    <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-sm font-medium"
        >
          <span>Fleets</span>
          <span className="text-gray-500">{expanded ? '−' : '+'}</span>
        </button>
        {onCreateFleet && expanded && (
          <button
            onClick={() => { setNewFleetPlayerId(defaultNewFleetPlayerId); setShowNewFleetInput(o => !o); setNewFleetError(null); }}
            className="rounded px-1.5 py-0.5 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
            title="Create a new named fleet"
          >
            ＋ New Fleet
          </button>
        )}
      </div>

      {expanded && showNewFleetInput && (
        <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800">
          {players.length > 1 && (
            <PlayerColorSelect
              players={players}
              value={newFleetPlayerId}
              onChange={setNewFleetPlayerId}
            />
          )}
          <input
            type="text"
            placeholder="Fleet name…"
            value={newFleetName}
            onChange={e => { setNewFleetName(e.target.value); setNewFleetError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateFleet(); if (e.key === 'Escape') setShowNewFleetInput(false); }}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            autoFocus
          />
          <div className="mt-1 flex justify-end gap-1">
            <button
              onClick={() => { setShowNewFleetInput(false); setNewFleetError(null); }}
              className="rounded px-2 py-1 text-xs hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateFleet}
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
            >
              Create
            </button>
          </div>
          {newFleetError && <p className="mt-1 text-xs text-red-500">{newFleetError}</p>}
        </div>
      )}

      {expanded && (
        <div className="mt-2 space-y-1">
          {/* Named fleets (player + CM) in unified display order */}
          {orderedFleetIds.map(fleetId => {
            const pe = namedFleetsHere.find(x => x.fleet.id === fleetId);
            if (pe) {
              const { fleet, player, unitRows } = pe;
              const fleetUnits = player.units.filter(u => u.fleetId === fleet.id);
              const badges = computeFleetBadges(fleet, fleetUnits, player, players);
              const canMove = fleetUnits.length > 0;
              const badgeParts: string[] = [];
              if (badges.isFast) badgeParts.push('Fast Fleet');
              if (badges.isScout) badgeParts.push('Scout Fleet');
              if (badges.isCivilian) badgeParts.push('Civilian Fleet');
              if (fleet.movedThisTurn) badgeParts.push('Moved this turn');
              return (
                <FleetEntry
                  key={fleet.id}
                  fleetKey={fleet.id}
                  name={fleet.name}
                  unitRows={unitRows}
                  ownerColors={player.teamColor ? [player.teamColor] : undefined}
                  subtitleBadges={badgeParts.length > 0 ? badgeParts.join(' · ') : undefined}
                  onDeleteUnitsByTemplate={onDeleteUnits ? (templateId, n) => onDeleteUnits(fleet.id, templateId, n) : undefined}
                  onEdit={onEditFleet ? () => onEditFleet(player.id, fleet.id) : undefined}
                  onMove={onMoveFleet ? () => onMoveFleet(player.id, fleet.id) : undefined}
                  moveDisabled={!canMove}
                  moveTitle={!canMove ? 'No units to move' : fleet.movedThisTurn ? 'Already moved this turn — click to move again' : 'Move fleet'}
                  gripDraggable={!!onReorderAnyFleet}
                  onGripDragStart={onReorderAnyFleet ? (e) => {
                    e.dataTransfer.setData('application/fleet-reorder', JSON.stringify({ fleetId: fleet.id, playerId: player.id }));
                    e.dataTransfer.effectAllowed = 'move';
                  } : undefined}
                  reorderDragOver={reorderDragOverKey === fleet.id}
                  dragEnabled={!!onMoveTemplateToFleet}
                  isDragOver={dragOverFleet === fleet.id}
                  onDragOver={makeDragOver(fleet.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={makeDrop(fleet.id, player.id)}
                />
              );
            }
            const cmFleet = cmFleetsHereList.find(f => f.id === fleetId);
            if (cmFleet) {
              const unitRows = cmUnitRowsMap.get(fleetId) ?? [];
              const canMove = cmFleet.units.length > 0;
              return (
                <FleetEntry
                  key={cmFleet.id}
                  fleetKey={cmFleet.id}
                  name={cmFleet.name}
                  unitRows={unitRows}
                  ownerColors={cmFleet.color ? [cmFleet.color] : ['#6b7280']}
                  subtitleBadges="CM Fleet"
                  onDeleteUnitsByTemplate={onDeleteCMUnits ? (templateId, n) => onDeleteCMUnits(cmFleet.id, templateId, n) : undefined}
                  onEdit={onEditCMFleet ? () => onEditCMFleet(cmFleet.id) : undefined}
                  onMove={onMoveCMFleet ? () => onMoveCMFleet(cmFleet.id) : undefined}
                  moveDisabled={!canMove}
                  moveTitle={canMove ? 'Move fleet' : 'No units to move'}
                  gripDraggable={!!onReorderAnyFleet}
                  onGripDragStart={onReorderAnyFleet ? (e) => {
                    e.dataTransfer.setData('application/fleet-reorder', JSON.stringify({ fleetId: cmFleet.id, playerId: 'cm' }));
                    e.dataTransfer.effectAllowed = 'move';
                  } : undefined}
                  reorderDragOver={reorderDragOverKey === cmFleet.id}
                  dragEnabled={!!onMoveCMTemplateToFleet}
                  isDragOver={dragOverFleet === cmFleet.id}
                  onDragOver={makeDragOver(cmFleet.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={makeDrop(cmFleet.id)}
                />
              );
            }
            return null;
          })}

          {/* System fleets — one entry per (fleetName, player) */}
          {[...perPlayerSysFleets.entries()].flatMap(([fleetName, byPlayer]) =>
            [...byPlayer.entries()].map(([pid, rows]) => {
              const owner = players.find(p => p.id === pid);
              const compositeKey = `${fleetName}:${pid}`;
              const unitRows = rows.map(r => ({ ...r, playerId: pid }));
              return (
                <FleetEntry
                  key={compositeKey}
                  fleetKey={fleetName}
                  name={fleetName}
                  unitRows={unitRows}
                  ownerColors={owner?.teamColor ? [owner.teamColor] : undefined}
                  onDeleteUnitsByTemplate={onDeleteUnits && rows.length > 0 ? (templateId, n) => onDeleteUnits(fleetName, templateId, n, pid) : undefined}
                  dragEnabled={!!onMoveTemplateToFleet}
                  isDragOver={dragOverFleet === compositeKey}
                  onDragOver={makeDragOver(compositeKey)}
                  onDragLeave={handleDragLeave}
                  onDrop={makeDrop(fleetName, pid)}
                />
              );
            })
          )}
        </div>
      )}

      {/* Quantity picker modal for drag-and-drop when count > 1 */}
      {pendingDrop && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-72 rounded-lg border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold dark:text-white">Move Units</h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{pendingDrop.templateName}</p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 dark:text-gray-400">How many to move?</label>
              <input
                type="number"
                min={1}
                max={pendingDrop.maxCount}
                value={dropCount}
                onChange={e => setDropCount(Math.min(pendingDrop.maxCount, Math.max(1, Number(e.target.value) || 1)))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (pendingDrop.playerId === 'cm') {
                      onMoveCMTemplateToFleet?.(pendingDrop.fromFleetKey, pendingDrop.toFleetKey, pendingDrop.templateId, dropCount);
                    } else {
                      onMoveTemplateToFleet?.(pendingDrop.playerId, pendingDrop.templateId, pendingDrop.fromFleetKey, pendingDrop.toFleetKey, dropCount);
                    }
                    setPendingDrop(null);
                  }
                  if (e.key === 'Escape') setPendingDrop(null);
                }}
                className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-center text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                autoFocus
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">of {pendingDrop.maxCount}</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingDrop(null)}
                className="rounded px-3 py-1.5 text-sm hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (pendingDrop.playerId === 'cm') {
                    onMoveCMTemplateToFleet?.(pendingDrop.fromFleetKey, pendingDrop.toFleetKey, pendingDrop.templateId, dropCount);
                  } else {
                    onMoveTemplateToFleet?.(pendingDrop.playerId, pendingDrop.templateId, pendingDrop.fromFleetKey, pendingDrop.toFleetKey, dropCount);
                  }
                  setPendingDrop(null);
                }}
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

interface SystemPropertiesPanelProps {
  mapState: ReturnType<typeof useMapState>;
  selectedSystem: NonNullable<ReturnType<ReturnType<typeof useMapState>['getSystem']>>;
  nameListHook: ReturnType<typeof useNameLists>;
  campaignMode?: boolean;
  mapEditingMode?: boolean;
  players?: CampaignPlayer[];
  systemStatuses?: Record<string, SystemCampaignStatus>;
  onSetSystemStatus?: (systemId: string, patch: Partial<SystemCampaignStatus>) => void;
  fowData?: FowData | null;
  onDeleteUnits?: (systemId: string, fleetKey: string, templateId: string, count: number, playerId?: string) => void;
  onCreateFleet?: (playerId: string, name: string, systemId: string) => void;
  onEditFleet?: (playerId: string, fleetId: string) => void;
  onMoveFleet?: (playerId: string, fleetId: string) => void;
  fleetDisplayOrder?: string[];
  onReorderAnyFleet?: (fromFleetId: string, targetFleetId: string) => void;
  onMoveUnitToFleet?: (playerId: string, unitId: string, newFleetId: string) => void;
  onMoveTemplateToFleet?: (playerId: string, templateId: string, fromFleetKey: string, toFleetKey: string, systemId: string, count: number) => void;
  systemOwnership?: Record<string, string>;
  onChangeSystemOwner?: (systemId: string, newPlayerId: string | null) => void;
  independentSystemColors?: Record<string, string>;
  onSetIndependentSystemColor?: (sysId: string, color: string) => void;
  cmFleets?: CMFleet[];
  independentLists?: IndependentUnitList[];
  onEditCMFleet?: (fleetId: string) => void;
  onMoveCMFleet?: (fleetId: string) => void;
  onDeleteCMUnits?: (fleetId: string, templateId: string, count: number) => void;
  onMoveCMTemplateToFleet?: (fromFleetId: string, toFleetId: string, templateId: string, count: number) => void;
}

function SystemPropertiesPanel({ mapState, selectedSystem, nameListHook, campaignMode = false, mapEditingMode = false, players, systemStatuses, onSetSystemStatus, fowData, onDeleteUnits, onCreateFleet, onEditFleet, onMoveFleet, fleetDisplayOrder, onReorderAnyFleet, onMoveTemplateToFleet, systemOwnership, onChangeSystemOwner, cmFleets, independentLists, onEditCMFleet, onMoveCMFleet, onDeleteCMUnits, onMoveCMTemplateToFleet }: SystemPropertiesPanelProps) {
  const confirm = useConfirm();
  const {
    map,
    updateSystem,
    removeSystem,
    getLanesForSystem,
    setUseTeamColors,
    getHomeworlds,
  } = mapState;

  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [presetsExpanded, setPresetsExpanded] = useState(false);
  const [campaignStatusExpanded, setCampaignStatusExpanded] = useState(true);

  // In campaign mode without map editing, restrict what can be changed
  const restrictEditing = campaignMode && !mapEditingMode;

  const showFleets = campaignMode && players && players.length > 0;

  // Apply a preset system's properties to the selected system
  const handleApplyPreset = (preset: PresetSystem) => {
    updateSystem(selectedSystem.id, {
      name: preset.name,
      type: preset.type,
      starType: preset.starType,
      planetType: preset.planetType,
      traits: preset.traits.length > 0 ? preset.traits : undefined,
      attributes: preset.attributes,
    });
    setDetailsExpanded(true);
  };

  const homeworlds = getHomeworlds();
  const isHomeworld = selectedSystem.type === 'homeworld';

  // Calculate expected attributes from planet type and traits
  const calculatedAttributes = selectedSystem.planetType
    ? calculateAttributes(selectedSystem.planetType, selectedSystem.traits || [])
    : null;

  const isCustomAttributes = hasCustomAttributes(
    selectedSystem.attributes,
    selectedSystem.planetType,
    selectedSystem.traits || []
  );

  // Handle planet type change - recalculate attributes and derive importance
  const handlePlanetTypeChange = (planetType: PlanetType | '') => {
    if (planetType === '') {
      updateSystem(selectedSystem.id, {
        planetType: undefined,
        attributes: undefined,
        type: 'unimportant',
      });
    } else {
      const newAttributes = calculateAttributes(planetType, selectedSystem.traits || []);
      updateSystem(selectedSystem.id, {
        planetType,
        attributes: newAttributes,
        type: planetTypeImportance[planetType],
      });
    }
  };

  // Count occurrences of a trait
  const getTraitCount = (trait: SystemTrait): number => {
    return (selectedSystem.traits || []).filter((t) => t === trait).length;
  };

  // Total trait selections (max 2)
  const totalTraitCount = (selectedSystem.traits || []).length;

  // Handle trait count change (0, 1, or 2)
  const handleTraitChange = (trait: SystemTrait, delta: number) => {
    const currentTraits = selectedSystem.traits || [];
    const currentCount = getTraitCount(trait);
    const newCount = Math.max(0, Math.min(2, currentCount + delta));

    // Can't exceed 2 total traits
    if (delta > 0 && totalTraitCount >= 2) return;

    let newTraits: SystemTrait[];
    if (newCount > currentCount) {
      // Add one instance
      newTraits = [...currentTraits, trait];
    } else if (newCount < currentCount) {
      // Remove one instance
      const idx = currentTraits.indexOf(trait);
      newTraits = [...currentTraits.slice(0, idx), ...currentTraits.slice(idx + 1)];
    } else {
      return; // No change
    }

    // Recalculate attributes if we have a planet type
    const newAttributes = selectedSystem.planetType
      ? calculateAttributes(selectedSystem.planetType, newTraits)
      : undefined;

    updateSystem(selectedSystem.id, {
      traits: newTraits.length > 0 ? newTraits : undefined,
      attributes: newAttributes,
    });
  };

  // Handle attribute override
  const handleAttributeChange = (key: keyof SystemAttributes, value: number) => {
    const currentAttributes = selectedSystem.attributes || calculatedAttributes;
    if (!currentAttributes) return;

    updateSystem(selectedSystem.id, {
      attributes: {
        ...currentAttributes,
        [key]: value,
      },
    });
  };

  // Reset attributes to calculated values
  const handleResetAttributes = () => {
    if (!calculatedAttributes) return;
    updateSystem(selectedSystem.id, { attributes: calculatedAttributes });
  };

  // FoW intel view — read-only, shown when Fog of War is active outside map editing
  if (fowData && !mapEditingMode) {
    const intel: SystemIntelSnapshot | undefined =
      fowData.intel[selectedSystem.id] ?? fowData.initialIntel[selectedSystem.id];
    const ownerPlayer = intel?.ownerId ? players?.find(p => p.id === intel.ownerId) : undefined;
    const ownerName = ownerPlayer?.name ?? (intel?.ownerId ? 'Unknown' : 'Unknown / Uncolonized');
    const ownerColor = ownerPlayer?.teamColor;
    const turnLabel = intel ? (intel.turn === 0 ? 'Initial' : `Turn ${intel.turn}`) : null;

    // Build fleet groups from intel units, looking up templates from player empires
    const fowFleetMap: Record<string, Array<{ template: EmpireUnit; count: number }>> = {};
    if (intel) {
      for (const unit of intel.units) {
        const fleetKey = unit.fleetId ?? 'Unassigned';
        if (!fowFleetMap[fleetKey]) fowFleetMap[fleetKey] = [];
        const unitPlayer = unit.playerId ? players?.find(p => p.id === unit.playerId) : undefined;
        const template = unitPlayer ? resolveUnitTemplate(unitPlayer, unit.unitTemplateId, players) : undefined;
        if (template) {
          const existing = fowFleetMap[fleetKey].find(r => r.template.id === template.id);
          if (existing) { existing.count++; } else { fowFleetMap[fleetKey].push({ template, count: 1 }); }
        }
      }
    }
    const fowFleetNames = Object.keys(fowFleetMap);

    return (
      <aside className="w-64 overflow-y-auto border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-1 text-lg font-semibold dark:text-white">{selectedSystem.name}</h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">Fog of War — Read Only</p>
        {!intel ? (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No intel available</p>
        ) : (
          <div className="space-y-4">
            {/* Intel Status */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Intel Status</p>
              <p className="text-sm dark:text-gray-200">Last updated: {turnLabel}</p>
              <p className="flex items-center gap-1.5 text-sm dark:text-gray-200">
                Owner:&nbsp;
                {ownerColor && <span className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />}
                {ownerName}
              </p>
            </div>
            {/* Attributes */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Attributes (as of {turnLabel})
              </p>
              {intel.attributes ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {(Object.entries(intel.attributes) as [keyof SystemAttributes, number][]).map(([key, val]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{attrAbbrev[key]}</span>
                      <span className="dark:text-gray-200">{val}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">No attribute data</p>
              )}
            </div>
            {/* Fleets */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Fleets (as of {turnLabel})
              </p>
              {fowFleetNames.length > 0 ? (
                <div className="space-y-1">
                  {fowFleetNames.map(fleet => (
                    <FleetEntry key={fleet} fleetKey={fleet} name={fleet} unitRows={fowFleetMap[fleet]} />
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">None recorded</p>
              )}
            </div>
            {/* Connected Lanes */}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Jump Lanes (as of {turnLabel})
              </p>
              {intel.connectedLanes.length > 0 ? (
                <ul className="space-y-0.5 text-sm dark:text-gray-200">
                  {intel.connectedLanes.map((lane, i) => {
                    const targetName = map.systems.find(s => s.id === lane.toSystemId)?.name ?? lane.toSystemId;
                    const typeLabel = laneTypes.find(t => t.value === lane.type)?.label ?? lane.type;
                    return (
                      <li key={i}>
                        → {targetName} <span className="text-xs text-gray-500 dark:text-gray-400">({typeLabel})</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm italic text-gray-400 dark:text-gray-500">None recorded</p>
              )}
            </div>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="w-64 overflow-y-auto border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-4 text-lg font-semibold">System Properties</h2>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={selectedSystem.name}
              onChange={(e) => updateSystem(selectedSystem.id, { name: e.target.value })}
              className="flex-1 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
            />
            <button
              onClick={() => {
                const usedNames = mapState.map.systems
                  .filter(s => s.id !== selectedSystem.id)
                  .map(s => s.name);
                const randomName = nameListHook.getRandomName(usedNames);
                if (randomName) {
                  updateSystem(selectedSystem.id, { name: randomName });
                }
              }}
              className="flex-shrink-0 rounded border border-gray-300 px-1.5 py-1 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-700"
              title="Random name"
            >
              🎲
            </button>
          </div>
        </div>

        {/* Importance (derived from planet type) */}
        <div>
          <label className="mb-1 block text-sm font-medium">Importance</label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {systemTypes.find((t) => t.value === selectedSystem.type)?.label || 'Unimportant System'}
          </p>
        </div>

        {/* Position (read-only) */}
        <div>
          <label className="mb-1 block text-sm font-medium">Position</label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            q: {selectedSystem.position.q}, r: {selectedSystem.position.r}
          </p>
        </div>

        {/* Team Color section - only for homeworlds, hidden in campaign mode */}
        {isHomeworld && !campaignMode && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="mb-2 block text-sm font-medium">Team Color</label>
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded border border-gray-300 dark:border-gray-600"
                style={{ backgroundColor: selectedSystem.teamColor || '#888888' }}
              />
              <input
                type="color"
                value={selectedSystem.teamColor || '#888888'}
                onChange={(e) => updateSystem(selectedSystem.id, { teamColor: e.target.value })}
                className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <button
                onClick={() => updateSystem(selectedSystem.id, { teamColor: generateRandomTeamColor() })}
                className="rounded bg-gray-200 px-2 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                Random
              </button>
            </div>

            <div className="mt-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={map.useTeamColors || false}
                  onChange={(e) => setUseTeamColors(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm">Use Team Colors</span>
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Display team colors on all systems
              </p>
            </div>
          </div>
        )}

        {/* System Owner — campaign mode only (replaces Homeworld Owner tab) */}
        {campaignMode && !mapEditingMode && systemOwnership && onChangeSystemOwner && players && players.length > 0 && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="mb-1 block text-sm font-medium">System Owner</label>
            <ColorSelect
              value={systemOwnership[selectedSystem.id] ?? ''}
              onChange={value => onChangeSystemOwner(selectedSystem.id, value || null)}
              placeholder="Unowned"
              options={[
                { value: '', label: 'Unowned' },
                ...players.map(p => ({
                  value: p.id,
                  label: p.name,
                  color: p.teamColor,
                })),
              ]}
            />
          </div>
        )}

        {/* Owner dropdown - only for non-homeworlds when team colors enabled, hidden in campaign mode */}
        {!isHomeworld && !campaignMode && map.useTeamColors && homeworlds.length > 0 && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="mb-1 block text-sm font-medium">Owner</label>
            <ColorSelect
              value={selectedSystem.owner || ''}
              onChange={(value) => updateSystem(selectedSystem.id, { owner: value || undefined })}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...homeworlds.map((hw) => ({
                  value: hw.id,
                  label: hw.name,
                  color: hw.teamColor,
                })),
              ]}
            />
          </div>
        )}

        {/* System Details Section */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span>System Details</span>
            <span className="text-gray-500">{detailsExpanded ? '−' : '+'}</span>
          </button>

          {detailsExpanded && (
            <div className="mt-3 space-y-3">
              {/* Star Type (hidden in restricted campaign mode) */}
              {!restrictEditing && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Star Type
                  </label>
                  <select
                    value={selectedSystem.starType || ''}
                    onChange={(e) =>
                      updateSystem(selectedSystem.id, {
                        starType: e.target.value ? (e.target.value as StarType) : undefined,
                      })
                    }
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="">Not set</option>
                    {starTypeOptions.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Planet Type (hidden in restricted campaign mode) */}
              {!restrictEditing && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Planet Type
                  </label>
                  <select
                    value={selectedSystem.planetType || ''}
                    onChange={(e) => handlePlanetTypeChange(e.target.value as PlanetType | '')}
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="">Not set</option>
                    {planetTypeOptions.map((pt) => (
                      <option key={pt.value} value={pt.value}>
                        {pt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Planet Type display (read-only in restricted campaign mode) */}
              {restrictEditing && selectedSystem.planetType && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Planet Type
                  </label>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {planetTypeOptions.find(pt => pt.value === selectedSystem.planetType)?.label || selectedSystem.planetType}
                  </p>
                </div>
              )}

              {/* Traits (hidden in restricted campaign mode, read-only display instead) */}
              {!restrictEditing && selectedSystem.planetType && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Traits
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {totalTraitCount}/2
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {allTraits.map((trait) => {
                      const count = getTraitCount(trait);
                      const canAdd = totalTraitCount < 2 && count < 2;
                      const canRemove = count > 0;
                      return (
                        <div key={trait} className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleTraitChange(trait, -1)}
                              disabled={!canRemove}
                              className="flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-xs font-bold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
                            >
                              −
                            </button>
                            <span className="w-4 text-center text-xs font-medium">{count}</span>
                            <button
                              onClick={() => handleTraitChange(trait, 1)}
                              disabled={!canAdd}
                              className="flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-xs font-bold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-xs">
                            <span className="font-medium">{traitInfo[trait].name}</span>
                            <span className="ml-1 text-gray-500 dark:text-gray-400">
                              ({formatTraitModifiers(trait)})
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Traits display (read-only in restricted campaign mode) */}
              {restrictEditing && selectedSystem.traits && selectedSystem.traits.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                    Traits
                  </label>
                  <div className="space-y-1">
                    {selectedSystem.traits.map((trait, i) => (
                      <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
                        {traitInfo[trait].name} ({formatTraitModifiers(trait)})
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Attributes (only show if planet type is set) */}
              {selectedSystem.planetType && selectedSystem.attributes && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Attributes
                      {isCustomAttributes && !restrictEditing && (
                        <span className="ml-1 text-yellow-600 dark:text-yellow-400">(custom)</span>
                      )}
                    </label>
                    {isCustomAttributes && !restrictEditing && (
                      <button
                        onClick={handleResetAttributes}
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['capacity', 'raw', 'population', 'morale', 'intel', 'fortification'] as const).map(
                      (attr) => {
                        const epCostMultiplier: Partial<Record<keyof SystemAttributes, number>> = {
                          capacity: 10, population: 10, intel: 5, fortification: 5,
                        };
                        const mult = epCostMultiplier[attr];
                        const val = selectedSystem.attributes![attr];
                        return (
                          <div key={attr} className="flex items-center gap-1">
                            <label className="w-12 text-xs capitalize text-gray-500 dark:text-gray-400">
                              {attr === 'fortification' ? 'Fort' : attr.slice(0, 3).toUpperCase()}
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={val}
                              onChange={(e) =>
                                handleAttributeChange(attr, Math.max(0, parseInt(e.target.value, 10) || 0))
                              }
                              className="w-12 rounded border border-gray-300 bg-transparent px-1 py-0.5 text-xs dark:border-gray-700"
                            />
                            {campaignMode && mult && (
                              <span className="whitespace-nowrap text-[10px] text-gray-400 dark:text-gray-500">
                                {(val + 1) * mult}EP
                              </span>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preset Systems (hidden in restricted campaign mode) */}
        {!restrictEditing && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              onClick={() => setPresetsExpanded(!presetsExpanded)}
              className="flex w-full items-center justify-between text-sm font-medium"
            >
              <span>Preset Systems</span>
              <span className="text-gray-500">{presetsExpanded ? '−' : '+'}</span>
            </button>

            {presetsExpanded && (
              <div className="mt-3">
                <select
                  value=""
                  onChange={(e) => {
                    const [importance, name] = e.target.value.split('::');
                    const group = presetSystemsByImportance[importance];
                    const preset = group?.find((p) => p.name === name);
                    if (preset) handleApplyPreset(preset);
                  }}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Select a preset...</option>
                  {Object.entries(presetSystemsByImportance).map(([importance, systems]) => (
                    <optgroup key={importance} label={importance}>
                      {systems.map((preset) => (
                        <option key={preset.name} value={`${importance}::${preset.name}`}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Fleets section (campaign mode only) */}
        {showFleets && (
          <FleetsSection
            players={players!}
            systemId={selectedSystem.id}
            systemOwnership={systemOwnership}
            onDeleteUnits={onDeleteUnits ? (fleetKey, templateId, n, pid) => onDeleteUnits(selectedSystem.id, fleetKey, templateId, n, pid) : undefined}
            onCreateFleet={onCreateFleet}
            onEditFleet={onEditFleet}
            onMoveFleet={onMoveFleet}
            fleetDisplayOrder={fleetDisplayOrder}
            onReorderAnyFleet={onReorderAnyFleet}
            onMoveTemplateToFleet={onMoveTemplateToFleet ? (pid, tid, from, to, n) => onMoveTemplateToFleet(pid, tid, from, to, selectedSystem.id, n) : undefined}
            cmFleets={cmFleets}
            independentLists={independentLists}
            onEditCMFleet={onEditCMFleet}
            onMoveCMFleet={onMoveCMFleet}
            onDeleteCMUnits={onDeleteCMUnits}
            onMoveCMTemplateToFleet={onMoveCMTemplateToFleet}
          />
        )}

        {/* Campaign Status toggles (in_progress campaign mode only) */}
        {restrictEditing && systemStatuses !== undefined && onSetSystemStatus && (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              onClick={() => setCampaignStatusExpanded(e => !e)}
              className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <span>Campaign Status</span>
              <span>{campaignStatusExpanded ? '−' : '+'}</span>
            </button>
            {campaignStatusExpanded && (
              <div className="mt-2 space-y-1.5">
                {/* Blockaded By — player selector */}
                <div>
                  <span className="text-sm dark:text-gray-200">Blockaded By</span>
                  {players && players.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {players.map(p => {
                        const currentBlockadedBy = systemStatuses[selectedSystem.id]?.blockadedBy ?? [];
                        const isActive = currentBlockadedBy.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            onClick={() => {
                              const next = isActive
                                ? currentBlockadedBy.filter(id => id !== p.id)
                                : [...currentBlockadedBy, p.id];
                              onSetSystemStatus(selectedSystem.id, { blockadedBy: next });
                            }}
                            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs border transition-colors ${
                              isActive
                                ? 'border-blue-400 bg-blue-100 text-blue-800 dark:border-blue-500 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                            }`}
                          >
                            {p.teamColor && (
                              <span className="h-2 w-2 rounded-full" style={{ background: p.teamColor }} />
                            )}
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">No players</span>
                  )}
                </div>
                {/* Other boolean status flags */}
                {([
                  ['inOpposition', 'In Opposition'],
                  ['economicDisruption', 'Economic Disruption'],
                  ['rebellion', 'Rebellion'],
                  ['hasEnemyFleet', 'Enemy Fleet Present'],
                  ['industrialSabotage', 'Industrial Sabotage'],
                  ['guaranteedPirateRaid', 'Guaranteed Pirate Raid'],
                  ['beachhead', 'Beachhead Established'],
                ] as [keyof SystemCampaignStatus, string][]).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={systemStatuses[selectedSystem.id]?.[key] ?? false}
                      onChange={e => onSetSystemStatus(selectedSystem.id, { [key]: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="dark:text-gray-200">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete button (hidden in restricted campaign mode) */}
        {!restrictEditing && (
          <div className="pt-4">
            <button
              onClick={async () => {
                const laneCount = getLanesForSystem(selectedSystem.id).length;
                const name = selectedSystem.name || 'Unnamed';
                const message = laneCount > 0
                  ? `Delete "${name}" and its ${laneCount} connected lane(s)?`
                  : `Delete "${name}"?`;
                const confirmed = await confirm({ title: 'Delete System', message });
                if (confirmed) {
                  removeSystem(selectedSystem.id);
                }
              }}
              className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
            >
              Delete System
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
