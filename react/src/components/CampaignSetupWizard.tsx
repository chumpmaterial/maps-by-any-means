import { useState } from 'react';
import type { GameMap, Empire, CampaignSettings, CampaignRules } from '../types';
import { MapSelectionStep } from './wizard/MapSelectionStep';
import { PlayerCountStep } from './wizard/PlayerCountStep';
import { EmpireSelectionStep } from './wizard/EmpireSelectionStep';
import { StartingSettingsStep } from './wizard/StartingSettingsStep';
import { OptionalRulesStep } from './wizard/OptionalRulesStep';

interface CampaignSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (settings: CampaignSettings) => void;
}

const STEPS = ['map', 'playerCount', 'empires', 'settings', 'rules'] as const;
type WizardStep = typeof STEPS[number];

const STEP_LABELS: Record<WizardStep, string> = {
  map: 'Map',
  playerCount: 'Players',
  empires: 'Empires',
  settings: 'Starting Settings',
  rules: 'Rules',
};

const DEFAULT_RULES: CampaignRules = {
  independentSystems: false,
  strangeNewWorlds: false,
  newHorizons: false,
  unexploredFrontiers: false,
  hostileGalaxy: false,
  ravagerFleets: false,
  harbingerThreats: false,
  wartimeEconomies: false,
  deepSpaceEncounters: false,
  perilousExploration: false,
  persistentRaiders: false,
  neutralFirstContact: false,
  grandFleets: false,
  ramming: false,
  extendedConstructionTimes: false,
  commandShips: false,
  prototyping: false,
  historicalTechAdvancement: false,
  improvementConstructionTimes: false,
  randomEvents: false,
};

export function CampaignSetupWizard({ isOpen, onClose, onComplete }: CampaignSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('map');

  // Wizard state
  const [selectedMap, setSelectedMap] = useState<GameMap | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [playerCount, setPlayerCount] = useState(2);
  const [playerNames, setPlayerNames] = useState<string[]>([]);
  const [playerEmpires, setPlayerEmpires] = useState<(Empire | null)[]>([]);
  const [startingYear, setStartingYear] = useState(3005);
  const [startingEP, setStartingEP] = useState(200);
  const [startingSP, setStartingSP] = useState(24);
  const [useSystemIncomeEP, setUseSystemIncomeEP] = useState(false);
  const [rules, setRules] = useState<CampaignRules>({ ...DEFAULT_RULES });

  if (!isOpen) return null;

  const homeworldCount = selectedMap?.systems.filter(s => s.type === 'homeworld').length ?? 0;
  const stepIndex = STEPS.indexOf(currentStep);

  const handleSetPlayerCount = (count: number) => {
    setPlayerCount(count);
    // Resize arrays to match player count
    setPlayerNames(prev => {
      const next = [...prev];
      next.length = count;
      return next;
    });
    setPlayerEmpires(prev => {
      const next = [...prev];
      next.length = count;
      return next;
    });
  };

  const handleSetEmpire = (index: number, empire: Empire) => {
    setPlayerEmpires(prev => {
      const next = [...prev];
      next[index] = empire;
      return next;
    });
  };

  const handleSetPlayerName = (index: number, name: string) => {
    setPlayerNames(prev => {
      const next = [...prev];
      next[index] = name;
      return next;
    });
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 'map':
        return selectedMap !== null && homeworldCount > 0;
      case 'playerCount':
        return playerCount >= 1 && playerCount <= homeworldCount;
      case 'empires':
        return playerEmpires.length >= playerCount && playerEmpires.slice(0, playerCount).every(e => e !== null && e !== undefined);
      case 'settings':
        return startingYear > 0 && startingSP >= 0 && (useSystemIncomeEP || startingEP >= 0);
      case 'rules':
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[stepIndex + 1]);
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) {
      setCurrentStep(STEPS[stepIndex - 1]);
    }
  };

  const handleFinish = () => {
    const players = Array.from({ length: playerCount }, (_, i) => ({
      name: playerNames[i] || `Player ${i + 1}`,
      empire: playerEmpires[i]!,
    }));

    const settings: CampaignSettings = {
      id: Math.random().toString(36).substring(2, 11),
      name: campaignName.trim() || selectedMap!.name + ' Campaign',
      map: selectedMap!,
      playerCount,
      players,
      startingYear,
      startingEP,
      startingSP,
      useSystemIncomeEP,
      rules,
    };

    onComplete(settings);
  };

  const handleClose = () => {
    // Reset all state
    setCurrentStep('map');
    setSelectedMap(null);
    setCampaignName('');
    setPlayerCount(2);
    setPlayerNames([]);
    setPlayerEmpires([]);
    setStartingYear(3005);
    setStartingEP(200);
    setStartingSP(24);
    setUseSystemIncomeEP(false);
    setRules({ ...DEFAULT_RULES });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex h-[60vh] w-[800px] flex-col rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-6 text-2xl font-bold dark:text-gray-100">New Campaign Setup</h2>

        {/* Progress bar */}
        <div className="mb-6 flex gap-1">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex-1">
              <div
                className={`h-2 rounded ${
                  idx < stepIndex
                    ? 'bg-green-500'
                    : idx === stepIndex
                      ? 'bg-blue-600'
                      : 'bg-gray-300 dark:bg-gray-600'
                }`}
              />
              <p className={`mt-1 text-center text-xs ${
                idx === stepIndex
                  ? 'font-medium text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}>
                {STEP_LABELS[step]}
              </p>
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto">
          {currentStep === 'map' && (
            <MapSelectionStep selectedMap={selectedMap} onSelectMap={setSelectedMap} />
          )}
          {currentStep === 'playerCount' && (
            <PlayerCountStep
              playerCount={playerCount}
              maxPlayers={homeworldCount}
              onSetPlayerCount={handleSetPlayerCount}
            />
          )}
          {currentStep === 'empires' && (
            <EmpireSelectionStep
              playerCount={playerCount}
              playerNames={playerNames}
              selectedEmpires={playerEmpires}
              onSetEmpire={handleSetEmpire}
              onSetPlayerName={handleSetPlayerName}
            />
          )}
          {currentStep === 'settings' && (
            <div>
              <div className="mb-6">
                <label className="mb-2 block text-sm font-medium dark:text-gray-200">
                  Campaign Name
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  placeholder={selectedMap ? selectedMap.name + ' Campaign' : 'Campaign name…'}
                  className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Leave blank to use the map name as the campaign name.
                </p>
              </div>
              <hr className="mb-6 border-gray-200 dark:border-gray-700" />
              <StartingSettingsStep
                year={startingYear}
                ep={startingEP}
                sp={startingSP}
                useSystemIncomeEP={useSystemIncomeEP}
                onSetYear={setStartingYear}
                onSetEP={setStartingEP}
                onSetSP={setStartingSP}
                onSetUseSystemIncomeEP={setUseSystemIncomeEP}
              />
            </div>
          )}
          {currentStep === 'rules' && (
            <OptionalRulesStep rules={rules} onSetRules={setRules} />
          )}
        </div>

        {/* Navigation buttons */}
        <div className="mt-6 flex shrink-0 justify-between border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {stepIndex > 0 && (
              <button
                onClick={handleBack}
                className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Back
              </button>
            )}
            {currentStep !== 'rules' ? (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
              >
                Start Campaign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
