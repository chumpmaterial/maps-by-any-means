import { useMemo } from 'react';
import {
  hexToPixel,
  getHexCorners,
  cornersToSvgPoints,
  getHexesInRadius,
  DEFAULT_HEX_SIZE,
} from '../utils/hexUtils';

interface HexGridProps {
  radius?: number;
  hexSize?: number;
}

export function HexGrid({ radius = 6, hexSize = DEFAULT_HEX_SIZE }: HexGridProps) {
  const hexes = useMemo(() => getHexesInRadius(radius), [radius]);

  return (
    <g className="hex-grid">
      {hexes.map((hex) => {
        const center = hexToPixel(hex, hexSize);
        const corners = getHexCorners(center, hexSize);
        const points = cornersToSvgPoints(corners);

        return (
          <polygon
            key={`${hex.q},${hex.r}`}
            points={points}
            className="fill-gray-100 stroke-gray-300 dark:fill-gray-800 dark:stroke-gray-600"
            strokeWidth={1}
          />
        );
      })}
    </g>
  );
}
