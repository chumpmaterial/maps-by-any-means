import { useState, useRef, useEffect } from 'react';
import { Camera } from 'lucide-react';

interface CaptureButtonProps {
  onFullMap: () => void;
  onClipMode: () => void;
  disabled?: boolean;
  /** Override the trigger button's className. Defaults to pill-style (white icon on dark bg). */
  buttonClassName?: string;
  /** Controlled open state. When provided, onOpenChange must also be provided. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CaptureButton({ onFullMap, onClipMode, disabled = false, buttonClassName, open: controlledOpen, onOpenChange }: CaptureButtonProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(open) : val;
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };
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

  const isIconOnly = buttonClassName !== undefined;
  const btnClass = buttonClassName ?? 'flex items-center gap-1.5 rounded px-3 py-1 text-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800';

  return (
    <div ref={containerRef} className="relative">
      <button
        title={disabled ? 'No systems on map' : 'Capture map to clipboard'}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
        className={btnClass}
      >
        <Camera size={isIconOnly ? 20 : 16} />
        {!isIconOnly && 'Capture'}
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
