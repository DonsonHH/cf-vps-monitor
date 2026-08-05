-- Defaults for the Donson deployment. They deliberately apply only to a fresh
-- installation or an untouched upstream default, so administrator customisations
-- made later in the site settings are never overwritten by a database re-init.
set local search_path = public;

update settings
set value = 'Azure实时监测'
where key = 'site_title'
  and value in ('', 'CF Monitor', 'CF VPS Monitor');

update settings
set value = 'Donsonの探针'
where key = 'site_subtitle'
  and value = '';

update settings
set value = 'Azure 服务器实时监测'
where key = 'site_description'
  and value in ('', '服务器监控探针');

insert into settings (key, value) values
  ('site_title', 'Azure实时监测'),
  ('site_subtitle', 'Donsonの探针'),
  ('site_description', 'Azure 服务器实时监测')
on conflict (key) do nothing;

insert into settings (key, value)
values ('schema_bootstrap_version', 'donson-2026-08-05-v1')
on conflict (key) do update set value = excluded.value;
