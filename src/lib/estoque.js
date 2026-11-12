// Painel de Estoque: cadastro de insumos (3LM), fichas técnicas, movimentos, contagens e cálculo do estoque.
import { toISO, today } from './format.js'

export const TIPOS_MOV = {
  entrada: { label: 'Entrada (nota)', sinal: 1 },
  manual: { label: 'Entrada sem nota', sinal: 1 },
  producao_in: { label: 'Produção', sinal: 1 },
  producao_out: { label: 'Usado na produção', sinal: -1 },
  venda: { label: 'Venda (ficha técnica)', sinal: -1 },
  transferencia: { label: 'Transferência para hub', sinal: -1 },
  evento: { label: 'Evento', sinal: -1 },
  perda: { label: 'Perda', sinal: -1 },
  ajuste: { label: 'Ajuste', sinal: 1 },
}
export const MOTIVOS_MANUAL = ['Compra sem nota', 'Bonificação', 'Transferência recebida', 'Devolução', 'Outro']
export const MOTIVOS_PERDA = ['Vencido', 'Estragado', 'Queimado/erro de preparo', 'Quebra/derramou', 'Consumo de funcionário', 'Outro']
// Categorias da 3LM que entram no controle por padrão (as demais ficam inativas, mas podem ser ativadas)
export const CATS_ATIVAS = ['BEBIDAS', 'CERVEJAS', 'FRIOS', 'HORTIFRUTI', 'SECOS', 'PROCESSADOS', 'DESCARTAVEIS-FAT', 'DESCARTAVEIS', 'EMBALAGEM']

const num = (x) => Number(String(x ?? '').replace(/R\$\s?/i, '').replace(/\./g, '').replace(',', '.').trim()) || 0
const limpa = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
export const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return toISO(new Date(y, m - 1, d + n)) }
const r3 = (v) => Math.round(v * 1000) / 1000

/** Volume em litros escrito no nome (BIB COCA COLA 18L → 18) */
export const litrosNoNome = (nome) => { const m = /(\d+(?:[.,]\d+)?)\s*L\b/i.exec(nome || ''); return m ? Number(m[1].replace(',', '.')) : null }

/** 3LM Estoque → Relatórios → Produtos → Estoque Atual, exportado em "Delimitador ;". Lê só o local 1 (Frente de Loja). */
export function parseEstoqueAtual(texto) {
  const out = new Map(); let local = null; let cat = null
  for (const raw of String(texto || '').split(/\r?\n/)) {
    const c = raw.split(';').map((x) => x.trim())
    let m
    if ((m = /^(\d+) - (.+)$/.exec(c[0])) && c.filter(Boolean).length === 1) {
      if (/^\s{2,}/.test(raw)) cat = m[2].trim(); else local = m[1]
      continue
    }
    if (local !== '1' || !/^\d+$/.test(c[0]) || c.length < 9) continue
    const nome = limpa(c[1])
    out.set(c[0], {
      codigo: c[0], nome, unidade: (c[5] || 'UND').toUpperCase(), categoria: cat || 'OUTROS',
      preco_medio: num(c[6]), preco_ultimo: num(c[7]), litros: /^BIB\b/i.test(nome) ? litrosNoNome(nome) : null,
      ativo: CATS_ATIVAS.includes(cat || ''),
    })
  }
  return [...out.values()]
}

/** 3LM Estoque → Relatórios → Fichas Técnicas, exportado em "Delimitador ;". */
export function parseFichas(texto) {
  const t = String(texto || '').replace(/\r?\n/g, ';')
  const partes = t.split('ITEM: ').slice(1)
  const pratos = []; const linhas = []
  let secao = null
  // a seção (BEBIDAS, BURGERS…) aparece antes do primeiro ITEM dela
  const secoes = [...String(texto || '').matchAll(/(?:^|\n)([A-ZÇÃÕÉÊ!.\- ]{3,});\s*\nITEM: (\d+)-/g)].reduce((m, x) => m.set(x[2], x[1].trim()), new Map())
  for (const p of partes) {
    const h = /^(\d+)-([^;]+);P\S* DE VENDA;\s*R\$\s*([\d.,]+)/.exec(p)
    if (!h) continue
    const codigo = h[1]
    secao = secoes.get(codigo) || secao
    pratos.push({ codigo, nome: limpa(h[2]), preco_venda: num(h[3]), secao })
    for (const m of p.matchAll(/(?:^|;)(\d+);([^;]+);([A-Z]{1,5});([\d.,]+);(SIM|N\S*O);(SIM|N\S*O);(SIM|N\S*O)/g)) {
      linhas.push({ produto_codigo: codigo, insumo_codigo: m[1], qtd: num(m[4]) })
    }
  }
  return { pratos, linhas }
}

