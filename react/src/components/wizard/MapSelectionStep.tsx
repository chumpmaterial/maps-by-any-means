import { useState } from 'react';
import type { GameMap } from '../../types';
import { presetMaps } from '../../data/presetMaps';
import { importMapFromFile } from '../../utils/fileUtils';

interface MapSelectionStepProps {
  selectedMap: GameMap | null;
  onSelectMap: (map: GameMap) => void;
}

export function MapSelectionStep({ selectedMap, onSelectMap }: MapSelectionStepProps) {
  const [tab, setTab] = useState<'presets' | 'import'>('presets');

  const handleImportMap = async () => {
    try {
      const map = await importMapFromFile();
      onSelectMap(map);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import map');
    }
  };

  const availableMaps = [
    ...presetMaps.standard.map(m => ({ map: m, category: 'Standard' })),
    ...presetMaps.scenarios.map(m => ({ map: m, category: 'Scenario' })),
  ];

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-4 text-xl font-semibold dark:text-gray-100">Select Campaign Map</h3>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('presets')}
          className={`rounded px-4 py-2 text-sm font-medium ${
            tab === 'presets'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Preset Maps
        </button>
        <button
          onClick={() => setTab('import')}
          className={`rounded px-4 py-2 text-sm font-medium ${
            tab === 'import'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Import Custom
        </button>
      </div>

      {tab === 'presets' ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {availableMaps.map(({ map, category }) => {
            const homeworldCount = map.systems.filter(s => s.type === 'homeworld').length;
            const isSelected = selectedMap?.id === map.id;
            return (
              <button
                key={map.id}
                onClick={() => onSelectMap(map)}
                className={`w-full rounded border p-4 text-left ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                    : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                <div className="font-semibold dark:text-gray-100">{map.name}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="mr-3">{category}</span>
                  {map.systems.length} systems, {homeworldCount} homeworld{homeworldCount !== 1 ? 's' : ''} (max {homeworldCount} player{homeworldCount !== 1 ? 's' : ''})
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            Import a map JSON file from your computer.
          </p>
          <button
            onClick={handleImportMap}
            className="rounded bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
          >
            Choose File
          </button>
          {selectedMap && (
            <div className="mt-4 rounded border border-green-300 bg-green-50 p-3 dark:border-green-700 dark:bg-green-900/30">
              <p className="text-sm font-medium text-green-700 dark:text-green-400">
                Loaded: {selectedMap.name}
              </p>
              <p className="text-sm text-green-600 dark:text-green-500">
                {selectedMap.systems.length} systems, {selectedMap.systems.filter(s => s.type === 'homeworld').length} homeworlds
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
