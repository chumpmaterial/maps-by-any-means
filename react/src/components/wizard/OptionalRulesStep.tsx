import type { CampaignRules } from '../../types';

interface OptionalRulesStepProps {
  rules: CampaignRules;
  onSetRules: (rules: CampaignRules) => void;
}

const RULE_LABELS: { key: keyof CampaignRules; label: string; disabled?: boolean }[] = [
  { key: 'independentSystems', label: 'Independent Systems' },
  { key: 'strangeNewWorlds', label: 'Strange New Worlds', disabled: true },
  { key: 'newHorizons', label: 'New Horizons' },
  { key: 'unexploredFrontiers', label: 'Unexplored Frontiers', disabled: true },
  { key: 'hostileGalaxy', label: 'Hostile Galaxy' },
  { key: 'ravagerFleets', label: 'Ravager Fleets' },
  { key: 'harbingerThreats', label: 'Harbinger Threats' },
  { key: 'wartimeEconomies', label: 'Wartime Economies' },
  { key: 'deepSpaceEncounters', label: 'Deep Space Encounters' },
  { key: 'perilousExploration', label: 'Perilous Exploration' },
  { key: 'persistentRaiders', label: 'Persistent Raiders' },
  { key: 'neutralFirstContact', label: 'Neutral First Contact' },
  { key: 'grandFleets', label: 'Grand Fleets' },
  { key: 'ramming', label: 'Ramming' },
  { key: 'extendedConstructionTimes', label: 'Extended Construction Times' },
  { key: 'commandShips', label: 'Command Ships' },
  { key: 'prototyping', label: 'Prototyping' },
  { key: 'historicalTechAdvancement', label: 'Historical Tech Advancement' },
  { key: 'improvementConstructionTimes', label: 'Improvement Construction Times' },
  { key: 'randomEvents', label: 'Random Events' },
];

export function OptionalRulesStep({ rules, onSetRules }: OptionalRulesStepProps) {
  const toggleRule = (key: keyof CampaignRules) => {
    onSetRules({ ...rules, [key]: !rules[key] });
  };

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-4 text-xl font-semibold dark:text-gray-100">Optional Rules</h3>

      <p className="mb-4 text-gray-600 dark:text-gray-400">
        Select which optional VBAM rules to enable for this campaign.
      </p>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {RULE_LABELS.map(({ key, label, disabled }) => (
          <label
            key={key}
            className={`flex items-center gap-3 rounded p-2 ${
              disabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <input
              type="checkbox"
              checked={rules[key]}
              onChange={() => !disabled && toggleRule(key)}
              disabled={disabled}
              className="h-4 w-4"
            />
            <span className="text-sm dark:text-gray-200">
              {label}
              {disabled && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  (not yet supported)
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
