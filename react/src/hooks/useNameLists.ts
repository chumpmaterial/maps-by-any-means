import { useState, useEffect, useMemo, useCallback } from 'react';
import type { NameListSettings, NameList } from '../types';
import { defaultNames } from '../data/defaultNames';

const STORAGE_KEY = 'nameListSettings';

function createDefaultList(): NameList {
  return {
    id: 'default',
    name: 'Default',
    enabled: true,
    names: defaultNames.map(name => ({ name, enabled: true })),
  };
}

function loadFromStorage(): NameListSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Fall through to default
  }
  return {
    allowDuplicates: false,
    lists: [createDefaultList()],
  };
}

export function useNameLists() {
  const [settings, setSettings] = useState<NameListSettings>(loadFromStorage);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const addNameList = useCallback((names: string[], filename: string) => {
    const newList: NameList = {
      id: Math.random().toString(36).substring(2, 11),
      name: filename,
      enabled: true,
      names: names.map(name => ({ name, enabled: true })),
    };
    setSettings(prev => ({
      ...prev,
      lists: [...prev.lists, newList],
    }));
  }, []);

  const removeNameList = useCallback((id: string) => {
    setSettings(prev => ({
      ...prev,
      lists: prev.lists.filter(l => l.id !== id),
    }));
  }, []);

  const toggleList = useCallback((id: string, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      lists: prev.lists.map(l => l.id === id ? { ...l, enabled } : l),
    }));
  }, []);

  const toggleName = useCallback((listId: string, nameIndex: number, enabled: boolean) => {
    setSettings(prev => ({
      ...prev,
      lists: prev.lists.map(l => {
        if (l.id !== listId) return l;
        return {
          ...l,
          names: l.names.map((entry, idx) =>
            idx === nameIndex ? { ...entry, enabled } : entry
          ),
        };
      }),
    }));
  }, []);

  const setAllowDuplicates = useCallback((allowDuplicates: boolean) => {
    setSettings(prev => ({ ...prev, allowDuplicates }));
  }, []);

  const activeNames = useMemo(() => {
    const names: string[] = [];
    for (const list of settings.lists) {
      if (!list.enabled) continue;
      for (const entry of list.names) {
        if (entry.enabled) names.push(entry.name);
      }
    }
    return settings.allowDuplicates ? names : Array.from(new Set(names));
  }, [settings]);

  const getRandomName = useCallback((excludeNames: string[]): string | null => {
    const pool = settings.allowDuplicates
      ? activeNames
      : activeNames.filter(n => !excludeNames.includes(n));
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [activeNames, settings.allowDuplicates]);

  return {
    settings,
    addNameList,
    removeNameList,
    toggleList,
    toggleName,
    setAllowDuplicates,
    activeNames,
    getRandomName,
  };
}
