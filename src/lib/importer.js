// Importa planilhas no formato do "Controle Yankee Hub" (xlsx) ou CSV exportado pelo sistema.
import { normalize, parseNum, round2, toISO } from './format.js'

function findUnit(text, units) {
  const n = normalize(text)
  if (!n) return null
  const exact = units.find((u) => normalize(u.name) === n || normalize(u.code) === n)
  if (exact) return exact
  if (/\bzn\b|zona norte/.test(n)) return units.find((u) => u.code === 'ZN')
  if (/\bzs\b|\bbv\b/.test(n)) return units.find((u) => u.code === 'BV') // ZS na planilha antiga = BV
  if (n.includes('yankee')) return units.find((u) => u.code === 'YANKEE')
  return units.find((u) => n.includes(normalize(u.name))) || null
}

function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return toISO(new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()))
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return toISO(new Date(y, Number(m[2]) - 1, Number(m[1]))) }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

const COL = {
  route: ['origem/destino'],
  origin: ['origem'],
  destination: ['destino'],
  date: ['data'],
  product: ['produto'],
  quantity: ['qtde', 'qtd', 'quantidade'],
  unit_price: ['valor unitario', 'preco', 'valor unit'],
  notes: ['observacao', 'obs'],
  checked: ['conferido'],
  status: ['pago', 'status'],
}

async function readRows(file) {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    const Papa = (await import('papaparse')).default
    const text = await file.text()
    return Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data
  }
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  const sheets = await readXlsxFile(file)
  const sheet = sheets.find((s) => normalize(s.sheet) === 'controle') || sheets.find((s) => s.data.some((r) => r.some((c) => normalize(c) === 'produto') && r.some((c) => normalize(c) === 'data'))) || sheets[0]
  return sheet.data
}

export async function parseTransfersFile(file, units, products) {
  const raw = await readRows(file)
  const headerIdx = raw.findIndex((r) => r.some((c) => normalize(c) === 'produto') && r.some((c) => normalize(c) === 'data'))
  if (headerIdx < 0) throw new Error('Não encontrei o cabeçalho (colunas "Data" e "Produto") na planilha.')
  const header = raw[headerIdx].map(normalize)
  const idx = {}
  for (const [key, names] of Object.entries(COL)) idx[key] = header.findIndex((h) => names.includes(h))
  if (idx.route >= 0) { idx.origin = -1; idx.destination = -1 }

  const prodByName = new Map(products.map((p) => [normalize(p.name), p]))
  const rows = [], errors = []
  let lastRoute = null
  raw.slice(headerIdx + 1).forEach((r, i) => {
    const line = headerIdx + i + 2
    const get = (k) => (idx[k] >= 0 ? r[idx[k]] : null)
    if (!get('product') && !get('quantity')) return
    let origin, destination
    if (idx.route >= 0) {
      const route = get('route') || lastRoute
      lastRoute = route
      const [a, b] = String(route || '').split('/')
      origin = findUnit(a, units); destination = findUnit(b, units)
    } else {
      origin = findUnit(get('origin'), units); destination = findUnit(get('destination'), units)
    }
    const date = toDate(get('date'))
    const quantity = parseNum(get('quantity'))
    const product = String(get('product') || '').trim()
    const p = prodByName.get(normalize(product))
    let unit_price = parseNum(get('unit_price'))
    if (isNaN(unit_price) && p) unit_price = p.price
    const st = normalize(get('status'))
    const problems = []
    if (!origin || !destination) problems.push('origem/destino')
    if (!date) problems.push('data')
    if (!product) problems.push('produto')
    if (!(quantity > 0)) problems.push('quantidade')
    if (isNaN(unit_price)) problems.push('valor unitário')
    if (problems.length) { errors.push(`Linha ${line}: ${problems.join(', ')} inválido(s)`); return }
    rows.push({
      date, origin_id: origin.id, destination_id: destination.id,
      product_id: p?.id || null, product_name: p?.name || product,
      quantity: Math.round(quantity * 10000) / 10000,
      unit_price: round2(unit_price),
      notes: [get('notes'), get('checked')].filter((x) => x && String(x).trim()).map((x) => String(x).trim()).join(' | ') || null,
      paid: ['sim', 's', 'pago', 'x', 'ok', 'true', '1'].includes(st),
    })
  })
  return { rows, errors }
}
