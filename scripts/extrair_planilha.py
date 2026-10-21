"""
Converte a planilha "Controle Yankee Hub" em:
  - supabase/seed.sql         -> carga inicial no Supabase (produtos + transferências)
  - src/lib/seed.json         -> dados usados no modo demonstração

Uso:  python3 scripts/extrair_planilha.py caminho/da/planilha.xlsx
"""
import json, sys, datetime, re
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
src = sys.argv[1]
wb = openpyxl.load_workbook(src, data_only=True)

# "Yankee/Hubfood - ZS" na planilha = unidade HubFood BV
ROTAS = {
    "Yankee/Hubfood - ZN": ("YANKEE", "ZN"),
    "Yankee/Hubfood - ZS": ("YANKEE", "BV"),
    "Yankee/Hubfood - BV": ("YANKEE", "BV"),
    "Hubfood - ZN/Yankee": ("ZN", "YANKEE"),
    "Hubfood - ZS/Yankee": ("BV", "YANKEE"),
    "Hubfood - BV/Yankee": ("BV", "YANKEE"),
}

ajustes = []
transfers = []
ws = wb["Controle"]
rows = [r for r in ws.iter_rows(min_row=10, values_only=True) if r[0] or r[2]]
prev_route = None
for n, r in enumerate(rows, start=10):
    rota, data, prod, qtd, vu, _tot, obs, conf, pago = r[:9]
    if rota is None:
        rota = prev_route
        ajustes.append(f"linha ~{n}: origem/destino vazio -> assumido '{rota}' (linhas vizinhas)")
    prev_route = rota
    origem, destino = ROTAS[rota.strip()]
    if isinstance(data, datetime.datetime):
        data = data.date()
    if data.year == 2025 and data.month < 12:
        novo = data.replace(year=2026)
        ajustes.append(f"{prod}: data {data} corrigida para {novo} (erro de digitação provável)")
        data = novo
    notas = " | ".join(str(x).strip() for x in (obs, conf) if x and str(x).strip())
    transfers.append({
        "date": data.isoformat(),
        "origin": origem,
        "destination": destino,
        "product": str(prod).strip(),
        "quantity": round(float(qtd), 4),
        "unit_price": round(float(vu), 2),
        "notes": notas or None,
        "paid": bool(pago) and str(pago).strip().lower() in ("sim", "s", "pago", "x", "ok", "true", "1"),
    })

# ---------------------------------------------------------------------
# Ajustes pedidos pelo Daniel
# ---------------------------------------------------------------------
# 1) Lançamentos de QUEIJO ULTRA com obs "pumpkin" são o Queijo Pumpkin (R$ 53,50 na tabela)
for t in transfers:
    if t["product"] == "QUEIJO ULTRA" and t["notes"] and "pumpk" in t["notes"].lower():
        t["product"] = "QUEIJO ULTRA PUMPKIN"
# 2) Maionese trufada: preço oficial R$ 50,00 (valores fora do padrão já corrigidos na planilha)
for t in transfers:
    if t["product"] == "MAIONESE TRUFADA" and t["unit_price"] not in (50.0, 50.02):
        ajustes.append(f"corrigido: {t['date']} MAIONESE TRUFADA R$ {t['unit_price']} -> R$ 50,00")
        t["unit_price"] = 50.0

