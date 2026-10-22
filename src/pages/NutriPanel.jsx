import React, { useMemo, useRef, useState } from 'react'
import {
  Plus, FileText, Camera, X, Wand2, ThumbsUp, ThumbsDown, AlertTriangle, CheckCircle2, Clock, Trash2, Pencil, Copy,
  FileDown, Users, Trophy, Medal, Target, ChevronLeft, ImagePlus, Search, ClipboardList, CalendarClock, RotateCcw, Inbox, ListChecks,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { dateBR, today, addDays, weekStart, weekLabel, monthKey, monthLabel, normalize } from '../lib/format.js'
import { parseReport, splitReports, dateFromTitle, scoreOf, monthRange, isOverdue, whatsappText } from '../lib/nutri.js'
import { Modal, useToast, useConfirm } from '../components/ui.jsx'

const UNIT_NAMES = { YANKEE: 'Yankee Burger', ZN: 'HubFood ZN', BV: 'HubFood BV' }
const initials = (n) => (n || '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()
const weekdayBR = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long' })

export default function NutriPanel({ store, tab, go }) {
  const toast = useToast()
  const n = store.nutri
  const canWrite = store.isMaster || store.profile?.role === 'nutri'
  const canManage = store.isMaster
  const [reportFor, setReportFor] = useState(null) // { employeeId?, period? }

  if (!n) return <div className="center-screen"><div className="spinner" /></div>
  const empById = Object.fromEntries(n.employees.map((e) => [e.id, e]))

  const patchPoint = async (id, patch) => {
    try {
      const p = await api.nutriUpdatePoint(id, patch)
      store.setNutri((d) => ({ ...d, points: d.points.map((x) => (x.id === id ? p : x)) }))
      return p
    } catch (e) { toast(e.message, 'error') }
  }

  const ctx = { store, n, empById, canWrite, canManage, patchPoint, openReport: setReportFor, toast }
  return (
    <>
      {tab === 'nutri-relatorios' && <Reports ctx={ctx} />}
      {tab === 'nutri-acoes' && <Actions ctx={ctx} />}
      {tab === 'nutri-equipe' && <Team ctx={ctx} />}
      {tab === 'nutri-ranking' && <Ranking ctx={ctx} />}
      {reportFor && <WeeklyReport ctx={ctx} initial={reportFor} onClose={() => setReportFor(null)} />}
    </>
  )
}

// =====================================================================
// Relatórios
// =====================================================================
function Reports({ ctx }) {
  const { n, empById, canWrite, store } = ctx
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [q, setQ] = useState('')

  const since = addDays(today(), -30)
  const recent = n.points.filter((p) => p.date >= since)
  const late = n.points.filter(isOverdue).length
  const open = n.points.filter((p) => p.type === 'neg' && p.status !== 'resolvido').length
  const reports = [...n.reports].sort((a, b) => b.date.localeCompare(a.date))
    .filter((r) => !q || normalize(r.text).includes(normalize(q)))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Relatórios da nutricionista</h1>
          <p>Cada relatório da Rebeca vira pontos positivos e pontos a melhorar por funcionário.</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => ctx.openReport({})}><FileText />Relatório para a equipe</button>
          {canWrite && <button className="btn primary" onClick={() => setCreating(true)}><Plus />Novo relatório</button>}
        </div>
      </div>

      <div className="kpis">
        <div className="card kpi"><small><ClipboardList />Relatórios (30 dias)</small><div className="val">{n.reports.filter((r) => r.date >= since).length}</div><div className="sub">{n.reports.length} no total</div></div>
        <div className="card kpi"><small><ThumbsUp style={{ color: 'var(--good)' }} />Pontos positivos (30 dias)</small><div className="val">{recent.filter((p) => p.type === 'pos').length}</div><div className="sub">elogios registrados</div></div>
        <div className="card kpi"><small><ThumbsDown style={{ color: 'var(--warn)' }} />A melhorar (30 dias)</small><div className="val">{recent.filter((p) => p.type === 'neg').length}</div><div className="sub">{open} ações em aberto no total</div></div>
        <button className="card kpi kpi-link" onClick={() => store.go('nutri-acoes')}><small><AlertTriangle style={{ color: 'var(--danger)' }} />Ações atrasadas</small><div className="val" style={{ color: late ? 'var(--danger)' : undefined }}>{late}</div><div className="sub">prazo vencido sem resolver →</div></button>
      </div>

      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><input className="input" placeholder="Buscar no texto dos relatórios…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="report-list">
          {reports.map((r) => {
            const pts = n.points.filter((p) => p.report_id === r.id)
            const people = [...new Set(pts.map((p) => p.employee_id).filter(Boolean))].map((id) => empById[id]).filter(Boolean)
            return (
              <button key={r.id} className="report-row" onClick={() => setViewing(r)}>
                <div className="report-date"><strong>{dateBR(r.date).slice(0, 5)}</strong><small>{weekdayBR(r.date).split('-')[0]}</small></div>
                <div className="report-main">
                  <div className="report-meta">{r.author || r.author_name || 'Rebeca'} · semana {weekLabel(weekStart(r.date))}</div>
                  <p className="report-excerpt">{r.text.replace(/\s+/g, ' ').slice(0, 190)}{r.text.length > 190 ? '…' : ''}</p>
                  <div className="report-chips">
                    <span className="pill good"><ThumbsUp size={12} />{pts.filter((p) => p.type === 'pos').length} positivos</span>
                    <span className="pill warn"><ThumbsDown size={12} />{pts.filter((p) => p.type === 'neg').length} a melhorar</span>
                    {r.photos?.length > 0 && <span className="pill"><Camera size={12} />{r.photos.length} foto{r.photos.length > 1 ? 's' : ''}</span>}
                  </div>
                </div>
                <div className="report-people">
                  {people.slice(0, 5).map((e) => <span key={e.id} className="avatar sm" title={e.name}>{initials(e.name)}</span>)}
                  {people.length > 5 && <span className="avatar sm">+{people.length - 5}</span>}
                </div>
              </button>
            )
          })}
          {!reports.length && <div className="empty"><Inbox /><div>Nenhum relatório ainda.</div></div>}
        </div>
      </div>

      {creating && <NewReport ctx={ctx} onClose={() => setCreating(false)} />}
      {viewing && <ReportDetail ctx={ctx} report={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}

// Destaca nomes dos funcionários no texto original
function HighlightedText({ text, employees }) {
  const names = employees.flatMap((e) => [e.name, e.name.split(' ')[0], ...(e.aliases || [])]).filter((s) => s && s.length > 1)
  if (!names.length) return <p className="report-text">{text}</p>
  const esc = names.sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`\\b(${esc.join('|')})\\b`, 'gi')
  const parts = text.split(re)
  return <p className="report-text">{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</p>
}

function ReportDetail({ ctx, report, onClose }) {
  const { n, empById, canManage, store, toast } = ctx
  const confirm = useConfirm()
  const [photo, setPhoto] = useState(null)
  const pts = n.points.filter((p) => p.report_id === report.id)
  const groups = groupBy(pts, (p) => p.employee_id || 'geral')

  const remove = async () => {
    if (!(await confirm({ title: 'Excluir relatório', message: 'O relatório e os pontos dele serão excluídos.', ok: 'Excluir', danger: true }))) return
    await api.nutriDeleteReport(report.id)
    store.setNutri((d) => ({ ...d, reports: d.reports.filter((r) => r.id !== report.id), points: d.points.filter((p) => p.report_id !== report.id) }))
    toast('Relatório excluído.'); onClose()
  }

  return (
    <Modal title={`Relatório de ${dateBR(report.date)}`} onClose={onClose} wide
      footer={<>{canManage && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 />Excluir</button>}<button className="btn primary" onClick={onClose}>Fechar</button></>}>
      <div className="detail-grid">
        <div>
          <div className="section-label">Texto enviado por {report.author || report.author_name || 'Rebeca'}</div>
          <HighlightedText text={report.text} employees={n.employees} />
          {report.photos?.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 14 }}>Fotos</div>
              <div className="thumbs">{report.photos.map((src, i) => <button key={i} className="thumb" onClick={() => setPhoto(src)}><img src={src} alt={`Foto ${i + 1} do relatório`} /></button>)}</div>
            </>
          )}
        </div>
        <div>
          <div className="section-label">Pontos identificados</div>
          <div className="point-groups">
            {Object.entries(groups).map(([id, list]) => (
              <div key={id} className="point-group">
                <div className="pg-head"><span className="avatar sm">{initials(empById[id]?.name || 'Equipe')}</span><strong>{empById[id]?.name || 'Geral / estrutura'}</strong></div>
                {list.map((p) => <PointLine key={p.id} p={p} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
      {photo && <div className="lightbox" onClick={() => setPhoto(null)}><img src={photo} alt="Foto ampliada" /></div>}
    </Modal>
  )
}

function PointLine({ p, showStatus = true }) {
  return (
    <div className={`point-line ${p.type}`}>
      {p.type === 'pos' ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}
      <span>{p.text}{p.sector && <small className="muted"> · {p.sector}</small>}</span>
      {showStatus && p.type === 'neg' && <StatusPill p={p} />}
    </div>
  )
}

function StatusPill({ p }) {
  if (p.status === 'resolvido') return <span className="pill good"><CheckCircle2 size={12} />Resolvida</span>
  if (isOverdue(p)) return <span className="pill danger"><AlertTriangle size={12} />Atrasada</span>
  return <span className="pill warn"><Clock size={12} />Em aberto</span>
}

// ---------------- Novo relatório ----------------
async function compressImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const max = 1280, k = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } finally { URL.revokeObjectURL(url) }
}

const EXAMPLE = `Cole o relatório como manda no WhatsApp. Exemplo:

*Relatório de Visita Técnica - Yankee Burger 02/10*

*Cozinha:*
(+) Foi realizada a limpeza da coifa por Carlos.
(-) Cesta de fritura com excesso de gordura, sendo solicitado à Juliana a limpeza.

Dá para colar vários relatórios de uma vez.`

function NewReport({ ctx, onClose }) {
  const { n, store, toast, empById } = ctx
  const [step, setStep] = useState(1)
  const [date, setDate] = useState(today())
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [drafts, setDrafts] = useState([])
  const [photoTo, setPhotoTo] = useState(0)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()
  const people = n.employees.filter((e) => e.active !== false)

  const addPhotos = async (files) => {
    const list = [...files].slice(0, 8 - photos.length)
    const out = []
    for (const f of list) { try { out.push(await compressImage(f)) } catch { /* ignora arquivo inválido */ } }
    setPhotos((p) => [...p, ...out])
  }
  const analyze = () => {
    let k = 0
    const parts = splitReports(text)
    const list = (parts.length ? parts : [{ title: '', text }]).map((r, i) => ({
      key: i, title: r.title, text: r.text, date: dateFromTitle(r.title) || date,
      points: parseReport(r.text, n.employees).map((p) => ({ ...p, key: k++ })),
    }))
    setDrafts(list); setPhotoTo(list.length - 1); setStep(2)
  }
  const setDraft = (dk, patch) => setDrafts((ds) => ds.map((d) => (d.key === dk ? { ...d, ...patch } : d)))
  const setPt = (dk, key, patch) => setDrafts((ds) => ds.map((d) => (d.key !== dk ? d : { ...d, points: d.points.map((p) => (p.key === key ? { ...p, ...patch, check: false } : p)) })))
  const delPt = (dk, key) => setDrafts((ds) => ds.map((d) => (d.key !== dk ? d : { ...d, points: d.points.filter((p) => p.key !== key) })))
  const addPt = (dk) => setDrafts((ds) => ds.map((d) => (d.key !== dk ? d : { ...d, points: [...d.points, { key: Date.now(), employee_id: null, type: 'neg', text: '', sector: 'Geral', involved: [], check: false }] })))

  const save = async () => {
    setBusy(true)
    try {
      let total = 0
      for (const [i, d] of drafts.entries()) {
        const clean = d.points.filter((p) => p.text.trim()).map(({ key, check, ...p }) => p)
        const r = await api.nutriCreateReport({ date: d.date, text: d.text, photos: i === photoTo ? photos : [] }, clean)
        store.setNutri((x) => ({ ...x, reports: [...x.reports, r.report], points: [...x.points, ...r.points] }))
        total += clean.length
      }
      toast(drafts.length > 1 ? `${drafts.length} relatórios salvos · ${total} pontos` : `Relatório salvo · ${total} pontos`); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  const all = drafts.flatMap((d) => d.points)
  const toCheck = all.filter((p) => p.check).length

  return (
    <Modal title={step === 1 ? 'Novo relatório' : 'Confira os pontos identificados'} onClose={onClose} wide
      footer={step === 1 ? <>
        <span className="left">{photos.length} foto{photos.length !== 1 ? 's' : ''} anexada{photos.length !== 1 ? 's' : ''}</span>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={text.trim().length < 10} onClick={analyze}><Wand2 />Identificar pontos</button>
      </> : <>
        <span className="left">{drafts.length > 1 ? `${drafts.length} relatórios · ` : ''}{all.length} pontos{toCheck ? ` · ${toCheck} para conferir` : ''}</span>
        <button className="btn" onClick={() => setStep(1)}><ChevronLeft />Voltar ao texto</button>
        <button className="btn primary" disabled={busy || !all.length} onClick={save}>{busy ? 'Salvando…' : drafts.length > 1 ? `Salvar ${drafts.length} relatórios` : 'Salvar relatório'}</button>
      </>}>
      {step === 1 ? (
        <div className="stack">
          <div className="grid-2" style={{ gridTemplateColumns: '180px 1fr' }}>
            <label className="field"><span>Data da visita</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <div className="field"><span>Como funciona</span><p className="hint" style={{ margin: 0 }}>Use (+) para o que está bom e (-) para o que precisa melhorar, como já faz no WhatsApp. A data do título é usada quando houver. O sistema identifica o responsável por cada item; você confere antes de salvar.</p></div>
          </div>
          <label className="field"><span>Relatório</span>
            <textarea className="input" rows={12} placeholder={EXAMPLE} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
          <div className="field">
            <span>Fotos (opcional)</span>
            <div className="thumbs">
              {photos.map((src, i) => (
                <div key={i} className="thumb"><img src={src} alt={`Foto ${i + 1}`} /><button className="thumb-x" aria-label="Remover foto" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}><X size={14} /></button></div>
              ))}
              {photos.length < 8 && (
                <button type="button" className="thumb add" onClick={() => fileRef.current?.click()}><ImagePlus /><small>Adicionar</small></button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addPhotos(e.target.files); e.target.value = '' }} />
          </div>
        </div>
      ) : (
        <div className="stack">
          {toCheck > 0 && <div className="note warn"><AlertTriangle size={16} />Os itens marcados com “confira” citam mais de uma pessoa ou ficaram ambíguos. Ajuste se precisar.</div>}
          {drafts.length > 1 && photos.length > 0 && (
            <label className="field" style={{ maxWidth: 360 }}><span>Anexar as fotos ao relatório de</span>
              <select className="select" value={photoTo} onChange={(e) => setPhotoTo(Number(e.target.value))}>{drafts.map((d, i) => <option key={d.key} value={i}>{dateBR(d.date)}</option>)}</select>
            </label>
          )}
          {drafts.map((d) => (
            <div key={d.key} className="draft">
              {drafts.length > 1 || d.title ? (
                <div className="draft-head">
                  <strong>{d.title || 'Relatório'}</strong>
                  <input type="date" className="input" style={{ width: 160 }} value={d.date} onChange={(e) => setDraft(d.key, { date: e.target.value })} aria-label="Data do relatório" />
                </div>
              ) : null}
              <div className="review-list">
                {d.points.map((p) => (
                  <div key={p.key} className={`review-row ${p.type} ${p.check ? 'check' : ''}`}>
                    <select className="select" value={p.employee_id || ''} onChange={(e) => setPt(d.key, p.key, { employee_id: e.target.value || null })} aria-label="Responsável">
                      <option value="">Geral / estrutura</option>
                      {people.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    <div className="seg type-seg" role="group" aria-label="Tipo">
                      <button aria-pressed={p.type === 'pos'} onClick={() => setPt(d.key, p.key, { type: 'pos' })}><ThumbsUp size={13} />Positivo</button>
                      <button aria-pressed={p.type === 'neg'} onClick={() => setPt(d.key, p.key, { type: 'neg' })}><ThumbsDown size={13} />A melhorar</button>
                    </div>
                    <div className="review-meta">
                      {p.sector && <span className="pill">{p.sector}</span>}
                      {p.involved?.length > 0 && <span className="pill accent">Cobrar: {p.involved.map((id) => empById[id]?.name.split(' ')[0]).filter(Boolean).join(', ')}</span>}
                      {p.check && <span className="pill warn">confira</span>}
                    </div>
                    <button className="btn ghost icon" aria-label="Remover ponto" onClick={() => delPt(d.key, p.key)}><Trash2 /></button>
                    <textarea className="input" rows={2} value={p.text} onChange={(e) => setPt(d.key, p.key, { text: e.target.value })} aria-label="Texto do ponto" />
                  </div>
                ))}
              </div>
              <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => addPt(d.key)}><Plus />Adicionar ponto</button>
            </div>
          ))}
          <p className="hint">Algum nome não foi reconhecido? Cadastre o apelido da pessoa em <strong>Equipe</strong>. Itens sem responsável ficam como “Geral / estrutura” e não contam no ranking.</p>
        </div>
      )}
    </Modal>
  )
}

// =====================================================================
// Ações (pontos a melhorar)
// =====================================================================
function Actions({ ctx }) {
  const { n, empById, canManage } = ctx
  const [status, setStatus] = useState('open')
  const [emp, setEmp] = useState('')
  const [sector, setSector] = useState('')
  const sectors = [...new Set(n.points.map((p) => p.sector).filter(Boolean))].sort()
  const list = n.points.filter((p) => p.type === 'neg')
    .filter((p) => !sector || p.sector === sector)
    .filter((p) => status === 'all' || (status === 'open' ? p.status !== 'resolvido' : status === 'late' ? isOverdue(p) : p.status === 'resolvido'))
    .filter((p) => !emp || (emp === 'geral' ? !p.employee_id : p.employee_id === emp || p.involved?.includes(emp)))
    .sort((a, b) => (isOverdue(b) - isOverdue(a)) || b.date.localeCompare(a.date))
  const counts = {
    open: n.points.filter((p) => p.type === 'neg' && p.status !== 'resolvido').length,
    late: n.points.filter(isOverdue).length,
    done: n.points.filter((p) => p.type === 'neg' && p.status === 'resolvido').length,
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ações de melhoria</h1>
          <p>{canManage ? 'Responda o que vai ser feito, defina o prazo e marque quando estiver resolvido.' : 'Acompanhe o que foi combinado para cada ponto levantado.'}</p>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters">
          <div className="seg" role="group" aria-label="Situação">
            {[['open', `Em aberto (${counts.open})`], ['late', `Atrasadas (${counts.late})`], ['done', `Resolvidas (${counts.done})`], ['all', 'Todas']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <select className="select" style={{ width: 220 }} value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Funcionário">
            <option value="">Todos os funcionários</option>
            {n.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            <option value="geral">Geral / estrutura</option>
          </select>
          {sectors.length > 0 && (
            <select className="select" style={{ width: 220 }} value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Setor">
              <option value="">Todos os setores</option>
              {sectors.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
        </div>
      </div>
      <div className="action-list">
        {list.map((p) => <ActionCard key={p.id} p={p} emp={empById[p.employee_id]} ctx={ctx} />)}
        {!list.length && <div className="card empty"><CheckCircle2 /><div>Nada por aqui.</div></div>}
      </div>
    </>
  )
}

function ActionCard({ p, emp, ctx }) {
  const { canManage, patchPoint, toast } = ctx
  const [response, setResponse] = useState(p.response || '')
  const [due, setDue] = useState(p.due_date || '')
  const dirty = response !== (p.response || '') || due !== (p.due_date || '')
  const state = p.status === 'resolvido' ? 'done' : isOverdue(p) ? 'late' : 'open'
  const save = async () => { await patchPoint(p.id, { response: response.trim(), due_date: due || null }); toast('Resposta salva.') }
  const toggle = async () => {
    const value = p.status === 'resolvido' ? 'aberto' : 'resolvido'
    await patchPoint(p.id, { status: value, response: response.trim(), due_date: due || null })
    toast(value === 'resolvido' ? 'Marcada como resolvida.' : 'Ação reaberta.')
  }
  return (
    <div className={`card action-card ${state}`}>
      <div className="ac-head">
        <span className="avatar sm">{initials(emp?.name || 'Equipe')}</span>
        <div className="ac-who"><strong>{emp?.name || 'Geral / estrutura'}</strong><small>{emp ? `${emp.role} · ${UNIT_NAMES[emp.unit] || ''}` : 'Ponto geral'} · relatório de {dateBR(p.date)}</small></div>
        <StatusPill p={p} />
      </div>
      <p className="ac-text"><ThumbsDown size={14} />{p.text}</p>
      {(p.sector || p.involved?.length > 0) && (
        <div className="ac-tags">
          {p.sector && <span className="pill">{p.sector}</span>}
          {p.involved?.length > 0 && <span className="pill accent">Cobrar: {p.involved.map((id) => ctx.empById[id]?.name.split(' ')[0]).filter(Boolean).join(', ')}</span>}
        </div>
      )}
      {canManage ? (
        <div className="ac-form">
          <label className="field grow"><span>O que vamos fazer</span><input className="input" placeholder="Ex.: treinamento com a equipe, comprar termômetro…" value={response} onChange={(e) => setResponse(e.target.value)} /></label>
          <label className="field"><span>Prazo</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <div className="ac-buttons">
            {dirty && <button className="btn" onClick={save}>Salvar</button>}
            <button className={`btn ${p.status === 'resolvido' ? '' : 'success'}`} onClick={toggle}>
              {p.status === 'resolvido' ? <><RotateCcw />Reabrir</> : <><CheckCircle2 />Resolvida</>}
            </button>
          </div>
        </div>
      ) : (
        <div className="ac-answer">
          {p.response ? <><strong>Combinado:</strong> {p.response}{p.due_date && <> · prazo {dateBR(p.due_date)}</>}</> : <span className="muted">Aguardando resposta da gestão.</span>}
        </div>
      )}
    </div>
  )
}

// =====================================================================
// Equipe
// =====================================================================
function usePeriods(points) {
  return useMemo(() => {
    const months = [...new Set([monthKey(today()), ...points.map((p) => monthKey(p.date))])].sort().reverse()
    const weeks = [...new Set([weekStart(today()), ...points.map((p) => weekStart(p.date))])].sort().reverse()
    // mês mais recente com registros (evita abrir num mês ainda vazio)
    const latest = points.length ? points.map((p) => monthKey(p.date)).sort().pop() : months[0]
    return { months, weeks, latest }
  }, [points])
}

function Team({ ctx }) {
  const { n, canWrite, store } = ctx
  const { months, latest } = usePeriods(n.points)
  const [month, setMonth] = useState(latest)
  const [editing, setEditing] = useState(null)
  const [from, to] = monthRange(month)
  const inPeriod = n.points.filter((p) => p.date >= from && p.date <= to)
  const w = n.settings.weights

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Mapa da equipe</h1>
          <p>O que já está bom e o que cada pessoa precisa melhorar.</p>
        </div>
        <div className="head-actions">
          <select className="select" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {canWrite && <button className="btn primary" onClick={() => setEditing({ name: '', aliases: [], role: '', unit: 'YANKEE' })}><Plus />Cadastrar funcionário</button>}
        </div>
      </div>
      <div className="team-grid">
        {n.employees.filter((e) => e.active !== false).map((e) => {
          const pts = inPeriod.filter((p) => p.employee_id === e.id)
          const all = n.points.filter((p) => p.employee_id === e.id)
          const s = scoreOf(pts, w)
          const good = pts.filter((p) => p.type === 'pos').slice(-3).reverse()
          const todo = all.filter((p) => p.type === 'neg' && p.status !== 'resolvido')
          const following = n.points.filter((p) => p.type === 'neg' && p.status !== 'resolvido' && p.involved?.includes(e.id))
          return (
            <div key={e.id} className="card team-card">
              <div className="tc-head">
                <span className="avatar">{initials(e.name)}</span>
                <div className="tc-who"><strong>{e.name}</strong><small>{e.role || 'Sem função'} · {UNIT_NAMES[e.unit] || '—'}</small></div>
                <span className={`score ${s.score >= 0 ? 'up' : 'down'}`} title="Pontuação no mês">{s.score > 0 ? '+' : ''}{s.score}</span>
              </div>
              <div className="tc-cols">
                <div>
                  <div className="section-label good"><ThumbsUp size={13} />Está bom</div>
                  {good.length ? good.map((p) => <p key={p.id} className="tc-item">{p.text}</p>) : <p className="tc-item muted">Sem elogios no mês.</p>}
                </div>
                <div>
                  <div className="section-label warn"><Target size={13} />Melhorar</div>
                  {todo.length ? todo.map((p) => (
                    <p key={p.id} className={`tc-item ${isOverdue(p) ? 'late' : ''}`}>{p.text}{p.due_date && <small> · até {dateBR(p.due_date)}</small>}</p>
                  )) : <p className="tc-item muted">Nada pendente.</p>}
                </div>
              </div>
              {following.length > 0 && (
                <div className="tc-follow"><ListChecks size={13} />Cobrando {following.length} {following.length === 1 ? 'ação' : 'ações'} da equipe: {following.map((p) => p.text.split(/[.,(]/)[0]).slice(0, 2).join('; ')}{following.length > 2 ? '…' : ''}</div>
              )}
              <div className="tc-foot">
                <span className="muted">{s.pos} positivos · {s.neg} a melhorar no mês</span>
                <div className="row-actions" style={{ opacity: 1 }}>
                  {canWrite && <button className="btn ghost icon" aria-label="Editar funcionário" onClick={() => setEditing(e)}><Pencil /></button>}
                  <button className="btn sm" onClick={() => ctx.openReport({ employeeId: e.id, month })}><FileText />Relatório</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {editing && <EmployeeForm ctx={ctx} employee={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EmployeeForm({ ctx, employee, onClose }) {
  const { store, toast } = ctx
  const confirm = useConfirm()
  const [f, setF] = useState({ ...employee, aliasesText: (employee.aliases || []).join(', ') })
  const save = async (e) => {
    e.preventDefault()
    const payload = { ...(f.id ? { id: f.id } : {}), name: f.name.trim(), role: f.role.trim(), unit: f.unit, aliases: f.aliasesText.split(',').map((s) => s.trim()).filter(Boolean), active: true }
    const saved = await api.nutriSaveEmployee(payload)
    store.setNutri((d) => ({ ...d, employees: f.id ? d.employees.map((x) => (x.id === saved.id ? saved : x)) : [...d.employees, saved] }))
    toast('Funcionário salvo.'); onClose()
  }
  const remove = async () => {
    if (!(await confirm({ title: 'Remover funcionário', message: `Remover ${employee.name}? Os pontos dele ficam como “Geral / estrutura”.`, ok: 'Remover', danger: true }))) return
    await api.nutriDeleteEmployee(employee.id)
    store.setNutri((d) => ({ ...d, employees: d.employees.filter((x) => x.id !== employee.id), points: d.points.map((p) => (p.employee_id === employee.id ? { ...p, employee_id: null } : p)) }))
    onClose()
  }
  return (
    <Modal title={employee.id ? 'Editar funcionário' : 'Cadastrar funcionário'} onClose={onClose}
      footer={<>{employee.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}><Trash2 />Remover</button>}<button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" form="ef">Salvar</button></>}>
      <form id="ef" onSubmit={save} className="stack">
        <label className="field"><span>Nome completo</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></label>
        <label className="field"><span>Apelidos (como a nutricionista costuma chamar)</span><input className="input" placeholder="Ex.: Ju, Juju" value={f.aliasesText} onChange={(e) => setF({ ...f, aliasesText: e.target.value })} /></label>
        <div className="grid-2">
          <label className="field"><span>Função</span><input className="input" placeholder="Chapeiro, montagem…" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></label>
          <label className="field"><span>Unidade</span>
            <select className="select" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
              {Object.entries(UNIT_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <p className="hint" style={{ margin: 0 }}>O primeiro nome e os apelidos são usados para reconhecer a pessoa no texto do relatório.</p>
      </form>
    </Modal>
  )
}

// =====================================================================
// Ranking e metas
// =====================================================================
function Ranking({ ctx }) {
  const { n, canManage, store, toast } = ctx
  const { months, latest } = usePeriods(n.points)
  const [month, setMonth] = useState(latest)
  const [editGoal, setEditGoal] = useState(false)
  const [from, to] = monthRange(month)
  const { weights: w, goal } = n.settings
  const rows = n.employees.filter((e) => e.active !== false).map((e) => {
    const s = scoreOf(n.points.filter((p) => p.employee_id === e.id && p.date >= from && p.date <= to), w)
    const hit = goal.active && s.score >= goal.min_score && s.open <= goal.max_open
    return { e, ...s, hit }
  }).sort((a, b) => b.score - a.score || b.pos - a.pos || a.open - b.open)
  const hits = rows.filter((r) => r.hit).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ranking e metas</h1>
          <p>Pontuação do mês com base nos relatórios da nutricionista.</p>
        </div>
        <div className="head-actions">
          <select className="select" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
      </div>

      <div className="rank-top">
        <div className="card goal-card">
          <div className="gc-head">
            <span className="panel-icon pi-goal"><Target /></span>
            <div><strong>Meta do mês</strong><small>{goal.active ? `${hits} de ${rows.length} pessoas batendo a meta` : 'Meta desativada'}</small></div>
            {canManage && <button className="btn sm" onClick={() => setEditGoal(true)}><Pencil />Editar meta</button>}
          </div>
          <div className="gc-rules">
            <div><small>Pontuação mínima</small><strong>{goal.min_score} pts</strong></div>
            <div><small>Máx. de ações em aberto</small><strong>{goal.max_open}</strong></div>
            <div className="wide"><small>Recompensa</small><strong>{goal.reward || '—'}</strong></div>
          </div>
          <p className="hint" style={{ margin: 0 }}>Como pontua: positivo {fmtW(w.pos)} · a melhorar {fmtW(w.neg)} · a melhorar resolvido {fmtW(w.resolved)}.</p>
        </div>
        <div className="podium">
          {rows.slice(0, 3).map((r, i) => (
            <div key={r.e.id} className={`card pod pod-${i + 1}`}>
              <Medal className="pod-medal" />
              <span className="avatar">{initials(r.e.name)}</span>
              <strong>{r.e.name.split(' ')[0]}</strong>
              <span className="pod-score">{r.score > 0 ? '+' : ''}{r.score} pts</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap" style={{ borderTop: 0 }}>
          <table className="data">
            <thead><tr><th>#</th><th>Funcionário</th><th className="num">Positivos</th><th className="num">A melhorar</th><th className="num">Resolvidos</th><th className="num">Em aberto</th><th className="num">Pontos</th><th style={{ width: '24%' }}>Rumo à meta</th><th>Situação</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.e.id}>
                  <td className="num" style={{ textAlign: 'left' }}>{i + 1}º</td>
                  <td><strong>{r.e.name}</strong><div className="muted" style={{ fontSize: 12 }}>{r.e.role} · {UNIT_NAMES[r.e.unit]}</div></td>
                  <td className="num" style={{ color: 'var(--good)' }}>{r.pos}</td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{r.neg}</td>
                  <td className="num">{r.resolved}</td>
                  <td className="num">{r.open}</td>
                  <td className="num"><strong>{r.score > 0 ? '+' : ''}{r.score}</strong></td>
                  <td>
                    <div className="goal-bar" title={`${r.score} de ${goal.min_score} pts`}><span style={{ width: `${Math.max(0, Math.min(100, (r.score / (goal.min_score || 1)) * 100))}%` }} className={r.hit ? 'hit' : ''} /></div>
                  </td>
                  <td>{!goal.active ? <span className="muted">—</span> : r.hit ? <span className="pill good"><Trophy size={12} />Meta batida</span> : r.score < goal.min_score ? <span className="pill">{(() => { const f = Math.round((goal.min_score - r.score) * 10) / 10; return f === 1 ? 'Falta 1 pt' : `Faltam ${String(f).replace('.', ',')} pts` })()}</span> : <span className="pill warn">{r.open} em aberto</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editGoal && <GoalForm ctx={ctx} onClose={() => setEditGoal(false)} />}
    </>
  )
}
const fmtW = (v) => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}`

function GoalForm({ ctx, onClose }) {
  const { n, store, toast } = ctx
  const [s, setS] = useState(JSON.parse(JSON.stringify(n.settings)))
  const num = (v) => Number(String(v).replace(',', '.')) || 0
  const save = async (e) => {
    e.preventDefault()
    const saved = await api.nutriSaveSettings(s)
    store.setNutri((d) => ({ ...d, settings: saved })); toast('Meta atualizada.'); onClose()
  }
  const setGoal = (k, v) => setS({ ...s, goal: { ...s.goal, [k]: v } })
  const setW = (k, v) => setS({ ...s, weights: { ...s.weights, [k]: v } })
  return (
    <Modal title="Meta e pontuação" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" form="gf">Salvar meta</button></>}>
      <form id="gf" onSubmit={save} className="stack">
        <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={s.goal.active} onChange={(e) => setGoal('active', e.target.checked)} />Meta ativa</label>
        <div className="grid-2">
          <label className="field"><span>Pontuação mínima no mês</span><input className="input num" inputMode="decimal" value={s.goal.min_score} onChange={(e) => setGoal('min_score', num(e.target.value))} /></label>
          <label className="field"><span>Máximo de ações em aberto</span><input className="input num" inputMode="numeric" value={s.goal.max_open} onChange={(e) => setGoal('max_open', Math.max(0, Math.round(num(e.target.value))))} /></label>
        </div>
        <label className="field"><span>Recompensa</span><input className="input" placeholder="Ex.: bônus de R$ 150, folga extra…" value={s.goal.reward} onChange={(e) => setGoal('reward', e.target.value)} /></label>
        <div className="section-label">Pesos da pontuação</div>
        <div className="grid-3">
          <label className="field"><span>Ponto positivo</span><input className="input num" inputMode="decimal" value={s.weights.pos} onChange={(e) => setW('pos', num(e.target.value))} /></label>
          <label className="field"><span>Ponto a melhorar</span><input className="input num" inputMode="decimal" value={s.weights.neg} onChange={(e) => setW('neg', num(e.target.value))} /></label>
          <label className="field"><span>Bônus ao resolver</span><input className="input num" inputMode="decimal" value={s.weights.resolved} onChange={(e) => setW('resolved', num(e.target.value))} /></label>
        </div>
        <p className="hint" style={{ margin: 0 }}>Exemplo com os pesos atuais: 5 positivos e 2 a melhorar, sendo 1 resolvido = {Math.round((5 * s.weights.pos + 2 * s.weights.neg + s.weights.resolved) * 10) / 10} pontos.</p>
      </form>
    </Modal>
  )
}

// =====================================================================
// Relatório para a equipe (semanal ou mensal, por funcionário)
// =====================================================================
function WeeklyReport({ ctx, initial, onClose }) {
  const { n, empById, toast } = ctx
  const { weeks, months, latest } = usePeriods(n.points)
  const [mode, setMode] = useState(initial.month ? 'month' : 'week')
  const [week, setWeek] = useState(weeks.find((w) => n.points.some((p) => weekStart(p.date) === w)) || weeks[0])
  const [month, setMonth] = useState(initial.month || latest)
  const [emp, setEmp] = useState(initial.employeeId || '')
  const [from, to] = mode === 'week' ? [week, addDays(week, 6)] : monthRange(month)
  const periodLabel = mode === 'week' ? `Semana de ${dateBR(from)} a ${dateBR(to)}` : `Mês de ${monthLabel(month)}`
  const pts = n.points.filter((p) => p.date >= from && p.date <= to && p.employee_id && (!emp || p.employee_id === emp))
  const groups = groupBy(pts, (p) => p.employee_id)
  const ids = Object.keys(groups).sort((a, b) => (empById[a]?.name || '').localeCompare(empById[b]?.name || ''))

  const copy = async (id) => {
    const text = whatsappText(empById[id], groups[id], periodLabel)
    try { await navigator.clipboard.writeText(text); toast(`Texto de ${empById[id].name.split(' ')[0]} copiado. Cole no WhatsApp.`) }
    catch { toast('Não foi possível copiar automaticamente. Use o PDF ou selecione o texto.', 'error') }
  }
  const pdf = async () => {
    const { exportNutriPDF } = await import('../lib/nutriExport.js')
    await exportNutriPDF(ids.map((id) => ({ emp: empById[id], points: groups[id], score: scoreOf(groups[id], n.settings.weights) })), periodLabel)
  }

  return (
    <Modal title="Relatório para a equipe" onClose={onClose} wide
      footer={<>
        <span className="left">{ids.length} funcionário{ids.length !== 1 ? 's' : ''} · {pts.filter((p) => p.type === 'pos').length} positivos · {pts.filter((p) => p.type === 'neg').length} a melhorar</span>
        <button className="btn" onClick={pdf} disabled={!ids.length}><FileDown />Baixar PDF</button>
        <button className="btn primary" onClick={onClose}>Fechar</button>
      </>}>
      <div className="filters" style={{ padding: '0 0 14px' }}>
        <div className="seg" role="group" aria-label="Período">
          <button aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Semana</button>
          <button aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Mês</button>
        </div>
        {mode === 'week'
          ? <select className="select" style={{ width: 200 }} value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Semana">{weeks.map((w) => <option key={w} value={w}>Semana {weekLabel(w)}</option>)}</select>
          : <select className="select" style={{ width: 170 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>}
        <select className="select" style={{ width: 220 }} value={emp} onChange={(e) => setEmp(e.target.value)} aria-label="Funcionário">
          <option value="">Todos os funcionários</option>
          {n.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {!ids.length && <div className="empty"><Inbox /><div>Nenhum ponto registrado nesse período.</div></div>}
      <div className="wr-list">
        {ids.map((id) => {
          const e = empById[id]; const list = groups[id]
          const s = scoreOf(list, n.settings.weights)
          const pos = list.filter((p) => p.type === 'pos'); const neg = list.filter((p) => p.type === 'neg')
          return (
            <div key={id} className="wr-card">
              <div className="tc-head">
                <span className="avatar">{initials(e.name)}</span>
                <div className="tc-who"><strong>{e.name}</strong><small>{e.role} · {UNIT_NAMES[e.unit]} · {periodLabel}</small></div>
                <span className={`score ${s.score >= 0 ? 'up' : 'down'}`}>{s.score > 0 ? '+' : ''}{s.score}</span>
                <button className="btn sm" onClick={() => copy(id)}><Copy />Copiar para WhatsApp</button>
              </div>
              <div className="tc-cols">
                <div>
                  <div className="section-label good"><ThumbsUp size={13} />O que está bom</div>
                  {pos.length ? pos.map((p) => <p key={p.id} className="tc-item">{p.text}</p>) : <p className="tc-item muted">Sem registros.</p>}
                </div>
                <div>
                  <div className="section-label warn"><Target size={13} />O que precisa melhorar</div>
                  {neg.length ? neg.map((p) => (
                    <div key={p.id} className="tc-item">
                      {p.text} <StatusPill p={p} />
                      {p.response && <div className="tc-plan"><CalendarClock size={12} />{p.response}{p.due_date && ` · até ${dateBR(p.due_date)}`}</div>}
                    </div>
                  )) : <p className="tc-item muted">Nada a melhorar. Continue assim!</p>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function groupBy(list, fn) {
  return list.reduce((acc, x) => { const k = fn(x); (acc[k] ||= []).push(x); return acc }, {})
}
