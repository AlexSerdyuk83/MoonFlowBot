import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getPanchanga } from '@bidyashish/panchang';
import { isoDateInTimezone } from '../utils/time';
import type { VedicPanchangJson } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

interface RawFact {
  name?: unknown;
  number?: unknown;
  start?: unknown;
  end?: unknown;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asLocalTime(value: unknown, tz: string): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && /^\d{1,2}:\d{2}/.test(value)) {
    return value.slice(0, 5);
  }

  const dateValue = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dateValue.getTime())) {
    return null;
  }

  return dayjs(dateValue).tz(tz).format('HH:mm');
}

function getPakshaByTithiNumber(number: number | null): string | null {
  if (!number) {
    return null;
  }
  return number <= 15 ? 'Shukla' : 'Krishna';
}

function getMoonPhaseByTithiNumber(number: number | null): string | null {
  if (!number) {
    return null;
  }
  if (number === 15) {
    return 'Purnima';
  }
  if (number === 30) {
    return 'Amavasya';
  }
  if (number < 15) {
    return 'Waxing';
  }
  return 'Waning';
}

export class VedicPanchangService {
  async computePanchang(params: {
    date: Date;
    timezone: string;
    lat: number;
    lon: number;
  }): Promise<VedicPanchangJson> {
    const result = await getPanchanga(params.date, params.lat, params.lon, params.timezone);
    const tithi = (result?.tithi ?? {}) as RawFact;
    const nakshatra = (result?.nakshatra ?? {}) as RawFact;
    const yoga = (result?.yoga ?? {}) as RawFact;
    const karana = (result?.karana ?? {}) as RawFact;
    const vara = (result?.vara ?? {}) as RawFact;

    const tithiNumber = asNumber(tithi.number);
    const paksha = getPakshaByTithiNumber(tithiNumber);

    return {
      dateLocal: isoDateInTimezone(params.date, params.timezone),
      timezone: params.timezone,
      sunrise: asLocalTime((result as { sunrise?: unknown })?.sunrise, params.timezone),
      sunset: asLocalTime((result as { sunset?: unknown })?.sunset, params.timezone),
      vara: asString(vara.name),
      paksha,
      tithi: {
        name: asString(tithi.name),
        number: tithiNumber,
        start: asLocalTime(tithi.start, params.timezone),
        end: asLocalTime(tithi.end, params.timezone)
      },
      nakshatra: {
        name: asString(nakshatra.name),
        number: asNumber(nakshatra.number),
        start: asLocalTime(nakshatra.start, params.timezone),
        end: asLocalTime(nakshatra.end, params.timezone)
      },
      yoga: { name: asString(yoga.name) },
      karana: { name: asString(karana.name) },
      moonPhase: getMoonPhaseByTithiNumber(tithiNumber)
    };
  }
}
