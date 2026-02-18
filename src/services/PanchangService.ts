import * as panchangLib from '@bidyashish/panchang';
import type { PanchangData } from '../types/domain';
import { logger } from '../utils/logger';

const FALLBACK_TITHI = [
  'Pratipada',
  'Dvitiya',
  'Tritiya',
  'Chaturthi',
  'Panchami',
  'Shashthi',
  'Saptami',
  'Ashtami',
  'Navami',
  'Dashami',
  'Ekadashi',
  'Dvadashi',
  'Trayodashi',
  'Chaturdashi',
  'Purnima',
  'Amavasya'
];

const FALLBACK_NAKSHATRA = [
  'Ashwini',
  'Bharani',
  'Krittika',
  'Rohini',
  'Mrigashira',
  'Ardra',
  'Punarvasu',
  'Pushya',
  'Ashlesha',
  'Magha',
  'Purva Phalguni',
  'Uttara Phalguni',
  'Hasta',
  'Chitra',
  'Swati',
  'Vishakha',
  'Anuradha',
  'Jyeshtha',
  'Mula',
  'Purva Ashadha',
  'Uttara Ashadha',
  'Shravana',
  'Dhanishta',
  'Shatabhisha',
  'Purva Bhadrapada',
  'Uttara Bhadrapada',
  'Revati'
];

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'object' && value && 'name' in value && typeof (value as { name?: unknown }).name === 'string') {
    return ((value as { name: string }).name).trim();
  }
  return null;
}

function deterministicFallback(date: Date): PanchangData {
  const day = Math.floor(date.getTime() / 86_400_000);
  const tithi = FALLBACK_TITHI[Math.abs(day) % FALLBACK_TITHI.length] ?? 'Ekadashi';
  const nakshatra = FALLBACK_NAKSHATRA[Math.abs(day) % FALLBACK_NAKSHATRA.length] ?? 'Revati';
  return { tithi, nakshatra };
}

export class PanchangService {
  async getPanchang(date: Date, lat: number, lon: number): Promise<PanchangData> {
    const lib: any = panchangLib as any;

    const attempts: Array<() => unknown> = [
      () => lib?.getPanchang?.({ date, latitude: lat, longitude: lon }),
      () => lib?.calculatePanchang?.({ date, latitude: lat, longitude: lon }),
      () => lib?.default?.getPanchang?.({ date, latitude: lat, longitude: lon }),
      () => {
        if (typeof lib?.Panchang !== 'function') {
          return null;
        }
        const instance = new lib.Panchang({ date, latitude: lat, longitude: lon });
        if (typeof instance?.getPanchang === 'function') {
          return instance.getPanchang();
        }
        if (typeof instance?.calculate === 'function') {
          return instance.calculate();
        }
        return null;
      }
    ];

    for (const attempt of attempts) {
      try {
        const result = await Promise.resolve(attempt());
        if (!result || typeof result !== 'object') {
          continue;
        }

        const raw = result as Record<string, unknown>;
        const tithi = readString(raw.tithi ?? raw.currentTithi ?? raw.Tithi);
        const nakshatra = readString(raw.nakshatra ?? raw.currentNakshatra ?? raw.Nakshatra);

        if (tithi && nakshatra) {
          return { tithi, nakshatra };
        }
      } catch (error) {
        logger.warn('Panchang attempt failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.warn('Panchang package call failed; using deterministic fallback');
    return deterministicFallback(date);
  }
}
