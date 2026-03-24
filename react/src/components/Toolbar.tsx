import { useState } from 'react';
import type { useMapState } from '../hooks/useMapState';
import type { useNameLists } from '../hooks/useNameLists';
import type { useMapCapture } from '../hooks/useMapCapture';
import { CaptureButton } from './CaptureButton';
import type { GameMap } from '../types';
import { exportMapToFile, importMapFromFile, importNameListFromFile } from '../utils/fileUtils';
import { generateMap } from '../utils/mapGenerator';
import { NewMapDropdown } from './NewMapDropdown';
import { NewBlankMapDialog } from './NewBlankMapDialog';
import { GenerateMapDialog } from './GenerateMapDialog';
import { ImportDropdown } from './ImportDropdown';

interface ToolbarProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  mapState: ReturnType<typeof useMapState>;
  onGenerationLog: (log: string[]) => void;
  nameListHook: ReturnType<typeof useNameLists>;
  onShowSettings: () => void;
  onNavigateHome?: () => void;
  onExitMapEditing?: () => void;
  captureHook?: ReturnType<typeof useMapCapture>;
  svgRef?: React.RefObject<SVGSVGElement>;
}

export function Toolbar({ theme, onToggleTheme, mapState, onGenerationLog, nameListHook, onShowSettings, onNavigateHome, onExitMapEditing, captureHook, svgRef }: ToolbarProps) {
  const { map, loadMap, setMapName } = mapState;
  const [showNewBlankDialog, setShowNewBlankDialog] = useState(false);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);

  const handleExport = () => {
    exportMapToFile(map);
  };

  const handleImportMap = async () => {
    if (map.systems.length > 0) {
      const confirmed = window.confirm('Import a map? Unsaved changes will be lost.');
      if (!confirmed) return;
    }
    try {
      const imported = await importMapFromFile();
      loadMap(imported);
      onGenerationLog([]);
    } catch (err) {
      console.error('Failed to import map:', err);
      alert('Failed to import map. Please check the file format.');
    }
  };

  const handleImportNameList = async () => {
    try {
      const { names, filename } = await importNameListFromFile();
      nameListHook.addNameList(names, filename);
    } catch (err) {
      console.error('Failed to import name list:', err);
      alert('Failed to import name list. Please check the file format.');
    }
  };

  const handleNewBlankMap = () => {
    setShowNewBlankDialog(true);
  };

  const handleCreateBlankMap = (_targetSystemCount: number, mapName: string) => {
    // Create a new map with just a Hub system at center
    // _targetSystemCount is informational only - user adds systems manually
    const newMap: GameMap = {
      id: Math.random().toString(36).substring(2, 11),
      name: mapName,
      systems: [{
        id: 'hub',
        name: 'Hub',
        type: 'major',
        position: { q: 0, r: 0 },
      }],
      jumpLanes: [],
    };
    loadMap(newMap);
    onGenerationLog([]);
  };

  const handleGenerateNew = () => {
    setShowGenerateDialog(true);
  };

  const handleGenerate = (ringCount: number, mapName: string, useRandomNames: boolean) => {
    const result = generateMap(ringCount, mapName);

    if (useRandomNames) {
      const activeNames = [...nameListHook.activeNames];
      if (activeNames.length > 0) {
        // Shuffle names
        for (let i = activeNames.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [activeNames[i], activeNames[j]] = [activeNames[j], activeNames[i]];
        }

        const usedNames = new Set<string>();
        let nameIndex = 0;
        let systemCounter = 1;

        result.map.systems = result.map.systems.map(system => {
          if (nameListHook.settings.allowDuplicates) {
            // With duplicates allowed, just cycle through shuffled names
            const name = activeNames[nameIndex % activeNames.length];
            nameIndex++;
            return { ...system, name };
          }

          // Without duplicates, find an unused name
          if (nameIndex < activeNames.length) {
            while (nameIndex < activeNames.length && usedNames.has(activeNames[nameIndex])) {
              nameIndex++;
            }
            if (nameIndex < activeNames.length) {
              const name = activeNames[nameIndex];
              usedNames.add(name);
              nameIndex++;
              return { ...system, name };
            }
          }

          // Fallback to System-N when pool exhausted
          return { ...system, name: `System-${systemCounter++}` };
        });
      }
    }

    loadMap(result.map);
    onGenerationLog(result.log);
  };

  const handleLoadPreset = (presetMap: GameMap) => {
    // Deep clone the preset map so edits don't affect the original
    const clonedMap: GameMap = {
      ...presetMap,
      id: Math.random().toString(36).substring(2, 11),
      systems: presetMap.systems.map(s => ({ ...s })),
      jumpLanes: presetMap.jumpLanes.map(l => ({ ...l })),
    };
    loadMap(clonedMap);
    onGenerationLog([]);
  };

  return (
    <>
      <header className="flex h-12 items-center justify-between border-b border-gray-300 bg-white px-4 dark:border-gray-700 dark:bg-gray-900">
        {/* Left: File operations */}
        <div className="flex items-center gap-2">
          {onExitMapEditing && (
            <>
              <button
                onClick={onExitMapEditing}
                className="rounded bg-amber-100 px-3 py-1 text-sm text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/50"
              >
                Exit Map Editing
              </button>
              <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            </>
          )}
          {onNavigateHome && !onExitMapEditing && (
            <>
              <button
                onClick={onNavigateHome}
                className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Home
              </button>
              <span className="mx-1 text-gray-300 dark:text-gray-700">|</span>
            </>
          )}
          <NewMapDropdown
            onNewBlankMap={handleNewBlankMap}
            onGenerateNew={handleGenerateNew}
            onLoadPreset={handleLoadPreset}
            hasUnsavedChanges={map.systems.length > 0}
          />
          <ImportDropdown
            onImportMap={handleImportMap}
            onImportNameList={handleImportNameList}
          />
          <button
            onClick={handleExport}
            className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Export
          </button>
          {captureHook && svgRef && (
            <CaptureButton
              disabled={mapState.map.systems.length === 0}
              onFullMap={() => captureHook.captureFullMap(svgRef, mapState.map, mapState.selectedSystemId)}
              onClipMode={() => captureHook.enterClipMode()}
            />
          )}
          <button
            onClick={onShowSettings}
            className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Settings
          </button>
          <span className="mx-2 text-gray-300 dark:text-gray-700">|</span>
          <input
            type="text"
            value={map.name}
            onChange={(e) => setMapName(e.target.value)}
            className="rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
            placeholder="Map name"
          />
        </div>

        {/* Center: Title */}
        <div className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">
          MBAM
        </div>

        {/* Right: Theme toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleTheme}
            className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>
      </header>

      {/* New Blank Map Dialog */}
      <NewBlankMapDialog
        isOpen={showNewBlankDialog}
        onClose={() => setShowNewBlankDialog(false)}
        onCreate={handleCreateBlankMap}
      />

      {/* Generate Map Dialog */}
      <GenerateMapDialog
        isOpen={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        onGenerate={handleGenerate}
      />
    </>
  );
}
