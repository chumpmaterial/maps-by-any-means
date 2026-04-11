import type {
  CampaignSnapshot, CampaignPlayer, GameMap, CMFleet,
  PhaseDiff, UnitDiff, EPSPDiff, OwnershipDiff, DiplomacyDiff,
  SystemStatusDiff, SystemStatsDiff, FleetDiff, TradeRouteDiff, TechDiff,
  SystemCampaignStatus, SystemAttributes,
} from '../types';

/** Compute all diffs between two snapshots */
export function computePhaseDiff(
  before: CampaignSnapshot,
  after: CampaignSnapshot,
  map: GameMap,
): PhaseDiff {
  const sysName = (id: string) => map.systems.find(s => s.id === id)?.name ?? id;

  return {
    epSp: diffEPSP(before.players, after.players),
    units: diffUnits(before.players, after.players, sysName),
    ownership: diffOwnership(before.systemOwnership, after.systemOwnership, sysName, before.players, after.players),
    diplomacy: diffDiplomacy(before.diplomacyRelations, after.diplomacyRelations, after.players, map),
    systemStatuses: diffSystemStatuses(before.systemStatuses, after.systemStatuses, sysName),
    systemStats: diffSystemStats(before, after, sysName),
    fleets: diffFleets(before.players, after.players, before.cmFleets, after.cmFleets, sysName),
    tradeRoutes: diffTradeRoutes(before.players, after.players, sysName),
    tech: diffTech(before.players, after.players),
  };
}

function diffEPSP(before: CampaignPlayer[], after: CampaignPlayer[]): EPSPDiff[] {
  const diffs: EPSPDiff[] = [];
  for (const bp of before) {
    const ap = after.find(p => p.id === bp.id);
    if (!ap) continue;
    if (bp.ep !== ap.ep || bp.sp !== ap.sp) {
      diffs.push({
        playerId: bp.id,
        playerName: bp.name,
        epBefore: bp.ep,
        epAfter: ap.ep,
        spBefore: bp.sp,
        spAfter: ap.sp,
      });
    }
  }
  return diffs;
}

