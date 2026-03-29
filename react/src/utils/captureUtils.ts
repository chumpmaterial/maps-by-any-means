import type { RefObject } from 'react';
import type { System } from '../types';
import { hexToPixel, DEFAULT_HEX_SIZE } from './hexUtils';

export interface CaptureOptions {
  svgRef: RefObject<SVGSVGElement>;
  /** Pre-filtered systems (FOW/clip). Used for bounding box. */
  systems: System[];
  center: { x: number; y: number };
  centerLabel: string;
  width: number;
  height: number;
  /** When set, removes non-clip system elements and out-of-clip lanes from the clone. */
  clipSystemIds?: Set<string>;
}

/** Compute a transform string that fits `systems` inside `width×height`, centered on `center`. */
function computeTransform(
  systems: System[],
  center: { x: number; y: number },
  width: number,
  height: number,
): string {
  const padding = 60;
  if (systems.length === 0) {
    return `translate(${width / 2 - center.x}, ${height / 2 - center.y}) scale(1)`;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const sys of systems) {
    const { x, y } = hexToPixel(sys.position, DEFAULT_HEX_SIZE);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;
  const zoom = Math.min(width / contentW, height / contentH, 4);
  const offsetX = width / 2 - center.x * zoom;
  const offsetY = height / 2 - center.y * zoom;
  return `translate(${offsetX}, ${offsetY}) scale(${zoom})`;
}

/**
 * Walk all elements in `cloneG` that carry Tailwind fill-* or stroke-* classes
 * and inline their computed fill/stroke from the live DOM counterpart in `originalG`.
 * This resolves Tailwind utility classes (fill-gray-100, stroke-gray-300, dark: variants)
 * to actual color values so they survive SVG serialization without a stylesheet.
 */
function inlineFillStrokeStyles(cloneG: Element, originalG: Element): void {
  const hasFillOrStrokeClass = (el: Element) => {
    const cls = el.getAttribute('class') ?? '';
    return cls.split(/\s+/).some(c => c.startsWith('fill-') || c.startsWith('stroke-') || c.startsWith('dark:fill-') || c.startsWith('dark:stroke-'));
  };

  const origEls = Array.from(originalG.querySelectorAll('[class]')).filter(hasFillOrStrokeClass);
  const cloneEls = Array.from(cloneG.querySelectorAll('[class]')).filter(hasFillOrStrokeClass);

  cloneEls.forEach((cloneEl, i) => {
    const origEl = origEls[i];
    if (!origEl) return;
    const computed = window.getComputedStyle(origEl);
    const fill = computed.getPropertyValue('fill');
    const stroke = computed.getPropertyValue('stroke');
    if (fill) cloneEl.setAttribute('fill', fill);
    if (stroke) cloneEl.setAttribute('stroke', stroke);
    // Strip fill-*/stroke-*/dark: classes since they're now inlined as attributes
    const remaining = (cloneEl.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter(c => c && !c.startsWith('fill-') && !c.startsWith('stroke-') && !c.startsWith('dark:fill-') && !c.startsWith('dark:stroke-'))
      .join(' ');
    if (remaining) cloneEl.setAttribute('class', remaining);
    else cloneEl.removeAttribute('class');
  });
}

/**
 * Add vector-effect="non-scaling-stroke" to all polygons inside .hex-grid.
 * This prevents sub-pixel thin horizontal edges when the fit-zoom scale is < 1.
 */
function fixHexGridStrokes(cloneG: Element): void {
  cloneG.querySelectorAll('.hex-grid polygon').forEach(el => {
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('stroke-width', '1');
  });
}

/** Walk up from `el` to find the first ancestor with a non-transparent background color. */
function readBackgroundColor(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    const bg = window.getComputedStyle(cur).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    cur = cur.parentElement;
  }
  return '#e5e7eb';
}

/** Remove cursor-* and pointer-events classes — meaningless in a static image. */
function stripInteractivityClasses(cloneG: Element): void {
  cloneG.querySelectorAll('[class]').forEach(el => {
    const classes = el.getAttribute('class') ?? '';
    const filtered = classes
      .split(/\s+/)
      .filter(c => c && !c.startsWith('cursor-') && c !== 'pointer-events-none')
      .join(' ');
    if (filtered) el.setAttribute('class', filtered);
    else el.removeAttribute('class');
  });
}

/**
 * Remove system elements not in `clipSystemIds` and lane elements where
 * either endpoint is outside the set.
 */
function removeNonClipElements(cloneG: Element, clipSystemIds: Set<string>): void {
  cloneG.querySelectorAll('[data-system-id]').forEach(el => {
    if (!clipSystemIds.has(el.getAttribute('data-system-id') ?? '')) el.remove();
  });
  cloneG.querySelectorAll('[data-lane-endpoints]').forEach(el => {
    const parts = (el.getAttribute('data-lane-endpoints') ?? '').split(',');
    if (parts.length !== 2 || !clipSystemIds.has(parts[0]) || !clipSystemIds.has(parts[1])) {
      el.remove();
    }
  });
}

/**
 * Capture the current map as a PNG and write it to the system clipboard.
 * Returns `centerLabel` on success. Throws on clipboard permission failure.
 */
export async function captureMapToClipboard(options: CaptureOptions): Promise<string> {
  const { svgRef, systems, center, centerLabel, width, height, clipSystemIds } = options;

  if (!svgRef.current) throw new Error('SVG element not available');
  const liveSvg = svgRef.current;

  // The main transform group is the first <g> child of the <svg>
  const mainG = liveSvg.querySelector(':scope > g');
  if (!mainG) throw new Error('Main SVG group not found');

  // Deep-clone before any DOM queries so we don't mutate the live tree
  const cloneG = mainG.cloneNode(true) as Element;

  // inlineFillStrokeStyles must be called before removeNonClipElements:
  // it pairs clone elements to live elements by index, so the counts must still match.
  inlineFillStrokeStyles(cloneG, mainG);
  fixHexGridStrokes(cloneG);
  stripInteractivityClasses(cloneG);

  if (clipSystemIds) removeNonClipElements(cloneG, clipSystemIds);

  // Apply fit-zoom transform centered on `center`
  cloneG.setAttribute('transform', computeTransform(systems, center, width, height));

  // Build wrapper SVG
  const ns = 'http://www.w3.org/2000/svg';
  const captureSvg = document.createElementNS(ns, 'svg');
  captureSvg.setAttribute('xmlns', ns);
  captureSvg.setAttribute('width', String(width));
  captureSvg.setAttribute('height', String(height));

  // Background rect: walk up from the SVG element to find an actual background color
  const bgColor = readBackgroundColor(liveSvg);
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', bgColor);
  captureSvg.appendChild(bg);
  captureSvg.appendChild(cloneG);

  // Serialize SVG → Blob URL → Image → Canvas → PNG → Clipboard
  const svgStr = new XMLSerializer().serializeToString(captureSvg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D context unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(async pngBlob => {
        if (!pngBlob) { reject(new Error('Canvas toBlob failed')); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          resolve(centerLabel);
        } catch (err) {
          reject(err);
        }
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG image load failed')); };
    img.src = url;
  });
}
