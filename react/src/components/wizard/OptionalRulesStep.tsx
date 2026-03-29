import type { CampaignRules } from '../../types';

interface OptionalRulesStepProps {
  rules: CampaignRules;
  onSetRules: (rules: CampaignRules) => void;
}

const RULE_LABELS: { key: keyof CampaignRules; label: string; disabled?: boolean; comingSoon?: boolean }[] = [
  // Enabled rules — sorted to top
  { key: 'independentSystems', label: 'Independent Systems' },
  { key: 'hostileGalaxy',      label: 'Hostile Galaxy' },
  { key: 'ravagerFleets',      label: 'Ravager Fleets' },
  { key: 'persistentRaiders',  label: 'Persistent Raiders' },
  { key: 'harbingerThreats',   label: 'Harbinger Threats' },
  // Coming Soon
  { key: 'strangeNewWorlds',             label: 'Strange New Worlds',             disabled: true, comingSoon: true },
  { key: 'newHorizons',                  label: 'New Horizons',                   disabled: true, comingSoon: true },
  { key: 'unexploredFrontiers',          label: 'Unexplored Frontiers',           disabled: true, comingSoon: true },
  { key: 'wartimeEconomies',             label: 'Wartime Economies',              disabled: true, comingSoon: true },
  { key: 'deepSpaceEncounters',          label: 'Deep Space Encounters',          disabled: true, comingSoon: true },
  { key: 'perilousExploration',          label: 'Perilous Exploration',           disabled: true, comingSoon: true },
  { key: 'neutralFirstContact',          label: 'Neutral First Contact',          disabled: true, comingSoon: true },
  { key: 'grandFleets',                  label: 'Grand Fleets',                   disabled: true, comingSoon: true },
  { key: 'ramming',                      label: 'Ramming',                        disabled: true, comingSoon: true },
  { key: 'extendedConstructionTimes',    label: 'Extended Construction Times',    disabled: true, comingSoon: true },
  { key: 'commandShips',                 label: 'Command Ships',                  disabled: true, comingSoon: true },
  { key: 'prototyping',                  label: 'Prototyping',                    disabled: true, comingSoon: true },
  { key: 'historicalTechAdvancement',    label: 'Historical Tech Advancement',    disabled: true, comingSoon: true },
  { key: 'improvementConstructionTimes', label: 'Improvement Construction Times', disabled: true, comingSoon: true },
  { key: 'randomEvents',                 label: 'Random Events',                  disabled: true, comingSoon: true },
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
        {RULE_LABELS.map(({ key, label, disabled, comingSoon }) => (
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
              {comingSoon && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  (Coming Soon)
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
