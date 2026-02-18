import { supabase } from '../supabase/client';
import type { UserRecord } from '../types/domain';

export class UserRepo {
  async findByTelegramUserId(telegramUserId: number): Promise<UserRecord | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as UserRecord | null;
  }

  async upsertOnboardingUser(params: {
    telegramUserId: number;
    telegramChatId: number;
    timezone: string;
    morningTime: string;
    eveningTime: string;
  }): Promise<UserRecord> {
    const existing = await this.findByTelegramUserId(params.telegramUserId);
    if (existing) {
      const { data, error } = await supabase
        .from('users')
        .update({
          telegram_chat_id: params.telegramChatId,
          timezone: params.timezone,
          morning_time: params.morningTime,
          evening_time: params.eveningTime,
          is_active: true
        })
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      return data as UserRecord;
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_user_id: params.telegramUserId,
        telegram_chat_id: params.telegramChatId,
        timezone: params.timezone,
        morning_time: params.morningTime,
        evening_time: params.eveningTime,
        is_active: true
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return data as UserRecord;
  }

  async updateMorningTime(userId: string, morningTime: string): Promise<void> {
    const { error } = await supabase.from('users').update({ morning_time: morningTime }).eq('id', userId);
    if (error) {
      throw error;
    }
  }

  async updateEveningTime(userId: string, eveningTime: string): Promise<void> {
    const { error } = await supabase.from('users').update({ evening_time: eveningTime }).eq('id', userId);
    if (error) {
      throw error;
    }
  }

  async setIsActive(userId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', userId);
    if (error) {
      throw error;
    }
  }

  async upsertLocationByTelegramUserId(params: {
    telegramUserId: number;
    telegramChatId: number;
    lat: number;
    lon: number;
    timezone: string;
  }): Promise<void> {
    const existing = await this.findByTelegramUserId(params.telegramUserId);
    if (existing) {
      const { error } = await supabase
        .from('users')
        .update({
          telegram_chat_id: params.telegramChatId,
          lat: params.lat,
          lon: params.lon,
          timezone: params.timezone
        })
        .eq('id', existing.id);
      if (error) {
        throw error;
      }
      return;
    }

    const { error } = await supabase.from('users').insert({
      telegram_user_id: params.telegramUserId,
      telegram_chat_id: params.telegramChatId,
      lat: params.lat,
      lon: params.lon,
      timezone: params.timezone,
      is_active: true
    });
    if (error) {
      throw error;
    }
  }

  async updateTimezoneByTelegramUserId(params: {
    telegramUserId: number;
    telegramChatId: number;
    timezone: string;
  }): Promise<void> {
    const existing = await this.findByTelegramUserId(params.telegramUserId);
    if (existing) {
      const { error } = await supabase
        .from('users')
        .update({
          telegram_chat_id: params.telegramChatId,
          timezone: params.timezone
        })
        .eq('id', existing.id);
      if (error) {
        throw error;
      }
      return;
    }

    const { error } = await supabase.from('users').insert({
      telegram_user_id: params.telegramUserId,
      telegram_chat_id: params.telegramChatId,
      timezone: params.timezone,
      is_active: true
    });
    if (error) {
      throw error;
    }
  }

  async getActiveUsers(): Promise<UserRecord[]> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('is_active', true)
      .not('morning_time', 'is', null)
      .not('evening_time', 'is', null);

    if (error) {
      throw error;
    }

    return (data ?? []) as UserRecord[];
  }
}
