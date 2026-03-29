import { useState } from 'react';

interface GenerateMapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (ringCount: number, mapName: string, useRandomNames: boolean) => void;
}

const sizeLabels: Record<number, { name: string; systems: number; color: string }> = {
  2: { name: 'Tiny', systems: 19, color: 'text-green-600 dark:text-green-400' },
  3: { name: 'Small', systems: 37, color: 'text-blue-600 dark:text-blue-400' },
  4: { name: 'Medium', systems: 61, color: 'text-yellow-600 dark:text-yellow-400' },
  5: { name: 'Large', systems: 91, color: 'text-orange-600 dark:text-orange-400' },
  6: { name: 'Huge', systems: 127, color: 'text-red-600 dark:text-red-400' },
};

export function GenerateMapDialog({ isOpen, onClose, onGenerate }: GenerateMapDialogProps) {
  const [ringCount, setRingCount] = useState(3);
  const [mapName, setMapName] = useState('Generated Map');
  const [useRandomNames, setUseRandomNames] = useState(true);

  if (!isOpen) return null;

  const sizeInfo = sizeLabels[ringCount];

  const handleGenerate = () => {
    onGenerate(ringCount, mapName || 'Generated Map', useRandomNames);
    onClose();
    setRingCount(3);
    setMapName('Generated Map');
    setUseRandomNames(true);
  };

  const handleClose = () => {
    onClose();
    setRingCount(3);
    setMapName('Generated Map');
    setUseRandomNames(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-96 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">Generate New Map</h2>

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

        {/* Ring Count */}
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium">Number of Rings (Players)</label>
          <div className="flex gap-2">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setRingCount(n)}
                className={`flex-1 rounded border px-3 py-2 text-sm font-medium transition-colors ${
                  ringCount === n
                    ? 'border-blue-500 bg-blue-600 text-white'
                    : 'border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Size Info */}
        <div className="mb-4 rounded bg-gray-100 p-3 dark:bg-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Map Size:</span>
            <span className={`font-bold ${sizeInfo.color}`}>{sizeInfo.name}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {sizeInfo.systems} systems, {ringCount} players
          </div>
        </div>

        {/* Use Random Names */}
        <div className="mb-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={useRandomNames}
              onChange={(e) => setUseRandomNames(e.target.checked)}
              className="h-4 w-4 appearance-none rounded border border-gray-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-700 dark:checked:border-blue-500 dark:checked:bg-blue-500"
            />
            <span className="text-sm font-medium">Use Random Names</span>
          </label>
          <p className="mt-1 ml-6 text-xs text-gray-600 dark:text-gray-400">
            Assign random names from your name lists instead of generic numbering.
          </p>
        </div>

        {/* Info */}
        <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Systems will be randomly generated using VBAM tables. One homeworld will be placed per ring, evenly spaced around the map.
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
            onClick={handleGenerate}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