// ---------------------------------------------------------------------
// Cálculo do estoque
// ---------------------------------------------------------------------
/**
 * contagens: fechadas, ordenadas por corte. A última é o D0.
 * movs: movimentos lançados (entrada, manual, produção, perda, ajuste) + saídas calculadas (venda, transferência).
 * Estoque atual = contagem do D0 + movimentos com dia > corte do D0.
 */
export function calcEstoque({ insumos, contagens, movs, hoje = today(), inicio }) {
  const fechadas = contagens.filter((c) => c.status === 'fechada').sort((a, b) => a.corte.localeCompare(b.corte))
  const d0 = fechadas[fechadas.length - 1] || null
  // sem contagem, o estoque fica em zero: nada é aplicado até existir o D0
  const base = d0 ? d0.corte : '9999-12-31'
  const d0Qtd = new Map((d0?.itens || []).map((i) => [i.insumo_codigo, Number(i.qtd)]))
  const de7 = addDias(hoje, -7)
  const acc = new Map(insumos.map((i) => [i.codigo, { entradas: 0, saidas: 0, saidas7: 0, porTipo: {} }]))
  for (const m of movs) {
    const a = acc.get(m.insumo_codigo); if (!a) continue
    const q = Number(m.qtd) * (TIPOS_MOV[m.tipo]?.sinal ?? 1)
    // consumo médio: últimos 7 dias, com ou sem contagem
    if (q < 0 && m.dia > de7 && m.dia <= hoje && m.tipo !== 'ajuste') a.saidas7 -= q
    if (m.dia <= base) continue
    a.porTipo[m.tipo] = (a.porTipo[m.tipo] || 0) + q
    if (q >= 0) a.entradas += q; else a.saidas -= q
  }
  const desde = inicio && inicio > de7 ? inicio : addDias(de7, 1)
  const diasJanela = Math.max(1, Math.round((new Date(`${hoje}T12:00:00`) - new Date(`${desde}T12:00:00`)) / 864e5))
  const rows = insumos.map((i) => {
    const a = acc.get(i.codigo)
    const d0q = d0Qtd.get(i.codigo) ?? 0
    const atual = r3(d0q + a.entradas - a.saidas)
    const consumoDia = a.saidas7 / diasJanela
    const cobertura = d0 && consumoDia > 0 ? atual / consumoDia : null
    const minimo = Number(i.estoque_min || 0)
    const sugestao = d0 && (consumoDia > 0 || minimo > 0) ? Math.max(0, Math.ceil((consumoDia * 7 + minimo - atual) * 100) / 100) : 0
    return { ...i, d0: d0q, entradas: r3(a.entradas), saidas: r3(a.saidas), atual, consumoDia, cobertura, sugestao, porTipo: a.porTipo,
      contado: d0Qtd.has(i.codigo), negativo: atual < -0.0005 }
  })
  return { rows, d0, base: d0 ? d0.corte : null }
}

/** Preço médio, melhor e último a partir das entradas com custo (cai no preço da 3LM se não houver). */
export function precos(insumo, movs) {
  const ent = movs.filter((m) => m.insumo_codigo === insumo.codigo && (m.tipo === 'entrada' || m.tipo === 'manual') && Number(m.custo_unit) > 0)
    .sort((a, b) => (a.dia + (a.created_at || '')).localeCompare(b.dia + (b.created_at || '')))
  if (!ent.length) return { medio: Number(insumo.preco_medio) || 0, melhor: null, ultimo: Number(insumo.preco_ultimo) || 0, fonte: '3LM' }
  const q = ent.reduce((t, m) => t + Number(m.qtd), 0)
  return {
    medio: q ? ent.reduce((t, m) => t + Number(m.qtd) * Number(m.custo_unit), 0) / q : 0,
    melhor: Math.min(...ent.map((m) => Number(m.custo_unit))),
    ultimo: Number(ent[ent.length - 1].custo_unit), fonte: 'entradas',
  }
}

