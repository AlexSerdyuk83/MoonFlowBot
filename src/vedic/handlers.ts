import { env } from '../config/env';
import { UserStateRepo } from '../repos/UserStateRepo';
import { TelegramApi } from '../services/TelegramApi';
import type { TelegramMessage } from '../types/telegram';
import type { ReplyKeyboardMarkup } from '../types/telegram';
import { logger } from '../utils/logger';
import { getNowInTimezone } from '../utils/time';
import { LlmService, OpenRouterRateLimitError } from './llmService';
import { VedicPanchangService } from './panchangService';
import { VedicStorage } from './storage';
import { VedicThesesService } from './vedicTheses';

const CANCEL_TEXT = 'Отмена';
const FALLBACK_TIMEZONE = 'Europe/Moscow';
const FALLBACK_LAT = 55.7558;
const FALLBACK_LON = 37.6173;
export const BOT_BUTTON_JOIN = '🙏 Подписаться';
export const BOT_BUTTON_TODAY = '🌞 Сегодня';
export const BOT_BUTTON_TOMORROW = '🌙 Завтра';
export const LEGACY_BUTTON_JOIN = 'Присоединиться';
export const LEGACY_BUTTON_TODAY = 'Сообщение на сегодня';
export const LEGACY_BUTTON_TOMORROW = 'Анонс на завтра';

function removeKeyboard() {
  return { remove_keyboard: true } as const;
}

function controlKeyboard(includeJoinButton: boolean): ReplyKeyboardMarkup {
  const rows: ReplyKeyboardMarkup['keyboard'] = [];
  if (includeJoinButton) {
    rows.push([{ text: BOT_BUTTON_JOIN }]);
  }
  rows.push([{ text: BOT_BUTTON_TODAY }]);
  rows.push([{ text: BOT_BUTTON_TOMORROW }]);
  return {
    keyboard: rows,
    resize_keyboard: true
  };
}

function fieldOrNA(value: string | null): string {
  return value ?? 'данных нет';
}

function summaryBlock(dateLocal: string, panchangJson: {
  heading: string;
  tithi: { name: string | null };
  nakshatra: { name: string | null };
  vara: string | null;
  sunrise: string | null;
  sunset: string | null;
}): string {
  return [
    `🌅 ${panchangJson.heading} (${dateLocal})`,
    `🗓️ Титхи: ${fieldOrNA(panchangJson.tithi.name)}`,
    `🌙 Накшатра: ${fieldOrNA(panchangJson.nakshatra.name)}`,
    `✨ Вара: ${fieldOrNA(panchangJson.vara)}`,
    `🌄 Восход: ${fieldOrNA(panchangJson.sunrise)}`,
    `🌇 Закат: ${fieldOrNA(panchangJson.sunset)}`
  ].join('\n');
}

