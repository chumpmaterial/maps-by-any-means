import { useState } from 'react';
import type { Empire } from '../../types';
import { presetEmpires } from '../../data/presetEmpires';
import { importEmpireFromFile } from '../../utils/fileUtils';

interface EmpireSelectionStepProps {
  playerCount: number;
  playerNames: string[];
  selectedEmpires: (Empire | null)[];
  onSetEmpire: (playerIndex: number, empire: Empire) => void;
  onSetPlayerName: (playerIndex: number, name: string) => void;
}

export function EmpireSelectionStep({
  playerCount,
  playerNames,
  selectedEmpires,
  onSetEmpire,
  onSetPlayerName,
}: EmpireSelectionStepProps) {
  const [activePlayer, setActivePlayer] = useState(0);

  const handleImportCustom = async () => {
    try {
      const empire = await importEmpireFromFile();
      if (empire) {
        onSetEmpire(activePlayer, empire);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import empire');
    }
  };

  const handleSelectPreset = (empire: Empire) => {
    onSetEmpire(activePlayer, empire);
  };

  return (
    <div>
      <h3 className="mb-4 text-xl font-semibold dark:text-gray-100">Empire Selection</h3>

      {/* Player tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {Array.from({ length: playerCount }, (_, i) => (
          <button
            key={i}
            onClick={() => setActivePlayer(i)}
            className={`rounded px-4 py-2 text-left text-sm font-medium ${
              activePlayer === i
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            <div>{playerNames[i] || `Player ${i + 1}`}</div>
            <div className={`text-xs font-normal ${
              activePlayer === i
                ? 'text-blue-200'
                : selectedEmpires[i]
                  ? 'text-gray-500 dark:text-gray-400'
                  : 'text-gray-400 italic dark:text-gray-500'
            }`}>
              {selectedEmpires[i]?.name || 'No empire'}
            </div>
          </button>
        ))}
      </div>

      {/* Player name + current selection */}
      <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Player Name
            </label>
            <input
              type="text"
              value={playerNames[activePlayer] || ''}
              onChange={(e) => onSetPlayerName(activePlayer, e.target.value)}
              placeholder={`Player ${activePlayer + 1}`}
              className="w-full rounded border border-gray-300 px-3 py-2 text-base font-medium dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Empire
            </label>
            <div className={`rounded px-3 py-2 text-base ${
              selectedEmpires[activePlayer]
                ? 'font-medium text-green-700 dark:text-green-400'
                : 'text-gray-400 dark:text-gray-500'
            }`}>
              {selectedEmpires[activePlayer]?.name || 'None selected'}
            </div>
          </div>
        </div>
      </div>

      {/* Preset empires list */}
      <div className="mb-4 max-h-64 space-y-2 overflow-y-auto">
        {presetEmpires.map(empire => {
          const isSelected = selectedEmpires[activePlayer]?.id === empire.id;
          return (
            <button
              key={empire.id}
              onClick={() => handleSelectPreset(empire)}
              className={`w-full rounded border p-3 text-left ${
                isSelected
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/30'
                  : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}
            >
              <div className="font-semibold dark:text-gray-100">{empire.name}</div>
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Advantages: {empire.advantages.join(', ')} | Disadvantage: {empire.disadvantage}
              </div>
            </button>
          );
        })}
      </div>

      {/* Import custom */}
      <button
        onClick={handleImportCustom}
        className="w-full rounded border-2 border-dashed border-gray-300 py-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        Import Custom Empire JSON
      </button>
    </div>
  );
}
