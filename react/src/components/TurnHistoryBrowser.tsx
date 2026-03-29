import { useState, useMemo } from 'react';
import type { CampaignHistory, CampaignSnapshot, CampaignPlayer, GameMap, PhaseHistoryEntry, PhaseDiff, CampaignPhase, TurnPhase } from '../types';
import { computePhaseDiff, isDiffEmpty } from '../utils/historyDiffUtils';

interface TurnHistoryBrowserProps {
  history: CampaignHistory;
  currentSnapshot: CampaignSnapshot;
  players: CampaignPlayer[];
  map: GameMap;
  onClose: () => void;
}

const PHASE_LABELS: Record<CampaignPhase, string> = {
  setup: 'Setup',
  homeworld_selection: 'Homeworld Selection',
  system_purchase: 'System Purchase',
  galaxy_state_setup: 'Galaxy State Setup',
  lane_rolling: 'Lane Rolling',
  unit_purchase: 'Unit Purchase',
  unit_deployment: 'Unit Deployment',
  trade_routes: 'Trade Routes',
  in_progress: 'In Progress',
};

const TURN_PHASE_LABELS: Record<TurnPhase, string> = {
  economic: 'Economic',
  turn_orders: 'Turn Orders',
  intel: 'Intel',
  movement: 'Movement',
  diplomacy: 'Diplomacy',
  combat: 'Combat',
  supply: 'Supply',
  construction: 'Construction',
  tech: 'Tech',
  end_of_turn: 'End of Turn',
};

