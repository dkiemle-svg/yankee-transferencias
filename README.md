# Yankee Burger · Central de gestão

Página inicial com os **painéis** da Yankee. Cada painel tem um responsável e só aparece para quem tem acesso; os masters veem todos.

| Painel | Responsável | O que faz |
|---|---|---|
| **Transferências** | Raquel · Administrativo | Envios da Yankee para os HubFood (detalhes abaixo) |
| **Nutrição** | Rebeca · Nutricionista | Relatórios das visitas técnicas (texto + fotos), pontos positivos/negativos por funcionário, ações com resposta e prazo, relatório semanal para a equipe (WhatsApp/PDF), ranking e meta de bônus |

### Painel Transferências

Sistema web para registrar e acompanhar as transferências de produtos da **Yankee Burger** para as unidades de delivery **HubFood ZN** e **HubFood BV** — substitui a planilha "Controle Yankee Hub".

- **Transferências** — lançamento (vários itens de uma vez), filtros por período, produto, unidade e status, ordenação por qualquer coluna, seleção múltipla com **"Selecionar tudo"** e **marcar pago em lote**, exportação **CSV** e **PDF**, importação da planilha.
- **Dashboard** — pago × em aberto por mês, saldo por unidade, idade do valor em aberto, evolução semanal, ranking de produtos por valor e quantidade, tabela-resumo. Blocos podem ser escondidos, reordenados e redimensionados (fica salvo por usuário).
- **Cadastros** — produtos com preço (incluir, editar, desativar, excluir), unidades e liberação de acesso da equipe.

**Tecnologia:** React + Vite, banco e login no **Supabase**, publicado no **GitHub Pages**. Custo zero nos planos gratuitos.

---

## Perfis de acesso

| Perfil | Quem | O que pode |
|---|---|---|
| **Administrativo** | Raquel | Vê e edita tudo, marca pago/em aberto, cadastra produtos, unidades e libera usuários |
| **Equipe de delivery** | HubFood ZN / HubFood BV | Vê só as transferências da própria unidade, lança transferências, marca como pago o que **recebeu**, corrige/exclui o que lançou enquanto não estiver pago |
| **Nutricionista** | Rebeca | Só o painel Nutrição: lança relatórios, cadastra funcionários, gera relatórios para a equipe |
| **Master** | Daniel, Raquel, Henrique | Todos os painéis; no Nutrição responde ações, define prazo, marca resolvida e configura a meta |
| **Sem acesso** | Conta recém-criada | Fica aguardando liberação |

As regras são aplicadas no próprio banco (Row Level Security), não só na tela.

---

## Onde está publicado

- **Site:** https://dkiemle-svg.github.io/yankee-transferencias/
- **Banco e login:** projeto Supabase `yankee-transferencias` (São Paulo), na conta dkiemle-svg.
- A conexão com o Supabase fica em `src/config.js` (a chave publicável é pública por natureza; os dados são protegidos pelas regras de acesso do banco).
- Cada `push` na branch `main` publica o site de novo automaticamente (GitHub Actions).

## Acessos

- O login é por **usuário e senha** (sem e-mail). Por baixo, o Supabase guarda `usuario@yankeeburger.com.br`.
- **danielkiemle**, **raquel** e **henrique** são usuários master reservados: ao criar a conta com esse usuário, ela já nasce com acesso total.
- **rebeca** é reservado para a nutricionista: a conta já nasce com acesso só ao painel Nutrição.
- Qualquer outra pessoa cria a conta em “Criar conta” e fica aguardando. Um master libera em **Cadastros → Usuários**, escolhendo o perfil e a unidade.
- Esqueceu a senha? Um master usa **Cadastros → Usuários → Redefinir senha**. Cada pessoa troca a própria senha pelo ícone de chave no topo.

## Montar do zero em outro projeto (se precisar)

1. Supabase → SQL Editor: rode `supabase/schema.sql`, `supabase/painel_nutricao.sql` e depois `supabase/seed.sql` (a carga da planilha não fica no GitHub).
2. Supabase → Authentication → Sign In / Providers: desligue **Confirm email**.
3. Troque URL e chave em `src/config.js`.
4. GitHub → Settings → Pages → Source: **GitHub Actions**.

## Uso no dia a dia

- **Lançar:** *Nova transferência* → origem, destino, data → produto (busca digitando), quantidade. O valor unitário vem do cadastro e o total é calculado. Dá para lançar vários itens no mesmo envio.
- **Pagar em lote:** filtre (ex.: *Semana passada* + *Em aberto* + unidade) → **Selecionar tudo** → **Marcar pago**.
- **Relatórios:** CSV/PDF exportam o que está filtrado — ou só as linhas selecionadas, se houver seleção.
- **Preços:** mudar o preço de um produto vale para os próximos lançamentos; os antigos mantêm o valor gravado.

## Rodar no computador (opcional)

```bash
npm install
cp .env.example .env.local   # preencha com URL e anon key
npm run dev
```

Sem o `.env.local`, o sistema abre em **modo demonstração** com os dados da planilha guardados só no navegador (`npm run build:demo` gera um único `index.html`).

## Atualizar a carga da planilha

```bash
pip install openpyxl
python3 scripts/extrair_planilha.py "Controle Yankee Hub.xlsx"
```

Gera de novo `supabase/seed.sql` e `src/lib/seed.json`. Para lançamentos novos depois que o sistema estiver no ar, prefira o botão **Importar planilha** (ignora linhas que já existem).

## Estrutura

```
supabase/schema.sql        tabelas, regras de acesso (RLS), função de pagamento em lote
supabase/seed.sql          carga da planilha (não versionado)
scripts/extrair_planilha.py  conversor planilha → seed
src/lib/api.js             acesso ao Supabase / modo demo
src/pages/                 Transferências, Dashboard, Cadastros, Login
.github/workflows/deploy.yml  publicação automática no GitHub Pages
```
