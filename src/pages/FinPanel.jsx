import React, { useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine, Legend } from 'recharts'
import { AlertTriangle, CalendarDays, CheckCircle2, ChartBarBig, Clock, Pencil, Pause, Play, Plus, Target, Trash2, Undo2, Upload, Wallet, Inbox } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, moneyShort, dateBR, today, toISO } from '../lib/format.js'
import {
  UNIDADES, CATEGORIAS, GRUPOS, INICIO, buildContas, resumoContas, vendasPorDia, calcMeta, comparativo, mixPagamentos,
  mesesDre, dre, parseFixos, detectImport, addDaysISO, mesNome, okUnidade,
  CATS_PRODUTO, SEM_CAT, categoriaDe, parse3lmItens, rankingProdutos, agrupa,
} from '../lib/fin.js'
import { Modal, SortTh, useToast, useConfirm } from '../components/ui.jsx'

const axisProps = { stroke: 'var(--axis)', tick: { fill: 'var(--text-3)', fontSize: 11.5 }, tickLine: false }
const FORMA_COR = { Crédito: 'var(--series-1)', Débito: 'var(--series-2)', Pix: 'var(--series-3)', Dinheiro: 'var(--st-warn)', Outros: 'var(--text-3)' }
const STATUS_PILL = { Atrasado: 'danger', 'Vence hoje': 'warn', 'Próximos 7 dias': 'accent', 'A vencer': '', Pago: 'good' }
const pct = (v) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const pctS = (v) => `${v > 0 ? '+' : ''}${pct(v)}`
const dm = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
const mesNomeCurto = (mm) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`2000-${mm}-01T00:00:00Z`)).replace('.', '')

function ChartTip({ active, payload, label, fmtLabel = (l) => l }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((t, p) => t + (Number(p.value) || 0), 0)
  return (
    <div className="chart-tip">
      <div className="ct-title">{fmtLabel(label)}{payload.length > 1 ? ` · ${money(total)}` : ''}</div>
      {payload.map((p) => <div key={p.dataKey}><span className="sw" style={{ background: p.color || p.fill }} />{payload.length > 1 ? `${p.name}: ` : ''}{money(p.value)}</div>)}
    </div>
  )
}

export default function FinPanel({ store, tab }) {
  const fin = store.fin
  const [unidade, setUnidade] = useState('Todas')
  const [importing, setImporting] = useState(false)
  const [novaConta, setNovaConta] = useState(null)
  const hoje = today()

  const contasAll = useMemo(() => (fin ? buildContas(fin, hoje) : []), [fin, hoje])
  const contas = useMemo(() => contasAll.filter(okUnidade(unidade)), [contasAll, unidade])
  const meta = useMemo(() => (fin ? calcMeta(fin.vendas, fin.historico, unidade) : null), [fin, unidade])
  if (!fin) return <div className="center-screen"><div className="spinner" /></div>
  const r = resumoContas(contas, hoje)

  const ctx = { store, fin, unidade, contas, meta, hoje, openNovaConta: setNovaConta, openImport: () => setImporting(true) }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Financeiro</h1>
          <p>
            Hoje vencem <strong>{money(r.hoje.v)}</strong>, há <strong className={r.atraso.n ? 'txt-danger' : ''}>{money(r.atraso.v)}</strong> em atraso
            {meta?.metaMes ? <> e as vendas do mês estão em <strong>{pct(meta.pct)}</strong> da meta, com projeção de <strong>{pct(meta.pctProj)}</strong>.</> : '.'}
          </p>
        </div>
        <div className="head-actions">
          <select className="select" style={{ width: 170 }} value={unidade} onChange={(e) => setUnidade(e.target.value)} aria-label="Unidade">
            <option value="Todas">Todas as unidades</option>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button className="btn" onClick={() => setImporting(true)}><Upload />Importar 3LM</button>
          <button className="btn primary" onClick={() => setNovaConta({})}><Plus />Nova conta</button>
        </div>
      </div>
      {tab === 'fin-visao' && <Visao ctx={ctx} r={r} />}
      {tab === 'fin-pagar' && <Pagar ctx={ctx} />}
      {tab === 'fin-vendas' && <Vendas ctx={ctx} />}
      {tab === 'fin-produtos' && <Produtos ctx={ctx} />}
      {tab === 'fin-dre' && <Dre ctx={ctx} />}
      {tab === 'fin-fixos' && <Fixos ctx={ctx} />}
      {importing && <ImportFin store={store} onClose={() => setImporting(false)} />}
      {novaConta && <ContaForm store={store} conta={novaConta} onClose={() => setNovaConta(null)} />}
    </>
  )
}

