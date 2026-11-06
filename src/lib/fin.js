// Painel Financeiro: contas a pagar, custos fixos, vendas, meta e DRE.
import { toISO, today } from './format.js'

export const UNIDADES = ['ZN Salão', 'BV Salão', 'YBZN Legado', 'YBBV Legado']
export const INICIO = '2026-11' // ponto de partida do painel (primeiros títulos do 3LM)

// Linhas da DRE e categorias sugeridas para os custos fixos
export const GRUPOS = ['Deduções', 'CMV', 'Pessoal', 'Ocupação', 'Despesas operacionais', 'Marketing', 'Administrativo', 'Financeiro',
  'Royalties recebidos', 'Passivo unidades encerradas', 'Investimento BV Salão']
export const OPEX = ['Pessoal', 'Ocupação', 'Despesas operacionais', 'Marketing', 'Administrativo', 'Financeiro']
export const CATEGORIAS = [
  ['Pessoal', [['Salários', 'Salários'], ['Bonificação', 'Bonificação e comissão'], ['Passagem (VT)', 'Passagem (VT)'], ['Alimentação', 'Alimentação'], ['Encargos', 'Encargos (INSS, FGTS)'], ['Pró-labore', 'Pró-labore']]],
  ['Ocupação', [['Aluguel', 'Aluguel e condomínio'], ['Energia', 'Energia elétrica'], ['Água', 'Água e esgoto'], ['Gás', 'Gás'], ['IPTU', 'IPTU']]],
  ['Despesas operacionais', [['Manutenção', 'Manutenção'], ['Dedetização', 'Dedetização'], ['Limpeza', 'Limpeza']]],
  ['Marketing', [['Marketing', 'Anúncios e agência']]],
  ['Administrativo', [['Sistemas', 'Sistemas (3LM e outros)'], ['Contabilidade', 'Contabilidade'], ['Internet e telefone', 'Internet e telefone'], ['Seguros', 'Seguros']]],
  ['Deduções', [['Impostos sobre venda', 'Impostos (Simples)'], ['Taxas de cartão e apps', 'Taxas de cartão e apps']]],
  ['CMV', [['Insumos', 'Insumos'], ['Bebidas', 'Bebidas'], ['Embalagens e descartáveis', 'Embalagens e descartáveis']]],
  ['Financeiro', [['Tarifas bancárias', 'Tarifas bancárias'], ['Empréstimos', 'Parcela de empréstimo']]],
  ['Passivo unidades encerradas', [['Parcelamento', 'Parcelamento do legado'], ['Fornecedores', 'Fornecedores do legado'], ['Trabalhista', 'Acordo trabalhista'], ['Impostos', 'Impostos do legado']]],
  ['Investimento BV Salão', [['Implantação', 'Implantação BV']]],
]
export const FORMAS = ['Crédito', 'Débito', 'Pix', 'Dinheiro']

const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`
const addMonths = (mes, n) => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return ym(d.getFullYear(), d.getMonth() + 1) }
export const addDaysISO = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return toISO(new Date(y, m - 1, d + n)) }
export const mesNome = (mes) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mes}-01T00:00:00Z`))
export const okUnidade = (u) => (r) => u === 'Todas' || r.unidade === u

export function statusData(venc, hoje = today()) {
  const em7 = addDaysISO(hoje, 7)
  return venc < hoje ? 'Atrasado' : venc === hoje ? 'Vence hoje' : venc <= em7 ? 'Próximos 7 dias' : 'A vencer'
}

/** Um título por mês para cada custo fixo, do início (nunca antes de INICIO) até o fim/pausa, no máximo 12 meses à frente. */
export function ocorrenciasFixas(fixos, hoje = today()) {
  const ate = addMonths(hoje.slice(0, 7), 12)
  const out = []
  for (const f of fixos) {
    const ini = !f.inicio || f.inicio < INICIO ? INICIO : f.inicio
    let fim = f.fim || ate
    if (f.pausado_em && f.pausado_em < fim) fim = f.pausado_em
    for (let mes = ini, k = 0; k < 36 && mes <= fim && mes <= ate; mes = addMonths(mes, 1), k++) {
      const [y, m] = mes.split('-').map(Number)
      const venc = `${mes}-${String(Math.min(Number(f.dia) || 1, new Date(y, m, 0).getDate())).padStart(2, '0')}`
      out.push({ id: `CF-${f.id}-${mes}`, vencimento: venc, competencia: venc, contraparte: f.descricao, grupo: f.grupo, categoria: f.categoria,
        unidade: f.unidade, valor: Number(f.valor) || 0, fixo: true, fixoId: f.id })
    }
  }
  return out
}

