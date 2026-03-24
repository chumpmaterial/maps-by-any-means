import type { useMapCapture } from '../hooks/useMapCapture';
import type { System } from '../types';

interface ClipModePanelProps {
  captureHook: ReturnType<typeof useMapCapture>;
  systems: System[];
  onCapture: () => void;
}

export function ClipModePanel({ captureHook, systems, onCapture }: ClipModePanelProps) {
  const {
    clipSystemOrder,
    clipSelectedSystemIds,
    clipCenterSystemId,
    exitClipMode,
    setClipCenter,
  } = captureHook;

  // Build ordered list of selected system objects (preserves click order)
  const selectedSystems = clipSystemOrder
    .map(id => systems.find(s => s.id === id))
    .filter((s): s is System => s !== undefined);

  return (
    <div className="flex w-52 flex-col rounded-lg border border-gray-300 bg-white/95 shadow-lg dark:border-gray-600 dark:bg-gray-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-sm font-semibold dark:text-gray-100">Clip Mode</span>
        <button
          onClick={exitClipMode}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          title="Exit clip mode"
        >
          ✕
        </button>
      </div>

      {/* Instruction */}
      <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
        Click systems on the map to add them.
      </p>

      {/* System list */}
      {selectedSystems.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          {selectedSystems.map(sys => {
            const isCenter = sys.id === clipCenterSystemId;
            return (
              <li
                key={sys.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
              >
                <span className="truncate dark:text-gray-200">{sys.name}</span>
                <button
                  onClick={() => setClipCenter(sys.id)}
                  title={isCenter ? 'This system is the capture center' : 'Set as capture center'}
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                    isCenter
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {isCenter ? '★ Center' : 'Assign Center'}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 pb-2 text-xs italic text-gray-400 dark:text-gray-500">
          No systems selected yet.
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2 dark:border-gray-700">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {clipSelectedSystemIds.size} selected
        </span>
        <button
          onClick={onCapture}
          disabled={clipSelectedSystemIds.size === 0}
          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Capture
        </button>
      </div>
    </div>
  );
}
