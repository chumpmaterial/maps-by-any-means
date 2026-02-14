import { useState, useRef, useEffect } from 'react';

interface ColorSelectOption {
  value: string;
  label: string;
  color?: string;
}

interface ColorSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ColorSelectOption[];
  placeholder?: string;
}

export function ColorSelect({ value, onChange, options, placeholder = 'Select...' }: ColorSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 rounded border border-gray-300 bg-white px-2 py-1 text-left text-sm dark:border-gray-700 dark:bg-gray-800"
      >
        {selectedOption ? (
          <>
            {selectedOption.color && (
              <div
                className="h-4 w-4 flex-shrink-0 rounded border border-gray-400 dark:border-gray-500"
                style={{ backgroundColor: selectedOption.color }}
              />
            )}
            <span className="flex-1 truncate">{selectedOption.label}</span>
          </>
        ) : (
          <span className="flex-1 text-gray-500 dark:text-gray-400">{placeholder}</span>
        )}
        <span className="ml-1 text-gray-400">▼</span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full overflow-auto rounded border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                option.value === value ? 'bg-blue-50 dark:bg-blue-900/30' : ''
              }`}
            >
              {option.color && (
                <div
                  className="h-4 w-4 flex-shrink-0 rounded border border-gray-400 dark:border-gray-500"
                  style={{ backgroundColor: option.color }}
                />
              )}
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