/** Títulos a pagar (3LM + manuais + custos fixos) com a situação do dia e a data de pagamento. */
export function buildContas(fin, hoje = today()) {
  const pagos = new Map(fin.pagamentos.map((p) => [p.id, p.data]))
  const base = fin.lancamentos.filter((r) => r.tipo === 'Saída').map((r) => ({
    id: r.id, vencimento: r.vencimento, competencia: r.competencia || r.vencimento, contraparte: r.contraparte, grupo: r.grupo,
    categoria: r.subcategoria || r.categoria, unidade: r.unidade, valor: Number(r.valor), origem: r.origem, pagamento: r.pagamento || null,
  }))
  return [...base, ...ocorrenciasFixas(fin.custos_fixos, hoje)].map((r) => {
    const pagoEm = pagos.get(r.id) || r.pagamento || null
    return { ...r, pagoEm, status: pagoEm ? 'Pago' : statusData(r.vencimento, hoje) }
  })
}

const sum = (rows, f = (r) => r.valor) => rows.reduce((t, r) => t + Number(f(r) || 0), 0)
const r2 = (v) => Math.round(v * 100) / 100

export function resumoContas(contas, hoje = today(), periodo = null) {
  const of = (s) => contas.filter((r) => r.status === s)
  const mes = hoje.slice(0, 7)
  const doMes = contas.filter((r) => r.vencimento.startsWith(mes))
  const noPer = periodo ? contas.filter((r) => r.vencimento >= periodo[0] && r.vencimento <= periodo[1]) : doMes
  const pago = (rs) => sum(rs.filter((r) => r.status === 'Pago'))
  const aberto = (rs) => sum(rs.filter((r) => r.status !== 'Pago'))
  return {
    hoje: { n: of('Vence hoje').length, v: sum(of('Vence hoje')) },
    prox: { n: of('Próximos 7 dias').length, v: sum(of('Próximos 7 dias')) },
    atraso: { n: of('Atrasado').length, v: sum(of('Atrasado')) },
    mes: { pago: pago(doMes), aberto: aberto(doMes) },
    periodo: { pago: pago(noPer), aberto: aberto(noPer) },
  }
}

// ---------------------------------------------------------------------
// Vendas, meta e projeção
// ---------------------------------------------------------------------
const primeiraTerca = (y, m) => { const d = new Date(y, m - 1, 1); const off = (2 - d.getDay() + 7) % 7; return `${ym(y, m)}-${String(1 + off).padStart(2, '0')}` }

export function vendasPorDia(vendas, unidade) {
  const m = new Map()
  for (const r of vendas.filter(okUnidade(unidade))) {
    const row = m.get(r.dia) || { dia: r.dia, Crédito: 0, Débito: 0, Pix: 0, Dinheiro: 0, total: 0 }
    const g = FORMAS.includes(r.grupo) ? r.grupo : 'Dinheiro'
    row[g] += Number(r.valor); row.total += Number(r.valor)
    m.set(r.dia, row)
  }
  return [...m.values()].sort((a, b) => a.dia.localeCompare(b.dia))
}

/**
 * Meta: mesmo mês do ano passado sem a terça da promoção, vezes a tendência dos últimos 3 meses
 * contra o ano anterior, mais o impulso, mais a média das últimas 3 terças de promoção.
 */
