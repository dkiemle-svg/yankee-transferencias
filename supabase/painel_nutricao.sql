-- =====================================================================
--  Central de gestão · acessos por painel + Painel Nutrição
--  Rode depois do schema.sql (SQL Editor → New query → Run)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Acesso por painel
--   master = vê todos os painéis
--   access = lista de painéis liberados (ex.: {nutricao})
-- ---------------------------------------------------------------------
alter table profiles add column if not exists master boolean not null default false;
alter table profiles add column if not exists access text[] not null default '{}';
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','hub','pending','nutri'));

update profiles set master = true, role = 'admin'
 where lower(email) in ('danielkiemle@yankeeburger.com.br','henrique@yankeeburger.com.br');
-- Raquel: administrativo com acesso só ao painel Transferências
update profiles set master = false, role = 'admin', access = '{transferencias}'
 where lower(email) = 'raquel@yankeeburger.com.br';

-- Usuários reservados: masters, Raquel (Transferências) e a nutricionista
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  usr text := lower(new.email);
  masters jsonb := '{"danielkiemle@yankeeburger.com.br": "Daniel Kiemle",
                     "henrique@yankeeburger.com.br": "Henrique"}';
begin
  insert into profiles (id, email, name, role, master, access)
  values (
    new.id,
    new.email,
    coalesce(masters->>usr, case usr when 'rebeca@yankeeburger.com.br' then 'Rebeca' when 'raquel@yankeeburger.com.br' then 'Raquel' end,
             nullif(new.raw_user_meta_data->>'name', ''), split_part(usr, '@', 1)),
    case when masters ? usr or usr = 'raquel@yankeeburger.com.br' then 'admin' when usr = 'rebeca@yankeeburger.com.br' then 'nutri' else 'pending' end,
    masters ? usr,
    case usr when 'rebeca@yankeeburger.com.br' then '{nutricao}'::text[] when 'raquel@yankeeburger.com.br' then '{transferencias}'::text[] else '{}'::text[] end
  );
  return new;
end $$;

create or replace function is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and master);
$$;

create or replace function has_panel(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and (master
            or p = any(access)
            or (p = 'transferencias' and role in ('admin','hub'))
            or (p = 'nutricao' and role = 'nutri'))
  );
$$;

-- Só um master pode dar ou tirar acesso master / acesso a painéis
create or replace function guard_profile_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_master()
     and (new.master is distinct from old.master or new.access is distinct from old.access) then
    raise exception 'Só um usuário master pode alterar o acesso aos painéis.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_access on profiles;
create trigger profiles_guard_access before update on profiles
  for each row execute function guard_profile_access();

-- Redefinir senha: quem não é master não mexe na senha de masters nem da nutricionista
create or replace function admin_set_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not is_admin() then raise exception 'Somente o administrativo pode redefinir senhas'; end if;
  if not is_master() and exists (select 1 from profiles where id = target and (master or role = 'nutri')) then
    raise exception 'Só um usuário master pode redefinir a senha deste usuário';
  end if;
  if length(coalesce(new_password, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres'; end if;
  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now()
   where id = target;
end $$;
revoke execute on function admin_set_password(uuid, text) from anon;

-- ---------------------------------------------------------------------
-- Painel Nutrição
-- ---------------------------------------------------------------------
create table if not exists nutri_employees (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  aliases     text[] not null default '{}',   -- apelidos usados no texto (Ju, Eli…)
  role        text,
  unit        text not null default 'YANKEE',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists nutri_reports (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  text         text not null,
  photos       text[] not null default '{}',  -- caminhos no Storage (bucket nutri-fotos)
  author_id    uuid references auth.users(id) default auth.uid(),
  author_name  text,
  created_at   timestamptz not null default now()
);

create table if not exists nutri_points (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references nutri_reports(id) on delete cascade,
  date         date not null,
  employee_id  uuid references nutri_employees(id) on delete set null,  -- null = geral / estrutura
  type         text not null check (type in ('pos','neg')),
  sector       text,
  text         text not null,
  involved     uuid[] not null default '{}',  -- quem vai cobrar / acompanhar
  status       text check (status in ('aberto','resolvido')),
  response     text,
  due_date     date,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists nutri_points_emp_idx on nutri_points (employee_id);
create index if not exists nutri_points_date_idx on nutri_points (date);

create table if not exists nutri_settings (
  id    int primary key default 1 check (id = 1),
  data  jsonb not null
);
insert into nutri_settings (id, data) values (1, '{"weights":{"pos":1,"neg":-1,"resolved":0.5},"goal":{"min_score":4,"max_open":1,"reward":"Bônus de R$ 150 no mês","active":true}}')
on conflict (id) do nothing;

alter table nutri_employees enable row level security;
alter table nutri_reports   enable row level security;
alter table nutri_points    enable row level security;
alter table nutri_settings  enable row level security;

drop policy if exists ne_read on nutri_employees;
drop policy if exists ne_write on nutri_employees;
drop policy if exists ne_update on nutri_employees;
drop policy if exists ne_delete on nutri_employees;
create policy ne_read   on nutri_employees for select to authenticated using (has_panel('nutricao'));
create policy ne_write  on nutri_employees for insert to authenticated with check (has_panel('nutricao'));
create policy ne_update on nutri_employees for update to authenticated using (has_panel('nutricao')) with check (has_panel('nutricao'));
create policy ne_delete on nutri_employees for delete to authenticated using (is_master());

drop policy if exists nr_read on nutri_reports;
drop policy if exists nr_insert on nutri_reports;
drop policy if exists nr_update on nutri_reports;
drop policy if exists nr_delete on nutri_reports;
create policy nr_read   on nutri_reports for select to authenticated using (has_panel('nutricao'));
create policy nr_insert on nutri_reports for insert to authenticated with check (has_panel('nutricao'));
create policy nr_update on nutri_reports for update to authenticated using (is_master()) with check (is_master());
create policy nr_delete on nutri_reports for delete to authenticated using (is_master());

drop policy if exists np_read on nutri_points;
drop policy if exists np_insert on nutri_points;
drop policy if exists np_update on nutri_points;
drop policy if exists np_delete on nutri_points;
create policy np_read   on nutri_points for select to authenticated using (has_panel('nutricao'));
create policy np_insert on nutri_points for insert to authenticated with check (has_panel('nutricao'));
create policy np_update on nutri_points for update to authenticated using (is_master()) with check (is_master());
create policy np_delete on nutri_points for delete to authenticated using (is_master());

drop policy if exists ns_read on nutri_settings;
drop policy if exists ns_write on nutri_settings;
create policy ns_read  on nutri_settings for select to authenticated using (has_panel('nutricao'));
create policy ns_write on nutri_settings for all    to authenticated using (is_master()) with check (is_master());

-- Fotos dos relatórios (privadas)
insert into storage.buckets (id, name, public) values ('nutri-fotos', 'nutri-fotos', false)
on conflict (id) do nothing;
drop policy if exists nutri_fotos_read on storage.objects;
drop policy if exists nutri_fotos_insert on storage.objects;
drop policy if exists nutri_fotos_delete on storage.objects;
create policy nutri_fotos_read   on storage.objects for select to authenticated using (bucket_id = 'nutri-fotos' and public.has_panel('nutricao'));
create policy nutri_fotos_insert on storage.objects for insert to authenticated with check (bucket_id = 'nutri-fotos' and public.has_panel('nutricao'));
create policy nutri_fotos_delete on storage.objects for delete to authenticated using (bucket_id = 'nutri-fotos' and public.is_master());
