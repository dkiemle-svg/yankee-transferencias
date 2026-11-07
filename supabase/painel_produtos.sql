-- =====================================================================
--  Financeiro → Produtos vendidos
--  - fin_itens: itens vendidos por dia (3LM → Relatórios → Itens vendidos → Dia a Dia)
--  - fin_produtos: categoria de cada produto (ajustável no painel)
--  - Mesmo acesso do Financeiro: só quem tem 'financeiro' liberado.
--  Rode depois do painel_financeiro.sql (SQL Editor → New query → Run)
-- =====================================================================

create table if not exists fin_itens (
  dia       date not null,
  unidade   text not null default 'ZN Salão',
  codigo    text not null,                     -- código do produto no 3LM
  nome      text not null,
  qtd       numeric(12,3) not null default 0,  -- quantidade vendida
  qtd_lanc  numeric(12,3) not null default 0,  -- quantidade de lançamentos
  valor     numeric(12,2) not null default 0,  -- total vendido
  primary key (dia, unidade, codigo)
);
create index if not exists fin_itens_dia_idx on fin_itens (dia);

create table if not exists fin_produtos (
  codigo     text primary key,
  nome       text not null,
  categoria  text not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['fin_itens','fin_produtos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (has_panel(''financeiro'')) with check (has_panel(''financeiro''))', t || '_all', t);
  end loop;
end $$;
