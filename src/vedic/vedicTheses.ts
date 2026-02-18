import thesesJson from '../content/vedic/theses.json';
import type { MergedTheses, VedicThesisItem } from './types';

interface RawTheses {
  defaults: VedicThesisItem;
  tithi: Record<string, VedicThesisItem>;
  nakshatra: Record<string, VedicThesisItem>;
  vara: Record<string, VedicThesisItem>;
}

function normalizeKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function findByNormalized(
  source: Record<string, VedicThesisItem>,
  key: string | null | undefined
): VedicThesisItem | null {
  const target = normalizeKey(key);
  if (!target) {
    return null;
  }

  for (const [rawKey, value] of Object.entries(source)) {
    if (normalizeKey(rawKey) === target) {
      return value;
    }
  }

  return null;
}

export class VedicThesesService {
  private readonly data: RawTheses = thesesJson as RawTheses;

  mergeDefaults(params: {
    tithiName: string | null;
    tithiNumber: number | null;
    nakshatraName: string | null;
    vara: string | null;
  }): MergedTheses {
    const defaults = this.data.defaults;

    const tithiByName = findByNormalized(this.data.tithi, params.tithiName);
    const tithiByNumber = params.tithiNumber ? this.data.tithi[String(params.tithiNumber)] ?? null : null;

    return {
      defaults,
      selected: {
        tithi: tithiByName ?? tithiByNumber ?? defaults,
        nakshatra: findByNormalized(this.data.nakshatra, params.nakshatraName) ?? defaults,
        vara: findByNormalized(this.data.vara, params.vara) ?? defaults
      }
    };
  }
}
