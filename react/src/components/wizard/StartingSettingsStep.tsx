interface StartingSettingsStepProps {
  year: number;
  ep: number;
  sp: number;
  useSystemIncomeEP: boolean;
  onSetYear: (year: number) => void;
  onSetEP: (ep: number) => void;
  onSetSP: (sp: number) => void;
  onSetUseSystemIncomeEP: (use: boolean) => void;
}

export function StartingSettingsStep({
  year, ep, sp, useSystemIncomeEP,
  onSetYear, onSetEP, onSetSP, onSetUseSystemIncomeEP,
}: StartingSettingsStepProps) {
  return (
    <div>
      <h3 className="mb-4 text-xl font-semibold dark:text-gray-100">Starting Settings</h3>

      <div className="space-y-6">
        {/* Starting Year */}
        <div>
          <label className="mb-2 block text-sm font-medium dark:text-gray-200">
            Starting Year
          </label>
          <input
            type="number"
            value={year}
            onChange={(e) => onSetYear(parseInt(e.target.value) || 3005)}
            className="w-40 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Default: 3005. Units with an ISD after this year will not be available at game start.
          </p>
        </div>

        <hr className="border-gray-200 dark:border-gray-700" />

        {/* Starting EP */}
        <div>
          <label className="mb-2 block text-sm font-medium dark:text-gray-200">
            Starting Economic Points (EP) per player
          </label>
          <input
            type="number"
            min={0}
            value={ep}
            onChange={(e) => onSetEP(parseInt(e.target.value) || 0)}
            disabled={useSystemIncomeEP}
            className="w-40 rounded border border-gray-300 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Default: 200</p>
        </div>

        {/* System Income Checkbox */}
        <div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={useSystemIncomeEP}
              onChange={(e) => onSetUseSystemIncomeEP(e.target.checked)}
              className="h-4 w-4"
            />
            <span className="text-sm font-medium dark:text-gray-200">
              Total System Income-based Starting EP
            </span>
          </label>
          <p className="ml-6 mt-1 text-sm text-gray-600 dark:text-gray-400">
            EP = sum of (Population x RAW) for each owned system, multiplied by 4. Overrides the fixed EP above.
          </p>
        </div>

        {/* Starting SP */}
        <div>
          <label className="mb-2 block text-sm font-medium dark:text-gray-200">
            Starting System Points (SP) per player
          </label>
          <input
            type="number"
            min={0}
            value={sp}
            onChange={(e) => onSetSP(parseInt(e.target.value) || 0)}
            className="w-40 rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Default: 24 (used to purchase star systems at game start)
          </p>
        </div>
      </div>
    </div>
  );
}
