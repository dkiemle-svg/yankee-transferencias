import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts'
import { Settings2, Wallet, CheckCircle2, Clock, ArrowLeftRight, ChevronUp, ChevronDown, Eye, EyeOff, Maximize2, Minimize2, Package, RotateCcw, BarChart3 } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, moneyShort, qty, pct, monthKey, monthLabel, weekStart, weekLabel, dateBR, today, addDays } from '../lib/format.js'
import { DateRangePicker, MultiSelect, Modal, UNIT_COLORS } from '../components/ui.jsx'

const WIDGETS = {
  kpis:       { title: 'Indicadores', desc: 'Total, pago, em aberto e volume', size: 'full' },
  monthly:    { title: 'Pago × em aberto por mês', desc: 'Valor transferido em cada mês, separado por status', size: 'full' },
  byUnit:     { title: 'Saldo por unidade', desc: 'Quanto cada HubFood recebeu, pagou e deve', size: 'half' },
  aging:      { title: 'Idade do valor em aberto', desc: 'Há quanto tempo os valores estão pendentes', size: 'half' },
  weekly:     { title: 'Valor transferido por semana', desc: 'Semanas de segunda a domingo, por unidade', size: 'full' },
  topValue:   { title: 'Produtos que mais pesam no valor', desc: 'Ranking por valor transferido', size: 'half' },
  topQty:     { title: 'Produtos mais transferidos', desc: 'Ranking por quantidade, separado em kg e unidades', size: 'half' },
  products:   { title: 'Resumo por produto', desc: 'Tabela com quantidade, valor, pago e em aberto', size: 'full' },
}
const DEFAULT_PREFS = { order: Object.keys(WIDGETS), hidden: [], size: {}, topN: 10 }

const C_PAID = 'var(--st-good)', C_OPEN = 'var(--st-warn)'
const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--text-3)', fontSize: 11.5 }, tickLine: false }

function usePrefs(profile) {
  const [prefs, setPrefs] = useState(() => {
    let local = null
    try { local = JSON.parse(localStorage.getItem('yankee-dash') || 'null') } catch { /* */ }
    const p = { ...DEFAULT_PREFS, ...(profile?.prefs?.dashboard || local || {}) }
    // garante widgets novos na ordem
    p.order = [...p.order.filter((k) => WIDGETS[k]), ...Object.keys(WIDGETS).filter((k) => !p.order.includes(k))]
    return p
  })
  const timer = useRef()
  useEffect(() => {
    try { localStorage.setItem('yankee-dash', JSON.stringify(prefs)) } catch { /* */ }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => api.savePrefs({ ...(profile?.prefs || {}), dashboard: prefs }).catch(() => {}), 800)
  }, [prefs])
  return [prefs, setPrefs]
}

function Tip({ active, payload, label, fmt = money, labelFmt = (l) => l }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0)
  return (
    <div className="tip">
      <div className="t">{labelFmt(label)}</div>
      {payload.map((p) => <div className="r" key={p.dataKey}><span><i style={{ background: p.color }} />{p.name}</span><b>{fmt(p.value)}</b></div>)}
      {payload.length > 1 && <div className="r" style={{ borderTop: '1px solid var(--border)', marginTop: 5, paddingTop: 5 }}><span>Total</span><b>{fmt(total)}</b></div>}
    </div>
  )
}