function diffUnits(
  before: CampaignPlayer[],
  after: CampaignPlayer[],
  sysName: (id: string) => string,
): UnitDiff[] {
  const diffs: UnitDiff[] = [];

  const getFleetName = (player: CampaignPlayer | undefined, fleetId: string | undefined): string => {
    if (!fleetId) return 'Untasked';
    // Named fleets have UUID IDs; system fleets use their display name as the ID
    return player?.fleets?.find(f => f.id === fleetId)?.name ?? fleetId;
  };

  const getClassName = (player: CampaignPlayer, templateId: string): string =>
    player.empire.units.find(u => u.id === templateId)?.name
    ?? player.stolenUnits?.find(s => s.unit.id === templateId)?.unit.name
    ?? [...before, ...after].flatMap(p => p.empire.units).find(u => u.id === templateId)?.name
    ?? templateId;

  // Which named fleet IDs had their systemId change this phase?
  // Used to suppress per-unit 'moved' noise when the fleet itself moved.
  const movedFleetIds = new Set<string>();
  for (const bp of before) {
    const ap = after.find(p => p.id === bp.id);
    if (!ap) continue;
    for (const bf of (bp.fleets ?? [])) {
      const af = (ap.fleets ?? []).find(f => f.id === bf.id);
      if (af && bf.systemId !== af.systemId) movedFleetIds.add(af.id);
    }
  }

  for (const bp of before) {
    const ap = after.find(p => p.id === bp.id);
    if (!ap) continue;
    const beforeIds = new Set(bp.units.map(u => u.id));
    const afterIds = new Set(ap.units.map(u => u.id));

    // Added units
    for (const u of ap.units) {
      if (!beforeIds.has(u.id)) {
        diffs.push({
          type: 'added',
          playerId: ap.id,
          playerName: ap.name,
          unitName: u.name,
          templateName: u.unitTemplateId,
          unitClassName: getClassName(ap, u.unitTemplateId),
          systemId: u.systemId,
          systemName: u.systemId ? sysName(u.systemId) : undefined,
        });
      }
    }

    // Removed units
    for (const u of bp.units) {
      if (!afterIds.has(u.id)) {
        diffs.push({
          type: 'removed',
          playerId: bp.id,
          playerName: bp.name,
          unitName: u.name,
          templateName: u.unitTemplateId,
          unitClassName: getClassName(bp, u.unitTemplateId),
          systemId: u.systemId,
          systemName: u.systemId ? sysName(u.systemId) : undefined,
        });
      }
    }

    // Changed units
    for (const bu of bp.units) {
      const au = ap.units.find(u => u.id === bu.id);
      if (!au) continue;
      const statusChanges: string[] = [];
      if (bu.crippled !== au.crippled) statusChanges.push(au.crippled ? 'crippled' : 'repaired');
      if (bu.outOfSupply !== au.outOfSupply) statusChanges.push(au.outOfSupply ? 'out of supply' : 'resupplied');
      if (bu.captured !== au.captured) statusChanges.push(au.captured ? 'captured' : 'recaptured');
      if (bu.exhausted !== au.exhausted) statusChanges.push(au.exhausted ? 'exhausted' : 'refreshed');
      if (bu.mothballed !== au.mothballed) statusChanges.push(au.mothballed ? 'mothballed' : 'reactivated');
      if (bu.systemId !== au.systemId) {
        // Suppress 'moved' when the unit's fleet is a named fleet that moved —
        // the Fleets diff section already records this movement.
        const coveredByFleetMove = !!au.fleetId && movedFleetIds.has(au.fleetId);
        if (!coveredByFleetMove) statusChanges.push('moved');
      }

      const fleetChanged = bu.fleetId !== au.fleetId;
      const isReassignmentOnly = fleetChanged && statusChanges.length === 0;
      if (fleetChanged) statusChanges.push('reassigned');

      if (statusChanges.length > 0) {
        diffs.push({
          type: 'changed',
          playerId: ap.id,
          playerName: ap.name,
          unitName: au.name,
          templateName: au.unitTemplateId,
          unitClassName: getClassName(ap, au.unitTemplateId),
          systemId: au.systemId,
          systemName: au.systemId ? sysName(au.systemId) : undefined,
          fromFleetName: fleetChanged ? getFleetName(bp, bu.fleetId) : undefined,
          toFleetName: fleetChanged ? getFleetName(ap, au.fleetId) : undefined,
          isReassignmentOnly,
          details: isReassignmentOnly ? undefined : statusChanges.join(', '),
        });
      }
    }
  }
  return diffs;
}

function diffOwnership(
  before: Record<string, string>,
  after: Record<string, string>,
  sysName: (id: string) => string,
  beforePlayers: CampaignPlayer[],
  afterPlayers: CampaignPlayer[],
): OwnershipDiff[] {
  const diffs: OwnershipDiff[] = [];
  const allSysIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const pName = (id: string) => [...beforePlayers, ...afterPlayers].find(p => p.id === id)?.name ?? id;
  for (const sysId of allSysIds) {
    if (before[sysId] !== after[sysId]) {
      diffs.push({
        systemId: sysId,
        systemName: sysName(sysId),
        previousOwner: before[sysId] ? pName(before[sysId]) : undefined,
        newOwner: after[sysId] ? pName(after[sysId]) : undefined,
      });
    }
  }
  return diffs;
}

// diplomacyKey sorts two IDs and joins with ':'. Independent IDs ("independent:sysId")
// contain an extra colon, so a naive split(':') produces 3 segments. This helper
// reconstructs the original pair by finding the "independent" segment.
function splitDiplomacyKey(key: string): [string, string] {
  const parts = key.split(':');
  if (parts.length === 2) return [parts[0], parts[1]];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === 'independent') {
      const indId = `independent:${parts[i + 1]}`;
      const otherId = [...parts.slice(0, i), ...parts.slice(i + 2)].join(':');
      return [otherId, indId];
    }
  }
  const idx = key.indexOf(':');
  return [key.slice(0, idx), key.slice(idx + 1)];
}

