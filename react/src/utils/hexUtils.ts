import type { HexCoordinate } from '../types';

/**
 * Hex grid utilities for FLAT-TOP hexagons using axial coordinates
 *
 * Axial coordinate system (q, r):
 * - q increases to the right
 * - r increases down-right
 * - The implicit s coordinate = -q - r (cube coordinates)
 */

// Default hex size (distance from center to corner)
export const DEFAULT_HEX_SIZE = 50;

/**
 * Convert axial coordinates to pixel position (center of hex)
 * Using FLAT-TOP orientation
 */
export function hexToPixel(hex: HexCoordinate, size: number = DEFAULT_HEX_SIZE): { x: number; y: number } {
  // Flat-top hex layout
  const x = size * (3 / 2) * hex.q;
  const y = size * (Math.sqrt(3) / 2 * hex.q + Math.sqrt(3) * hex.r);
  return { x, y };
}

/**
 * Convert pixel position to axial coordinates (rounded to nearest hex)
 * Using FLAT-TOP orientation
 */
export function pixelToHex(x: number, y: number, size: number = DEFAULT_HEX_SIZE): HexCoordinate {
  // Flat-top hex layout
  const q = (2 / 3) * x / size;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / size;
  return hexRound(q, r);
}

/**
 * Round fractional axial coordinates to nearest hex
 */
export function hexRound(q: number, r: number): HexCoordinate {
  const s = -q - r;

  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
}

/**
 * Get the 6 neighboring hex coordinates
 */
export function getNeighbors(hex: HexCoordinate): HexCoordinate[] {
  const directions = [
    { q: 1, r: 0 },   // East
    { q: 1, r: -1 },  // Northeast
    { q: 0, r: -1 },  // Northwest
    { q: -1, r: 0 },  // West
    { q: -1, r: 1 },  // Southwest
    { q: 0, r: 1 },   // Southeast
  ];

  return directions.map(d => ({
    q: hex.q + d.q,
    r: hex.r + d.r,
  }));
}

/**
 * Calculate distance between two hexes (in hex steps)
 */
export function hexDistance(a: HexCoordinate, b: HexCoordinate): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * Check if two hex coordinates are equal
 */
export function hexEquals(a: HexCoordinate, b: HexCoordinate): boolean {
  return a.q === b.q && a.r === b.r;
}

/**
 * Create a unique string key from hex coordinates
 */
export function hexKey(hex: HexCoordinate): string {
  return `${hex.q},${hex.r}`;
}

/**
 * Parse a hex key back to coordinates
 */
export function parseHexKey(key: string): HexCoordinate {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/**
 * Get corner points of a FLAT-TOP hexagon for SVG rendering
 */
export function getHexCorners(center: { x: number; y: number }, size: number = DEFAULT_HEX_SIZE): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i; // Flat-top: start at 0 degrees
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: center.x + size * Math.cos(angleRad),
      y: center.y + size * Math.sin(angleRad),
    });
  }
  return corners;
}

/**
 * Convert corner points to SVG polygon points string
 */
export function cornersToSvgPoints(corners: { x: number; y: number }[]): string {
  return corners.map(c => `${c.x},${c.y}`).join(' ');
}

/**
 * Generate all hex coordinates within a given radius from center (0,0)
 */
export function getHexesInRadius(radius: number): HexCoordinate[] {
  const hexes: HexCoordinate[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}

/**
 * Check if two hexes are adjacent (neighbors)
 */
export function areAdjacent(a: HexCoordinate, b: HexCoordinate): boolean {
  return hexDistance(a, b) === 1;
}
