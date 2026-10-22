-- =====================================================================
--  Segurança de acessos
--  - Toda conta nova nasce SEM acesso a nada (nem os usuários reservados).
--  - Só um usuário master libera ou altera acessos (perfil, unidade, painéis).
--  - Quem não tem painel liberado não lê unidades, produtos nem transferências.
--  Rode depois do painel_nutricao.sql (SQL Editor → New query → Run)
-- =====================================================================

-- Conta nova: sempre "aguardando liberação"
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name, role, master, access)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(lower(new.email), '@', 1)),
          'pending', false, '{}');
  return new;
end $$;

-- Perfil, unidade, master e painéis: só um master altera
create or replace function guard_profile_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_master()
     and (new.role    is distinct from old.role
       or new.unit_id is distinct from old.unit_id
       or new.master  is distinct from old.master
       or new.access  is distinct from old.access) then
    raise exception 'Só um usuário master pode liberar ou alterar acessos.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_access on profiles;
create trigger profiles_guard_access before update on profiles
  for each row execute function guard_profile_access();

-- Unidades e produtos: só para quem tem algum painel liberado
drop policy if exists units_read on units;
create policy units_read on units for select to authenticated
  using (has_panel('transferencias') or has_panel('nutricao'));

drop policy if exists products_read on products;
create policy products_read on products for select to authenticated
  using (has_panel('transferencias'));

-- Transferências: quem perdeu o acesso não edita nem exclui o que lançou
drop policy if exists transfers_update on transfers;
create policy transfers_update on transfers for update to authenticated
  using (is_admin() or (created_by = auth.uid() and paid = false and my_unit() is not null))
  with check (is_admin() or origin_id = my_unit() or destination_id = my_unit());

drop policy if exists transfers_delete on transfers;
create policy transfers_delete on transfers for delete to authenticated
  using (is_admin() or (created_by = auth.uid() and paid = false and my_unit() is not null));
