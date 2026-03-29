import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type {
  CombatScenario,
  CombatScenarioPhase,
  CombatScenarioType,
  CombatForce,
  CombatUnitState,
  FighterAssignment,
  ReadinessLevel,
  CampaignPlayer,
  CampaignUnit,
  EmpireUnit,
  GameMap,
  DiplomacyLevel,
} from '../types';
import { READINESS_LABELS } from '../types';
import {
  computeEffectiveStats,
  computeFactorTotal,
  computeGroundATK,
  getSideUnits,
  getFlagshipEmpire,
  buildTemplateMap,
  initScenarioUnitStates,
  unitStatusKey,
} from '../utils/combatUtils';
import { FACTOR_TRAITS, HULL_CODES } from '../data/unitData';
import { diplomacyKey } from '../utils/supplyUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CombatScenarioViewProps {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  map: GameMap;
  diplomacyRelations: Record<string, DiplomacyLevel>;
  systemOwnership: Record<string, string>;
  onUpdate: (updated: CombatScenario) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHIP_HULL_CODES = new Set(HULL_CODES.Ships);
const BASE_HULL_CODES = new Set(HULL_CODES.Bases);

function isShip(template: EmpireUnit) { return SHIP_HULL_CODES.has(template.hullCode); }
function isFighter(template: EmpireUnit) { return template.category === 'Fighters'; }
function isBase(template: EmpireUnit) { return BASE_HULL_CODES.has(template.hullCode); }
function isCivilian(template: EmpireUnit) { return template.category === 'Civilian'; }


function getRelation(
  relations: Record<string, DiplomacyLevel>,
  id1: string,
  id2: string,
): DiplomacyLevel {
  return relations[diplomacyKey(id1, id2)] ?? 'Unmet';
}

function isAllied(level: DiplomacyLevel): boolean {
  return ['NonAggression', 'Trade', 'MutualDefense', 'Alliance'].includes(level);
}

function isAtWar(level: DiplomacyLevel): boolean {
  return level === 'War' || level === 'Hostilities';
}

const SCENARIO_TYPE_LABELS: Record<CombatScenarioType, string> = {
  interception: 'Interception',
  defensive: 'Defensive',
  pursuit: 'Pursuit',
  ground_combat: 'Ground Combat',
};