function sanitizeGeneratedText(value: string): string {
  return value
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/~~/g, '')
    .replace(/`/g, '')
    .replace(/^\s*[-*+]\s+/gm, '🔸 ')
    .replace(/^\s*\d+\.\s+/gm, '🔸 ')
    .replace(/[*_]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseClockToMinutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

function normalizeSunOrderForOutput(panchangJson: {
  sunrise: string | null;
  sunset: string | null;
}): void {
  const sunriseMin = parseClockToMinutes(panchangJson.sunrise);
  const sunsetMin = parseClockToMinutes(panchangJson.sunset);
  if (sunriseMin == null || sunsetMin == null) {
    return;
  }

  if (sunriseMin > sunsetMin) {
    const sunrise = panchangJson.sunrise;
    panchangJson.sunrise = panchangJson.sunset;
    panchangJson.sunset = sunrise;
  }
}

function isValidTimezone(timezoneName: string): boolean {
  try {
    Intl.DateTimeFormat('ru-RU', { timeZone: timezoneName }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export class VedicHandlers {
  constructor(
    private readonly telegramApi: TelegramApi,
    private readonly userStateRepo: UserStateRepo,
    private readonly storage: VedicStorage,
    private readonly panchangService: VedicPanchangService,
    private readonly thesesService: VedicThesesService,
    private readonly llmService: LlmService
  ) {}

  async handleCommand(message: TelegramMessage, text: string): Promise<boolean> {
    const chatId = message.chat.id;
    const userId = message.from?.id;
    if (!userId) {
      return true;
    }

    if (text === '/start') {
      await this.requestCity(chatId, userId, 'start');
      return true;
    }

    if (text === '/setcity' || text === '/setlocation') {
      await this.requestCity(chatId, userId, 'setcity');
      return true;
    }

    if (text === '/today') {
      await this.handleDay(chatId, userId, false, 0, 'today');
      return true;
    }

    if (text === '/tomorrow') {
      await this.handleDay(chatId, userId, false, 1, 'tomorrow');
      return true;
    }

    if (text === '/refresh') {
      await this.handleDay(chatId, userId, true, 0, 'today');
      return true;
    }

    if (text.startsWith('/settimezone')) {
      const tzRaw = text.replace('/settimezone', '').trim();
      if (!tzRaw) {
        await this.telegramApi.sendMessage(chatId, '🕉️ Укажи таймзону так: /settimezone Europe/Moscow');
        return true;
      }

      if (!isValidTimezone(tzRaw)) {
        await this.telegramApi.sendMessage(chatId, '⚠️ Неверная таймзона. Пример: Europe/Moscow');
        return true;
      }

      await this.storage.saveTimezone({ userId, chatId, timezone: tzRaw });
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, `🕉️ Таймзона сохранена: ${tzRaw}`, {
        replyMarkup: removeKeyboard()
      });
      return true;
    }

    if (text === '/debug') {
      const isAllowed = env.nodeEnv !== 'production' || env.adminTelegramUserId === String(userId);
      if (!isAllowed) {
        return true;
      }

      const location = await this.storage.getUserLocation(userId);
      const timezoneName = location?.timezone || FALLBACK_TIMEZONE;
      const lat = location?.lat ?? FALLBACK_LAT;
      const lon = location?.lon ?? FALLBACK_LON;

      try {
        const nowLocal = getNowInTimezone(timezoneName);
        const panchang = await this.panchangService.computePanchang({
          date: nowLocal.toDate(),
          timezone: timezoneName,
          lat,
          lon
        });
        await this.telegramApi.sendMessage(chatId, JSON.stringify(panchang, null, 2));
      } catch (error) {
        await this.telegramApi.sendMessage(chatId, `⚠️ Не удалось посчитать панчангу: ${this.errorMessage(error)}`);
      }

      return true;
    }

    if (text === '/cancel' || text === CANCEL_TEXT) {
      await this.userStateRepo.clearState(userId);
      await this.telegramApi.sendMessage(chatId, '🙏 Хорошо, остановил действие.', {
        replyMarkup: removeKeyboard()
      });
      return true;
    }

    return false;
  }

  async handleTextAction(message: TelegramMessage, text: string): Promise<boolean> {
    const userId = message.from?.id;
    if (!userId) {
      return false;
    }

    if (text === BOT_BUTTON_JOIN || text === LEGACY_BUTTON_JOIN) {
      await this.telegramApi.sendMessage(
        message.chat.id,
        '🙏 Благодарю за доверие. Сейчас настроим время утренней и вечерней рассылки.'
      );
      const location = await this.storage.getUserLocation(userId);
      if (!location) {
        await this.requestCity(message.chat.id, userId, 'join_button');
        return true;
      }
      await this.startSubscriptionTimeOnboarding(message.chat.id, userId, location.timezone || FALLBACK_TIMEZONE);
      return true;
    }

    if (text === BOT_BUTTON_TODAY || text === LEGACY_BUTTON_TODAY) {
      await this.telegramApi.sendMessage(message.chat.id, '🌼 Благодарю. Готовлю для тебя сводку на сегодня, это займет несколько секунд...');
      await this.handleDay(message.chat.id, userId, false, 0, 'today');
      return true;
    }

    if (text === BOT_BUTTON_TOMORROW || text === LEGACY_BUTTON_TOMORROW) {
      await this.telegramApi.sendMessage(message.chat.id, '🌙 Благодарю. Готовлю анонс на завтра, это займет несколько секунд...');
      await this.handleDay(message.chat.id, userId, false, 1, 'tomorrow');
      return true;
    }

    return false;
  }

  async handleCityInput(
    chatId: number,
    userId: number,
    cityInput: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const city = cityInput.trim();
    if (city.length < 2) {
      await this.telegramApi.sendMessage(chatId, '🏙️ Введи город текстом, например: Москва.');
      return;
    }

    const source = typeof payload.source === 'string' ? payload.source : '';
    const existing = await this.storage.getUserLocation(userId);
    const resolved = await this.resolveCity(city);
    const cityLabel = resolved ? `${resolved.name}${resolved.country ? `, ${resolved.country}` : ''}` : city;
    const timezoneName = resolved?.timezone && isValidTimezone(resolved.timezone)
      ? resolved.timezone
      : FALLBACK_TIMEZONE;

    if (resolved?.lat != null && resolved.lon != null) {
      await this.storage.saveLocation({
        userId,
        chatId,
        cityName: cityLabel,
        lat: resolved.lat,
        lon: resolved.lon,
        timezone: timezoneName
      });
    } else {
      await this.storage.saveTimezone({
        userId,
        chatId,
        cityName: cityLabel,
        timezone: timezoneName
      });
    }

    await this.userStateRepo.clearState(userId);

    const includeJoinButton = !Boolean(existing?.isSubscribed);
    const fallbackNote = resolved
      ? ''
      : '\n⚠️ Город не удалось определить точно, использую таймзону по умолчанию: Europe/Moscow.';
    const text = `🪔 Город сохранен: ${cityLabel}.\n🕉️ Таймзона: ${timezoneName}.${fallbackNote}`;

    if (source === 'join_button') {
      await this.telegramApi.sendMessage(chatId, `${text}\n\n🙏 Подключение завершено. Теперь настроим время рассылок.`, {
        replyMarkup: controlKeyboard(includeJoinButton)
      });
      await this.startSubscriptionTimeOnboarding(chatId, userId, timezoneName);
      return;
    }

    await this.telegramApi.sendMessage(chatId, `${text}\n\n🙏 Подключение завершено. Выбери действие кнопками ниже.`, {
      replyMarkup: controlKeyboard(includeJoinButton)
    });
  }

  async handleToday(chatId: number, userId: number, forceRefresh: boolean): Promise<void> {
    await this.handleDay(chatId, userId, forceRefresh, 0, 'today');
  }

  async handleTomorrow(chatId: number, userId: number, forceRefresh: boolean): Promise<void> {
    await this.handleDay(chatId, userId, forceRefresh, 1, 'tomorrow');
  }

  private async handleDay(
    chatId: number,
    userId: number,
    forceRefresh: boolean,
    dayOffset: number,
    target: 'today' | 'tomorrow'
  ): Promise<void> {
    const location = await this.storage.getUserLocation(userId);
    if (!location) {
      await this.requestCity(chatId, userId, 'setcity');
      return;
    }

    const timezoneName = location.timezone || FALLBACK_TIMEZONE;
    const lat = location.lat ?? FALLBACK_LAT;
    const lon = location.lon ?? FALLBACK_LON;
    const baseLocal = getNowInTimezone(timezoneName);
    const targetLocal = dayOffset === 0 ? baseLocal : baseLocal.add(dayOffset, 'day');
    const dateLocal = targetLocal.format('YYYY-MM-DD');

    let panchangJson;
    try {
      panchangJson = await this.panchangService.computePanchang({
        date: targetLocal.toDate(),
        timezone: timezoneName,
        lat,
        lon
      });
    } catch {
      await this.telegramApi.sendMessage(chatId, '⚠️ Не удалось вычислить панчангу. Попробуй снова через /refresh.');
      return;
    }

    const theses = this.thesesService.mergeDefaults({
      tithiName: panchangJson.tithi.name,
      tithiNumber: panchangJson.tithi.number,
      nakshatraName: panchangJson.nakshatra.name,
      vara: panchangJson.vara
    });

    normalizeSunOrderForOutput(panchangJson);

    const cacheKey = this.storage.buildCacheKey({
      userId,
      dateLocal,
      lat,
      lon,
      timezone: timezoneName
    });

    if (!forceRefresh) {
      const cached = await this.storage.getCache(cacheKey);
      if (cached) {
        const cleanedCached = sanitizeGeneratedText(cached);
        if (cleanedCached !== cached) {
          await this.storage.setCache(cacheKey, cleanedCached, this.storage.getEndOfLocalDayTs(timezoneName));
        }
        await this.telegramApi.sendMessage(chatId, cleanedCached);
        return;
      }
    }

    try {
      const llmText = await this.llmService.generateVedicDay(panchangJson, theses, target);
      const heading = target === 'tomorrow' ? 'Завтра' : 'Сегодня';
      const output = `${summaryBlock(dateLocal, { ...panchangJson, heading })}\n\n${sanitizeGeneratedText(llmText)}`;
      const expiresAt = targetLocal.endOf('day').valueOf();
      const fallbackExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      await this.storage.setCache(cacheKey, output, expiresAt > Date.now() ? expiresAt : fallbackExpiresAt);
      await this.telegramApi.sendMessage(chatId, output);
    } catch (error) {
      if (error instanceof OpenRouterRateLimitError) {
        await this.telegramApi.sendMessage(chatId, '⏳ Сейчас лимит LLM, попробуй чуть позже.');
        return;
      }

      logger.error('OpenRouter generation failed', {
        userId,
        timezone: timezoneName,
        dateLocal,
        error: this.errorMessage(error)
      });

      const isDebugUser = env.nodeEnv !== 'production' || env.adminTelegramUserId === String(userId);
      const debugSuffix = isDebugUser ? `\n\nТех.детали: ${this.errorMessage(error)}` : '';
      await this.telegramApi.sendMessage(
        chatId,
        `${summaryBlock(dateLocal, { ...panchangJson, heading: target === 'tomorrow' ? 'Завтра' : 'Сегодня' })}\n\n⚠️ Интерпретация временно недоступна. Попробуй /refresh позже.${debugSuffix}`
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async resolveCity(city: string): Promise<{
    name: string;
    country: string | null;
    timezone: string | null;
    lat: number | null;
    lon: number | null;
  } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', city);
      url.searchParams.set('count', '1');
      url.searchParams.set('language', 'ru');
      url.searchParams.set('format', 'json');

      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        results?: Array<{
          name?: unknown;
          country?: unknown;
          timezone?: unknown;
          latitude?: unknown;
          longitude?: unknown;
        }>;
      };
      const first = payload.results?.[0];
      if (!first) {
        return null;
      }

      return {
        name: typeof first.name === 'string' && first.name.trim() ? first.name.trim() : city,
        country: typeof first.country === 'string' && first.country.trim() ? first.country.trim() : null,
        timezone: typeof first.timezone === 'string' && first.timezone.trim() ? first.timezone.trim() : null,
        lat: typeof first.latitude === 'number' && Number.isFinite(first.latitude) ? first.latitude : null,
        lon: typeof first.longitude === 'number' && Number.isFinite(first.longitude) ? first.longitude : null
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestCity(
    chatId: number,
    userId: number,
    source: 'start' | 'join_button' | 'setcity'
  ): Promise<void> {
    await this.userStateRepo.upsertState(userId, 'WAITING_CITY', { source });
    const text =
      source === 'setcity'
        ? '🏙️ Введи город, чтобы я определил таймзону. Например: Москва.'
        : '🕉️ Намасте. Введи свой город, и я определю таймзону для точной сводки дня. Например: Москва.';
    await this.telegramApi.sendMessage(chatId, text, { replyMarkup: removeKeyboard() });
  }

  private async startSubscriptionTimeOnboarding(chatId: number, userId: number, timezoneName: string): Promise<void> {
    await this.userStateRepo.upsertState(userId, 'WAITING_MORNING_TIME', { timezone: timezoneName });
    await this.telegramApi.sendMessage(
      chatId,
      `🕉️ Отлично. Таймзона: ${timezoneName}.\n🌅 Введи время утреннего сообщения в формате HH:mm (например, 08:30).`
    );
  }
}
