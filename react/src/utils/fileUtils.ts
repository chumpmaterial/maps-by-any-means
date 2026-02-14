import type { GameMap } from '../types';

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
