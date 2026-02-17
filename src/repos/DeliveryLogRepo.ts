import { supabase } from '../supabase/client';
import type { DeliveryStatus, DeliveryType } from '../types/domain';

interface ReserveInput {
  userId: string;
  deliveryType: DeliveryType;
  targetDateISO: string;
  scheduledForISO: string;
}

export class DeliveryLogRepo {
  async reserveIfNotExists(params: ReserveInput): Promise<{ reserved: boolean; logId?: string }> {
    const dedupeKey = `${params.userId}:${params.deliveryType}:${params.targetDateISO}`;

    const { data: existing, error: findError } = await supabase
      .from('delivery_logs')
      .select('id,status')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();

    if (findError) {
      throw findError;
    }

    if (existing) {
      return { reserved: false };
    }

    const { data, error } = await supabase
      .from('delivery_logs')
      .insert({
        user_id: params.userId,
        delivery_type: params.deliveryType,
        target_date: params.targetDateISO,
        scheduled_for: params.scheduledForISO,
        status: 'SKIPPED',
        error: 'RESERVED_NOT_SENT_YET',
        dedupe_key: dedupeKey
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { reserved: false };
      }
      throw error;
    }

    return { reserved: true, logId: data.id as string };
  }

  async updateStatus(logId: string, status: DeliveryStatus, errorText: string | null): Promise<void> {
    const patch: Record<string, string | null> = {
      status,
      error: errorText
    };

    if (status === 'SENT') {
      patch.sent_at = new Date().toISOString();
    }

    const { error } = await supabase.from('delivery_logs').update(patch).eq('id', logId);
    if (error) {
      throw error;
    }
  }
}
