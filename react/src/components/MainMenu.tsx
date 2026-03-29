import type { AppView } from '../App';

interface MainMenuProps {
  onNavigate: (view: AppView) => void;
  theme: string;
  onToggleTheme: () => void;
}

export function MainMenu({ onNavigate, theme, onToggleTheme }: MainMenuProps) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-100 dark:bg-gray-900">
      {/* Theme toggle */}
      <button
        onClick={onToggleTheme}
        className="absolute top-4 right-4 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </button>

      <h1 className="mb-12 text-6xl font-bold text-gray-800 dark:text-gray-100">
        MBAM
      </h1>
      <p className="mb-12 text-lg text-gray-500 dark:text-gray-400">
        Maps by Any Means
      </p>

      <div className="flex flex-col gap-4">
        <button
          onClick={() => onNavigate('mapMaker')}
          className="w-64 rounded-lg bg-blue-600 px-6 py-4 text-lg font-semibold text-white shadow-md hover:bg-blue-700 transition-colors"
        >
          Map Maker
        </button>
        <button
          onClick={() => onNavigate('gameManagement')}
          className="w-64 rounded-lg bg-emerald-600 px-6 py-4 text-lg font-semibold text-white shadow-md hover:bg-emerald-700 transition-colors"
        >
          Game Management
        </button>
      </div>
    </div>
  );
}
