-- =====================================================================
--  Painel Financeiro
--  - Contas a pagar (títulos do 3LM + lançamentos manuais), pagamentos,
--    custos fixos recorrentes, vendas diárias e histórico mensal.
--  - Acesso só com liberação explícita (profiles.access contém 'financeiro'):
--    ser master NÃO libera o Financeiro sozinho.
--  Rode depois do seguranca_acessos.sql (SQL Editor → New query → Run)
-- =====================================================================

-- Painéis com liberação explícita: nem o master vê sem estar em access
create or replace function has_panel(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and ((master and p <> 'financeiro')
            or p = any(access)
            or (p = 'transferencias' and role in ('admin','hub'))
            or (p = 'nutricao' and role = 'nutri'))
  );
$$;

-- Títulos a pagar (do 3LM ou lançados à mão)
create table if not exists fin_lancamentos (
  id            text primary key,              -- id do 3LM (ex.: T001) ou M-… para manual
  tipo          text not null default 'Saída' check (tipo in ('Saída','Entrada')),
  vencimento    date not null,
  competencia   date not null,
  pagamento     date,                          -- data de pagamento vinda do 3LM, se houver
  unidade       text not null default 'ZN Salão',
  grupo         text not null,                 -- linha da DRE (CMV, Pessoal, Ocupação…)
  categoria     text,
  subcategoria  text,
  contraparte   text not null,                 -- fornecedor
  valor         numeric(12,2) not null check (valor >= 0),
  origem        text not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fin_lanc_venc_idx on fin_lancamentos (vencimento);

-- Pagamentos marcados no painel (id do título, ou CF-<custo fixo>-<AAAA-MM>)
create table if not exists fin_pagamentos (
  id     text primary key,
  data   date not null,
  at     timestamptz not null default now(),
  by     uuid default auth.uid()
);

-- Custos fixos: viram um título por mês a partir do início
create table if not exists fin_custos_fixos (
  id          uuid primary key default gen_random_uuid(),
  descricao   text not null,
  grupo       text not null,
  categoria   text,
  unidade     text not null default 'ZN Salão',
  valor       numeric(12,2) not null check (valor > 0),
  dia         int not null check (dia between 1 and 31),
  inicio      text not null,                   -- AAAA-MM
  fim         text,                            -- AAAA-MM
  pausado_em  text,                            -- AAAA-MM
  created_at  timestamptz not null default now()
);

-- Vendas por dia e forma de pagamento (3LM Gourmet)
create table if not exists fin_vendas (
  dia      date not null,
  unidade  text not null default 'ZN Salão',
  forma    text not null,
  grupo    text not null check (grupo in ('Crédito','Débito','Pix','Dinheiro','Outros')),
  valor    numeric(12,2) not null,
  primary key (dia, unidade, forma)
);

-- Faturamento mensal (histórico para a meta) com a terça da promoção
create table if not exists fin_historico (
  mes          date not null,                  -- primeiro dia do mês
  unidade      text not null default 'ZN Salão',
  total        numeric(12,2) not null,
  promo_dia    date,
  promo_valor  numeric(12,2) not null default 0,
  primary key (mes, unidade)
);

do $$
declare t text;
begin
  foreach t in array array['fin_lancamentos','fin_pagamentos','fin_custos_fixos','fin_vendas','fin_historico'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (has_panel(''financeiro'')) with check (has_panel(''financeiro''))', t || '_all', t);
  end loop;
end $$;

-- Libera o Financeiro para o Daniel
update profiles set access = array(select distinct unnest(access || '{financeiro}'::text[]))
 where lower(email) = 'danielkiemle@yankeeburger.com.br';
