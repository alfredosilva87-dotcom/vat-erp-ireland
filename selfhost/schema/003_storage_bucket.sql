-- @role: supabase_admin
-- @needs: storage
--
-- Run as `supabase_admin` — storage.buckets is owned by
-- supabase_storage_admin, and the `postgres` role is not a superuser in the
-- Supabase image, so it gets "permission denied for table buckets".
--
-- Apply this AFTER the stack is fully up (storage-api service must have
-- initialized the `storage` schema first — it does this automatically on
-- first boot). Creates the "documents" bucket used for invoice PDFs/images.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
