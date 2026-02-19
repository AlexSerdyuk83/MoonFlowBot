import { env } from '../config/env';
import { UserRepo } from '../repos/UserRepo';
import { supabase } from '../supabase/client';
import { getNowInTimezone } from '../utils/time';

interface CacheRow {
  cache_key: string;
  value: string;
  expires_at: number;
}

export interface VedicUserLocation {
  userId: number;
  chatId: number;
  cityName: string | null;
  timezone: string;
  lat: number | null;
  lon: number | null;
  isSubscribed: boolean;
}

export class VedicStorage {
  constructor(private readonly userRepo: UserRepo) {}

  async getUserLocation(userId: number): Promise<VedicUserLocation | null> {
    const user = await this.userRepo.findByTelegramUserId(userId);
    if (!user) {
      return null;
    }

    return {
      userId,
      chatId: Number(user.telegram_chat_id),
      cityName: user.city_name,
      timezone: user.timezone || env.defaultTimezone,
      lat: user.lat,
      lon: user.lon,
      isSubscribed: Boolean(user.morning_time && user.evening_time)
    };
  }

  async saveLocation(params: {
    userId: number;
    chatId: number;
    cityName: string;
    lat: number;
    lon: number;
    timezone: string;
  }): Promise<void> {
    await this.userRepo.upsertLocationByTelegramUserId({
      telegramUserId: params.userId,
      telegramChatId: params.chatId,
      cityName: params.cityName,
      lat: params.lat,
      lon: params.lon,
      timezone: params.timezone
    });
  }

  async saveTimezone(params: {
    userId: number;
    chatId: number;
    cityName?: string;
    timezone: string;
  }): Promise<void> {
    await this.userRepo.updateTimezoneByTelegramUserId({
      telegramUserId: params.userId,
      telegramChatId: params.chatId,
      cityName: params.cityName,
      timezone: params.timezone
    });
  }

  async getCache(cacheKey: string): Promise<string | null> {
    const now = Date.now();
    const { data, error } = await supabase
      .from('cache')
      .select('cache_key,value,expires_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', now)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const row = data as CacheRow | null;
    return row?.value ?? null;
  }

  async setCache(cacheKey: string, value: string, expiresAt: number): Promise<void> {
    const { error } = await supabase.from('cache').upsert(
      {
        cache_key: cacheKey,
        value,
        expires_at: expiresAt
      },
      { onConflict: 'cache_key' }
    );

    if (error) {
      throw error;
    }
  }

  buildCacheKey(params: {
    userId: number;
    dateLocal: string;
    lat: number;
    lon: number;
    timezone: string;
  }): string {
    const lat2 = params.lat.toFixed(2);
    const lon2 = params.lon.toFixed(2);
    return `${params.userId}:${params.dateLocal}:${lat2}:${lon2}:${params.timezone}`;
  }

  getEndOfLocalDayTs(timezoneName: string): number {
    const nowLocal = getNowInTimezone(timezoneName);
    const endOfDay = nowLocal.endOf('day').valueOf();
    if (endOfDay > Date.now()) {
      return endOfDay;
    }

    return Date.now() + 24 * 60 * 60 * 1000;
  }
}
