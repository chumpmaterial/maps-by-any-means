import { useState, useCallback, useEffect } from 'react';
import type { GameMap, System, JumpLane, HexCoordinate, LaneType } from '../types';
import { hexKey } from '../utils/hexUtils';
import { generateRandomTeamColor } from '../utils/colorUtils';

// Generate a simple unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// Create an empty map
function createEmptyMap(): GameMap {
  return {
    id: generateId(),
    name: 'Untitled Map',
    systems: [],
    jumpLanes: [],
  };
}

const MAX_HISTORY = 50;

interface HistoryState {
  past: GameMap[];
  present: GameMap;
  future: GameMap[];
}

export function useMapState(initialMap?: GameMap) {
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialMap ?? createEmptyMap(),
    future: [],
  });
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);

  const map = history.present;

  // Push a map change onto the history stack
  const commitChange = useCallback((updater: (prev: GameMap) => GameMap) => {
    setHistory(h => ({
      past: [...h.past.slice(-(MAX_HISTORY - 1)), h.present],
      present: updater(h.present),
      future: [],
    }));
  }, []);

  // Replace the map entirely, resetting history (for load/new)
  const replaceMap = useCallback((newMap: GameMap) => {
    setHistory({ past: [], present: newMap, future: [] });
  }, []);

  // Undo
  const undo = useCallback(() => {
    setHistory(h => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: previous,
        future: [...h.future, h.present],
      };
    });
    // Clear selection if the selected item no longer exists after undo
    // (handled via effect-like check in the selection getters)
  }, []);

  // Redo
  const redo = useCallback(() => {
    setHistory(h => {
      if (h.future.length === 0) return h;
      const next = h.future[h.future.length - 1];
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(0, -1),
      };
    });
  }, []);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // Clear selection if the selected item was removed (e.g., by undo)
  useEffect(() => {
    if (selectedSystemId && !map.systems.some(s => s.id === selectedSystemId)) {
      setSelectedSystemId(null);
    }
    if (selectedLaneId && !map.jumpLanes.some(l => l.id === selectedLaneId)) {
      setSelectedLaneId(null);
    }
  }, [selectedSystemId, selectedLaneId, map.systems, map.jumpLanes]);

  // Get system by ID
  const getSystem = useCallback((id: string): System | undefined => {
    return map.systems.find(s => s.id === id);
  }, [map.systems]);

  // Get system at hex position
  const getSystemAtHex = useCallback((hex: HexCoordinate): System | undefined => {
    const key = hexKey(hex);
    return map.systems.find(s => hexKey(s.position) === key);
  }, [map.systems]);

  // Add a new system
  const addSystem = useCallback((system: Omit<System, 'id'>): System => {
    const newSystem: System = { ...system, id: generateId() };
    commitChange(prev => ({
      ...prev,
      systems: [...prev.systems, newSystem],
    }));
    return newSystem;
  }, [commitChange]);

  // Update an existing system
  const updateSystem = useCallback((id: string, updates: Partial<Omit<System, 'id'>>): void => {
    commitChange(prev => ({
      ...prev,
      systems: prev.systems.map(s => {
        if (s.id !== id) return s;
        const updated = { ...s, ...updates };
        // Auto-generate team color when becoming a homeworld
        if (updates.type === 'homeworld' && !updated.teamColor) {
          updated.teamColor = generateRandomTeamColor();
        }
        // Clear owner when becoming a homeworld (homeworlds can't have owners)
        if (updates.type === 'homeworld') {
          updated.owner = undefined;
        }
        return updated;
      }),
    }));
  }, [commitChange]);

  // Remove a system and its connected jump lanes
  const removeSystem = useCallback((id: string): void => {
    commitChange(prev => ({
      ...prev,
      systems: prev.systems.filter(s => s.id !== id),
      jumpLanes: prev.jumpLanes.filter(l => l.from !== id && l.to !== id),
    }));
    if (selectedSystemId === id) {
      setSelectedSystemId(null);
    }
  }, [commitChange, selectedSystemId]);

  // Add a jump lane between two systems
  const addJumpLane = useCallback((fromId: string, toId: string, type: LaneType = 'unexplored'): JumpLane | null => {
    // Check if lane already exists (in either direction)
    const exists = map.jumpLanes.some(
      l => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)
    );
    if (exists) return null;

    const newLane: JumpLane = { id: generateId(), from: fromId, to: toId, type };
    commitChange(prev => ({
      ...prev,
      jumpLanes: [...prev.jumpLanes, newLane],
    }));
    return newLane;
  }, [commitChange, map.jumpLanes]);

  // Remove a jump lane
  const removeJumpLane = useCallback((id: string): void => {
    commitChange(prev => ({
      ...prev,
      jumpLanes: prev.jumpLanes.filter(l => l.id !== id),
    }));
    if (selectedLaneId === id) {
      setSelectedLaneId(null);
    }
  }, [commitChange, selectedLaneId]);

  // Get all jump lanes connected to a system
  const getLanesForSystem = useCallback((systemId: string): JumpLane[] => {
    return map.jumpLanes.filter(l => l.from === systemId || l.to === systemId);
  }, [map.jumpLanes]);

  // Get jump lane by ID
  const getJumpLane = useCallback((id: string): JumpLane | undefined => {
    return map.jumpLanes.find(l => l.id === id);
  }, [map.jumpLanes]);

  // Update a jump lane
  const updateJumpLane = useCallback((id: string, updates: Partial<Omit<JumpLane, 'id'>>): void => {
    commitChange(prev => ({
      ...prev,
      jumpLanes: prev.jumpLanes.map(l => l.id === id ? { ...l, ...updates } : l),
    }));
  }, [commitChange]);

  // Set the entire map (for loading) — resets history
  const loadMap = useCallback((newMap: GameMap): void => {
    replaceMap(newMap);
    setSelectedSystemId(null);
    setSelectedLaneId(null);
  }, [replaceMap]);

  // Create a new empty map — resets history
  const newMap = useCallback((): void => {
    replaceMap(createEmptyMap());
    setSelectedSystemId(null);
    setSelectedLaneId(null);
  }, [replaceMap]);

  // Update map name
  const setMapName = useCallback((name: string): void => {
    commitChange(prev => ({ ...prev, name }));
  }, [commitChange]);

  // Set use team colors toggle
  const setUseTeamColors = useCallback((enabled: boolean): void => {
    commitChange(prev => ({ ...prev, useTeamColors: enabled }));
  }, [commitChange]);

  // Get all homeworld systems
  const getHomeworlds = useCallback((): System[] => {
    return map.systems.filter(s => s.type === 'homeworld');
  }, [map.systems]);

  return {
    map,
    selectedSystemId,
    setSelectedSystemId,
    selectedLaneId,
    setSelectedLaneId,
    getSystem,
    getSystemAtHex,
    addSystem,
    updateSystem,
    removeSystem,
    addJumpLane,
    removeJumpLane,
    getJumpLane,
    updateJumpLane,
    getLanesForSystem,
    loadMap,
    newMap,
    setMapName,
    setUseTeamColors,
    getHomeworlds,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
