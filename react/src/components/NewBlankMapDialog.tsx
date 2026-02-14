import { useState } from 'react';

interface NewBlankMapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (systemCount: number, mapName: string) => void;
}

type MapSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Extreme';

function getMapSize(systemCount: number): MapSize {
  if (systemCount <= 19) return 'Tiny';
  if (systemCount <= 37) return 'Small';
  if (systemCount <= 61) return 'Medium';
  if (systemCount <= 91) return 'Large';
  if (systemCount <= 127) return 'Huge';
  return 'Extreme';
}

function getSizeDescription(size: MapSize): string {
  switch (size) {
    case 'Tiny': return '1-19 systems (2 players)';
    case 'Small': return '20-37 systems (3 players)';
    case 'Medium': return '38-61 systems (4 players)';
    case 'Large': return '62-91 systems (5 players)';
    case 'Huge': return '92-127 systems (6 players)';
    case 'Extreme': return '128+ systems (untested)';
  }
}

function getSizeColor(size: MapSize): string {
  switch (size) {
    case 'Tiny': return 'text-green-600 dark:text-green-400';
    case 'Small': return 'text-blue-600 dark:text-blue-400';
    case 'Medium': return 'text-yellow-600 dark:text-yellow-400';
    case 'Large': return 'text-orange-600 dark:text-orange-400';
    case 'Huge': return 'text-red-600 dark:text-red-400';
    case 'Extreme': return 'text-purple-600 dark:text-purple-400';
  }
}

export function NewBlankMapDialog({ isOpen, onClose, onCreate }: NewBlankMapDialogProps) {
  const [systemCount, setSystemCount] = useState<string>('19');
  const [mapName, setMapName] = useState<string>('New Map');

  if (!isOpen) return null;

  const count = parseInt(systemCount) || 0;
  const size = getMapSize(count);
  const isExtreme = size === 'Extreme';

  const handleCreate = () => {
    if (count < 1) {
      alert('Please enter at least 1 system.');
      return;
    }

    if (isExtreme) {
      const confirmed = window.confirm(
        'WARNING: You are creating an Extreme-sized map with ' + count + ' systems.\n\n' +
        'VBAM has not been tested at this scale and gameplay may be significantly affected. ' +
        'Large maps can lead to very long games and performance issues.\n\n' +
        'Are you sure you want to continue?'
      );
      if (!confirmed) return;
    }

    onCreate(count, mapName || 'New Map');
    onClose();
    // Reset form
    setSystemCount('19');
    setMapName('New Map');
  };

  const handleClose = () => {
    onClose();
    setSystemCount('19');
    setMapName('New Map');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">New Blank Map</h2>

        {/* Map Name */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Map Name</label>
          <input
            type="text"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
            className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-600"
            placeholder="Enter map name"
          />
        </div>

        {/* Target System Count */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Target Number of Systems</label>
          <input
            type="number"
            min="1"
            value={systemCount}
            onChange={(e) => setSystemCount(e.target.value)}
            className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-600"
            placeholder="Enter number of systems"
          />
        </div>

        {/* Size Assessment */}
        <div className="mb-4 rounded bg-gray-100 p-3 dark:bg-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Map Size:</span>
            <span className={`font-bold ${getSizeColor(size)}`}>{size}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {getSizeDescription(size)}
          </div>
        </div>

        {/* Extreme Warning */}
        {isExtreme && (
          <div className="mb-4 rounded border border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-900/30">
            <div className="flex items-start gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <div className="font-medium text-purple-800 dark:text-purple-200">
                  Extreme Size Warning
                </div>
                <div className="text-sm text-purple-700 dark:text-purple-300">
                  VBAM is untested at maps this size. Gameplay may be significantly affected.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Info about blank maps */}
        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          A blank map will be created with a single "Hub" system at the center.
          Add additional systems manually by double-clicking on hex cells.
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Create Map
          </button>
        </div>
      </div>
    </div>
  );
}
