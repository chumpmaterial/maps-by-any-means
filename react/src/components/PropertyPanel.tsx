import { useState } from 'react';
import type { useMapState } from '../hooks/useMapState';
import { useConfirm } from '../hooks/useConfirm';
import type { SystemType, LaneType, StarType, PlanetType, SystemTrait, SystemAttributes } from '../types';
import type { useNameLists } from '../hooks/useNameLists';
import { generateRandomTeamColor } from '../utils/colorUtils';
import { ColorSelect } from './ColorSelect';
import {
  traitInfo,
  allTraits,
  calculateAttributes,
  hasCustomAttributes,
  planetTypeImportance,
} from '../data/systemData';
import { presetSystemsByImportance } from '../data/presetSystems';
import type { PresetSystem } from '../data/presetSystems';

interface PropertyPanelProps {
  mapState: ReturnType<typeof useMapState>;
  nameListHook: ReturnType<typeof useNameLists>;
}

const systemTypes: { value: SystemType; label: string }[] = [
  { value: 'homeworld', label: 'Homeworld' },
  { value: 'major', label: 'Major System' },
  { value: 'minor', label: 'Minor System' },
  { value: 'unimportant', label: 'Unimportant System' },
];

const laneTypes: { value: LaneType; label: string }[] = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'unexplored', label: 'Unexplored' },
];

const starTypeOptions: { value: StarType; label: string }[] = [
  { value: 'blue', label: 'Blue Giant (A)' },
  { value: 'white', label: 'White (F)' },
  { value: 'yellow', label: 'Yellow (G)' },
  { value: 'orange', label: 'Orange (K)' },
  { value: 'red', label: 'Red Star (M)' },
  { value: 'dwarf', label: 'Dwarf Star (D)' },
];

const planetTypeOptions: { value: PlanetType; label: string }[] = [
  { value: 'extreme', label: 'Extreme' },
  { value: 'dead', label: 'Dead' },
  { value: 'barren', label: 'Barren' },
  { value: 'adaptable', label: 'Adaptable' },
  { value: 'garden', label: 'Garden' },
  { value: 'homeworld', label: 'Homeworld' },
];

// Attribute abbreviations for display
const attrAbbrev: Record<keyof SystemAttributes, string> = {
  capacity: 'CAP',
  raw: 'RAW',
  population: 'POP',
  morale: 'MOR',
  intel: 'INT',
  fortification: 'FOR',
};

// Format trait modifiers for display (e.g., "+1 RAW, +1 MOR")
function formatTraitModifiers(trait: SystemTrait): string {
  const mods = traitInfo[trait].modifiers;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(mods)) {
    if (value) {
      const abbr = attrAbbrev[key as keyof SystemAttributes];
      parts.push(`+${value} ${abbr}`);
    }
  }
  return parts.join(', ');
}

export function PropertyPanel({ mapState, nameListHook }: PropertyPanelProps) {
  const confirm = useConfirm();
  const {
    selectedSystemId,
    selectedLaneId,
    getSystem,
    getJumpLane,
    updateJumpLane,
    removeJumpLane,
  } = mapState;

  const selectedSystem = selectedSystemId ? getSystem(selectedSystemId) : null;
  const selectedLane = selectedLaneId ? getJumpLane(selectedLaneId) : null;

  // Nothing selected
  if (!selectedSystem && !selectedLane) {
    return (
      <aside className="w-64 border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Select a system or jump lane to view its properties
        </p>
      </aside>
    );
  }

  // Jump Lane selected
  if (selectedLane) {
    const fromSystem = getSystem(selectedLane.from);
    const toSystem = getSystem(selectedLane.to);

    return (
      <aside className="w-64 border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-4 text-lg font-semibold">Jump Lane Properties</h2>

        <div className="space-y-4">
          {/* From System (read-only) */}
          <div>
            <label className="mb-1 block text-sm font-medium">From</label>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {fromSystem?.name || 'Unknown'}
            </p>
          </div>

          {/* To System (read-only) */}
          <div>
            <label className="mb-1 block text-sm font-medium">To</label>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {toSystem?.name || 'Unknown'}
            </p>
          </div>

          {/* Lane Type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Lane Type</label>
            <select
              value={selectedLane.type || 'unexplored'}
              onChange={(e) => updateJumpLane(selectedLane.id, { type: e.target.value as LaneType })}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            >
              {laneTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Delete button */}
          <div className="pt-4">
            <button
              onClick={async () => {
                const confirmed = await confirm({ title: 'Delete Lane', message: 'Delete this jump lane?' });
                if (confirmed) {
                  removeJumpLane(selectedLane.id);
                }
              }}
              className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
            >
              Delete Lane
            </button>
          </div>
        </div>
      </aside>
    );
  }

  // System selected
  if (!selectedSystem) return null;

  return (
    <SystemPropertiesPanel
      mapState={mapState}
      selectedSystem={selectedSystem}
      nameListHook={nameListHook}
    />
  );
}

