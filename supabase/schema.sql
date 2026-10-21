-- =====================================================================
--  Yankee Burger · Controle de Transferências
--  Execute este arquivo inteiro no Supabase: SQL Editor → New query → Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Unidades
-- ---------------------------------------------------------------------
create table if not exists units (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  is_hub      boolean not null default false,
  created_at  timestamptz not null default now()
);

insert into units (code, name, is_hub) values
  ('YANKEE', 'Yankee Burger', false),
  ('ZN',     'HubFood ZN',    true),
  ('BV',     'HubFood BV',    true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- Perfis de usuário (ligados ao login do Supabase Auth)
--   role: admin   -> vê e edita tudo (ex.: Raquel)
--         hub     -> vê apenas transferências da sua unidade
--         pending -> conta criada, aguardando liberação do admin
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'pending' check (role in ('admin','hub','pending')),
  unit_id     uuid references units(id) on delete set null,
  prefs       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Usuários master (acesso total) já reservados: ao criar a conta com esse
-- usuário, ela nasce como admin. Os demais entram como "pending".
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  usr text := lower(new.email);
  masters jsonb := '{"danielkiemle@yankeeburger.com.br": "Daniel Kiemle",
                     "raquel@yankeeburger.com.br": "Raquel",
                     "henrique@yankeeburger.com.br": "Henrique"}';
begin
  insert into profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(masters->>usr, nullif(new.raw_user_meta_data->>'name', ''), split_part(usr, '@', 1)),
    case when masters ? usr then 'admin' else 'pending' end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function my_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select unit_id from profiles where id = auth.uid() and role = 'hub';
$$;

-- ---------------------------------------------------------------------
-- Produtos
-- ---------------------------------------------------------------------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  price       numeric(12,2) not null default 0 check (price >= 0),
  unit        text not null default 'kg' check (unit in ('kg','un')),  -- kg ou un
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Transferências
--   unit_price é copiado do cadastro no momento do lançamento,
--   então mudar o preço do produto não altera o histórico.
-- ---------------------------------------------------------------------
create table if not exists transfers (
  id              uuid primary key default gen_random_uuid(),
  date            date not null default current_date,
  origin_id       uuid not null references units(id),
  destination_id  uuid not null references units(id),
  product_id      uuid references products(id) on delete set null,
  product_name    text not null,
  quantity        numeric(12,4) not null check (quantity > 0),
  unit_price      numeric(12,2) not null check (unit_price >= 0),
  total           numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  notes           text,
  paid            boolean not null default false,
  paid_at         timestamptz,
  paid_by         uuid references auth.users(id),
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint origin_differs check (origin_id <> destination_id)
);

create index if not exists transfers_date_idx on transfers (date desc);
create index if not exists transfers_dest_idx on transfers (destination_id);
create index if not exists transfers_origin_idx on transfers (origin_id);
create index if not exists transfers_product_idx on transfers (product_name);

-- ---------------------------------------------------------------------
-- Marcar pago / em aberto em lote
--   admin: qualquer transferência
--   hub:   apenas as que a sua unidade RECEBEU (destino)
-- ---------------------------------------------------------------------
create or replace function set_paid(ids uuid[], value boolean) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('app.via_set_paid', '1', true);
  update transfers t
     set paid    = value,
         paid_at = case when value then now() else null end,
         paid_by = case when value then auth.uid() else null end
   where t.id = any(ids)
     and (is_admin() or t.destination_id = my_unit());
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table units     enable row level security;
alter table profiles  enable row level security;
alter table products  enable row level security;
alter table transfers enable row level security;

-- units
drop policy if exists units_read  on units;
drop policy if exists units_write on units;
create policy units_read  on units for select to authenticated using (true);
create policy units_write on units for all    to authenticated using (is_admin()) with check (is_admin());

-- profiles
drop policy if exists profiles_read        on profiles;
drop policy if exists profiles_admin       on profiles;
drop policy if exists profiles_self_prefs  on profiles;
create policy profiles_read  on profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profiles_admin on profiles for update to authenticated using (is_admin()) with check (is_admin());

-- Usuário comum só pode salvar as próprias preferências do dashboard
create or replace function save_prefs(value jsonb) returns void
language sql security definer set search_path = public as $$
  update profiles set prefs = value where id = auth.uid();
$$;

-- products
drop policy if exists products_read  on products;
drop policy if exists products_write on products;
create policy products_read  on products for select to authenticated using (true);
create policy products_write on products for all    to authenticated using (is_admin()) with check (is_admin());

-- transfers
drop policy if exists transfers_read   on transfers;
drop policy if exists transfers_insert on transfers;
drop policy if exists transfers_update on transfers;
drop policy if exists transfers_delete on transfers;

create policy transfers_read on transfers for select to authenticated
  using (is_admin() or origin_id = my_unit() or destination_id = my_unit());

create policy transfers_insert on transfers for insert to authenticated
  with check (is_admin() or origin_id = my_unit() or destination_id = my_unit());

-- hub pode corrigir/excluir o que ele mesmo lançou enquanto não estiver pago
create policy transfers_update on transfers for update to authenticated
  using (is_admin() or (created_by = auth.uid() and paid = false))
  with check (is_admin() or origin_id = my_unit() or destination_id = my_unit());

create policy transfers_delete on transfers for delete to authenticated
  using (is_admin() or (created_by = auth.uid() and paid = false));

-- Status de pagamento só muda pelo admin ou pela função set_paid
create or replace function guard_paid() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid is distinct from old.paid
     and not is_admin()
     and coalesce(current_setting('app.via_set_paid', true), '') <> '1' then
    raise exception 'Use o botão Pago/Em aberto para alterar o pagamento';
  end if;
  return new;
end $$;
drop trigger if exists transfers_guard_paid on transfers;
create trigger transfers_guard_paid before update on transfers
  for each row execute function guard_paid();

-- Mantém updated_at dos produtos
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists products_touch on products;
create trigger products_touch before update on products
  for each row execute function touch_updated_at();

-- Administrativo redefine a senha de alguém da equipe
create or replace function admin_set_password(target uuid, new_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not is_admin() then raise exception 'Somente o administrativo pode redefinir senhas'; end if;
  if length(coalesce(new_password, '')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres'; end if;
  update auth.users
     set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now()
   where id = target;
end $$;
revoke execute on function admin_set_password(uuid, text) from anon;
