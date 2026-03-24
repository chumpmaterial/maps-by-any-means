import { useState, useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useMapCapture } from './hooks/useMapCapture';
import { ClipModePanel } from './components/ClipModePanel';
import { useTheme } from './hooks/useTheme';
import { useMapState } from './hooks/useMapState';
import { useNameLists } from './hooks/useNameLists';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ConfirmProvider, useConfirm } from './hooks/useConfirm';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toolbar } from './components/Toolbar';
import { MapViewport } from './components/MapViewport';
import { PropertyPanel } from './components/PropertyPanel';
import { SettingsModal } from './components/SettingsModal';
import { MainMenu } from './components/MainMenu';
import { GameManagementMenu } from './components/GameManagementMenu';
import { EmpireCreation } from './components/EmpireCreation';
import { CampaignMapView } from './components/CampaignMapView';
import type { CampaignSettings, Campaign } from './types';

export type AppView = 'menu' | 'mapMaker' | 'gameManagement' | 'empireCreation' | 'campaign';

function MapMakerContent({ onNavigate }: { onNavigate: (view: AppView) => void }) {
  const { theme, toggleTheme } = useTheme();
  const mapState = useMapState();
  const nameListHook = useNameLists();
  const confirm = useConfirm();
  const captureHook = useMapCapture();
  const svgRef = useRef<SVGSVGElement>(null) as RefObject<SVGSVGElement>;
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
    <div className="relative flex h-screen flex-col">
      {/* Top Toolbar */}
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        mapState={mapState}
        onGenerationLog={setGenerationLog}
        nameListHook={nameListHook}
        onShowSettings={() => setShowSettings(true)}
        onNavigateHome={() => onNavigate('menu')}
        captureHook={captureHook}
        svgRef={svgRef}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Viewport (center) */}
        <div className="flex-1 bg-gray-200 dark:bg-gray-800">
          <MapViewport
            mapState={mapState}
            generationLog={generationLog}
            onClearLog={() => setGenerationLog([])}
            svgRef={svgRef}
            clipModeActive={captureHook.clipModeActive}
            clipSelectedSystemIds={captureHook.clipSelectedSystemIds}
            onClipToggleSystem={captureHook.toggleClipSystem}
          />
        </div>

        {/* Property Panel (right sidebar) */}
        <PropertyPanel mapState={mapState} nameListHook={nameListHook} />
      </div>

      {/* Clip Mode Panel — floats over map area */}
      {captureHook.clipModeActive && (
        <div className="absolute bottom-20 left-4 z-40">
          <ClipModePanel
            captureHook={captureHook}
            systems={mapState.map.systems}
            onCapture={() => captureHook.captureClipMap(svgRef, mapState.map)}
          />
        </div>
      )}

      {/* Capture toast */}
      {captureHook.toastMessage && createPortal(
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[9999] -translate-x-1/2 rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg dark:bg-white/90 dark:text-gray-900">
          {captureHook.toastMessage}
        </div>,
        document.body,
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        nameListHook={nameListHook}
        captureHook={captureHook}
      />
    </div>
  );
}

function AppContent() {
  const [currentView, setCurrentView] = useState<AppView>('menu');
  const [campaignSettings, setCampaignSettings] = useState<CampaignSettings | null>(null);
  const [loadedCampaign, setLoadedCampaign] = useState<Campaign | null>(null);
  const { theme, toggleTheme } = useTheme();

  // Reset title when returning to menu
  useEffect(() => {
    if (currentView === 'menu') {
      document.title = 'MBAM';
    }
  }, [currentView]);

  switch (currentView) {
    case 'menu':
      return <MainMenu onNavigate={setCurrentView} theme={theme} onToggleTheme={toggleTheme} />;
    case 'mapMaker':
      return <MapMakerContent onNavigate={setCurrentView} />;
    case 'gameManagement':
      return (
        <GameManagementMenu
          onNavigate={setCurrentView}
          onStartCampaign={(settings) => {
            setLoadedCampaign(null);
            setCampaignSettings(settings);
            setCurrentView('campaign');
          }}
          onLoadCampaign={(campaign) => {
            setLoadedCampaign(campaign);
            setCampaignSettings(campaign.settings);
            setCurrentView('campaign');
          }}
        />
      );
    case 'empireCreation':
      return <EmpireCreation onNavigate={setCurrentView} />;
    case 'campaign':
      if (!campaignSettings) {
        setCurrentView('gameManagement');
        return null;
      }
      return (
        <CampaignMapView
          settings={campaignSettings}
          savedCampaign={loadedCampaign ?? undefined}
          onNavigateHome={() => {
            setCampaignSettings(null);
            setLoadedCampaign(null);
            setCurrentView('menu');
          }}
        />
      );
  }
}

function App() {
  return (
    <ErrorBoundary>
      <ConfirmProvider>
        <AppContent />
      </ConfirmProvider>
    </ErrorBoundary>
  );
}

export default App;
