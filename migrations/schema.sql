create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  timezone text not null default 'Europe/Amsterdam',
  morning_time text,
  evening_time text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_morning_time_format check (morning_time is null or morning_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint users_evening_time_format check (evening_time is null or evening_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);

create trigger users_set_updated_at
before update on users
for each row execute function set_updated_at();

create table if not exists user_states (
  telegram_user_id bigint primary key,
  step text not null default 'IDLE',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_states_step_allowed check (
    step in (
      'IDLE',
      'WAITING_MORNING_TIME',
      'WAITING_EVENING_TIME',
      'WAITING_UPDATE_MORNING_TIME',
      'WAITING_UPDATE_EVENING_TIME'
    )
  )
);

create trigger user_states_set_updated_at
before update on user_states
for each row execute function set_updated_at();

create table if not exists delivery_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  delivery_type text not null check (delivery_type in ('MORNING', 'EVENING')),
  target_date date not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null check (status in ('SENT', 'FAILED', 'SKIPPED')),
  error text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists idx_delivery_logs_user_id on delivery_logs(user_id);
create index if not exists idx_delivery_logs_target_date on delivery_logs(target_date);