function diffDiplomacy(
  before: Record<string, string>,
  after: Record<string, string>,
  players: CampaignPlayer[],
  map: GameMap,
): DiplomacyDiff[] {
  const diffs: DiplomacyDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const resolveName = (id: string): string => {
    if (id.startsWith('independent:')) {
      const sysId = id.slice('independent:'.length);
      return map.systems.find(s => s.id === sysId)?.name ?? 'Independent System';
    }
    return players.find(p => p.id === id)?.name ?? id;
  };
  for (const key of allKeys) {
    const bv = before[key] ?? 'Unmet';
    const av = after[key] ?? 'Unmet';
    if (bv !== av) {
      const [id1, id2] = splitDiplomacyKey(key);
      diffs.push({
        player1Name: resolveName(id1),
        player2Name: resolveName(id2),
        previousLevel: bv as DiplomacyDiff['previousLevel'],
        newLevel: av as DiplomacyDiff['newLevel'],
      });
    }
  }
  return diffs;
}

function diffSystemStatuses(
  before: Record<string, SystemCampaignStatus>,
  after: Record<string, SystemCampaignStatus>,
  sysName: (id: string) => string,
): SystemStatusDiff[] {
  const diffs: SystemStatusDiff[] = [];
  const allSysIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  const fields: (keyof SystemCampaignStatus)[] = [
    'blockadedBy', 'inOpposition', 'economicDisruption', 'rebellion',
    'hasEnemyFleet', 'industrialSabotage', 'guaranteedPirateRaid', 'beachhead',
  ];
  for (const sysId of allSysIds) {
    const bs = before[sysId] ?? {};
    const as2 = after[sysId] ?? {};
    for (const field of fields) {
      const bv = JSON.stringify(bs[field] ?? null);
      const av = JSON.stringify(as2[field] ?? null);
      if (bv !== av) {
        diffs.push({
          systemId: sysId,
          systemName: sysName(sysId),
          field,
          previousValue: bs[field],
          newValue: as2[field],
        });
      }
    }
  }
  return diffs;
}

function diffFleets(
  beforePlayers: CampaignPlayer[],
  afterPlayers: CampaignPlayer[],
  beforeCM: CMFleet[],
  afterCM: CMFleet[],
  sysName: (id: string) => string,
): FleetDiff[] {
  const diffs: FleetDiff[] = [];

  // Player fleets
  for (const bp of beforePlayers) {
    const ap = afterPlayers.find(p => p.id === bp.id);
    if (!ap) continue;
    const bFleets = bp.fleets ?? [];
    const aFleets = ap.fleets ?? [];
    const bIds = new Set(bFleets.map(f => f.id));
    const aIds = new Set(aFleets.map(f => f.id));

    for (const f of aFleets) {
      if (!bIds.has(f.id)) {
        diffs.push({ type: 'added', ownerName: ap.name, fleetName: f.name, systemName: f.systemId ? sysName(f.systemId) : undefined });
      }
    }
    for (const f of bFleets) {
      if (!aIds.has(f.id)) {
        diffs.push({ type: 'removed', ownerName: bp.name, fleetName: f.name, systemName: f.systemId ? sysName(f.systemId) : undefined });
      }
    }
    for (const bf of bFleets) {
      const af = aFleets.find(f => f.id === bf.id);
      if (!af) continue;
      if (bf.systemId !== af.systemId) {
        diffs.push({ type: 'changed', ownerName: ap.name, fleetName: af.name, systemName: af.systemId ? sysName(af.systemId) : undefined, details: `moved to ${af.systemId ? sysName(af.systemId) : 'unknown'}` });
      }
    }
  }

  // CM fleets
  const bCMIds = new Set(beforeCM.map(f => f.id));
  const aCMIds = new Set(afterCM.map(f => f.id));
  for (const f of afterCM) {
    if (!bCMIds.has(f.id)) diffs.push({ type: 'added', ownerName: 'CM', fleetName: f.name, systemName: f.systemId ? sysName(f.systemId) : undefined });
  }
  for (const f of beforeCM) {
    if (!aCMIds.has(f.id)) diffs.push({ type: 'removed', ownerName: 'CM', fleetName: f.name });
  }
  for (const bf of beforeCM) {
    const af = afterCM.find(f => f.id === bf.id);
    if (!af) continue;
    if (bf.systemId !== af.systemId) {
      diffs.push({ type: 'changed', ownerName: 'CM', fleetName: af.name, systemName: af.systemId ? sysName(af.systemId) : undefined, details: `moved to ${af.systemId ? sysName(af.systemId) : 'unknown'}` });
    }
  }

  return diffs;
}

