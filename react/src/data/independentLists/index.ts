import harbinger from './harbinger.json';
import independentSystem from './independentSystem.json';
import raider from './raider.json';
import type { IndependentUnitList } from '../../types';

export const INDEPENDENT_UNIT_LISTS: IndependentUnitList[] = [
  raider,
  independentSystem,
  harbinger,
] as IndependentUnitList[];
