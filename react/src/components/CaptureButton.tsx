import { useState, useRef, useEffect } from 'react';
import { Camera } from 'lucide-react';

interface CaptureButtonProps {
  onFullMap: () => void;
  onClipMode: () => void;
  disabled?: boolean;
}

export function CaptureButton({ onFullMap, onClipMode, disabled = false }: CaptureButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        title={disabled ? 'No systems on map' : 'Capture map to clipboard'}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-700 dark:text-gray-200"
      >
        <Camera size={15} />
        Capture
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            onClick={() => { setOpen(false); onFullMap(); }}
          >
            Full Map
          </button>
          <button
            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            onClick={() => { setOpen(false); onClipMode(); }}
          >
            Clip Mode
          </button>
        </div>
      )}
    </div>
  );
}