# ---------------------------------------------------------------------
# Tabela oficial de preços (aba "Itens valor") cruzada com o cadastro
# ---------------------------------------------------------------------
TABELA = {  # produto do cadastro: (linha da aba Itens valor, preço por unidade de medida)
    "CEBOLA CARAMELIZADA": ("Cebola caramelizada", 34.00),
    "CEBOLA CARAMELIZADA PUMPKIN": ("Cebola caramelizada pumpink", 34.00),
    "MARINADA": ("Marinada da sobrecoxa (a cada 13 unds)", 3.00),
    "MOLHO CITRICO": ("Molho cítrico", 50.24),
    "MOLHO DA CASA (YANKEE SAUCE)": ("Molho da casa", 25.70),
    "MAIONESE BASE": ("Molho de maionese", 24.54),
    "MOLHO DE QUEIJO": ("Molho de queijo", 39.46),
    "MOLHO SPICY": ("Molho spicy (picante)", 31.08),
    "QUEIJO ULTRA PUMPKIN": ("Queijo pumpkin", 53.50),
    "QUEIJO ULTRA": ("Queijo ultra", 50.02),
    "FRANGO MARINADO": ("Sobrecoxa natto - steak - marinada", 39.86),
    "MAIONESE TRUFADA": ("Maionese trufada", 50.00),
    "AZEITE TRUFADO": ("Azeite trufado (frasco 125 ml)", 560.00),
    "CREME DE MILHO": ("Creme de milho", 22.00),
    "SACOLA KRAFT VIAGEM": ("Sacola Kraft (pct. 250u)", 0.83),
    "EMBALAGEM BATATA FRITA": ("Batata frita - Nilson (pct. 1000u)", 0.45),
    "EMBALAGEM N4": ("Caixa N4 - Frango - Nilson (pct. 500u)", 0.98),
    "COPO DESCARTAVEL 440ML C/ LOGO": ("Copo Descartável 440ml (pct. 50u)", 0.28),
    "EMBALAGEM NUGGETS": ("Caixa nuggets (pct. 500u)", 0.70),
    "PAO ABOBORA": ("Pão abóbora 1x4 9cm", 2.05),
    "PAO DOG": ("Pão de hot dog 1x5 15cm (R$ 9,24 o pacote)", 1.84),
    "PAO BURGER": ("Pão de batata doce 1x4 9cm (R$ 4,14 o pacote)", 1.16),
    "CARNE DE HAMBURGUER": ("Carne moída gourmet kg", 37.00),
}

# Lançamentos de produtos da tabela com preço diferente -> preço da tabela
# (Carne de hambúrguer fica de fora: as diferenças são reajustes ao longo do ano)
correcoes = []
for t in transfers:
    if t["product"] in TABELA and t["product"] != "CARNE DE HAMBURGUER":
        oficial = TABELA[t["product"]][1]
        if abs(t["unit_price"] - oficial) > 0.005:
            correcoes.append((t["date"], t["product"], t["unit_price"], oficial, round((oficial - t["unit_price"]) * t["quantity"], 2)))
            t["unit_price"] = oficial

# Unidade de medida: a maioria é kg; embalagens/descartáveis, azeite trufado (frasco inteiro)
# e itens contados por peça (pães, sachês, bebidas, limpeza, utensílios) são "un".
UN_KEYS = [
    "EMBALAGEM", "COPO", "TAMPA", "POTE", "SACOLA", "SACO ", "PAPEL", "CANUDO", "ETIQUETA", "GARFINHO",
    "BOBINA", "GUARDANAPO", "FILME PVC", "FILTRO", "PERFEX", "SACHET", "AZEITE TRUFADO", "PAO ", "MARINADA",
    "LATA", " LN", "CERVEJA", "LONG NECK", "350ML", "290ML", "269 ML", "510ML", "BIB ", "AGUA MINERAL", "RIO SOL",
    "LEMONADE", "REFRI", "GAS CO2", "FRASCO", "PET ", "LUVA", "MASCARA", "TOUCA", "SAPATO", "VASSOURA",
    "CABO DE", "ESCOVA", "ESPONJA", "PANO DE", "PA DE", "PA PLASTICA", "PULVERIZADOR", "GARRAFA", "CANETA",
    "FOSFORO", "CASTELO", "INSETICIDA", "ODORIZADOR", "PASTILHA", "SABONETE", "DESINFETANTE", "DETERGENTE",
    "AGUA SANITARIA", "ACIDO", "ALCOOL", "VIDROL", "VORAZ", "POLIDOR", "PEROXIDO", "VASELINA", "SABAO",
    "CASQUINHO", "FACEBOOK", "GOOGLE", "MENSALIDADE",
]
def unidade(nome):
    n = f" {nome.upper()} "
    return "un" if any(k in n for k in UN_KEYS) else "kg"

