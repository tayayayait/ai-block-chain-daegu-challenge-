-- Supabase-managed projects expose an `extensions` schema. Creating it here
-- keeps a plain PostgreSQL reset deterministic as well.
create schema if not exists extensions;

create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgtap with schema extensions;
