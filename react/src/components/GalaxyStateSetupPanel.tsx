import { useState, useCallback, useMemo } from 'react';
import type { Campaign, CampaignPlayer, CampaignSettings, GameMap } from '../types';

interface GalaxyStateSetupPanelProps {
  players: CampaignPlayer[];
  map: GameMap;
  systemOwnership: Record<string, string>;
  settings: CampaignSettings;
  galaxyStateLog: Campaign['galaxyStateLog'];
  onSetLog: (patch: Partial<NonNullable<Campaign['galaxyStateLog']>>) => void;
  onFinish: () => void;
  onOpenAddUnits: () => void;
}

function roll1d10(): number { return Math.ceil(Math.random() * 10); }

export function GalaxyStateSetupPanel({
  map,
  systemOwnership,
  settings,
  galaxyStateLog,
  onSetLog,
  onFinish,
  onOpenAddUnits,
}: GalaxyStateSetupPanelProps) {
  const [indLog, setIndLog] = useState<string[]>([]);
  const [raiderLog, setRaiderLog] = useState<string[]>([]);

  const log = galaxyStateLog ?? {
    independents: [],
    raiderSystems: [],
    independentChecked: {},
    raiderChecked: {},
  };

  const unownedSystems = useMemo(
    () => map.systems.filter(s => !systemOwnership[s.id]),
    [map.systems, systemOwnership],
  );

  const rollIndependents = useCallback(() => {
    const lines: string[] = ['=== Independent Systems Roll ==='];
    const independents: string[] = [];
    for (const sys of unownedSystems) {
      const pop = sys.attributes?.population ?? 0;
      if (pop === 0) {
        lines.push(`  ${sys.name}: population 0, skipped`);
        continue;
      }
      const r1 = roll1d10();
      const r2 = roll1d10();
      const total = r1 + r2;
      const hit = total < pop;
      lines.push(`  ${sys.name}: 2d10 = ${r1}+${r2}=${total} vs pop ${pop} → ${hit ? 'INDEPENDENT' : 'not independent'}`);
      if (hit) independents.push(sys.id);
    }
    lines.push(`${independents.length} system(s) become independent.`);
    setIndLog(lines);
    onSetLog({ independents, independentChecked: {} });
  }, [unownedSystems, onSetLog]);

  const rollRaiderSystems = useCallback(() => {
    const lines: string[] = ['=== Hostile Galaxy Roll ==='];
    const raiderSystems: string[] = [];
    for (const sys of unownedSystems) {
      const cap = sys.attributes?.capacity ?? 0;
      if (cap === 0) {
        lines.push(`  ${sys.name}: capacity 0, skipped`);
        continue;
      }
      const roll = roll1d10();
      const hit = roll < cap;
      lines.push(`  ${sys.name}: 1d10 = ${roll} vs capacity ${cap} → ${hit ? 'RAIDER SYSTEM' : 'not raider'}`);
      if (hit) raiderSystems.push(sys.id);
    }
    lines.push(`${raiderSystems.length} system(s) become raider systems.`);
    setRaiderLog(lines);
    onSetLog({ raiderSystems, raiderChecked: {} });
  }, [unownedSystems, onSetLog]);

  const toggleIndChecked = (sysId: string) => {
    onSetLog({
      independentChecked: {
        ...log.independentChecked,
        [sysId]: !log.independentChecked[sysId],
      },
    });
  };

  const toggleRaiderChecked = (sysId: string) => {
    onSetLog({
      raiderChecked: {
        ...log.raiderChecked,
        [sysId]: !log.raiderChecked[sysId],
      },
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <h2 className="text-lg font-semibold dark:text-gray-100">Galaxy State Setup</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Roll to determine which unowned systems become Independent or Raider Systems before the game begins.
      </p>

      {/* Independent Systems Log */}
      {settings.rules.independentSystems && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/40 dark:bg-blue-900/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
              Independent Systems (2d10 &lt; Population)
            </span>
            <button
              onClick={rollIndependents}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {log.independents.length > 0 ? 'Reroll' : 'Roll'}
            </button>
          </div>
          {indLog.length > 0 && (
            <div className="mb-2 max-h-32 overflow-y-auto rounded bg-gray-900 p-2">
              <pre className="select-text whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-200">
                {indLog.join('\n')}
              </pre>
            </div>
          )}
          {log.independents.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Independents List:</p>
              {log.independents.map(sysId => {
                const sys = map.systems.find(s => s.id === sysId);
                return (
                  <label key={sysId} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!log.independentChecked[sysId]}
                      onChange={() => toggleIndChecked(sysId)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={log.independentChecked[sysId] ? 'text-gray-400 line-through' : 'dark:text-gray-100'}>
                      {sys?.name ?? sysId}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Hostile Galaxy Log */}
      {settings.rules.hostileGalaxy && (
        <div className="rounded border border-red-200 bg-red-50 p-3 dark:border-red-800/40 dark:bg-red-900/10">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-red-800 dark:text-red-300">
              Hostile Galaxy (1d10 &lt; Capacity)
            </span>
            <button
              onClick={rollRaiderSystems}
              className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              {log.raiderSystems.length > 0 ? 'Reroll' : 'Roll'}
            </button>
          </div>
          {raiderLog.length > 0 && (
            <div className="mb-2 max-h-32 overflow-y-auto rounded bg-gray-900 p-2">
              <pre className="select-text whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-200">
                {raiderLog.join('\n')}
              </pre>
            </div>
          )}
          {log.raiderSystems.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-red-700 dark:text-red-400">Raider Systems List:</p>
              {log.raiderSystems.map(sysId => {
                const sys = map.systems.find(s => s.id === sysId);
                return (
                  <label key={sysId} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!log.raiderChecked[sysId]}
                      onChange={() => toggleRaiderChecked(sysId)}
                      className="h-3.5 w-3.5"
                    />
                    <span className={log.raiderChecked[sysId] ? 'text-gray-400 line-through' : 'dark:text-gray-100'}>
                      {sys?.name ?? sysId}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-auto flex gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          onClick={onOpenAddUnits}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Add Units (CM)
        </button>
        <button
          onClick={onFinish}
          className="ml-auto rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