const PHASE_LABELS: Record<CombatScenarioPhase, string> = {
  setup: 'Setup',
  flagship: 'Flagship Selection',
  task_force: 'Task Force',
  assignments: 'Assignments',
  fire_ff: 'Fire: Fighter vs Fighter',
  fire_sf: 'Fire: Ship vs Fighter',
  fire_ss: 'Fire: Ship vs Ship',
  special_ops: 'Special Operations',
  retreat: 'Retreat',
  recovery: 'Recovery',
  ground_combat: 'Ground Combat',
  resolved: 'Resolved',
};

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  crippled:    { label: 'C',    cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  outOfSupply: { label: 'OOS',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  captured:    { label: 'CAP',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  exhausted:   { label: 'EX',   cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  mothballed:  { label: 'MOTH', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
};

function UnitStatusBadges({ unit }: { unit: CampaignUnit }) {
  const badges = Object.entries(STATUS_BADGES).filter(([k]) => !!(unit as unknown as Record<string, unknown>)[k]);
  if (badges.length === 0) return null;
  return (
    <span className="ml-1 inline-flex gap-0.5">
      {badges.map(([k, { label, cls }]) => (
        <span key={k} className={`rounded px-1 py-0 text-[9px] font-semibold ${cls}`}>{label}</span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatTooltip — hover tooltip with 400 ms delay showing original base stat
// ---------------------------------------------------------------------------

function StatTooltip({ children, baseValue, cls }: { children: React.ReactNode; baseValue: number | string; cls?: string }) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPos({ x: rect.left + rect.width / 2, y: rect.top });
    timerRef.current = setTimeout(() => setVisible(true), 400);
  };
  const handleMouseLeave = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setVisible(false);
  };

  return (
    <>
      <span onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className={`cursor-default${cls ? ` ${cls}` : ''}`}>
        {children}
      </span>
      {visible && createPortal(
        <div
          className="fixed z-50 pointer-events-none rounded bg-gray-800 px-2 py-1 text-[10px] text-white shadow-lg dark:bg-gray-700"
          style={{ left: pos.x, top: pos.y - 28, transform: 'translateX(-50%)' }}
        >
          Base: {baseValue}
        </div>,
        document.body,
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// StatCell — renders a DV/AS/AF value with modification styling
// ---------------------------------------------------------------------------

function StatCell({
  effective,
  base,
  isBlockedByTrait = false,
  cls = 'text-right tabular-nums text-gray-500 dark:text-gray-400',
}: {
  effective: number;
  base: number | '-';
  isBlockedByTrait?: boolean;
  cls?: string;
}) {
  if (base === '-') return <span className={cls}>—</span>;
  if (effective !== base) {
    return (
      <StatTooltip baseValue={base} cls={cls}>
        <span className="font-bold italic">{effective}</span>
      </StatTooltip>
    );
  }
  if (isBlockedByTrait) {
    return <span className={`${cls} font-bold`}>{effective}</span>;
  }
  return <span className={cls}>{effective}</span>;
}

// Force lineup for one side — shows all units + totals + factor totals
function ForceLineup({
  label,
  scenario,
  side,
  players,
}: {
  label: string;
  scenario: CombatScenario;
  side: 'attacker' | 'defender';
  players: CampaignPlayer[];
}) {
  // unitStates is empty during setup phase (initialized only when Begin Scenario is clicked).
  // In that case build a preview directly from player units at the system.
  type DisplayUnit = { unit: CampaignUnit; template: EmpireUnit; state?: CombatUnitState; player: CampaignPlayer };
  let displayUnits: DisplayUnit[];
  if (Object.keys(scenario.unitStates).length === 0) {
    const force = side === 'attacker' ? scenario.attackerForce : scenario.defenderForce;
    const sidePlayerIds = new Set([force.primaryPlayerId, ...force.alliedPlayerIds].filter(Boolean));
    displayUnits = [];
    for (const player of players) {
      if (!sidePlayerIds.has(player.id)) continue;
      const templateMap = new Map(player.empire.units.map(u => [u.id, u]));
      for (const unit of player.units) {
        if (unit.systemId !== scenario.systemId || unit.mothballed) continue;
        const template = templateMap.get(unit.unitTemplateId);
        if (!template) continue;
        const isGroundCombat = scenario.scenarioType === 'ground_combat';
        if (isGroundCombat ? template.category !== 'Troops' : template.category === 'Troops') continue;
        displayUnits.push({ unit, template, player });
      }
    }
  } else {
    displayUnits = getSideUnits(scenario, side, players);
  }

  const flagEmpire = getFlagshipEmpire(scenario, side, players);
  const tmap = buildTemplateMap(players);

  let totalDV = 0, totalAS = 0, totalAF = 0;
  const factorMap: Record<string, number> = {};

  for (const { unit, template, state } of displayUnits) {
    if (state?.destroyed || state?.exitedScenario) continue;
    const eff = computeEffectiveStats(unit, template, state, flagEmpire);
    totalDV += eff.dv;
    if (template.as !== '-') totalAS += eff.as;
    if (template.af !== '-') totalAF += eff.af;
  }

  for (const traitName of FACTOR_TRAITS) {
    const units = displayUnits.map(x => x.unit);
    const total = computeFactorTotal(units, tmap, traitName);
    if (total > 0) factorMap[traitName] = total;
  }

  if (displayUnits.length === 0) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</p>
        <p className="mt-1 text-xs italic text-gray-400">No units</p>
      </div>
    );
  }

  // Scenario-level stat modifiers that need to split groups
  const scenarioSK = (state: CombatUnitState | undefined): string => {
    if (!state) return '';
    const parts: string[] = [];
    if (state.isFlagship) parts.push('FS');
    if (state.crippledInScenario) parts.push('SC');
    if (state.formationBonus) parts.push('FB');
    if (state.disrupted) parts.push('DIS');
    if (state.jammed) parts.push('JAM');
    return parts.join(',');
  };

  // Group displayUnits by class + status for condensed display
  type ForceGroup = { template: EmpireUnit; statusKey: string; scenarioKey: string; count: number; sampleUnit: CampaignUnit; sampleState?: CombatUnitState };
  const forceGroupMap = new Map<string, ForceGroup>();
  for (const { unit, template, state } of displayUnits) {
    const sk = unitStatusKey(unit);
    const ssk = scenarioSK(state);
    const key = `${template.id}|${sk}|${ssk}`;
    if (!forceGroupMap.has(key)) forceGroupMap.set(key, { template, statusKey: sk, scenarioKey: ssk, count: 0, sampleUnit: unit, sampleState: state });
    forceGroupMap.get(key)!.count++;
  }
  const crOf = (t: EmpireUnit) => t.cr === '-' ? -1 : Number(t.cr);
  const forceGroups = [...forceGroupMap.values()].sort((a, b) => {
    // Flagship row always first
    const aFS = a.scenarioKey.includes('FS'), bFS = b.scenarioKey.includes('FS');
    if (aFS !== bFS) return aFS ? -1 : 1;
    // Ships before fighters
    const aF = isFighter(a.template), bF = isFighter(b.template);
    if (aF !== bF) return aF ? 1 : -1;
    // CR descending
    const crDiff = crOf(b.template) - crOf(a.template);
    if (crDiff !== 0) return crDiff;
    // Name, then status tiebreakers
    const nameDiff = a.template.name.localeCompare(b.template.name);
    if (nameDiff !== 0) return nameDiff;
    const skDiff = a.statusKey.localeCompare(b.statusKey);
    return skDiff !== 0 ? skDiff : a.scenarioKey.localeCompare(b.scenarioKey);
  });

  // Grid columns: name (flex) | ×count | DV | AS | AF | CR | traits
  const fcols = '1fr 1.75rem 3rem 3rem 3rem 2.5rem 1fr';

  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-gray-400">{label}</p>
      <div
        className="mb-0.5 grid gap-x-1 border-b border-gray-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500"
        style={{ gridTemplateColumns: fcols }}
      >
        <span>Unit</span>
        <span className="text-right">×</span>
        <span className="text-right">DV</span>
        <span className="text-right">{scenario.scenarioType === 'ground_combat' ? 'ATK' : 'AS'}</span>
        <span className="text-right">AF</span>
        <span className="text-right">CR</span>
        <span className="pl-2">Traits</span>
      </div>
      {forceGroups.map(({ template, statusKey: sk, scenarioKey: ssk, count, sampleUnit, sampleState }) => {
        const eff = computeEffectiveStats(sampleUnit, template, sampleState, flagEmpire);
        const isCrippled = sampleUnit.crippled || !!sampleState?.crippledInScenario;
        const isOOS = sampleUnit.outOfSupply;
        const hasArmored   = template.traits.some(t => t.name === 'Armored');
        const hasGunship   = template.traits.some(t => t.name === 'Gunship');
        const hasCarronade = template.traits.some(t => t.name === 'Carronade');
        const dvBlockedByTrait = isCrippled && hasArmored && !isOOS;
        const asBlockedByTrait = isCrippled && hasGunship;
        const afBlockedByTrait = isCrippled && hasCarronade;
        const statCls = 'text-right tabular-nums text-gray-600 dark:text-gray-300';
        return (
          <div
            key={`${template.id}|${sk}|${ssk}`}
            className="grid items-center gap-x-1 py-0.5 text-xs"
            style={{ gridTemplateColumns: fcols }}
          >
            <span className="truncate text-gray-800 dark:text-gray-100">
              {template.name}
              {template.hullCode !== 'N/A' && (
                <span className="ml-1 text-gray-400">({template.hullCode})</span>
              )}
              <UnitStatusBadges unit={sampleUnit} />
              {sampleState?.crippledInScenario && !sampleUnit.crippled && (
                <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
              )}
              {sampleState?.capturedBySide && !sampleUnit.captured && (
                <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">CAP</span>
              )}
              {sampleState?.isFlagship && <span className="ml-1 text-yellow-500" title="Flagship">★</span>}
              {sampleState?.formationBonus && (
                <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">FB</span>
              )}
              {sampleState?.disrupted && (
                <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">DIS</span>
              )}
              {sampleState?.jammed && (
                <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">JAM</span>
              )}
            </span>
            <span className="text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
            <StatCell effective={eff.dv} base={template.dv} isBlockedByTrait={dvBlockedByTrait} cls={statCls} />
            <StatCell effective={eff.as} base={template.as} isBlockedByTrait={asBlockedByTrait} cls={statCls} />
            <StatCell effective={eff.af} base={template.af} isBlockedByTrait={afBlockedByTrait} cls={statCls} />
            <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
            <span className="pl-2 text-gray-400 dark:text-gray-500">
              {template.traits.map((tr, i) => (
                <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>
              ))}
            </span>
          </div>
        );
      })}
      <div
        className="mt-1 grid gap-x-1 border-t border-gray-300 pt-1 text-xs font-bold dark:border-gray-600"
        style={{ gridTemplateColumns: fcols }}
      >
        <span className="text-gray-700 dark:text-gray-200">Total</span>
        <span />
        <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{totalDV}</span>
        <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{totalAS}</span>
        <span className="text-right tabular-nums text-gray-700 dark:text-gray-200">{totalAF}</span>
        <span />
        <span />
      </div>
      {Object.keys(factorMap).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-gray-500 dark:text-gray-400">
          {Object.entries(factorMap).map(([name, total]) => (
            <span key={name}>{name}: <span className="font-semibold text-gray-700 dark:text-gray-200">{total}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlayerSelect — custom dropdown showing team color dot + name
// ---------------------------------------------------------------------------

function PlayerSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CampaignPlayer[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(p => p.id === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 rounded border border-gray-300 px-2 py-1.5 text-left text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      >
        {selected ? (
          <>
            {selected.teamColor
              ? <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: selected.teamColor }} />
              : <span className="h-2.5 w-2.5 flex-shrink-0" />
            }
            <span className="flex-1 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-gray-400 dark:text-gray-500">— Select player —</span>
        )}
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <button
            type="button"
            onClick={() => { onChange(''); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-400 hover:bg-gray-50 dark:text-gray-500 dark:hover:bg-gray-800"
          >
            — Select player —
          </button>
          {options.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onChange(p.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                p.id === value
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {p.teamColor
                ? <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.teamColor }} />
                : <span className="h-2.5 w-2.5 flex-shrink-0" />
              }
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SetupPhaseView
// ---------------------------------------------------------------------------

function SetupPhaseView({
  scenario,
  players,
  diplomacyRelations,
  systemOwnership,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  diplomacyRelations: Record<string, DiplomacyLevel>;
  systemOwnership: Record<string, string>;
  onUpdate: (s: CombatScenario) => void;
}) {
  const systemPlayers = useMemo(() => {
    return players.filter(p =>
      p.units.some(u => u.systemId === scenario.systemId && !u.mothballed)
    );
  }, [players, scenario.systemId]);

  const attackerId = scenario.attackerForce.primaryPlayerId;
  const defenderId = scenario.defenderForce.primaryPlayerId;

  const updateForce = useCallback((side: 'attacker' | 'defender', patch: Partial<CombatForce>) => {
    const forceKey = side === 'attacker' ? 'attackerForce' : 'defenderForce';
    onUpdate({ ...scenario, [forceKey]: { ...scenario[forceKey], ...patch } });
  }, [scenario, onUpdate]);

  const getEligibleAllies = useCallback((primaryId: string, opposingId: string) => {
    if (!primaryId || !opposingId) return [];
    return systemPlayers.filter(p => {
      if (p.id === primaryId || p.id === opposingId) return false;
      const relWithPrimary = getRelation(diplomacyRelations, p.id, primaryId);
      const relWithOpposing = getRelation(diplomacyRelations, p.id, opposingId);
      return isAllied(relWithPrimary) && isAtWar(relWithOpposing);
    });
  }, [systemPlayers, diplomacyRelations]);

  const attackerAllies = useMemo(() => getEligibleAllies(attackerId, defenderId), [getEligibleAllies, attackerId, defenderId]);
  const defenderAllies = useMemo(() => getEligibleAllies(defenderId, attackerId), [getEligibleAllies, defenderId, attackerId]);

  const canBegin = attackerId && defenderId && attackerId !== defenderId;

  const handleBegin = () => {
    const unitStates = initScenarioUnitStates(scenario, players);
    // Snapshot each unit's strategic cripple status at scenario start (for Resolution tally)
    const initialUnitSnapshot: Record<string, { wasStrategicallyCrippled: boolean }> = {};
    const allUnits = players.flatMap(p => p.units);
    for (const unitId of Object.keys(unitStates)) {
      const unit = allUnits.find(u => u.id === unitId);
      initialUnitSnapshot[unitId] = { wasStrategicallyCrippled: unit?.crippled ?? false };
    }
    // Snapshot involved players' full state for Restart undo
    const involvedIds = new Set([
      scenario.attackerForce.primaryPlayerId,
      ...scenario.attackerForce.alliedPlayerIds,
      scenario.defenderForce.primaryPlayerId,
      ...scenario.defenderForce.alliedPlayerIds,
    ].filter(Boolean));
    const scenarioStartPlayersSnapshot: Record<string, CampaignPlayer> = {};
    for (const pid of involvedIds) {
      const p = players.find(pl => pl.id === pid);
      if (p) scenarioStartPlayersSnapshot[pid] = structuredClone(p);
    }
    const nextPhase: CombatScenarioPhase =
      scenario.scenarioType === 'ground_combat' ? 'task_force' : 'flagship';
    onUpdate({ ...scenario, unitStates, initialUnitSnapshot, scenarioStartPlayersSnapshot, phase: nextPhase });
  };

  const toggleAlly = (side: 'attacker' | 'defender', playerId: string) => {
    const force = side === 'attacker' ? scenario.attackerForce : scenario.defenderForce;
    const current = force.alliedPlayerIds;
    const next = current.includes(playerId)
      ? current.filter(id => id !== playerId)
      : [...current, playerId];
    updateForce(side, { alliedPlayerIds: next });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-auto p-6">
        {/* Scenario Type */}
        <div className="w-48 flex-shrink-0">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Scenario Type</h3>
          <div className="space-y-2">
            {(['interception', 'defensive', 'pursuit', 'ground_combat'] as CombatScenarioType[]).map(type => (
              <button
                key={type}
                onClick={() => {
                  let update: Partial<CombatScenario> = { scenarioType: type };
                  if (type === 'ground_combat') {
                    const ownerId = systemOwnership[scenario.systemId] ?? '';
                    if (ownerId) {
                      update = { ...update, defenderForce: { ...scenario.defenderForce, primaryPlayerId: ownerId, alliedPlayerIds: [] } };
                    }
                  }
                  onUpdate({ ...scenario, ...update });
                }}
                className={`w-full rounded border px-3 py-2 text-left text-sm transition-colors ${
                  scenario.scenarioType === type
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                }`}
              >
                {SCENARIO_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        {/* Attacker */}
        <div className="flex-1">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Attacker</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Primary Player</label>
              <PlayerSelect
                value={attackerId}
                options={systemPlayers.filter(p => p.id !== defenderId)}
                onChange={id => updateForce('attacker', { primaryPlayerId: id, alliedPlayerIds: [] })}
              />
            </div>
            {scenario.scenarioType !== 'ground_combat' && (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Readiness</label>
                <select
                  value={String(scenario.attackerForce.readiness)}
                  onChange={e => updateForce('attacker', { readiness: Number(e.target.value) as ReadinessLevel })}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {[-2, -1, 0, 1, 2].map(v => (
                    <option key={v} value={String(v)}>{READINESS_LABELS[v]}</option>
                  ))}
                </select>
              </div>
            )}
            {attackerAllies.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Allied Task Forces</label>
                <div className="space-y-1">
                  {attackerAllies.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={scenario.attackerForce.alliedPlayerIds.includes(p.id)}
                        onChange={() => toggleAlly('attacker', p.id)}
                        className="h-3.5 w-3.5"
                      />
                      {p.teamColor && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.teamColor }} />}
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {attackerId && (
              <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                <ForceLineup label="Attacker Units" scenario={scenario} side="attacker" players={players} />
              </div>
            )}
          </div>
        </div>

        {/* Defender */}
        <div className="flex-1">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Defender</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Primary Player</label>
              <PlayerSelect
                value={defenderId}
                options={systemPlayers.filter(p => p.id !== attackerId)}
                onChange={id => updateForce('defender', { primaryPlayerId: id, alliedPlayerIds: [] })}
              />
            </div>
            {scenario.scenarioType !== 'ground_combat' && (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Readiness</label>
                <select
                  value={String(scenario.defenderForce.readiness)}
                  onChange={e => updateForce('defender', { readiness: Number(e.target.value) as ReadinessLevel })}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  {[-2, -1, 0, 1, 2].map(v => (
                    <option key={v} value={String(v)}>{READINESS_LABELS[v]}</option>
                  ))}
                </select>
              </div>
            )}
            {defenderAllies.length > 0 && (
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Allied Task Forces</label>
                <div className="space-y-1">
                  {defenderAllies.map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-sm dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={scenario.defenderForce.alliedPlayerIds.includes(p.id)}
                        onChange={() => toggleAlly('defender', p.id)}
                        className="h-3.5 w-3.5"
                      />
                      {p.teamColor && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.teamColor }} />}
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {defenderId && (
              <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                <ForceLineup label="Defender Units" scenario={scenario} side="defender" players={players} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={handleBegin}
          disabled={!canBegin}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Begin Scenario →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FlagshipSelectionView
// ---------------------------------------------------------------------------

function FlagshipSelectionView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const setFlagship = (side: 'attacker' | 'defender', unitId: string | null) => {
    const newStates = { ...scenario.unitStates };
    // Clear existing flagship for side
    for (const state of Object.values(newStates)) {
      if (state.side === side && state.isFlagship) {
        newStates[state.unitId] = { ...state, isFlagship: false };
      }
    }
    if (unitId) {
      newStates[unitId] = { ...newStates[unitId], isFlagship: true };
    }
    onUpdate({ ...scenario, unitStates: newStates });
  };

  const canAdvance = () => {
    const attackerHasFlagship = Object.values(scenario.unitStates).some(s => s.side === 'attacker' && s.isFlagship);
    const defenderHasFlagship = Object.values(scenario.unitStates).some(s => s.side === 'defender' && s.isFlagship);
    return attackerHasFlagship && defenderHasFlagship;
  };

  const handleAdvance = () => {
    // Flagships automatically join the Task Force (free, don't count against CR)
    const newStates = { ...scenario.unitStates };
    for (const state of Object.values(newStates)) {
      if (state.isFlagship) {
        newStates[state.unitId] = { ...state, inTaskForce: true };
      }
    }
    onUpdate({
      ...scenario,
      unitStates: newStates,
      phase: 'task_force',
      prevAttackerFlagshipId: Object.values(newStates).find(s => s.side === 'attacker' && s.isFlagship)?.unitId ?? null,
      prevDefenderFlagshipId: Object.values(newStates).find(s => s.side === 'defender' && s.isFlagship)?.unitId ?? null,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-auto p-6">
        {(['attacker', 'defender'] as const).map(side => {
          const sideUnits = getSideUnits(scenario, side, players).filter(x => !x.state.destroyed && !x.state.exitedScenario);
          const flagEmpire = getFlagshipEmpire(scenario, side, players);
          const currentFlagshipId = Object.values(scenario.unitStates).find(s => s.side === side && s.isFlagship)?.unitId ?? null;
          const prevFsId = side === 'attacker' ? scenario.prevAttackerFlagshipId : scenario.prevDefenderFlagshipId;
          const flagshipChanged = prevFsId !== null && currentFlagshipId !== null && currentFlagshipId !== prevFsId;

          // Compute max CR among non-destroyed units
          const maxCR = sideUnits.reduce((max, { unit, template }) => {
            if (unit.crippled) return max;
            const cr = template.cr === '-' ? 0 : Number(template.cr);
            return Math.max(max, cr);
          }, 0);

          return (
            <div key={side} className="flex-1">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side} Flagship</h3>
              <div className="space-y-0.5">
                {/* Summary button — shows current flagship if one is selected, otherwise "No flagship" */}
                {(() => {
                  const selectedUnit = currentFlagshipId
                    ? sideUnits.find(x => x.unit.id === currentFlagshipId)
                    : null;
                  return (
                    <button
                      onClick={() => setFlagship(side, null)}
                      className={`w-full rounded border px-3 py-1.5 text-left text-sm ${
                        !currentFlagshipId
                          ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-900/20'
                          : 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                      }`}
                    >
                      {selectedUnit ? (
                        <span className="dark:text-gray-200">
                          ★ <span className="font-medium">{selectedUnit.unit.name || selectedUnit.template.name}</span>
                          {selectedUnit.template.hullCode !== 'N/A' && (
                            <span className="ml-1 text-gray-400">({selectedUnit.template.hullCode})</span>
                          )}
                          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">Click to deselect</span>
                        </span>
                      ) : (
                        <>
                          <span className="italic text-gray-500 dark:text-gray-400">No flagship</span>
                          <span className="ml-2 text-xs text-amber-500">⚠ No flagship selected</span>
                        </>
                      )}
                    </button>
                  );
                })()}
                {flagshipChanged && (
                  <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-600 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                    ⚠ New Flagship — −1 penalty applies this turn.
                  </p>
                )}
                {sideUnits.length > 0 && (() => {
                  // No `auto` badge column — badge lives inside the name cell to keep all rows' grids identical
                  // Grid: name | DV | AS | AF | CR | Traits
                  const fsCols = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr';
                  const sortedSideUnits = [...sideUnits].sort((a, b) => {
                    const aF = isFighter(a.template), bF = isFighter(b.template);
                    if (aF !== bF) return aF ? 1 : -1;
                    const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
                    const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
                    if (bCR !== aCR) return bCR - aCR;
                    return (a.unit.name || a.template.name).localeCompare(b.unit.name || b.template.name);
                  });
                  return (
                    <>
                      <div
                        className="grid gap-x-2 border-b border-gray-200 px-3 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500"
                        style={{ gridTemplateColumns: fsCols }}
                      >
                        <span>Unit</span>
                        <span className="text-right">DV</span>
                        <span className="text-right">AS</span>
                        <span className="text-right">AF</span>
                        <span className="text-right">CR</span>
                        <span className="pl-3">Traits</span>
                      </div>
                      {sortedSideUnits.map(({ unit, template, state }) => {
                        const cr = template.cr === '-' ? 0 : Number(template.cr);
                        const isMax = cr >= maxCR;
                        const isSelected = currentFlagshipId === unit.id;
                        const warnLowerCR = !isMax && cr < maxCR && !unit.crippled;
                        const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                        return (
                          <button
                            key={unit.id}
                            onClick={() => setFlagship(side, unit.id)}
                            className={`w-full rounded border px-3 py-1 text-left text-xs transition-colors ${
                              isSelected
                                ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                                : isMax
                                ? 'border-green-200 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-900/10'
                                : 'border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
                            }`}
                          >
                            <div className="grid items-center gap-x-2" style={{ gridTemplateColumns: fsCols }}>
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate dark:text-gray-200">
                                  {unit.name || template.name}
                                  {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                  <UnitStatusBadges unit={unit} />
                                  {state.crippledInScenario && !unit.crippled && (
                                    <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                  )}
                                </span>
                                {isMax && !isSelected && <span className="shrink-0 text-green-600 dark:text-green-400">✓ Max CR</span>}
                                {warnLowerCR && isSelected && <span className="shrink-0 text-amber-500">⚠ Lower CR</span>}
                              </div>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{eff.dv}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.as === '-' ? '—' : eff.as}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : eff.af}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                              <span className="pl-3 text-gray-400 dark:text-gray-500">
                                {template.traits.map((tr, i) => (
                                  <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>
                                ))}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({
            ...scenario,
            phase: scenario.turnNumber > 1 ? 'recovery' : 'setup',
            turnNumber: scenario.turnNumber > 1 ? scenario.turnNumber - 1 : scenario.turnNumber,
          })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={handleAdvance}
          disabled={!canAdvance()}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroundCombatTFView — simplified Task Force setup for Ground Combat
// ---------------------------------------------------------------------------

function GroundCombatTFView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const toggleInTF = (unitId: string, inTF: boolean) => {
    onUpdate({
      ...scenario,
      unitStates: {
        ...scenario.unitStates,
        [unitId]: { ...scenario.unitStates[unitId], inTaskForce: inTF },
      },
    });
  };

  const handleAdvance = () => {
    onUpdate({ ...scenario, phase: 'ground_combat' });
  };

  // Grid columns match the standard TF view: Unit | DV | ATK | AF | CR | Traits | action
  const tfCols  = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
  const poolCols = '1fr 1.75rem 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
  const hdrCls = 'grid gap-x-2 px-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500';

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-auto p-6">
        {(['attacker', 'defender'] as const).map(side => {
          const sideUnits = getSideUnits(scenario, side, players);
          const inTF   = sideUnits.filter(x => x.state.inTaskForce  && !x.state.destroyed && !x.state.exitedScenario);
          const inPool = sideUnits.filter(x => !x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);

          // Group pool by template + status
          type PoolGroup = { template: EmpireUnit; statusKey: string; scenarioCrippled: boolean; count: number; firstUnit: typeof inPool[0] };
          const poolMap = new Map<string, PoolGroup>();
          for (const item of inPool) {
            const sk = unitStatusKey(item.unit);
            const sc = !!(item.state.crippledInScenario && !item.unit.crippled);
            const key = `${item.template.id}|${sk}|${sc}`;
            if (!poolMap.has(key)) poolMap.set(key, { template: item.template, statusKey: sk, scenarioCrippled: sc, count: 0, firstUnit: item });
            poolMap.get(key)!.count++;
          }
          const poolGroups = [...poolMap.values()].sort((a, b) => a.template.name.localeCompare(b.template.name));

          return (
            <div key={side} className="flex-1">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side} Task Force</h3>

              <div className="space-y-0.5">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Task Force ({inTF.length})</p>
                {inTF.length > 0 && (
                  <div className={hdrCls} style={{ gridTemplateColumns: tfCols }}>
                    <span>Unit</span>
                    <span className="text-right">DV</span>
                    <span className="text-right">ATK</span>
                    <span className="text-right">AF</span>
                    <span className="text-right">CR</span>
                    <span className="pl-3">Traits</span>
                    <span />
                  </div>
                )}
                <div className="h-64 space-y-0.5 overflow-y-auto">
                  {inTF.map(({ unit, template, state, player }) => {
                    const isOnPlanet = unit.fleetId === 'On-Planet';
                    const isCrippled = unit.crippled || !!state.crippledInScenario;
                    return (
                      <div key={unit.id}
                        className="grid items-center gap-x-2 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default"
                        style={{ gridTemplateColumns: tfCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}
                      >
                        <span className="truncate dark:text-gray-200">
                          {unit.name || template.name}
                          <UnitStatusBadges unit={unit} />
                          {state.crippledInScenario && !unit.crippled && (
                            <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                          )}
                          {isOnPlanet && <span className="ml-1 text-gray-400" title="On-Planet — auto-deployed">🔒</span>}
                        </span>
                        <StatCell effective={isCrippled ? Math.ceil(template.dv * 0.5) : template.dv} base={template.dv} />
                        <StatCell effective={template.as === '-' ? 0 : computeGroundATK(unit, template, state)} base={template.as} />
                        <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : String(template.af)}</span>
                        <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                        <span className="pl-3 text-gray-400 dark:text-gray-500">
                          {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                        </span>
                        {isOnPlanet
                          ? <span className="text-center text-[10px] text-gray-400 dark:text-gray-500">On-Planet</span>
                          : <button onClick={() => toggleInTF(unit.id, false)} className="rounded px-1.5 py-0.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950">→ Pool</button>
                        }
                      </div>
                    );
                  })}
                  {inTF.length === 0 && <p className="text-xs italic text-gray-400">Empty</p>}
                </div>

                <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">Reinforcement Pool ({inPool.length})</p>
                {poolGroups.length === 0
                  ? <p className="text-xs italic text-gray-400">Empty</p>
                  : (
                    <>
                      <div className={hdrCls} style={{ gridTemplateColumns: poolCols }}>
                        <span>Unit</span>
                        <span className="text-right">×</span>
                        <span className="text-right">DV</span>
                        <span className="text-right">ATK</span>
                        <span className="text-right">AF</span>
                        <span className="text-right">CR</span>
                        <span className="pl-3">Traits</span>
                        <span />
                      </div>
                      {poolGroups.map(({ template, statusKey: sk, scenarioCrippled: sc, count, firstUnit }) => {
                        const isCrippled = firstUnit.unit.crippled || sc;
                        return (
                          <div key={`${template.id}|${sk}|${sc}`}>
                            <div
                              className="grid items-center gap-x-2 rounded border border-dashed border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default"
                              style={{ gridTemplateColumns: poolCols, borderLeftColor: firstUnit.player.teamColor ?? '#9ca3af', borderLeftWidth: '4px', borderLeftStyle: 'solid' }}
                            >
                              <span className="truncate dark:text-gray-200">
                                {template.name}
                                <UnitStatusBadges unit={firstUnit.unit} />
                                {sc && <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>}
                              </span>
                              <span className="text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
                              <StatCell effective={isCrippled ? Math.ceil(template.dv * 0.5) : template.dv} base={template.dv} />
                              <StatCell effective={template.as === '-' ? 0 : computeGroundATK(firstUnit.unit, template, firstUnit.state)} base={template.as} />
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : String(template.af)}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                              <span className="pl-3 text-gray-400 dark:text-gray-500">
                                {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                              </span>
                              <div className="flex items-center gap-1">
                                {!template.traits.some(t => t.name === 'Marines') && (
                                  <span className="text-yellow-500 dark:text-yellow-400 text-xs leading-none" title="No Marines trait — ATK halved when deploying off-planet">⚠</span>
                                )}
                                <button
                                  disabled={isCrippled}
                                  onClick={() => !isCrippled && toggleInTF(firstUnit.unit.id, true)}
                                  className={`rounded px-1.5 py-0.5 ${isCrippled ? 'cursor-not-allowed text-gray-400 dark:text-gray-600' : 'text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950'}`}
                                  title={isCrippled ? 'Crippled — cannot deploy off-planet' : undefined}
                                >
                                  → TF
                                </button>
                              </div>
                            </div>
                            {isCrippled && (
                              <p className="px-2 text-[11px] text-red-600 dark:text-red-400">Crippled — cannot deploy off-planet</p>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )
                }
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <div className="flex gap-4 text-sm text-amber-600 dark:text-amber-400">
          {!Object.values(scenario.unitStates).some(s => s.side === 'attacker') && (
            <span>⚠ Attacker has no troops at this system.</span>
          )}
          {!Object.values(scenario.unitStates).some(s => s.side === 'defender') && (
            <span>⚠ Defender has no troops at this system.</span>
          )}
        </div>
        <button
          onClick={handleAdvance}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Begin Ground Combat →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GroundCombatPhaseView — Fire-phase-style ground combat with hit assignment
// ---------------------------------------------------------------------------

function GroundCombatPhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [confirmingAdvance, setConfirmingAdvance] = useState(false);

  const getUnits = (side: 'attacker' | 'defender') =>
    getSideUnits(scenario, side, players).filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);

  const setHits = (side: 'attacker' | 'defender', val: number) => {
    onUpdate({ ...scenario, subPhaseHits: { ...scenario.subPhaseHits, [side]: val } });
  };

  const confirmAction = (dialog: ActionDialog, cost: number) => {
    const state = scenario.unitStates[dialog.unitId];
    const patch = dialog.action === 'cripple'
      ? { pendingCripple: { cost, firingSide: dialog.firingSide } }
      : { pendingDestroy: { cost, firingSide: dialog.firingSide } };
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [dialog.unitId]: { ...state, ...patch } },
      subPhaseHits: { ...scenario.subPhaseHits, [dialog.firingSide]: scenario.subPhaseHits[dialog.firingSide] - cost },
    });
    setActionDialog(null);
  };

  const removePendingCripple = (unitId: string) => {
    const state = scenario.unitStates[unitId];
    if (!state.pendingCripple) return;
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [unitId]: { ...state, pendingCripple: null } },
      subPhaseHits: { ...scenario.subPhaseHits, [state.pendingCripple.firingSide]: scenario.subPhaseHits[state.pendingCripple.firingSide] + state.pendingCripple.cost },
    });
  };

  const removePendingDestroy = (unitId: string) => {
    const state = scenario.unitStates[unitId];
    if (!state.pendingDestroy) return;
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [unitId]: { ...state, pendingDestroy: null } },
      subPhaseHits: { ...scenario.subPhaseHits, [state.pendingDestroy.firingSide]: scenario.subPhaseHits[state.pendingDestroy.firingSide] + state.pendingDestroy.cost },
    });
  };

  const remainingHitsA = scenario.subPhaseHits.attacker;
  const remainingHitsD = scenario.subPhaseHits.defender;
  const hasRemainingHits = remainingHitsA > 0 || remainingHitsD > 0;
  const hasNegativeHits = remainingHitsA < 0 || remainingHitsD < 0;

  const handleNext = () => {
    // Apply all pending effects
    const newStates = { ...scenario.unitStates };
    for (const id of Object.keys(newStates)) {
      const s = newStates[id];
      let updated = { ...s };
      if (s.pendingCripple) updated = { ...updated, crippledInScenario: true, pendingCripple: null };
      if (s.pendingDestroy) updated = { ...updated, destroyed: true, pendingDestroy: null };
      newStates[id] = updated;
    }
    // Determine winner from final state
    const attackerAllGone = Object.values(newStates).filter(s => s.side === 'attacker').every(s => s.destroyed || s.exitedScenario);
    const defenderAllGone = Object.values(newStates).filter(s => s.side === 'defender').every(s => s.destroyed || s.exitedScenario);
    let winner: CombatScenario['winner'] = null;
    if (attackerAllGone && defenderAllGone) winner = 'mutual_retreat';
    else if (attackerAllGone) winner = 'defender';
    else if (defenderAllGone) winner = 'attacker';
    onUpdate({
      ...scenario,
      unitStates: newStates,
      winner,
      resolvedAt: new Date().toISOString(),
      phase: 'resolved',
      subPhaseHits: { attacker: 0, defender: 0 },
    });
  };

  const fireCols  = '1fr 2.5rem 2.5rem 2.5rem 1fr';
  const hitsCols  = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
  const hdrCls = 'grid gap-x-2 px-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex flex-col overflow-auto p-6">

        <div className="mb-4 shrink-0 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Ground Combat</span>
        </div>

        {/* Firing panels */}
        <div className="mb-4 grid grid-cols-2 gap-4 shrink-0">
          {(['attacker', 'defender'] as const).map(side => {
            const firingUnits = getUnits(side);
            const totalATK = firingUnits.reduce((sum, { unit, template, state }) => sum + computeGroundATK(unit, template, state), 0);
            return (
              <div key={side} className="rounded border border-gray-200 p-3 dark:border-gray-700 flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 capitalize">{side}</p>

                {firingUnits.length > 0 && (
                  <div className="space-y-0.5">
                    <div className={hdrCls} style={{ gridTemplateColumns: fireCols }}>
                      <span>Unit</span>
                      <span className="text-right">DV</span>
                      <span className="text-right">ATK</span>
                      <span className="text-right">CR</span>
                      <span className="pl-3">Traits</span>
                    </div>
                    {firingUnits.map(({ unit, template, state, player }) => {
                      const isCrippled = unit.crippled || !!state.crippledInScenario;
                      const stateForATK = state.pendingCripple ? { ...state, crippledInScenario: true } : state;
                      const atk = computeGroundATK(unit, template, stateForATK);
                      const baseATK = template.as === '-' ? 0 : template.as as number;
                      return (
                        <div key={unit.id}
                          className="grid items-center gap-x-2 rounded border border-gray-200 px-1 py-0.5 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default"
                          style={{ gridTemplateColumns: fireCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}
                        >
                          <span className="min-w-0 truncate dark:text-gray-200">
                            {unit.name || template.name}
                            <UnitStatusBadges unit={unit} />
                            {state.crippledInScenario && !unit.crippled && (
                              <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Crippled</span>
                            )}
                          </span>
                          <StatCell effective={isCrippled ? Math.ceil(template.dv * 0.5) : template.dv} base={template.dv} />
                          <StatCell effective={atk} base={baseATK} />
                          <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                          <span className="pl-3 text-gray-400 dark:text-gray-500">
                            {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {firingUnits.length === 0 && <p className="text-xs italic text-gray-400">No troops deployed.</p>}

                <p className="text-sm dark:text-gray-200">Total ATK: <span className="font-bold text-blue-600 dark:text-blue-300">{totalATK}</span></p>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Hits dealt:</label>
                  <input
                    type="number"
                    min="0"
                    value={scenario.subPhaseHits[side]}
                    onChange={e => setHits(side, parseInt(e.target.value) || 0)}
                    className="w-16 rounded border border-gray-300 px-2 py-0.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Damage allocation panels */}
        <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
          {(['attacker', 'defender'] as const).map(firingSide => {
            const targetSide: 'attacker' | 'defender' = firingSide === 'attacker' ? 'defender' : 'attacker';
            const targets = getSideUnits(scenario, targetSide, players)
              .filter(x => x.state.inTaskForce && !x.state.exitedScenario)
              .sort((a, b) => {
                const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
                const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
                return bCR - aCR || a.template.name.localeCompare(b.template.name);
              });
            const hitsRemaining = scenario.subPhaseHits[firingSide];

            return (
              <div key={firingSide} className="rounded border border-gray-200 p-3 dark:border-gray-700 flex flex-col min-h-0">
                <p className="mb-2 shrink-0 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {firingSide === 'attacker' ? 'Attacker' : 'Defender'} firing at {targetSide}
                  {hitsRemaining > 0 && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">({hitsRemaining} hits remaining)</span>
                  )}
                </p>
                {targets.length === 0 ? (
                  <p className="text-xs italic text-gray-400">No eligible targets</p>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className={`${hdrCls} sticky top-0 z-10 bg-white dark:bg-gray-900`} style={{ gridTemplateColumns: hitsCols }}>
                      <span>Unit</span>
                      <span className="text-right">DV</span>
                      <span className="text-right">ATK</span>
                      <span className="text-right">AF</span>
                      <span className="text-right">CR</span>
                      <span className="pl-3">Traits</span>
                      <span />
                    </div>
                    <div className="space-y-0.5">
                      {targets.map(({ unit, template, state, player }) => {
                        const isCrippled = unit.crippled || !!state.crippledInScenario;
                        const isCrippledAnywhere = isCrippled || !!state.pendingCripple;
                        const hasPendingCripple = !!state.pendingCripple;
                        const hasPendingDestroy = !!state.pendingDestroy;
                        const isArmored = template.traits.some(t => t.name === 'Armored');
                        const effDV = isCrippled ? Math.ceil(template.dv * 0.5) : template.dv;
                        const destroyDV = (hasPendingCripple && !isArmored) ? Math.ceil(effDV * 0.5) : effDV;
                        const visualDV = hasPendingCripple && !isArmored ? Math.ceil(effDV * 0.5) : effDV;
                        const baseATK = template.as === '-' ? 0 : template.as as number;
                        const effATK = computeGroundATK(unit, template, isCrippledAnywhere ? { ...state, crippledInScenario: true } : state);
                        return (
                          <div key={unit.id}
                            className={`grid items-center gap-x-2 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default ${state.destroyed ? 'opacity-40' : ''}`}
                            style={{ gridTemplateColumns: hitsCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}
                          >
                            <span className="min-w-0 truncate dark:text-gray-200">
                              {unit.name || template.name}
                              <UnitStatusBadges unit={unit} />
                              {state.crippledInScenario && !unit.crippled && (
                                <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Crippled</span>
                              )}
                              {hasPendingCripple && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <span className="rounded px-1 py-0 text-[9px] bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">Cripple ({state.pendingCripple!.cost})</span>
                                  <button onClick={() => removePendingCripple(unit.id)} className="text-[10px] leading-none text-amber-500 hover:text-amber-700">×</button>
                                </span>
                              )}
                              {hasPendingDestroy && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <span className="rounded px-1 py-0 text-[9px] bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300">Destroy ({state.pendingDestroy!.cost})</span>
                                  <button onClick={() => removePendingDestroy(unit.id)} className="text-[10px] leading-none text-red-500 hover:text-red-700">×</button>
                                </span>
                              )}
                              {state.destroyed && <span className="ml-1 text-red-500">✗</span>}
                            </span>
                            <StatCell effective={visualDV} base={template.dv} isBlockedByTrait={isCrippledAnywhere && isArmored} />
                            <StatCell effective={effATK} base={baseATK} />
                            <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : String(template.af)}</span>
                            <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                            <span className="pl-3 text-gray-400 dark:text-gray-500">
                              {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                            </span>
                            {!state.destroyed && !hasPendingDestroy ? (
                              isCrippledAnywhere ? (
                                <button
                                  onClick={() => setActionDialog({ unitId: unit.id, unitName: unit.name || template.name, action: 'destroy', firingSide, assignedCost: destroyDV, directedCost: destroyDV * 2 })}
                                  className="rounded px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                >Destroy</button>
                              ) : (
                                <button
                                  onClick={() => setActionDialog({ unitId: unit.id, unitName: unit.name || template.name, action: 'cripple', firingSide, assignedCost: effDV, directedCost: effDV * 2 })}
                                  className="rounded px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                                >Cripple</button>
                              )
                            ) : <span />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'task_force', subPhaseHits: { attacker: 0, defender: 0 } })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {hasNegativeHits && (
            <span className="text-xs text-red-500">
              ⚠ Hits are over budget
              {remainingHitsA < 0 && ` (Attacker: ${remainingHitsA})`}
              {remainingHitsD < 0 && ` (Defender: ${remainingHitsD})`}
            </span>
          )}
          {!hasNegativeHits && hasRemainingHits && (
            <span className="text-xs text-amber-500">⚠ {remainingHitsA + remainingHitsD} hits unallocated</span>
          )}
          {confirmingAdvance ? (
            <>
              <span className="text-xs text-red-500">Advance with negative hits?</span>
              <button onClick={() => { setConfirmingAdvance(false); handleNext(); }} className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">Confirm →</button>
              <button onClick={() => setConfirmingAdvance(false)} className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">Cancel</button>
            </>
          ) : (
            <button
              onClick={() => { if (hasNegativeHits) { setConfirmingAdvance(true); } else { handleNext(); } }}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Resolve Combat →
            </button>
          )}
        </div>
      </div>

      {actionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
              {actionDialog.action === 'cripple' ? 'Cripple Unit?' : 'Destroy Unit?'}
            </h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{actionDialog.unitName}</p>
            <p className="mb-3 text-xs font-medium text-gray-600 dark:text-gray-300">Choose hit cost method:</p>
            <div className="mb-4 flex gap-2">
              <button onClick={() => confirmAction(actionDialog, actionDialog.assignedCost)} className="flex-1 rounded border border-gray-200 px-3 py-2.5 text-left text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                <div className="font-semibold text-gray-700 dark:text-gray-200">Assigned</div>
                <div className="text-gray-400">{actionDialog.assignedCost} hits</div>
              </button>
              <button onClick={() => confirmAction(actionDialog, actionDialog.directedCost)} className="flex-1 rounded border border-gray-200 px-3 py-2.5 text-left text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                <div className="font-semibold text-gray-700 dark:text-gray-200">Directed</div>
                <div className="text-gray-400">{actionDialog.directedCost} hits</div>
              </button>
            </div>
            <button onClick={() => setActionDialog(null)} className="w-full rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskForceSetupView
// ---------------------------------------------------------------------------

function TaskForceSetupView({
  scenario,
  players,
  map,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  map: GameMap;
  onUpdate: (s: CombatScenario) => void;
}) {
  if (scenario.scenarioType === 'ground_combat') {
    return <GroundCombatTFView scenario={scenario} players={players} onUpdate={onUpdate} />;
  }

  const isAtmospheric = (t: EmpireUnit) => t.traits.some(tr => tr.name === 'Atmospheric');

  // No-base warning for defensive scenario
  const noBaseWarning = scenario.scenarioType === 'defensive' && (() => {
    const primaryDefenderId = scenario.defenderForce.primaryPlayerId;
    const primaryDefender = players.find(p => p.id === primaryDefenderId);
    if (!primaryDefender) return false;
    const tplMap = new Map(primaryDefender.empire.units.map(u => [u.id, u]));
    return !primaryDefender.units.some(u => {
      if (u.systemId !== scenario.systemId) return false;
      const tpl = tplMap.get(u.unitTemplateId);
      return tpl ? isBase(tpl) : false;
    });
  })();

  const [confirmNoBase, setConfirmNoBase] = useState(false);
  const [baseWrongScenarioWarning, setBaseWrongScenarioWarning] = useState<{ unitId: string } | null>(null);

  const toggleInTaskForce = (unitId: string, inTF: boolean, template?: EmpireUnit, side?: 'attacker' | 'defender') => {
    // Warn if placing a Base unit in a non-defensive or non-defender TF
    if (inTF && template && isBase(template)) {
      const isAllowed = scenario.scenarioType === 'defensive' && side === 'defender';
      if (!isAllowed) {
        setBaseWrongScenarioWarning({ unitId });
        return;
      }
    }
    onUpdate({
      ...scenario,
      unitStates: {
        ...scenario.unitStates,
        [unitId]: { ...scenario.unitStates[unitId], inTaskForce: inTF },
      },
    });
  };

  const handleAdvance = () => {
    onUpdate({ ...scenario, phase: 'assignments' });
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-1 gap-6 overflow-auto p-6">
        {(['attacker', 'defender'] as const).map(side => {
          const sideUnits = getSideUnits(scenario, side, players);
          const flagEmpire = getFlagshipEmpire(scenario, side, players);

          const flagshipUnit = sideUnits.find(({ state }) => state.isFlagship);
          const flagshipCR = flagshipUnit
            ? (flagshipUnit.template.cr === '-' ? 0 : Number(flagshipUnit.template.cr))
            : 0;

          // For Pursuit Attacker, effective CR is halved
          const isPursuitAttacker = scenario.scenarioType === 'pursuit' && side === 'attacker';
          const effectiveCR = isPursuitAttacker ? Math.ceil(flagshipCR * 0.5) : flagshipCR;

          // Lookup system from map for planetary slot capacity
          const system = map.systems.find(s => s.id === scenario.systemId);
          const isDefensiveDefender = scenario.scenarioType === 'defensive' && side === 'defender';
          const planetarySlotCapacity = isDefensiveDefender ? (system?.attributes?.fortification ?? 0) : 0;
          const baseSlotCapacity = isDefensiveDefender ? 1 : 0;

          // Count carrier / tender / base free slots (crippled units have their factors halved)
          const tfUnits = sideUnits.filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
          let carrierFactors = 0, tenderFactors = 0;
          for (const { unit, template, state } of tfUnits) {
            if (unit.captured) continue;
            const isCrippled = unit.crippled || !!state.crippledInScenario;
            for (const tr of template.traits) {
              if (tr.name === 'Carrier' && tr.factor) carrierFactors += isCrippled ? Math.ceil(tr.factor * 0.5) : tr.factor;
              if (tr.name === 'Tender' && tr.factor) tenderFactors += isCrippled ? Math.ceil(tr.factor * 0.5) : tr.factor;
            }
          }

          let tfSlotUsed = 0;
          let freeCarrierSlotsUsed = 0;
          let freeTenderSlotsUsed = 0;
          let planetarySlotsUsed = 0;
          let freeBaseSlotsUsed = 0;
          for (const { template: t2, state: s2 } of tfUnits) {
            if (s2.isFlagship) continue;
            if (isCivilian(t2)) continue;
            if (isBase(t2)) {
              if (freeBaseSlotsUsed < baseSlotCapacity) { freeBaseSlotsUsed++; }
              else tfSlotUsed++;
            } else if (isFighter(t2)) {
              if (freeCarrierSlotsUsed < carrierFactors) { freeCarrierSlotsUsed++; }
              else if (isDefensiveDefender && isAtmospheric(t2) && planetarySlotsUsed < planetarySlotCapacity) { planetarySlotsUsed++; }
              else tfSlotUsed++;
            } else if (t2.hullCode === 'AB') {
              if (freeTenderSlotsUsed < tenderFactors) { freeTenderSlotsUsed++; }
              else if (isDefensiveDefender && planetarySlotsUsed < planetarySlotCapacity) { planetarySlotsUsed++; }
              else tfSlotUsed++;
            } else {
              tfSlotUsed++;
            }
          }

          const inTFUnsorted = sideUnits.filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
          const inTF = [...inTFUnsorted].sort((a, b) => {
            if (a.state.isFlagship) return -1;
            if (b.state.isFlagship) return 1;
            const aFighter = a.template.category === 'Fighters';
            const bFighter = b.template.category === 'Fighters';
            if (aFighter !== bFighter) return aFighter ? 1 : -1;
            const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
            const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
            return bCR - aCR;
          });
          const inPool = sideUnits.filter(x => !x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);

          return (
            <div key={side} className="flex-1">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side} Task Force</h3>

              {flagshipUnit && (
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  Flagship: <span className="font-medium text-gray-700 dark:text-gray-200">
                    {flagshipUnit.unit.name || flagshipUnit.template.name}
                  </span>
                  {' '}CR:{flagshipCR}
                  {isPursuitAttacker && <span className="text-amber-500"> (Pursuit: eff. {effectiveCR})</span>}
                </p>
              )}

              <div className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                Slots: <span className={`font-semibold ${tfSlotUsed > effectiveCR ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
                  {tfSlotUsed} / {effectiveCR}
                </span>
                {carrierFactors > 0 && (
                  <span className={`ml-2 ${freeCarrierSlotsUsed >= carrierFactors ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                    Fighter: {freeCarrierSlotsUsed}/{carrierFactors} free
                  </span>
                )}
                {tenderFactors > 0 && (
                  <span className={`ml-2 ${freeTenderSlotsUsed >= tenderFactors ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                    AB: {freeTenderSlotsUsed}/{tenderFactors} free
                  </span>
                )}
                {isDefensiveDefender && planetarySlotCapacity > 0 && (
                  <span className={`ml-2 ${planetarySlotsUsed > planetarySlotCapacity ? 'text-amber-500' : 'text-blue-600 dark:text-blue-400'}`}>
                    Planetary: {planetarySlotsUsed}/{planetarySlotCapacity}
                  </span>
                )}
                {isDefensiveDefender && (
                  <span className={`ml-2 ${freeBaseSlotsUsed >= baseSlotCapacity ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
                    Base: {freeBaseSlotsUsed}/{baseSlotCapacity} free
                  </span>
                )}
              </div>

              {tfSlotUsed > effectiveCR && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">⚠ Task Force exceeds CR capacity</p>
              )}
              {isPursuitAttacker && inTF.some(x => x.unit.crippled || !!x.state.crippledInScenario) && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">⚠ Pursuit: Crippled units may not participate in the attacker formation</p>
              )}
              {isPursuitAttacker
                && inPool.some(x => x.unit.crippled || !!x.state.crippledInScenario)
                && inTF.some(x => !x.state.isFlagship && !isCivilian(x.template) && !(x.unit.crippled || !!x.state.crippledInScenario)) && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">⚠ Pursuit: Crippled unit in pool while a non-crippled unit occupies a slot</p>
              )}
              {isDefensiveDefender && noBaseWarning && (
                <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">⚠ Defense: Primary Defender has no Base unit at this system</p>
              )}

              <div className="space-y-0.5">
                {/* Fixed-width button columns so all rows share identical grid geometry */}
                {(() => {
                  // 4.5rem fits "→ Pool"; pool "→ TF" is shorter but same column used for header alignment
                  const tfCols = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
                  const poolCols = '1fr 1.75rem 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
                  const hdrCls = 'grid gap-x-2 px-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500';
                  return (
                    <>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Task Force ({inTF.length})</p>
                      {inTF.length > 0 && (
                        <div className={hdrCls} style={{ gridTemplateColumns: tfCols }}>
                          <span>Unit</span>
                          <span className="text-right">DV</span>
                          <span className="text-right">AS</span>
                          <span className="text-right">AF</span>
                          <span className="text-right">CR</span>
                          <span className="pl-3">Traits</span>
                          <span />
                        </div>
                      )}
                      <div className="h-64 space-y-0.5 overflow-y-auto">
                        {inTF.map(({ unit, template, state, player }) => {
                          const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                          const tfUnitCrippled = unit.crippled || !!state.crippledInScenario;
                          return (
                            <div key={unit.id} className="grid items-center gap-x-2 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: tfCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}>
                              <span className="truncate dark:text-gray-200">
                                {unit.name || template.name}
                                {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                <UnitStatusBadges unit={unit} />
                                {state.crippledInScenario && !unit.crippled && (
                                  <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                )}
                                {state.isFlagship && <span className="ml-1 text-yellow-500">★</span>}
                              </span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={eff.dv !== template.dv ? `Base: ${template.dv}` : undefined}>{eff.dv}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={template.as !== '-' && eff.as !== (template.as as number) ? `Base: ${template.as}` : undefined}>{template.as === '-' ? '—' : eff.as}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={template.af !== '-' && eff.af !== (template.af as number) ? `Base: ${template.af}` : undefined}>{template.af === '-' ? '—' : eff.af}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                              <span className="pl-3 text-gray-400 dark:text-gray-500">
                                {template.traits.map((tr, i) => {
                                  const effF = tr.factor && tfUnitCrippled ? Math.ceil(tr.factor * 0.5) : tr.factor;
                                  return (
                                    <span key={i}>
                                      {i > 0 && ', '}{tr.name}
                                      {tr.factor ? (effF !== tr.factor ? ` ${effF} (${tr.factor})` : ` ${tr.factor}`) : ''}
                                    </span>
                                  );
                                })}
                              </span>
                              {!state.isFlagship ? (
                                <button onClick={() => toggleInTaskForce(unit.id, false)} className="rounded px-1.5 py-0.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950">→ Pool</button>
                              ) : <span />}
                            </div>
                          );
                        })}
                        {inTF.length === 0 && <p className="text-xs italic text-gray-400">Empty</p>}
                      </div>

                      <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">Reinforcement Pool ({inPool.length})</p>
                      {(() => {
                        type PoolGroup = { template: EmpireUnit; statusKey: string; scenarioCrippled: boolean; count: number; firstUnit: typeof inPool[0] };
                        const poolMap = new Map<string, PoolGroup>();
                        for (const item of inPool) {
                          const sk = unitStatusKey(item.unit);
                          const sc = !!(item.state?.crippledInScenario && !item.unit.crippled);
                          const key = `${item.template.id}|${sk}|${sc}`;
                          if (!poolMap.has(key)) poolMap.set(key, { template: item.template, statusKey: sk, scenarioCrippled: sc, count: 0, firstUnit: item });
                          poolMap.get(key)!.count++;
                        }
                        const poolGroups = [...poolMap.values()].sort((a, b) => {
                          const aFighter = a.template.category === 'Fighters';
                          const bFighter = b.template.category === 'Fighters';
                          if (aFighter !== bFighter) return aFighter ? 1 : -1;
                          const diff = (b.template.cr === '-' ? -1 : Number(b.template.cr)) - (a.template.cr === '-' ? -1 : Number(a.template.cr));
                          return diff !== 0 ? diff : a.template.name.localeCompare(b.template.name);
                        });
                        if (poolGroups.length === 0) return <p className="text-xs italic text-gray-400">Empty</p>;
                        return (
                          <>
                            <div className={hdrCls} style={{ gridTemplateColumns: poolCols }}>
                              <span>Unit</span>
                              <span className="text-right">×</span>
                              <span className="text-right">DV</span>
                              <span className="text-right">AS</span>
                              <span className="text-right">AF</span>
                              <span className="text-right">CR</span>
                              <span className="pl-3">Traits</span>
                              <span />
                            </div>
                            {poolGroups.map(({ template, statusKey: sk, scenarioCrippled: sc, count, firstUnit }) => {
                              const eff = computeEffectiveStats(firstUnit.unit, template, firstUnit.state, flagEmpire);
                              return (
                                <div key={`${template.id}|${sk}|${sc}`} className="grid items-center gap-x-2 rounded border border-dashed border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: poolCols, borderLeftColor: firstUnit.player.teamColor ?? '#9ca3af', borderLeftWidth: '4px', borderLeftStyle: 'solid' }}>
                                  <span className="truncate dark:text-gray-200">
                                    {template.name}
                                    {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                    <UnitStatusBadges unit={firstUnit.unit} />
                                    {sc && <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>}
                                  </span>
                                  <span className="text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">×{count}</span>
                                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={eff.dv !== template.dv ? `Base: ${template.dv}` : undefined}>{eff.dv}</span>
                                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={template.as !== '-' && eff.as !== (template.as as number) ? `Base: ${template.as}` : undefined}>{template.as === '-' ? '—' : eff.as}</span>
                                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400" title={template.af !== '-' && eff.af !== (template.af as number) ? `Base: ${template.af}` : undefined}>{template.af === '-' ? '—' : eff.af}</span>
                                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                                  <span className="pl-3 text-gray-400 dark:text-gray-500">
                                    {(() => {
                                      const poolCrippled = firstUnit.unit.crippled || sc;
                                      return template.traits.map((tr, i) => {
                                        const effF = tr.factor && poolCrippled ? Math.ceil(tr.factor * 0.5) : tr.factor;
                                        return (
                                          <span key={i}>
                                            {i > 0 && ', '}{tr.name}
                                            {tr.factor ? (effF !== tr.factor ? ` ${effF} (${tr.factor})` : ` ${tr.factor}`) : ''}
                                          </span>
                                        );
                                      });
                                    })()}
                                  </span>
                                  <button onClick={() => toggleInTaskForce(firstUnit.unit.id, true, firstUnit.template, side)} className="rounded px-1.5 py-0.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950">→ TF</button>
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'flagship' })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        {confirmNoBase ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-amber-700 dark:text-amber-400">Proceed without a Base unit?</span>
            <button onClick={() => { setConfirmNoBase(false); handleAdvance(); }}
              className="rounded bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700">
              Yes, Continue
            </button>
            <button onClick={() => setConfirmNoBase(false)}
              className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              if (noBaseWarning) { setConfirmNoBase(true); } else { handleAdvance(); }
            }}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Continue →
          </button>
        )}
      </div>
      {baseWrongScenarioWarning && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
          <div className="rounded-lg border border-amber-300 bg-white p-4 shadow-lg dark:border-amber-700 dark:bg-gray-900">
            <p className="mb-3 text-sm font-semibold text-amber-700 dark:text-amber-400">⚠ Base units may only be placed in a Defense Scenario on the Defender's side.</p>
            <div className="flex justify-end">
              <button onClick={() => setBaseWrongScenarioWarning(null)}
                className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssignmentsPhaseView
// ---------------------------------------------------------------------------

function AssignmentsPhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const updateState = (unitId: string, patch: Partial<CombatUnitState>) => {
    onUpdate({
      ...scenario,
      unitStates: {
        ...scenario.unitStates,
        [unitId]: { ...scenario.unitStates[unitId], ...patch },
      },
    });
  };

  const setFighterAssignment = (unitId: string, assignment: FighterAssignment) => {
    updateState(unitId, { fighterAssignment: assignment });
  };

  const toggleFormationBonus = (unitId: string) => {
    const cur = scenario.unitStates[unitId];
    updateState(unitId, { formationBonus: !cur.formationBonus });
  };

  const toggleJammed = (unitId: string) => {
    const cur = scenario.unitStates[unitId];
    updateState(unitId, { jammed: !cur.jammed });
  };

  const toggleDisrupted = (unitId: string) => {
    const cur = scenario.unitStates[unitId];
    updateState(unitId, { disrupted: !cur.disrupted });
  };

  const unassignedFighterCount = (['attacker', 'defender'] as const).reduce((n, side) => {
    const tfUnits = getSideUnits(scenario, side, players).filter(
      x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario,
    );
    return n + tfUnits.filter(x => isFighter(x.template) && !x.state.fighterAssignment).length;
  }, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{PHASE_LABELS.assignments}</span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {(['attacker', 'defender'] as const).map(side => {
            const sideUnits = getSideUnits(scenario, side, players);
            const tfUnits = sideUnits.filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
            const flagEmpire = getFlagshipEmpire(scenario, side, players);

            // Shared sort: flagship first, then ships by CR desc, fighters last
            type SortableUnit = { unit: CampaignUnit; template: EmpireUnit; state: CombatUnitState };
            const tfSort = (a: SortableUnit, b: SortableUnit) => {
              if (a.state.isFlagship) return -1;
              if (b.state.isFlagship) return 1;
              const aF = a.template.category === 'Fighters';
              const bF = b.template.category === 'Fighters';
              if (aF !== bF) return aF ? 1 : -1;
              const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
              const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
              return bCR - aCR;
            };

            // Guardian factors → free Formation Bonus slots
            const guardianTotal = computeFactorTotal(
              tfUnits.map(x => x.unit),
              buildTemplateMap(players),
              'Guardian',
            );
            const fbSlots = 1 + guardianTotal;
            const fbUsed = tfUnits.filter(x => x.state.formationBonus).length;

            // Jammer/Disruptor factors for THIS side (applied to opposite side)
            const jammerTotal = computeFactorTotal(
              tfUnits.map(x => x.unit),
              buildTemplateMap(players),
              'Jammer',
            );
            const disruptorTotal = computeFactorTotal(
              tfUnits.map(x => x.unit),
              buildTemplateMap(players),
              'Disruptor',
            );

            const oppSide: 'attacker' | 'defender' = side === 'attacker' ? 'defender' : 'attacker';
            const oppSideUnits = getSideUnits(scenario, oppSide, players);
            const oppTFUnits = oppSideUnits.filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);

            const jammedCount = oppTFUnits.filter(x => x.state.jammed).length;
            const disruptedCount = oppTFUnits.filter(x => x.state.disrupted).length;

            // EW notes
            const scoutSelf = computeFactorTotal(tfUnits.map(x => x.unit), buildTemplateMap(players), 'Scout');
            const scoutOpp = computeFactorTotal(oppTFUnits.map(x => x.unit), buildTemplateMap(players), 'Scout');
            const stealthSelf = tfUnits.filter(x => !x.unit.crippled && x.template.traits.some(t => t.name === 'Stealth')).length;
            const stealthOpp = oppTFUnits.filter(x => !x.unit.crippled && x.template.traits.some(t => t.name === 'Stealth')).length;
            const ewPrevFsId = side === 'attacker' ? scenario.prevAttackerFlagshipId : scenario.prevDefenderFlagshipId;
            const ewCurrentFsId = Object.values(scenario.unitStates).find(s => s.side === side && s.isFlagship)?.unitId ?? null;
            const ewFlagshipChanged = ewPrevFsId !== null && ewCurrentFsId !== null && ewCurrentFsId !== ewPrevFsId;

            return (
              <div key={side}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side}</h3>

                {/* Formation Bonus */}
                <div className="mb-4">
                  <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    Formation Bonus ({fbUsed}/{fbSlots} slots used)
                    {fbUsed > fbSlots && <span className="ml-1 text-amber-500">⚠ Over limit</span>}
                  </p>
                  {(() => {
                    const fbUnits = [...tfUnits.filter(x => !isFighter(x.template))].sort(tfSort);
                    if (fbUnits.length === 0) return <p className="text-xs italic text-gray-400">No ships in TF</p>;
                    const cols = '1.25rem 1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr';
                    return (
                      <>
                        <div className="grid gap-x-2 border-b border-gray-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500" style={{ gridTemplateColumns: cols }}>
                          <span />
                          <span>Unit</span>
                          <span className="text-right">DV</span>
                          <span className="text-right">AS</span>
                          <span className="text-right">AF</span>
                          <span className="text-right">CR</span>
                          <span className="pl-3">Traits</span>
                        </div>
                        {fbUnits.map(({ unit, template, state }) => {
                          const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                          return (
                            <label key={unit.id} className="grid cursor-pointer items-center gap-x-2 rounded py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50" style={{ gridTemplateColumns: cols }}>
                              <input
                                type="checkbox"
                                checked={state.formationBonus}
                                onChange={() => toggleFormationBonus(unit.id)}
                                disabled={!state.formationBonus && fbUsed >= fbSlots}
                                className="h-3 w-3 justify-self-center"
                              />
                              <div className="flex min-w-0 items-center gap-1">
                                <span className="truncate dark:text-gray-200">
                                  {unit.name || template.name}
                                  {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                  <UnitStatusBadges unit={unit} />
                                  {state.crippledInScenario && !unit.crippled && (
                                    <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                  )}
                                </span>
                                {state.isFlagship && <span className="shrink-0 text-yellow-500">★</span>}
                                {state.formationBonus && <span className="shrink-0 rounded px-1 py-0 text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">FB</span>}
                              </div>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{eff.dv}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.as === '-' ? '—' : eff.as}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : eff.af}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                              <span className="pl-3 text-gray-400 dark:text-gray-500">
                                {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                              </span>
                            </label>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>

                {/* Fighter Assignments */}
                {tfUnits.filter(x => isFighter(x.template)).length > 0 && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Fighter Assignments</p>
                    {(() => {
                      const fighters = [...tfUnits.filter(x => isFighter(x.template))].sort(tfSort);
                      const cols = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr 1fr';
                      return (
                        <>
                          <div className="grid gap-x-2 border-b border-gray-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500" style={{ gridTemplateColumns: cols }}>
                            <span>Unit</span>
                            <span className="text-right">DV</span>
                            <span className="text-right">AS</span>
                            <span className="text-right">AF</span>
                            <span className="text-right">CR</span>
                            <span className="pl-3">Traits</span>
                            <span>Assignment</span>
                          </div>
                          {fighters.map(({ unit, template, state }) => {
                            const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                            return (
                              <div key={unit.id} className="grid items-center gap-x-2 py-0.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: cols }}>
                                <span className="truncate dark:text-gray-200">
                                  {unit.name || template.name}
                                  {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                  <UnitStatusBadges unit={unit} />
                                  {state.crippledInScenario && !unit.crippled && (
                                    <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                  )}
                                </span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{eff.dv}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.as === '-' ? '—' : eff.as}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : eff.af}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                                <span className="pl-3 text-gray-400 dark:text-gray-500">
                                  {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                                </span>
                                <div className="flex gap-1">
                                  {(['antiShip', 'antiFighter', 'defense'] as FighterAssignment[]).map(asgn => (
                                    <button
                                      key={asgn}
                                      onClick={() => setFighterAssignment(unit.id, asgn)}
                                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                                        state.fighterAssignment === asgn
                                          ? 'bg-blue-500 text-white'
                                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                                      }`}
                                    >
                                      {asgn === 'antiShip' ? 'Anti-Ship' : asgn === 'antiFighter' ? 'Anti-Fighter' : 'Defense'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Special Abilities — Jammer / Disruptor targeting on opposite side */}
                {(jammerTotal > 0 || disruptorTotal > 0) && (
                  <div className="mb-4">
                    <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                      Special Abilities on {oppSide === 'attacker' ? 'Attacker' : 'Defender'}
                    </p>
                    {jammerTotal > 0 && (
                      <p className="mb-1 text-xs text-gray-600 dark:text-gray-300">
                        Jammer {jammerTotal}: mark {jammerTotal} enemy units Jammed ({jammedCount}/{jammerTotal} used)
                        {jammedCount > jammerTotal && <span className="ml-1 text-amber-500">⚠</span>}
                      </p>
                    )}
                    {disruptorTotal > 0 && (
                      <p className="mb-1 text-xs text-gray-600 dark:text-gray-300">
                        Disruptor {disruptorTotal}: mark {disruptorTotal} enemy units Disrupted ({disruptedCount}/{disruptorTotal} used)
                        {disruptedCount > disruptorTotal && <span className="ml-1 text-amber-500">⚠</span>}
                      </p>
                    )}
                    {(() => {
                      const oppFlagEmpire = getFlagshipEmpire(scenario, oppSide, players);
                      const sortedOppTFUnits = [...oppTFUnits].sort(tfSort);
                      const btnCols = [jammerTotal > 0 && '4.5rem', disruptorTotal > 0 && '4.5rem'].filter(Boolean).join(' ');
                      const cols = `1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr ${btnCols}`;
                      return (
                        <>
                          <div className="grid gap-x-2 border-b border-gray-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500" style={{ gridTemplateColumns: cols }}>
                            <span>Unit</span>
                            <span className="text-right">DV</span>
                            <span className="text-right">AS</span>
                            <span className="text-right">AF</span>
                            <span className="text-right">CR</span>
                            <span className="pl-3">Traits</span>
                            {jammerTotal > 0 && <span className="text-center">Jammed</span>}
                            {disruptorTotal > 0 && <span className="text-center">Disrupted</span>}
                          </div>
                          {sortedOppTFUnits.map(({ unit, template, state }) => {
                            const eff = computeEffectiveStats(unit, template, state, oppFlagEmpire);
                            return (
                              <div key={unit.id} className="grid items-center gap-x-2 rounded py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: cols }}>
                                <span className="truncate dark:text-gray-200">
                                  {unit.name || template.name}
                                  {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                  <UnitStatusBadges unit={unit} />
                                  {state.crippledInScenario && !unit.crippled && (
                                    <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                  )}
                                </span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{eff.dv}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.as === '-' ? '—' : eff.as}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.af === '-' ? '—' : eff.af}</span>
                                <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                                <span className="pl-3 text-gray-400 dark:text-gray-500">
                                  {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                                </span>
                                {jammerTotal > 0 && (
                                  <button
                                    onClick={() => toggleJammed(unit.id)}
                                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                                      state.jammed
                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                                    }`}
                                  >
                                    Jammed
                                  </button>
                                )}
                                {disruptorTotal > 0 && (
                                  <button
                                    onClick={() => toggleDisrupted(unit.id)}
                                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                                      state.disrupted
                                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400'
                                    }`}
                                  >
                                    Disrupted
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* EW Notes */}
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  <p className="font-medium mb-0.5">EW Notes</p>
                  {ewFlagshipChanged && <p className="text-amber-600 dark:text-amber-400">−1 (New Flagship)</p>}
                  {scoutSelf < scoutOpp && <p className="text-amber-600 dark:text-amber-400">−1 (Fewest Scouts)</p>}
                  {stealthSelf > stealthOpp && <p className="text-blue-600 dark:text-blue-400">+1 (Most Stealth Ships)</p>}
                  {!ewFlagshipChanged && scoutSelf >= scoutOpp && stealthSelf <= stealthOpp && <p className="italic text-gray-400">No EW bonuses</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'task_force' })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {unassignedFighterCount > 0 && (
            <span className="text-xs text-amber-500">
              ⚠ {unassignedFighterCount} fighter{unassignedFighterCount !== 1 ? 's' : ''} unassigned
            </span>
          )}
          <button
            onClick={() => onUpdate({ ...scenario, phase: 'fire_ff', subPhaseHits: { attacker: 0, defender: 0 } })}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            Begin Combat →
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FirePhaseView
// ---------------------------------------------------------------------------

type ActionDialog = {
  unitId: string;
  unitName: string;
  action: 'cripple' | 'destroy';
  firingSide: 'attacker' | 'defender';
  assignedCost: number;
  directedCost: number;
};

function FirePhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const subPhase = scenario.phase as 'fire_ff' | 'fire_sf' | 'fire_ss';

  const nextPhaseMap: Record<string, CombatScenarioPhase> = {
    fire_ff: 'fire_sf',
    fire_sf: 'fire_ss',
    fire_ss: 'special_ops',
  };

  const phaseTitle: Record<string, string> = {
    fire_ff: 'Fighter vs Fighter',
    fire_sf: 'Ship vs Fighter',
    fire_ss: 'Ship vs Ship',
  };

  const flagEmpireA = getFlagshipEmpire(scenario, 'attacker', players);
  const flagEmpireD = getFlagshipEmpire(scenario, 'defender', players);

  const getUnitsForSide = (side: 'attacker' | 'defender') => getSideUnits(scenario, side, players);

  // Eligible targets per sub-phase
  const getEligibleTargets = (
    side: 'attacker' | 'defender',
  ): ReturnType<typeof getSideUnits> => {
    const sideUnits = getUnitsForSide(side);
    // Only units in the Task Force can ever be targeted
    const inTF = sideUnits.filter(x => !x.state.destroyed && !x.state.exitedScenario && x.state.inTaskForce);
    if (subPhase === 'fire_ff') {
      // Fighters in the Task Force
      return inTF.filter(x => isFighter(x.template));
    } else if (subPhase === 'fire_sf') {
      // Anti-Ship fighters in the Task Force
      return inTF.filter(x => isFighter(x.template) && x.state.fighterAssignment === 'antiShip');
    } else {
      // Ships in the Task Force; defense fighters screen them
      return inTF.filter(x => !isFighter(x.template) || x.state.fighterAssignment === 'defense');
    }
  };

  const [actionDialog, setActionDialog] = useState<ActionDialog | null>(null);
  const [confirmingAdvance, setConfirmingAdvance] = useState(false);

  const setHits = (side: 'attacker' | 'defender', val: number) => {
    onUpdate({
      ...scenario,
      subPhaseHits: { ...scenario.subPhaseHits, [side]: val },
    });
  };

  const confirmAction = (dialog: ActionDialog, cost: number) => {
    const state = scenario.unitStates[dialog.unitId];
    const patch = dialog.action === 'cripple'
      ? { pendingCripple: { cost, firingSide: dialog.firingSide } }
      : { pendingDestroy: { cost, firingSide: dialog.firingSide } };
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [dialog.unitId]: { ...state, ...patch } },
      subPhaseHits: {
        ...scenario.subPhaseHits,
        [dialog.firingSide]: scenario.subPhaseHits[dialog.firingSide] - cost,
      },
    });
    setActionDialog(null);
  };

  const removePendingCripple = (unitId: string) => {
    const state = scenario.unitStates[unitId];
    if (!state.pendingCripple) return;
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [unitId]: { ...state, pendingCripple: null } },
      subPhaseHits: {
        ...scenario.subPhaseHits,
        [state.pendingCripple.firingSide]: scenario.subPhaseHits[state.pendingCripple.firingSide] + state.pendingCripple.cost,
      },
    });
  };

  const removePendingDestroy = (unitId: string) => {
    const state = scenario.unitStates[unitId];
    if (!state.pendingDestroy) return;
    onUpdate({
      ...scenario,
      unitStates: { ...scenario.unitStates, [unitId]: { ...state, pendingDestroy: null } },
      subPhaseHits: {
        ...scenario.subPhaseHits,
        [state.pendingDestroy.firingSide]: scenario.subPhaseHits[state.pendingDestroy.firingSide] + state.pendingDestroy.cost,
      },
    });
  };

  const remainingHitsA = scenario.subPhaseHits.attacker;
  const remainingHitsD = scenario.subPhaseHits.defender;
  const hasRemainingHits = remainingHitsA > 0 || remainingHitsD > 0;
  const hasNegativeHits = remainingHitsA < 0 || remainingHitsD < 0;

  const handleNext = () => {
    // Save snapshot before applying pending effects so Back can restore this state
    const newSnapshots = subPhase !== 'fire_ss'
      ? { ...(scenario.firePhaseSnapshots ?? {}), [subPhase]: { unitStates: scenario.unitStates, subPhaseHits: scenario.subPhaseHits } }
      : scenario.firePhaseSnapshots;

    const newStates = { ...scenario.unitStates };
    for (const id of Object.keys(newStates)) {
      const s = newStates[id];
      let updated = { ...s };
      if (s.pendingCripple) {
        updated = { ...updated, crippledInScenario: true, pendingCripple: null };
      }
      if (s.pendingDestroy) {
        updated = { ...updated, destroyed: true, pendingDestroy: null };
      }
      newStates[id] = updated;
    }
    onUpdate({
      ...scenario,
      unitStates: newStates,
      phase: nextPhaseMap[subPhase],
      subPhaseHits: { attacker: 0, defender: 0 },
      firePhaseSnapshots: newSnapshots,
    });
  };

  const handleBack = () => {
    if (subPhase === 'fire_sf' && scenario.firePhaseSnapshots?.fire_ff) {
      const { unitStates, subPhaseHits } = scenario.firePhaseSnapshots.fire_ff;
      onUpdate({ ...scenario, phase: 'fire_ff', unitStates, subPhaseHits });
    } else if (subPhase === 'fire_ss' && scenario.firePhaseSnapshots?.fire_sf) {
      const { unitStates, subPhaseHits } = scenario.firePhaseSnapshots.fire_sf;
      onUpdate({ ...scenario, phase: 'fire_sf', unitStates, subPhaseHits });
    } else {
      const prevPhase: CombatScenarioPhase = subPhase === 'fire_ff' ? 'assignments' : subPhase === 'fire_sf' ? 'fire_ff' : 'fire_sf';
      onUpdate({ ...scenario, phase: prevPhase, subPhaseHits: { attacker: 0, defender: 0 } });
    }
  };

  const attackerFlagEmpire = flagEmpireA;
  const defenderFlagEmpire = flagEmpireD;

  const getEffStats = (side: 'attacker' | 'defender') => {
    const units = getUnitsForSide(side);
    const tfUnits = units.filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
    const flagEmpire = side === 'attacker' ? attackerFlagEmpire : defenderFlagEmpire;
    let asTotal = 0, afTotal = 0;
    for (const { unit, template, state } of tfUnits) {
      const eff = computeEffectiveStats(unit, template, state, flagEmpire);
      if (subPhase === 'fire_ff') {
        if (isFighter(template) && state.fighterAssignment === 'antiFighter') {
          afTotal += eff.af;
        }
      } else if (subPhase === 'fire_sf') {
        if (!isFighter(template)) afTotal += eff.af;
        if (isFighter(template) && state.fighterAssignment === 'antiFighter') afTotal += eff.af;
      } else {
        if (!isFighter(template) || state.fighterAssignment === 'antiShip') {
          asTotal += eff.as;
        }
      }
    }
    return { asTotal, afTotal };
  };

  const { asTotal: asA, afTotal: afA } = getEffStats('attacker');
  const { asTotal: asD, afTotal: afD } = getEffStats('defender');

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex flex-col overflow-auto p-6">
        <div className="mb-4 shrink-0 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{phaseTitle[subPhase]}</span>
        </div>

        {/* Fire stats row */}
        <div className="mb-6 grid grid-cols-2 gap-4 flex-1 min-h-0">
          {(['attacker', 'defender'] as const).map(side => {
            const { asTotal, afTotal } = side === 'attacker' ? { asTotal: asA, afTotal: afA } : { asTotal: asD, afTotal: afD };
            const fireVal = subPhase === 'fire_ss' ? asTotal : afTotal;
            const fireLabel = subPhase === 'fire_ss' ? 'AS' : 'AF';

            // EW
            const oppSide: 'attacker' | 'defender' = side === 'attacker' ? 'defender' : 'attacker';
            const tmap = buildTemplateMap(players);
            const tfSide = getUnitsForSide(side).filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
            const tfOpp  = getUnitsForSide(oppSide).filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario);
            const scoutSelf   = computeFactorTotal(tfSide.map(x => x.unit), tmap, 'Scout');
            const scoutOpp    = computeFactorTotal(tfOpp.map(x => x.unit),  tmap, 'Scout');
            const stealthSelf = tfSide.filter(x => !x.unit.crippled && x.template.traits.some(t => t.name === 'Stealth')).length;
            const stealthOpp  = tfOpp.filter(x =>  !x.unit.crippled && x.template.traits.some(t => t.name === 'Stealth')).length;

            // Readiness
            const force = side === 'attacker' ? scenario.attackerForce : scenario.defenderForce;
            const readiness = force.readiness;
            const readinessCls = readiness > 0
              ? 'text-green-600 dark:text-green-400'
              : readiness < 0
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-600 dark:text-gray-300';

            return (
              <div key={side} className="rounded border border-gray-200 p-3 dark:border-gray-700 flex flex-col min-h-0">
                <p className="mb-2 shrink-0 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 capitalize">{side}</p>

                {/* Readiness + EW */}
                <div className="mb-2 shrink-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs border-b border-gray-100 pb-2 dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">
                    Readiness: <span className={`font-medium ${readinessCls}`}>{READINESS_LABELS[readiness]}</span>
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">
                    {scoutSelf < scoutOpp   && <span className="text-amber-600 dark:text-amber-400">−1 EW (Fewest Scouts)</span>}
                    {stealthSelf > stealthOpp && <span className="text-blue-600 dark:text-blue-400">+1 EW (Most Stealth)</span>}
                    {scoutSelf >= scoutOpp && stealthSelf <= stealthOpp && <span className="italic">No EW bonus</span>}
                  </span>
                </div>

                {/* Firing units */}
                {(() => {
                  const flagEmpire = side === 'attacker' ? flagEmpireA : flagEmpireD;
                  const firingUnits = tfSide.filter(({ template, state }) => {
                    if (subPhase === 'fire_ff') return isFighter(template) && state.fighterAssignment === 'antiFighter';
                    if (subPhase === 'fire_sf') return !isFighter(template) || state.fighterAssignment === 'antiFighter';
                    return !isFighter(template) || state.fighterAssignment === 'antiShip';
                  }).sort((a, b) => {
                    if (a.state.isFlagship) return -1;
                    if (b.state.isFlagship) return 1;
                    const aF = isFighter(a.template), bF = isFighter(b.template);
                    if (aF !== bF) return aF ? 1 : -1;
                    const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
                    const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
                    return bCR - aCR;
                  });
                  if (firingUnits.length === 0) return null;
                  const statLabel = subPhase === 'fire_ss' ? 'AS' : 'AF';
                  const fireCols = '1fr 2.5rem 2.5rem 2.5rem 1fr';
                  const hdrCls = 'grid gap-x-2 px-1 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500';
                  return (
                    <div className="mb-2 border-b border-gray-100 pb-2 dark:border-gray-800 flex-1 flex flex-col min-h-0">
                      <div className="flex-1 min-h-0 space-y-0.5 overflow-y-auto">
                        <div className={`${hdrCls} sticky top-0 z-10 bg-white dark:bg-gray-900`} style={{ gridTemplateColumns: fireCols }}>
                          <span>Unit</span>
                          <span className="text-right">DV</span>
                          <span className="text-right">{statLabel}</span>
                          <span className="text-right">CR</span>
                          <span className="pl-3">Traits</span>
                        </div>
                        {firingUnits.map(({ unit, template, state, player }) => {
                          const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                          const isCrippled = unit.crippled || !!state.crippledInScenario;
                          const hasGunship   = template.traits.some(t => t.name === 'Gunship');
                          const hasCarronade = template.traits.some(t => t.name === 'Carronade');
                          const isStatSubPhase = subPhase === 'fire_ss';
                          const statBase = isStatSubPhase ? template.as : template.af;
                          const statEffective = isStatSubPhase ? eff.as : eff.af;
                          const statBlockedByTrait = isCrippled && (isStatSubPhase ? hasGunship : hasCarronade);
                          return (
                            <div key={unit.id} className="grid items-center gap-x-2 rounded border border-gray-200 px-1 py-0.5 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: fireCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}>
                              <span className="min-w-0 truncate dark:text-gray-200">
                                {unit.name || template.name}
                                {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                                {state.isFlagship && <span className="ml-1 text-yellow-500">★</span>}
                                {(state.crippledInScenario && !unit.crippled) && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Crippled</span>}
                                {state.formationBonus && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">FB</span>}
                                {state.jammed && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Jammed</span>}
                                {state.disrupted && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Disrupted</span>}
                                {state.pendingCripple && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">⏳Cripple</span>}
                                {state.pendingDestroy && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300">⏳Destroy</span>}
                              </span>
                              <StatCell effective={eff.dv} base={template.dv} />
                              <StatCell effective={statEffective} base={statBase} isBlockedByTrait={statBlockedByTrait} />
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                              <span className="pl-3 text-gray-400 dark:text-gray-500">
                                {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                <p className="shrink-0 text-sm dark:text-gray-200">Total {fireLabel}: <span className="font-bold text-blue-600 dark:text-blue-300">{fireVal}</span></p>
                <div className="mt-2 shrink-0 flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Hits dealt:</label>
                  <input
                    type="number"
                    min="0"
                    value={scenario.subPhaseHits[side]}
                    onChange={e => setHits(side, parseInt(e.target.value) || 0)}
                    className="w-16 rounded border border-gray-300 px-2 py-0.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Damage allocation for each side's targets */}
        <div className="grid grid-cols-2 gap-4 flex-[2] min-h-0">
          {(['attacker', 'defender'] as const).map(firingSide => {
            const targetSide: 'attacker' | 'defender' = firingSide === 'attacker' ? 'defender' : 'attacker';
            const targets = getEligibleTargets(targetSide).sort((a, b) => {
              if (a.state.isFlagship) return -1;
              if (b.state.isFlagship) return 1;
              const aF = isFighter(a.template), bF = isFighter(b.template);
              if (aF !== bF) return aF ? 1 : -1;
              const aCR = a.template.cr === '-' ? -1 : Number(a.template.cr);
              const bCR = b.template.cr === '-' ? -1 : Number(b.template.cr);
              return bCR - aCR;
            });
            const hitsRemaining = scenario.subPhaseHits[firingSide];
            const targetFlagEmpire = targetSide === 'attacker' ? attackerFlagEmpire : defenderFlagEmpire;
            const hitsCols = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr 4.5rem';
            const hdrCls = 'grid gap-x-2 px-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500';

            return (
              <div key={firingSide} className="rounded border border-gray-200 p-3 dark:border-gray-700 flex flex-col min-h-0">
                <p className="mb-2 shrink-0 text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {firingSide === 'attacker' ? 'Attacker' : 'Defender'} firing at {targetSide}
                  {hitsRemaining > 0 && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">({hitsRemaining} hits remaining)</span>
                  )}
                </p>
                {targets.length === 0 ? (
                  <p className="text-xs italic text-gray-400">No eligible targets</p>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className={`${hdrCls} sticky top-0 z-10 bg-white dark:bg-gray-900`} style={{ gridTemplateColumns: hitsCols }}>
                      <span>Unit</span>
                      <span className="text-right">DV</span>
                      <span className="text-right">AS</span>
                      <span className="text-right">AF</span>
                      <span className="text-right">CR</span>
                      <span className="pl-3">Traits</span>
                      <span />
                    </div>
                    <div className="space-y-0.5">
                      {targets.map(({ unit, template, state, player }) => {
                        const eff = computeEffectiveStats(unit, template, state, targetFlagEmpire);
                        const isCiv = isCivilian(template);
                        const isCrippledAnywhere = unit.crippled || !!state.crippledInScenario || !!state.pendingCripple;
                        const hasPendingCripple = !!state.pendingCripple;
                        const hasPendingDestroy = !!state.pendingDestroy;
                        const isArmored = template.traits.some(t => t.name === 'Armored');
                        // Post-cripple DV for Destroy cost: if cripple is only pending (not yet applied),
                        // eff.dv is still full — halve manually. If already crippled, eff.dv is halved.
                        const destroyDV = (hasPendingCripple && !isArmored) ? Math.ceil(eff.dv * 0.5) : eff.dv;
                        const hasGunship   = template.traits.some(t => t.name === 'Gunship');
                        const hasCarronade = template.traits.some(t => t.name === 'Carronade');
                        // Visual stats: pending cripple is applied visually (does NOT affect tally)
                        const visualDV = hasPendingCripple && !isArmored ? Math.ceil(eff.dv * 0.5) : eff.dv;
                        const visualAS = hasPendingCripple && !hasGunship ? Math.ceil(eff.as * 0.5) : eff.as;
                        const visualAF = hasPendingCripple && !hasCarronade ? Math.ceil(eff.af * 0.5) : eff.af;
                        const dvBlockedByTrait = isCrippledAnywhere && isArmored && !unit.outOfSupply;
                        const asBlockedByTrait = isCrippledAnywhere && hasGunship;
                        const afBlockedByTrait = isCrippledAnywhere && hasCarronade;
                        return (
                          <div key={unit.id} className={`grid items-center gap-x-2 rounded border border-gray-200 px-2 py-1 text-xs dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default ${state.destroyed ? 'opacity-40' : ''}`} style={{ gridTemplateColumns: hitsCols, borderLeftColor: player.teamColor ?? '#9ca3af', borderLeftWidth: '4px' }}>
                            <span className="min-w-0 truncate dark:text-gray-200">
                              {unit.name || template.name}
                              {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                              {state.isFlagship && <span className="ml-1 text-yellow-500">★</span>}
                              <UnitStatusBadges unit={unit} />
                              {state.crippledInScenario && !unit.crippled && (
                                <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Crippled</span>
                              )}
                              {state.formationBonus && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">FB</span>}
                              {state.jammed && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Jammed</span>}
                              {state.disrupted && <span className="ml-1 rounded px-1 py-0 text-[9px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">Disrupted</span>}
                              {hasPendingCripple && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <span className="rounded px-1 py-0 text-[9px] bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">Cripple ({state.pendingCripple!.cost})</span>
                                  <button onClick={() => removePendingCripple(unit.id)} className="text-[10px] leading-none text-amber-500 hover:text-amber-700">×</button>
                                </span>
                              )}
                              {hasPendingDestroy && (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <span className="rounded px-1 py-0 text-[9px] bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300">Destroy ({state.pendingDestroy!.cost})</span>
                                  <button onClick={() => removePendingDestroy(unit.id)} className="text-[10px] leading-none text-red-500 hover:text-red-700">×</button>
                                </span>
                              )}
                              {state.destroyed && <span className="ml-1 text-red-500">✗</span>}
                            </span>
                            <StatCell effective={visualDV} base={template.dv} isBlockedByTrait={dvBlockedByTrait} />
                            <StatCell effective={visualAS} base={template.as} isBlockedByTrait={asBlockedByTrait} />
                            <StatCell effective={visualAF} base={template.af} isBlockedByTrait={afBlockedByTrait} />
                            <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                            <span className="pl-3 text-gray-400 dark:text-gray-500">
                              {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                            </span>
                            {/* Single action button: Civilians go straight to Destroy; others Cripple → Destroy */}
                            {!state.destroyed && !hasPendingDestroy ? (
                              isCiv ? (
                                <button
                                  onClick={() => setActionDialog({ unitId: unit.id, unitName: unit.name || template.name, action: 'destroy', firingSide: firingSide, assignedCost: destroyDV, directedCost: destroyDV * 2 })}
                                  className="rounded px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                >Destroy</button>
                              ) : isCrippledAnywhere ? (
                                <button
                                  onClick={() => setActionDialog({ unitId: unit.id, unitName: unit.name || template.name, action: 'destroy', firingSide: firingSide, assignedCost: destroyDV, directedCost: destroyDV * 2 })}
                                  className="rounded px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
                                >Destroy</button>
                              ) : (
                                <button
                                  onClick={() => setActionDialog({ unitId: unit.id, unitName: unit.name || template.name, action: 'cripple', firingSide: firingSide, assignedCost: eff.dv, directedCost: eff.dv * 2 })}
                                  className="rounded px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                                >Cripple</button>
                              )
                            ) : <span />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={handleBack}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {hasNegativeHits && (
            <span className="text-xs text-red-500">
              ⚠ Hits are over budget
              {remainingHitsA < 0 && ` (Attacker: ${remainingHitsA})`}
              {remainingHitsD < 0 && ` (Defender: ${remainingHitsD})`}
            </span>
          )}
          {!hasNegativeHits && hasRemainingHits && (
            <span className="text-xs text-amber-500">⚠ {remainingHitsA + remainingHitsD} hits unallocated</span>
          )}
          {confirmingAdvance ? (
            <>
              <span className="text-xs text-red-500">Advance with negative hits?</span>
              <button
                onClick={() => { setConfirmingAdvance(false); handleNext(); }}
                className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
              >
                Confirm →
              </button>
              <button
                onClick={() => setConfirmingAdvance(false)}
                className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => { if (hasNegativeHits) { setConfirmingAdvance(true); } else { handleNext(); } }}
              className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
            >
              Next Sub-phase →
            </button>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {actionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
              {actionDialog.action === 'cripple' ? 'Cripple Unit?' : 'Destroy Unit?'}
            </h3>
            <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{actionDialog.unitName}</p>
            <p className="mb-3 text-xs font-medium text-gray-600 dark:text-gray-300">Choose hit cost method:</p>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => confirmAction(actionDialog, actionDialog.assignedCost)}
                className="flex-1 rounded border border-gray-200 px-3 py-2.5 text-left text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <div className="font-semibold text-gray-700 dark:text-gray-200">Assigned</div>
                <div className="text-gray-400">{actionDialog.assignedCost} hits</div>
              </button>
              <button
                onClick={() => confirmAction(actionDialog, actionDialog.directedCost)}
                className="flex-1 rounded border border-gray-200 px-3 py-2.5 text-left text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <div className="font-semibold text-gray-700 dark:text-gray-200">Directed</div>
                <div className="text-gray-400">{actionDialog.directedCost} hits</div>
              </button>
            </div>
            <button
              onClick={() => setActionDialog(null)}
              className="w-full rounded px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TFUnitList — shared fire-phase-style task-force unit list
// ---------------------------------------------------------------------------

const TF_COLS = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr';

function TFUnitList({
  scenario,
  players,
  side,
  heightClass = 'h-36',
  showAll = false,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  side: 'attacker' | 'defender';
  heightClass?: string;
  showAll?: boolean;
}) {
  const sideUnits = getSideUnits(scenario, side, players);
  const tfUnits = sideUnits.filter(x => (showAll ? true : x.state.inTaskForce) && !x.state.destroyed && !x.state.exitedScenario);
  const flagEmpire = getFlagshipEmpire(scenario, side, players);

  const playerGroups: { player: CampaignPlayer; units: typeof tfUnits }[] = [];
  for (const item of tfUnits) {
    const g = playerGroups.find(g => g.player.id === item.player.id);
    if (g) g.units.push(item); else playerGroups.push({ player: item.player, units: [item] });
  }

  if (tfUnits.length === 0) return <p className="text-xs italic text-gray-400 dark:text-gray-500">No units in Task Force</p>;

  return (
    <div className={`${heightClass} overflow-y-auto`}>
      <div className="grid h-5 items-center gap-x-2 border-b border-gray-200 text-[10px] font-medium uppercase tracking-wide text-gray-400 sticky top-0 z-20 bg-white dark:border-gray-700 dark:text-gray-500 dark:bg-gray-900" style={{ gridTemplateColumns: TF_COLS }}>
        <span>Unit</span>
        <span className="text-right">DV</span>
        <span className="text-right">AS</span>
        <span className="text-right">AF</span>
        <span className="text-right">CR</span>
        <span className="pl-3">Traits</span>
      </div>
      <div className="space-y-0.5">
        {playerGroups.map(({ player, units }) => (
          <div key={player.id}>
            <p className="text-[10px] font-semibold text-gray-400 sticky top-5 z-10 bg-white py-0.5 dark:bg-gray-900 dark:text-gray-500">
              {player.name} <span className="font-normal">({player.empire.name})</span>
            </p>
            {units.map(({ unit, template, state }) => {
              const eff = computeEffectiveStats(unit, template, state, flagEmpire);
              const isCrippled = unit.crippled || !!state.crippledInScenario;
              const isOOS = unit.outOfSupply;
              const hasArmored   = template.traits.some(t => t.name === 'Armored');
              const hasGunship   = template.traits.some(t => t.name === 'Gunship');
              const hasCarronade = template.traits.some(t => t.name === 'Carronade');
              const dvBlockedByTrait = isCrippled && hasArmored && !isOOS;
              const asBlockedByTrait = isCrippled && hasGunship;
              const afBlockedByTrait = isCrippled && hasCarronade;
              return (
                <div key={unit.id} className="grid items-center gap-x-2 py-0.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: TF_COLS }}>
                  <span className="truncate dark:text-gray-200">
                    {state.isFlagship && <span className="mr-1 text-yellow-500">★</span>}
                    {unit.name || template.name}
                    {template.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({template.hullCode})</span>}
                    <UnitStatusBadges unit={unit} />
                    {state.crippledInScenario && !unit.crippled && (
                      <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                    )}
                    {state.capturedBySide && !unit.captured && (
                      <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">CAP</span>
                    )}
                  </span>
                  <StatCell effective={eff.dv} base={template.dv} isBlockedByTrait={dvBlockedByTrait} />
                  <StatCell effective={eff.as} base={template.as} isBlockedByTrait={asBlockedByTrait} />
                  <StatCell effective={eff.af} base={template.af} isBlockedByTrait={afBlockedByTrait} />
                  <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{template.cr === '-' ? '—' : String(template.cr)}</span>
                  <span className="pl-3 text-gray-400 dark:text-gray-500">
                    {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpecialOpsPhaseView
// ---------------------------------------------------------------------------

function SpecialOpsPhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  // captureTarget.unitId: '' = showing list, non-empty = pending confirmation
  const [captureTarget, setCaptureTarget] = useState<{
    side: 'attacker' | 'defender';
    unitId: string;         // '' = showing list, non-empty = confirming
    awardedToPlayerId: string;
    awardedToFleetId: string;  // '' = Untasked
  } | null>(null);

  const tmap = buildTemplateMap(players);

  const getAssaultFactors = (side: 'attacker' | 'defender') => {
    const sideUnits = getSideUnits(scenario, side, players);
    const activeUnits = sideUnits
      .filter(x => x.state.inTaskForce && !x.state.destroyed && !x.state.exitedScenario)
      .filter(x => isShip(x.template) || isBase(x.template))
      .map(x => x.unit);
    return computeFactorTotal(activeUnits, tmap, 'Assault');
  };

  const getDestroyedTargets = (targetSide: 'attacker' | 'defender') => {
    const sideUnits = getSideUnits(scenario, targetSide, players);
    return sideUnits.filter(x =>
      x.state.destroyed &&
      !x.state.capturedBySide &&
      (isShip(x.template) || isBase(x.template))
    );
  };

  const handleCapture = (
    capturingSide: 'attacker' | 'defender',
    targetUnitId: string,
    awardedToPlayerId: string,
    awardedToFleetId: string | null,
  ) => {
    const capturedBySideKey = capturingSide === 'attacker' ? 'attackerCapturedThisTurn' : 'defenderCapturedThisTurn';
    onUpdate({
      ...scenario,
      [capturedBySideKey]: true,
      unitStates: {
        ...scenario.unitStates,
        [targetUnitId]: {
          ...scenario.unitStates[targetUnitId],
          capturedBySide: capturingSide,
          side: capturingSide,       // fights for capturing side from now on
          destroyed: false,         // no longer destroyed — now captured
          crippledInScenario: true, // captured units are always crippled
          inTaskForce: false,       // must be manually added to task force
        },
      },
      capturedUnits: [
        ...scenario.capturedUnits.filter(c => c.unitId !== targetUnitId),
        { unitId: targetUnitId, awardedToPlayerId, awardedToFleetId: awardedToFleetId || null },
      ],
    });
    setCaptureTarget(null);
  };

  const captureCols = '1fr 2.5rem 2.5rem 2.5rem 2.5rem 1fr';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Special Operations</span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {(['attacker', 'defender'] as const).map(side => {
            const assaultFactors = getAssaultFactors(side);
            const oppSide: 'attacker' | 'defender' = side === 'attacker' ? 'defender' : 'attacker';
            const destroyedTargets = getDestroyedTargets(oppSide);
            const alreadyCaptured = side === 'attacker' ? scenario.attackerCapturedThisTurn : scenario.defenderCapturedThisTurn;
            const flagEmpire = getFlagshipEmpire(scenario, oppSide, players);

            // Pending confirmation: find the unit being confirmed
            const confirmingUnitId = captureTarget?.side === side && captureTarget.unitId ? captureTarget.unitId : null;
            const confirmingUnit = confirmingUnitId
              ? destroyedTargets.find(x => x.unit.id === confirmingUnitId)
              : null;

            // Players on this (capturing) side
            const capturingForce = side === 'attacker' ? scenario.attackerForce : scenario.defenderForce;
            const capturingSidePlayers = [capturingForce.primaryPlayerId, ...capturingForce.alliedPlayerIds]
              .filter(Boolean).map(id => players.find(p => p.id === id)).filter(Boolean) as CampaignPlayer[];
            // Fleets for the currently-selected awarding player at this system
            const selectedAwardPlayer = captureTarget?.side === side
              ? players.find(p => p.id === captureTarget.awardedToPlayerId) ?? capturingSidePlayers[0] ?? null
              : null;
            const awardPlayerFleets = selectedAwardPlayer
              ? (selectedAwardPlayer.fleets ?? []).filter(f => f.systemId === scenario.systemId)
              : [];

            return (
              <div key={side}>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side}</h3>

                {/* Task Force unit list */}
                <div className="mb-3 rounded border border-gray-200 p-2 dark:border-gray-700">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Task Force</p>
                  <TFUnitList scenario={scenario} players={players} side={side} heightClass="h-36" />
                </div>

                {/* Captured units on this side */}
                {(() => {
                  const capturedUnits = getSideUnits(scenario, side, players).filter(x => x.state.capturedBySide === side && !x.state.destroyed && !x.state.exitedScenario);
                  if (capturedUnits.length === 0) return null;
                  const capFlagEmpire = getFlagshipEmpire(scenario, side, players);
                  // Group by player
                  const capPlayerGroups: { player: CampaignPlayer; units: typeof capturedUnits }[] = [];
                  for (const item of capturedUnits) {
                    const g = capPlayerGroups.find(g => g.player.id === item.player.id);
                    if (g) g.units.push(item); else capPlayerGroups.push({ player: item.player, units: [item] });
                  }
                  return (
                    <div className="mb-3 rounded border border-purple-200 p-2 dark:border-purple-800">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-400">Captured</p>
                      <div className="grid gap-x-2 border-b border-purple-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-400 dark:border-purple-800 dark:text-purple-500" style={{ gridTemplateColumns: TF_COLS }}>
                        <span>Unit</span>
                        <span className="text-right">DV</span>
                        <span className="text-right">AS</span>
                        <span className="text-right">AF</span>
                        <span className="text-right">CR</span>
                        <span className="pl-3">Traits</span>
                      </div>
                      {capPlayerGroups.map(({ player, units }) => (
                        <div key={player.id}>
                          <p className="pt-0.5 text-[10px] font-semibold text-purple-400 dark:text-purple-500">
                            {player.name} <span className="font-normal">({player.empire.name})</span>
                          </p>
                          {units.map(({ unit, template, state }) => {
                            const eff = computeEffectiveStats(unit, template, state, capFlagEmpire);
                            const isCrippled = unit.crippled || !!state.crippledInScenario;
                            const isOOS = unit.outOfSupply;
                            const hasArmored   = template.traits.some(t => t.name === 'Armored');
                            const hasGunship   = template.traits.some(t => t.name === 'Gunship');
                            const hasCarronade = template.traits.some(t => t.name === 'Carronade');
                            const dvBlockedByTrait = isCrippled && hasArmored && !isOOS;
                            const asBlockedByTrait = isCrippled && hasGunship;
                            const afBlockedByTrait = isCrippled && hasCarronade;
                            const statCls = 'text-right tabular-nums text-purple-600 dark:text-purple-400';
                            return (
                              <div key={unit.id} className="grid items-center gap-x-2 py-0.5 text-xs rounded hover:bg-purple-50 dark:hover:bg-purple-900/20 cursor-default" style={{ gridTemplateColumns: TF_COLS }}>
                                <span className="truncate text-purple-700 dark:text-purple-300">
                                  {unit.name || template.name}
                                  {template.hullCode !== 'N/A' && <span className="ml-1 text-purple-400">({template.hullCode})</span>}
                                  <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>
                                  <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">CAP</span>
                                </span>
                                <StatCell effective={eff.dv} base={template.dv} isBlockedByTrait={dvBlockedByTrait} cls={statCls} />
                                <StatCell effective={eff.as} base={template.as} isBlockedByTrait={asBlockedByTrait} cls={statCls} />
                                <StatCell effective={eff.af} base={template.af} isBlockedByTrait={afBlockedByTrait} cls={statCls} />
                                <span className="text-right tabular-nums text-purple-500 dark:text-purple-500">{template.cr === '-' ? '—' : String(template.cr)}</span>
                                <span className="pl-3 text-purple-400 dark:text-purple-600">
                                  {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
                  Assault Factors: <span className="font-semibold">{assaultFactors}</span>
                </p>

                {assaultFactors > 0 && !alreadyCaptured && destroyedTargets.length > 0 && captureTarget?.side !== side && (
                  <button
                    onClick={() => setCaptureTarget({ side, unitId: '', awardedToPlayerId: '', awardedToFleetId: '' })}
                    className="mb-2 rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700"
                  >
                    Capture a Destroyed Ship/Base
                  </button>
                )}
                {alreadyCaptured && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">⚠ Already captured a unit this turn</p>
                )}
                {assaultFactors === 0 && (
                  <p className="text-xs italic text-gray-400 dark:text-gray-500">No Assault Factors</p>
                )}
                {destroyedTargets.length === 0 && assaultFactors > 0 && (
                  <p className="text-xs italic text-gray-400 dark:text-gray-500">No destroyed enemy Ships/Bases to capture</p>
                )}

                {/* Capture selection panel */}
                {captureTarget?.side === side && !confirmingUnit && (
                  <div className="mt-2 rounded border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950/20">
                    <p className="mb-2 text-xs font-medium text-purple-700 dark:text-purple-300">Select unit to capture:</p>
                    {/* Header */}
                    <div className="grid gap-x-2 border-b border-purple-200 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-400 dark:border-purple-800 dark:text-purple-500" style={{ gridTemplateColumns: captureCols }}>
                      <span>Unit</span>
                      <span className="text-right">DV</span>
                      <span className="text-right">AS</span>
                      <span className="text-right">AF</span>
                      <span className="text-right">CR</span>
                      <span className="pl-3">Traits</span>
                    </div>
                    <div className="mt-0.5 space-y-0.5">
                      {destroyedTargets.map(({ unit, template, state }) => {
                        const eff = computeEffectiveStats(unit, template, state, flagEmpire);
                        return (
                          <button
                            key={unit.id}
                            onClick={() => {
                              const defPlayer = capturingSidePlayers[0];
                              const defFleets = defPlayer ? (defPlayer.fleets ?? []).filter(f => f.systemId === scenario.systemId) : [];
                              setCaptureTarget({ side, unitId: unit.id, awardedToPlayerId: defPlayer?.id ?? '', awardedToFleetId: defFleets.length === 1 ? defFleets[0].id : '' });
                            }}
                            className="grid w-full items-center gap-x-2 rounded border border-purple-200 px-2 py-1 text-left text-xs text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/30"
                            style={{ gridTemplateColumns: captureCols }}
                          >
                            <span className="truncate">
                              {unit.name || template.name}
                              {template.hullCode !== 'N/A' && <span className="ml-1 opacity-60">({template.hullCode})</span>}
                            </span>
                            <span className="text-right tabular-nums">{eff.dv}</span>
                            <span className="text-right tabular-nums">{template.as === '-' ? '—' : eff.as}</span>
                            <span className="text-right tabular-nums">{template.af === '-' ? '—' : eff.af}</span>
                            <span className="text-right tabular-nums">{template.cr === '-' ? '—' : String(template.cr)}</span>
                            <span className="pl-3 opacity-70">
                              {template.traits.map((tr, i) => <span key={i}>{i > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setCaptureTarget(null)}
                      className="mt-2 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Capture confirmation */}
                {confirmingUnit && captureTarget && (
                  <div className="mt-2 rounded border border-purple-300 bg-purple-50 p-3 dark:border-purple-700 dark:bg-purple-950/30">
                    <p className="mb-2 text-xs font-semibold text-purple-800 dark:text-purple-200">
                      Capture <span className="font-bold">{confirmingUnit.unit.name || confirmingUnit.template.name}</span>?
                    </p>
                    <p className="mb-2 text-xs text-purple-700 dark:text-purple-300">
                      It will be transferred to your side and marked as Crippled + Captured.
                    </p>
                    {/* Player assignment */}
                    {capturingSidePlayers.length > 1 && (
                      <div className="mb-2">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-purple-500 dark:text-purple-400">Assign to Player</label>
                        <select
                          value={captureTarget.awardedToPlayerId}
                          onChange={e => {
                            const newPlayer = players.find(p => p.id === e.target.value);
                            const newFleets = newPlayer ? (newPlayer.fleets ?? []).filter(f => f.systemId === scenario.systemId) : [];
                            setCaptureTarget({ ...captureTarget, awardedToPlayerId: e.target.value, awardedToFleetId: newFleets.length === 1 ? newFleets[0].id : '' });
                          }}
                          className="w-full rounded border border-purple-300 px-2 py-1 text-xs dark:border-purple-700 dark:bg-gray-800 dark:text-gray-100"
                        >
                          {capturingSidePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                    {/* Fleet assignment */}
                    {awardPlayerFleets.length > 1 && (
                      <div className="mb-2">
                        <label className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-purple-500 dark:text-purple-400">Assign to Fleet</label>
                        <select
                          value={captureTarget.awardedToFleetId}
                          onChange={e => setCaptureTarget({ ...captureTarget, awardedToFleetId: e.target.value })}
                          className="w-full rounded border border-purple-300 px-2 py-1 text-xs dark:border-purple-700 dark:bg-gray-800 dark:text-gray-100"
                        >
                          <option value="">Untasked</option>
                          {awardPlayerFleets.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleCapture(side, confirmingUnit.unit.id, captureTarget.awardedToPlayerId, captureTarget.awardedToFleetId || null)}
                        disabled={!captureTarget.awardedToPlayerId}
                        className="rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700 disabled:opacity-40"
                      >
                        Confirm Capture
                      </button>
                      <button
                        onClick={() => setCaptureTarget({ side, unitId: '', awardedToPlayerId: '', awardedToFleetId: '' })}
                        className="rounded px-3 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'fire_ss', subPhaseHits: { attacker: 0, defender: 0 } })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'retreat' })}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RetreatPhaseView
// ---------------------------------------------------------------------------

function RetreatPhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  const [attackerRetreats, setAttackerRetreats] = useState(false);
  const [defenderRetreats, setDefenderRetreats] = useState(false);

  const updateRetreatNote = (side: 'attacker' | 'defender', note: string) => {
    const forceKey = side === 'attacker' ? 'attackerForce' : 'defenderForce';
    onUpdate({ ...scenario, [forceKey]: { ...scenario[forceKey], retreatMovementNote: note } });
  };

  const getRetreatLabels = (side: 'attacker' | 'defender') => {
    const labels: string[] = [];
    const sideUnits = getSideUnits(scenario, side, players);
    const tfUnits = sideUnits.filter(x => x.state.inTaskForce && !x.state.destroyed);

    const allFast = tfUnits.length > 0 && tfUnits.every(x => !isCivilian(x.template) && x.template.traits.some(t => t.name === 'Fast'));
    const flagEmpire = getFlagshipEmpire(scenario, side, players);
    const hasFastDriveSystems = !!flagEmpire?.advantages.includes('Fast Drive Systems');
    if (allFast || hasFastDriveSystems) labels.push('Fast (+2)');

    const hasConvoy = tfUnits.some(x => x.template.traits.some(t => t.name === 'Convoy' || x.unit.name.toLowerCase().includes('convoy')));
    if (hasConvoy) labels.push('Convoy (−2)');

    if (scenario.scenarioType === 'pursuit' && side === 'defender') labels.push('Pursuit Defender (+2)');

    return labels;
  };

  const attackerLabels = getRetreatLabels('attacker');
  const defenderLabels = getRetreatLabels('defender');

  const handleConfirmRetreat = () => {
    // Check for remaining bases / unattached fighters / ABs
    const handleUnitExits = () => {
      const newStates = { ...scenario.unitStates };
      let anyExited = false;
      for (const state of Object.values(newStates)) {
        if (state.destroyed || state.exitedScenario || state.capturedBySide) continue;
        const sideUnits = getSideUnits(scenario, state.side, players);
        const unitInfo = sideUnits.find(x => x.unit.id === state.unitId);
        if (!unitInfo) continue;
        const { template, unit } = unitInfo;
        const isRetreating = state.side === 'attacker' ? attackerRetreats : defenderRetreats;
        if (!isRetreating) continue;
        const isBase = template.category === 'Bases';
        const isUnattachedFighter = isFighter(template) && !unit.carriedById;
        const isUnattachedAB = template.hullCode === 'AB' && !unit.carriedById;
        if (isBase || isUnattachedFighter || isUnattachedAB) {
          newStates[state.unitId] = { ...state, exitedScenario: true, inTaskForce: false };
          anyExited = true;
        }
      }
      return { newStates, anyExited };
    };

    const { newStates, anyExited: _anyExited } = handleUnitExits();

    // Determine victor
    const attackerAllDestroyed = Object.values(newStates).filter(s => s.side === 'attacker').every(s => s.destroyed || s.exitedScenario || s.capturedBySide);
    const defenderAllDestroyed = Object.values(newStates).filter(s => s.side === 'defender').every(s => s.destroyed || s.exitedScenario || s.capturedBySide);

    let winner: CombatScenario['winner'] = null;
    let nextPhase: CombatScenarioPhase = 'recovery';

    if (attackerAllDestroyed && defenderAllDestroyed) {
      winner = 'mutual_retreat';
      nextPhase = 'resolved';
    } else if (attackerAllDestroyed) {
      winner = 'defender';
      nextPhase = 'resolved';
    } else if (defenderAllDestroyed) {
      winner = 'attacker';
      nextPhase = 'resolved';
    } else if (attackerRetreats && defenderRetreats) {
      winner = 'mutual_retreat';
      nextPhase = 'resolved';
    } else if (attackerRetreats && !defenderRetreats) {
      winner = 'defender';
      nextPhase = 'resolved';
    } else if (defenderRetreats && !attackerRetreats) {
      winner = 'attacker';
      nextPhase = 'resolved';
    }

    onUpdate({
      ...scenario,
      unitStates: newStates,
      winner,
      resolvedAt: nextPhase === 'resolved' ? new Date().toISOString() : null,
      phase: nextPhase,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Retreat Phase</span>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {(['attacker', 'defender'] as const).map(side => {
            const isAttacker = side === 'attacker';
            const retreats = isAttacker ? attackerRetreats : defenderRetreats;
            const setRetreats = isAttacker ? setAttackerRetreats : setDefenderRetreats;
            const labels = isAttacker ? attackerLabels : defenderLabels;
            const retreatMovementNote = isAttacker ? scenario.attackerForce.retreatMovementNote : scenario.defenderForce.retreatMovementNote;

            const sideUnits = getSideUnits(scenario, side, players);
            const isWiped = sideUnits.length > 0 && sideUnits.every(x => x.state.destroyed || x.state.exitedScenario || x.state.capturedBySide !== null);

            return (
              <div key={side}>
                {isWiped && (
                  <span className="mb-1 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    Wiped Out
                  </span>
                )}
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side}</h3>

                {/* All units in battle */}
                <div className="mb-3 rounded border border-gray-200 p-2 dark:border-gray-700">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">Units</p>
                  <TFUnitList scenario={scenario} players={players} side={side} heightClass="h-36" showAll />
                </div>

                {/* Retreat modifier badges */}
                {labels.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {labels.map(l => (
                      <span key={l} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{l}</span>
                    ))}
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm dark:text-gray-200">
                  <input type="checkbox" checked={retreats} onChange={e => setRetreats(e.target.checked)} className="h-4 w-4" />
                  Retreat
                </label>
                {retreats && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-500 dark:text-gray-400">Movement Orders (optional)</label>
                    <textarea
                      value={retreatMovementNote}
                      onChange={e => updateRetreatNote(side, e.target.value)}
                      rows={3}
                      className="mt-1 w-full resize-none rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      placeholder="Where are you retreating to?"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'special_ops' })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={handleConfirmRetreat}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Confirm →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RecoveryPhaseView
// ---------------------------------------------------------------------------

function RecoveryPhaseView({
  scenario,
  players,
  onUpdate,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onUpdate: (s: CombatScenario) => void;
}) {
  // Scenario view with only living units so ForceLineup counts are accurate
  const livingScenario = useMemo((): CombatScenario => ({
    ...scenario,
    unitStates: Object.fromEntries(
      Object.entries(scenario.unitStates).filter(([, s]) => !s.destroyed && !s.exitedScenario)
    ),
  }), [scenario]);

  const handleNextTurn = () => {
    const newStates = { ...scenario.unitStates };
    for (const [, state] of Object.entries(newStates)) {
      if (!state.destroyed && !state.exitedScenario) {
        newStates[state.unitId] = {
          ...state,
          isFlagship: false,
          formationBonus: false,
          disrupted: false,
          jammed: false,
          fighterAssignment: null,
          inTaskForce: false,
        };
      }
    }
    // Auto-restore previous flagships (they always auto-join TF)
    for (const prevFsId of [scenario.prevAttackerFlagshipId, scenario.prevDefenderFlagshipId]) {
      if (prevFsId && newStates[prevFsId] && !newStates[prevFsId].destroyed && !newStates[prevFsId].exitedScenario) {
        newStates[prevFsId] = { ...newStates[prevFsId], isFlagship: true, inTaskForce: true };
      }
    }
    onUpdate({
      ...scenario,
      phase: 'flagship',
      unitStates: newStates,
      attackerCapturedThisTurn: false,
      defenderCapturedThisTurn: false,
      subPhaseHits: { attacker: 0, defender: 0 },
      turnNumber: scenario.turnNumber + 1,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-6">
        {/* Header */}
        <div className="mb-1 flex items-center gap-3">
          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            End of Combat Turn {scenario.turnNumber}
          </span>
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Recovery Phase</span>
        </div>
        <p className="mb-5 text-xs text-gray-500 dark:text-gray-400">
          Clearing: Flagship · Formation Bonus · Disrupted · Jammed · Fighter Assignments.
          Select Flagship and adjust Task Force for Turn {scenario.turnNumber + 1}.
        </p>

        {/* Force lineups — same two-column layout as Setup Phase */}
        <div className="flex gap-6">
          {(['attacker', 'defender'] as const).map(side => {
            const sideUnits = getSideUnits(scenario, side, players);
            const livingUnits = sideUnits.filter(x => !x.state.destroyed && !x.state.exitedScenario);
            const allCivilian = livingUnits.length > 0 && livingUnits.every(x => isCivilian(x.template));
            const onlyCaptures = livingUnits.length > 0 && livingUnits.every(x => !!x.unit.captured);

            return (
              <div key={side} className="flex-1">
                <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                  <ForceLineup
                    label={`${side.charAt(0).toUpperCase() + side.slice(1)} Units`}
                    scenario={livingScenario}
                    side={side}
                    players={players}
                  />
                  {allCivilian && (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                      Only Civilian units remaining — opposing force may capture them.
                    </p>
                  )}
                  {onlyCaptures && (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
                      All remaining units are captured.
                    </p>
                  )}
                  {!allCivilian && !onlyCaptures && livingUnits.length === 0 && (
                    <p className="mt-2 text-xs italic text-gray-400 dark:text-gray-500">No units remaining.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={() => onUpdate({ ...scenario, phase: 'retreat' })}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← Back
        </button>
        <button
          onClick={handleNextTurn}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Select Flagship for Turn {scenario.turnNumber + 1} →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResolutionView
// ---------------------------------------------------------------------------

function ResolutionView({
  scenario,
  players,
  onClose,
  onApply,
}: {
  scenario: CombatScenario;
  players: CampaignPlayer[];
  onClose: () => void;
  onApply: () => void;
}) {
  const capturedCount = Object.values(scenario.unitStates).filter(s => s.capturedBySide !== null && !s.destroyed).length;
  const winnerLabel = scenario.winner === 'attacker' ? 'Attacker wins' :
    scenario.winner === 'defender' ? 'Defender wins' :
    scenario.winner === 'mutual_retreat' ? 'Mutual Retreat' : 'Undetermined';

  const destroyedCount = Object.values(scenario.unitStates).filter(s => s.destroyed && !s.capturedBySide).length;
  const crippledCount = Object.values(scenario.unitStates).filter(s => s.crippledInScenario && !s.destroyed).length;

  // Use the pre-battle player snapshot when available so that destroyed/transferred
  // units still appear in the tally even after Apply Results has removed them.
  const playersForTally: CampaignPlayer[] = scenario.scenarioStartPlayersSnapshot
    ? Object.values(scenario.scenarioStartPlayersSnapshot)
    : players;
  const tmap = buildTemplateMap(playersForTally);
  const allUnits = playersForTally.flatMap(p => p.units);
  const snapshot = scenario.initialUnitSnapshot ?? {};

  // Build outcome tally per side
  const buildTally = (side: 'attacker' | 'defender') => {
    const sideStates = Object.values(scenario.unitStates).filter(s => {
      if (s.capturedBySide) {
        const originalSide = s.capturedBySide === 'attacker' ? 'defender' : 'attacker';
        return originalSide === side;
      }
      return s.side === side;
    });
    type TallyGroup = {
      templateId: string;
      templateName: string;
      hullCode: string;
      wasStrategicallyCrippled: boolean;
      count: number;
      destroyed: number;
      crippled: number;
      captured: number;
    };
    // Group by player, then by template within each player
    const playerGroupMap = new Map<string, { player: CampaignPlayer; groups: Map<string, TallyGroup> }>();
    for (const state of sideStates) {
      const unit = allUnits.find(u => u.id === state.unitId);
      if (!unit) continue;
      const template = tmap.get(unit.unitTemplateId);
      if (!template) continue;
      const player = playersForTally.find(p => p.id === state.playerId);
      if (!player) continue;
      if (!playerGroupMap.has(state.playerId)) {
        playerGroupMap.set(state.playerId, { player, groups: new Map() });
      }
      const pg = playerGroupMap.get(state.playerId)!;
      const wasCrippled = snapshot[state.unitId]?.wasStrategicallyCrippled ?? unit.crippled;
      const key = `${unit.unitTemplateId}|${wasCrippled}`;
      if (!pg.groups.has(key)) {
        pg.groups.set(key, {
          templateId: unit.unitTemplateId,
          templateName: unit.name || template.name,
          hullCode: template.hullCode,
          wasStrategicallyCrippled: wasCrippled,
          count: 0, destroyed: 0, crippled: 0, captured: 0,
        });
      }
      const g = pg.groups.get(key)!;
      g.count++;
      if (state.capturedBySide !== null && !state.destroyed) {
        g.captured++;
      } else if (state.destroyed) {
        g.destroyed++;
      } else if (state.crippledInScenario && !unit.crippled) {
        g.crippled++;
      }
    }
    return [...playerGroupMap.values()].map(pg => ({
      player: pg.player,
      groups: [...pg.groups.values()].sort((a, b) => a.templateName.localeCompare(b.templateName)),
    }));
  };

  const attackerTally = buildTally('attacker');
  const defenderTally = buildTally('defender');

  const renderTallyOutcome = (g: ReturnType<typeof buildTally>[0]['groups'][0]) => {
    const parts: string[] = [];
    if (g.destroyed > 0) parts.push(`${g.destroyed} D`);
    if (g.crippled > 0) parts.push(`${g.crippled} C`);
    if (g.captured > 0) parts.push(`${g.captured} CAP`);
    return parts.join(', ');
  };

  const tallyCols = '1fr 2rem 5rem 2.5rem 2.5rem 2.5rem 2.5rem 1fr';
  //                  Unit  xN  Losses   DV   AS   AF   CR  Traits

  const copyTallySide = (side: 'attacker' | 'defender') => {
    const tally = side === 'attacker' ? attackerTally : defenderTally;
    const lines: string[] = [`=== ${side.charAt(0).toUpperCase() + side.slice(1)} ===`];
    for (const { player, groups } of tally) {
      lines.push(`${player.name} (${player.empire.name})`);
      for (const g of groups) {
        const tmpl = tmap.get(g.templateId);
        const half = g.wasStrategicallyCrippled;
        const dv = tmpl ? (half ? Math.ceil(tmpl.dv / 2) : tmpl.dv) : '—';
        const as_ = tmpl?.as === '-' ? '—' : tmpl ? (half ? Math.ceil((tmpl.as as number) / 2) : tmpl.as) : '—';
        const af = tmpl?.af === '-' ? '—' : tmpl ? (half ? Math.ceil((tmpl.af as number) / 2) : tmpl.af) : '—';
        const cr = tmpl?.cr === '-' ? '—' : tmpl ? String(tmpl.cr) : '—';
        const unitLabel = `${g.templateName}${g.hullCode !== 'N/A' ? ` (${g.hullCode})` : ''}${g.wasStrategicallyCrippled ? ' [C]' : ''}`;
        const outcome = renderTallyOutcome(g) || 'OK';
        const traits = tmpl?.traits.map(t => `${t.name}${t.factor ? ` ${t.factor}` : ''}`).join(', ') ?? '';
        lines.push(`  ${unitLabel}  x${g.count}  ${outcome}  DV:${dv}  AS:${as_}  AF:${af}  CR:${cr}${traits ? `  ${traits}` : ''}`);
      }
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 flex flex-col overflow-auto p-6">
        <div className="mb-6 text-center">
          <div className={`text-2xl font-bold ${scenario.winner === 'mutual_retreat' ? 'text-gray-500' : 'text-green-600 dark:text-green-400'}`}>
            {winnerLabel}
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {scenario.turnNumber} combat turn{scenario.turnNumber !== 1 ? 's' : ''} · {destroyedCount} destroyed · {crippledCount} crippled · {capturedCount} captured
          </p>
          {scenario.resultsApplied && (
            <span className="mt-2 inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">Results Applied</span>
          )}
        </div>

        {/* Outcome tally */}
        <div className="mb-6 grid grid-cols-2 gap-4 flex-1 min-h-0">
          {(['attacker', 'defender'] as const).map(side => {
            const tally = side === 'attacker' ? attackerTally : defenderTally;
            return (
              <div key={side} className="flex flex-col min-h-0">
                <div className="mb-1 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 capitalize">{side}</h3>
                  <button
                    onClick={() => copyTallySide(side)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                    title="Copy to clipboard"
                  >
                    Copy
                  </button>
                </div>
                <div className="rounded border border-gray-200 p-2 dark:border-gray-700 flex flex-col flex-1 min-h-0">
                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="grid h-5 items-center gap-x-2 border-b border-gray-200 text-[10px] font-medium uppercase tracking-wide text-gray-400 sticky top-0 z-20 bg-white dark:border-gray-700 dark:text-gray-500 dark:bg-gray-900" style={{ gridTemplateColumns: tallyCols }}>
                      <span>Unit</span>
                      <span className="text-right">×</span>
                      <span className="pl-2">Losses</span>
                      <span className="text-right">DV</span>
                      <span className="text-right">AS</span>
                      <span className="text-right">AF</span>
                      <span className="text-right">CR</span>
                      <span className="pl-3">Traits</span>
                    </div>
                    {tally.length === 0 ? (
                      <p className="pt-1 text-xs italic text-gray-400 dark:text-gray-500">No units</p>
                    ) : tally.map(({ player, groups }) => (
                      <div key={player.id}>
                        <p className="text-[10px] font-semibold text-gray-400 sticky top-5 z-10 bg-white py-0.5 dark:bg-gray-900 dark:text-gray-500">
                          {player.name} <span className="font-normal">({player.empire.name})</span>
                        </p>
                        {groups.map((g, i) => {
                          const outcome = renderTallyOutcome(g);
                          const tmpl = tmap.get(g.templateId);
                          const half = g.wasStrategicallyCrippled;
                          const dispDV = tmpl ? (half ? Math.ceil(tmpl.dv / 2) : tmpl.dv) : '—';
                          const dispAS = tmpl?.as === '-' ? '—' : tmpl ? (half ? Math.ceil((tmpl.as as number) / 2) : tmpl.as) : '—';
                          const dispAF = tmpl?.af === '-' ? '—' : tmpl ? (half ? Math.ceil((tmpl.af as number) / 2) : tmpl.af) : '—';
                          const dispCR = tmpl?.cr === '-' ? '—' : tmpl ? String(tmpl.cr) : '—';
                          return (
                            <div key={i} className="grid items-center gap-x-2 py-0.5 text-xs rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-default" style={{ gridTemplateColumns: tallyCols }}>
                              <span className="truncate dark:text-gray-200">
                                {g.templateName}
                                {g.hullCode !== 'N/A' && <span className="ml-1 text-gray-400">({g.hullCode})</span>}
                                {g.wasStrategicallyCrippled && <span className="ml-1 rounded px-1 py-0 text-[9px] font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">C</span>}
                              </span>
                              <span className="text-right tabular-nums font-semibold text-blue-600 dark:text-blue-400">x{g.count}</span>
                              <span className={`pl-2 tabular-nums ${outcome ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}>
                                {outcome || ''}
                              </span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{dispDV}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{dispAS}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{dispAF}</span>
                              <span className="text-right tabular-nums text-gray-500 dark:text-gray-400">{dispCR}</span>
                              <span className="truncate pl-3 text-gray-400 dark:text-gray-500">
                                {tmpl?.traits.map((tr, j) => <span key={j}>{j > 0 && ', '}{tr.name}{tr.factor ? ` ${tr.factor}` : ''}</span>)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!scenario.resultsApplied && (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-400">
            <p className="font-semibold">Click "Apply Results" to:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>Remove all destroyed units from their player's unit lists</li>
              <li>Apply Crippled/Captured flags from combat to surviving units</li>
              <li>Add captured units to the awarded player's unit list</li>
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <button
          onClick={onClose}
          className="rounded px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Close
        </button>
        {!scenario.resultsApplied && (
          <button
            onClick={() => {
              // Pass capture awards into the scenario before applying
              onApply();
            }}
            className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
          >
            Apply Results
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CombatScenarioView({
  scenario,
  players,
  map: _map,
  diplomacyRelations,
  systemOwnership,
  onUpdate,
  onClose,
}: CombatScenarioViewProps) {
  const systemName = _map.systems.find(s => s.id === scenario.systemId)?.name ?? scenario.systemId;

  const handleApplyResults = useCallback(() => {
    // Signal parent to apply results. resolvedAt should already be set;
    // set resultsApplied so the parent knows to process this update.
    onUpdate({
      ...scenario,
      resolvedAt: scenario.resolvedAt ?? new Date().toISOString(),
      resultsApplied: true,
    });
    // Don't close — parent keeps the scenario alive; user returns to map via Close button
  }, [scenario, onUpdate]);

  const renderPhase = () => {
    switch (scenario.phase) {
      case 'setup':
        return (
          <SetupPhaseView
            scenario={scenario}
            players={players}
            diplomacyRelations={diplomacyRelations}
            systemOwnership={systemOwnership}
            onUpdate={onUpdate}
          />
        );
      case 'flagship':
        return (
          <FlagshipSelectionView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'task_force':
        return (
          <TaskForceSetupView
            scenario={scenario}
            players={players}
            map={_map}
            onUpdate={onUpdate}
          />
        );
      case 'assignments':
        return (
          <AssignmentsPhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'fire_ff':
      case 'fire_sf':
      case 'fire_ss':
        return (
          <FirePhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'special_ops':
        return (
          <SpecialOpsPhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'retreat':
        return (
          <RetreatPhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'recovery':
        return (
          <RecoveryPhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'ground_combat':
        return (
          <GroundCombatPhaseView
            scenario={scenario}
            players={players}
            onUpdate={onUpdate}
          />
        );
      case 'resolved':
        return (
          <ResolutionView
            scenario={scenario}
            players={players}
            onClose={onClose}
            onApply={handleApplyResults}
          />
        );
      default:
        return null;
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ← Close
          </button>
          <h1 className="text-base font-semibold dark:text-gray-100">
            Combat Scenario — {systemName}
          </h1>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {SCENARIO_TYPE_LABELS[scenario.scenarioType]}
          </span>
        </div>

        {/* Phase progress indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="font-medium dark:text-gray-200">{PHASE_LABELS[scenario.phase]}</span>
          {scenario.phase !== 'setup' && scenario.phase !== 'resolved' && (
            <span className="text-gray-400 dark:text-gray-500">Turn {scenario.turnNumber}</span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {renderPhase()}
      </div>
    </div>,
    document.body
  );
}