function diffTradeRoutes(
  beforePlayers: CampaignPlayer[],
  afterPlayers: CampaignPlayer[],
  sysName: (id: string) => string,
): TradeRouteDiff[] {
  const diffs: TradeRouteDiff[] = [];
  for (const bp of beforePlayers) {
    const ap = afterPlayers.find(p => p.id === bp.id);
    if (!ap) continue;
    const bRoutes = (bp.tradeRoutes ?? []).map(r => JSON.stringify(r.systemIds));
    const aRoutes = (ap.tradeRoutes ?? []).map(r => JSON.stringify(r.systemIds));
    const bSet = new Set(bRoutes);
    const aSet = new Set(aRoutes);
    for (const r of ap.tradeRoutes ?? []) {
      if (!bSet.has(JSON.stringify(r.systemIds))) {
        diffs.push({ type: 'added', playerName: ap.name, systemNames: r.systemIds.map(sysName) });
      }
    }
    for (const r of bp.tradeRoutes ?? []) {
      if (!aSet.has(JSON.stringify(r.systemIds))) {
        diffs.push({ type: 'removed', playerName: bp.name, systemNames: r.systemIds.map(sysName) });
      }
    }
  }
  return diffs;
}

function diffTech(before: CampaignPlayer[], after: CampaignPlayer[]): TechDiff[] {
  const diffs: TechDiff[] = [];
  for (const bp of before) {
    const ap = after.find(p => p.id === bp.id);
    if (!ap) continue;
    const bPool = bp.techPool ?? 0;
    const aPool = ap.techPool ?? 0;
    const newlyUnlocked = (ap.empire.units)
      .filter(u => u.researched === true)
      .filter(u => {
        const bUnit = (bp.empire.units).find(b => b.id === u.id);
        return !bUnit?.researched;
      })
      .map(u => u.name);
    if (bPool !== aPool || newlyUnlocked.length > 0) {
      diffs.push({
        playerId: ap.id,
        playerName: ap.name,
        techPoolBefore: bPool,
        techPoolAfter: aPool,
        unlockedUnits: newlyUnlocked.length > 0 ? newlyUnlocked : undefined,
      });
    }
  }
  return diffs;
}

const TRACKED_ATTRIBUTES: (keyof SystemAttributes)[] = [
  'population', 'morale', 'capacity', 'raw', 'intel', 'fortification',
];

function diffSystemStats(
  before: CampaignSnapshot,
  after: CampaignSnapshot,
  sysName: (id: string) => string,
): SystemStatsDiff[] {
  const diffs: SystemStatsDiff[] = [];
  for (const bSys of before.map.systems) {
    const aSys = after.map.systems.find(s => s.id === bSys.id);
    if (!aSys || !bSys.attributes || !aSys.attributes) continue;
    for (const attr of TRACKED_ATTRIBUTES) {
      const bv = bSys.attributes[attr];
      const av = aSys.attributes[attr];
      if (bv !== av) {
        diffs.push({ systemId: bSys.id, systemName: sysName(bSys.id), attribute: attr, before: bv, after: av });
      }
    }
  }
  return diffs;
}

/** Check if a PhaseDiff has any changes at all */
export function isDiffEmpty(diff: PhaseDiff): boolean {
  return diff.epSp.length === 0 && diff.units.length === 0 && diff.ownership.length === 0 &&
    diff.diplomacy.length === 0 && diff.systemStatuses.length === 0 && diff.systemStats.length === 0 &&
    diff.fleets.length === 0 && diff.tradeRoutes.length === 0 && diff.tech.length === 0;
}
