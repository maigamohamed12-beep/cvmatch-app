-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
create extension if not exists pgcrypto;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  plan text not null check (plan in ('single', 'monthly')),
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  code_hash text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz
);

create index if not exists orders_ref_idx on orders (ref);
create index if not exists orders_status_idx on orders (status);

-- Row Level Security stays enabled with no public policies: only the service-role
-- key (used server-side by the API routes, never shipped to the browser) can read
-- or write this table.
alter table orders enable row level security;

-- Atomic "attempts += 1" for /api/verify-code. A plain read-then-write from
-- the API (select attempts, then update attempts + 1) is two round trips:
-- concurrent guesses against the same order can all read the same starting
-- value and all pass the MAX_ATTEMPTS check before any of their increments
-- land, silently defeating the attempts cap. Doing the increment inside a
-- single SQL statement removes that gap.
create or replace function increment_order_attempts(p_order_id uuid)
returns int
language sql
security definer
set search_path = public
as $$
  update orders set attempts = attempts + 1 where id = p_order_id returning attempts;
$$;

-- Per-IP daily cap on AI generations (/api/generate, /api/generate-english),
-- which otherwise have no server-side limit at all and can be called
-- directly (bypassing the site) to run up the Anthropic bill for free.
create table if not exists generation_log (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists generation_log_ip_created_idx on generation_log (ip, created_at);

alter table generation_log enable row level security;

-- Lifetime free-analysis quota per browser (/api/generate only, for
-- unlocked/paying users this is bypassed entirely - see lib/orders.js).
-- Separate from generation_log above on purpose: that one is a rolling
-- 24h anti-abuse cap by IP, this one is a permanent per-device count that
-- drives the free-tier -> paid conversion nudge, so mixing the two would
-- make either one harder to reason about.
create table if not exists free_quota_usage (
  id bigint generated always as identity primary key,
  device_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists free_quota_usage_device_idx on free_quota_usage (device_id);

alter table free_quota_usage enable row level security;
