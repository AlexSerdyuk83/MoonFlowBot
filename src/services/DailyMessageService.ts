import { env } from '../config/env';
import type { MoonData } from '../types/domain';
import { isoDateInTimezone, weekdayKeyFromDate } from '../utils/time';
import { ContentComposer } from './ContentComposer';
import { MoonPhaseService } from './MoonPhaseService';
import { PanchangService } from './PanchangService';

export class DailyMessageService {
  constructor(
    private readonly moonPhaseService: MoonPhaseService,
    private readonly panchangService: PanchangService,
    private readonly contentComposer: ContentComposer
  ) {}

  async buildMessage(params: {
    date: Date;
    timezone: string;
    mode: 'TODAY' | 'TOMORROW';
  }): Promise<string> {
    const weekdayKey = weekdayKeyFromDate(params.date, params.timezone);
    const dateISO = isoDateInTimezone(params.date, params.timezone);

    const [moon, panchang] = await Promise.all([
      this.moonPhaseService.getMoonData(params.date),
      this.panchangService.getPanchang(params.date, env.defaultLat, env.defaultLon)
    ]);

    return this.contentComposer.compose({
      dateISO,
      weekdayKey,
      moon: this.normalizeMoon(moon),
      panchang,
      mode: params.mode
    });
  }

  private normalizeMoon(moon: MoonData | null): MoonData | null {
    if (!moon) {
      return null;
    }

    return {
      phase: moon.phase,
      phaseRu: moon.phaseRu,
      age: Number.isFinite(moon.age) ? moon.age : 0,
      illumination: Number.isFinite(moon.illumination) ? moon.illumination : 0
    };
  }
}