/** Estoque virtual na data de corte de uma contagem (para comparar com o contado). */
export function virtualNoCorte({ insumos, contagens, movs, contagem }) {
  const anteriores = contagens.filter((c) => c.status === 'fechada' && c.corte < contagem.corte && c.id !== contagem.id)
  const ant = anteriores.sort((a, b) => a.corte.localeCompare(b.corte)).pop() || null
  const base = ant ? ant.corte : null
  const d0 = new Map((ant?.itens || []).map((i) => [i.insumo_codigo, Number(i.qtd)]))
  const v = new Map(insumos.map((i) => [i.codigo, d0.get(i.codigo) ?? 0]))
  const ent = new Map(); const sai = new Map()
  for (const m of movs) {
    if (m.dia > contagem.corte || (base && m.dia <= base) || m.tipo === 'ajuste') continue
    if (!v.has(m.insumo_codigo)) continue
    const q = Number(m.qtd) * (TIPOS_MOV[m.tipo]?.sinal ?? 1)
    v.set(m.insumo_codigo, v.get(m.insumo_codigo) + q)
    if (q >= 0) ent.set(m.insumo_codigo, (ent.get(m.insumo_codigo) || 0) + q); else sai.set(m.insumo_codigo, (sai.get(m.insumo_codigo) || 0) - q)
  }
  return { virtual: v, anterior: ant, d0, entradas: ent, saidas: sai }
}

/** Desvio de uma contagem fechada/aberta contra o virtual. Tolerância padrão de 3%. */
export function desvios({ insumos, contagens, movs, contagem, preco }) {
  const { virtual, anterior, d0, entradas, saidas } = virtualNoCorte({ insumos, contagens, movs, contagem })
  const contado = new Map((contagem.itens || []).map((i) => [i.insumo_codigo, Number(i.qtd)]))
  const rows = insumos.filter((i) => contado.has(i.codigo)).map((i) => {
    const real = contado.get(i.codigo); const virt = r3(virtual.get(i.codigo) ?? 0)
    const dif = r3(real - virt); const p = preco(i)
    const base = Math.max(Math.abs(virt), saidas.get(i.codigo) || 0)
    const pct = base > 0 ? dif / base : null
    const tol = Number(i.tolerancia ?? 0.03)
    return { ...i, anteriorQtd: d0.get(i.codigo) ?? 0, entradasP: r3(entradas.get(i.codigo) || 0), saidasP: r3(saidas.get(i.codigo) || 0),
      virtual: virt, real, dif, valor: dif * p, pct, fora: anterior ? (pct != null ? Math.abs(pct) > tol : Math.abs(dif) > 0.0005) : false }
  })
  return { rows, anterior, perda: rows.filter((r) => r.valor < 0).reduce((t, r) => t + r.valor, 0), sobra: rows.filter((r) => r.valor > 0).reduce((t, r) => t + r.valor, 0) }
}

/** Consumo apurado dos bags de post-mix (em litros) entre a contagem anterior e esta, e por refil vendido. */
export function consumoPostMix({ rows, refis }) {
  const bibs = rows.filter((r) => /^BIB\b/i.test(r.nome) && r.litros)
  const itens = bibs.map((b) => {
    const consumoUn = r3(b.anteriorQtd + b.entradasP - b.real)
    return { ...b, consumoUn, litros: r3(consumoUn * b.litros), custoLitro: b.litros ? (b.custo || 0) / b.litros : 0 }
  })
  const totalL = itens.reduce((t, i) => t + i.litros, 0)
  return { itens: itens.map((i) => ({ ...i, share: totalL ? i.litros / totalL : 0 })), totalL, refis, mlPorRefil: refis ? (totalL * 1000) / refis : null }
}