// =====================================================================
// Visão geral
// =====================================================================
function Visao({ ctx, r }) {
  const { contas, meta, fin, unidade, hoje } = ctx
  const em7 = addDaysISO(hoje, 7)
  const agenda = useMemo(() => {
    const m = new Map()
    for (const c of contas) if (c.status !== 'Pago' && c.status !== 'Atrasado') m.set(c.vencimento, (m.get(c.vencimento) || 0) + c.valor)
    return [...m].sort().map(([dia, valor]) => ({ dia, valor }))
  }, [contas])
  const total = r.mes.pago + r.mes.aberto
  return (
    <>
      <div className="kpis kpis-5">
        <Kpi tone="warn" icon={CalendarDays} label="Vence hoje" value={money(r.hoje.v)} sub={`${r.hoje.n} boleto${r.hoje.n === 1 ? '' : 's'}`} />
        <Kpi icon={Clock} label="Próximos 7 dias" value={money(r.prox.v)} sub={`${r.prox.n} boleto${r.prox.n === 1 ? '' : 's'}`} />
        <Kpi tone={r.atraso.n ? 'bad' : ''} icon={AlertTriangle} label={`Em atraso (desde ${dm(`${INICIO}-01`)})`} value={money(r.atraso.v)} sub={`${r.atraso.n} boleto${r.atraso.n === 1 ? '' : 's'}`} />
        <Kpi icon={Wallet} label="Pago no mês" value={money(r.mes.pago)} sub={`${money(r.mes.aberto)} a pagar · ${pct(total ? r.mes.pago / total : 0)} pago`} />
        <Kpi tone="good" icon={Target} label="Vendas no mês" value={money(meta.vendido)}
          sub={meta.metaMes ? `Meta ${money(meta.metaMes)} · faltam ${money(meta.falta)}` : 'Sem histórico para calcular a meta'} bar={meta.metaMes ? meta.pct : null} />
      </div>
      <div className="fin-grid">
        <div className="card">
          <div className="card-head"><div><h3>Agenda de pagamentos</h3><p>Boletos em aberto por dia de vencimento, de hoje em diante.</p></div></div>
          <div className="chart-box">
            {agenda.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={agenda} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="dia" tickFormatter={dm} {...axisProps} />
                  <YAxis tickFormatter={moneyShort} width={64} {...axisProps} />
                  <Tooltip content={<ChartTip fmtLabel={(l) => dateBR(l)} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="valor" name="A pagar" radius={[4, 4, 0, 0]} maxBarSize={32}>
                    {agenda.map((a) => <Cell key={a.dia} fill={a.dia === hoje ? 'var(--st-warn)' : a.dia <= em7 ? 'var(--accent)' : 'var(--axis)'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="empty"><CheckCircle2 /><div>Nenhum boleto em aberto.</div></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Vendas por dia</h3><p>Por forma de pagamento. A linha tracejada é a meta de um dia normal.</p></div></div>
          <VendasDiaChart vendas={fin.vendas} unidade={unidade} meta={meta} />
        </div>
      </div>
    </>
  )
}

function Kpi({ icon: I, label, value, sub, tone = '', bar = null }) {
  return (
    <div className={`card kpi fin-kpi ${tone ? `is-${tone}` : ''}`}>
      <small><I />{label}</small>
      <div className="val">{value}</div>
      <div className="sub">{sub}</div>
      {bar !== null && <div className="goal-bar" style={{ marginTop: 8 }}><span className={bar >= 1 ? 'hit' : ''} style={{ width: `${Math.min(bar, 1) * 100}%` }} /></div>}
    </div>
  )
}

function VendasDiaChart({ vendas, unidade, meta }) {
  const rows = useMemo(() => vendasPorDia(vendas, unidade).filter((r) => r.dia.startsWith(meta.mes)), [vendas, unidade, meta.mes])
  if (!rows.length) return <div className="empty"><Inbox /><div>Sem vendas registradas para esta unidade.</div></div>
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="dia" tickFormatter={(d) => (d === meta.promoDia ? `${dm(d)} ★` : dm(d))} {...axisProps} />
          <YAxis tickFormatter={moneyShort} width={64} {...axisProps} />
          <Tooltip content={<ChartTip fmtLabel={(l) => `${dateBR(l)}${l === meta.promoDia ? ' · promoção' : ''}`} />} cursor={{ fill: 'var(--surface-2)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {['Crédito', 'Débito', 'Pix', 'Dinheiro'].map((k, i, a) => <Bar key={k} dataKey={k} stackId="v" fill={FORMA_COR[k]} maxBarSize={36} radius={i === a.length - 1 ? [4, 4, 0, 0] : 0} />)}
          {meta.metaDiaNormal > 0 && <ReferenceLine y={meta.metaDiaNormal} stroke="var(--text-2)" strokeDasharray="4 4" label={{ value: 'meta/dia', position: 'insideTopRight', fill: 'var(--text-3)', fontSize: 11 }} />}
        </BarChart>
      </ResponsiveContainer>
      {meta.promoDia && <p className="hint" style={{ margin: '4px 0 0' }}>★ terça da promoção ({dm(meta.promoDia)}), fora da média diária.</p>}
    </div>
  )
}

// =====================================================================
// Contas a pagar
// =====================================================================
const CHIPS = [['', 'Todos em aberto'], ['Atrasado', 'Em atraso'], ['Vence hoje', 'Vence hoje'], ['Próximos 7 dias', 'Próximos 7 dias'], ['A vencer', 'A vencer'], ['Pago', 'Contas pagas']]

function Pagar({ ctx }) {
  const { store, contas, hoje, openNovaConta } = ctx
  const toast = useToast()
  const confirm = useConfirm()
  const [y, m] = hoje.split('-').map(Number)
  const [from, setFrom] = useState(`${hoje.slice(0, 7)}-01`)
  const [to, setTo] = useState(toISO(new Date(y, m + 1, 0)))
  const [status, setStatus] = useState('')
  const [sel, setSel] = useState(new Set())
  const [payDate, setPayDate] = useState(hoje)
  const [busy, setBusy] = useState(false)

  const rows = contas.filter((r) => {
    const inR = r.vencimento >= from && r.vencimento <= to
    if (status === 'Pago') return r.status === 'Pago' && inR
    if (r.status === 'Pago') return false
    if (status && r.status !== status) return false
    return r.status === 'Atrasado' || inR
  }).sort((a, b) => a.vencimento.localeCompare(b.vencimento) || b.valor - a.valor)
  const per = resumoContas(contas, hoje, [from, to]).periodo
  const selRows = rows.filter((r) => sel.has(r.id))
  const allSel = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const marcar = async (pago) => {
    const ids = selRows.filter((r) => (pago ? r.status !== 'Pago' : r.status === 'Pago')).map((r) => r.id)
    if (!ids.length) return
    setBusy(true)
    try {
      await api.finSetPago(ids, pago ? payDate : null)
      store.setFin((f) => ({ ...f, pagamentos: [...f.pagamentos.filter((p) => !ids.includes(p.id)), ...(pago ? ids.map((id) => ({ id, data: payDate })) : [])] }))
      toast(pago ? `${ids.length} conta${ids.length > 1 ? 's' : ''} marcada${ids.length > 1 ? 's' : ''} como paga${ids.length > 1 ? 's' : ''}.` : 'Voltou para em aberto.')
      setSel(new Set())
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const remove = async (c) => {
    if (!(await confirm({ title: 'Excluir conta', message: `Excluir "${c.contraparte}" de ${money(c.valor)}?`, ok: 'Excluir', danger: true }))) return
    try { await api.finDeleteLancamento(c.id); store.setFin((f) => ({ ...f, lancamentos: f.lancamentos.filter((l) => l.id !== c.id), pagamentos: f.pagamentos.filter((p) => p.id !== c.id) })) } catch (e) { toast(e.message, 'error') }
  }
  const lancById = Object.fromEntries(ctx.fin.lancamentos.map((l) => [l.id, l]))

  return (
    <div className="card">
      <div className="filters fin-filters">
        <label className="fin-date">De <input type="date" className="input" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label className="fin-date">Até <input type="date" className="input" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <div className="seg" role="group" aria-label="Situação">
          {CHIPS.map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => { setStatus(k); setSel(new Set()) }}>{l}</button>)}
        </div>
      </div>
      <div className="fin-split">
        <span>Pago no período <b>{money(per.pago)}</b></span>
        <span>A pagar <b>{money(per.aberto)}</b></span>
        <span><b>{pct(per.pago + per.aberto ? per.pago / (per.pago + per.aberto) : 0)}</b> pago</span>
        <span className="muted">{rows.length} boleto{rows.length === 1 ? '' : 's'} · {money(rows.reduce((t, r) => t + r.valor, 0))}{status === 'Pago' ? '' : ' (os em atraso aparecem sempre)'}</span>
      </div>
      <div className={`fin-paybar ${selRows.length ? 'on' : ''}`}>
        <strong>{selRows.length} selecionado{selRows.length === 1 ? '' : 's'}</strong>
        {selRows.length > 0 && <span className="muted">{money(selRows.reduce((t, r) => t + r.valor, 0))}</span>}
        <label className="fin-date">Pago em <input type="date" className="input" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} /></label>
        <button className="btn success" disabled={busy || !selRows.some((r) => r.status !== 'Pago')} onClick={() => marcar(true)}><CheckCircle2 />Marcar como pago</button>
        <button className="btn" disabled={busy || !selRows.some((r) => r.status === 'Pago')} onClick={() => marcar(false)}><Undo2 />Voltar para em aberto</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: '62vh' }}>
        <table className="data">
          <thead><tr>
            <th className="w-check"><input type="checkbox" className="check" checked={allSel} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Selecionar todos" /></th>
            <th>Vencimento</th><th>Fornecedor</th><th className="hide-sm">Categoria</th><th className="hide-sm">Unidade</th><th>Situação</th><th className="num">Valor</th><th />
          </tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={sel.has(c.id) ? 'selected' : ''} onClick={(e) => { if (!e.target.closest('button,input')) toggle(c.id) }}>
                <td className="w-check"><input type="checkbox" className="check" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Selecionar ${c.contraparte}`} /></td>
                <td className="nowrap">{dateBR(c.vencimento)}</td>
                <td><strong>{c.contraparte}</strong>{c.fixo && <span className="pill" style={{ marginLeft: 6 }}>fixo</span>}{c.origem === 'manual' && <span className="pill" style={{ marginLeft: 6 }}>manual</span>}</td>
                <td className="hide-sm muted">{c.grupo} › {c.categoria}</td>
                <td className="hide-sm muted">{c.unidade}</td>
                <td><span className={`pill ${STATUS_PILL[c.status]}`}>{c.status === 'Pago' ? `Pago em ${dm(c.pagoEm)}` : c.status}</span></td>
                <td className="num"><strong>{money(c.valor)}</strong></td>
                <td className="nowrap" style={{ textAlign: 'right' }}>
                  {c.origem === 'manual' && <>
                    <button className="btn ghost icon" title="Editar" aria-label="Editar conta" onClick={() => openNovaConta(lancById[c.id])}><Pencil /></button>
                    <button className="btn ghost icon" title="Excluir" aria-label="Excluir conta" onClick={() => remove(c)}><Trash2 /></button>
                  </>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><div className="empty"><CheckCircle2 /><div>Nada por aqui.</div></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ContaForm({ store, conta, onClose }) {
  const toast = useToast()
  const [f, setF] = useState({ vencimento: today(), contraparte: '', grupo: 'CMV', categoria: '', unidade: 'ZN Salão', valor: '', ...conta, valor: conta.valor ?? '' })
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    const valor = Number(String(f.valor).replace(',', '.'))
    if (!f.contraparte.trim() || !(valor > 0)) return toast('Preencha fornecedor e valor.', 'error')
    const l = {
      id: f.id || `M-${Date.now().toString(36)}`, tipo: 'Saída', vencimento: f.vencimento, competencia: f.competencia && f.id ? f.competencia : f.vencimento,
      unidade: f.unidade, grupo: f.grupo, categoria: f.categoria || f.grupo, subcategoria: f.categoria || f.grupo, contraparte: f.contraparte.trim(), valor, origem: 'manual',
    }
    setBusy(true)
    try {
      const saved = await api.finSaveLancamento(l)
      store.setFin((x) => ({ ...x, lancamentos: [...x.lancamentos.filter((r) => r.id !== l.id), { ...saved, valor: Number(saved.valor) }] }))
      toast('Conta salva.'); onClose()
    } catch (e2) { toast(e2.message, 'error') } finally { setBusy(false) }
  }
  const cats = CATEGORIAS.find(([g]) => g === f.grupo)?.[1] || []
  return (
    <Modal title={conta.id ? 'Editar conta' : 'Nova conta a pagar'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" form="fcf" disabled={busy}>Salvar</button></>}>
      <form id="fcf" onSubmit={save} className="stack">
        <p className="hint" style={{ margin: 0 }}>Para contas fora do 3LM (aluguel, impostos, parcelas). Contas que se repetem todo mês ficam melhor em Custos fixos.</p>
        <label className="field"><span>Fornecedor / descrição</span><input className="input" value={f.contraparte} onChange={(e) => setF({ ...f, contraparte: e.target.value })} required autoFocus /></label>
        <div className="grid-2">
          <label className="field"><span>Vencimento</span><input type="date" className="input" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} required /></label>
          <label className="field"><span>Valor (R$)</span><input className="input num" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} required /></label>
          <label className="field"><span>Grupo da DRE</span>
            <select className="select" value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value, categoria: '' })}>{GRUPOS.map((g) => <option key={g}>{g}</option>)}</select>
          </label>
          <label className="field"><span>Categoria</span>
            <input className="input" list="fin-cats" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder={cats[0]?.[1] || 'Opcional'} />
            <datalist id="fin-cats">{cats.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</datalist>
          </label>
          <label className="field"><span>Unidade</span>
            <select className="select" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
          </label>
        </div>
      </form>
    </Modal>
  )
}

// =====================================================================
// Vendas e meta
// =====================================================================
function Vendas({ ctx }) {
  const { fin, unidade, meta } = ctx
  const comp = useMemo(() => comparativo(fin.historico, fin.vendas, unidade), [fin, unidade])
  const mix = useMemo(() => mixPagamentos(fin.vendas, unidade, meta.mes), [fin, unidade, meta.mes])
  const maxShare = Math.max(0.0001, ...mix.map((x) => x.share))
  const anoCor = (a, i) => (i === comp.anos.length - 1 ? 'var(--accent)' : 'var(--axis)')
  return (
    <>
      <div className="card fin-goal">
        <div className="fg-main">
          <small className="muted">Meta de {mesNome(meta.mes)}</small>
          <div className="fg-big">{meta.metaMes ? money(meta.metaMes) : '—'}</div>
          {meta.metaMes ? (
            <>
              <div className="goal-bar fg-bar"><span className={meta.pct >= 1 ? 'hit' : ''} style={{ width: `${Math.min(meta.pct, 1) * 100}%` }} /><i style={{ left: `${Math.min(meta.pctProj, 1) * 100}%` }} title="Projeção" /></div>
              <div className="fg-row">
                <span>Vendido <b>{money(meta.vendido)}</b> ({pct(meta.pct)})</span>
                <span>Projeção <b>{money(meta.projecao)}</b> ({pct(meta.pctProj)})</span>
              </div>
            </>
          ) : <p className="hint">Sem faturamento do mesmo mês do ano passado para calcular a meta desta unidade.</p>}
        </div>
        {meta.metaMes > 0 && (
          <div className="fg-falta">
            <small className="muted">Falta para a meta</small>
            <div className="fg-big">{money(meta.falta)}</div>
            <p>{meta.falta > 0
              ? <>Precisa de <b>{money(meta.precisaDia)}</b> por dia nos {meta.restantes} dias normais que restam{meta.promoFutura ? ', mais a terça da promoção' : ''}. Média atual: <b>{money(meta.mediaNormal)}</b>.</>
              : 'Meta batida. Tudo o que entrar agora é acima da meta.'}</p>
          </div>
        )}
      </div>
      <div className="kpis">
        <Kpi icon={Wallet} label="Média diária sem a promoção" value={money(meta.mediaNormal)} sub={`${meta.diasNormais} dias normais · ano passado ${money(meta.mediaLy)}`} />
        <Kpi icon={CalendarDays} label="Terça da promoção" value={money(meta.promoAtual)} sub={`${dm(meta.promoDia)} · média das últimas 3: ${money(meta.promoMeta)}`} />
        <Kpi icon={Target} label="Meta de um dia normal" value={money(meta.metaDiaNormal)} sub={`Tendência ${pctS(meta.cresc)} + impulso ${pct(meta.impulso)}`} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>Mesmo mês, ano a ano</h3><p>Faturamento de cada mês. O mês atual mostra o vendido até agora.</p></div></div>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={comp.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="mes" tickFormatter={mesNomeCurto} {...axisProps} />
              <YAxis tickFormatter={moneyShort} width={64} {...axisProps} />
              <Tooltip content={<ChartTip fmtLabel={mesNomeCurto} />} cursor={{ fill: 'var(--surface-2)' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              {comp.anos.map((a, i) => <Bar key={a} dataKey={a} name={a} fill={anoCor(a, i)} radius={[4, 4, 0, 0]} maxBarSize={32} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="fin-grid">
        <div className="card">
          <div className="card-head"><div><h3>Mix de pagamentos</h3><p>Participação de cada forma no vendido do mês.</p></div></div>
          <div className="fin-mix">
            {mix.map((x) => (
              <div key={x.forma} className="fm-row">
                <span>{x.forma}</span>
                <div className="fm-bar"><span style={{ width: `${(x.share / maxShare) * 100}%`, background: FORMA_COR[x.grupo] || FORMA_COR.Outros }} /></div>
                <b>{pct(x.share)}</b><small className="muted">{moneyShort(x.valor)}</small>
              </div>
            ))}
            {!mix.length && <div className="empty"><Inbox /><div>Sem vendas no mês.</div></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Vendas por dia</h3><p>A linha tracejada é a meta de um dia normal.</p></div></div>
          <VendasDiaChart vendas={fin.vendas} unidade={unidade} meta={meta} />
        </div>
      </div>
      <details className="fin-foot">
        <summary>Como a meta é calculada</summary>
        <p>Parte do faturamento do mesmo mês do ano passado, sem a terça da promoção. Aplica a tendência dos últimos 3 meses contra os mesmos meses do ano anterior e um impulso de {pct(meta.impulso)}, e soma a média das últimas 3 terças de promoção. A projeção usa a média diária atual (sem a promoção) nos dias que faltam.</p>
      </details>
    </>
  )
}

// =====================================================================
// Produtos vendidos (3LM → Itens vendidos → Dia a Dia)
// =====================================================================
const nomeProd = (s) => String(s || '').toLowerCase().replace(/(^|[\s(/-])\S/g, (u) => u.toUpperCase())
const CLASSE_PILL = { A: 'good', B: 'accent', C: 'warn' }
const qtdFmt = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const ACESSORIOS = ['Extras', 'Molhos', 'Embalagem'] // ficam fora de mais/menos vendidos, salvo se filtrados
const PRESETS = [['ultimo', 'Último dia'], ['7d', '7 dias'], ['mes', 'Este mês'], ['mespassado', 'Mês passado']]

function rangeDe(preset, ultimo) {
  const [y, m] = ultimo.split('-').map(Number)
  if (preset === 'ultimo') return [ultimo, ultimo]
  if (preset === '7d') return [addDaysISO(ultimo, -6), ultimo]
  if (preset === 'mespassado') return [toISO(new Date(y, m - 2, 1)), toISO(new Date(y, m - 1, 0))]
  return [`${ultimo.slice(0, 7)}-01`, ultimo]
}

function Produtos({ ctx }) {
  const { fin, unidade, openImport } = ctx
  const itens = fin.itens || []
  const produtos = useMemo(() => Object.fromEntries((fin.produtos || []).map((p) => [p.codigo, p])), [fin.produtos])
  const ultimo = useMemo(() => itens.reduce((mx, r) => (r.dia > mx ? r.dia : mx), ''), [itens])
  const [preset, setPreset] = useState('mes')
  const [range, setRange] = useState(null)
  const [categoria, setCategoria] = useState('')
  const [ordem, setOrdem] = useState('valor')
  const [busca, setBusca] = useState('')
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' })
  const [editCats, setEditCats] = useState(false)
  const [de, ate] = range || (ultimo ? rangeDe(preset, ultimo) : ['', ''])
  const R = useMemo(() => (ultimo ? rankingProdutos(itens, produtos, { de, ate, unidade, categoria }) : null), [itens, produtos, de, ate, unidade, categoria, ultimo])

  if (!ultimo) {
    return (
      <div className="card">
        <div className="empty">
          <ChartBarBig />
          <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Ainda não há produtos vendidos importados.</div>
          <div style={{ maxWidth: 520, margin: '0 auto 14px', lineHeight: 1.5 }}>
            No 3LM, abra <b>Relatórios → Itens vendidos → Dia a Dia</b>, escolha o período, marque <b>Delimitador ;</b> e clique em Visualizar. Depois importe o arquivo aqui.
          </div>
          <button className="btn primary" onClick={openImport}><Upload />Importar 3LM</button>
        </div>
      </div>
    )
  }

  const metric = (r) => (ordem === 'qtd' ? r.qtd : r.valor)
  const fmtMetric = (v) => (ordem === 'qtd' ? `${qtdFmt(v)} un` : money(v))
  const ordenados = [...R.rows].sort((a, b) => metric(b) - metric(a) || b.valor - a.valor)
  const cardapio = categoria ? ordenados : ordenados.filter((r) => !ACESSORIOS.includes(r.categoria))
  const top = cardapio.slice(0, 10)
  const pagos = cardapio.filter((r) => r.valor > 0)
  const menos = [...pagos].reverse().slice(0, 10)
  const semVenda = categoria ? R.semVenda : R.semVenda.filter((r) => !ACESSORIOS.includes(r.categoria))
  const maxTop = Math.max(0.0001, ...top.map(metric))
  const maxMenos = Math.max(0.0001, ...menos.map(metric))
  const maxCat = Math.max(0.0001, ...R.porCategoria.map((c) => c.share))
  const catDe = (r) => categoriaDe(agrupa(r.codigo, r.nome).codigo, produtos)
  const cats = [...new Set([...CATS_PRODUTO, ...itens.map(catDe)])].filter((c) => itens.some((r) => catDe(r) === c))
  const semCat = new Set(itens.filter((r) => catDe(r) === SEM_CAT).map((r) => agrupa(r.codigo, r.nome).codigo)).size
  const q = busca.trim().toLowerCase()
  const rank = new Map(ordenados.map((r, i) => [r.codigo, i + 1]))
  const val = (r) => (sort.key === 'rank' ? rank.get(r.codigo) : sort.key === 'nome' ? nomeProd(r.nome) : r[sort.key])
  const tabela = ordenados.filter((r) => !q || r.nome.toLowerCase().includes(q) || r.codigo.includes(q)).sort((a, b) => {
    const x = val(a); const y = val(b)
    if (x == null || x === '—') return 1
    if (y == null || y === '—') return -1
    const c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y
    return (sort.dir === 'asc' ? c : -c) || rank.get(a.codigo) - rank.get(b.codigo)
  })
  const lider = ordenados[0]
  const setP = (p) => { setPreset(p); setRange(null) }
  const setD = (i, v) => { if (!v) return; const n = [de, ate]; n[i] = v; if (n[0] > n[1]) n[1 - i] = v; setRange(n); setPreset('') }

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters fin-filters">
          <div className="seg" role="group" aria-label="Período">
            {PRESETS.map(([k, l]) => <button key={k} aria-pressed={preset === k} onClick={() => setP(k)}>{l}</button>)}
          </div>
          <label className="fin-date">De <input type="date" className="input" value={de} onChange={(e) => setD(0, e.target.value)} /></label>
          <label className="fin-date">Até <input type="date" className="input" value={ate} onChange={(e) => setD(1, e.target.value)} /></label>
          <select className="select" style={{ width: 170 }} value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Tipo de produto">
            <option value="">Todos os tipos</option>
            {cats.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Ordenar por">
            <button aria-pressed={ordem === 'valor'} onClick={() => setOrdem('valor')}>Faturamento</button>
            <button aria-pressed={ordem === 'qtd'} onClick={() => setOrdem('qtd')}>Quantidade</button>
          </div>
        </div>
        <div className="fin-split">
          <span>{dateBR(de)} a {dateBR(ate)} · <b>{R.dias}</b> dia{R.dias === 1 ? '' : 's'} com venda</span>
          <span className="muted">Importado até {dateBR(ultimo)}</span>
          {semCat > 0 && <button className="btn ghost sm" onClick={() => setEditCats(true)}><AlertTriangle />{semCat} produto{semCat > 1 ? 's' : ''} sem tipo</button>}
          <button className="btn ghost sm" onClick={() => setEditCats(true)}><Pencil />Tipos dos produtos</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi icon={Wallet} label="Faturamento dos produtos" value={money(R.total)} sub={categoria ? `Só ${categoria.toLowerCase()}` : 'Todos os tipos'} />
        <Kpi icon={ChartBarBig} label="Itens vendidos" value={qtdFmt(R.qtdTotal)} sub={R.dias ? `${qtdFmt(R.qtdTotal / R.dias)} por dia` : '—'} />
        <Kpi icon={CheckCircle2} label="Produtos com venda" value={R.rows.length} sub={`${R.semVenda.length} sem nenhuma venda no período`} tone={R.semVenda.length ? 'warn' : ''} />
        <Kpi icon={Target} label={ordem === 'qtd' ? 'Mais vendido (unidades)' : 'Mais vendido (R$)'} value={lider ? nomeProd(lider.nome) : '—'} sub={lider ? `${fmtMetric(metric(lider))} · ${pct(lider.share)} do faturamento` : ''} />
      </div>

      <div className="fin-grid">
        <div className="card">
          <div className="card-head"><div><h3>Mais vendidos</h3><p>Os 10 que mais saem, por {ordem === 'qtd' ? 'quantidade' : 'faturamento'}{categoria ? '' : ' (sem extras, molhos e embalagem)'}.</p></div></div>
          <div className="fin-mix">
            {top.map((r, i) => (
              <div key={r.codigo} className="fm-row prod-row">
                <span title={r.nome}><i className="muted">{i + 1}.</i> {nomeProd(r.nome)}</span>
                <div className="fm-bar"><span style={{ width: `${(metric(r) / maxTop) * 100}%`, background: 'var(--series-1)' }} /></div>
                <b>{fmtMetric(metric(r))}</b>
              </div>
            ))}
            {!top.length && <div className="empty"><Inbox /><div>Sem vendas no período.</div></div>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>O que menos sai</h3><p>Os 10 com menos {ordem === 'qtd' ? 'unidades' : 'faturamento'}{categoria ? '' : ' no cardápio (sem extras, molhos e embalagem)'}.</p></div></div>
          <div className="fin-mix">
            {menos.map((r) => (
              <div key={r.codigo} className="fm-row prod-row">
                <span title={r.nome}>{nomeProd(r.nome)} <small className="muted">· {r.categoria}</small></span>
                <div className="fm-bar"><span style={{ width: `${(metric(r) / maxMenos) * 100}%`, background: 'var(--st-warn)' }} /></div>
                <b>{fmtMetric(metric(r))}</b>
              </div>
            ))}
            {semVenda.length > 0 && (
              <div className="prod-zero">
                <small className="muted">Sem nenhuma venda no período (vendiam antes)</small>
                <div>{semVenda.slice(0, 24).map((r) => <span key={r.codigo} className="pill warn" title={r.categoria}>{nomeProd(r.nome)}</span>)}{semVenda.length > 24 && <span className="pill">+{semVenda.length - 24}</span>}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>Por tipo de produto</h3><p>Participação de cada tipo no faturamento. Clique para filtrar.</p></div>{categoria && <button className="btn sm" onClick={() => setCategoria('')}>Ver todos</button>}</div>
        <div className="fin-mix prod-cats">
          {R.porCategoria.map((c) => (
            <button key={c.categoria} className={`fm-row prod-cat ${categoria === c.categoria ? 'on' : ''}`} onClick={() => setCategoria(categoria === c.categoria ? '' : c.categoria)}>
              <span>{c.categoria}</span>
              <div className="fm-bar"><span style={{ width: `${(c.share / maxCat) * 100}%`, background: 'var(--series-2)' }} /></div>
              <b>{pct(c.share)}</b><small className="muted">{qtdFmt(c.qtd)} un · {moneyShort(c.valor)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div><h3>Ranking completo</h3><p>Classe A soma os primeiros 80% do faturamento, B os 15% seguintes e C o resto.{R.temAnt ? ` A variação compara com ${dateBR(R.antDe)} a ${dateBR(R.antAte)}.` : ''}</p></div>
          <input className="input" style={{ maxWidth: 220 }} placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produto" />
        </div>
        <div className="table-wrap" style={{ maxHeight: '62vh' }}>
          <table className="data">
            <thead><tr>
              <SortTh k="rank" sort={sort} setSort={setSort} className="num">#</SortTh>
              <SortTh k="nome" sort={sort} setSort={setSort}>Produto</SortTh>
              <SortTh k="categoria" sort={sort} setSort={setSort} className="hide-sm">Tipo</SortTh>
              <SortTh k="qtd" sort={sort} setSort={setSort} className="num">Qtd</SortTh>
              <SortTh k="valor" sort={sort} setSort={setSort} className="num">Faturamento</SortTh>
              <SortTh k="share" sort={sort} setSort={setSort} className="num hide-sm">% do total</SortTh>
              <SortTh k="classe" sort={sort} setSort={setSort}>Classe</SortTh>
              <SortTh k="varQtd" sort={sort} setSort={setSort} className="num hide-sm">Variação</SortTh>
            </tr></thead>
            <tbody>
              {tabela.map((r) => (
                <tr key={r.codigo}>
                  <td className="num muted">{rank.get(r.codigo)}</td>
                  <td><strong>{nomeProd(r.nome)}</strong> <small className="muted">{r.codigo}</small></td>
                  <td className="hide-sm muted">{r.categoria}</td>
                  <td className="num">{qtdFmt(r.qtd)}</td>
                  <td className="num"><strong>{money(r.valor)}</strong></td>
                  <td className="num hide-sm">{pct(r.share)}</td>
                  <td><span className={`pill ${CLASSE_PILL[r.classe] || ''}`}>{r.classe}</span></td>
                  <td className={`num hide-sm ${r.varQtd > 0 ? 'txt-good' : r.varQtd < 0 ? 'txt-danger' : 'muted'}`}>{r.novo ? 'novo' : r.varQtd == null ? '—' : pctS(r.varQtd)}</td>
                </tr>
              ))}
              {!tabela.length && <tr><td colSpan={8}><div className="empty"><Inbox /><div>Nenhum produto.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <details className="fin-foot">
        <summary>De onde vêm esses números</summary>
        <p>Do relatório Itens vendidos → Dia a Dia do 3LM (por data de caixa, com faturamento). Os refis (Coca, Coca Zero, Fanta…) somam numa linha só, "Refil - Geral". A quantidade é a coluna "Qtde"; no Número 1 Promo ela conta cada lanche, por isso passa da quantidade de lançamentos. Itens sem preço (molhos cortesia) entram na quantidade mas não no faturamento. Reimportar um dia substitui o que havia nele.</p>
      </details>
      {editCats && <CategoriasForm store={ctx.store} itens={itens} produtos={produtos} onClose={() => setEditCats(false)} />}
    </>
  )
}

function CategoriasForm({ store, itens, produtos, onClose }) {
  const toast = useToast()
  const lista = useMemo(() => {
    const m = new Map(); for (const r of itens) { const g = agrupa(r.codigo, r.nome); m.set(g.codigo, g.nome) }
    return [...m].map(([codigo, nome]) => ({ codigo, nome: produtos[codigo]?.nome || nome, categoria: categoriaDe(codigo, produtos) }))
      .sort((a, b) => (a.categoria === SEM_CAT ? -1 : 0) - (b.categoria === SEM_CAT ? -1 : 0) || a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome))
  }, [itens, produtos])
  const [cat, setCat] = useState(() => Object.fromEntries(lista.map((p) => [p.codigo, p.categoria])))
  const [busy, setBusy] = useState(false)
  const mudou = lista.filter((p) => cat[p.codigo] !== p.categoria)
  const opcoes = [...new Set([...CATS_PRODUTO, ...lista.map((p) => p.categoria).filter((c) => c !== SEM_CAT)])]
  const save = async () => {
    setBusy(true)
    try {
      const rows = mudou.map((p) => ({ codigo: p.codigo, nome: p.nome, categoria: cat[p.codigo] }))
      await api.finSaveProdutos(rows)
      store.setFin((f) => { const m = new Map((f.produtos || []).map((p) => [p.codigo, p])); rows.forEach((r) => m.set(r.codigo, r)); return { ...f, produtos: [...m.values()] } })
      toast('Tipos atualizados.'); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Tipos dos produtos" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !mudou.length} onClick={save}>{busy ? 'Salvando…' : `Salvar${mudou.length ? ` (${mudou.length})` : ''}`}</button></>}>
      <p className="hint" style={{ marginTop: 0 }}>O tipo vem das categorias do 3LM. Produto novo aparece como "{SEM_CAT}" até você escolher o tipo aqui.</p>
      <div className="table-wrap" style={{ maxHeight: '55vh' }}>
        <table className="data">
          <thead><tr><th>Código</th><th>Produto</th><th>Tipo</th></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.codigo} className={cat[p.codigo] === SEM_CAT ? 'selected' : ''}>
                <td className="muted">{p.codigo}</td>
                <td>{nomeProd(p.nome)}</td>
                <td>
                  <select className="select" value={cat[p.codigo]} onChange={(e) => setCat((c) => ({ ...c, [p.codigo]: e.target.value }))} aria-label={`Tipo de ${p.nome}`}>
                    {cat[p.codigo] === SEM_CAT && <option value={SEM_CAT}>{SEM_CAT}</option>}
                    {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

// =====================================================================
// DRE
// =====================================================================
function Dre({ ctx }) {
  const { fin, contas, unidade, hoje } = ctx
  const meses = useMemo(() => mesesDre(fin, contas, hoje), [fin, contas, hoje])
  const [mes, setMes] = useState(meses.includes(hoje.slice(0, 7)) ? hoje.slice(0, 7) : meses[meses.length - 1] || hoje.slice(0, 7))
  const d = useMemo(() => dre(contas, fin.vendas, mes, unidade), [contas, fin.vendas, mes, unidade])
  const fmt = (v) => (v === null || v === undefined ? '' : money(v))
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>DRE gerencial</h3><p>Por competência. Royalties, passivo do legado e investimento na BV ficam abaixo do EBITDA, para não distorcer a operação.</p></div>
        <select className="select" style={{ width: 190 }} value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mês">
          {meses.map((m) => <option key={m} value={m}>{mesNome(m)}</option>)}
        </select>
      </div>
      <div className="table-wrap" style={{ borderTop: 0 }}>
        <table className="data fin-dre">
          <thead><tr><th>Linha</th><th className="num">Atual <span className="muted">(total do mês)</span></th><th className="num hide-sm">A pagar</th><th className="num">% receita</th></tr></thead>
          <tbody>
            {d.linhas.map((l) => {
              const s = l.sinal || 1
              const isTot = l.tipo === 'tot'
              const atual = isTot ? l.pago : s * (l.pago || 0)
              const total = isTot ? l.total : s * (l.total || 0)
              const vazio = !isTot && !l.total
              return (
                <tr key={l.nome} className={`${l.tipo} ${l.destaque ? 'destaque' : ''}`}>
                  <td>{l.nome}</td>
                  <td className="num">{vazio ? <span className="muted">—</span> : <>
                    <span className={isTot && atual < 0 ? 'txt-danger' : ''}>{fmt(atual)}</span>
                    {Math.abs(total - atual) > 0.004 && <small className={`dre-total ${isTot && total < 0 ? 'txt-danger' : 'muted'}`}> ({fmt(total)})</small>}
                  </>}</td>
                  <td className="num muted hide-sm">{isTot ? '' : l.aberto ? fmt(s * l.aberto) : '—'}</td>
                  <td className="num muted">{d.base && Math.abs(atual) > 0.004 ? pct(atual / d.base) : '—'}{d.base && Math.abs(total - atual) > 0.004 && Math.abs(total) > 0.004 ? <small> ({pct(total / d.base)})</small> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ padding: '0 16px 16px', margin: 0 }}>
        Cada linha mostra o valor atual (despesas já pagas e vendas até hoje) e, entre parênteses, o total previsto do mês com o que ainda está a pagar. CMV no mês: <b>{pct(d.cmvPct)}</b> da receita bruta.
        A competência dos boletos do 3LM ainda é a data de vencimento, então o CMV pode incluir compras do mês anterior. Pessoal, aluguel e energia entram quando forem cadastrados em Custos fixos.
      </p>
    </div>
  )
}

// =====================================================================
// Custos fixos
// =====================================================================
const EMPTY_FIXO = { descricao: '', cat: 'Pessoal|Salários', unidade: 'ZN Salão', valor: '', dia: '', inicio: '', fim: '' }

function Fixos({ ctx }) {
  const { store, fin, contas, unidade, hoje } = ctx
  const toast = useToast()
  const confirm = useConfirm()
  const [f, setF] = useState({ ...EMPTY_FIXO, inicio: hoje.slice(0, 7) < INICIO ? INICIO : hoje.slice(0, 7) })
  const [editing, setEditing] = useState(null)
  const [imp, setImp] = useState('')
  const [impMsg, setImpMsg] = useState('')
  const fileRef = useRef()
  const mes = hoje.slice(0, 7)
  const occ = contas.filter((c) => c.fixo && c.vencimento.startsWith(mes))
  const pago = occ.filter((c) => c.status === 'Pago').reduce((t, c) => t + c.valor, 0)
  const tot = occ.reduce((t, c) => t + c.valor, 0)
  const lista = fin.custos_fixos.filter(okUnidade(unidade)).sort((a, b) => (a.grupo + a.descricao).localeCompare(b.grupo + b.descricao))

  const reset = () => { setEditing(null); setF({ ...EMPTY_FIXO, inicio: hoje.slice(0, 7) < INICIO ? INICIO : hoje.slice(0, 7) }) }
  const persist = async (x) => {
    const saved = await api.finSaveFixo(x)
    const s = { ...saved, valor: Number(saved.valor), dia: Number(saved.dia) }
    store.setFin((d) => ({ ...d, custos_fixos: [...d.custos_fixos.filter((c) => c.id !== s.id), s] }))
  }
  const save = async () => {
    const [grupo, categoria] = f.cat.split('|')
    const x = { ...(editing ? { id: editing } : {}), descricao: f.descricao.trim(), grupo, categoria, unidade: f.unidade,
      valor: Number(String(f.valor).replace(',', '.')), dia: Math.round(Number(f.dia)), inicio: f.inicio || INICIO, fim: f.fim || null }
    if (!x.descricao || !(x.valor > 0) || !(x.dia >= 1 && x.dia <= 31)) return toast('Preencha descrição, valor e dia do vencimento.', 'error')
    try { await persist(x); toast(editing ? 'Custo fixo atualizado.' : 'Custo fixo salvo.'); reset() } catch (e) { toast(e.message, 'error') }
  }
  const edit = (c) => { setEditing(c.id); setF({ descricao: c.descricao, cat: `${c.grupo}|${c.categoria}`, unidade: c.unidade, valor: String(c.valor), dia: String(c.dia), inicio: c.inicio, fim: c.fim || '' }) }
  const togglePause = async (c) => { try { await persist({ ...c, pausado_em: c.pausado_em ? null : mes }) } catch (e) { toast(e.message, 'error') } }
  const del = async (c) => {
    if (!(await confirm({ title: 'Excluir custo fixo', message: `Excluir "${c.descricao}"? Os meses futuros somem do contas a pagar. Para manter o histórico, use Pausar.`, ok: 'Excluir', danger: true }))) return
    try { await api.finDeleteFixo(c.id); store.setFin((d) => ({ ...d, custos_fixos: d.custos_fixos.filter((x) => x.id !== c.id) })) } catch (e) { toast(e.message, 'error') }
  }
  const importar = async () => {
    const { out, erros } = parseFixos(imp)
    let ok = 0
    for (const x of out) { try { await persist(x); ok++ } catch { /* conta como erro */ } }
    const bad = erros + out.length - ok
    setImpMsg(`${ok} importado${ok === 1 ? '' : 's'}${bad ? `, ${bad} linha${bad > 1 ? 's' : ''} com problema (confira grupo, valor e dia)` : ''}.`)
    if (ok) setImp('')
  }
  const mm = (x) => (x ? `${x.slice(5, 7)}/${x.slice(0, 4)}` : '')

  return (
    <>
      <div className="kpis">
        <Kpi icon={CalendarDays} label="Custos fixos no mês" value={money(tot)} sub={`${occ.length} lançamento${occ.length === 1 ? '' : 's'} ativo${occ.length === 1 ? '' : 's'}`} />
        <Kpi icon={Wallet} label="Pago no mês" value={money(pago)} sub={`${money(tot - pago)} a pagar`} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>{editing ? 'Editar custo fixo' : 'Adicionar custo fixo'}</h3><p>Cada custo vira um boleto por mês, a partir do mês de início, e entra sozinho no contas a pagar e na DRE.</p></div></div>
        <div className="fin-form">
          <label className="field"><span>Descrição</span><input className="input" maxLength={80} placeholder="Ex.: Aluguel ZN" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
          <label className="field"><span>Categoria</span>
            <select className="select" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
              {CATEGORIAS.map(([g, itens]) => <optgroup key={g} label={g}>{itens.map(([v, l]) => <option key={v} value={`${g}|${v}`}>{l}</option>)}</optgroup>)}
            </select>
          </label>
          <label className="field"><span>Unidade</span><select className="select" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label className="field"><span>Valor (R$)</span><input className="input num" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></label>
          <label className="field"><span>Dia do vencimento</span><input className="input num" type="number" min={1} max={31} value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} /></label>
          <label className="field"><span>Início</span><input className="input" type="month" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></label>
          <label className="field"><span>Fim <small className="muted">(opcional)</small></span><input className="input" type="month" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} /></label>
          <div className="fin-form-btns">
            <button className="btn primary" onClick={save}>{editing ? 'Salvar alterações' : 'Salvar custo fixo'}</button>
            {editing && <button className="btn" onClick={reset}>Cancelar</button>}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>Importar de uma planilha</h3><p>Copie as linhas da planilha e cole abaixo, ou escolha um .csv. Colunas nesta ordem: descrição; grupo; categoria; unidade; valor; dia; início (AAAA-MM); fim (opcional).</p></div></div>
        <div style={{ padding: '0 16px 16px' }}>
          <textarea className="input fin-imp" rows={4} placeholder="Aluguel ZN;Ocupação;Aluguel;ZN Salão;8500;10;2026-11;" value={imp} onChange={(e) => setImp(e.target.value)} />
          <div className="fin-actions">
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) { const r = new FileReader(); r.onload = () => setImp(String(r.result || '')); r.readAsText(file) } e.target.value = '' }} />
            <button className="btn" onClick={() => fileRef.current?.click()}><Upload />Escolher .csv</button>
            <button className="btn primary" disabled={!imp.trim()} onClick={importar}>Importar</button>
            {impMsg && <span className="muted">{impMsg}</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h3>Custos fixos cadastrados</h3><p>Pausar tira o custo dos próximos meses sem apagar o histórico.</p></div></div>
        <div className="table-wrap" style={{ borderTop: 0 }}>
          <table className="data">
            <thead><tr><th>Descrição</th><th className="hide-sm">Categoria</th><th className="hide-sm">Unidade</th><th>Dia</th><th className="hide-sm">Vigência</th><th className="num">Valor</th><th /></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} className={c.pausado_em ? 'is-off' : ''}>
                  <td><strong>{c.descricao}</strong></td>
                  <td className="hide-sm muted">{c.grupo} › {c.categoria}</td>
                  <td className="hide-sm muted">{c.unidade}</td>
                  <td>{c.dia}</td>
                  <td className="hide-sm muted">desde {mm(c.inicio)}{c.fim ? ` até ${mm(c.fim)}` : ''}{c.pausado_em ? ` · pausado em ${mm(c.pausado_em)}` : ''}</td>
                  <td className="num"><strong>{money(c.valor)}</strong></td>
                  <td className="nowrap" style={{ textAlign: 'right' }}>
                    <button className="btn ghost icon" title="Editar" aria-label="Editar" onClick={() => edit(c)}><Pencil /></button>
                    <button className="btn ghost icon" title={c.pausado_em ? 'Reativar' : 'Pausar'} aria-label={c.pausado_em ? 'Reativar' : 'Pausar'} onClick={() => togglePause(c)}>{c.pausado_em ? <Play /> : <Pause />}</button>
                    <button className="btn ghost icon" title="Excluir" aria-label="Excluir" onClick={() => del(c)}><Trash2 /></button>
                  </td>
                </tr>
              ))}
              {!lista.length && <tr><td colSpan={7}><div className="empty"><Inbox /><div>Nenhum custo fixo cadastrado ainda.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// =====================================================================
// Importar dados do 3LM (JSON da extração: títulos, vendas ou histórico)
// =====================================================================
const IMPORT_LABEL = { lancamentos: 'contas a pagar', vendas: 'vendas por dia', historico: 'faturamento mensal', itens: 'itens vendidos por dia', produtos: 'tipos de produto' }
const lerTexto = async (file) => {
  const buf = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { return new TextDecoder('windows-1252').decode(buf) }
}
function ImportFin({ store, onClose }) {
  const toast = useToast()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [unidade, setUnidade] = useState('ZN Salão')
  const read = async (list) => {
    const out = []
    for (const file of list) {
      if (!/\.json$/i.test(file.name)) {
        const p = parse3lmItens(await lerTexto(file))
        if (p?.kind === 'itens') out.push({ name: file.name, kind: 'itens', rows: p.itens, dias: p.dias })
        else if (p?.kind === 'produtos') out.push({ name: file.name, kind: 'produtos', rows: p.produtos })
        else out.push({ name: file.name, kind: null, rows: [] })
        continue
      }
      try {
        const rows = JSON.parse(await file.text())
        const arr = Array.isArray(rows) ? rows : rows.rows || rows.data || []
        out.push({ name: file.name, kind: detectImport(arr), rows: arr })
      } catch { out.push({ name: file.name, kind: null, rows: [] }) }
    }
    setFiles(out)
  }
  const clean = {
    lancamentos: (r) => ({ id: String(r.id), tipo: r.tipo || 'Saída', vencimento: r.vencimento, competencia: r.competencia || r.vencimento, pagamento: r.pagamento || null,
      unidade: r.unidade || 'ZN Salão', grupo: r.grupo, categoria: r.categoria || null, subcategoria: r.subcategoria || r.categoria || null, contraparte: r.contraparte, valor: Number(r.valor), origem: r.origem || '3LM contas a pagar' }),
    vendas: (r) => ({ dia: r.dia, unidade: r.unidade || 'ZN Salão', forma: r.forma, grupo: r.grupo, valor: Number(r.valor) }),
    historico: (r) => ({ mes: r.mes, unidade: r.unidade || 'ZN Salão', total: Number(r.total), promo_dia: r.promo_dia || null, promo_valor: Number(r.promo_valor || 0) }),
  }
  const go = async () => {
    setBusy(true)
    try {
      for (const f of files.filter((x) => x.kind)) {
        if (f.kind === 'itens') await api.finImportItens(unidade, f.dias, f.rows.map((r) => ({ ...r, unidade })))
        else if (f.kind === 'produtos') await api.finSaveProdutos(f.rows)
        else await api.finImport(f.kind, f.rows.map(clean[f.kind]))
      }
      store.setFin(await api.finLoad())
      toast('Dados importados.'); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title="Importar dados do 3LM" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !files.some((f) => f.kind)} onClick={go}>{busy ? 'Importando…' : 'Importar'}</button></>}>
      <div className="stack">
        <p className="hint" style={{ margin: 0 }}>Escolha os arquivos do 3LM: os .json extraídos (contas a pagar, vendas por dia ou faturamento mensal) ou o CSV de <b>Itens vendidos → Dia a Dia</b> (exportado em "Delimitador ;"). Nada é duplicado: títulos são atualizados pelo código, os pagamentos marcados continuam marcados, e os dias de itens vendidos que vierem no arquivo são substituídos.</p>
        <input type="file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" multiple onChange={(e) => read([...e.target.files])} />
        {files.some((f) => f.kind === 'itens') && (
          <label className="fin-date">Unidade dos itens vendidos
            <select className="select" style={{ width: 170 }} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
              {UNIDADES.filter((u) => !/Legado/.test(u)).map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        )}
        {files.map((f) => (
          <div key={f.name} className={`note ${f.kind ? '' : 'warn'}`}>
            {f.kind ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span><strong>{f.name}</strong>: {f.kind === 'itens' ? `${f.rows.length} itens vendidos de ${dateBR(f.dias[0])} a ${dateBR(f.dias[f.dias.length - 1])}` : f.kind ? `${f.rows.length} linhas de ${IMPORT_LABEL[f.kind]}` : 'formato não reconhecido'}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
