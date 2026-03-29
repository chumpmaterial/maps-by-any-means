import { useEffect } from 'react';
import type { useMapState } from './useMapState';

type ConfirmFn = (options: { title: string; message: string }) => Promise<boolean>;

interface KeyboardShortcutOptions {
  campaignMode?: boolean;
  mapEditingMode?: boolean;
}

export function useKeyboardShortcuts(
  mapState: ReturnType<typeof useMapState>,
  confirm: ConfirmFn,
  options: KeyboardShortcutOptions = {},
) {
  const { campaignMode = false, mapEditingMode = false } = options;
  const {
    selectedSystemId,
    selectedLaneId,
    setSelectedSystemId,
    setSelectedLaneId,
    getSystem,
    getLanesForSystem,
    removeSystem,
    removeJumpLane,
    undo,
    redo,
  } = mapState;

  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea/select
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT'
      ) {
        // Still allow Ctrl+Z/Y in inputs for native undo
        return;
      }

      // Delete/Backspace: Remove selected item (with confirmation)
      // In campaign mode without map editing: no system/lane deletion
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const restrictDelete = campaignMode && !mapEditingMode;

        if (selectedSystemId && !restrictDelete) {
          const system = getSystem(selectedSystemId);
          const name = system?.name || 'Unnamed';
          const laneCount = getLanesForSystem(selectedSystemId).length;
          const message = laneCount > 0
            ? `Delete "${name}" and its ${laneCount} connected lane(s)?`
            : `Delete "${name}"?`;
          const confirmed = await confirm({ title: 'Delete System', message });
          if (confirmed) {
            removeSystem(selectedSystemId);
          }
        } else if (selectedLaneId && !restrictDelete) {
          const confirmed = await confirm({ title: 'Delete Lane', message: 'Delete this jump lane?' });
          if (confirmed) {
            removeJumpLane(selectedLaneId);
          }
        }
      }

      // Ctrl+Z: Undo (disabled in campaign mode outside of map editing)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (campaignMode && !mapEditingMode) return;
        e.preventDefault();
        undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo (disabled in campaign mode outside of map editing)
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey))
      ) {
        if (campaignMode && !mapEditingMode) return;
        e.preventDefault();
        redo();
      }

      // Escape: Deselect
      if (e.key === 'Escape') {
        setSelectedSystemId(null);
        setSelectedLaneId(null);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    selectedSystemId,
    selectedLaneId,
    setSelectedSystemId,
    setSelectedLaneId,
    getSystem,
    getLanesForSystem,
    removeSystem,
    removeJumpLane,
    undo,
    redo,
    confirm,
    campaignMode,
    mapEditingMode,
  ]);
}