function formatPhaseLabel(entry: PhaseHistoryEntry): string {
  if (entry.phase !== 'in_progress') return PHASE_LABELS[entry.phase] ?? entry.phase;
  return entry.turnPhase ? TURN_PHASE_LABELS[entry.turnPhase] : 'In Progress';
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

type DiffSection = { title: string; items: Array<{ text: string; color: 'green' | 'red' | 'amber' }> };

function buildDiffSections(diff: PhaseDiff): DiffSection[] {
  const sections: DiffSection[] = [];

  if (diff.epSp.length > 0) {
    sections.push({
      title: 'Economy',
      items: diff.epSp.map(d => {
        const epChange = d.epAfter - d.epBefore;
        const spChange = d.spAfter - d.spBefore;
        const parts: string[] = [];
        if (epChange !== 0) parts.push(`EP: ${d.epBefore} → ${d.epAfter} (${epChange > 0 ? '+' : ''}${epChange})`);
        if (spChange !== 0) parts.push(`SP: ${d.spBefore} → ${d.spAfter} (${spChange > 0 ? '+' : ''}${spChange})`);
        return { text: `${d.playerName}: ${parts.join(', ')}`, color: 'amber' as const };
      }),
    });
  }

  if (diff.units.length > 0) {
    type UnitCount = Map<string, number>;
    const formatCounts = (counts: UnitCount) =>
      Array.from(counts.entries()).map(([name, n]) => `${n}x ${name}`).join(', ');

    // Grouped accumulators
    const addedGroups = new Map<string, { playerName: string; systemName: string; counts: UnitCount }>();
    const removedGroups = new Map<string, { playerName: string; systemName: string; counts: UnitCount }>();
    const reassignGroups = new Map<string, { playerName: string; fromFleet: string; toFleet: string; systemName: string; counts: UnitCount }>();
    const transferGroups = new Map<string, { fromPlayer: string; toPlayer: string; systemName: string; counts: UnitCount }>();
    const otherItems: Array<{ text: string; color: 'green' | 'red' | 'amber' }> = [];

    // Transfer detection: pair a 'removed' and 'added' entry with the same unit class
    // at the same system but belonging to different players. Matched entries are excluded
    // from the added/removed groups and shown as "transferred" instead.
    const usedForTransfer = new Set<typeof diff.units[number]>();
    const removedDiffs = diff.units.filter(d => d.type === 'removed');
    const addedDiffs   = diff.units.filter(d => d.type === 'added');
    for (const r of removedDiffs) {
      if (usedForTransfer.has(r)) continue;
      for (const a of addedDiffs) {
        if (usedForTransfer.has(a)) continue;
        if (r.unitClassName !== a.unitClassName) continue;
        if (r.systemId !== a.systemId) continue;
        if (r.playerId === a.playerId) continue;
        // Pair found — treat as a voluntary transfer
        usedForTransfer.add(r);
        usedForTransfer.add(a);
        const className = r.unitClassName ?? r.unitName;
        const key = `${r.playerName}||${a.playerName}||${r.systemId ?? ''}`;
        if (!transferGroups.has(key)) {
          transferGroups.set(key, { fromPlayer: r.playerName, toPlayer: a.playerName, systemName: r.systemName ?? '', counts: new Map() });
        }
        const g = transferGroups.get(key)!;
        g.counts.set(className, (g.counts.get(className) ?? 0) + 1);
        break;
      }
    }

    for (const d of diff.units) {
      if (usedForTransfer.has(d)) continue;
      const className = d.unitClassName ?? d.unitName;
      const sysLabel = d.systemName ?? '';

      if (d.type === 'added') {
        const key = `${d.playerName}||${sysLabel}`;
        if (!addedGroups.has(key)) addedGroups.set(key, { playerName: d.playerName, systemName: sysLabel, counts: new Map() });
        const g = addedGroups.get(key)!;
        g.counts.set(className, (g.counts.get(className) ?? 0) + 1);
      } else if (d.type === 'removed') {
        const key = `${d.playerName}||${sysLabel}`;
        if (!removedGroups.has(key)) removedGroups.set(key, { playerName: d.playerName, systemName: sysLabel, counts: new Map() });
        const g = removedGroups.get(key)!;
        g.counts.set(className, (g.counts.get(className) ?? 0) + 1);
      } else if (d.isReassignmentOnly) {
        const from = d.fromFleetName ?? 'Untasked';
        const to = d.toFleetName ?? 'Untasked';
        const key = `${d.playerName}||${from}||${to}||${sysLabel}`;
        if (!reassignGroups.has(key)) reassignGroups.set(key, { playerName: d.playerName, fromFleet: from, toFleet: to, systemName: sysLabel, counts: new Map() });
        const g = reassignGroups.get(key)!;
        g.counts.set(className, (g.counts.get(className) ?? 0) + 1);
      } else {
        const sysText = sysLabel ? ` at ${sysLabel}` : '';
        otherItems.push({
          text: `${d.playerName}'s ${d.unitName}${sysText}: ${d.details ?? 'changed'}`,
          color: 'amber',
        });
      }
    }

    const items: Array<{ text: string; color: 'green' | 'red' | 'amber' }> = [];
    for (const g of addedGroups.values()) {
      const sysText = g.systemName ? ` at ${g.systemName}` : '';
      items.push({ text: `${g.playerName} built${sysText}: ${formatCounts(g.counts)}`, color: 'green' });
    }
    for (const g of transferGroups.values()) {
      const sysText = g.systemName ? ` at ${g.systemName}` : '';
      items.push({ text: `${g.fromPlayer} transferred to ${g.toPlayer}${sysText}: ${formatCounts(g.counts)}`, color: 'amber' });
    }
    for (const g of removedGroups.values()) {
      const sysText = g.systemName ? ` at ${g.systemName}` : '';
      items.push({ text: `${g.playerName} lost${sysText}: ${formatCounts(g.counts)}`, color: 'red' });
    }
    for (const g of reassignGroups.values()) {
      const sysText = g.systemName ? ` at ${g.systemName}` : '';
      items.push({ text: `${g.playerName} assigned from ${g.fromFleet} to ${g.toFleet}${sysText}: ${formatCounts(g.counts)}`, color: 'amber' });
    }
    items.push(...otherItems);

    if (items.length > 0) sections.push({ title: 'Units', items });
  }

  if (diff.ownership.length > 0) {
    sections.push({
      title: 'System Ownership',
      items: diff.ownership.map(d => ({
        text: d.previousOwner && d.newOwner
          ? `${d.systemName}: ${d.previousOwner} → ${d.newOwner}`
          : d.newOwner
            ? `${d.systemName}: claimed by ${d.newOwner}`
            : `${d.systemName}: released by ${d.previousOwner}`,
        color: 'amber' as const,
      })),
    });
  }

  if (diff.diplomacy.length > 0) {
    sections.push({
      title: 'Diplomacy',
      items: diff.diplomacy.map(d => ({
        text: `${d.player1Name} ↔ ${d.player2Name}: ${d.previousLevel} → ${d.newLevel}`,
        color: 'amber' as const,
      })),
    });
  }

  if (diff.fleets.length > 0) {
    sections.push({
      title: 'Fleets',
      items: diff.fleets.map(d => ({
        text: d.type === 'added'
          ? `${d.ownerName} created fleet "${d.fleetName}"${d.systemName ? ` at ${d.systemName}` : ''}`
          : d.type === 'removed'
            ? `${d.ownerName} disbanded fleet "${d.fleetName}"${d.systemName ? ` at ${d.systemName}` : ''}`
            : `${d.ownerName}'s "${d.fleetName}": ${d.details}`,
        color: d.type === 'added' ? 'green' as const : d.type === 'removed' ? 'red' as const : 'amber' as const,
      })),
    });
  }

  if (diff.systemStatuses.length > 0) {
    sections.push({
      title: 'System Statuses',
      items: diff.systemStatuses.map(d => ({
        text: `${d.systemName}: ${d.field} changed`,
        color: 'amber' as const,
      })),
    });
  }

  if (diff.tradeRoutes.length > 0) {
    sections.push({
      title: 'Trade Routes',
      items: diff.tradeRoutes.map(d => ({
        text: d.type === 'added'
          ? `${d.playerName} established route: ${d.systemNames.join(' → ')}`
          : `${d.playerName} removed route: ${d.systemNames.join(' → ')}`,
        color: d.type === 'added' ? 'green' as const : 'red' as const,
      })),
    });
  }

  if (diff.tech.length > 0) {
    sections.push({
      title: 'Technology',
      items: diff.tech.map(d => {
        const parts: string[] = [];
        if (d.techPoolBefore !== d.techPoolAfter) {
          const change = d.techPoolAfter - d.techPoolBefore;
          parts.push(`Tech Pool: ${d.techPoolBefore} → ${d.techPoolAfter} (${change > 0 ? '+' : ''}${change})`);
        }
        if (d.unlockedUnits?.length) parts.push(`Unlocked: ${d.unlockedUnits.join(', ')}`);
        return { text: `${d.playerName}: ${parts.join('; ')}`, color: 'amber' as const };
      }),
    });
  }

  return sections;
}

const COLOR_CLASSES = {
  green: 'text-green-700 dark:text-green-400',
  red: 'text-red-700 dark:text-red-400',
  amber: 'text-amber-700 dark:text-amber-400',
} as const;

const DOT_CLASSES = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
} as const;