export function calcMeta(vendas, historico, unidade, impulso = 0.05, mesRef = null) {
  const vs = vendas.filter(okUnidade(unidade))
  const mes = mesRef || vs.map((r) => r.dia.slice(0, 7)).sort().pop() || today().slice(0, 7)
  const [y, m] = mes.split('-').map(Number)
  const diasMes = new Date(y, m, 0).getDate()
  const promoDia = primeiraTerca(y, m)
  const hm = new Map()
  for (const r of historico.filter(okUnidade(unidade))) {
    const k = r.mes.slice(0, 7); const cur = hm.get(k) || { total: 0, promo: 0 }
    hm.set(k, { total: cur.total + Number(r.total), promo: cur.promo + Number(r.promo_valor || 0) })
  }
  const ly = hm.get(ym(y - 1, m))
  let atual = 0, anterior = 0
  const recentes = []
  for (let k = 1; k <= 3; k++) {
    const mk = addMonths(mes, -k); const a = hm.get(mk); const b = hm.get(addMonths(mk, -12))
    if (a) recentes.push(a.promo)
    if (a && b) { atual += a.total - a.promo; anterior += b.total - b.promo }
  }
  const cresc = anterior ? atual / anterior - 1 : 0
  const promoMeta = recentes.length ? recentes.reduce((t, v) => t + v, 0) / recentes.length : 0
  const rs = vs.filter((r) => r.dia.startsWith(mes))
  const vendido = sum(rs)
  const promoAtual = sum(rs.filter((r) => r.dia === promoDia))
  const diasNormais = new Set(rs.filter((r) => r.dia !== promoDia).map((r) => r.dia)).size
  const mediaNormal = diasNormais ? (vendido - promoAtual) / diasNormais : 0
  const ultimoDia = Number((rs.map((r) => r.dia).sort().pop() || `${mes}-00`).slice(8, 10))
  let restantes = 0, promoFutura = false
  for (let dd = ultimoDia + 1; dd <= diasMes; dd++) { if (`${mes}-${String(dd).padStart(2, '0')}` === promoDia) promoFutura = true; else restantes++ }
  const metaNormal = ly ? (ly.total - ly.promo) * (1 + cresc) * (1 + impulso) : 0
  const metaMes = ly ? metaNormal + promoMeta : 0
  const projecao = vendido + mediaNormal * restantes + (promoFutura ? promoMeta : 0)
  const falta = Math.max(metaMes - vendido, 0)
  const precisaDia = restantes ? Math.max(falta - (promoFutura ? promoMeta : 0), 0) / restantes : 0
  return {
    mes, promoDia, vendido: r2(vendido), promoAtual: r2(promoAtual), diasNormais, mediaNormal: r2(mediaNormal),
    mediaLy: ly ? r2((ly.total - ly.promo) / (diasMes - 1)) : 0, temHistorico: !!ly,
    cresc, impulso, promoMeta: r2(promoMeta), metaMes: r2(metaMes), metaDiaNormal: r2(diasMes > 1 ? metaNormal / (diasMes - 1) : 0),
    projecao: r2(projecao), falta: r2(falta), restantes, promoFutura, precisaDia: r2(precisaDia),
    pct: metaMes ? vendido / metaMes : 0, pctProj: metaMes ? projecao / metaMes : 0,
  }
}

export function comparativo(historico, vendas, unidade) {
  const m = new Map(); const parcial = new Set()
  for (const r of historico.filter(okUnidade(unidade))) { const k = r.mes.slice(0, 7); m.set(k, (m.get(k) || 0) + Number(r.total)) }
  const hk = new Set(historico.map((r) => r.mes.slice(0, 7)))
  for (const r of vendas.filter(okUnidade(unidade))) { const k = r.dia.slice(0, 7); if (!hk.has(k)) { m.set(k, (m.get(k) || 0) + Number(r.valor)); parcial.add(k) } }
  const anos = [...new Set([...m.keys()].map((k) => k.slice(0, 4)))].sort()
  const meses = [...new Set([...m.keys()].map((k) => k.slice(5, 7)))].sort()
  return { anos, parcial, rows: meses.map((mm) => Object.fromEntries([['mes', mm], ...anos.map((a) => [a, r2(m.get(`${a}-${mm}`) || 0)])])) }
}

export function mixPagamentos(vendas, unidade, mes) {
  const rs = vendas.filter((r) => okUnidade(unidade)(r) && (!mes || r.dia.startsWith(mes)))
  const total = sum(rs); const m = new Map()
  for (const r of rs) m.set(r.forma, { grupo: r.grupo, valor: (m.get(r.forma)?.valor || 0) + Number(r.valor) })
  return [...m].map(([forma, v]) => ({ forma, ...v, share: total ? v.valor / total : 0 })).sort((a, b) => b.valor - a.valor)
}

// ---------------------------------------------------------------------
// DRE gerencial (competência)
// ---------------------------------------------------------------------
export function mesesDre(fin, contas, hoje = today()) {
  const prox = addMonths(hoje.slice(0, 7), 1)
  return [...new Set([...fin.vendas.map((r) => r.dia.slice(0, 7)), ...contas.map((r) => r.competencia.slice(0, 7)).filter((m) => m <= prox)])].sort()
}

