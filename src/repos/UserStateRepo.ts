import { supabase } from '../supabase/client';
import type { OnboardingStep, UserStateRecord } from '../types/domain';

export class UserStateRepo {
  async getByTelegramUserId(telegramUserId: number): Promise<UserStateRecord | null> {
    const { data, error } = await supabase
      .from('user_states')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as UserStateRecord | null;
  }

  async upsertState(telegramUserId: number, step: OnboardingStep, payload: Record<string, unknown> = {}): Promise<void> {
    const { error } = await supabase.from('user_states').upsert(
      {
        telegram_user_id: telegramUserId,
        step,
        payload
      },
      { onConflict: 'telegram_user_id' }
    );

    if (error) {
      throw error;
    }
  }

  async clearState(telegramUserId: number): Promise<void> {
    const { error } = await supabase.from('user_states').upsert(
      {
        telegram_user_id: telegramUserId,
        step: 'IDLE',
        payload: {}
      },
      { onConflict: 'telegram_user_id' }
    );

    if (error) {
      throw error;
    }
  }
}
