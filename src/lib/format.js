const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const qtyFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const numFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const money = (v) => brl.format(Number(v) || 0)
export const moneyShort = (v) => brlCompact.format(Number(v) || 0)
export const qty = (v) => qtyFmt.format(Number(v) || 0)
export const num2 = (v) => numFmt.format(Number(v) || 0)
export const pct = (v) => `${(Number(v) * 100 || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

export const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100
export const lineTotal = (q, p) => round2((Number(q) || 0) * (Number(p) || 0))

// Datas sempre como 'YYYY-MM-DD' (sem fuso)
export const toISO = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
export const today = () => toISO(new Date())
export const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
export const dateBR = (s) => (s ? s.split('-').reverse().join('/') : '')
export const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return toISO(d) }

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const monthKey = (s) => s.slice(0, 7)
export const monthLabel = (key) => { const [y, m] = key.split('-'); return `${MONTHS[Number(m) - 1]}/${y.slice(2)}` }

// Semana de segunda a domingo (igual à planilha: "Semana de 12 a 18/10")
export const weekStart = (s) => { const d = fromISO(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return toISO(d) }
export const weekLabel = (start) => { const end = addDays(start, 6); return `${dateBR(start).slice(0, 5)}–${dateBR(end).slice(0, 5)}` }

export function presetRange(key) {
  const t = today()
  const d = fromISO(t)
  switch (key) {
    case 'this_week': return [weekStart(t), addDays(weekStart(t), 6)]
    case 'last_week': { const s = addDays(weekStart(t), -7); return [s, addDays(s, 6)] }
    case 'this_month': return [toISO(new Date(d.getFullYear(), d.getMonth(), 1)), toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0))]
    case 'last_month': return [toISO(new Date(d.getFullYear(), d.getMonth() - 1, 1)), toISO(new Date(d.getFullYear(), d.getMonth(), 0))]
    case 'last_30': return [addDays(t, -29), t]
    case 'last_90': return [addDays(t, -89), t]
    case 'this_year': return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`]
    default: return ['', '']
  }
}
export const PRESETS = [
  ['all', 'Todo o período'],
  ['this_week', 'Esta semana'],
  ['last_week', 'Semana passada'],
  ['this_month', 'Este mês'],
  ['last_month', 'Mês passado'],
  ['last_30', 'Últimos 30 dias'],
  ['last_90', 'Últimos 90 dias'],
  ['this_year', 'Este ano'],
]

export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Aceita "1,5" ou "1.5"
export const parseNum = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (!s) return NaN
  const clean = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return Number(clean)
}
