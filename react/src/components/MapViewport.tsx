import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { useMapState } from '../hooks/useMapState';
import type { System, SystemIntelSnapshot, CampaignPlayer } from '../types';
import { usePanZoom } from '../hooks/usePanZoom';
import { HexGrid } from './HexGrid';
import { SystemNode } from './SystemNode';
import { SystemTooltip } from './SystemTooltip';
import { JumpLane } from './JumpLane';
import { GenerationLog } from './GenerationLog';
import { SystemFleetBadge, getBadgeMargin } from './SystemFleetBadge';
import { pixelToHex, hexToPixel, areAdjacent, getHexCorners, cornersToSvgPoints, DEFAULT_HEX_SIZE } from '../utils/hexUtils';

export interface FowData {
  intel: Record<string, SystemIntelSnapshot>;
  initialIntel: Record<string, SystemIntelSnapshot>;
  currentTurn: number;
  blindExploration: boolean;
}

export interface FleetSummaryInfo {
  id: string;
  name: string;
  isCMFleet: boolean;
  unitCount: number;
  unitsByCategory: Partial<Record<string, number>>;
  totalEP: number;
  highestCR: number | null;
  isFast: boolean;
  isScout: boolean;
  isCivilian: boolean;
  movedThisTurn: boolean;
}

export interface FleetOwnerIndicator {
  ownerId: string;       // player.id, or 'cm' for all CM fleets grouped
  ownerName: string;     // player.name, or 'CM'
  color: string;         // player.teamColor or CM fleet color or '#6b7280' fallback
  fleets: FleetSummaryInfo[];
  totalFleets: number;
  totalUnits: number;
  unitsByCategory: Partial<Record<string, number>>;
  totalEP: number;
}

interface MapViewportProps {
  mapState: ReturnType<typeof useMapState>;
  generationLog?: string[];
  onClearLog?: () => void;
  campaignMode?: boolean;
  mapEditingMode?: boolean;
  showHexGrid?: boolean;
  tradeRouteLaneIds?: Set<string>;
  tradeRouteSystemIds?: Set<string>;
  fowData?: FowData | null;
  espionageMode?: boolean;
  onEspionageTarget?: (systemId: string) => void;
  fleetMoveMode?: { fleetId: string; playerId: string } | null;
  onFleetMoveTarget?: (systemId: string) => void;
  cmFleetMoveMode?: boolean;
  onCMFleetMoveTarget?: (systemId: string) => void;
  fleetIndicators?: Record<string, FleetOwnerIndicator[]>;
  staleSystems?: Record<string, number>;
  onFleetMove?: (playerId: string, fleetId: string) => void;
  onCMFleetMove?: (fleetId: string) => void;
  /** When set, the viewport will pan to center on the given system. Increment nonce to re-center on the same system. */
  requestCenter?: { systemId: string; nonce: number } | null;
  /** Campaign-mode ownership: systemId → playerId. When provided, overrides map editor color logic. */
  systemOwnership?: Record<string, string>;
  /** Campaign players (for color lookup by playerId). */
  campaignPlayers?: CampaignPlayer[];
  svgRef?: React.RefObject<SVGSVGElement>;
  clipModeActive?: boolean;
  clipSelectedSystemIds?: Set<string>;
  onClipToggleSystem?: (systemId: string) => void;
  galaxyStateHighlights?: Record<string, 'independent' | 'raider' | 'both'> | null;
  independentSystemColors?: Record<string, string>;
}

const SYSTEM_RADIUS_MULTIPLIERS: Record<string, number> = {
  homeworld: 0.45,
  major: 0.38,
  minor: 0.30,
  unimportant: 0.22,
};

