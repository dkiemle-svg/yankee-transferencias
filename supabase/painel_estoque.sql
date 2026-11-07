-- =====================================================================
--  Painel de Estoque (Loja ZN Salão)
--  - Insumos e fichas técnicas importados da 3LM; estoque calculado a partir
--    das contagens do painel (D0), nunca do saldo da 3LM.
--  - Saída por venda: produtos vendidos (fin_itens) × ficha técnica, por uma
--    função que só devolve quantidades (quem não tem o Financeiro não vê R$ de venda).
--  - Acesso: masters + quem tiver 'estoque' em profiles.access + perfil 'estoque'.
--  Rode depois do painel_produtos.sql (SQL Editor → New query → Run)
-- =====================================================================

-- Perfil próprio para quem só usa o Estoque (ex.: Paloma)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','hub','pending','nutri','estoque'));

create or replace function has_panel(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and ((master and p <> 'financeiro')
            or p = any(access)
            or (p = 'transferencias' and role in ('admin','hub'))
            or (p = 'nutricao' and role = 'nutri')
            or (p = 'estoque' and role = 'estoque'))
  );
$$;

-- Insumos (cadastro da 3LM + ajustes do painel)
create table if not exists est_insumos (
  codigo        text primary key,              -- código do produto na 3LM
  nome          text not null,
  unidade       text not null default 'UND',
  categoria     text not null default 'OUTROS',
  ativo         boolean not null default true, -- entra na lista e na contagem
  litros        numeric(10,3),                 -- conteúdo em litros (bags de post-mix)
  preco_medio   numeric(12,4) not null default 0,  -- da 3LM, até haver entradas no painel
  preco_ultimo  numeric(12,4) not null default 0,
  estoque_min   numeric(12,3) not null default 0,
  tolerancia    numeric(6,4) not null default 0.03,  -- desvio aceito na contagem
  updated_at    timestamptz not null default now()
);

-- Itens do cardápio (preço de venda, seção, marcação estratégica para os insights)
create table if not exists est_pratos (
  codigo       text primary key,               -- mesmo código das vendas (fin_itens)
  nome         text not null,
  secao        text,
  preco_venda  numeric(12,2) not null default 0,
  estrategico  boolean not null default false,
  updated_at   timestamptz not null default now()
);

-- Ficha técnica de venda: 1 unidade do prato consome qtd do insumo
create table if not exists est_fichas (
  produto_codigo text not null,
  insumo_codigo  text not null,
  qtd            numeric(12,4) not null check (qtd >= 0),
  primary key (produto_codigo, insumo_codigo)
);

-- Ficha de produção: 1 unidade (kg, lt…) do processado consome qtd do insumo
create table if not exists est_fichas_producao (
  processado_codigo text not null references est_insumos(codigo) on delete cascade,
  insumo_codigo     text not null references est_insumos(codigo) on delete cascade,
  qtd               numeric(12,4) not null check (qtd >= 0),
  primary key (processado_codigo, insumo_codigo)
);

-- Movimentos lançados no painel
create table if not exists est_movs (
  id            uuid primary key default gen_random_uuid(),
  dia           date not null,
  insumo_codigo text not null references est_insumos(codigo) on delete cascade,
  tipo          text not null check (tipo in ('entrada','manual','producao_in','producao_out','perda','ajuste')),
  qtd           numeric(12,4) not null,        -- positivo; o sinal vem do tipo (ajuste pode ser negativo)
  custo_unit    numeric(12,4),
  lote          uuid,                          -- agrupa os movimentos de uma produção ou nota
  ref           text,                          -- nº da nota / fornecedor / motivo
  obs           text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists est_movs_dia_idx on est_movs (dia);
create index if not exists est_movs_insumo_idx on est_movs (insumo_codigo);

-- Contagens
create table if not exists est_contagens (
  id          uuid primary key default gen_random_uuid(),
  corte       date not null,                   -- estoque contado ao fim deste dia
  status      text not null default 'aberta' check (status in ('aberta','fechada')),
  obs         text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  fechada_em  timestamptz,
  fechada_por uuid
);
create table if not exists est_contagem_itens (
  contagem_id   uuid not null references est_contagens(id) on delete cascade,
  insumo_codigo text not null references est_insumos(codigo) on delete cascade,
  qtd           numeric(12,4) not null check (qtd >= 0),
  contado_por   uuid default auth.uid(),
  at            timestamptz not null default now(),
  primary key (contagem_id, insumo_codigo)
);

-- Ligação produto de transferência → insumo do estoque (com fator de conversão)
create table if not exists est_transf_map (
  product_name  text primary key,
  insumo_codigo text not null references est_insumos(codigo) on delete cascade,
  fator         numeric(12,4) not null default 1
);

do $$
declare t text;
begin
  foreach t in array array['est_insumos','est_pratos','est_fichas','est_fichas_producao','est_movs','est_contagens','est_contagem_itens','est_transf_map'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_all', t);
    execute format('create policy %I on %I for all to authenticated using (has_panel(''estoque'')) with check (has_panel(''estoque''))', t || '_all', t);
  end loop;
end $$;

-- Saídas calculadas: vendas × ficha técnica e transferências da loja para os hubs.
-- Só quantidades, por dia e insumo (com o prato de origem para o histórico).
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
$$;

-- Vendas por produto (só quantidades) para o consumo por refil e produtos sem ficha
create or replace function est_vendas(de date)
returns table (dia date, codigo text, nome text, qtd numeric)
language sql stable security definer set search_path = public as $$
  select dia, codigo, nome, qtd from fin_itens where has_panel('estoque') and dia >= de and unidade = 'ZN Salão'
$$;

-- Produtos de transferência (nomes) para a ligação com o estoque
create or replace function est_produtos_transf()
returns table (product_name text, unit text, qtd numeric)
language sql stable security definer set search_path = public as $$
  select t.product_name, max(p.unit), sum(t.quantity)
    from transfers t left join products p on p.id = t.product_id
   where has_panel('estoque') group by t.product_name
$$;

-- Acessos: Raquel ganha o Estoque (masters já têm)
update profiles set access = array(select distinct unnest(access || '{estoque}'::text[]))
 where lower(email) like 'raquel@%';
