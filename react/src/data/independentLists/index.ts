import harbinger from './harbinger.json';
import independentSystem from './independentSystem.json';
import raider from './raider.json';
import ravager from './ravager.json';
import type { IndependentUnitList } from '../../types';

export const INDEPENDENT_UNIT_LISTS: IndependentUnitList[] = [
  raider,
  ravager,
  independentSystem,
  harbinger,
] as IndependentUnitList[];
