import { useState, useRef, useEffect } from 'react';

interface ImportDropdownProps {
  onImportMap: () => void;
  onImportNameList: () => void;
}

export function ImportDropdown({ onImportMap, onImportNameList }: ImportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        Import ▼
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-36 rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={() => { onImportMap(); setIsOpen(false); }}
            className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Map
          </button>
          <button
            onClick={() => { onImportNameList(); setIsOpen(false); }}
            className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Name List
          </button>
        </div>
      )}
    </div>
  );
}
