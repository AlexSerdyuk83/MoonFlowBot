export type DeliveryType = 'MORNING' | 'EVENING';

export type DeliveryStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export type OnboardingStep =
  | 'IDLE'
  | 'WAITING_MORNING_TIME'
  | 'WAITING_EVENING_TIME'
  | 'WAITING_UPDATE_MORNING_TIME'
  | 'WAITING_UPDATE_EVENING_TIME'
  | 'WAITING_LOCATION';

export interface UserRecord {
  id: string;
  telegram_user_id: string;
  telegram_chat_id: string;
  timezone: string;
  lat: number | null;
  lon: number | null;
  morning_time: string | null;
  evening_time: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserStateRecord {
  telegram_user_id: string;
  step: OnboardingStep;
  payload: Record<string, unknown>;
  updated_at: string;
}

export interface MoonData {
  phase: string;
  phaseRu: string;
  age: number;
  illumination: number;
}

export interface PanchangData {
  tithi: string;
  nakshatra: string;
}

export interface RuleDetails {
  meaning: string[];
  focus: string[];
  practices: string[];
  food: string[];
}
