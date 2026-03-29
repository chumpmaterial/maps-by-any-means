import { useEffect, useState } from 'react';
import type { Campaign, CampaignPhase, TurnPhase } from '../types';
import { loadCampaignFromStorage, importCampaignFromFile } from '../utils/fileUtils';

interface LoadCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoad: (campaign: Campaign) => void;
}

function formatPhase(phase: CampaignPhase, turnPhase?: TurnPhase, turn?: number): string {
  if (phase === 'in_progress') {
    const turnLabel = turn != null ? `Turn ${turn}` : '';
    const phaseLabel: Record<TurnPhase, string> = {
      economic: 'Economic Phase',
      turn_orders: 'Turn Orders Phase',
      intel: 'Intel Phase',
      movement: 'Movement Phase',
      diplomacy: 'Diplomacy Phase',
      combat: 'Combat Phase',
      supply: 'Supply Phase',
      construction: 'Construction Phase',
      tech: 'Tech Phase',
      end_of_turn: 'End of Turn',
    };
    const tpLabel = turnPhase ? phaseLabel[turnPhase] : '';
    return [turnLabel, tpLabel].filter(Boolean).join(' — ');
  }
  const setupLabels: Record<CampaignPhase, string> = {
    setup: 'Setup',
    homeworld_selection: 'Homeworld Selection',
    system_purchase: 'System Purchase',
    lane_rolling: 'Lane Rolling',
    unit_purchase: 'Unit Purchase',
    unit_deployment: 'Unit Deployment',
    trade_routes: 'Trade Routes',
    in_progress: 'In Progress',
  };
  return setupLabels[phase] ?? phase;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function LoadCampaignModal({ isOpen, onClose, onLoad }: LoadCampaignModalProps) {
  const [savedCampaign, setSavedCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSavedCampaign(loadCampaignFromStorage());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleImport = async () => {
    try {
      const campaign = await importCampaignFromFile();
      if (campaign) onLoad(campaign);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import campaign');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[420px] rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Load Campaign
        </h2>

        {/* Saved campaign card */}
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Saved in Memory
          </p>
          {savedCampaign ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-700">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-gray-100">
                    {savedCampaign.settings.name}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">
                    {formatPhase(savedCampaign.phase, savedCampaign.currentTurnPhase, savedCampaign.currentTurn)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Last saved: {formatDate(savedCampaign.lastModified)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onLoad(savedCampaign)}
                className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Continue Campaign
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400">
              No saved campaign found.
            </div>
          )}
        </div>

        {/* Import button */}
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            From File
          </p>
          <button
            onClick={handleImport}
            className="w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Import Save File
          </button>
        </div>

        {/* Cancel */}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