export function TurnHistoryBrowser({ history, currentSnapshot, players, map, onClose }: TurnHistoryBrowserProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(history.entries.length - 1);

  // Group entries by turn number
  const turnGroups = useMemo(() => {
    const groups: Map<number, PhaseHistoryEntry[]> = new Map();
    for (const entry of history.entries) {
      const arr = groups.get(entry.turn) ?? [];
      arr.push(entry);
      groups.set(entry.turn, arr);
    }
    return groups;
  }, [history.entries]);

  // Current turn = the turn of the most recent entry; start with all others collapsed
  const currentTurn = history.entries.length > 0 ? history.entries[history.entries.length - 1].turn : -1;
  const [collapsedTurns, setCollapsedTurns] = useState<Set<number>>(
    () => new Set(Array.from(turnGroups.keys()).filter(t => t !== currentTurn))
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleTurn = (turn: number) => setCollapsedTurns(prev => {
    const next = new Set(prev);
    next.has(turn) ? next.delete(turn) : next.add(turn);
    return next;
  });

  const toggleSection = (title: string) => setCollapsedSections(prev => {
    const next = new Set(prev);
    next.has(title) ? next.delete(title) : next.add(title);
    return next;
  });

  // Compute diff for selected entry
  const selectedDiff = useMemo((): PhaseDiff | null => {
    if (selectedIndex < 0 || selectedIndex >= history.entries.length) return null;
    const beforeSnap = history.entries[selectedIndex].snapshot;
    const afterSnap = selectedIndex < history.entries.length - 1
      ? history.entries[selectedIndex + 1].snapshot
      : currentSnapshot;
    return computePhaseDiff(beforeSnap, afterSnap, map);
  }, [selectedIndex, history.entries, currentSnapshot, map]);

  const selectedEntry = history.entries[selectedIndex];
  const sections = selectedDiff ? buildDiffSections(selectedDiff) : [];
  const isCurrentPhase = selectedIndex === history.entries.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex bg-black/50">
      <div className="flex h-full w-full max-w-5xl mx-auto my-4 overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-gray-900">

        {/* Left sidebar: Timeline */}
        <div className="w-64 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Campaign History</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
              &times;
            </button>
          </div>

          {Array.from(turnGroups.entries()).map(([turn, entries]) => {
            const isCollapsed = collapsedTurns.has(turn);
            const label = turn === 0 ? 'Setup' : `Turn ${turn}`;
            return (
              <div key={turn}>
                <button
                  onClick={() => toggleTurn(turn)}
                  className="flex w-full items-center gap-1.5 px-4 py-2 text-left text-xs font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <svg
                    className={`h-2.5 w-2.5 shrink-0 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                    fill="currentColor" viewBox="0 0 20 20"
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  {label}
                  <span className="ml-auto font-normal normal-case text-gray-400 dark:text-gray-500">
                    {entries.length}
                  </span>
                </button>
                {!isCollapsed && entries.map((entry) => {
                  const idx = history.entries.indexOf(entry);
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedIndex(idx)}
                      className={`block w-full px-4 py-1.5 text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      <div className="font-medium">{formatPhaseLabel(entry)}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400">{formatTimestamp(entry.timestamp)}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Right panel: Diff view */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedEntry && (
            <>
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {formatPhaseLabel(selectedEntry)}
                  {isCurrentPhase && (
                    <span className="ml-2 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                      Current
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Changes {isCurrentPhase ? 'so far this phase' : 'during this phase'}
                </p>
              </div>

              {selectedDiff && isDiffEmpty(selectedDiff) ? (
                <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400">
                  No changes recorded during this phase.
                </div>
              ) : (
                <div className="space-y-3">
                  {sections.map((section) => {
                    const isCollapsed = collapsedSections.has(section.title);
                    return (
                      <div key={section.title} className="rounded border border-gray-100 dark:border-gray-700/60">
                        <button
                          onClick={() => toggleSection(section.title)}
                          className="flex w-full items-center gap-1.5 px-3 py-2 text-left"
                        >
                          <svg
                            className={`h-2.5 w-2.5 shrink-0 text-gray-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                            fill="currentColor" viewBox="0 0 20 20"
                          >
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {section.title}
                          </span>
                          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{section.items.length}</span>
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-1 border-t border-gray-100 px-3 pb-3 pt-2 dark:border-gray-700/60">
                            {section.items.map((item, ii) => (
                              <div key={ii} className="flex items-start gap-2 text-sm">
                                <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT_CLASSES[item.color]}`} />
                                <span className={COLOR_CLASSES[item.color]}>{item.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
