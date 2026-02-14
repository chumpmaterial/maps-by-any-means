import { useState } from 'react';
import type { useNameLists } from '../hooks/useNameLists';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  nameListHook: ReturnType<typeof useNameLists>;
}

const checkboxBase =
  'h-4 w-4 appearance-none rounded border border-gray-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-700 dark:checked:border-blue-500 dark:checked:bg-blue-500';

const checkboxSmall =
  'h-3.5 w-3.5 appearance-none rounded border border-gray-300 bg-white checked:border-blue-600 checked:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-700 dark:checked:border-blue-500 dark:checked:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40';

export function SettingsModal({ isOpen, onClose, nameListHook }: SettingsModalProps) {
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const toggleExpanded = (id: string) => {
    setExpandedLists(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-h-[80vh] w-[600px] flex-col rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h2 className="mb-4 text-lg font-semibold">Settings</h2>

        {/* Tab bar */}
        <div className="mb-4 border-b border-gray-200 dark:border-gray-700">
          <button className="border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 dark:border-blue-400 dark:text-blue-400">
            Name Lists
          </button>
        </div>

        {/* Allow Duplicates */}
        <label className="mb-4 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={nameListHook.settings.allowDuplicates}
            onChange={(e) => nameListHook.setAllowDuplicates(e.target.checked)}
            className={checkboxBase}
          />
          <span>Allow Duplicates</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            — When unchecked, identical names from different lists won't appear twice in the pool
          </span>
        </label>

        {/* Name Lists */}
        <div className="flex-1 space-y-2 overflow-y-auto border-t border-gray-200 pt-4 dark:border-gray-700">
          {nameListHook.settings.lists.map(list => {
            const isExpanded = expandedLists.has(list.id);

            return (
              <div
                key={list.id}
                className="overflow-hidden rounded-lg border border-gray-200 transition-colors dark:border-gray-700"
              >
                {/* List header */}
                <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 dark:bg-gray-750 dark:bg-gray-900/40">
                  <input
                    type="checkbox"
                    checked={list.enabled}
                    onChange={(e) => nameListHook.toggleList(list.id, e.target.checked)}
                    className={checkboxBase}
                  />
                  <button
                    onClick={() => toggleExpanded(list.id)}
                    className="flex flex-1 cursor-pointer items-center gap-2 text-left text-sm font-medium"
                  >
                    <svg
                      className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className={!list.enabled ? 'text-gray-400 dark:text-gray-500' : ''}>
                      {list.name}
                    </span>
                    <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                      ({list.names.filter(n => n.enabled).length}/{list.names.length} active)
                    </span>
                  </button>
                  {list.id !== 'default' && (
                    <button
                      onClick={() => nameListHook.removeNameList(list.id)}
                      className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Expanded names */}
                {isExpanded && (
                  <div className="max-h-48 overflow-y-auto border-t border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {list.names.map((entry, idx) => (
                        <label
                          key={idx}
                          className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 text-sm transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 ${
                            !list.enabled ? 'pointer-events-none opacity-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            disabled={!list.enabled}
                            onChange={(e) => nameListHook.toggleName(list.id, idx, e.target.checked)}
                            className={checkboxSmall}
                          />
                          <span className={
                            !list.enabled
                              ? 'text-gray-400 dark:text-gray-500'
                              : !entry.enabled
                                ? 'text-gray-400 line-through dark:text-gray-500'
                                : ''
                          }>
                            {entry.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={onClose}
            className="rounded bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
