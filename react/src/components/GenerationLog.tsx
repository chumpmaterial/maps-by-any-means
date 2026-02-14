import { useState, useRef, useCallback, useEffect } from 'react';

interface GenerationLogProps {
  log: string[];
  onClear: () => void;
}

export function GenerationLog({ log, onClear }: GenerationLogProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 16 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: position.x,
      origY: position.y,
    };

    const handleMove = (moveE: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.origX + (moveE.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (moveE.clientY - dragRef.current.startY),
      });
    };

    const handleUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [position]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(log.join('\n'));
    setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleExport = () => {
    const text = log.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'generation-log.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (log.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className="absolute z-40 rounded bg-black/70 text-white shadow-lg backdrop-blur-sm"
      style={{ left: position.x, top: position.y, maxWidth: '420px' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Draggable header */}
      <div
        className="flex cursor-grab items-center justify-between gap-3 px-2.5 py-1.5 active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="text-xs hover:text-blue-300"
          >
            {isCollapsed ? '▶' : '▼'}
          </button>
          <span className="text-xs font-medium">Generation Log</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-white/20"
            title="Copy log to clipboard"
          >
            {copied ? '✓' : '⧉'}
          </button>
          <button
            onClick={handleExport}
            className="rounded px-1.5 py-0.5 text-xs hover:bg-white/20"
            title="Export log as text file"
          >
            Export
          </button>
          <button
            onClick={onClear}
            className="rounded px-1.5 py-0.5 text-xs text-white/60 hover:bg-white/20 hover:text-white"
            title="Dismiss log"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Log content */}
      {!isCollapsed && (
        <div className="max-h-64 overflow-auto border-t border-white/20 px-2.5 py-2">
          <pre className="select-text whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-200">
            {log.join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
