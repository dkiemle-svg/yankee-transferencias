-- =====================================================================
--  Eventos (vendas fora da 3LM, nota emitida à parte) + análises (Insights)
--  - Evento agendado não mexe em nada. Marcado como "realizado", entra na
--    receita de eventos da DRE e baixa o estoque pelas fichas técnicas.
--  - Mesmo acesso do Financeiro.
--  Rode depois do painel_estoque.sql (SQL Editor → New query → Run)
-- =====================================================================

create table if not exists fin_eventos (
  id         uuid primary key default gen_random_uuid(),
  dia        date not null,
  nome       text not null,
  cliente    text,
  nota       text,                                  -- nº da nota emitida
  status     text not null default 'agendado' check (status in ('agendado','realizado','cancelado')),
  obs        text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_eventos_dia_idx on fin_eventos (dia);

create table if not exists fin_evento_itens (
  evento_id uuid not null references fin_eventos(id) on delete cascade,
  codigo    text not null,                          -- código do prato (mesmo das vendas/fichas)
  nome      text not null,
  qtd       numeric(12,3) not null check (qtd > 0),
  preco     numeric(12,2) not null default 0,       -- preço especial por unidade
  primary key (evento_id, codigo)
);

-- Análises escritas (Claude/Daniel) para a aba Insights
create table if not exists fin_insights (
  id        uuid primary key default gen_random_uuid(),
  dia       date not null default current_date,
  titulo    text not null,
  texto     text not null,
  tag       text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['fin_eventos','fin_evento_itens','fin_insights'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (has_panel(''financeiro'')) with check (has_panel(''financeiro''))', t || '_all', t);
  end loop;
end $$;

-- Saídas calculadas: vendas, transferências para os hubs e eventos realizados (só quantidades)
create or replace function est_saidas(de date)
returns table (dia date, insumo_codigo text, tipo text, qtd numeric, origem text, origem_qtd numeric)
language sql stable security definer set search_path = public as $$
  select i.dia, f.insumo_codigo, 'venda'::text, sum(i.qtd * f.qtd), i.codigo || ' ' || max(i.nome), sum(i.qtd)
    from fin_itens i join est_fichas f on f.produto_codigo = i.codigo
   where has_panel('estoque') and i.dia >= de and i.unidade = 'ZN Salão'
   group by i.dia, f.insumo_codigo, i.codigo
  union all
  select t.date, m.insumo_codigo, 'transferencia'::text, sum(t.quantity * m.fator), t.product_name || ' → ' || max(u.name), sum(t.quantity)
    from transfers t join est_transf_map m on m.product_name = t.product_name
    join units o on o.id = t.origin_id join units u on u.id = t.destination_id
   where has_panel('estoque') and t.date >= de and not coalesce(o.is_hub, false)
   group by t.date, m.insumo_codigo, t.product_name
  union all
  select e.dia, f.insumo_codigo, 'evento'::text, sum(it.qtd * f.qtd), it.codigo || ' ' || max(it.nome) || ' · evento ' || max(e.nome), sum(it.qtd)
    from fin_eventos e join fin_evento_itens it on it.evento_id = e.id
    join est_fichas f on f.produto_codigo = it.codigo
   where has_panel('estoque') and e.status = 'realizado' and e.dia >= de
   group by e.dia, f.insumo_codigo, it.codigo, e.id
$$;
