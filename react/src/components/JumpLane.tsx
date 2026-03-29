import { useState } from 'react';
import type { JumpLane as JumpLaneType, System, LaneType } from '../types';
import { hexToPixel } from '../utils/hexUtils';

interface JumpLaneProps {
  lane: JumpLaneType;
  fromSystem: System;
  toSystem: System;
  isSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  isOnTradeRoute?: boolean;
}

// Visual styles for each lane type
const laneStyles: Record<LaneType, { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity?: number }> = {
  major: {
    stroke: '#1f2937', // gray-800
    strokeWidth: 4,
  },
  minor: {
    stroke: '#4b5563', // gray-600
    strokeWidth: 2,
  },
  restricted: {
    stroke: '#6b7280', // gray-500
    strokeWidth: 2,
    strokeDasharray: '8,4',
  },
  unexplored: {
    stroke: '#9ca3af', // gray-400
    strokeWidth: 2,
    opacity: 0.6,
  },
};

// Dark mode styles
const laneStylesDark: Record<LaneType, { stroke: string; strokeWidth: number; strokeDasharray?: string; opacity?: number }> = {
  major: {
    stroke: '#f3f4f6', // gray-100
    strokeWidth: 4,
  },
  minor: {
    stroke: '#d1d5db', // gray-300
    strokeWidth: 2,
  },
  restricted: {
    stroke: '#9ca3af', // gray-400
    strokeWidth: 2,
    strokeDasharray: '8,4',
  },
  unexplored: {
    stroke: '#6b7280', // gray-500
    strokeWidth: 2,
    opacity: 0.6,
  },
};

const TRADE_ROUTE_GOLD = '#f59e0b';

export function JumpLane({ lane, fromSystem, toSystem, isSelected, onClick, isOnTradeRoute }: JumpLaneProps) {
  const [isHovered, setIsHovered] = useState(false);
  const from = hexToPixel(fromSystem.position);
  const to = hexToPixel(toSystem.position);
  const laneType = lane.type || 'unexplored';
  const style = laneStyles[laneType];
  const darkStyle = laneStylesDark[laneType];

  return (
    <g
      className="cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Invisible hit area for easier clicking */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke="transparent"
        strokeWidth={12}
      />

      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#60a5fa"
          strokeWidth={style.strokeWidth + 3}
          strokeDasharray={style.strokeDasharray}
          opacity={0.4}
        />
      )}

      {/* Selection highlight */}
      {isSelected && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="#ef4444"
          strokeWidth={style.strokeWidth + 4}
          strokeDasharray={style.strokeDasharray}
        />
      )}

      {/* Light mode line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={isOnTradeRoute ? TRADE_ROUTE_GOLD : style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.strokeDasharray}
        opacity={isOnTradeRoute ? 1 : style.opacity}
        className="dark:hidden"
      />
      {/* Dark mode line */}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={isOnTradeRoute ? TRADE_ROUTE_GOLD : darkStyle.stroke}
        strokeWidth={darkStyle.strokeWidth}
        strokeDasharray={darkStyle.strokeDasharray}
        opacity={isOnTradeRoute ? 1 : darkStyle.opacity}
        className="hidden dark:block"
      />
    </g>
  );
}