export function dre(contas, vendas, mes, unidade) {
  const lanc = contas.filter((r) => okUnidade(unidade)(r) && r.competencia.startsWith(mes))
  const g = {}
  for (const k of GRUPOS) {
    const rs = lanc.filter((r) => r.grupo === k)
    g[k] = { pago: sum(rs.filter((r) => r.status === 'Pago')), aberto: sum(rs.filter((r) => r.status !== 'Pago')) }
    g[k].total = g[k].pago + g[k].aberto
  }
  const receita = sum(vendas.filter((r) => okUnidade(unidade)(r) && r.dia.startsWith(mes)))
  const tot = (f) => ({ pago: f('pago'), total: f('total') })
  const rl = tot((k) => receita - g['Deduções'][k])
  const mb = tot((k) => rl[k] - g.CMV[k])
  const eb = tot((k) => mb[k] - OPEX.reduce((t, o) => t + g[o][k], 0))
  const res = tot((k) => eb[k] + g['Royalties recebidos'][k] - g['Passivo unidades encerradas'][k] - g['Investimento BV Salão'][k])
  const linhas = [
    { nome: 'Receita bruta', tipo: 'tot', pago: receita, total: receita },
    { nome: 'Deduções', tipo: 'g', sinal: -1, ...g['Deduções'] },
    { nome: 'Receita líquida', tipo: 'tot', ...rl },
    { nome: 'CMV', tipo: 'g', sinal: -1, ...g.CMV },
    { nome: 'Margem bruta', tipo: 'tot', ...mb },
    ...OPEX.map((k) => ({ nome: k, tipo: 'g', sinal: -1, ...g[k] })),
    { nome: 'EBITDA operacional', tipo: 'tot', destaque: true, ...eb },
    { nome: 'Royalties recebidos', tipo: 'below', sinal: 1, ...g['Royalties recebidos'] },
    { nome: 'Passivo unidades encerradas', tipo: 'below', sinal: -1, ...g['Passivo unidades encerradas'] },
    { nome: 'Investimento BV Salão', tipo: 'below', sinal: -1, ...g['Investimento BV Salão'] },
    { nome: 'Resultado após legado e BV', tipo: 'tot', destaque: true, ...res },
  ]
  return { receita, base: rl.total || receita, linhas, cmvPct: receita ? g.CMV.total / receita : 0 }
}

// ---------------------------------------------------------------------
// Importação de custos fixos (colar da planilha ou CSV)
// descrição; grupo; categoria; unidade; valor; dia; início (AAAA-MM); fim (opcional)
// ---------------------------------------------------------------------
export function parseFixos(texto) {
  const out = []; let erros = 0
  const num = (x) => Number(String(x || '').replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.'))
  const mesOk = (x) => (/^\d{4}-\d{2}$/.test(x || '') ? x : /^\d{2}\/\d{4}$/.test(x || '') ? `${x.slice(3)}-${x.slice(0, 2)}` : null)
  for (const l of String(texto || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ','
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''))
    if (/descri/i.test(c[0] || '')) continue
    const grupo = GRUPOS.find((g) => g.toLowerCase() === (c[1] || '').toLowerCase())
    const unidade = UNIDADES.find((u) => u.toLowerCase() === (c[3] || '').toLowerCase()) || 'ZN Salão'
    const f = { descricao: c[0], grupo, categoria: c[2] || grupo, unidade, valor: num(c[4]), dia: Math.round(num(c[5])), inicio: mesOk(c[6]) || INICIO, fim: mesOk(c[7]) }
    if (f.descricao && grupo && f.valor > 0 && f.dia >= 1 && f.dia <= 31) out.push(f); else erros++
  }
  return { out, erros }
}

// ---------------------------------------------------------------------
// Importação de dados do 3LM (JSON no mesmo formato da extração)
// ---------------------------------------------------------------------
export function detectImport(rows) {
  if (!Array.isArray(rows) || !rows.length) return null
  const k = Object.keys(rows[0])
  if (k.includes('vencimento') && k.includes('contraparte')) return 'lancamentos'
  if (k.includes('dia') && k.includes('forma')) return 'vendas'
  if (k.includes('mes') && k.includes('total')) return 'historico'
  return null
}
