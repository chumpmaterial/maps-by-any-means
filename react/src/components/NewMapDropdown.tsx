import { useState, useRef, useEffect } from 'react';
import type { GameMap } from '../types';
import type { PresetMapCategory } from '../data/presetMaps';
import { presetMaps } from '../data/presetMaps';

interface NewMapDropdownProps {
  onNewBlankMap: () => void;
  onGenerateNew: () => void;
  onLoadPreset: (map: GameMap) => void;
  hasUnsavedChanges: boolean;
}

type ActiveSubmenu = null | 'blanks' | 'standard' | 'scenarios';

export function NewMapDropdown({
  onNewBlankMap,
  onGenerateNew,
  onLoadPreset,
  hasUnsavedChanges,
}: NewMapDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ActiveSubmenu>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setPresetsOpen(false);
        setActiveSubmenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const confirmAndExecute = (action: () => void) => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('This will discard unsaved changes. Continue?');
      if (!confirmed) return;
    }
    action();
    setIsOpen(false);
    setPresetsOpen(false);
    setActiveSubmenu(null);
  };

  const renderPresetItems = (category: PresetMapCategory) => {
    const maps = presetMaps[category];
    if (!maps || maps.length === 0) {
      return <div className="px-3 py-2 text-sm text-gray-400">No maps available</div>;
    }
    return maps.map((preset) => (
      <button
        key={preset.id}
        onClick={() => confirmAndExecute(() => onLoadPreset(preset))}
        className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {preset.name}
      </button>
    ));
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        New ▼
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {/* New Blank Map */}
          <button
            onClick={() => confirmAndExecute(onNewBlankMap)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            New Blank Map...
          </button>

          {/* Generate New */}
          <button
            onClick={() => confirmAndExecute(onGenerateNew)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Generate New...
          </button>

          <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

          {/* Pre-Set Maps */}
          <div
            className="relative"
            onMouseEnter={() => setPresetsOpen(true)}
            onMouseLeave={() => {
              setPresetsOpen(false);
              setActiveSubmenu(null);
            }}
          >
            <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
              Pre-Set Maps
              <span className="ml-2">▶</span>
            </button>

            {presetsOpen && (
              <div className="absolute left-full top-0 min-w-48 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                {/* Blanks submenu */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveSubmenu('blanks')}
                >
                  <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                    Blanks
                    <span className="ml-2">▶</span>
                  </button>
                  {activeSubmenu === 'blanks' && (
                    <div className="absolute left-full top-0 min-w-48 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      {renderPresetItems('blanks')}
                    </div>
                  )}
                </div>

                {/* Standard submenu */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveSubmenu('standard')}
                >
                  <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                    Standard
                    <span className="ml-2">▶</span>
                  </button>
                  {activeSubmenu === 'standard' && (
                    <div className="absolute left-full top-0 min-w-48 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      {renderPresetItems('standard')}
                    </div>
                  )}
                </div>

                {/* Scenarios submenu */}
                <div
                  className="relative"
                  onMouseEnter={() => setActiveSubmenu('scenarios')}
                >
                  <button className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                    Scenarios
                    <span className="ml-2">▶</span>
                  </button>
                  {activeSubmenu === 'scenarios' && (
                    <div className="absolute left-full top-0 min-w-48 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      {renderPresetItems('scenarios')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
