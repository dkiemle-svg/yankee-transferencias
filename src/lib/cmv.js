// CMV teórico (ficha técnica × preço médio dos insumos) por origem: loja, N1 promo, eventos, hubs e perdas.
import { precos } from './estoque.js'

export const PROMO_PADRAO = ['2020'] // NUMERO 1 PROMO (R$ 11, terça da promoção)
const sum = (rs, f) => rs.reduce((t, r) => t + (Number(f(r)) || 0), 0)

/** Custo de 1 unidade de cada prato pela ficha técnica. */
export function custosPratos(est) {
  const preco = new Map(est.insumos.map((i) => [i.codigo, precos(i, est.movs).medio]))
  const m = new Map()
  for (const f of est.fichas) m.set(f.produto_codigo, (m.get(f.produto_codigo) || 0) + Number(f.qtd) * (preco.get(f.insumo_codigo) || 0))
  return { porPrato: m, preco }
}

/**
 * fin (opcional, só quem tem o Financeiro): { itens, eventos } para o faturamento.
 * transfers/units (opcionais): valor das transferências para os hubs.
 */
export function cmvRelatorio({ est, fin = null, transfers = null, units = null, de, ate, promo = PROMO_PADRAO }) {
  const { porPrato, preco } = custosPratos(est)
  const noPer = (d) => d >= de && d <= ate
  const pratos = new Map(est.pratos.map((p) => [p.codigo, p]))
  const promoSet = new Set(promo)
  // faturamento por produto (só com o Financeiro)
  const fat = new Map()
  if (fin?.itens) for (const i of fin.itens) if (i.unidade === 'ZN Salão' && noPer(i.dia)) fat.set(i.codigo, (fat.get(i.codigo) || 0) + Number(i.valor))
  const prod = new Map()
  for (const v of est.vendas) {
    if (!noPer(v.dia)) continue
    const o = prod.get(v.codigo) || { codigo: v.codigo, nome: pratos.get(v.codigo)?.nome || v.nome, qtd: 0 }
    o.qtd += Number(v.qtd); prod.set(v.codigo, o)
  }
  const produtos = [...prod.values()].map((p) => {
    const cu = porPrato.get(p.codigo)
    const receita = fin ? fat.get(p.codigo) || 0 : null
    const custo = cu != null ? cu * p.qtd : 0
    return { ...p, promo: promoSet.has(p.codigo), semFicha: cu == null, custoUnit: cu ?? null, custo, receita,
      precoMedio: receita != null && p.qtd ? receita / p.qtd : null, cmv: receita ? custo / receita : null,
      margemUnit: receita != null && p.qtd && cu != null ? receita / p.qtd - cu : null, margem: receita != null ? receita - custo : null,
      estrategico: !!pratos.get(p.codigo)?.estrategico, secao: pratos.get(p.codigo)?.secao || '' }
  }).sort((a, b) => b.custo - a.custo)

  const valorSaida = (tipo) => {
    const g = new Map()
    for (const s of est.saidas) {
      if (s.tipo !== tipo || !noPer(s.dia)) continue
      g.set(s.origem, (g.get(s.origem) || 0) + Number(s.qtd) * (preco.get(s.insumo_codigo) || 0))
    }
    return g
  }
  const evCusto = sum([...valorSaida('evento').values()], (x) => x)
  const hubCusto = sum([...valorSaida('transferencia').values()], (x) => x)
  const perdas = sum(est.movs.filter((m) => m.tipo === 'perda' && noPer(m.dia)), (m) => Number(m.qtd) * (preco.get(m.insumo_codigo) || 0))
  const evReceita = fin?.eventos ? sum(fin.eventos.filter((e) => e.status === 'realizado' && noPer(e.dia)), (e) => sum(e.itens || [], (i) => i.qtd * i.preco)) : null
  let hubReceita = null
  if (transfers && units) {
    const hub = new Set(units.filter((u) => u.is_hub).map((u) => u.id))
    hubReceita = sum(transfers.filter((t) => noPer(t.date) && !hub.has(t.origin_id) && hub.has(t.destination_id)), (t) => t.total ?? t.quantity * t.unit_price)
  }
  const loja = produtos.filter((p) => !p.promo); const pr = produtos.filter((p) => p.promo)
  const grupo = (key, nome, custo, receita) => ({ key, nome, custo, receita, cmv: receita ? custo / receita : null })
  const grupos = [
    grupo('loja', 'Vendas da loja', sum(loja, (p) => p.custo), fin ? sum(loja, (p) => p.receita) : null),
    grupo('promo', 'N1 promo', sum(pr, (p) => p.custo), fin ? sum(pr, (p) => p.receita) : null),
    grupo('eventos', 'Eventos', evCusto, evReceita),
    grupo('hub', 'Enviado aos hubs', hubCusto, hubReceita),
    grupo('perdas', 'Perdas', perdas, null),
  ]
  return { produtos, grupos, semFicha: produtos.filter((p) => p.semFicha) }
}

/** Soma os grupos incluídos. Perdas entram sempre. */
export function totalCmv(grupos, incluir) {
  const gs = grupos.filter((g) => g.key === 'loja' || g.key === 'perdas' || incluir[g.key])
  const custo = sum(gs, (g) => g.custo)
  const temReceita = gs.some((g) => g.receita != null)
  const receita = temReceita ? sum(gs, (g) => g.receita) : null
  return { custo, receita, cmv: receita ? custo / receita : null }
}

/**
 * Engenharia de cardápio (Kasavana & Smith): popularidade = participação nas unidades vendidas
 * contra 70% da média; margem = margem unitária contra a média ponderada.
 */
export function engenharia(produtos) {
  const ps = produtos.filter((p) => p.margemUnit != null && p.qtd > 0 && (p.receita || 0) > 0)
  if (!ps.length) return { rows: [], margemMedia: 0, corte: 0 }
  const qtdTot = sum(ps, (p) => p.qtd)
  const margemMedia = sum(ps, (p) => p.margemUnit * p.qtd) / qtdTot
  const corte = 0.7 / ps.length
  const rows = ps.map((p) => {
    const share = p.qtd / qtdTot
    const pop = share >= corte; const mg = p.margemUnit >= margemMedia
    return { ...p, share, classe: pop && mg ? 'Estrela' : pop ? 'Âncora' : mg ? 'Quebra-cabeça' : 'Repensar' }
  }).sort((a, b) => b.margem - a.margem)
  return { rows, margemMedia, corte }
}