export function MapViewport({ mapState, generationLog = [], onClearLog, campaignMode = false, mapEditingMode = false, showHexGrid = true, tradeRouteLaneIds, tradeRouteSystemIds, fowData, espionageMode = false, onEspionageTarget, fleetMoveMode, onFleetMoveTarget, cmFleetMoveMode, onCMFleetMoveTarget, fleetIndicators, staleSystems, onFleetMove, onCMFleetMove, requestCenter, systemOwnership, campaignPlayers, svgRef, clipModeActive = false, clipSelectedSystemIds, onClipToggleSystem, galaxyStateHighlights, independentSystemColors }: MapViewportProps) {
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
    centerOn,
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

  // Convert world coordinates to screen coordinates
  const worldToScreen = useCallback((wx: number, wy: number) => ({
    x: wx * viewport.zoom + viewport.offsetX + dimensions.width / 2,
    y: wy * viewport.zoom + viewport.offsetY + dimensions.height / 2,
  }), [viewport, dimensions]);

  // Center viewport on requested system
  useEffect(() => {
    if (!requestCenter) return;
    const system = map.systems.find(s => s.id === requestCenter.systemId);
    if (!system) return;
    const { x, y } = hexToPixel(system.position, DEFAULT_HEX_SIZE);
    centerOn(x, y);
  }, [requestCenter]); // eslint-disable-line react-hooks/exhaustive-deps

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

    if (existingSystem && (!fowData || !visibleSystemIds || visibleSystemIds.has(existingSystem.id))) {
      setSelectedSystemId(existingSystem.id);
      setSelectedLaneId(null);
    } else if (!existingSystem || !fowData) {
      // Double-click to add a system (disabled in campaign mode unless map editing)
      if (e.detail === 2 && (!campaignMode || mapEditingMode)) {
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

  // Fog of War: compute visible system/lane sets
  const { visibleSystemIds, outdatedSystemIds, visibleLaneIds, unknownButAdjacentSysIds } = useMemo(() => {
    if (!fowData) return { visibleSystemIds: null, outdatedSystemIds: new Set<string>(), visibleLaneIds: null, unknownButAdjacentSysIds: new Set<string>() };
    const visibleSysIds = new Set<string>();
    const outdatedSysIds = new Set<string>();
    for (const sys of map.systems) {
      const hasRunning = !!fowData.intel[sys.id];
      const hasInitial = !!fowData.initialIntel[sys.id];
      if (hasRunning) {
        visibleSysIds.add(sys.id);
        if (fowData.intel[sys.id].turn < fowData.currentTurn) outdatedSysIds.add(sys.id);
      } else if (!fowData.blindExploration && hasInitial) {
        visibleSysIds.add(sys.id);
        outdatedSysIds.add(sys.id);
      }
    }
    const visibleLaneSet = new Set<string>();
    for (const lane of map.jumpLanes) {
      if (visibleSysIds.has(lane.from) || visibleSysIds.has(lane.to)) visibleLaneSet.add(lane.id);
    }
    // In Blind Exploration mode, track unknown systems adjacent to known ones
    const unknownAdjacentIds = new Set<string>();
    if (fowData.blindExploration) {
      for (const lane of map.jumpLanes) {
        const fromVisible = visibleSysIds.has(lane.from);
        const toVisible = visibleSysIds.has(lane.to);
        if (fromVisible && !toVisible) unknownAdjacentIds.add(lane.to);
        if (toVisible && !fromVisible) unknownAdjacentIds.add(lane.from);
      }
    }
    return { visibleSystemIds: visibleSysIds, outdatedSystemIds: outdatedSysIds, visibleLaneIds: visibleLaneSet, unknownButAdjacentSysIds: unknownAdjacentIds };
  }, [fowData, map.systems, map.jumpLanes]);

  // Handle system click - supports shift+click to create jump lanes
  const handleSystemClick = (systemId: string, e: React.MouseEvent) => {
    // Fleet move mode: clicking a system sets movement target
    if (fleetMoveMode && onFleetMoveTarget) {
      onFleetMoveTarget(systemId);
      return;
    }
    // CM fleet move mode: clicking a system teleports the CM fleet there
    if (cmFleetMoveMode && onCMFleetMoveTarget) {
      onCMFleetMoveTarget(systemId);
      return;
    }
    // Espionage mode: clicking a system reports target instead of selecting
    if (espionageMode && onEspionageTarget) {
      onEspionageTarget(systemId);
      return;
    }
    if (e.shiftKey && selectedSystemId && selectedSystemId !== systemId && (!campaignMode || mapEditingMode)) {
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
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        onWheel={handleWheel}
        onClick={handleSvgClick}
        className={(espionageMode || fleetMoveMode || cmFleetMoveMode) ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}
      >
        <g transform={transform}>
          {/* Background hex grid */}
          {showHexGrid && <HexGrid radius={8} />}

          {/* FoW: dark hex overlays for outdated intel systems (rendered before lanes so they appear below) */}
          {fowData && map.systems
            .filter(s => visibleSystemIds?.has(s.id) && outdatedSystemIds.has(s.id))
            .map(s => {
              const { x, y } = hexToPixel(s.position);
              const pts = cornersToSvgPoints(getHexCorners({ x, y }, DEFAULT_HEX_SIZE - 1));
              return <polygon key={`fow-${s.id}`} points={pts} fill="black" opacity={0.45} className="pointer-events-none" />;
            })
          }

          {/* Jump lanes (render below systems) */}
          {map.jumpLanes
            .filter(l => !visibleLaneIds || visibleLaneIds.has(l.id))
            .map((lane) => {
              const fromSystem = getSystem(lane.from);
              const toSystem = getSystem(lane.to);
              if (!fromSystem || !toSystem) return null;
              const bothUnselected = clipModeActive && clipSelectedSystemIds
                ? (!clipSelectedSystemIds.has(lane.from) && !clipSelectedSystemIds.has(lane.to))
                : false;
              return (
                <g
                  key={lane.id}
                  data-lane-endpoints={`${lane.from},${lane.to}`}
                  opacity={bothUnselected ? 0.2 : 1}
                >
                  <JumpLane
                    lane={lane}
                    fromSystem={fromSystem}
                    toSystem={toSystem}
                    isSelected={lane.id === selectedLaneId}
                    onClick={() => handleLaneClick(lane.id)}
                    isOnTradeRoute={tradeRouteLaneIds?.has(lane.id)}
                  />
                </g>
              );
            })}

          {/* Blind Exploration: grey "?" markers for unknown adjacent systems (render above lanes) */}
          {fowData?.blindExploration && map.systems
            .filter(s => unknownButAdjacentSysIds.has(s.id))
            .map(s => {
              const { x, y } = hexToPixel(s.position);
              const r = DEFAULT_HEX_SIZE * 0.30;
              return (
                <g key={`unknown-${s.id}`} className="pointer-events-none">
                  <circle cx={x} cy={y} r={r} fill="#9ca3af" stroke="#6b7280" strokeWidth={2} />
                  <text x={x} y={y} textAnchor="middle" dominantBaseline="central"
                    fontSize={r * 1.1} fill="#374151" fontFamily="sans-serif" fontWeight="bold">
                    ?
                  </text>
                  <text x={x} y={y + r + 14} textAnchor="middle"
                    fontSize={10} fill="#6b7280" fontFamily="sans-serif">
                    {s.name}
                  </text>
                </g>
              );
            })
          }

          {/* Systems */}
          {map.systems
            .filter(s => !visibleSystemIds || visibleSystemIds.has(s.id))
            .map((system) => {
              const isClipDimmed = clipModeActive && clipSelectedSystemIds
                ? !clipSelectedSystemIds.has(system.id)
                : false;
              const handleClick = clipModeActive
                ? (e: React.MouseEvent) => { e.stopPropagation(); onClipToggleSystem?.(system.id); }
                : (e: React.MouseEvent) => handleSystemClick(system.id, e);
              return (
                <g
                  key={system.id}
                  data-system-id={system.id}
                  opacity={isClipDimmed ? 0.3 : 1}
                >
                  <SystemNode
                    system={system}
                    isSelected={system.id === selectedSystemId}
                    onClick={handleClick}
                    onHover={handleSystemHover}
                    useTeamColors={map.useTeamColors}
                    getOwnerTeamColor={(ownerId) => getSystem(ownerId)?.teamColor}
                    isOnTradeRoute={tradeRouteSystemIds?.has(system.id)}
                    systemOwnership={systemOwnership}
                    campaignPlayers={campaignPlayers}
                    galaxyStateHighlight={galaxyStateHighlights?.[system.id] ?? null}
                    independentColor={independentSystemColors?.[system.id] ?? null}
                  />
                </g>
              );
            })}

          {/* Fleet indicators (campaign in_progress phase) */}
          {fleetIndicators && map.systems
            .filter(s => !visibleSystemIds || visibleSystemIds.has(s.id))
            .filter(s => (fleetIndicators[s.id]?.length ?? 0) > 0)
            .map(s => {
              const { x, y } = hexToPixel(s.position);
              const sysRadius = DEFAULT_HEX_SIZE * (SYSTEM_RADIUS_MULTIPLIERS[s.type] ?? 0.30);
              const badgeMargin = getBadgeMargin(sysRadius);
              const badgeScreen = worldToScreen(x + sysRadius + badgeMargin, y - sysRadius - badgeMargin);
              return (
                <SystemFleetBadge
                  key={`badge-${s.id}`}
                  worldX={x}
                  worldY={y}
                  systemRadius={sysRadius}
                  owners={fleetIndicators[s.id]}
                  screenX={badgeScreen.x}
                  screenY={badgeScreen.y}
                  onMoveFleet={onFleetMove}
                  onMoveCMFleet={onCMFleetMove}
                  lastSeenTurn={staleSystems?.[s.id]}
                />
              );
            })
          }
        </g>
      </svg>

      {/* System tooltip */}
      {hoveredSystem && (
        <SystemTooltip system={hoveredSystem} x={mousePos.x} y={mousePos.y} />
      )}

      {/* Hex coordinate display */}
      <div className="absolute bottom-12 left-4 flex items-center gap-3 rounded bg-black/50 px-1.5 py-1 text-xs text-white">
        <span>{hoveredHex ? `Hex (${hoveredHex.q}, ${hoveredHex.r})` : 'Hex (\u2014, \u2014)'}</span>
        <span>{map.systems.length} {map.systems.length === 1 ? 'system' : 'systems'}</span>
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
        {campaignMode && !mapEditingMode
          ? 'Drag: pan | Scroll: zoom | Click: select | Ctrl+Z/Y: undo/redo | Esc: deselect'
          : 'Drag: pan | Scroll: zoom | Double-click: add system | Shift+click: add lane | Del: delete | Ctrl+Z/Y: undo/redo | Esc: deselect'
        }
      </div>

      {/* Generation Log */}
      <GenerationLog log={generationLog} onClear={onClearLog ?? (() => {})} />
    </div>
  );
}
