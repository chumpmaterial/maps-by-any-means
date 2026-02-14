import { useState, useEffect } from 'react';
import { useTheme } from './hooks/useTheme';
import { useMapState } from './hooks/useMapState';
import { useNameLists } from './hooks/useNameLists';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ConfirmProvider, useConfirm } from './hooks/useConfirm';
import { Toolbar } from './components/Toolbar';
import { MapViewport } from './components/MapViewport';
import { PropertyPanel } from './components/PropertyPanel';
import { SettingsModal } from './components/SettingsModal';

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const mapState = useMapState();
  const nameListHook = useNameLists();
  const confirm = useConfirm();
  const [generationLog, setGenerationLog] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  useKeyboardShortcuts(mapState, confirm);

  // Dynamic browser tab title
  useEffect(() => {
    document.title = mapState.map.name
      ? `${mapState.map.name} - MBAM`
      : 'MBAM';
  }, [mapState.map.name]);

  // Warn before losing unsaved work
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (mapState.map.systems.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [mapState.map.systems.length]);

  return (
    <div className="flex h-screen flex-col">
      {/* Top Toolbar */}
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        mapState={mapState}
        onGenerationLog={setGenerationLog}
        nameListHook={nameListHook}
        onShowSettings={() => setShowSettings(true)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Viewport (center) */}
        <div className="flex-1 bg-gray-200 dark:bg-gray-800">
          <MapViewport
            mapState={mapState}
            generationLog={generationLog}
            onClearLog={() => setGenerationLog([])}
          />
        </div>

        {/* Property Panel (right sidebar) */}
        <PropertyPanel mapState={mapState} nameListHook={nameListHook} />
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        nameListHook={nameListHook}
      />
    </div>
  );
}

function App() {
  return (
    <ConfirmProvider>
      <AppContent />
    </ConfirmProvider>
  );
}

export default App;
