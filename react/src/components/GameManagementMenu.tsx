import { useState } from 'react';
import type { AppView } from '../App';
import type { CampaignSettings, Campaign } from '../types';
import { CampaignSetupWizard } from './CampaignSetupWizard';
import { LoadCampaignModal } from './LoadCampaignModal';

interface GameManagementMenuProps {
  onNavigate: (view: AppView) => void;
  onStartCampaign?: (settings: CampaignSettings) => void;
  onLoadCampaign?: (campaign: Campaign) => void;
}

export function GameManagementMenu({ onNavigate, onStartCampaign, onLoadCampaign }: GameManagementMenuProps) {
  const [showWizard, setShowWizard] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const handleCampaignComplete = (settings: CampaignSettings) => {
    setShowWizard(false);
    console.log('Campaign configured:', settings);
    if (onStartCampaign) {
      onStartCampaign(settings);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-100 dark:bg-gray-900">
      <h1 className="mb-12 text-4xl font-bold text-gray-800 dark:text-gray-100">
        Game Management
      </h1>

      <div className="flex flex-col gap-4">
        <button
          onClick={() => setShowWizard(true)}
          className="w-64 rounded-lg bg-blue-600 px-6 py-4 text-lg font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
        >
          New Campaign
        </button>
        <button
          onClick={() => setShowLoadModal(true)}
          className="w-64 rounded-lg bg-green-600 px-6 py-4 text-lg font-semibold text-white shadow-md transition-colors hover:bg-green-700"
        >
          Load Campaign
        </button>
        <button
          onClick={() => onNavigate('empireCreation')}
          className="w-64 rounded-lg bg-amber-600 px-6 py-4 text-lg font-semibold text-white shadow-md transition-colors hover:bg-amber-700"
        >
          Empire Creation
        </button>
      </div>

      <button
        onClick={() => onNavigate('menu')}
        className="mt-12 text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        &larr; Back to Main Menu
      </button>

      <CampaignSetupWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onComplete={handleCampaignComplete}
      />

      <LoadCampaignModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onLoad={(campaign) => {
          setShowLoadModal(false);
          if (onLoadCampaign) onLoadCampaign(campaign);
        }}
      />
    </div>
  );
}
