-- The Worker authenticates to PostgREST with Supabase's service_role key.
-- Our RPC functions are SECURITY INVOKER, so the role needs access to the
-- application tables even though it bypasses row-level security.
set local search_path = public;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Keep the Worker working when a later migration creates an application table.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

notify pgrst, 'reload schema';
