import { useState } from 'react';
import type { System, CampaignPlayer } from '../types';
import { hexToPixel, DEFAULT_HEX_SIZE } from '../utils/hexUtils';
import { generateStrokeColor } from '../utils/colorUtils';

interface SystemNodeProps {
  system: System;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onHover?: (system: System | null) => void;
  useTeamColors?: boolean;
  getOwnerTeamColor?: (ownerId: string) => string | undefined;
  isOnTradeRoute?: boolean;
  /** Campaign-mode ownership record. When provided, overrides map editor color logic. */
  systemOwnership?: Record<string, string>;
  /** Campaign players for color lookup by playerId. */
  campaignPlayers?: CampaignPlayer[];
  galaxyStateHighlight?: 'independent' | 'raider' | 'both' | null;
  independentColor?: string | null;
}

// Size multipliers for different system types (relative to hex size)
const sizeMultipliers: Record<System['type'], number> = {
  homeworld: 0.45,
  major: 0.38,
  minor: 0.30,
  unimportant: 0.22,
};

// Default colors matching the VBAM reference style
const typeColors: Record<System['type'], { fill: string; stroke: string; starFill?: string }> = {
  homeworld: { fill: '#f59e0b', stroke: '#d97706', starFill: '#78350f' },  // Orange with dark star
  major: { fill: '#3b82f6', stroke: '#1d4ed8' },      // Blue
  minor: { fill: '#22c55e', stroke: '#15803d' },      // Green
  unimportant: { fill: '#6b7280', stroke: '#4b5563' }, // Gray
};

export function SystemNode({
  system,
  isSelected,
  onClick,
  onHover,
  useTeamColors,
  getOwnerTeamColor,
  isOnTradeRoute,
  systemOwnership,
  campaignPlayers,
  galaxyStateHighlight,
  independentColor,
}: SystemNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { x, y } = hexToPixel(system.position);
  const radius = DEFAULT_HEX_SIZE * sizeMultipliers[system.type];
  const defaultColors = typeColors[system.type];

  // Determine fill color based on team colors setting
  let fillColor = defaultColors.fill;
  let strokeColor = defaultColors.stroke;

  if (independentColor) {
    fillColor = independentColor;
    strokeColor = generateStrokeColor(independentColor);
  } else if (systemOwnership && campaignPlayers) {
    // Campaign mode: color from systemOwnership → player.teamColor
    const ownerId = systemOwnership[system.id];
    const owner = campaignPlayers.find(p => p.id === ownerId);
    if (owner?.teamColor) {
      fillColor = owner.teamColor;
      strokeColor = generateStrokeColor(owner.teamColor);
    }
    // Unowned system keeps default type-based colors
  } else if (useTeamColors) {
    // Map editor mode: legacy system.teamColor / system.owner logic
    if (system.type === 'homeworld' && system.teamColor) {
      // Homeworld uses its own team color
      fillColor = system.teamColor;
      strokeColor = generateStrokeColor(system.teamColor);
    } else if (system.owner && getOwnerTeamColor) {
      // Non-homeworld with owner uses owner's team color
      const ownerColor = getOwnerTeamColor(system.owner);
      if (ownerColor) {
        fillColor = ownerColor;
        strokeColor = generateStrokeColor(ownerColor);
      }
    }
    // Non-homeworld without owner keeps default colors
  }

  // For homeworld star icon, use a darker version of the fill color
  const starFill = (() => {
    if (system.type !== 'homeworld') return undefined;
    if (systemOwnership && campaignPlayers) {
      const ownerId = systemOwnership[system.id];
      const owner = campaignPlayers.find(p => p.id === ownerId);
      return owner?.teamColor ? generateStrokeColor(owner.teamColor) : defaultColors.starFill;
    }
    return (useTeamColors && system.teamColor ? generateStrokeColor(system.teamColor) : defaultColors.starFill);
  })();

  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={() => { setIsHovered(true); onHover?.(system); }}
      onMouseLeave={() => { setIsHovered(false); onHover?.(null); }}
    >
      {/* Invisible hit-area to prevent flicker at ring gap */}
      <circle
        cx={x}
        cy={y}
        r={radius + 6}
        fill="transparent"
        stroke="none"
      />

      {/* Hover ring */}
      {isHovered && !isSelected && (
        <circle
          cx={x}
          cy={y}
          r={radius + 4}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
          opacity={0.5}
        />
      )}

      {/* Trade route ring */}
      {isOnTradeRoute && (
        <circle
          cx={x}
          cy={y}
          r={radius + 6}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={3}
        />
      )}

      {/* Selection ring */}
      {isSelected && (
        <circle
          cx={x}
          cy={y}
          r={radius + 6}
          fill="none"
          stroke="#ef4444"
          strokeWidth={3}
        />
      )}

      {/* Main circle */}
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={2}
      />

      {/* Galaxy State Setup highlight ring */}
      {galaxyStateHighlight && (
        <circle
          cx={x}
          cy={y}
          r={radius + 5}
          fill="none"
          strokeWidth={3}
          stroke={
            galaxyStateHighlight === 'independent' ? '#60a5fa' :
            galaxyStateHighlight === 'raider'      ? '#f87171' :
            '#a855f7'
          }
          opacity={0.85}
        />
      )}

      {/* Star icon for homeworlds */}
      {system.type === 'homeworld' && (
        <text
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={radius * 1.1}
          fill={starFill || strokeColor}
          className="pointer-events-none"
          style={{ fontFamily: 'sans-serif' }}
        >
          ★
        </text>
      )}

      {/* System name label with outline for readability */}
      <text
        x={x}
        y={y + radius + 14}
        textAnchor="middle"
        fontSize={11}
        fontWeight={system.type === 'homeworld' ? 'bold' : 'normal'}
        className="pointer-events-none fill-gray-700 stroke-white dark:fill-gray-300 dark:stroke-gray-900"
        strokeWidth={3}
        paintOrder="stroke fill"
      >
        {system.name}
      </text>
    </g>
  );
}
