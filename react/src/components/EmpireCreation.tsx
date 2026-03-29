import { useState } from 'react';
import type { AppView } from '../App';
import type { Empire, EmpireUnit, UnitCategory } from '../types';
import { EMPIRE_ADVANTAGES, EMPIRE_DISADVANTAGES } from '../data/empireTraits';
import { DEFAULT_UNITS, FACTOR_TRAITS } from '../data/unitData';
import { exportEmpireToFile, importEmpireFromFile } from '../utils/fileUtils';
import { UnitTable } from './UnitTable';

interface EmpireCreationProps {
  onNavigate: (view: AppView) => void;
}

const UNIT_CATEGORIES: UnitCategory[] = ['Ships', 'Fighters', 'Bases', 'Troops', 'Civilian'];

export function EmpireCreation({ onNavigate }: EmpireCreationProps) {
  const [name, setName] = useState('');
  const [advantage1, setAdvantage1] = useState('');
  const [advantage2, setAdvantage2] = useState('');
  const [disadvantage, setDisadvantage] = useState('');
  const [units, setUnits] = useState<EmpireUnit[]>(() =>
    DEFAULT_UNITS.map(u => ({ ...u, id: crypto.randomUUID() }))
  );

  const canExport = name.trim() && advantage1 && advantage2 && disadvantage;

  function handleUnitsChange(category: UnitCategory, categoryUnits: EmpireUnit[]) {
    setUnits(prev => [
      ...prev.filter(u => u.category !== category),
      ...categoryUnits,
    ]);
  }

  function handleExport() {
    if (!canExport) return;

    // Validate factor traits have a valid factor number
    for (const unit of units) {
      for (const trait of unit.traits) {
        if (trait.factor === undefined && (FACTOR_TRAITS as readonly string[]).includes(trait.name)) {
          alert(`"${unit.name || 'Unnamed unit'}" has trait "${trait.name}" without a factor number.`);
          return;
        }
      }
    }

    const empire: Empire = {
      id: crypto.randomUUID(),
      name: name.trim(),
      advantages: [advantage1, advantage2],
      disadvantage,
      units,
    };

    exportEmpireToFile(empire);
  }

  async function handleImport() {
    try {
      const empire = await importEmpireFromFile();
      if (!empire) return;

      setName(empire.name);
      setAdvantage1(empire.advantages[0] || '');
      setAdvantage2(empire.advantages[1] || '');
      setDisadvantage(empire.disadvantage);
      setUnits(empire.units.map(u => ({ ...u, id: crypto.randomUUID() })));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import empire');
    }
  }

  const selectClass = 'w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

  return (
    <div className="flex h-screen flex-col items-center bg-gray-100 dark:bg-gray-900 overflow-y-auto">
      <div className="w-full max-w-6xl py-12 px-4">
        <h1 className="mb-8 text-4xl font-bold text-gray-800 dark:text-gray-100 text-center">
          Empire Creation
        </h1>

        <div className="space-y-6">
          {/* Empire Name + Traits row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Empire Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter empire name..."
                className={selectClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Advantage 1
              </label>
              <select value={advantage1} onChange={(e) => setAdvantage1(e.target.value)} className={selectClass}>
                <option value="">Select...</option>
                {EMPIRE_ADVANTAGES.filter((a) => a !== advantage2).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Advantage 2
              </label>
              <select value={advantage2} onChange={(e) => setAdvantage2(e.target.value)} className={selectClass}>
                <option value="">Select...</option>
                {EMPIRE_ADVANTAGES.filter((a) => a !== advantage1).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Disadvantage
              </label>
              <select value={disadvantage} onChange={(e) => setDisadvantage(e.target.value)} className={selectClass}>
                <option value="">Select...</option>
                {EMPIRE_DISADVANTAGES.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Unit Tables */}
          {UNIT_CATEGORIES.map(category => (
            <UnitTable
              key={category}
              category={category}
              units={units.filter(u => u.category === category)}
              onUnitsChange={(categoryUnits) => handleUnitsChange(category, categoryUnits)}
            />
          ))}

          {/* Actions */}
          <div className="flex gap-4 pt-4">
            <button
              onClick={() => onNavigate('gameManagement')}
              className="rounded-lg border border-gray-300 px-6 py-3 font-semibold text-gray-700 hover:bg-gray-200 transition-colors dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Back
            </button>
            <button
              onClick={handleImport}
              className="rounded-lg border border-blue-500 px-6 py-3 font-semibold text-blue-600 hover:bg-blue-50 transition-colors dark:text-blue-400 dark:border-blue-400 dark:hover:bg-gray-800"
            >
              Import
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport}
              className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white shadow-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
