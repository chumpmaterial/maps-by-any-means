interface PlayerCountStepProps {
  playerCount: number;
  maxPlayers: number;
  onSetPlayerCount: (count: number) => void;
}

export function PlayerCountStep({ playerCount, maxPlayers, onSetPlayerCount }: PlayerCountStepProps) {
  return (
    <div>
      <h3 className="mb-4 text-xl font-semibold dark:text-gray-100">Number of Players</h3>

      <p className="mb-6 text-gray-600 dark:text-gray-400">
        The selected map supports up to {maxPlayers} player{maxPlayers !== 1 ? 's' : ''} ({maxPlayers} homeworld{maxPlayers !== 1 ? 's' : ''}).
      </p>

      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium dark:text-gray-200">Player Count</label>
        <input
          type="number"
          min={1}
          max={maxPlayers}
          value={playerCount}
          onChange={(e) => onSetPlayerCount(Math.max(1, Math.min(maxPlayers, parseInt(e.target.value) || 1)))}
          className="w-32 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: maxPlayers }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => onSetPlayerCount(n)}
            className={`rounded border px-4 py-2 text-sm font-medium ${
              playerCount === n
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {n} {n === 1 ? 'Player' : 'Players'}
          </button>
        ))}
      </div>
    </div>
  );
}