export default function Dashboard({ store }) {
  const { transfers, units, unitsById, measureOf, isAdmin, profile } = store
  const [prefs, setPrefs] = usePrefs(profile)
  const [customizing, setCustomizing] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [unit, setUnit] = useState('all')
  const [prodSel, setProdSel] = useState([])

  const hubs = units.filter((u) => u.is_hub)
  const prodOptions = useMemo(() => [...new Set(transfers.map((t) => t.product_name))].sort().map((n) => ({ value: n, label: n })), [transfers])

  const rows = useMemo(() => {
    const ps = new Set(prodSel)
    return transfers.filter((t) => (!from || t.date >= from) && (!to || t.date <= to) &&
      (unit === 'all' || t.destination_id === unit || t.origin_id === unit) && (!ps.size || ps.has(t.product_name)))
  }, [transfers, from, to, unit, prodSel])

  const activeHubs = useMemo(() => hubs.filter((u) => rows.some((t) => t.destination_id === u.id || t.origin_id === u.id)), [hubs, rows])
  const m = useMemo(() => computeMetrics(rows, activeHubs, unitsById, measureOf), [rows, activeHubs, unitsById, measureOf])
  const visible = prefs.order.filter((k) => !prefs.hidden.includes(k))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{from || to ? `De ${from ? dateBR(from) : 'início'} até ${to ? dateBR(to) : 'hoje'}` : 'Todo o período'} · {rows.length.toLocaleString('pt-BR')} transferências</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setCustomizing(true)}><Settings2 />Personalizar</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters">
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
          {isAdmin && (
            <div className="seg" role="group" aria-label="Unidade">
              <button aria-pressed={unit === 'all'} onClick={() => setUnit('all')}>Todas</button>
              {hubs.map((u) => <button key={u.id} aria-pressed={unit === u.id} onClick={() => setUnit(u.id)}>{u.name}</button>)}
            </div>
          )}
          <MultiSelect label="Produtos" icon={Package} options={prodOptions} value={prodSel} onChange={setProdSel} />
          {(from || to || unit !== 'all' || prodSel.length > 0) && <button className="clear-link" onClick={() => { setFrom(''); setTo(''); setUnit('all'); setProdSel([]) }}>Limpar filtros</button>}
        </div>
      </div>

      {!rows.length ? <div className="card empty"><BarChart3 /><div>Sem dados para esses filtros.</div></div> : (
        <div className="widgets">
          {visible.map((k) => {
            const size = prefs.size[k] || WIDGETS[k].size
            if (k === 'kpis') return <div key={k} className="widget full"><Kpis m={m} /></div>
            return (
              <section key={k} className={`card widget ${size === 'full' ? 'full' : ''}`}>
                <div className="card-head"><div><h3>{WIDGETS[k].title}</h3><p>{WIDGETS[k].desc}</p></div>{legendFor(k, activeHubs)}</div>
                <Widget id={k} m={m} hubs={activeHubs} topN={prefs.topN} />
              </section>
            )
          })}
        </div>
      )}

      {customizing && <Customize prefs={prefs} setPrefs={setPrefs} onClose={() => setCustomizing(false)} />}
    </>
  )
}

function legendFor(k, hubs) {
  if (k === 'monthly' || k === 'byUnit') return <div className="legend"><span><i style={{ background: C_PAID }} />Pago</span><span><i style={{ background: C_OPEN }} />Em aberto</span></div>
  if (k === 'weekly') return <div className="legend">{hubs.map((u) => <span key={u.id}><i style={{ background: UNIT_COLORS[u.code] || 'var(--series-3)' }} />{u.name}</span>)}</div>
  return null
}

function computeMetrics(rows, hubs, unitsById, measureOf) {
  const sum = (a) => a.reduce((s, t) => s + t.total, 0)
  const total = sum(rows), paid = sum(rows.filter((t) => t.paid))
  const days = new Set(rows.map((t) => t.date)).size

  const months = {}
  rows.forEach((t) => { const k = monthKey(t.date); months[k] ??= { key: k, paid: 0, open: 0 }; months[k][t.paid ? 'paid' : 'open'] += t.total })
  const monthly = Object.values(months).sort((a, b) => a.key.localeCompare(b.key)).map((x) => ({ ...x, label: monthLabel(x.key) }))

  const weeks = {}
  rows.forEach((t) => {
    const k = weekStart(t.date); const code = unitsById[t.destination_id]?.code || 'X'
    weeks[k] ??= { key: k }; weeks[k][code] = (weeks[k][code] || 0) + t.total
  })
  const weekly = Object.values(weeks).sort((a, b) => a.key.localeCompare(b.key)).map((w) => ({ ...w, label: weekLabel(w.key) }))

  const byUnit = hubs.map((u) => {
    const r = rows.filter((t) => t.destination_id === u.id)
    const p = sum(r.filter((t) => t.paid))
    return { name: u.name, code: u.code, paid: p, open: sum(r) - p, total: sum(r), n: r.length }
  })

  const t0 = today()
  const buckets = [['Até 7 dias', 0, 7], ['8 a 15 dias', 8, 15], ['16 a 30 dias', 16, 30], ['31 a 60 dias', 31, 60], ['Mais de 60 dias', 61, 1e9]]
  const aging = buckets.map(([label, a, b]) => {
    const lo = addDays(t0, -b), hi = addDays(t0, -a)
    const r = rows.filter((t) => !t.paid && t.date >= lo && t.date <= hi)
    return { label, value: sum(r), n: r.length }
  })
  const oldestOpen = rows.filter((t) => !t.paid).map((t) => t.date).sort()[0]

  const prods = {}
  rows.forEach((t) => {
    const p = (prods[t.product_name] ??= { name: t.product_name, unit: measureOf(t), qty: 0, value: 0, paid: 0, open: 0, n: 0, last: '' })
    p.qty += t.quantity; p.value += t.total; p[t.paid ? 'paid' : 'open'] += t.total; p.n++; if (t.date > p.last) p.last = t.date
  })
  const products = Object.values(prods)

  return { total, paid, open: total - paid, n: rows.length, days, monthly, weekly, byUnit, aging, oldestOpen, products, qty: rows.reduce((s, t) => s + t.quantity, 0), productCount: products.length }
}

