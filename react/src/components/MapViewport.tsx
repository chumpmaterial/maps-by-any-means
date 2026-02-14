import { useRef, useEffect, useState, useCallback } from 'react';
import type { useMapState } from '../hooks/useMapState';
import type { System } from '../types';
import { usePanZoom } from '../hooks/usePanZoom';
import { HexGrid } from './HexGrid';
import { SystemNode } from './SystemNode';
import { SystemTooltip } from './SystemTooltip';
import { JumpLane } from './JumpLane';
import { GenerationLog } from './GenerationLog';
import { pixelToHex, hexToPixel, areAdjacent } from '../utils/hexUtils';

interface MapViewportProps {
  mapState: ReturnType<typeof useMapState>;
  generationLog?: string[];
  onClearLog?: () => void;
}

export function MapViewport({ mapState, generationLog = [], onClearLog }: MapViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const {
    viewport,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    screenToWorld,
    resetViewport,
    zoomIn,
    zoomOut,
    zoomToFit,
  } = usePanZoom({
    containerWidth: dimensions.width,
    containerHeight: dimensions.height,
  });

  const {
    map,
    selectedSystemId,
    setSelectedSystemId,
    selectedLaneId,
    setSelectedLaneId,
    getSystem,
    getSystemAtHex,
    addSystem,
    addJumpLane,
  } = mapState;

  // Tooltip state with hover delay
  const [hoveredSystem, setHoveredSystem] = useState<System | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSystemHover = useCallback((system: System | null) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (system) {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredSystem(system);
      }, 400);
    } else {
      setHoveredSystem(null);
    }
  }, []);

  // Hex coordinate display state
  const [hoveredHex, setHoveredHex] = useState<{ q: number; r: number } | null>(null);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: sx, y: sy });

    const world = screenToWorld(sx, sy);
    const hex = pixelToHex(world.x, world.y);
    setHoveredHex(hex);
  }, [screenToWorld]);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Handle click on empty space (deselect or add system)
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const world = screenToWorld(screenX, screenY);
    const hex = pixelToHex(world.x, world.y);

    // Check if there's a system at this hex
    const existingSystem = getSystemAtHex(hex);

    if (existingSystem) {
      setSelectedSystemId(existingSystem.id);
      setSelectedLaneId(null);
    } else {
      // Double-click to add a system
      if (e.detail === 2) {
        addSystem({
          name: '',
          type: 'unimportant',
          position: hex,
        });
      } else {
        setSelectedSystemId(null);
        setSelectedLaneId(null);
      }
    }
  };

  // Handle lane click
  const handleLaneClick = (laneId: string) => {
    setSelectedLaneId(laneId);
    setSelectedSystemId(null);
  };

  // Handle system click - supports shift+click to create jump lanes
  const handleSystemClick = (systemId: string, e: React.MouseEvent) => {
    if (e.shiftKey && selectedSystemId && selectedSystemId !== systemId) {
      // Shift+click: try to create a jump lane
      const fromSystem = getSystem(selectedSystemId);
      const toSystem = getSystem(systemId);

      if (fromSystem && toSystem) {
        // Check if systems are adjacent
        if (areAdjacent(fromSystem.position, toSystem.position)) {
          const lane = addJumpLane(selectedSystemId, systemId);
          if (!lane) {
            // Lane already exists - could show a message
            console.log('Jump lane already exists between these systems');
          }
        } else {
          alert('Jump lanes can only connect adjacent systems!');
        }
      }
    } else {
      // Normal click: select the system
      setSelectedSystemId(systemId);
      setSelectedLaneId(null);
    }
  };

  // Zoom to fit all systems in the viewport
  const handleZoomToFit = () => {
    if (map.systems.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const system of map.systems) {
      const { x, y } = hexToPixel(system.position);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    zoomToFit({ minX, maxX, minY, maxY });
  };

  // Calculate transform for pan/zoom
  const transform = `translate(${viewport.offsetX + dimensions.width / 2}, ${viewport.offsetY + dimensions.height / 2}) scale(${viewport.zoom})`;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={(e) => { handleMouseMove(e); handleContainerMouseMove(e); }}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); handleSystemHover(null); setHoveredHex(null); }}
    >
      <svg
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onClick={handleSvgClick}
        className="cursor-grab active:cursor-grabbing"
      >
        <g transform={transform}>
          {/* Background hex grid */}
          <HexGrid radius={8} />

          {/* Jump lanes (render below systems) */}
          {map.jumpLanes.map((lane) => {
            const fromSystem = getSystem(lane.from);
            const toSystem = getSystem(lane.to);
            if (!fromSystem || !toSystem) return null;
            return (
              <JumpLane
                key={lane.id}
                lane={lane}
                fromSystem={fromSystem}
                toSystem={toSystem}
                isSelected={lane.id === selectedLaneId}
                onClick={() => handleLaneClick(lane.id)}
              />
            );
          })}

          {/* Systems */}
          {map.systems.map((system) => (
            <SystemNode
              key={system.id}
              system={system}
              isSelected={system.id === selectedSystemId}
              onClick={(e) => handleSystemClick(system.id, e)}
              onHover={handleSystemHover}
              useTeamColors={map.useTeamColors}
              getOwnerTeamColor={(ownerId) => getSystem(ownerId)?.teamColor}
            />
          ))}
        </g>
      </svg>

      {/* System tooltip */}
      {hoveredSystem && (
        <SystemTooltip system={hoveredSystem} x={mousePos.x} y={mousePos.y} />
      )}

      {/* Hex coordinate display */}
      <div className="absolute bottom-12 left-4 rounded bg-black/50 px-1.5 py-1 text-xs text-white">
        {hoveredHex ? `Hex (${hoveredHex.q}, ${hoveredHex.r})` : 'Hex (\u2014, \u2014)'}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded bg-black/50 px-1.5 py-1">
        <button
          onClick={zoomOut}
          className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
          title="Zoom out"
        >
          −
        </button>
        <span className="min-w-[3rem] text-center text-xs text-white">
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
          title="Zoom in"
        >
          +
        </button>
        <div className="mx-0.5 h-3 w-px bg-white/30" />
        <button
          onClick={resetViewport}
          className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
          title="Reset zoom and position"
        >
          Reset
        </button>
        <button
          onClick={handleZoomToFit}
          className="rounded px-1.5 py-0.5 text-xs text-white hover:bg-white/20"
          title="Fit all systems in view"
        >
          Fit
        </button>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 right-4 rounded bg-black/50 px-2 py-1 text-xs text-white">
        Drag: pan | Scroll: zoom | Double-click: add system | Shift+click: add lane | Del: delete | Ctrl+Z/Y: undo/redo | Esc: deselect
      </div>

      {/* Generation Log */}
      <GenerationLog log={generationLog} onClear={onClearLog ?? (() => {})} />
    </div>
  );
}