interface SystemPropertiesPanelProps {
  mapState: ReturnType<typeof useMapState>;
  selectedSystem: NonNullable<ReturnType<ReturnType<typeof useMapState>['getSystem']>>;
  nameListHook: ReturnType<typeof useNameLists>;
}

function SystemPropertiesPanel({ mapState, selectedSystem, nameListHook }: SystemPropertiesPanelProps) {
  const confirm = useConfirm();
  const {
    map,
    updateSystem,
    removeSystem,
    getLanesForSystem,
    setUseTeamColors,
    getHomeworlds,
  } = mapState;

  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [presetsExpanded, setPresetsExpanded] = useState(false);

  // Apply a preset system's properties to the selected system
  const handleApplyPreset = (preset: PresetSystem) => {
    updateSystem(selectedSystem.id, {
      name: preset.name,
      type: preset.type,
      starType: preset.starType,
      planetType: preset.planetType,
      traits: preset.traits.length > 0 ? preset.traits : undefined,
      attributes: preset.attributes,
    });
    setDetailsExpanded(true);
  };

  const homeworlds = getHomeworlds();
  const isHomeworld = selectedSystem.type === 'homeworld';

  // Calculate expected attributes from planet type and traits
  const calculatedAttributes = selectedSystem.planetType
    ? calculateAttributes(selectedSystem.planetType, selectedSystem.traits || [])
    : null;

  const isCustomAttributes = hasCustomAttributes(
    selectedSystem.attributes,
    selectedSystem.planetType,
    selectedSystem.traits || []
  );

  // Handle planet type change - recalculate attributes and derive importance
  const handlePlanetTypeChange = (planetType: PlanetType | '') => {
    if (planetType === '') {
      updateSystem(selectedSystem.id, {
        planetType: undefined,
        attributes: undefined,
        type: 'unimportant',
      });
    } else {
      const newAttributes = calculateAttributes(planetType, selectedSystem.traits || []);
      updateSystem(selectedSystem.id, {
        planetType,
        attributes: newAttributes,
        type: planetTypeImportance[planetType],
      });
    }
  };

  // Count occurrences of a trait
  const getTraitCount = (trait: SystemTrait): number => {
    return (selectedSystem.traits || []).filter((t) => t === trait).length;
  };

  // Total trait selections (max 2)
  const totalTraitCount = (selectedSystem.traits || []).length;

  // Handle trait count change (0, 1, or 2)
  const handleTraitChange = (trait: SystemTrait, delta: number) => {
    const currentTraits = selectedSystem.traits || [];
    const currentCount = getTraitCount(trait);
    const newCount = Math.max(0, Math.min(2, currentCount + delta));

    // Can't exceed 2 total traits
    if (delta > 0 && totalTraitCount >= 2) return;

    let newTraits: SystemTrait[];
    if (newCount > currentCount) {
      // Add one instance
      newTraits = [...currentTraits, trait];
    } else if (newCount < currentCount) {
      // Remove one instance
      const idx = currentTraits.indexOf(trait);
      newTraits = [...currentTraits.slice(0, idx), ...currentTraits.slice(idx + 1)];
    } else {
      return; // No change
    }

    // Recalculate attributes if we have a planet type
    const newAttributes = selectedSystem.planetType
      ? calculateAttributes(selectedSystem.planetType, newTraits)
      : undefined;

    updateSystem(selectedSystem.id, {
      traits: newTraits.length > 0 ? newTraits : undefined,
      attributes: newAttributes,
    });
  };

  // Handle attribute override
  const handleAttributeChange = (key: keyof SystemAttributes, value: number) => {
    const currentAttributes = selectedSystem.attributes || calculatedAttributes;
    if (!currentAttributes) return;

    updateSystem(selectedSystem.id, {
      attributes: {
        ...currentAttributes,
        [key]: value,
      },
    });
  };

  // Reset attributes to calculated values
  const handleResetAttributes = () => {
    if (!calculatedAttributes) return;
    updateSystem(selectedSystem.id, { attributes: calculatedAttributes });
  };

  return (
    <aside className="w-64 overflow-y-auto border-l border-gray-300 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <h2 className="mb-4 text-lg font-semibold">System Properties</h2>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={selectedSystem.name}
              onChange={(e) => updateSystem(selectedSystem.id, { name: e.target.value })}
              className="flex-1 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
            />
            <button
              onClick={() => {
                const usedNames = mapState.map.systems
                  .filter(s => s.id !== selectedSystem.id)
                  .map(s => s.name);
                const randomName = nameListHook.getRandomName(usedNames);
                if (randomName) {
                  updateSystem(selectedSystem.id, { name: randomName });
                }
              }}
              className="flex-shrink-0 rounded border border-gray-300 px-1.5 py-1 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-700"
              title="Random name"
            >
              🎲
            </button>
          </div>
        </div>

        {/* Importance (derived from planet type) */}
        <div>
          <label className="mb-1 block text-sm font-medium">Importance</label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {systemTypes.find((t) => t.value === selectedSystem.type)?.label || 'Unimportant System'}
          </p>
        </div>

        {/* Position (read-only) */}
        <div>
          <label className="mb-1 block text-sm font-medium">Position</label>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            q: {selectedSystem.position.q}, r: {selectedSystem.position.r}
          </p>
        </div>

        {/* Team Color section - only for homeworlds */}
        {isHomeworld && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="mb-2 block text-sm font-medium">Team Color</label>
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded border border-gray-300 dark:border-gray-600"
                style={{ backgroundColor: selectedSystem.teamColor || '#888888' }}
              />
              <input
                type="color"
                value={selectedSystem.teamColor || '#888888'}
                onChange={(e) => updateSystem(selectedSystem.id, { teamColor: e.target.value })}
                className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <button
                onClick={() => updateSystem(selectedSystem.id, { teamColor: generateRandomTeamColor() })}
                className="rounded bg-gray-200 px-2 py-1 text-xs hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
              >
                Random
              </button>
            </div>

            <div className="mt-4">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={map.useTeamColors || false}
                  onChange={(e) => setUseTeamColors(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600"
                />
                <span className="text-sm">Use Team Colors</span>
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Display team colors on all systems
              </p>
            </div>
          </div>
        )}

        {/* Owner dropdown - only for non-homeworlds when team colors enabled */}
        {!isHomeworld && map.useTeamColors && homeworlds.length > 0 && (
          <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
            <label className="mb-1 block text-sm font-medium">Owner</label>
            <ColorSelect
              value={selectedSystem.owner || ''}
              onChange={(value) => updateSystem(selectedSystem.id, { owner: value || undefined })}
              placeholder="None"
              options={[
                { value: '', label: 'None' },
                ...homeworlds.map((hw) => ({
                  value: hw.id,
                  label: hw.name,
                  color: hw.teamColor,
                })),
              ]}
            />
          </div>
        )}

        {/* System Details Section */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span>System Details</span>
            <span className="text-gray-500">{detailsExpanded ? '−' : '+'}</span>
          </button>

          {detailsExpanded && (
            <div className="mt-3 space-y-3">
              {/* Star Type */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Star Type
                </label>
                <select
                  value={selectedSystem.starType || ''}
                  onChange={(e) =>
                    updateSystem(selectedSystem.id, {
                      starType: e.target.value ? (e.target.value as StarType) : undefined,
                    })
                  }
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Not set</option>
                  {starTypeOptions.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Planet Type */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                  Planet Type
                </label>
                <select
                  value={selectedSystem.planetType || ''}
                  onChange={(e) => handlePlanetTypeChange(e.target.value as PlanetType | '')}
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Not set</option>
                  {planetTypeOptions.map((pt) => (
                    <option key={pt.value} value={pt.value}>
                      {pt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Traits (only show if planet type is set) */}
              {selectedSystem.planetType && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Traits
                    </label>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {totalTraitCount}/2
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {allTraits.map((trait) => {
                      const count = getTraitCount(trait);
                      const canAdd = totalTraitCount < 2 && count < 2;
                      const canRemove = count > 0;
                      return (
                        <div key={trait} className="flex items-center gap-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleTraitChange(trait, -1)}
                              disabled={!canRemove}
                              className="flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-xs font-bold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
                            >
                              −
                            </button>
                            <span className="w-4 text-center text-xs font-medium">{count}</span>
                            <button
                              onClick={() => handleTraitChange(trait, 1)}
                              disabled={!canAdd}
                              className="flex h-5 w-5 items-center justify-center rounded bg-gray-200 text-xs font-bold hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-xs">
                            <span className="font-medium">{traitInfo[trait].name}</span>
                            <span className="ml-1 text-gray-500 dark:text-gray-400">
                              ({formatTraitModifiers(trait)})
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Attributes (only show if planet type is set) */}
              {selectedSystem.planetType && selectedSystem.attributes && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      Attributes
                      {isCustomAttributes && (
                        <span className="ml-1 text-yellow-600 dark:text-yellow-400">(custom)</span>
                      )}
                    </label>
                    {isCustomAttributes && (
                      <button
                        onClick={handleResetAttributes}
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['capacity', 'raw', 'population', 'morale', 'intel', 'fortification'] as const).map(
                      (attr) => (
                        <div key={attr} className="flex items-center gap-1">
                          <label className="w-12 text-xs capitalize text-gray-500 dark:text-gray-400">
                            {attr === 'fortification' ? 'Fort' : attr.slice(0, 3).toUpperCase()}
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={selectedSystem.attributes![attr]}
                            onChange={(e) =>
                              handleAttributeChange(attr, Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            className="w-12 rounded border border-gray-300 bg-transparent px-1 py-0.5 text-xs dark:border-gray-700"
                          />
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Preset Systems */}
        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={() => setPresetsExpanded(!presetsExpanded)}
            className="flex w-full items-center justify-between text-sm font-medium"
          >
            <span>Preset Systems</span>
            <span className="text-gray-500">{presetsExpanded ? '−' : '+'}</span>
          </button>

          {presetsExpanded && (
            <div className="mt-3">
              <select
                value=""
                onChange={(e) => {
                  const [importance, name] = e.target.value.split('::');
                  const group = presetSystemsByImportance[importance];
                  const preset = group?.find((p) => p.name === name);
                  if (preset) handleApplyPreset(preset);
                }}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              >
                <option value="">Select a preset...</option>
                {Object.entries(presetSystemsByImportance).map(([importance, systems]) => (
                  <optgroup key={importance} label={importance}>
                    {systems.map((preset) => (
                      <option key={preset.name} value={`${importance}::${preset.name}`}>
                        {preset.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Delete button */}
        <div className="pt-4">
          <button
            onClick={async () => {
              const laneCount = getLanesForSystem(selectedSystem.id).length;
              const name = selectedSystem.name || 'Unnamed';
              const message = laneCount > 0
                ? `Delete "${name}" and its ${laneCount} connected lane(s)?`
                : `Delete "${name}"?`;
              const confirmed = await confirm({ title: 'Delete System', message });
              if (confirmed) {
                removeSystem(selectedSystem.id);
              }
            }}
            className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
          >
            Delete System
          </button>
        </div>
      </div>
    </aside>
  );
}
