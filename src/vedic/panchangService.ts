import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { AstronomicalCalculator, getPanchanga } from '@bidyashish/panchang';
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

  const dateValue = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dateValue.getTime())) {
    return null;
  }

  return dayjs(dateValue).tz(tz).format('HH:mm');
}

function asLocalTimeFromDate(value: Date | null | undefined, tz: string): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return null;
  }
  return dayjs(value).tz(tz).format('HH:mm');
}

function extractClockString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clockToLocalFromUtc(clock: string, dateLocal: string, tz: string): string | null {
  const utcDate = new Date(`${dateLocal}T${clock}:00.000Z`);
  if (Number.isNaN(utcDate.getTime())) {
    return null;
  }

  return dayjs(utcDate).tz(tz).format('HH:mm');
}

function parseMinutes(time: string | null): number | null {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  const [hoursRaw, minutesRaw] = time.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function scoreSunPair(sunrise: string | null, sunset: string | null): number {
  const sunriseMin = parseMinutes(sunrise);
  const sunsetMin = parseMinutes(sunset);
  if (sunriseMin == null || sunsetMin == null) {
    return -999;
  }

  const sunriseHour = Math.floor(sunriseMin / 60);
  const sunsetHour = Math.floor(sunsetMin / 60);
  let score = 0;

  if (sunriseHour >= 2 && sunriseHour <= 11) {
    score += 3;
  }
  if (sunsetHour >= 12 && sunsetHour <= 23) {
    score += 3;
  }

  const dayLength = sunsetMin >= sunriseMin ? sunsetMin - sunriseMin : sunsetMin + 24 * 60 - sunriseMin;
  if (dayLength >= 6 * 60 && dayLength <= 18 * 60) {
    score += 3;
  }
  if (sunriseMin < sunsetMin) {
    score += 1;
  }

  return score;
}

function normalizeSunTimes(
  rawSunrise: unknown,
  rawSunset: unknown,
  dateLocal: string,
  tz: string
): { sunrise: string | null; sunset: string | null } {
  const sunriseClock = extractClockString(rawSunrise);
  const sunsetClock = extractClockString(rawSunset);

  if (sunriseClock && sunsetClock) {
    const direct = { sunrise: sunriseClock, sunset: sunsetClock };
    const utcShifted = {
      sunrise: clockToLocalFromUtc(sunriseClock, dateLocal, tz),
      sunset: clockToLocalFromUtc(sunsetClock, dateLocal, tz)
    };

    const directScore = scoreSunPair(direct.sunrise, direct.sunset);
    const utcScore = scoreSunPair(utcShifted.sunrise, utcShifted.sunset);

    const selected = utcScore > directScore ? utcShifted : direct;
    if (scoreSunPair(selected.sunrise, selected.sunset) >= scoreSunPair(selected.sunset, selected.sunrise)) {
      return selected;
    }

    return { sunrise: selected.sunset, sunset: selected.sunrise };
  }

  const sunrise = asLocalTime(rawSunrise, tz);
  const sunset = asLocalTime(rawSunset, tz);
  if (scoreSunPair(sunrise, sunset) >= scoreSunPair(sunset, sunrise)) {
    return { sunrise, sunset };
  }

  return { sunrise: sunset, sunset: sunrise };
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
    const dateLocal = isoDateInTimezone(params.date, params.timezone);
    const tithi = (result?.tithi ?? {}) as RawFact;
    const nakshatra = (result?.nakshatra ?? {}) as RawFact;
    const yoga = (result?.yoga ?? {}) as RawFact;
    const karana = (result?.karana ?? {}) as RawFact;
    const vara = (result?.vara ?? {}) as RawFact;

    const tithiNumber = asNumber(tithi.number);
    const paksha = getPakshaByTithiNumber(tithiNumber);
    const sunriseSunsetOrg = await this.fetchSunTimesFromSunriseSunsetOrg({
      lat: params.lat,
      lon: params.lon,
      timezone: params.timezone,
      dateLocal
    });
    const openMeteoSun = sunriseSunsetOrg
      ? null
      : await this.fetchSunTimesFromOpenMeteo({
        lat: params.lat,
        lon: params.lon,
        timezone: params.timezone,
        dateLocal
      });
    const normalizedSun = sunriseSunsetOrg ?? openMeteoSun ?? (await this.resolveSunTimes({
      date: params.date,
      lat: params.lat,
      lon: params.lon,
      timezone: params.timezone,
      dateLocal,
      rawSunrise: (result as { sunrise?: unknown })?.sunrise,
      rawSunset: (result as { sunset?: unknown })?.sunset
    }));

    return {
      dateLocal,
      timezone: params.timezone,
      sunrise: normalizedSun.sunrise,
      sunset: normalizedSun.sunset,
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

  private async fetchSunTimesFromSunriseSunsetOrg(params: {
    lat: number;
    lon: number;
    timezone: string;
    dateLocal: string;
  }): Promise<{ sunrise: string | null; sunset: string | null } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const url = new URL('https://api.sunrise-sunset.org/json');
      url.searchParams.set('lat', String(params.lat));
      url.searchParams.set('lng', String(params.lon));
      url.searchParams.set('date', params.dateLocal);
      url.searchParams.set('formatted', '0');

      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        status?: string;
        results?: {
          sunrise?: string;
          sunset?: string;
        };
      };

      if (payload.status !== 'OK') {
        return null;
      }

      const sunriseIso = payload.results?.sunrise;
      const sunsetIso = payload.results?.sunset;
      if (!sunriseIso || !sunsetIso) {
        return null;
      }

      const sunrise = asLocalTime(sunriseIso, params.timezone);
      const sunset = asLocalTime(sunsetIso, params.timezone);
      if (!sunrise || !sunset) {
        return null;
      }

      if (scoreSunPair(sunrise, sunset) >= scoreSunPair(sunset, sunrise)) {
        return { sunrise, sunset };
      }

      return { sunrise: sunset, sunset: sunrise };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchSunTimesFromOpenMeteo(params: {
    lat: number;
    lon: number;
    timezone: string;
    dateLocal: string;
  }): Promise<{ sunrise: string | null; sunset: string | null } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(params.lat));
      url.searchParams.set('longitude', String(params.lon));
      url.searchParams.set('daily', 'sunrise,sunset');
      url.searchParams.set('timezone', params.timezone);
      url.searchParams.set('start_date', params.dateLocal);
      url.searchParams.set('end_date', params.dateLocal);

      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        daily?: {
          sunrise?: string[];
          sunset?: string[];
        };
      };

      const sunriseRaw = payload.daily?.sunrise?.[0] ?? null;
      const sunsetRaw = payload.daily?.sunset?.[0] ?? null;
      if (!sunriseRaw || !sunsetRaw) {
        return null;
      }

      // Open-Meteo returns daily.sunrise/sunset already in requested timezone.
      // Take HH:mm directly to avoid applying timezone conversion twice.
      const sunrise = extractClockString(sunriseRaw);
      const sunset = extractClockString(sunsetRaw);
      if (!sunrise || !sunset) {
        return null;
      }

      if (scoreSunPair(sunrise, sunset) >= scoreSunPair(sunset, sunrise)) {
        return { sunrise, sunset };
      }

      return { sunrise: sunset, sunset: sunrise };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveSunTimes(params: {
    date: Date;
    lat: number;
    lon: number;
    timezone: string;
    dateLocal: string;
    rawSunrise: unknown;
    rawSunset: unknown;
  }): Promise<{ sunrise: string | null; sunset: string | null }> {
    let calculatorSunrise: string | null = null;
    let calculatorSunset: string | null = null;
    let calculator: AstronomicalCalculator | null = null;

    try {
      calculator = new AstronomicalCalculator();
      const [sunriseDate, sunsetDate] = await Promise.all([
        calculator.calculateSunrise(params.date, params.lat, params.lon, params.timezone),
        calculator.calculateSunset(params.date, params.lat, params.lon, params.timezone)
      ]);
      calculatorSunrise = asLocalTimeFromDate(sunriseDate, params.timezone);
      calculatorSunset = asLocalTimeFromDate(sunsetDate, params.timezone);
    } catch {
      calculatorSunrise = null;
      calculatorSunset = null;
    } finally {
      const maybeCleanup = (calculator as unknown as { cleanup?: () => void } | null)?.cleanup;
      if (typeof maybeCleanup === 'function') {
        maybeCleanup.call(calculator);
      }
    }

    if (calculatorSunrise && calculatorSunset) {
      if (scoreSunPair(calculatorSunrise, calculatorSunset) >= scoreSunPair(calculatorSunset, calculatorSunrise)) {
        return { sunrise: calculatorSunrise, sunset: calculatorSunset };
      }
      return { sunrise: calculatorSunset, sunset: calculatorSunrise };
    }

    return normalizeSunTimes(params.rawSunrise, params.rawSunset, params.dateLocal, params.timezone);
  }
}
