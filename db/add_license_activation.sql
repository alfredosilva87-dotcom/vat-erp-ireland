-- Self-service licence renewal: master generates a renewal key without
-- touching the live licence, hands it to the client out of band, and the
-- company's own admin activates it from Settings. Plus an audit trail so
-- master can see renewal history per company.
alter table companies add column if not exists pending_license_key text;
alter table companies add column if not exists pending_license_expires_at date;

create table if not exists license_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  event_type text not null, -- 'created' | 'renewed_by_master' | 'key_regenerated' | 'activated' | 'deactivated' | 'renewal_generated' | 'activated_by_admin'
  old_expires_at date,
  new_expires_at date,
  actor_email text,
  created_at timestamptz not null default now()
);
create index if not exists idx_license_events_company on license_events(company_id, created_at desc);
