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
