import { useState, useMemo, useRef, useEffect } from 'react';
import type { CampaignPlayer, CampaignUnit, GameMap } from '../types';
import { resolveUnitTemplate } from '../utils/fleetUtils';

// ---------------------------------------------------------------------------
// PlayerPicker
// ---------------------------------------------------------------------------

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
    <div ref={ref} className="relative min-w-52">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        {selected ? (
          <>
            {selected.teamColor && (
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: selected.teamColor }} />
            )}
            <span className="flex-1 text-left">{selected.name}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500">{selected.empire.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-gray-400">{placeholder ?? '— Select —'}</span>
        )}
        <svg
          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-full min-w-max rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
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
              className={`flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800 ${
                p.id === value ? 'bg-blue-50 dark:bg-blue-950/30' : ''
              }`}
            >
              {p.teamColor && (
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.teamColor }} />
              )}
              <span className="flex-1 text-left">{p.name}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{p.empire.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferUnitViewProps {
  players: CampaignPlayer[];
  map: GameMap;
  onTransfer: (unitIds: string[], fromPlayerId: string, toPlayerId: string) => void;
  onClose: () => void;
}

type GroupEntry = { key: string; label: string; units: CampaignUnit[] };
type SystemEntry = { systemId: string; groups: GroupEntry[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveUnitName(unit: CampaignUnit, player: CampaignPlayer, allPlayers?: CampaignPlayer[]): string {
  if (unit.name) return unit.name;
  const template = resolveUnitTemplate(player, unit.unitTemplateId, allPlayers);
  return template?.name ?? unit.unitTemplateId;
}

function resolveTemplateName(unit: CampaignUnit, player: CampaignPlayer, allPlayers?: CampaignPlayer[]): string {
  const template = resolveUnitTemplate(player, unit.unitTemplateId, allPlayers);
  return template?.name ?? unit.unitTemplateId;
}

// ---------------------------------------------------------------------------
// TransferUnitView
// ---------------------------------------------------------------------------

export function TransferUnitView({ players, map, onTransfer, onClose }: TransferUnitViewProps) {
  const [fromPlayerId, setFromPlayerId] = useState(players[0]?.id ?? '');
  const [toPlayerId, setToPlayerId] = useState('');
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [expandedSystems, setExpandedSystems] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const fromPlayer = players.find(p => p.id === fromPlayerId);

  const handleSetFromPlayer = (id: string) => {
    setFromPlayerId(id);
    setSelectedUnitIds(new Set());
    setExpandedGroups(new Set());
    // Clear recipient if they were the same as the new from-player
    setToPlayerId(prev => (prev === id ? '' : prev));
  };

  const groupExpandKey = (systemId: string, groupKey: string) => `${systemId}::${groupKey}`;

  const toggleGroupExpand = (systemId: string, groupKey: string) => {
    const key = groupExpandKey(systemId, groupKey);
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Build systemEntries: system → named fleet groups + system-fleet groups
  const systemEntries = useMemo((): SystemEntry[] => {
    if (!fromPlayer) return [];

    const sysMap = new Map<string, SystemEntry>();
    const getOrCreate = (sid: string): SystemEntry => {
      if (!sysMap.has(sid)) sysMap.set(sid, { systemId: sid, groups: [] });
      return sysMap.get(sid)!;
    };

    // Named fleets first
    for (const fleet of fromPlayer.fleets ?? []) {
      if (!fleet.systemId) continue;
      const entry = getOrCreate(fleet.systemId);
      const units = fromPlayer.units.filter(u => u.fleetId === fleet.id);
      if (units.length > 0) {
        entry.groups.push({ key: fleet.id, label: fleet.name, units });
      }
    }

    const namedFleetIds = new Set((fromPlayer.fleets ?? []).map(f => f.id));

    // Remaining units (system fleets / unassigned)
    for (const unit of fromPlayer.units) {
      if (!unit.systemId) continue;
      if (unit.fleetId && namedFleetIds.has(unit.fleetId)) continue; // already handled
      const entry = getOrCreate(unit.systemId);
      const groupKey = unit.fleetId ?? 'Unassigned';
      let group = entry.groups.find(g => g.key === groupKey);
      if (!group) {
        group = { key: groupKey, label: groupKey, units: [] };
        entry.groups.push(group);
      }
      group.units.push(unit);
    }

    // Sort: owned systems first, then alphabetically
    const ownedIds = new Set([
      ...(fromPlayer.ownedSystemIds ?? []),
      ...(fromPlayer.homeworldId ? [fromPlayer.homeworldId] : []),
    ]);
    const entries = [...sysMap.values()].filter(e => e.groups.some(g => g.units.length > 0));
    entries.sort((a, b) => {
      const aOwned = ownedIds.has(a.systemId);
      const bOwned = ownedIds.has(b.systemId);
      if (aOwned !== bOwned) return aOwned ? -1 : 1;
      const aName = map.systems.find(s => s.id === a.systemId)?.name ?? a.systemId;
      const bName = map.systems.find(s => s.id === b.systemId)?.name ?? b.systemId;
      return aName.localeCompare(bName);
    });
    return entries;
  }, [fromPlayer, map]);

  const toggleSystem = (systemId: string) => {
    setExpandedSystems(prev => {
      const next = new Set(prev);
      next.has(systemId) ? next.delete(systemId) : next.add(systemId);
      return next;
    });
  };

  const toggleUnit = (unitId: string) => {
    setSelectedUnitIds(prev => {
      const next = new Set(prev);
      next.has(unitId) ? next.delete(unitId) : next.add(unitId);
      return next;
    });
  };

  const toggleGroup = (units: CampaignUnit[]) => {
    const ids = units.map(u => u.id);
    const allSelected = ids.every(id => selectedUnitIds.has(id));
    setSelectedUnitIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const toggleSystem_units = (sys: SystemEntry) => {
    const ids = sys.groups.flatMap(g => g.units.map(u => u.id));
    const allSelected = ids.every(id => selectedUnitIds.has(id));
    setSelectedUnitIds(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  const handleTransfer = () => {
    if (selectedUnitIds.size === 0 || !toPlayerId || !fromPlayerId) return;
    onTransfer([...selectedUnitIds], fromPlayerId, toPlayerId);
    onClose();
  };

  const canTransfer = selectedUnitIds.size > 0 && !!toPlayerId;
  const selectedCount = selectedUnitIds.size;

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
          <h1 className="text-base font-semibold dark:text-gray-100">Transfer Units</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">Transfer to:</span>
          <PlayerPicker
            players={players}
            value={toPlayerId}
            onChange={setToPlayerId}
            placeholder="— Select recipient —"
            excludeId={fromPlayerId}
          />
          <button
            onClick={handleTransfer}
            disabled={!canTransfer}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            Transfer{selectedCount > 0 ? ` ${selectedCount}` : ''} Unit{selectedCount !== 1 ? 's' : ''} →
          </button>
        </div>
      </div>

      {/* From-player pill tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-6 py-2 dark:border-gray-700">
        <span className="shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">From:</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {players.map(p => (
            <button
              key={p.id}
              onClick={() => handleSetFromPlayer(p.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                p.id === fromPlayerId
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {p.teamColor && (
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
              )}
              <span className="flex flex-col items-start leading-tight">
                <span>{p.name}</span>
                <span className="text-[11px] font-normal opacity-70">{p.empire.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {!fromPlayer || systemEntries.length === 0 ? (
          <p className="text-sm italic text-gray-400 dark:text-gray-500">No units to transfer.</p>
        ) : (
          <div className="mx-auto max-w-4xl space-y-3">
            {systemEntries.map(sys => {
              const systemName = map.systems.find(s => s.id === sys.systemId)?.name ?? sys.systemId;
              const isExpanded = expandedSystems.has(sys.systemId);
              const sysUnitIds = sys.groups.flatMap(g => g.units.map(u => u.id));
              const sysSelectedCount = sysUnitIds.filter(id => selectedUnitIds.has(id)).length;
              const allSysSelected = sysUnitIds.length > 0 && sysUnitIds.every(id => selectedUnitIds.has(id));
              const someSysSelected = sysSelectedCount > 0 && !allSysSelected;

              return (
                <div key={sys.systemId} className="rounded-lg border border-gray-200 dark:border-gray-700">
                  {/* System header */}
                  <div className="flex items-center gap-2 px-4 py-3">
                    {/* System-level select-all checkbox */}
                    <button
                      onClick={() => toggleSystem_units(sys)}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                        allSysSelected
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : someSysSelected
                          ? 'border-blue-400 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                          : 'border-gray-300 hover:border-gray-400 dark:border-gray-600'
                      }`}
                      title={allSysSelected ? 'Deselect all in system' : 'Select all in system'}
                    >
                      {(allSysSelected || someSysSelected) && '✓'}
                    </button>
                    <button
                      onClick={() => toggleSystem(sys.systemId)}
                      className="flex flex-1 items-center gap-3 text-left hover:opacity-80"
                    >
                      <span className="text-xs text-gray-400 dark:text-gray-600">{isExpanded ? '▼' : '▶'}</span>
                      <span className="flex-1 text-sm font-semibold dark:text-gray-100">{systemName}</span>
                      {sysSelectedCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                          {sysSelectedCount} selected
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {sysUnitIds.length} unit{sysUnitIds.length !== 1 ? 's' : ''}
                      </span>
                    </button>
                  </div>

                  {/* Fleet groups */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-700">
                      {sys.groups.map(group => {
                        const allGroupSelected = group.units.length > 0 && group.units.every(u => selectedUnitIds.has(u.id));
                        const someGroupSelected = group.units.some(u => selectedUnitIds.has(u.id)) && !allGroupSelected;
                        const isGroupExpanded = expandedGroups.has(groupExpandKey(sys.systemId, group.key));

                        return (
                          <div key={group.key} className="px-4 py-2">
                            {/* Fleet header row */}
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleGroup(group.units)}
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                                  allGroupSelected
                                    ? 'border-blue-500 bg-blue-500 text-white'
                                    : someGroupSelected
                                    ? 'border-blue-400 bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400'
                                    : 'border-gray-300 hover:border-gray-400 dark:border-gray-600'
                                }`}
                                title={allGroupSelected ? 'Deselect all in fleet' : 'Select all in fleet'}
                              >
                                {(allGroupSelected || someGroupSelected) && '✓'}
                              </button>
                              <button
                                onClick={() => toggleGroupExpand(sys.systemId, group.key)}
                                className="flex flex-1 items-center gap-2 text-left hover:opacity-80"
                              >
                                <span className="text-xs text-gray-400 dark:text-gray-600">{isGroupExpanded ? '▼' : '▶'}</span>
                                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                  {group.label}
                                </span>
                                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                                  {group.units.length} unit{group.units.length !== 1 ? 's' : ''}
                                  {someGroupSelected || allGroupSelected ? ` · ${group.units.filter(u => selectedUnitIds.has(u.id)).length} selected` : ''}
                                </span>
                              </button>
                            </div>

                            {/* Unit rows — only when expanded */}
                            {isGroupExpanded && <div className="mt-2 space-y-1 pl-6">
                              {group.units.map(unit => {
                                const isSelected = selectedUnitIds.has(unit.id);
                                const displayName = resolveUnitName(unit, fromPlayer, players);
                                const templateName = resolveTemplateName(unit, fromPlayer, players);
                                const showTemplate = unit.name && unit.name !== templateName;

                                return (
                                  <button
                                    key={unit.id}
                                    onClick={() => toggleUnit(unit.id)}
                                    className={`flex w-full items-center gap-3 rounded px-3 py-1.5 text-left text-sm transition-colors ${
                                      isSelected
                                        ? 'bg-blue-50 dark:bg-blue-900/20'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                                  >
                                    <span
                                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs transition-colors ${
                                        isSelected
                                          ? 'border-blue-500 bg-blue-500 text-white'
                                          : 'border-gray-300 dark:border-gray-600'
                                      }`}
                                    >
                                      {isSelected && '✓'}
                                    </span>
                                    <span className="font-medium dark:text-gray-100">{displayName}</span>
                                    {showTemplate && (
                                      <span className="text-xs text-gray-400 dark:text-gray-500">({templateName})</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
