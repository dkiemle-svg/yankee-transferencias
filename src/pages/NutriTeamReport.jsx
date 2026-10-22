import React, { useMemo, useState } from 'react'
import { ThumbsUp, CheckCircle2, AlertTriangle, Clock, Copy, FileDown, History, Inbox, LayoutGrid, Target } from 'lucide-react'
import { dateBR, today, addDays, weekStart, weekLabel, monthKey, monthLabel } from '../lib/format.js'
import { buildTeamReport, whatsappText, shortText, monthRange } from '../lib/nutri.js'

const initials = (n) => (n || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()
const fmtS = (v) => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}`

function periodsOf(points) {
  const months = [...new Set([monthKey(today()), ...points.map((p) => monthKey(p.date))])].sort().reverse()
  const weeks = [...new Set([weekStart(today()), ...points.map((p) => weekStart(p.date))])].sort().reverse()
  const dated = points.map((p) => p.date).sort()
  const last = dated[dated.length - 1]
  return { months, weeks, latestMonth: last ? monthKey(last) : months[0], latestWeek: last ? weekStart(last) : weeks[0] }
}

// Célula do mapa de calor: a cor fica mais forte quanto maior o valor na coluna
function Heat({ v, max, tone }) {
  if (!v) return <td className="hc zero">–</td>
  const k = Math.min(1, v / (max || 1))
  return <td className="hc" style={{ background: `color-mix(in srgb, var(--${tone}) ${Math.round(14 + 46 * k)}%, transparent)` }}>{v}</td>
}

function HeatMap({ rows, onPick, onCopy, firstCol }) {
  const max = (f) => Math.max(1, ...rows.map(f))
  const m = { pos: max((r) => r.pos), resolved: max((r) => r.resolved), neg: max((r) => r.neg), pendOld: max((r) => r.pendOld), pendNew: max((r) => r.pendNew) }
  return (
    <div className="table-wrap" style={{ borderTop: 0 }}>
      <table className="data heat">
        <thead>
          <tr>
            <th>{firstCol}</th>
            <th className="hc">Positivos</th><th className="hc">Resolvidos</th><th className="hc">Novos a melhorar</th>
            <th className="hc">Pendentes antigos</th><th className="hc">Pendentes do período</th><th className="hc">Saldo</th>
            {onCopy && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={onPick ? 'clickable' : ''} onClick={onPick ? () => onPick(r.key) : undefined}>
              <td>
                <div className="hm-who">
                  {onPick && <span className="avatar sm">{initials(r.label)}</span>}
                  <div><strong>{r.label}</strong>{r.sub && <small>{r.sub}</small>}</div>
                </div>
              </td>
              <Heat v={r.pos} max={m.pos} tone="good" />
              <Heat v={r.resolved} max={m.resolved} tone="good" />
              <Heat v={r.neg} max={m.neg} tone="warn" />
              <Heat v={r.pendOld} max={m.pendOld} tone="danger" />
              <Heat v={r.pendNew} max={m.pendNew} tone="warn" />
              <td className="hc"><span className={`score ${r.score >= 0 ? 'up' : 'down'}`}>{fmtS(r.score)}</span></td>
              {onCopy && <td className="hc"><button className="btn ghost icon" title={`Copiar texto de ${r.label} para o WhatsApp`} aria-label={`Copiar texto de ${r.label}`} onClick={(e) => { e.stopPropagation(); onCopy(r.key) }}><Copy /></button></td>}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nada registrado no período.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Aging({ pending }) {
  const buckets = [
    ['Até 7 dias', (a) => a <= 7], ['8 a 15 dias', (a) => a > 7 && a <= 15], ['16 a 30 dias', (a) => a > 15 && a <= 30], ['Mais de 30 dias', (a) => a > 30],
  ].map(([label, f]) => ({ label, n: pending.filter((p) => f(p.age)).length }))
  const max = Math.max(1, ...buckets.map((b) => b.n))
  return (
    <div className="aging">
      {buckets.map((b, i) => (
        <div key={b.label} className="aging-row">
          <span>{b.label}</span>
          <div className="aging-bar"><span style={{ width: `${(b.n / max) * 100}%` }} className={`ag-${i}`} /></div>
          <strong>{b.n}</strong>
        </div>
      ))}
      <p className="hint" style={{ margin: '6px 0 0' }}>Tempo desde que o ponto foi apontado no relatório.</p>
    </div>
  )
}

const Who = ({ name }) => <span className="who-cell"><span className="avatar sm">{initials(name)}</span>{name}</span>

export default function TeamReport({ ctx, initial = {} }) {
  const { n, empById, toast } = ctx
  const { months, weeks, latestMonth, latestWeek } = useMemo(() => periodsOf(n.points), [n.points])
  const [mode, setMode] = useState(initial.month ? 'month' : 'week')
  const [week, setWeek] = useState(latestWeek)
  const [month, setMonth] = useState(initial.month || latestMonth)
  const [emp, setEmp] = useState(initial.employeeId || '')
  const [pendFilter, setPendFilter] = useState('all')

  const [from, to] = mode === 'week' ? [week, addDays(week, 6)] : monthRange(month)
  const periodLabel = mode === 'week' ? `Semana de ${dateBR(from)} a ${dateBR(to)}` : `Mês de ${monthLabel(month)}`
  const r = useMemo(() => buildTeamReport(n, { from, to, employeeId: emp }), [n, from, to, emp])
  const who = emp ? (emp === 'geral' ? 'Geral / estrutura' : empById[emp]?.name || '') : 'Equipe'
  const t = r.totals
  const pend = r.pending.filter((p) => pendFilter === 'all' || (pendFilter === 'old' ? p.old : pendFilter === 'new' ? !p.old : p.late))

  const copy = async (empId = emp) => {
    const rep = empId === emp ? r : buildTeamReport(n, { from, to, employeeId: empId })
    const name = empId ? (empId === 'geral' ? 'Geral / estrutura' : empById[empId]?.name) : 'Equipe Yankee Burger'
    try { await navigator.clipboard.writeText(whatsappText(rep, periodLabel, name)); toast(`Texto de ${name.split(' ')[0]} copiado. Cole no WhatsApp.`) }
    catch { toast('Não foi possível copiar automaticamente. Use o PDF.', 'error') }
  }
  const pdf = async () => {
    const { exportNutriPDF } = await import('../lib/nutriExport.js')
    await exportNutriPDF(r, periodLabel, who)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relatório da equipe</h1>
          <p>O que está bom, o que foi resolvido e o que ainda falta resolver, no período escolhido.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => copy()}><Copy />Copiar para WhatsApp</button>
          <button className="btn primary" onClick={pdf}><FileDown />Baixar PDF</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters">
          <div className="seg" role="group" aria-label="Período">
            <button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Semana</button>
            <button aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Mês</button>
          </div>
          {mode === 'week'
            ? <select className="select" style={{ width: 200 }} value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Semana">{weeks.map((w) => <option key={w} value={w}>Semana {weekLabel(w)}</option>)}</select>
            : <select className="select" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>}
          <select className="select" style={{ width: 230 }} value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Funcionário">
            <option value="">Equipe toda</option>
            {n.employees.filter((e) => e.active !== false).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value="geral">Geral / estrutura</option>
          </select>
          {emp && <button className="btn sm" onClick={() => setEmp('')}>Ver equipe toda</button>}
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi"><small><ThumbsUp style={{ color: 'var(--good)' }} />Pontos positivos</small><div className="val">{t.pos}</div><div className="sub">apontados no período</div></div>
        <div className="card kpi"><small><CheckCircle2 style={{ color: 'var(--good)' }} />Resolvidos</small><div className="val">{t.resolved}</div><div className="sub">contam como ponto positivo</div></div>
        <div className="card kpi"><small><Target style={{ color: 'var(--warn)' }} />Novos a melhorar</small><div className="val">{t.neg}</div><div className="sub">apontados no período</div></div>
        <div className="card kpi"><small><AlertTriangle style={{ color: t.late ? 'var(--danger)' : 'var(--warn)' }} />Falta resolver</small><div className="val">{t.pending}</div><div className="sub">{t.pendOld} de períodos anteriores{t.late ? ` · ${t.late} atrasado${t.late > 1 ? 's' : ''}` : ''}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3><LayoutGrid size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Mapa da equipe</h3><p>Quanto mais forte a cor, maior o número. Clique numa pessoa para ver só ela.</p></div></div>
        <HeatMap rows={r.people} firstCol="Funcionário" onPick={emp ? undefined : (k) => setEmp(k)} onCopy={(k) => copy(k)} />
      </div>

      <div className="rep-grid">
        <div className="card">
          <div className="card-head"><div><h3>Mapa por setor</h3><p>Onde estão os pontos positivos e as pendências.</p></div></div>
          <HeatMap rows={r.sectors} firstCol="Setor" />
        </div>
        <div className="card">
          <div className="card-head"><div><h3><History size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Há quanto tempo está pendente</h3><p>{t.pending} ponto{t.pending === 1 ? '' : 's'} ainda sem solução.</p></div></div>
          <div style={{ padding: '0 18px 18px' }}><Aging pending={r.pending} /></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3 style={{ color: 'var(--good)' }}><CheckCircle2 size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Resolvidos no período</h3><p>Cada ponto resolvido conta como ponto positivo para o responsável.</p></div></div>
        <div className="table-wrap" style={{ borderTop: 0 }}>
          <table className="data">
            <thead><tr><th>Apontado</th><th>Resolvido</th><th>Responsável</th><th>Setor</th><th>Ponto</th><th>O que foi feito</th></tr></thead>
            <tbody>
              {r.resolved.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dateBR(p.date)}{p.old && <div><span className="pill">anterior</span></div>}</td>
                  <td className="nowrap">{dateBR(p.resolvedOn)}<div className="muted" style={{ fontSize: 12 }}>{p.days} dia{p.days === 1 ? '' : 's'}</div></td>
                  <td className="nowrap"><Who name={r.nameOf(p)} /></td>
                  <td className="muted">{p.sector || '—'}</td>
                  <td title={p.text}>{shortText(p.text, 170)}</td>
                  <td className="muted">{p.response || '—'}</td>
                </tr>
              ))}
              {!r.resolved.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>Nada resolvido neste período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <div><h3 style={{ color: 'var(--warn)' }}><Clock size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Ainda falta resolver</h3><p>Inclui o que vem de relatórios anteriores e ainda não foi resolvido.</p></div>
          <div className="seg" role="group" aria-label="Filtrar pendências">
            {[['all', `Todos (${t.pending})`], ['old', `Antigos (${t.pendOld})`], ['new', `Do período (${t.pending - t.pendOld})`], ['late', `Atrasados (${t.late})`]].map(([k, l]) => <button key={k} aria-pressed={pendFilter === k} onClick={() => setPendFilter(k)}>{l}</button>)}
          </div>
        </div>
        <div className="table-wrap" style={{ borderTop: 0 }}>
          <table className="data">
            <thead><tr><th>Desde</th><th>Responsável</th><th>Setor</th><th>Ponto</th><th>Combinado</th><th>Prazo</th><th>Situação</th></tr></thead>
            <tbody>
              {pend.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dateBR(p.date)}<div className="muted" style={{ fontSize: 12 }}>{p.age} dias{p.old ? ' · anterior' : ''}</div></td>
                  <td className="nowrap"><Who name={r.nameOf(p)} /></td>
                  <td className="muted">{p.sector || '—'}</td>
                  <td title={p.text}>{shortText(p.text, 170)}</td>
                  <td className="muted">{p.response || '—'}</td>
                  <td className="nowrap">{p.due_date ? dateBR(p.due_date) : <span className="muted">—</span>}</td>
                  <td>{p.late ? <span className="pill danger"><AlertTriangle size={12} />Atrasado</span> : p.due_date ? <span className="pill warn"><Clock size={12} />No prazo</span> : <span className="pill">Sem prazo</span>}</td>
                </tr>
              ))}
              {!pend.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>Nada pendente aqui.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h3 style={{ color: 'var(--good)' }}><ThumbsUp size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Pontos positivos do período</h3></div></div>
        <div className="table-wrap" style={{ borderTop: 0 }}>
          <table className="data">
            <thead><tr><th>Data</th><th>Responsável</th><th>Setor</th><th>Ponto</th></tr></thead>
            <tbody>
              {r.positives.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{dateBR(p.date)}</td>
                  <td className="nowrap"><Who name={r.nameOf(p)} /></td>
                  <td className="muted">{p.sector || '—'}</td>
                  <td title={p.text}>{shortText(p.text, 200)}</td>
                </tr>
              ))}
              {!r.positives.length && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 20 }}><Inbox size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Sem pontos positivos no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
