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
    const payload = {
      telegram_user_id: params.telegramUserId,
      telegram_chat_id: params.telegramChatId,
      timezone: params.timezone,
      morning_time: params.morningTime,
      evening_time: params.eveningTime,
      is_active: true
    };

    const { data, error } = await supabase
      .from('users')
      .upsert(payload, { onConflict: 'telegram_user_id' })
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
