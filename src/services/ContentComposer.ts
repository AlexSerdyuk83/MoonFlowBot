import moonRules from '../content/rules/moon_phase_rules.json';
import weekdayRules from '../content/rules/weekday_rules.json';
import tithiRules from '../content/rules/tithi_rules.json';
import nakshatraRules from '../content/rules/nakshatra_rules.json';
import type { MoonData, PanchangData, RuleDetails } from '../types/domain';

interface ComposeInput {
  dateISO: string;
  weekdayKey: string;
  moon: MoonData | null;
  panchang: PanchangData | null;
  mode: 'TODAY' | 'TOMORROW';
}

function emptyRule(): RuleDetails {
  return {
    meaning: [],
    focus: [],
    practices: [],
    food: []
  };
}

function byKey(collection: Record<string, RuleDetails>, key: string | null | undefined): RuleDetails {
  if (!key) {
    return emptyRule();
  }
  return collection[key] ?? emptyRule();
}

function normalizeList(values: string[], min: number, max: number): string[] {
  const unique = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
  return unique.slice(0, Math.max(min, Math.min(max, unique.length)));
}

export class ContentComposer {
  compose(input: ComposeInput): string {
    const weekdayRule = byKey(weekdayRules as Record<string, RuleDetails>, input.weekdayKey);
    const moonRule = byKey(
      moonRules as Record<string, RuleDetails>,
      input.moon ? input.moon.phase : null
    );
    const tithiRule = byKey(
      tithiRules as Record<string, RuleDetails>,
      input.panchang ? input.panchang.tithi : null
    );
    const nakshatraRule = byKey(
      nakshatraRules as Record<string, RuleDetails>,
      input.panchang ? input.panchang.nakshatra : null
    );

    const focus = normalizeList(
      [...weekdayRule.focus, ...moonRule.focus, ...tithiRule.focus, ...nakshatraRule.focus],
      2,
      4
    );
    const practices = normalizeList(
      [...weekdayRule.practices, ...moonRule.practices, ...tithiRule.practices, ...nakshatraRule.practices],
      5,
      7
    );
    const food = normalizeList(
      [...weekdayRule.food, ...moonRule.food, ...tithiRule.food, ...nakshatraRule.food],
      2,
      4
    );

    const heading = input.mode === 'TODAY' ? `Послание на ${input.dateISO}` : `Анонс на ${input.dateISO}`;
    const moonBlock = input.moon
      ? `Луна: ${input.moon.phaseRu} (${input.moon.phase}), возраст ${input.moon.age.toFixed(1)} дн., освещенность ${input.moon.illumination.toFixed(1)}%.`
      : 'Луна: данные временно недоступны, ориентируйся на ритм дня и внутреннее состояние.';

    const panchangBlock = input.panchang
      ? `Панчанг: титхи ${input.panchang.tithi}, накшатра ${input.panchang.nakshatra}.`
      : 'Панчанг: данные временно недоступны.';

    const meaning = normalizeList(
      [...weekdayRule.meaning, ...moonRule.meaning, ...tithiRule.meaning, ...nakshatraRule.meaning],
      2,
      4
    );

    const toBullets = (items: string[]) => items.map((item) => `• ${item}`).join('\n');

    return [
      `🌿 ${heading}`,
      '',
      'Луна',
      moonBlock,
      '',
      'Панчанг',
      panchangBlock,
      '',
      'Как прожить день',
      toBullets(meaning.length ? meaning : ['Двигайся спокойно, с вниманием к телу и мыслям.']),
      '',
      'Фокус',
      toBullets(focus.length ? focus : ['Тишина', 'Присутствие']),
      '',
      'Практики',
      toBullets(practices.length ? practices : ['10 минут дыхания', 'Короткая прогулка', 'Стакан воды утром', 'Пауза перед важным разговором', 'Ранний сон']),
      '',
      'Питание',
      toBullets(food.length ? food : ['Теплая простая еда', 'Больше воды']),
      '',
      'Наблюдай самочувствие; это не медицинская рекомендация.'
    ].join('\n');
  }
}
