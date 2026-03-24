import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FleetOwnerIndicator, FleetSummaryInfo } from './MapViewport';

interface SystemFleetBadgeProps {
  worldX: number;          // system center x in world coords
  worldY: number;          // system center y in world coords
  systemRadius: number;    // system visual radius in world coords
  owners: FleetOwnerIndicator[];
  screenX: number;         // pre-computed badge anchor screen x
  screenY: number;         // pre-computed badge anchor screen y
  onMoveFleet?: (playerId: string, fleetId: string) => void;
  onMoveCMFleet?: (fleetId: string) => void;
  lastSeenTurn?: number;
}

const SHAPE_HALF_BASE = 7;
const SHAPE_HEIGHT = 8;
const SHAPE_OVERLAP_OFFSET = 3;
const CIRCLE_RADIUS = 17;  // sized for max 6 badge owners: (5×3/2)+7+3 = 17.5 → 17
const BADGE_TRIANGLE_CAP = 6;  // max triangles shown in the collapsed badge
const EXPANDED_SHAPE_SPACING = 22;
const EXPANDED_SHAPE_HIT_RADIUS = 11;  // clickable circle radius in expanded view

/**
 * Returns the world-unit offset from the system edge to the badge anchor centre,
 * computed so there is always a ~3px visual gap between the system circle and the
 * hover circle regardless of system size.
 *
 * gap = (systemRadius + margin) * √2 − systemRadius − CIRCLE_RADIUS ≈ 3
 * ⟹  margin = (3 + systemRadius + CIRCLE_RADIUS) / √2 − systemRadius
 */
export function getBadgeMargin(systemRadius: number): number {
  return Math.ceil((3 + systemRadius + CIRCLE_RADIUS) / Math.SQRT2 - systemRadius);
}

function trianglePoints(cx: number, cy: number, halfBase: number, height: number): string {
  return `${cx},${cy - height} ${cx - halfBase},${cy + height * 0.2} ${cx + halfBase},${cy + height * 0.2}`;
}

function SingleOwnerTooltip({ owner }: { owner: FleetOwnerIndicator }) {
  return (
    <>
      <div className="mb-1 font-semibold" style={{ color: owner.color }}>{owner.ownerName}</div>
      {Object.entries(owner.unitsByCategory).map(([cat, count]) => (
        <div key={cat} className="flex justify-between gap-4">
          <span className="text-gray-400">{cat}</span>
          <span>{count}</span>
        </div>
      ))}
      <div className="mt-1 border-t border-gray-700 pt-1 flex justify-between gap-4">
        <span className="text-gray-400">Total EP</span>
        <span>{owner.totalEP}</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-gray-400">Fleets</span>
        <span>{owner.totalFleets}</span>
      </div>
    </>
  );
}

function MultiOwnerTooltip({ owners }: { owners: FleetOwnerIndicator[] }) {
  const totalFleets = owners.reduce((s, o) => s + o.totalFleets, 0);
  return (
    <>
      <div className="mb-1 font-semibold">{totalFleets} fleets present</div>
      {owners.map(o => (
        <div key={o.ownerId} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} />
          <span className="text-gray-300">{o.ownerName}:</span>
          <span>{o.totalFleets}</span>
        </div>
      ))}
    </>
  );
}

interface FleetRowProps {
  fleet: FleetSummaryInfo;
  onHover: (id: string | null) => void;
  isHovered: boolean;
  onClick: () => void;
}

