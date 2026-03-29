import { useState, useMemo } from 'react';
import type { GameMap, CampaignPlayer, SystemCampaignStatus, SystemAttributes, System } from '../types';

interface SystemsOverviewViewProps {
  map: GameMap;
  players: CampaignPlayer[];
  systemOwnership: Record<string, string>;
  systemStatuses: Record<string, SystemCampaignStatus>;
  onSelectSystem: (systemId: string) => void;
  onClose: () => void;
}

const ATTR_COLS: { key: keyof SystemAttributes; label: string }[] = [
  { key: 'capacity', label: 'CAP' },
  { key: 'raw', label: 'RAW' },
  { key: 'population', label: 'POP' },
  { key: 'morale', label: 'MOR' },
  { key: 'intel', label: 'INT' },
  { key: 'fortification', label: 'FOR' },
];

const STATUS_KEYS: { key: keyof SystemCampaignStatus; label: string; color: string }[] = [
  { key: 'blockadedBy', label: 'Blockaded', color: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' },
  { key: 'inOpposition', label: 'In Opposition', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400' },
  { key: 'economicDisruption', label: 'Econ. Disruption', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400' },
  { key: 'rebellion', label: 'Rebellion', color: 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300' },
  { key: 'hasEnemyFleet', label: 'Enemy Fleet', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' },
  { key: 'industrialSabotage', label: 'Sabotage', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400' },
  { key: 'beachhead', label: 'Beachhead', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
];

type SortKey = 'name' | 'type' | keyof SystemAttributes | 'status';
type SortDir = 'asc' | 'desc';

function getActiveStatuses(status: SystemCampaignStatus | undefined): { label: string; color: string }[] {
  if (!status) return [];
  const result: { label: string; color: string }[] = [];
  for (const { key, label, color } of STATUS_KEYS) {
    const val = status[key];
    if (key === 'blockadedBy') {
      if (Array.isArray(val) && val.length > 0) result.push({ label, color });
    } else if (val) {
      result.push({ label, color });
    }
  }
  return result;
}

function SortChevron({ dir }: { dir: SortDir }) {
  return (
    <svg className="ml-0.5 inline-block h-3 w-3" viewBox="0 0 12 12" fill="currentColor">
      {dir === 'asc' ? (
        <path d="M6 3L10 8H2L6 3Z" />
      ) : (
        <path d="M6 9L2 4H10L6 9Z" />
      )}
    </svg>
  );
}

export function SystemsOverviewView({
  map,
  players,
  systemOwnership,
  systemStatuses,
  onSelectSystem,
  onClose,
}: SystemsOverviewViewProps) {
  const [activeTab, setActiveTab] = useState(0);
  const unownedTabIndex = players.length;
  const isUnowned = activeTab === unownedTabIndex;

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const systemsByOwner = useMemo(() => {
    const owned: Record<string, System[]> = {};
    const unowned: System[] = [];
    for (const p of players) owned[p.id] = [];
    for (const sys of map.systems) {
      const ownerId = systemOwnership[sys.id];
      if (ownerId && owned[ownerId]) {
        owned[ownerId].push(sys);
      } else {
        unowned.push(sys);
      }
    }
    return { owned, unowned };
  }, [map.systems, players, systemOwnership]);

  const ownerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of players) counts[p.id] = systemsByOwner.owned[p.id]?.length ?? 0;
    counts['__unowned__'] = systemsByOwner.unowned.length;
    return counts;
  }, [players, systemsByOwner]);

  const rawSystems = isUnowned
    ? systemsByOwner.unowned
    : systemsByOwner.owned[players[activeTab]?.id] ?? [];

  const activeSystems = useMemo(() => {
    const arr = [...rawSystems];
    if (!sortKey) {
      // Default: alphabetical by name
      arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return arr;
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') {
        return dir * (a.name || '').localeCompare(b.name || '');
      }
      if (sortKey === 'type') {
        return dir * (a.planetType || '').localeCompare(b.planetType || '');
      }
      if (sortKey === 'status') {
        const countA = getActiveStatuses(systemStatuses[a.id]).length;
        const countB = getActiveStatuses(systemStatuses[b.id]).length;
        return dir * (countA - countB);
      }
      // Numeric attribute
      const valA = a.attributes?.[sortKey] ?? 0;
      const valB = b.attributes?.[sortKey] ?? 0;
      return dir * (valA - valB);
    });
    return arr;
  }, [rawSystems, sortKey, sortDir, systemStatuses]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function headerClass(key: SortKey, align: 'left' | 'center' = 'left') {
    const active = sortKey === key;
    return `cursor-pointer select-none whitespace-nowrap px-1.5 py-2 ${
      align === 'center' ? 'text-center' : 'text-left'
    } ${active ? 'text-blue-600 dark:text-blue-400' : ''}`;
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            &larr; Close
          </button>
          <h1 className="text-base font-semibold dark:text-gray-100">Systems Overview</h1>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1">
          {players.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setActiveTab(i)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
                activeTab === i
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {p.teamColor && (
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
              )}
              {p.name}
              <span className={`text-xs ${activeTab === i ? 'opacity-70' : 'text-gray-400 dark:text-gray-500'}`}>
                ({ownerCounts[p.id]})
              </span>
            </button>
          ))}
          <button
            onClick={() => setActiveTab(unownedTabIndex)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
              isUnowned
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-gray-400" />
            Unowned
            <span className={`text-xs ${isUnowned ? 'opacity-70' : 'text-gray-400 dark:text-gray-500'}`}>
              ({ownerCounts['__unowned__']})
            </span>
          </button>
        </div>

        <div className="w-20" />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto max-w-4xl">
          {activeSystems.length === 0 ? (
            <p className="mt-8 text-center text-sm text-gray-400 dark:text-gray-500">No systems</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[160px]" />
                <col className="w-[90px]" />
                {ATTR_COLS.map(c => (
                  <col key={c.key} className="w-[58px]" />
                ))}
                <col /> {/* Status: takes remaining space */}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900">
                <tr className="border-b-2 border-gray-200 text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className={headerClass('name')} onClick={() => handleSort('name')}>
                    Name{sortKey === 'name' && <SortChevron dir={sortDir} />}
                  </th>
                  <th className={headerClass('type')} onClick={() => handleSort('type')}>
                    Type{sortKey === 'type' && <SortChevron dir={sortDir} />}
                  </th>
                  {ATTR_COLS.map(c => (
                    <th key={c.key} className={headerClass(c.key, 'center')} onClick={() => handleSort(c.key)}>
                      {c.label}{sortKey === c.key && <SortChevron dir={sortDir} />}
                    </th>
                  ))}
                  <th className={headerClass('status')} onClick={() => handleSort('status')}>
                    Status{sortKey === 'status' && <SortChevron dir={sortDir} />}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeSystems.map((sys, idx) => {
                  const statuses = getActiveStatuses(systemStatuses[sys.id]);
                  const zebra = idx % 2 === 1;
                  return (
                    <tr
                      key={sys.id}
                      onClick={() => onSelectSystem(sys.id)}
                      className={`cursor-pointer border-b border-gray-100 transition-colors hover:bg-blue-50 dark:border-gray-800 dark:hover:bg-blue-900/20 ${
                        zebra ? 'bg-gray-50/50 dark:bg-gray-800/25' : ''
                      }`}
                    >
                      <td className="truncate px-1.5 py-2 font-medium dark:text-gray-200" title={sys.name || sys.id}>
                        {sys.name || sys.id}
                      </td>
                      <td className="truncate px-1.5 py-2 capitalize text-gray-600 dark:text-gray-400">
                        {sys.planetType || '—'}
                      </td>
                      {ATTR_COLS.map(c => (
                        <td key={c.key} className="px-1.5 py-2 text-center tabular-nums dark:text-gray-300">
                          {sys.attributes ? sys.attributes[c.key] : '—'}
                        </td>
                      ))}
                      <td className="px-1.5 py-2">
                        {statuses.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {statuses.map(s => (
                              <span key={s.label} className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-tight ${s.color}`}>
                                {s.label}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
