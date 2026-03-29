import type { GameMap, Empire, Campaign } from '../types';

/**
 * Export a map to a JSON file download
 */
export function exportMapToFile(map: GameMap): void {
  const json = JSON.stringify(map, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${map.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Import a map from a JSON file
 * Returns a promise that resolves with the parsed map or rejects with an error
 */
export function importMapFromFile(): Promise<GameMap> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        // Basic validation
        if (!data.id || !data.name || !Array.isArray(data.systems) || !Array.isArray(data.jumpLanes)) {
          reject(new Error('Invalid map file format'));
          return;
        }

        resolve(data as GameMap);
      } catch (err) {
        reject(new Error('Failed to parse map file'));
      }
    };

    input.click();
  });
}

/**
 * Import a name list from a JSON file
 * Returns a promise that resolves with the names array and filename
 */
export function importNameListFromFile(): Promise<{ names: string[]; filename: string }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!Array.isArray(data)) {
          reject(new Error('Name list must be a JSON array'));
          return;
        }

        const names = data.filter((item): item is string => typeof item === 'string');
        if (names.length === 0) {
          reject(new Error('No valid names found in file'));
          return;
        }

        const filename = file.name.replace(/\.json$/i, '');
        resolve({ names, filename });
      } catch {
        reject(new Error('Failed to parse name list file'));
      }
    };

    input.click();
  });
}

/**
 * Import an empire from a JSON file
 * Returns a promise that resolves with the parsed empire or null if cancelled
 */
export function importEmpireFromFile(): Promise<Empire | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.name || !Array.isArray(data.advantages) || data.advantages.length !== 2 || !data.disadvantage || !Array.isArray(data.units)) {
          reject(new Error('Invalid empire file format'));
          return;
        }

        resolve(data as Empire);
      } catch {
        reject(new Error('Failed to parse empire file'));
      }
    };

    input.click();
  });
}

/**
 * Export an empire to a JSON file download
 */
export function exportEmpireToFile(empire: Empire): void {
  const json = JSON.stringify(empire, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${empire.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

// ─── Campaign file export/import ────────────────────────────────────────────

/**
 * Export a campaign to a JSON file download
 */
export function exportCampaignToFile(campaign: Campaign): void {
  const json = JSON.stringify(campaign, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${campaign.settings.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_save.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

// ─── Campaign localStorage persistence ────────────────────────────────────────

const CAMPAIGN_SAVE_KEY = 'mbam_campaign_save';

/**
 * Save a campaign to localStorage
 */
export function saveCampaignToStorage(campaign: Campaign): void {
  try {
    localStorage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify(campaign));
  } catch {
    // Storage quota exceeded or unavailable — fail silently
  }
}

/**
 * Load the saved campaign from localStorage, or return null if none exists
 */
export function loadCampaignFromStorage(): Campaign | null {
  try {
    const stored = localStorage.getItem(CAMPAIGN_SAVE_KEY);
    if (!stored) return null;
    const data = JSON.parse(stored);
    // Basic validation
    if (!data.settings?.id || !Array.isArray(data.players) || !data.phase) return null;
    return data as Campaign;
  } catch {
    return null;
  }
}

/**
 * Remove the saved campaign from localStorage
 */
export function clearCampaignFromStorage(): void {
  localStorage.removeItem(CAMPAIGN_SAVE_KEY);
}

/**
 * Import a campaign from a JSON save file.
 * Returns a promise that resolves with the parsed campaign, or null if cancelled.
 */
export function importCampaignFromFile(): Promise<Campaign | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (
          !data.settings?.id ||
          !data.settings?.name ||
          !data.settings?.map ||
          !Array.isArray(data.players) ||
          data.players.length === 0 ||
          !data.phase ||
          data.currentTurn == null
        ) {
          reject(new Error('Invalid campaign save file format'));
          return;
        }

        resolve(data as Campaign);
      } catch {
        reject(new Error('Failed to parse campaign save file'));
      }
    };

    input.click();
  });
}