# Preço de referência para quem não está na tabela: o mais usado nos últimos 15 lançamentos
from collections import Counter, defaultdict
hist = defaultdict(list)
for t in sorted(transfers, key=lambda t: t["date"]):
    hist[t["product"]].append(t["unit_price"])
preco_uso = {}
for prod, precos in hist.items():
    recentes = precos[-15:]
    cont = Counter(recentes)
    top = max(cont.values())
    preco_uso[prod] = next(p for p in reversed(recentes) if cont[p] == top)

nomes = [str(r[0]).strip() for r in wb["Produtos"].iter_rows(min_row=3, values_only=True) if r[0]]
nomes += [p for p in list(preco_uso) + list(TABELA) if p not in nomes]

products, conferir = [], []
for n in sorted(set(nomes)):
    if n in TABELA:
        price, origem_preco = TABELA[n][1], "tabela"
    elif n in preco_uso:
        price, origem_preco = preco_uso[n], "controle"
    else:
        price, origem_preco = 0, "sem preço"
    products.append({"name": n, "price": price, "unit": unidade(n), "source": origem_preco})

ref = {p["name"]: p["price"] for p in products}
for t in transfers:
    r = ref.get(t["product"]) or 0
    if r and abs(t["unit_price"] - r) > 0.005:
        conferir.append(t)

# ---- seed.json (modo demo)
(ROOT / "src/lib/seed.json").write_text(json.dumps({"products": [{k: p[k] for k in ("name", "price", "unit")} for p in products], "transfers": transfers}, ensure_ascii=False))

# ---- seed.sql
def q(s):
    return "null" if s is None else "'" + str(s).replace("'", "''") + "'"

out = ["-- Carga inicial gerada a partir da planilha Controle Yankee Hub", "begin;"]
out.append("insert into products (name, price, unit) values")
out.append(",\n".join(f"  ({q(p['name'])}, {p['price']}, {q(p['unit'])})" for p in products))
out.append("on conflict (name) do update set price = excluded.price, unit = excluded.unit;")
out.append("")
out.append("insert into transfers (date, origin_id, destination_id, product_id, product_name, quantity, unit_price, notes, paid)")
out.append("select v.date::date, o.id, d.id, p.id, v.product, v.qty, v.price, v.notes, v.paid from (values")
out.append(",\n".join(
    f"  ({q(t['date'])}, {q(t['origin'])}, {q(t['destination'])}, {q(t['product'])}, {t['quantity']}::numeric, {t['unit_price']}::numeric, {q(t['notes'])}, {str(t['paid']).lower()})"
    for t in transfers))
out.append(") as v(date, origin, destination, product, qty, price, notes, paid)")
out.append("join units o on o.code = v.origin")
out.append("join units d on d.code = v.destination")
out.append("left join products p on p.name = v.product;")
out.append("commit;")
(ROOT / "supabase/seed.sql").write_text("\n".join(out) + "\n")

total = sum(t["quantity"] * t["unit_price"] for t in transfers)
print(f"{len(transfers)} transferências, {len(products)} produtos, total R$ {total:,.2f}")
print(f"produtos com preço 0 (sem histórico): {sum(1 for p in products if not p['price'])}")
for a in ajustes:
    print("ajuste:", a)

print("\nPreço por origem:", Counter(p["source"] for p in products))
print("Unidades:", Counter(p["unit"] for p in products))
print("\nLançamentos com preço diferente do cadastro:")
agg = defaultdict(list)
for t in conferir:
    agg[(t["product"], t["unit_price"])].append(t)
for (prod, price), ts in sorted(agg.items()):
    print(f"  {prod}: R$ {price} x{len(ts)} (cadastro R$ {ref[prod]}) datas {sorted(x['date'] for x in ts)[:4]} | dif total R$ {sum((x['unit_price']-ref[prod])*x['quantity'] for x in ts):.2f}")

print("\nCorrigidos para o preço da tabela:", len(correcoes), "| impacto R$", round(sum(c[4] for c in correcoes), 2))
for c in sorted(correcoes): print("  ", c)
