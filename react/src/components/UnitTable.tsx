import type { UnitCategory, EmpireUnit, UnitTrait } from '../types';
import { HULL_CODES, createEmptyUnit, STANDARD_TRAITS, FACTOR_TRAITS, TROOP_TRAITS } from '../data/unitData';

interface UnitTableProps {
  category: UnitCategory;
  units: EmpireUnit[];
  onUnitsChange: (units: EmpireUnit[]) => void;
}

const inputClass = 'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100';
const numericInputClass = inputClass + ' text-center';

function isFactorTrait(name: string): boolean {
  return (FACTOR_TRAITS as readonly string[]).includes(name);
}

function getAvailableTraits(category: UnitCategory, currentTraits: UnitTrait[]): string[] {
  const usedNames = new Set(currentTraits.map(t => t.name));
  const pool = category === 'Troops'
    ? [...TROOP_TRAITS]
    : [...STANDARD_TRAITS, ...FACTOR_TRAITS];
  return pool.filter(t => !usedNames.has(t));
}

interface TraitPickerProps {
  traits: UnitTrait[];
  category: UnitCategory;
  onChange: (traits: UnitTrait[]) => void;
}

function TraitPicker({ traits, category, onChange }: TraitPickerProps) {
  function addTrait(name: string) {
    const newTrait: UnitTrait = isFactorTrait(name) ? { name, factor: 1 } : { name };
    onChange([...traits, newTrait]);
  }

  function removeTrait(index: number) {
    onChange(traits.filter((_, i) => i !== index));
  }

  function updateFactor(index: number, value: string) {
    const parsed = parseInt(value);
    const factor = value === '' ? undefined : (isNaN(parsed) ? undefined : parsed);
    onChange(traits.map((t, i) => i === index ? { ...t, factor } : t));
  }

  function commitFactor(index: number) {
    const trait = traits[index];
    if (isFactorTrait(trait.name) && (trait.factor === undefined || trait.factor === 0)) {
      onChange(traits.map((t, i) => i === index ? { ...t, factor: 1 } : t));
    }
  }

  const available = getAvailableTraits(category, traits);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {traits.map((trait, i) => (
        <span
          key={trait.name}
          className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-200"
        >
          {trait.name}
          {isFactorTrait(trait.name) && (
            <input
              type="text"
              inputMode="numeric"
              value={trait.factor ?? ''}
              onChange={(e) => updateFactor(i, e.target.value)}
              onBlur={() => commitFactor(i)}
              className="w-5 bg-transparent text-center text-xs font-bold outline-none"
            />
          )}
          <button
            onClick={() => removeTrait(i)}
            className="ml-0.5 text-blue-500 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-100"
          >
            &times;
          </button>
        </span>
      ))}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => { if (e.target.value) addTrait(e.target.value); }}
          className="w-[60px] rounded border border-dashed border-gray-400 bg-transparent px-1 py-0.5 text-xs text-gray-500 dark:border-gray-500 dark:text-gray-400"
        >
          <option value="">+</option>
          {available.map(name => (
            <option key={name} value={name} className="text-gray-900">
              {name}{isFactorTrait(name) ? ' X' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function UnitTable({ category, units, onUnitsChange }: UnitTableProps) {
  const hullCodes = HULL_CODES[category];
  const hasHullCodes = hullCodes.length > 0;
  const isTroops = category === 'Troops';

  function updateUnit(id: string, updates: Partial<EmpireUnit>) {
    onUnitsChange(units.map(u => u.id === id ? { ...u, ...updates } : u));
  }

  function removeUnit(id: string) {
    onUnitsChange(units.filter(u => u.id !== id));
  }

  function addUnit() {
    onUnitsChange([...units, createEmptyUnit(category)]);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{category}</h3>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[140px]" />  {/* Class */}
            <col className="w-[88px]" />   {/* Hull */}
            <col className="w-[60px]" />   {/* Cost */}
            <col className="w-[75px]" />   {/* ISD */}
            <col className="w-[60px]" />   {/* DV */}
            <col className="w-[60px]" />   {/* AS */}
            <col className="w-[60px]" />   {/* AF */}
            <col className="w-[60px]" />   {/* CR */}
            <col className="w-[60px]" />   {/* CC */}
            <col />                         {/* Traits - flexible */}
            <col className="w-[32px]" />   {/* Delete */}
          </colgroup>
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <th className="px-2 py-1.5 text-left font-medium">Class</th>
              <th className="px-2 py-1.5 text-left font-medium">Hull</th>
              <th className="px-2 py-1.5 text-left font-medium">Cost</th>
              <th className="px-2 py-1.5 text-left font-medium">ISD</th>
              <th className="px-2 py-1.5 text-left font-medium">DV</th>
              <th className="px-2 py-1.5 text-left font-medium">{isTroops ? 'ATK' : 'AS'}</th>
              <th className="px-2 py-1.5 text-left font-medium">AF</th>
              <th className="px-2 py-1.5 text-left font-medium">CR</th>
              <th className="px-2 py-1.5 text-left font-medium">CC</th>
              <th className="px-2 py-1.5 text-left font-medium">Traits</th>
              <th className="px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {units.map(unit => (
              <tr key={unit.id} className="border-t border-gray-200 dark:border-gray-600">
                {/* Class */}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={unit.name}
                    onChange={(e) => updateUnit(unit.id, { name: e.target.value })}
                    placeholder="Class name"
                    className={inputClass}
                  />
                </td>
                {/* Hull Code */}
                <td className="px-2 py-1">
                  {hasHullCodes ? (
                    <select
                      value={unit.hullCode}
                      onChange={(e) => updateUnit(unit.id, { hullCode: e.target.value })}
                      className={inputClass}
                    >
                      {hullCodes.map(code => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-gray-500 dark:text-gray-400 text-sm px-1">N/A</span>
                  )}
                </td>
                {/* Cost */}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={unit.cost}
                    onChange={(e) => updateUnit(unit.id, { cost: parseInt(e.target.value) || 0 })}
                    className={numericInputClass}
                  />
                </td>
                {/* ISD */}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={unit.isd}
                    onChange={(e) => updateUnit(unit.id, { isd: e.target.value })}
                    className={numericInputClass}
                  />
                </td>
                {/* DV */}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={unit.dv}
                    onChange={(e) => updateUnit(unit.id, { dv: parseInt(e.target.value) || 0 })}
                    className={numericInputClass}
                  />
                </td>
                {/* AS */}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={unit.as === '-' ? '-' : unit.as}
                    onChange={(e) => updateUnit(unit.id, { as: parseInt(e.target.value) || 0 })}
                    className={numericInputClass}
                  />
                </td>
                {/* AF */}
                <td className="px-2 py-1">
                  {isTroops ? (
                    <span className="text-gray-400 text-center block">-</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={unit.af === '-' ? '-' : unit.af}
                      onChange={(e) => updateUnit(unit.id, { af: parseInt(e.target.value) || 0 })}
                      className={numericInputClass}
                    />
                  )}
                </td>
                {/* CR */}
                <td className="px-2 py-1">
                  {isTroops ? (
                    <span className="text-gray-400 text-center block">-</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={unit.cr === '-' ? '-' : unit.cr}
                      onChange={(e) => updateUnit(unit.id, { cr: parseInt(e.target.value) || 0 })}
                      className={numericInputClass}
                    />
                  )}
                </td>
                {/* CC */}
                <td className="px-2 py-1">
                  {isTroops ? (
                    <span className="text-gray-400 text-center block">-</span>
                  ) : (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={unit.cc === '-' ? '-' : unit.cc}
                      onChange={(e) => updateUnit(unit.id, { cc: parseInt(e.target.value) || 0 })}
                      className={numericInputClass}
                    />
                  )}
                </td>
                {/* Traits */}
                <td className="px-2 py-1">
                  <TraitPicker
                    traits={unit.traits}
                    category={category}
                    onChange={(traits) => updateUnit(unit.id, { traits })}
                  />
                </td>
                {/* Delete */}
                <td className="px-2 py-1">
                  <button
                    onClick={() => removeUnit(unit.id)}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold"
                    title="Remove unit"
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
            {units.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-3 text-center text-gray-400 dark:text-gray-500 text-sm">
                  No units yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <button
        onClick={addUnit}
        className="mt-2 rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
      >
        + Add Unit
      </button>
    </div>
  );
}