function FleetRow({ fleet, onHover, isHovered, onClick }: FleetRowProps) {
  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer text-xs ${isHovered ? 'bg-gray-700/60' : 'hover:bg-gray-700/40'}`}
      onMouseEnter={() => onHover(fleet.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      <span className="flex-1 min-w-0 truncate text-gray-100">{fleet.name}</span>
      <span className="shrink-0 text-gray-400">{fleet.unitCount}u</span>
      <span className="shrink-0 text-gray-400">CR:{fleet.highestCR ?? '—'}</span>
      <div className="flex gap-0.5 shrink-0">
        {fleet.isFast && <span className="rounded bg-blue-600 px-0.5 text-[9px] font-bold text-white">F</span>}
        {fleet.isScout && <span className="rounded bg-green-600 px-0.5 text-[9px] font-bold text-white">S</span>}
        {fleet.isCivilian && <span className="rounded bg-purple-600 px-0.5 text-[9px] font-bold text-white">C</span>}
        {fleet.movedThisTurn && <span className="rounded bg-yellow-600 px-0.5 text-[9px] font-bold text-white">M</span>}
      </div>
    </div>
  );
}

export function SystemFleetBadge({
  worldX,
  worldY,
  systemRadius,
  owners,
  screenX,
  screenY,
  onMoveFleet,
  onMoveCMFleet,
  lastSeenTurn,
}: SystemFleetBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeOwnerId, setActiveOwnerId] = useState<string | null>(null);
  const [hoveredFleetId, setHoveredFleetId] = useState<string | null>(null);
  const [hoveredOwnerId, setHoveredOwnerId] = useState<string | null>(null);
  // Actual browser-viewport bounds of the expanded pill, set via getBoundingClientRect()
  const [pillScreenBounds, setPillScreenBounds] = useState<{ left: number; right: number } | null>(null);

  const circleRef = useRef<SVGCircleElement | null>(null);
  const expandedGroupRef = useRef<SVGGElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Badge anchor in world coords (top-right of system), with per-size margin
  const badgeMargin = getBadgeMargin(systemRadius);
  const anchorX = worldX + systemRadius + badgeMargin;
  const anchorY = worldY - systemRadius - badgeMargin;

  // Triangles shown in the collapsed badge (capped); all owners used in expanded/tooltips
  const badgeOwners = owners.slice(0, BADGE_TRIANGLE_CAP);

  // Close fleet list popup when activeOwnerId changes
  useEffect(() => {
    setHoveredFleetId(null);
  }, [activeOwnerId]);

  // Close when clicking outside the badge/popup
  useEffect(() => {
    if (!isExpanded && !activeOwnerId) return;
    const handler = (e: MouseEvent) => {
      const inCircle = circleRef.current?.contains(e.target as Node);
      const inExpanded = expandedGroupRef.current?.contains(e.target as Node);
      const inPopup = popupRef.current?.contains(e.target as Node);
      if (!inCircle && !inExpanded && !inPopup) {
        setIsExpanded(false);
        setActiveOwnerId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isExpanded, activeOwnerId]);

  const handleCircleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ownersWithFleets = owners.filter(o => o.fleets.length > 0);
    if (ownersWithFleets.length === 0) return;  // untasked-only: tooltip is enough
    if (owners.length === 1) {
      setActiveOwnerId(prev => (prev === owners[0].ownerId ? null : owners[0].ownerId));
    } else {
      setIsExpanded(prev => !prev);
    }
  };

  const handleFleetClick = (owner: FleetOwnerIndicator, fleet: FleetSummaryInfo) => {
    setActiveOwnerId(null);
    setIsExpanded(false);
    if (fleet.isCMFleet) {
      onMoveCMFleet?.(fleet.id);
    } else {
      onMoveFleet?.(owner.ownerId, fleet.id);
    }
  };

  const activeOwner = owners.find(o => o.ownerId === activeOwnerId);
  const hoveredOwner = owners.find(o => o.ownerId === hoveredOwnerId);

  // Expanded rect geometry — sized for ALL owners
  const expandedRectW = 16 + owners.length * EXPANDED_SHAPE_SPACING;
  const expandedRectX = anchorX - expandedRectW / 2;
  const expandedRectY = anchorY - 18;

  // Tooltip / popup screen positioning
  const tooltipLeft = screenX + 20;
  const popupLeft = screenX + 20;
  const fleetTooltipLeft = popupLeft + 228;  // right of the w-56 (224px) popup

  // Portal 2: position using actual pill browser bounds (from getBoundingClientRect).
  // Right-anchor to pill left edge using CSS `right`, or left-anchor to pill right edge as fallback.
  const EXPANDED_TOOLTIP_W = 192;  // w-48
  const EXPANDED_TOOLTIP_GAP = 8;
  const expandedTooltipStyle: React.CSSProperties = pillScreenBounds
    ? pillScreenBounds.left - EXPANDED_TOOLTIP_W - EXPANDED_TOOLTIP_GAP >= 0
      ? { right: window.innerWidth - pillScreenBounds.left + EXPANDED_TOOLTIP_GAP, top: screenY - 8 }
      : { left: pillScreenBounds.right + EXPANDED_TOOLTIP_GAP, top: screenY - 8 }
    : { left: screenX + 20, top: screenY - 8 };

  return (
    <>
      {/* Hover detection circle */}
      <circle
        ref={circleRef}
        cx={anchorX}
        cy={anchorY}
        r={CIRCLE_RADIUS}
        fill={isHovered ? 'rgba(96,165,250,0.12)' : 'transparent'}
        stroke={isHovered ? 'rgba(96,165,250,0.3)' : 'none'}
        strokeWidth={1}
        className="cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => { setIsHovered(false); setHoveredOwnerId(null); }}
        onClick={handleCircleClick}
      />

      {/* Collapsed indicator triangles — capped at BADGE_TRIANGLE_CAP, centered on anchor,
          rendered right-to-left so index 0 is on top */}
      {!isExpanded && badgeOwners.map((owner, i) => ({ owner, i })).reverse().map(({ owner, i }) => (
        <polygon
          key={owner.ownerId}
          points={trianglePoints(
            anchorX + (i - (badgeOwners.length - 1) / 2) * SHAPE_OVERLAP_OFFSET,
            anchorY,
            SHAPE_HALF_BASE,
            SHAPE_HEIGHT,
          )}
          fill={owner.color}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth={0.5}
          className="pointer-events-none"
        />
      ))}

      {/* Expanded state: rounded rect + one hit-circle+triangle per owner (ALL owners) */}
      {isExpanded && (
        <g ref={expandedGroupRef}>
          <rect
            x={expandedRectX}
            y={expandedRectY}
            width={expandedRectW}
            height={36}
            rx={14}
            fill="rgba(17,24,39,0.85)"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1}
            onClick={e => e.stopPropagation()}
          />
          {owners.map((owner, i) => {
            const shapeCX = expandedRectX + 8 + i * EXPANDED_SHAPE_SPACING + EXPANDED_SHAPE_SPACING / 2;
            const isOwnerHovered = hoveredOwnerId === owner.ownerId;
            const hasFleets = owner.fleets.length > 0;
            return (
              <g key={owner.ownerId}>
                {/* Hit circle — always present so the full hover area is interactive */}
                <circle
                  cx={shapeCX}
                  cy={anchorY}
                  r={EXPANDED_SHAPE_HIT_RADIUS}
                  fill={isOwnerHovered ? 'rgba(255,255,255,0.12)' : 'transparent'}
                  className={hasFleets ? 'cursor-pointer' : 'cursor-default'}
                  onMouseEnter={() => {
                    setHoveredOwnerId(owner.ownerId);
                    if (expandedGroupRef.current) {
                      const r = expandedGroupRef.current.getBoundingClientRect();
                      setPillScreenBounds({ left: r.left, right: r.right });
                    }
                  }}
                  onMouseLeave={() => setHoveredOwnerId(null)}
                  onClick={(e) => { e.stopPropagation(); if (hasFleets) setActiveOwnerId(owner.ownerId); }}
                />
                {/* Triangle — pointer-events-none, covered by the hit circle above */}
                <polygon
                  points={trianglePoints(shapeCX, anchorY, SHAPE_HALF_BASE, SHAPE_HEIGHT)}
                  fill={owner.color}
                  stroke="rgba(0,0,0,0.3)"
                  strokeWidth={0.5}
                  className="pointer-events-none"
                />
              </g>
            );
          })}
        </g>
      )}

      {/* Portal 1: Hover tooltip */}
      {isHovered && !isExpanded && !activeOwnerId && createPortal(
        <div
          className="pointer-events-none fixed z-50 w-48 rounded-lg border border-gray-600 bg-gray-900/95 px-3 py-2 text-xs text-gray-100 shadow-xl"
          style={{ left: tooltipLeft, top: screenY - 8 }}
        >
          {owners.length === 1
            ? <SingleOwnerTooltip owner={owners[0]} />
            : <MultiOwnerTooltip owners={owners} />
          }
          {lastSeenTurn !== undefined && (
            <div className="mt-1 border-t border-gray-700 pt-1 text-yellow-400/70">
              Intel from Turn {lastSeenTurn}
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Portal 2: Per-owner tooltip in expanded state.
          Uses getBoundingClientRect() on the pill <g> for true browser coords.
          Right-anchored (CSS `right`) to pill left edge, falls back to right side. */}
      {isExpanded && hoveredOwner && createPortal(
        <div
          className="pointer-events-none fixed z-50 w-48 rounded-lg border border-gray-600 bg-gray-900/95 px-3 py-2 text-xs text-gray-100 shadow-xl"
          style={expandedTooltipStyle}
        >
          <SingleOwnerTooltip owner={hoveredOwner} />
        </div>,
        document.body,
      )}

      {/* Portal 3: Fleet list popup */}
      {activeOwner && createPortal(
        <div
          ref={popupRef}
          className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-600 bg-gray-900/95 shadow-xl"
          style={{ left: popupLeft, top: screenY }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="border-b border-gray-700 px-3 py-2 text-xs font-semibold text-gray-200">
            <span style={{ color: activeOwner.color }}>{activeOwner.ownerName}</span>
            <span className="text-gray-400"> — {activeOwner.fleets.length} fleet{activeOwner.fleets.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {activeOwner.fleets.map(fleet => (
              <FleetRow
                key={fleet.id}
                fleet={fleet}
                isHovered={hoveredFleetId === fleet.id}
                onHover={setHoveredFleetId}
                onClick={() => handleFleetClick(activeOwner, fleet)}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}

      {/* Portal 4: Per-fleet unit breakdown tooltip */}
      {activeOwner && hoveredFleetId && createPortal(
        (() => {
          const hoveredFleet = activeOwner.fleets.find(f => f.id === hoveredFleetId);
          if (!hoveredFleet || Object.keys(hoveredFleet.unitsByCategory).length === 0) return null;
          return (
            <div
              className="pointer-events-none fixed z-[60] min-w-max rounded-lg border border-gray-600 bg-gray-900/95 px-2 py-1.5 text-xs text-gray-100 shadow-xl"
              style={{ left: fleetTooltipLeft, top: screenY + 8 }}
            >
              {Object.entries(hoveredFleet.unitsByCategory).map(([cat, count]) => (
                <div key={cat} className="flex justify-between gap-3">
                  <span className="text-gray-400">{cat}</span>
                  <span>{count}</span>
                </div>
              ))}
              <div className="mt-0.5 border-t border-gray-700 pt-0.5 flex justify-between gap-3">
                <span className="text-gray-400">EP</span>
                <span>{hoveredFleet.totalEP}</span>
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </>
  );
}
