import phaseRuMap from '../content/rules/phase_ru_map.json';
import type { MoonData } from '../types/domain';
import { logger } from '../utils/logger';
import { toUnixSeconds } from '../utils/time';

interface FarmSenseResponse {
  Phase?: string;
  Age?: string;
  Illumination?: string;
}

export class MoonPhaseService {
  async getMoonData(date: Date): Promise<MoonData | null> {
    const unixSeconds = toUnixSeconds(date);
    const url = `https://api.farmsense.net/v1/moonphases/?d=${unixSeconds}`;

    try {
      const response = await fetch(url, { method: 'GET' });
      if (!response.ok) {
        throw new Error(`FarmSense HTTP ${response.status}`);
      }

      const payload = (await response.json()) as FarmSenseResponse[];
      const item = payload[0];
      if (!item?.Phase) {
        throw new Error('FarmSense response does not contain phase');
      }

      const age = Number(item.Age ?? 0);
      const illumination = Number(item.Illumination ?? 0);
      const phase = item.Phase;
      const phaseRu = (phaseRuMap as Record<string, string>)[phase] ?? phase;

      return {
        phase,
        phaseRu,
        age: Number.isFinite(age) ? age : 0,
        illumination: Number.isFinite(illumination) ? illumination : 0
      };
    } catch (error) {
      logger.warn('Moon data unavailable', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}