function Kpis({ m }) {
  const share = m.total ? m.paid / m.total : 0
  return (
    <div className="kpis" style={{ marginBottom: 0 }}>
      <div className="card kpi"><small><Wallet />Valor transferido</small><div className="val">{money(m.total)}</div><div className="sub">{m.n.toLocaleString('pt-BR')} lançamentos · {m.productCount} produtos</div></div>
      <div className="card kpi"><small><CheckCircle2 style={{ color: 'var(--good)' }} />Pago</small><div className="val">{money(m.paid)}</div>
        <div className="bar"><span style={{ width: `${share * 100}%`, background: C_PAID }} /><span style={{ flex: 1, background: C_OPEN }} /></div>
        <div className="sub">{pct(share)} do total</div></div>
      <div className="card kpi"><small><Clock style={{ color: 'var(--warn)' }} />Em aberto</small><div className="val">{money(m.open)}</div><div className="sub">{m.oldestOpen ? `Mais antigo: ${dateBR(m.oldestOpen)}` : 'Nada pendente'}</div></div>
      <div className="card kpi"><small><ArrowLeftRight />Média por dia com envio</small><div className="val">{money(m.days ? m.total / m.days : 0)}</div><div className="sub">{m.days} dias com transferência</div></div>
    </div>
  )
}

