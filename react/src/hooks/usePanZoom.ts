import { useState, useCallback, useRef } from 'react';
import type { ViewportState } from '../types';

interface UsePanZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  zoomSensitivity?: number;
  containerWidth?: number;
  containerHeight?: number;
}

export function usePanZoom(options: UsePanZoomOptions = {}) {
  const {
    minZoom = 0.25,
    maxZoom = 4,
    zoomSensitivity = 0.001,
    containerWidth = 0,
    containerHeight = 0,
  } = options;

  const [viewport, setViewport] = useState<ViewportState>({
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
  });

  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { // Left click
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;

    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    setViewport((prev) => ({
      ...prev,
      offsetX: prev.offsetX + dx,
      offsetY: prev.offsetY + dy,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setViewport((prev) => {
      const zoomDelta = -e.deltaY * zoomSensitivity;
      const newZoom = Math.min(maxZoom, Math.max(minZoom, prev.zoom * (1 + zoomDelta)));
      const zoomRatio = newZoom / prev.zoom;

      // Zoom towards mouse position, accounting for the SVG center offset
      // Transform is: translate(offsetX + cx, offsetY + cy) scale(zoom)
      // World point under mouse: wx = (mouseX - offsetX - cx) / zoom
      // After zoom: mouseX = wx * newZoom + newOffsetX + cx  →  newOffsetX = mouseX - cx - wx * newZoom
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newOffsetX = mouseX - cx - (mouseX - cx - prev.offsetX) * zoomRatio;
      const newOffsetY = mouseY - cy - (mouseY - cy - prev.offsetY) * zoomRatio;

      return {
        offsetX: newOffsetX,
        offsetY: newOffsetY,
        zoom: newZoom,
      };
    });
  }, [minZoom, maxZoom, zoomSensitivity]);

  // Reset viewport
  const resetViewport = useCallback(() => {
    setViewport({ offsetX: 0, offsetY: 0, zoom: 1 });
  }, []);

  // Center on a specific world-space point (SVG coordinates)
  const centerOn = useCallback((x: number, y: number) => {
    setViewport((prev) => ({
      ...prev,
      offsetX: -x * prev.zoom,
      offsetY: -y * prev.zoom,
    }));
  }, []);

  // Zoom in by a fixed step
  const zoomIn = useCallback(() => {
    setViewport(prev => {
      const newZoom = Math.min(maxZoom, prev.zoom * 1.25);
      const ratio = newZoom / prev.zoom;
      // Zoom towards center of viewport
      const cx = containerWidth / 2;
      const cy = containerHeight / 2;
      return {
        offsetX: cx - (cx - prev.offsetX) * ratio,
        offsetY: cy - (cy - prev.offsetY) * ratio,
        zoom: newZoom,
      };
    });
  }, [maxZoom, containerWidth, containerHeight]);

  // Zoom out by a fixed step
  const zoomOut = useCallback(() => {
    setViewport(prev => {
      const newZoom = Math.max(minZoom, prev.zoom / 1.25);
      const ratio = newZoom / prev.zoom;
      const cx = containerWidth / 2;
      const cy = containerHeight / 2;
      return {
        offsetX: cx - (cx - prev.offsetX) * ratio,
        offsetY: cy - (cy - prev.offsetY) * ratio,
        zoom: newZoom,
      };
    });
  }, [minZoom, containerWidth, containerHeight]);

  // Zoom to fit given bounds within the viewport
  const zoomToFit = useCallback((bounds: { minX: number; maxX: number; minY: number; maxY: number }, padding = 60) => {
    const contentWidth = bounds.maxX - bounds.minX + padding * 2;
    const contentHeight = bounds.maxY - bounds.minY + padding * 2;
    if (contentWidth === 0 || contentHeight === 0) return;

    const scaleX = containerWidth / contentWidth;
    const scaleY = containerHeight / contentHeight;
    const zoom = Math.min(scaleX, scaleY, maxZoom);

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    setViewport({
      offsetX: -centerX * zoom,
      offsetY: -centerY * zoom,
      zoom,
    });
  }, [containerWidth, containerHeight, maxZoom]);

  // Convert screen coordinates to world coordinates
  // Accounts for the center offset applied in the SVG transform
  const screenToWorld = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    return {
      x: (screenX - viewport.offsetX - centerX) / viewport.zoom,
      y: (screenY - viewport.offsetY - centerY) / viewport.zoom,
    };
  }, [viewport, containerWidth, containerHeight]);

  // Convert world coordinates to screen coordinates
  const worldToScreen = useCallback((worldX: number, worldY: number): { x: number; y: number } => {
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    return {
      x: worldX * viewport.zoom + viewport.offsetX + centerX,
      y: worldY * viewport.zoom + viewport.offsetY + centerY,
    };
  }, [viewport, containerWidth, containerHeight]);

  return {
    viewport,
    setViewport,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    resetViewport,
    centerOn,
    zoomIn,
    zoomOut,
    zoomToFit,
    screenToWorld,
    worldToScreen,
    isDragging: isDragging.current,
  };
}
