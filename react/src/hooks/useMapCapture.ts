import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import type { GameMap } from '../types';
import type { FowData } from '../components/MapViewport';
import { hexToPixel, DEFAULT_HEX_SIZE } from '../utils/hexUtils';
import { captureMapToClipboard } from '../utils/captureUtils';

const LS_WIDTH = 'mbam_capture_width';
const LS_HEIGHT = 'mbam_capture_height';
const DEFAULT_W = 1920;
const DEFAULT_H = 1080;
const TOAST_MS = 3000;

function loadDim(key: string, def: number): number {
  const raw = localStorage.getItem(key);
  const n = raw ? parseInt(raw, 10) : NaN;
  return isNaN(n) || n < 400 || n > 7680 ? def : n;
}

export function useMapCapture() {
  const [captureWidth, setCaptureWidthState] = useState(() => loadDim(LS_WIDTH, DEFAULT_W));
  const [captureHeight, setCaptureHeightState] = useState(() => loadDim(LS_HEIGHT, DEFAULT_H));

  const [clipModeActive, setClipModeActive] = useState(false);
  // Array preserves insertion order; Set (derived) gives O(1) lookup
  const [clipSystemOrder, setClipSystemOrder] = useState<string[]>([]);
  const [clipCenterSystemId, setClipCenterSystemIdState] = useState<string | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const clipSelectedSystemIds = useMemo(() => new Set(clipSystemOrder), [clipSystemOrder]);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(msg);
    toastTimer.current = setTimeout(() => setToastMessage(null), TOAST_MS);
  }, []);

  const setCaptureWidth = useCallback((w: number) => {
    const v = Math.max(400, Math.min(7680, w));
    setCaptureWidthState(v);
    localStorage.setItem(LS_WIDTH, String(v));
  }, []);

  const setCaptureHeight = useCallback((h: number) => {
    const v = Math.max(400, Math.min(7680, h));
    setCaptureHeightState(v);
    localStorage.setItem(LS_HEIGHT, String(v));
  }, []);

  const enterClipMode = useCallback(() => {
    setClipModeActive(true);
    setClipSystemOrder([]);
    setClipCenterSystemIdState(null);
  }, []);

  const exitClipMode = useCallback(() => {
    setClipModeActive(false);
    setClipSystemOrder([]);
    setClipCenterSystemIdState(null);
  }, []);

  const toggleClipSystem = useCallback((id: string) => {
    setClipSystemOrder(prev => {
      if (prev.includes(id)) {
        // Removing: clear center if it was this system
        setClipCenterSystemIdState(c => (c === id ? null : c));
        return prev.filter(s => s !== id);
      } else {
        // Adding: auto-assign as center if none set yet
        setClipCenterSystemIdState(c => (c === null ? id : c));
        return [...prev, id];
      }
    });
  }, []);

  const setClipCenter = useCallback((id: string) => {
    setClipCenterSystemIdState(id);
  }, []);

  const captureFullMap = useCallback(async (
    svgRef: RefObject<SVGSVGElement>,
    map: GameMap,
    selectedSystemId: string | null,
    fowData?: FowData | null,
  ) => {
    // Build visible system list (apply FOW filter if active)
    let systems = map.systems;
    if (fowData) {
      const visible = new Set<string>();
      for (const sys of map.systems) {
        if (fowData.intel[sys.id]) visible.add(sys.id);
        else if (!fowData.blindExploration && fowData.initialIntel[sys.id]) visible.add(sys.id);
      }
      systems = map.systems.filter(s => visible.has(s.id));
    }

    // Determine center
    const centerSys = selectedSystemId ? map.systems.find(s => s.id === selectedSystemId) : null;
    const center = centerSys
      ? hexToPixel(centerSys.position, DEFAULT_HEX_SIZE)
      : { x: 0, y: 0 };
    const centerLabel = centerSys?.name ?? 'hex (0, 0)';

    try {
      const label = await captureMapToClipboard({
        svgRef, systems, center, centerLabel,
        width: captureWidth, height: captureHeight,
      });
      showToast(`Copied — centered on ${label}`);
    } catch {
      showToast('Capture failed — clipboard permission denied');
    }
  }, [captureWidth, captureHeight, showToast]);

  const captureClipMap = useCallback(async (
    svgRef: RefObject<SVGSVGElement>,
    map: GameMap,
  ) => {
    if (clipSystemOrder.length === 0 || !clipCenterSystemId) return;
    const clipIds = new Set(clipSystemOrder);
    const systems = map.systems.filter(s => clipIds.has(s.id));
    const centerSys = map.systems.find(s => s.id === clipCenterSystemId);
    const center = centerSys
      ? hexToPixel(centerSys.position, DEFAULT_HEX_SIZE)
      : { x: 0, y: 0 };
    const centerLabel = centerSys?.name ?? 'hex (0, 0)';
    try {
      const label = await captureMapToClipboard({
        svgRef, systems, center, centerLabel,
        width: captureWidth, height: captureHeight,
        clipSystemIds: clipIds,
      });
      showToast(`Copied — centered on ${label}`);
    } catch {
      showToast('Capture failed — clipboard permission denied');
    }
  }, [clipSystemOrder, clipCenterSystemId, captureWidth, captureHeight, showToast]);

  return {
    captureWidth, captureHeight, setCaptureWidth, setCaptureHeight,
    clipModeActive, clipSelectedSystemIds, clipSystemOrder, clipCenterSystemId,
    enterClipMode, exitClipMode, toggleClipSystem, setClipCenter,
    captureFullMap, captureClipMap,
    toastMessage,
  };
}