function Widget({ id, m, hubs, topN }) {
  if (id === 'monthly') return (
    <div className="chart">
      <ResponsiveContainer>
        <BarChart data={m.monthly} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={moneyShort} width={70} />
          <Tooltip cursor={{ fill: 'var(--surface-3)', opacity: .6 }} content={<Tip />} />
          <Bar dataKey="paid" name="Pago" stackId="a" fill={C_PAID} stroke="var(--surface)" strokeWidth={1} />
          <Bar dataKey="open" name="Em aberto" stackId="a" fill={C_OPEN} stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )

  if (id === 'weekly') return (
    <div className="chart">
      <ResponsiveContainer>
        <LineChart data={m.weekly} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} tickFormatter={moneyShort} width={70} />
          <Tooltip cursor={{ stroke: 'var(--axis)' }} content={<Tip labelFmt={(l) => `Semana ${l}`} />} />
          {hubs.map((u) => <Line key={u.id} type="linear" dataKey={u.code} name={u.name} stroke={UNIT_COLORS[u.code] || 'var(--series-3)'} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  if (id === 'byUnit') return (
    <div style={{ padding: '10px 18px 16px' }}>
      {m.byUnit.map((u) => (
        <div key={u.code} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <strong className="unit-tag"><i className="unit-dot" style={{ background: UNIT_COLORS[u.code] }} />{u.name}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{u.n} lançamentos · {money(u.total)}</span>
          </div>
          <div className="kpi" style={{ padding: 0 }}>
            <div className="bar" style={{ height: 10 }}>
              {u.total > 0 && <span style={{ width: `${(u.paid / u.total) * 100}%`, background: C_PAID }} />}
              {u.open > 0 && <span style={{ flex: 1, background: C_OPEN }} />}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 13 }}>
            <span><span className="muted">Pago </span><strong style={{ color: 'var(--good)' }}>{money(u.paid)}</strong></span>
            <span><span className="muted">A pagar à Yankee </span><strong style={{ color: 'var(--warn)' }}>{money(u.open)}</strong></span>
          </div>
        </div>
      ))}
    </div>
  )

  if (id === 'aging') {
    const max = Math.max(...m.aging.map((a) => a.value), 1)
    return (
      <table className="mini-table" style={{ marginTop: 8 }}>
        <thead><tr><th>Pendente há</th><th className="num">Lançamentos</th><th style={{ width: '45%' }}>Valor em aberto</th></tr></thead>
        <tbody>
          {m.aging.map((a) => (
            <tr key={a.label}>
              <td>{a.label}</td>
              <td className="num">{a.n}</td>
              <td className="inbar"><div className="b" style={{ width: `${(a.value / max) * 85}%`, background: 'color-mix(in srgb, var(--st-warn) 22%, transparent)' }} /><span className="num" style={{ display: 'block', textAlign: 'left', paddingLeft: 8, fontWeight: 600 }}>{money(a.value)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (id === 'topQty') return <TopQty products={m.products} topN={topN} />
  if (id === 'topValue') {
    const key = 'value'
    const data = [...m.products].sort((a, b) => b[key] - a[key]).slice(0, topN)
    const fmt = key === 'value' ? money : qty
    return (
      <div className="chart" style={{ height: Math.max(220, data.length * 30 + 30) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" {...axisProps} tickFormatter={key === 'value' ? moneyShort : qty} />
            <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={190} tick={{ fill: 'var(--text-2)', fontSize: 11.5 }} tickFormatter={(s) => (s.length > 28 ? s.slice(0, 27) + '…' : s)} />
            <Tooltip cursor={{ fill: 'var(--surface-3)', opacity: .6 }} content={<Tip fmt={fmt} />} />
            <Bar dataKey={key} name={key === 'value' ? 'Valor' : 'Quantidade'} fill="var(--series-1)" radius={[0, 4, 4, 0]}
              label={{ position: 'right', fill: 'var(--text-2)', fontSize: 11.5, formatter: (v) => (key === 'value' ? moneyShort(v) : qty(v)) }} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (id === 'products') return <ProductTable products={m.products} />
  return null
}

function ProductTable({ products }) {
  const [sort, setSort] = useState({ key: 'value', dir: -1 })
  const rows = [...products].sort((a, b) => (typeof a[sort.key] === 'string' ? a[sort.key].localeCompare(b[sort.key]) : a[sort.key] - b[sort.key]) * sort.dir)
  const max = Math.max(...products.map((p) => p.value), 1)
  const th = (k, l, num = true) => (
    <th className={num ? 'num' : ''} style={{ cursor: 'pointer' }} onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : num ? -1 : 1 })}>
      {l}{sort.key === k ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  )
  return (
    <div style={{ maxHeight: 440, overflow: 'auto', marginTop: 8 }}>
      <table className="mini-table">
        <thead><tr>{th('name', 'Produto', false)}{th('n', 'Lançam.')}{th('qty', 'Quantidade')}{th('value', 'Valor')}{th('paid', 'Pago')}{th('open', 'Em aberto')}{th('last', 'Último envio')}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.name}>
              <td style={{ fontWeight: 500 }}>{p.name}</td>
              <td className="num">{p.n}</td>
              <td className="num">{qty(p.qty)} <span className="muted">{p.unit}</span></td>
              <td className="num inbar" style={{ minWidth: 140 }}><div className="b" style={{ width: `${(p.value / max) * 85}%`, left: 'auto', right: 0, borderRadius: '4px 0 0 4px' }} /><span style={{ fontWeight: 600 }}>{money(p.value)}</span></td>
              <td className="num" style={{ color: 'var(--good)' }}>{money(p.paid)}</td>
              <td className="num" style={{ color: p.open ? 'var(--warn)' : 'var(--text-3)' }}>{money(p.open)}</td>
              <td className="num">{dateBR(p.last)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Customize({ prefs, setPrefs, onClose }) {
  const move = (k, d) => setPrefs((p) => { const o = [...p.order]; const i = o.indexOf(k); const j = i + d; if (j < 0 || j >= o.length) return p; [o[i], o[j]] = [o[j], o[i]]; return { ...p, order: o } })
  const toggle = (k) => setPrefs((p) => ({ ...p, hidden: p.hidden.includes(k) ? p.hidden.filter((x) => x !== k) : [...p.hidden, k] }))
  const resize = (k) => setPrefs((p) => ({ ...p, size: { ...p.size, [k]: (p.size[k] || WIDGETS[k].size) === 'full' ? 'half' : 'full' } }))
  return (
    <Modal title="Personalizar dashboard" onClose={onClose}
      footer={<>
        <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setPrefs(DEFAULT_PREFS)}><RotateCcw />Restaurar padrão</button>
        <button className="btn primary" onClick={onClose}>Pronto</button>
      </>}>
      <p className="muted" style={{ marginTop: 0 }}>Mostre, esconda, reordene e ajuste a largura dos blocos. Fica salvo para o seu usuário.</p>
      <div className="custom-list">
        {prefs.order.map((k, i) => {
          const off = prefs.hidden.includes(k), full = (prefs.size[k] || WIDGETS[k].size) === 'full'
          return (
            <div key={k} className={`custom-row ${off ? 'off' : ''}`}>
              <button className="btn ghost icon" onClick={() => toggle(k)} aria-label={off ? 'Mostrar' : 'Esconder'} title={off ? 'Mostrar' : 'Esconder'}>{off ? <EyeOff /> : <Eye />}</button>
              <div className="name">{WIDGETS[k].title}<small>{WIDGETS[k].desc}</small></div>
              {k !== 'kpis' && <button className="btn ghost icon" onClick={() => resize(k)} title={full ? 'Meia largura' : 'Largura total'} aria-label="Alterar largura">{full ? <Minimize2 /> : <Maximize2 />}</button>}
              <button className="btn ghost icon" disabled={i === 0} onClick={() => move(k, -1)} aria-label="Subir"><ChevronUp /></button>
              <button className="btn ghost icon" disabled={i === prefs.order.length - 1} onClick={() => move(k, 1)} aria-label="Descer"><ChevronDown /></button>
            </div>
          )
        })}
      </div>
      <label className="field" style={{ marginTop: 14 }}><span>Quantidade de produtos nos rankings</span>
        <select className="select" value={prefs.topN} onChange={(e) => setPrefs((p) => ({ ...p, topN: Number(e.target.value) }))}>
          {[5, 10, 15, 20].map((n) => <option key={n} value={n}>Top {n}</option>)}
        </select>
      </label>
    </Modal>
  )
}

function TopQty({ products, topN }) {
  const [unit, setUnit] = useState('kg')
  const data = products.filter((p) => (p.unit || 'kg') === unit).sort((a, b) => b.qty - a.qty).slice(0, topN)
  const fmt = (v) => `${qty(v)} ${unit}`
  return (
    <>
      <div style={{ padding: '10px 18px 0' }}>
        <div className="seg" role="group" aria-label="Unidade de medida">
          <button aria-pressed={unit === 'kg'} onClick={() => setUnit('kg')}>Em kg</button>
          <button aria-pressed={unit === 'un'} onClick={() => setUnit('un')}>Em unidades</button>
        </div>
      </div>
      {!data.length ? <div className="empty">Nenhum produto em {unit} no período.</div> : (
        <div className="chart" style={{ height: Math.max(200, data.length * 30 + 30) }}>
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 80, left: 8, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid horizontal={false} stroke="var(--grid)" />
              <XAxis type="number" {...axisProps} tickFormatter={qty} />
              <YAxis type="category" dataKey="name" {...axisProps} axisLine={false} width={190} tick={{ fill: 'var(--text-2)', fontSize: 11.5 }} tickFormatter={(s) => (s.length > 28 ? s.slice(0, 27) + '…' : s)} />
              <Tooltip cursor={{ fill: 'var(--surface-3)', opacity: .6 }} content={<Tip fmt={fmt} />} />
              <Bar dataKey="qty" name="Quantidade" fill="var(--series-1)" radius={[0, 4, 4, 0]}
                label={{ position: 'right', fill: 'var(--text-2)', fontSize: 11.5, formatter: qty }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  )
}
