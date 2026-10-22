import React, { useMemo } from 'react'
import { ArrowRight, Lock, Plus } from 'lucide-react'
import { money, dateBR, today, addDays, weekStart } from '../lib/format.js'
import { isOverdue } from '../lib/nutri.js'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }

export default function Home({ store, panels }) {
  const { profile, allowed, transfers, nutri, isMaster } = store
  const first = (profile?.name || '').split(' ')[0]

  const stats = useMemo(() => {
    const out = {}
    if (allowed.includes('transferencias')) {
      const open = transfers.filter((t) => !t.paid)
      const ws = weekStart(today())
      out.transferencias = [
        { label: 'Em aberto', value: money(open.reduce((s, t) => s + t.total, 0)), tone: 'warn' },
        { label: 'Lançamentos nesta semana', value: transfers.filter((t) => t.date >= ws).length },
        { label: 'Em aberto mais antigo', value: open.length ? dateBR(open.map((t) => t.date).sort()[0]) : '—' },
      ]
    }
    if (allowed.includes('nutricao') && nutri) {
      const neg = nutri.points.filter((p) => p.type === 'neg' && p.status !== 'resolvido')
      const late = nutri.points.filter(isOverdue)
      const lastReport = [...nutri.reports].sort((a, b) => b.date.localeCompare(a.date))[0]
      const since = addDays(today(), -30)
      const recent = nutri.points.filter((p) => p.date >= since)
      out.nutricao = [
        { label: 'Ações em aberto', value: neg.length, tone: neg.length ? 'warn' : 'good', hint: late.length ? `${late.length} atrasada${late.length > 1 ? 's' : ''}` : null },
        { label: 'Últimos 30 dias', value: `${recent.filter((p) => p.type === 'pos').length} positivos · ${recent.filter((p) => p.type === 'neg').length} a melhorar` },
        { label: 'Último relatório', value: lastReport ? dateBR(lastReport.date) : '—' },
      ]
    }
    return out
  }, [allowed, transfers, nutri])

  const visible = panels.filter((p) => isMaster || allowed.includes(p.key))

  return (
    <div className="home">
      <div className="home-head">
        <p className="eyebrow">{(() => { const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1) })()}</p>
        <h1>{greeting()}{first ? `, ${first}` : ''}.</h1>
        <p className="muted">{visible.length > 1 ? 'Escolha um painel para começar.' : 'Este é o seu painel.'}</p>
      </div>

      <div className="panel-grid">
        {visible.map((p) => {
          const I = p.icon
          const can = allowed.includes(p.key)
          return (
            <button key={p.key} className={`panel-card ${can ? '' : 'locked'}`} onClick={() => can && store.go(p.tabs[0].id)} disabled={!can}>
              <div className="panel-top">
                <span className={`panel-icon pi-${p.key}`}><I /></span>
                <div className="panel-title">
                  <strong>{p.name}</strong>
                  <small>Responsável: {p.owner}</small>
                </div>
                {can ? <ArrowRight className="panel-go" /> : <Lock className="panel-go" />}
              </div>
              <p className="panel-desc">{p.desc}</p>
              {stats[p.key] && (
                <div className="panel-stats">
                  {stats[p.key].map((s) => (
                    <div key={s.label}>
                      <small>{s.label}</small>
                      <strong className={s.tone || ''}>{s.value}</strong>
                      {s.hint && <em>{s.hint}</em>}
                    </div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
        {isMaster && (
          <div className="panel-card placeholder">
            <span className="panel-icon"><Plus /></span>
            <strong>Próximo painel</strong>
            <p className="panel-desc">Espaço para as próximas áreas da gestão, cada uma com o seu responsável.</p>
          </div>
        )}
      </div>
    </div>
  )
}
