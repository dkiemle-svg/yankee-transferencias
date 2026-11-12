import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowDownToLine, Boxes, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, CookingPot, Factory, Inbox, Lock,
  PackageMinus, PackagePlus, Pencil, Plus, Search, Trash2, Undo2, Upload, Wallet, Link2, Droplets,
} from 'lucide-react'
import { api, EST_INICIO } from '../lib/api.js'
import { money, dateBR, today } from '../lib/format.js'
import {
  TIPOS_MOV, MOTIVOS_MANUAL, MOTIVOS_PERDA, calcEstoque, precos, desvios, consumoPostMix, parseEstoqueAtual, parseFichas, addDias,
} from '../lib/estoque.js'
import { Modal, SortTh, useToast, useConfirm } from '../components/ui.jsx'
import ExportMenu from '../components/ExportMenu.jsx'
import { exportar } from '../lib/relatorio.js'
import { cmvRelatorio, totalCmv, PROMO_PADRAO } from '../lib/cmv.js'

const qf = (v, d = 3) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }))
const pct = (v) => (v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
const nomeBonito = (s) => String(s || '').toLowerCase().replace(/(^|[\s(/-])\S/g, (u) => u.toUpperCase())
const catBonita = (s) => nomeBonito(s).replace('Descartaveis-Fat', 'Descartáveis de venda').replace('Descartaveis', 'Descartáveis').replace('Higienizacao', 'Higienização')
const lerTexto = async (file) => { const b = await file.arrayBuffer(); try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return new TextDecoder('windows-1252').decode(b) } }

function Kpi({ icon: I, label, value, sub, tone = '' }) {
  return <div className={`card kpi fin-kpi ${tone ? `is-${tone}` : ''}`}><small><I />{label}</small><div className="val">{value}</div><div className="sub">{sub}</div></div>
}

export default function EstoquePanel({ store, tab }) {
  const toast = useToast()
  const [est, setEst] = useState(null)
  const [modal, setModal] = useState(null) // {tipo:'manual'|'perda'|'producao'|'entrada', insumo?}
  const reload = async () => { try { setEst(await api.estLoad()) } catch (e) { toast(e.message, 'error') } }
  useEffect(() => { reload() }, [])
  const hoje = today()

  const calc = useMemo(() => {
    if (!est) return null
    const ativos = est.insumos.filter((i) => i.ativo)
    const movs = [...est.movs, ...est.saidas]
    const res = calcEstoque({ insumos: ativos, contagens: est.contagens, movs, hoje, inicio: EST_INICIO })
    const preco = (i) => precos(i, est.movs).medio
    const pr = new Map(est.insumos.map((i) => [i.codigo, precos(i, est.movs)]))
    const comFicha = new Set(est.fichas.map((f) => f.produto_codigo))
    const semFicha = new Map()
    for (const v of est.vendas) if (!comFicha.has(v.codigo)) { const o = semFicha.get(v.codigo) || { codigo: v.codigo, nome: v.nome, qtd: 0 }; o.qtd += v.qtd; semFicha.set(v.codigo, o) }
    const noCadastro = new Set(est.pratos.map((p) => p.codigo))
    const sf = [...semFicha.values()].map((x) => ({ ...x, novo: !noCadastro.has(x.codigo) })).sort((a, b) => b.qtd - a.qtd)
    return { ...res, movs, preco, pr, semFicha: sf, novos: sf.filter((x) => x.novo) }
  }, [est, hoje])

  if (!est || !calc) return <div className="center-screen"><div className="spinner" /></div>
  const ctx = { store, est, calc, reload, setModal, hoje, toast }
  const vazio = !est.insumos.length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Estoque · Loja ZN Salão</h1>
          <p>{calc.d0 ? <>Base: contagem de <strong>{dateBR(calc.d0.corte)}</strong>. Estoque atual = contagem + entradas − saídas desde então.</> : <>Aguardando a <strong>primeira contagem</strong>. Até lá, tudo começa em zero.</>}</p>
        </div>
        {!vazio && <div className="head-actions">
          <button className="btn" onClick={() => setModal({ tipo: 'perda' })}><PackageMinus />Perda</button>
          <button className="btn" onClick={() => setModal({ tipo: 'producao' })}><CookingPot />Produção</button>
          <button className="btn primary" onClick={() => setModal({ tipo: 'manual' })}><PackagePlus />Entrada sem nota</button>
        </div>}
      </div>
      {vazio && tab !== 'est-cadastros' ? (
        <div className="card"><div className="empty"><Boxes /><div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Ainda não há insumos cadastrados.</div>
          <div style={{ marginBottom: 14 }}>Importe o cadastro e as fichas técnicas da 3LM em Cadastros.</div>
          <button className="btn primary" onClick={() => store.go('est-cadastros')}><Upload />Ir para Cadastros</button></div></div>
      ) : (
        <>
          {tab === 'est-lista' && <Lista ctx={ctx} />}
          {tab === 'est-contagens' && <Contagens ctx={ctx} />}
          {tab === 'est-movs' && <Lancamentos ctx={ctx} />}
          {tab === 'est-cmv' && <Cmv ctx={ctx} />}
          {tab === 'est-cadastros' && <Cadastros ctx={ctx} />}
        </>
      )}
      {modal && <MovForm ctx={ctx} modal={modal} onClose={() => setModal(null)} />}
    </>
  )
}

// =====================================================================
// Lista de produtos com estoque atual
// =====================================================================
function Lista({ ctx }) {
  const { calc, est, store } = ctx
  const [cat, setCat] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('')
  const [aberto, setAberto] = useState(null)
  const [sort, setSort] = useState({ key: 'nome', dir: 'asc' })
  const cats = [...new Set(calc.rows.map((r) => r.categoria))].sort()
  const q = busca.trim().toLowerCase()
  const rows = calc.rows.filter((r) => (!cat || r.categoria === cat) && (!q || r.nome.toLowerCase().includes(q) || r.codigo === q)
    && (filtro !== 'neg' || r.negativo) && (filtro !== 'comprar' || r.sugestao > 0) && (filtro !== 'mov' || r.entradas || r.saidas))
  const val = (r) => (sort.key === 'valor' ? r.atual * calc.preco(r) : sort.key === 'preco' ? calc.preco(r) : r[sort.key])
  rows.sort((a, b) => { const x = val(a); const y = val(b); if (x == null) return 1; if (y == null) return -1; const c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y; return sort.dir === 'asc' ? c : -c })
  const valor = calc.rows.reduce((t, r) => t + Math.max(r.atual, 0) * calc.preco(r), 0)
  const neg = calc.rows.filter((r) => r.negativo).length
  const comprar = calc.rows.filter((r) => r.sugestao > 0).length

  return (
    <>
      <div className="kpis">
        <Kpi icon={Wallet} label="Valor em estoque" value={money(valor)} sub={`${calc.rows.length} insumos ativos · preço médio`} />
        <Kpi icon={ArrowDownToLine} label="Sugestão de compra" value={comprar} sub="itens para o ciclo de 7 dias" tone={comprar ? 'warn' : ''} />
        <Kpi icon={AlertTriangle} label="Estoque negativo" value={neg} sub={neg ? 'nota que não entrou ou ficha errada' : 'nenhum'} tone={neg ? 'bad' : ''} />
        <Kpi icon={CookingPot} label="Vendidos sem ficha" value={calc.semFicha.length} sub={calc.semFicha.length ? calc.semFicha.slice(0, 3).map((s) => nomeBonito(s.nome)).join(', ') : 'todos com ficha'} tone={calc.semFicha.length ? 'warn' : ''} />
      </div>
      {calc.novos.length > 0 && <div className="note warn" style={{ marginBottom: 12 }}><AlertTriangle size={16} /><span><strong>{calc.novos.length} {calc.novos.length > 1 ? 'itens vendidos não estão' : 'item vendido não está'} no cadastro</strong> ({calc.novos.slice(0, 4).map((s) => nomeBonito(s.nome)).join(', ')}{calc.novos.length > 4 ? '…' : ''}). Provavelmente são novos na 3LM: reimporte as Fichas Técnicas ou cadastre em <button className="link" onClick={() => store.go('est-cadastros')}>Cadastros → Cardápio</button>. Até lá, eles não baixam o estoque.</span></div>}
      {!calc.d0 && <div className="note warn" style={{ marginBottom: 12 }}><AlertTriangle size={16} /><span><strong>Sem contagem ainda.</strong> Tudo fica em zero e a sugestão de compra só aparece depois do D0. O consumo por dia já é calculado pelas vendas dos últimos 7 dias. Faça a primeira contagem em <button className="link" onClick={() => store.go('est-contagens')}>Contagens</button> para ter o D0.</span></div>}
      <div className="card">
        <div className="filters fin-filters">
          <label className="search-box"><Search size={15} /><input className="input" placeholder="Buscar insumo" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
          <select className="select" style={{ width: 210 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>{cats.map((c) => <option key={c} value={c}>{catBonita(c)}</option>)}
          </select>
          <div className="seg" role="group" aria-label="Filtro">
            {[['', 'Todos'], ['mov', 'Com movimento'], ['comprar', 'Comprar'], ['neg', 'Negativos']].map(([k, l]) => <button key={k} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{l}</button>)}
          </div>
        </div>
        <div className="table-wrap" style={{ maxHeight: '66vh' }}>
          <table className="data est-table">
            <thead><tr>
              <th className="w-check" />
              <SortTh k="nome" sort={sort} setSort={setSort}>Insumo</SortTh>
              <SortTh k="d0" sort={sort} setSort={setSort} className="num hide-sm">D0</SortTh>
              <SortTh k="entradas" sort={sort} setSort={setSort} className="num hide-sm">Entradas</SortTh>
              <SortTh k="saidas" sort={sort} setSort={setSort} className="num hide-sm">Saídas</SortTh>
              <SortTh k="atual" sort={sort} setSort={setSort} className="num">Atual</SortTh>
              <SortTh k="consumoDia" sort={sort} setSort={setSort} className="num hide-sm">Consumo/dia</SortTh>
              <SortTh k="cobertura" sort={sort} setSort={setSort} className="num">Cobertura</SortTh>
              <SortTh k="sugestao" sort={sort} setSort={setSort} className="num">Comprar</SortTh>
              <SortTh k="preco" sort={sort} setSort={setSort} className="num hide-sm">Preço médio · melhor · último</SortTh>
              <SortTh k="valor" sort={sort} setSort={setSort} className="num hide-sm">Valor</SortTh>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const p = calc.pr.get(r.codigo); const open = aberto === r.codigo
                return (
                  <React.Fragment key={r.codigo}>
                    <tr className={`est-row ${open ? 'selected' : ''}`} onClick={() => setAberto(open ? null : r.codigo)}>
                      <td className="w-check">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td><strong>{nomeBonito(r.nome)}</strong> <small className="muted">{r.unidade}{r.litros ? ` · ${qf(r.litros)} L` : ''}</small></td>
                      <td className="num hide-sm muted">{qf(r.d0)}</td>
                      <td className="num hide-sm">{r.entradas ? `+${qf(r.entradas)}` : '—'}</td>
                      <td className="num hide-sm">{r.saidas ? `−${qf(r.saidas)}` : '—'}</td>
                      <td className={`num ${r.negativo ? 'txt-danger' : ''}`}><strong>{qf(r.atual)}</strong></td>
                      <td className="num hide-sm">{r.consumoDia ? qf(r.consumoDia, 2) : '—'}</td>
                      <td className={`num ${r.cobertura != null && r.cobertura < 3 ? 'txt-danger' : ''}`}>{r.cobertura == null ? '—' : `${qf(Math.max(r.cobertura, 0), 1)} d`}</td>
                      <td className="num">{r.sugestao > 0 ? <span className="pill warn">{qf(r.sugestao, 2)}</span> : '—'}</td>
                      <td className="num hide-sm est-precos">{money(p.medio)} · {p.melhor != null ? money(p.melhor) : '—'} · {money(p.ultimo)}{p.fonte === '3LM' && <small className="muted"> 3LM</small>}</td>
                      <td className="num hide-sm">{money(Math.max(r.atual, 0) * p.medio)}</td>
                    </tr>
                    {open && <tr className="est-detail"><td colSpan={11}><Historico ctx={ctx} insumo={r} /></td></tr>}
                  </React.Fragment>
                )
              })}
              {!rows.length && <tr><td colSpan={11}><div className="empty"><Inbox /><div>Nenhum insumo.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function Historico({ ctx, insumo }) {
  const { calc, est, setModal, hoje } = ctx
  const [de, setDe] = useState(addDias(hoje, -6))
  const [ate, setAte] = useState(hoje)
  const [min, setMin] = useState('')
  const { linhas } = useMemo(() => {
    const base = calc.base || addDias(EST_INICIO, -1)
    const ms = calc.movs.filter((m) => m.insumo_codigo === insumo.codigo && m.dia > base)
      .map((m) => ({ ...m, q: Number(m.qtd) * (TIPOS_MOV[m.tipo]?.sinal ?? 1) }))
      .sort((a, b) => a.dia.localeCompare(b.dia) || (b.q > 0) - (a.q > 0))
    let saldo = insumo.d0
    const out = [{ dia: base, tipo: 'd0', q: insumo.d0, saldo, label: calc.d0 ? 'Contagem (D0)' : 'Sem contagem: saldo não é calculado' }]
    for (const m of ms) { if (calc.d0) saldo += m.q; out.push({ ...m, saldo: calc.d0 ? saldo : null }) }
    return { linhas: out }
  }, [calc, insumo])
  const vis = linhas.filter((l) => l.tipo === 'd0' || (l.dia >= de && l.dia <= ate))
  return (
    <div className="est-hist">
      <div className="est-hist-head">
        <strong>Movimentações</strong>
        <label className="fin-date">De <input type="date" className="input" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
        <label className="fin-date">Até <input type="date" className="input" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
        <span className="spacer" />
        <label className="fin-date">Estoque mínimo <input className="input" style={{ width: 90 }} inputMode="decimal" defaultValue={insumo.estoque_min || ''} placeholder="0"
          onBlur={async (e) => { const v = Number(String(e.target.value).replace(',', '.')) || 0; if (v !== Number(insumo.estoque_min || 0)) { await api.estSaveInsumo(insumo.codigo, { estoque_min: v }); ctx.reload() } }} /> {insumo.unidade}</label>
        <button className="btn sm" onClick={() => setModal({ tipo: 'manual', insumo: insumo.codigo })}><PackagePlus />Entrada</button>
        <button className="btn sm" onClick={() => setModal({ tipo: 'perda', insumo: insumo.codigo })}><PackageMinus />Perda</button>
      </div>
      <table className="data compact">
        <thead><tr><th>Dia</th><th>Movimento</th><th className="hide-sm">Origem</th><th className="num">Qtd</th><th className="num">Saldo</th></tr></thead>
        <tbody>
          {vis.map((l, i) => (
            <tr key={i} className={l.tipo === 'd0' ? 'is-off' : ''}>
              <td className="nowrap">{dateBR(l.dia)}</td>
              <td>{l.label || TIPOS_MOV[l.tipo]?.label}{l.tipo === 'manual' && <span className="pill" style={{ marginLeft: 6 }}>manual</span>}</td>
              <td className="hide-sm muted">{l.origem ? `${nomeBonito(l.origem.replace(/^\d+ /, ''))}${l.origem_qtd ? ` (×${qf(l.origem_qtd)})` : ''}` : [l.ref, l.obs].filter(Boolean).join(' · ')}</td>
              <td className={`num ${l.q < 0 ? 'txt-danger' : l.q > 0 && l.tipo !== 'd0' ? 'txt-good' : ''}`}>{l.tipo === 'd0' ? qf(l.q) : `${l.q > 0 ? '+' : '−'}${qf(Math.abs(l.q))}`}</td>
              <td className="num"><strong>{l.saldo == null ? '—' : qf(l.saldo)}</strong></td>
            </tr>
          ))}
          {vis.length === 1 && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sem movimentos no período.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// =====================================================================
// Entrada sem nota, perda e produção
// =====================================================================
function MovForm({ ctx, modal, onClose }) {
  const { est, calc, reload, toast, hoje } = ctx
  const ativos = est.insumos.filter((i) => i.ativo).sort((a, b) => a.nome.localeCompare(b.nome))
  const processados = ativos.filter((i) => i.categoria === 'PROCESSADOS')
  const [f, setF] = useState({ insumo: modal.insumo || '', dia: hoje, qtd: '', custo: '', motivo: modal.tipo === 'perda' ? MOTIVOS_PERDA[0] : MOTIVOS_MANUAL[0], obs: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const n = (v) => Number(String(v).replace(',', '.'))
  const ins = est.insumos.find((i) => i.codigo === f.insumo)
  const ficha = modal.tipo === 'producao' ? est.fichasProd.filter((p) => p.processado_codigo === f.insumo) : []
  const titulo = { manual: 'Entrada sem nota', perda: 'Lançar perda', producao: 'Registrar produção' }[modal.tipo]
  const lista = modal.tipo === 'producao' ? processados : ativos
  const salvar = async () => {
    const qtd = n(f.qtd)
    if (!ins || !(qtd > 0)) { toast('Escolha o insumo e a quantidade.', 'error'); return }
    setBusy(true)
    try {
      const lote = crypto.randomUUID ? crypto.randomUUID() : undefined
      let rows
      if (modal.tipo === 'producao') {
        rows = [{ dia: f.dia, insumo_codigo: ins.codigo, tipo: 'producao_in', qtd, lote, ref: 'Produção', obs: f.obs || null },
          ...ficha.map((l) => ({ dia: f.dia, insumo_codigo: l.insumo_codigo, tipo: 'producao_out', qtd: Math.round(l.qtd * qtd * 10000) / 10000, lote, ref: `Produção de ${nomeBonito(ins.nome)}` }))]
      } else {
        rows = [{ dia: f.dia, insumo_codigo: ins.codigo, tipo: modal.tipo, qtd, custo_unit: modal.tipo === 'manual' && f.custo ? n(f.custo) : null, ref: f.motivo, obs: f.obs || null }]
      }
      await api.estAddMovs(rows); await reload(); toast(`${titulo}: registrado.`); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={titulo} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar'}</button></>}>
      <div className="stack">
        <label className="field"><span>{modal.tipo === 'producao' ? 'Processado produzido' : 'Insumo'}</span>
          <select className="select" value={f.insumo} onChange={set('insumo')}>
            <option value="">Escolha…</option>
            {lista.map((i) => <option key={i.codigo} value={i.codigo}>{nomeBonito(i.nome)} ({i.unidade})</option>)}
          </select>
        </label>
        <div className="row-2">
          <label className="field"><span>Data</span><input type="date" className="input" value={f.dia} onChange={set('dia')} /></label>
          <label className="field"><span>Quantidade {ins ? `(${ins.unidade})` : ''}</span><input className="input" inputMode="decimal" value={f.qtd} onChange={set('qtd')} placeholder="0" /></label>
        </div>
        {modal.tipo === 'manual' && <div className="row-2">
          <label className="field"><span>Custo unitário (R$)</span><input className="input" inputMode="decimal" value={f.custo} onChange={set('custo')} placeholder={ins ? String(calc.pr.get(ins.codigo)?.ultimo?.toFixed(2) || '') : ''} /></label>
          <label className="field"><span>Motivo</span><select className="select" value={f.motivo} onChange={set('motivo')}>{MOTIVOS_MANUAL.map((m) => <option key={m}>{m}</option>)}</select></label>
        </div>}
        {modal.tipo === 'perda' && <label className="field"><span>Motivo</span><select className="select" value={f.motivo} onChange={set('motivo')}>{MOTIVOS_PERDA.map((m) => <option key={m}>{m}</option>)}</select></label>}
        {modal.tipo === 'producao' && ins && (ficha.length
          ? <div className="note"><CookingPot size={16} /><span>Vai baixar: {ficha.map((l) => `${qf(l.qtd * (n(f.qtd) || 0))} ${est.insumos.find((x) => x.codigo === l.insumo_codigo)?.unidade || ''} de ${nomeBonito(est.insumos.find((x) => x.codigo === l.insumo_codigo)?.nome)}`).join(', ')}.</span></div>
          : <div className="note warn"><AlertTriangle size={16} /><span>{nomeBonito(ins.nome)} ainda não tem ficha de produção. A produção soma ao estoque, mas não baixa insumos. Cadastre a ficha em Cadastros → Fichas de produção.</span></div>)}
        {!processados.length && modal.tipo === 'producao' && <p className="hint">Nenhum processado ativo.</p>}
        <label className="field"><span>Observação</span><input className="input" value={f.obs} onChange={set('obs')} placeholder="Opcional" /></label>
      </div>
    </Modal>
  )
}

// =====================================================================
// Lançamentos (o que foi registrado à mão)
// =====================================================================
function Lancamentos({ ctx }) {
  const { est, reload, toast, setModal } = ctx
  const confirm = useConfirm()
  const nome = (c) => nomeBonito(est.insumos.find((i) => i.codigo === c)?.nome || c)
  const un = (c) => est.insumos.find((i) => i.codigo === c)?.unidade || ''
  const rows = [...est.movs].filter((m) => m.tipo !== 'producao_out').sort((a, b) => b.dia.localeCompare(a.dia) || (b.created_at || '').localeCompare(a.created_at || ''))
  const remove = async (m) => {
    if (!(await confirm({ title: 'Excluir lançamento', message: `Excluir ${TIPOS_MOV[m.tipo].label.toLowerCase()} de ${nome(m.insumo_codigo)}?${m.lote ? ' Os insumos baixados nessa produção voltam também.' : ''}`, ok: 'Excluir', danger: true }))) return
    try { await api.estDeleteMov(m); await reload() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="card">
      <div className="card-head"><div><h3>Lançamentos</h3><p>Entradas sem nota, perdas e produções registradas no painel. As saídas por venda e transferência são calculadas sozinhas e aparecem no histórico de cada insumo.</p></div>
        <div className="fin-form-btns"><button className="btn sm" onClick={() => setModal({ tipo: 'perda' })}><PackageMinus />Perda</button><button className="btn sm" onClick={() => setModal({ tipo: 'producao' })}><CookingPot />Produção</button><button className="btn sm primary" onClick={() => setModal({ tipo: 'manual' })}><PackagePlus />Entrada sem nota</button></div></div>
      <div className="table-wrap" style={{ maxHeight: '66vh' }}>
        <table className="data">
          <thead><tr><th>Dia</th><th>Tipo</th><th>Insumo</th><th className="num">Qtd</th><th className="num hide-sm">Custo un.</th><th className="hide-sm">Motivo / obs.</th><th /></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{dateBR(m.dia)}</td>
                <td><span className={`pill ${m.tipo === 'perda' ? 'danger' : m.tipo === 'producao_in' ? 'accent' : 'good'}`}>{TIPOS_MOV[m.tipo].label}</span></td>
                <td><strong>{nome(m.insumo_codigo)}</strong></td>
                <td className="num">{qf(m.qtd)} {un(m.insumo_codigo)}</td>
                <td className="num hide-sm">{m.custo_unit ? money(m.custo_unit) : '—'}</td>
                <td className="hide-sm muted">{[m.ref, m.obs].filter(Boolean).join(' · ')}</td>
                <td><button className="btn ghost icon" aria-label="Excluir" title="Excluir" onClick={() => remove(m)}><Trash2 /></button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7}><div className="empty"><Inbox /><div>Nada lançado ainda.</div></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// =====================================================================
// Contagens: contagem cega e conferência virtual × real
// =====================================================================
function Contagens({ ctx }) {
  const { est, reload, toast, hoje } = ctx
  const confirm = useConfirm()
  const [sel, setSel] = useState(null)
  const [corte, setCorte] = useState(hoje)
  const lista = [...est.contagens].sort((a, b) => b.corte.localeCompare(a.corte))
  const aberta = lista.find((c) => c.status === 'aberta')
  const atual = lista.find((c) => c.id === sel) || aberta || null
  const nova = async () => {
    if (aberta) { setSel(aberta.id); return }
    if (est.contagens.some((c) => c.status === 'fechada' && c.corte >= corte)) { toast('Já existe contagem fechada nesta data ou depois.', 'error'); return }
    try { const c = await api.estNovaContagem(corte); await reload(); setSel(c.id) } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>Contagens</h3><p>A contagem vale para o <b>fim do dia de corte</b>: as vendas até esse dia ficam antes dela. Ao fechar, ela vira o novo D0 e a diferença fica registrada como desvio.</p></div></div>
        <div className="filters fin-filters">
          {!aberta && <><label className="fin-date">Corte <input type="date" className="input" value={corte} max={hoje} onChange={(e) => e.target.value && setCorte(e.target.value)} /></label>
            <button className="btn primary" onClick={nova}><ClipboardCheck />Nova contagem</button></>}
          {aberta && <span className="note warn" style={{ margin: 0 }}><ClipboardCheck size={16} /><span>Contagem de {dateBR(aberta.corte)} em andamento.</span></span>}
          <div className="seg est-seg-list" role="group" aria-label="Contagens">
            {lista.slice(0, 8).map((c) => <button key={c.id} aria-pressed={atual?.id === c.id} onClick={() => setSel(c.id)}>{dateBR(c.corte).slice(0, 5)} {c.status === 'aberta' ? '· aberta' : ''}</button>)}
          </div>
        </div>
      </div>
      {!atual && <div className="card"><div className="empty"><ClipboardCheck /><div>Nenhuma contagem ainda. Escolha a data de corte e comece a primeira.</div></div></div>}
      {atual && atual.status === 'aberta' && <ContagemAberta ctx={ctx} c={atual} onDelete={async () => {
        if (!(await confirm({ title: 'Descartar contagem', message: 'Apagar esta contagem e tudo que foi digitado nela?', ok: 'Descartar', danger: true }))) return
        await api.estExcluirContagem(atual.id); setSel(null); reload()
      }} />}
      {atual && atual.status === 'fechada' && <ContagemResultado ctx={ctx} c={atual} />}
    </>
  )
}

function ContagemAberta({ ctx, c, onDelete }) {
  const { est, reload, toast } = ctx
  const confirm = useConfirm()
  const ativos = est.insumos.filter((i) => i.ativo)
  const [vals, setVals] = useState(() => Object.fromEntries(c.itens.map((i) => [i.insumo_codigo, String(i.qtd).replace('.', ',')])))
  const [cat, setCat] = useState('')
  const [busca, setBusca] = useState('')
  const [soFalta, setSoFalta] = useState(false)
  const cats = [...new Set(ativos.map((i) => i.categoria))].sort()
  const feitos = ativos.filter((i) => vals[i.codigo] !== undefined && vals[i.codigo] !== '').length
  const q = busca.trim().toLowerCase()
  const lista = ativos.filter((i) => (!cat || i.categoria === cat) && (!q || i.nome.toLowerCase().includes(q)) && (!soFalta || !vals[i.codigo]))
    .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome))
  const salvar = async (i, v) => {
    const t = String(v).trim(); const n = t === '' ? null : Number(t.replace(',', '.'))
    if (n != null && (Number.isNaN(n) || n < 0)) { toast(`Quantidade inválida em ${nomeBonito(i.nome)}.`, 'error'); return }
    try { await api.estContar(c.id, i.codigo, n) } catch (e) { toast(e.message, 'error') }
  }
  const fechar = async () => {
    const falta = ativos.length - feitos
    if (!(await confirm({ title: 'Fechar contagem', message: `${feitos} de ${ativos.length} insumos contados.${falta ? ` Os ${falta} não contados ficam com zero no novo D0.` : ''} Fechar e comparar com o estoque do painel?`, ok: 'Fechar contagem' }))) return
    try {
      const faltando = ativos.filter((i) => !vals[i.codigo])
      for (const i of faltando) await api.estContar(c.id, i.codigo, 0)
      await api.estFecharContagem(c.id); await reload(); toast('Contagem fechada. Ela é o novo D0.')
    } catch (e) { toast(e.message, 'error') }
  }
  let ultimaCat = null
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Contagem de {dateBR(c.corte)}</h3><p>Digite o que tem fisicamente na loja, na unidade de cada item. O estoque do painel fica escondido durante a contagem. Salva sozinho ao sair do campo.</p></div>
        <div className="fin-form-btns"><button className="btn ghost sm" onClick={onDelete}><Trash2 />Descartar</button><button className="btn primary" onClick={fechar}><Lock />Fechar contagem</button></div>
      </div>
      <div className="goal-bar" style={{ margin: '0 16px 10px' }}><span style={{ width: `${(feitos / Math.max(ativos.length, 1)) * 100}%` }} /></div>
      <div className="filters fin-filters">
        <span className="muted" style={{ fontSize: 13 }}><b>{feitos}</b> de {ativos.length} contados</span>
        <label className="search-box"><Search size={15} /><input className="input" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        <select className="select" style={{ width: 210 }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas as categorias</option>{cats.map((x) => <option key={x} value={x}>{catBonita(x)}</option>)}</select>
        <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={soFalta} onChange={(e) => setSoFalta(e.target.checked)} />Só o que falta</label>
      </div>
      <div className="est-count">
        {lista.map((i) => {
          const head = i.categoria !== ultimaCat ? (ultimaCat = i.categoria) : null
          return (
            <React.Fragment key={i.codigo}>
              {head && <div className="est-count-cat">{catBonita(head)}</div>}
              <label className={`est-count-row ${vals[i.codigo] ? 'done' : ''}`}>
                <span>{nomeBonito(i.nome)}</span>
                <input className="input" inputMode="decimal" value={vals[i.codigo] ?? ''} placeholder="—"
                  onChange={(e) => setVals((v) => ({ ...v, [i.codigo]: e.target.value }))} onBlur={(e) => salvar(i, e.target.value)} />
                <small>{i.unidade}{i.litros ? ` (bag ${qf(i.litros)} L, aberto em fração)` : ''}</small>
              </label>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

function ContagemResultado({ ctx, c }) {
  const { est, calc, reload, toast, store } = ctx
  const confirm = useConfirm()
  const [soFora, setSoFora] = useState(true)
  const [sort, setSort] = useState({ key: 'valor', dir: 'asc' })
  const ativos = est.insumos.filter((i) => i.ativo)
  const res = useMemo(() => desvios({ insumos: ativos, contagens: est.contagens, movs: calc.movs, contagem: c, preco: calc.preco }), [est, calc, c])
  const ultima = [...est.contagens].filter((x) => x.status === 'fechada').sort((a, b) => b.corte.localeCompare(a.corte))[0]
  const refis = res.anterior ? est.vendas.filter((v) => v.dia > res.anterior.corte && v.dia <= c.corte && /\bREFILL?\b/i.test(v.nome)).reduce((t, v) => t + v.qtd, 0) : 0
  const pm = consumoPostMix({ rows: res.rows.map((r) => ({ ...r, custo: calc.preco(r) })), refis })
  const rows = res.rows.filter((r) => !soFora || r.fora)
  const val = (r) => (sort.key === 'abs' ? Math.abs(r.valor) : r[sort.key])
  rows.sort((a, b) => { const x = val(a) ?? 0; const y = val(b) ?? 0; const k = typeof x === 'string' ? x.localeCompare(y) : x - y; return sort.dir === 'asc' ? k : -k })
  const reabrir = async () => {
    if (!(await confirm({ title: 'Reabrir contagem', message: 'Reabrir para corrigir? Enquanto estiver aberta, ela deixa de ser o D0.', ok: 'Reabrir' }))) return
    try { await api.estFecharContagem(c.id, true); await reload() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <>
      {!res.anterior ? (
        <div className="note" style={{ marginBottom: 12 }}><CheckCircle2 size={16} /><span><strong>Contagem inicial.</strong> Ela é o D0: não há com o que comparar ainda. A partir da próxima contagem, o painel mostra o desvio de cada item.</span></div>
      ) : (
        <div className="kpis">
          <Kpi icon={PackageMinus} label="Faltou (desvio negativo)" value={money(res.perda)} sub={`entre ${dateBR(res.anterior.corte)} e ${dateBR(c.corte)}`} tone={res.perda < 0 ? 'bad' : ''} />
          <Kpi icon={PackagePlus} label="Sobrou (desvio positivo)" value={money(res.sobra)} sub="nota não lançada ou ficha acima do real" />
          <Kpi icon={AlertTriangle} label="Itens fora da tolerância" value={res.rows.filter((r) => r.fora).length} sub={`de ${res.rows.length} contados`} />
          <Kpi icon={Droplets} label="Post-mix por refil" value={pm.mlPorRefil ? `${qf(pm.mlPorRefil, 0)} ml` : '—'} sub={refis ? `${qf(pm.totalL, 1)} L em ${qf(refis, 0)} refis` : 'sem refis no período'} />
        </div>
      )}
      {res.anterior && pm.itens.some((i) => i.consumoUn) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head"><div><h3>Consumo dos bags de post-mix</h3><p>Contagem anterior + bags que entraram − contagem de agora, em litros. O mix por sabor vem do consumo real dos bags, não do que o caixa lançou.</p></div></div>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Bag</th><th className="num">Consumo</th><th className="num">Litros</th><th className="num">Mix</th><th className="num">Custo do litro</th></tr></thead>
            <tbody>{pm.itens.map((i) => <tr key={i.codigo}><td><strong>{nomeBonito(i.nome)}</strong></td><td className="num">{qf(i.consumoUn, 2)} un</td><td className="num">{qf(i.litros, 1)} L</td><td className="num">{pct(i.share)}</td><td className="num">{money(i.custoLitro)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <div><h3>Contagem de {dateBR(c.corte)} · virtual × real</h3><p>Virtual = contagem anterior + entradas − saídas (vendas pela ficha, transferências, produção e perdas). Tolerância padrão de 3% por item.</p></div>
          <div className="fin-form-btns">
            {res.anterior && <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={soFora} onChange={(e) => setSoFora(e.target.checked)} />Só fora da tolerância</label>}
            {ultima?.id === c.id && store.isMaster && <button className="btn sm" onClick={reabrir}><Undo2 />Reabrir</button>}
          </div>
        </div>
        <div className="table-wrap" style={{ maxHeight: '62vh' }}>
          <table className="data">
            <thead><tr>
              <SortTh k="nome" sort={sort} setSort={setSort}>Insumo</SortTh>
              <SortTh k="anteriorQtd" sort={sort} setSort={setSort} className="num hide-sm">Anterior</SortTh>
              <SortTh k="entradasP" sort={sort} setSort={setSort} className="num hide-sm">Entradas</SortTh>
              <SortTh k="saidasP" sort={sort} setSort={setSort} className="num hide-sm">Saídas</SortTh>
              <SortTh k="virtual" sort={sort} setSort={setSort} className="num">Virtual</SortTh>
              <SortTh k="real" sort={sort} setSort={setSort} className="num">Contado</SortTh>
              <SortTh k="dif" sort={sort} setSort={setSort} className="num">Diferença</SortTh>
              <SortTh k="pct" sort={sort} setSort={setSort} className="num hide-sm">%</SortTh>
              <SortTh k="valor" sort={sort} setSort={setSort} className="num">R$</SortTh>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.codigo} className={r.fora ? 'est-fora' : ''}>
                  <td><strong>{nomeBonito(r.nome)}</strong> <small className="muted">{r.unidade}</small></td>
                  <td className="num hide-sm muted">{qf(r.anteriorQtd)}</td>
                  <td className="num hide-sm">{r.entradasP ? `+${qf(r.entradasP)}` : '—'}</td>
                  <td className="num hide-sm">{r.saidasP ? `−${qf(r.saidasP)}` : '—'}</td>
                  <td className="num">{qf(r.virtual)}</td>
                  <td className="num"><strong>{qf(r.real)}</strong></td>
                  <td className={`num ${r.dif < 0 ? 'txt-danger' : r.dif > 0 ? 'txt-good' : ''}`}>{res.anterior ? `${r.dif > 0 ? '+' : ''}${qf(r.dif)}` : '—'}</td>
                  <td className="num hide-sm">{res.anterior ? pct(r.pct) : '—'}</td>
                  <td className={`num ${r.valor < 0 ? 'txt-danger' : ''}`}>{res.anterior ? money(r.valor) : money(r.real * calc.preco(r))}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9}><div className="empty"><CheckCircle2 /><div>Tudo dentro da tolerância.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// =====================================================================
// Cadastros: importação 3LM, insumos, fichas de produção, transferências, cardápio
// =====================================================================
function Cadastros({ ctx }) {
  const [sub, setSub] = useState(ctx.est.insumos.length ? 'insumos' : 'importar')
  return (
    <>
      <div className="seg" role="group" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {[['importar', 'Importar da 3LM'], ['insumos', 'Insumos'], ['producao', 'Fichas de produção'], ['transf', 'Transferências'], ['cardapio', 'Cardápio e fichas']].map(([k, l]) =>
          <button key={k} aria-pressed={sub === k} onClick={() => setSub(k)}>{l}</button>)}
      </div>
      {sub === 'importar' && <Importar ctx={ctx} />}
      {sub === 'insumos' && <Insumos ctx={ctx} />}
      {sub === 'producao' && <FichasProducao ctx={ctx} />}
      {sub === 'transf' && <TransfMap ctx={ctx} />}
      {sub === 'cardapio' && <Cardapio ctx={ctx} />}
    </>
  )
}

function Importar({ ctx }) {
  const { est, reload, toast } = ctx
  const [arq, setArq] = useState({})
  const [busy, setBusy] = useState(false)
  const ler = async (files) => {
    const out = { ...arq }
    for (const file of files) {
      const t = await lerTexto(file)
      if (/Estoque Atual/i.test(t.slice(0, 300))) out.insumos = { name: file.name, rows: parseEstoqueAtual(t) }
      else if (/Ficha T/i.test(t.slice(0, 300))) out.fichas = { name: file.name, ...parseFichas(t) }
      else toast(`${file.name}: formato não reconhecido.`, 'error')
    }
    setArq(out)
  }
  const go = async () => {
    setBusy(true)
    try {
      const existentes = new Set(est.insumos.map((i) => i.codigo))
      const conhecidos = new Set([...existentes, ...(arq.insumos?.rows || []).map((i) => i.codigo)])
      const linhas = (arq.fichas?.linhas || []).filter((l) => conhecidos.has(l.insumo_codigo))
      await api.estImport3lm({ insumos: arq.insumos?.rows || [], existentes, pratos: arq.fichas?.pratos || [], linhas })
      await reload(); setArq({}); toast('Cadastro importado.')
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="card">
      <div className="card-head"><div><h3>Importar da 3LM</h3><p>Na 3LM Estoque, abra <b>Relatórios → Produtos → Estoque Atual</b> e <b>Relatórios → Fichas Técnicas</b>, clique em Visualizar e depois em <b>Exportar Delimitador</b>. Importe os dois arquivos aqui. O saldo da 3LM não é usado: só nome, unidade, categoria, preços e fichas.</p></div></div>
      <div className="stack" style={{ padding: '0 16px 16px' }}>
        <input type="file" accept=".txt,.csv,text/plain,text/csv" multiple onChange={(e) => ler([...e.target.files])} />
        {arq.insumos && <div className="note"><CheckCircle2 size={16} /><span><strong>{arq.insumos.name}</strong>: {arq.insumos.rows.length} insumos ({arq.insumos.rows.filter((i) => !est.insumos.some((x) => x.codigo === i.codigo)).length} novos). Novos entram ativos se forem de categorias de consumo; os que já existem mantêm ativo, mínimo e tolerância.</span></div>}
        {arq.fichas && <div className="note"><CheckCircle2 size={16} /><span><strong>{arq.fichas.name}</strong>: {arq.fichas.pratos.length} itens do cardápio, {arq.fichas.linhas.length} linhas de ficha técnica. As fichas desses itens são substituídas.</span></div>}
        <div><button className="btn primary" disabled={busy || (!arq.insumos && !arq.fichas)} onClick={go}><Upload />{busy ? 'Importando…' : 'Importar'}</button></div>
      </div>
    </div>
  )
}

function Insumos({ ctx }) {
  const { est, reload, toast } = ctx
  const [cat, setCat] = useState('')
  const [busca, setBusca] = useState('')
  const cats = [...new Set(est.insumos.map((i) => i.categoria))].sort()
  const q = busca.trim().toLowerCase()
  const rows = est.insumos.filter((i) => (!cat || i.categoria === cat) && (!q || i.nome.toLowerCase().includes(q))).sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nome.localeCompare(b.nome))
  const save = async (i, patch) => { try { await api.estSaveInsumo(i.codigo, patch); await reload() } catch (e) { toast(e.message, 'error') } }
  const num = (v) => Number(String(v).replace(',', '.')) || 0
  const ativarCat = async (on) => { for (const i of rows.filter((r) => r.ativo !== on)) await api.estSaveInsumo(i.codigo, { ativo: on }); reload() }
  const [novo, setNovo] = useState(null)
  const criar = async () => {
    const nome = (novo.nome || '').trim().toUpperCase(); const codigo = (novo.codigo || '').trim() || `M${Date.now().toString(36).toUpperCase()}`
    if (!nome) { toast('Informe o nome do insumo.', 'error'); return }
    if (est.insumos.some((i) => i.codigo === codigo)) { toast('Já existe um insumo com esse código.', 'error'); return }
    try {
      await api.estAddInsumo({ codigo, nome, unidade: novo.unidade || 'UND', categoria: novo.categoria || 'SECOS', ativo: true, preco_medio: num(novo.preco), preco_ultimo: num(novo.preco), litros: /^BIB\b/i.test(nome) ? (num(novo.litros) || null) : null })
      await reload(); setNovo(null); toast('Insumo cadastrado.')
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="card">
      {novo && <Modal title="Novo insumo" onClose={() => setNovo(null)} footer={<><button className="btn" onClick={() => setNovo(null)}>Cancelar</button><button className="btn primary" onClick={criar}>Cadastrar</button></>}>
        <div className="stack">
          <label className="field"><span>Nome</span><input className="input" value={novo.nome || ''} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} autoFocus /></label>
          <div className="row-2">
            <label className="field"><span>Unidade</span><select className="select" value={novo.unidade || 'UND'} onChange={(e) => setNovo({ ...novo, unidade: e.target.value })}>{['UND', 'KG', 'LT', 'PCT', 'CX'].map((u) => <option key={u}>{u}</option>)}</select></label>
            <label className="field"><span>Categoria</span><select className="select" value={novo.categoria || 'SECOS'} onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}>{cats.map((c) => <option key={c} value={c}>{catBonita(c)}</option>)}</select></label>
          </div>
          <div className="row-2">
            <label className="field"><span>Código na 3LM (se já existir)</span><input className="input" value={novo.codigo || ''} onChange={(e) => setNovo({ ...novo, codigo: e.target.value })} placeholder="Deixe vazio se não tiver" /></label>
            <label className="field"><span>Custo por unidade (R$)</span><input className="input" inputMode="decimal" value={novo.preco || ''} onChange={(e) => setNovo({ ...novo, preco: e.target.value })} placeholder="0,00" /></label>
          </div>
          {/^BIB\b/i.test(novo.nome || '') && <label className="field"><span>Litros do bag</span><input className="input" inputMode="decimal" value={novo.litros || ''} onChange={(e) => setNovo({ ...novo, litros: e.target.value })} /></label>}
          <p className="hint" style={{ margin: 0 }}>Use o mesmo código da 3LM quando o insumo já estiver cadastrado lá: assim a próxima importação atualiza este item em vez de criar outro.</p>
        </div>
      </Modal>}
      <div className="card-head"><div><h3>Insumos</h3><p>Só os <b>ativos</b> aparecem na lista e na contagem. Tolerância é o desvio aceito na contagem antes de marcar o item em vermelho.</p></div></div>
      <div className="filters fin-filters">
        <label className="search-box"><Search size={15} /><input className="input" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
        <select className="select" style={{ width: 210 }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas as categorias</option>{cats.map((x) => <option key={x} value={x}>{catBonita(x)}</option>)}</select>
        {cat && <><button className="btn sm" onClick={() => ativarCat(true)}>Ativar a categoria</button><button className="btn sm" onClick={() => ativarCat(false)}>Desativar a categoria</button></>}
        <span className="muted" style={{ fontSize: 13 }}>{est.insumos.filter((i) => i.ativo).length} ativos de {est.insumos.length}</span>
        <span className="spacer" /><button className="btn sm primary" onClick={() => setNovo({ categoria: cat || 'SECOS' })}><Plus />Novo insumo</button>
      </div>
      <div className="table-wrap" style={{ maxHeight: '64vh' }}>
        <table className="data">
          <thead><tr><th>Ativo</th><th>Insumo</th><th className="hide-sm">Categoria</th><th>Un.</th><th className="num">Mínimo</th><th className="num">Tolerância %</th><th className="num hide-sm">Litros (bag)</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.codigo} className={i.ativo ? '' : 'is-off'}>
                <td><input type="checkbox" className="check" checked={!!i.ativo} onChange={(e) => save(i, { ativo: e.target.checked })} aria-label={`Ativar ${i.nome}`} /></td>
                <td><strong>{nomeBonito(i.nome)}</strong> <small className="muted">{i.codigo}</small></td>
                <td className="hide-sm muted">{catBonita(i.categoria)}</td>
                <td>{i.unidade}</td>
                <td className="num"><input className="input est-mini" inputMode="decimal" defaultValue={i.estoque_min || ''} placeholder="0" onBlur={(e) => num(e.target.value) !== Number(i.estoque_min || 0) && save(i, { estoque_min: num(e.target.value) })} /></td>
                <td className="num"><input className="input est-mini" inputMode="decimal" defaultValue={String((i.tolerancia ?? 0.03) * 100).replace('.', ',')} onBlur={(e) => num(e.target.value) / 100 !== Number(i.tolerancia ?? 0.03) && save(i, { tolerancia: num(e.target.value) / 100 })} /></td>
                <td className="num hide-sm">{/^BIB\b/i.test(i.nome) ? <input className="input est-mini" inputMode="decimal" defaultValue={i.litros || ''} onBlur={(e) => num(e.target.value) !== Number(i.litros || 0) && save(i, { litros: num(e.target.value) || null })} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FichasProducao({ ctx }) {
  const { est, reload, toast } = ctx
  const proc = est.insumos.filter((i) => i.categoria === 'PROCESSADOS' && i.ativo).sort((a, b) => a.nome.localeCompare(b.nome))
  const [sel, setSel] = useState(proc[0]?.codigo || '')
  const [linhas, setLinhas] = useState([])
  useEffect(() => { setLinhas(est.fichasProd.filter((f) => f.processado_codigo === sel).map((f) => ({ insumo_codigo: f.insumo_codigo, qtd: String(f.qtd).replace('.', ',') }))) }, [sel, est.fichasProd])
  const brutos = est.insumos.filter((i) => i.ativo && i.codigo !== sel).sort((a, b) => a.nome.localeCompare(b.nome))
  const p = est.insumos.find((i) => i.codigo === sel)
  const custo = linhas.reduce((t, l) => t + (Number(String(l.qtd).replace(',', '.')) || 0) * (ctx.calc.preco(est.insumos.find((i) => i.codigo === l.insumo_codigo) || {}) || 0), 0)
  const salvar = async () => {
    const ok = linhas.filter((l) => l.insumo_codigo && Number(String(l.qtd).replace(',', '.')) > 0).map((l) => ({ insumo_codigo: l.insumo_codigo, qtd: Number(String(l.qtd).replace(',', '.')) }))
    try { await api.estSaveFichaProducao(sel, ok); await reload(); toast('Ficha de produção salva.') } catch (e) { toast(e.message, 'error') }
  }
  return (
    <div className="card">
      <div className="card-head"><div><h3>Fichas de produção</h3><p>Quanto de cada insumo vai em <b>1 {p?.unidade || 'unidade'}</b> do processado. Ao registrar uma produção, o painel baixa esses insumos e soma o processado.</p></div></div>
      <div className="est-prod">
        <div className="est-prod-list">
          {proc.map((i) => { const n = est.fichasProd.filter((f) => f.processado_codigo === i.codigo).length; return (
            <button key={i.codigo} className={sel === i.codigo ? 'on' : ''} onClick={() => setSel(i.codigo)}>{nomeBonito(i.nome)}{n ? <small>{n} itens</small> : <small className="txt-danger">sem ficha</small>}</button>) })}
        </div>
        {p && <div className="est-prod-edit">
          <h4>1 {p.unidade} de {nomeBonito(p.nome)}</h4>
          {linhas.map((l, k) => (
            <div key={k} className="est-prod-row">
              <select className="select" value={l.insumo_codigo} onChange={(e) => setLinhas((x) => x.map((y, j) => (j === k ? { ...y, insumo_codigo: e.target.value } : y)))}>
                <option value="">Insumo…</option>{brutos.map((i) => <option key={i.codigo} value={i.codigo}>{nomeBonito(i.nome)} ({i.unidade})</option>)}
              </select>
              <input className="input" inputMode="decimal" style={{ width: 110 }} value={l.qtd} placeholder="0" onChange={(e) => setLinhas((x) => x.map((y, j) => (j === k ? { ...y, qtd: e.target.value } : y)))} />
              <button className="btn ghost icon" aria-label="Remover" onClick={() => setLinhas((x) => x.filter((_, j) => j !== k))}><Trash2 /></button>
            </div>
          ))}
          <div className="fin-actions">
            <button className="btn sm" onClick={() => setLinhas((x) => [...x, { insumo_codigo: '', qtd: '' }])}><Plus />Insumo</button>
            <button className="btn sm primary" onClick={salvar}>Salvar ficha</button>
            <span className="muted">Custo por {p.unidade}: <b>{money(custo)}</b></span>
          </div>
        </div>}
        {!proc.length && <p className="hint" style={{ padding: 16 }}>Nenhum processado ativo.</p>}
      </div>
    </div>
  )
}

function TransfMap({ ctx }) {
  const { est, reload, toast } = ctx
  const [prods, setProds] = useState(null)
  useEffect(() => { api.estProdutosTransf().then(setProds).catch((e) => toast(e.message, 'error')) }, [])
  const map = new Map(est.transfMap.map((m) => [m.product_name, m]))
  const ativos = est.insumos.filter((i) => i.ativo).sort((a, b) => a.nome.localeCompare(b.nome))
  const save = async (p, insumo, fator) => { try { await api.estSaveTransfMap(p, insumo, fator); await reload() } catch (e) { toast(e.message, 'error') } }
  if (!prods) return <div className="card empty"><div className="spinner" /></div>
  return (
    <div className="card">
      <div className="card-head"><div><h3>Transferências para os hubs</h3><p>Ligue cada produto do painel de Transferências ao insumo do estoque. Depois disso, toda transferência que sai da loja baixa o estoque sozinha e fica fora do CMV da loja. O fator converte a unidade (ex.: 1 balde = 3 kg → fator 3).</p></div></div>
      <div className="table-wrap" style={{ maxHeight: '64vh' }}>
        <table className="data">
          <thead><tr><th>Produto na transferência</th><th className="num hide-sm">Já transferido</th><th>Insumo do estoque</th><th className="num">Fator</th></tr></thead>
          <tbody>
            {prods.sort((a, b) => a.product_name.localeCompare(b.product_name)).map((p) => { const m = map.get(p.product_name); return (
              <tr key={p.product_name}>
                <td><strong>{p.product_name}</strong> {m ? <Link2 size={13} className="txt-good" /> : null}</td>
                <td className="num hide-sm">{qf(p.qtd)} {p.unit}</td>
                <td><select className="select" style={{ maxWidth: 280 }} value={m?.insumo_codigo || ''} onChange={(e) => save(p.product_name, e.target.value, m?.fator || 1)}>
                  <option value="">Não ligado</option>{ativos.map((i) => <option key={i.codigo} value={i.codigo}>{nomeBonito(i.nome)} ({i.unidade})</option>)}
                </select></td>
                <td className="num"><input className="input est-mini" inputMode="decimal" disabled={!m} defaultValue={m ? String(m.fator).replace('.', ',') : ''} key={m?.insumo_codigo || 'x'}
                  onBlur={(e) => { const f = Number(String(e.target.value).replace(',', '.')) || 1; if (m && f !== m.fator) save(p.product_name, m.insumo_codigo, f) }} /></td>
              </tr>) })}
            {!prods.length && <tr><td colSpan={4}><div className="empty"><Inbox /><div>Nenhuma transferência registrada.</div></div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Cardapio({ ctx }) {
  const { est, calc, reload, toast } = ctx
  const ins = new Map(est.insumos.map((i) => [i.codigo, i]))
  const vendidos = new Map(); est.vendas.forEach((v) => vendidos.set(v.codigo, (vendidos.get(v.codigo) || 0) + v.qtd))
  const rows = est.pratos.map((p) => {
    const f = est.fichas.filter((x) => x.produto_codigo === p.codigo)
    const custo = f.reduce((t, x) => t + x.qtd * (ins.get(x.insumo_codigo) ? calc.preco(ins.get(x.insumo_codigo)) : 0), 0)
    return { ...p, itens: f.length, custo, cmv: p.preco_venda > 0 ? custo / p.preco_venda : null, vendidos: vendidos.get(p.codigo) || 0 }
  }).sort((a, b) => b.vendidos - a.vendidos || a.nome.localeCompare(b.nome))
  const save = async (p, patch) => { try { await api.estSavePrato(p.codigo, patch); await reload() } catch (e) { toast(e.message, 'error') } }
  const [edit, setEdit] = useState(null)
  return (
    <>
      {calc.semFicha.length > 0 && <div className="note warn" style={{ marginBottom: 12 }}><AlertTriangle size={16} /><span><strong>Vendidos sem ficha técnica</strong> (não baixam nada do estoque). Clique para cadastrar: {calc.semFicha.map((s, k) => <React.Fragment key={s.codigo}>{k ? ', ' : ''}<button className="link" onClick={() => setEdit({ codigo: s.codigo, nome: s.nome, secao: '', preco_venda: 0, novo: s.novo })}>{nomeBonito(s.nome)} ({qf(s.qtd)})</button></React.Fragment>)}. Ou cadastre na 3LM e importe de novo.</span></div>}
      {edit && <FichaEditor ctx={ctx} prato={edit} onClose={() => setEdit(null)} />}
      <div className="card">
        <div className="card-head"><div><h3>Cardápio e fichas técnicas</h3><p>Fichas importadas da 3LM ou cadastradas aqui. Clique num item para editar a ficha. O custo usa o preço médio dos insumos. Marque como <b>estratégico</b> o que fica no cardápio por posicionamento, mesmo com margem baixa.</p></div>
          <button className="btn sm primary" onClick={() => setEdit({ codigo: '', nome: '', secao: '', preco_venda: '', novo: true })}><Plus />Novo item</button></div>
        <div className="table-wrap" style={{ maxHeight: '64vh' }}>
          <table className="data">
            <thead><tr><th>Item</th><th className="hide-sm">Seção</th><th className="num hide-sm">Vendidos desde {dateBR(EST_INICIO).slice(0, 5)}</th><th className="num">Preço</th><th className="num">Custo</th><th className="num">CMV</th><th>Estratégico</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.codigo} className="est-row" onClick={(e) => { if (!e.target.closest('input')) setEdit(p) }}>
                  <td><strong>{nomeBonito(p.nome)}</strong> <small className="muted">{p.codigo} · {p.itens ? `${p.itens} insumos` : <span className="txt-danger">sem ficha</span>}</small></td>
                  <td className="hide-sm muted">{nomeBonito(p.secao)}</td>
                  <td className="num hide-sm">{qf(p.vendidos)}</td>
                  <td className="num">{money(p.preco_venda)}</td>
                  <td className="num">{money(p.custo)}</td>
                  <td className={`num ${p.cmv > 0.4 ? 'txt-danger' : p.cmv != null && p.cmv < 0.3 ? 'txt-good' : ''}`}>{pct(p.cmv)}</td>
                  <td><input type="checkbox" className="check" checked={!!p.estrategico} onChange={(e) => save(p, { estrategico: e.target.checked })} aria-label={`Estratégico: ${p.nome}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function FichaEditor({ ctx, prato, onClose }) {
  const { est, calc, reload, toast } = ctx
  const [f, setF] = useState({ codigo: prato.codigo || '', nome: prato.nome || '', secao: prato.secao || '', preco: prato.preco_venda ? String(prato.preco_venda).replace('.', ',') : '' })
  const [linhas, setLinhas] = useState(() => est.fichas.filter((x) => x.produto_codigo === prato.codigo).map((x) => ({ insumo_codigo: x.insumo_codigo, qtd: String(x.qtd).replace('.', ',') })))
  const [busy, setBusy] = useState(false)
  const existe = est.pratos.some((p) => p.codigo === prato.codigo)
  const ins = est.insumos.filter((i) => i.ativo).sort((a, b) => a.nome.localeCompare(b.nome))
  const n = (v) => Number(String(v).replace(',', '.')) || 0
  const custo = linhas.reduce((t, l) => { const i = est.insumos.find((x) => x.codigo === l.insumo_codigo); return t + n(l.qtd) * (i ? calc.preco(i) : 0) }, 0)
  const salvar = async () => {
    const codigo = f.codigo.trim()
    if (!codigo || !f.nome.trim()) { toast('Informe o código (o mesmo da venda na 3LM) e o nome.', 'error'); return }
    if (!existe && est.pratos.some((p) => p.codigo === codigo)) { toast('Já existe um item com esse código.', 'error'); return }
    setBusy(true)
    try {
      await api.estUpsertPrato({ codigo, nome: f.nome.trim().toUpperCase(), secao: f.secao.trim().toUpperCase() || null, preco_venda: n(f.preco) })
      await api.estSaveFicha(codigo, linhas.filter((l) => l.insumo_codigo && n(l.qtd) > 0).map((l) => ({ insumo_codigo: l.insumo_codigo, qtd: n(l.qtd) })))
      await reload(); toast('Ficha técnica salva.'); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={existe ? `Ficha técnica · ${nomeBonito(prato.nome)}` : 'Novo item do cardápio'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar ficha'}</button></>}>
      <div className="stack">
        <div className="row-2">
          <label className="field"><span>Código na 3LM (o mesmo das vendas)</span><input className="input" value={f.codigo} disabled={existe} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></label>
          <label className="field"><span>Nome</span><input className="input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
        </div>
        <div className="row-2">
          <label className="field"><span>Seção</span><input className="input" value={f.secao} onChange={(e) => setF({ ...f, secao: e.target.value })} placeholder="Burgers, Bebidas…" /></label>
          <label className="field"><span>Preço de venda (R$)</span><input className="input" inputMode="decimal" value={f.preco} onChange={(e) => setF({ ...f, preco: e.target.value })} /></label>
        </div>
        <div><strong style={{ fontSize: 13 }}>1 unidade vendida consome:</strong></div>
        {linhas.map((l, k) => (
          <div key={k} className="est-prod-row">
            <select className="select" value={l.insumo_codigo} onChange={(e) => setLinhas((x) => x.map((y, j) => (j === k ? { ...y, insumo_codigo: e.target.value } : y)))}>
              <option value="">Insumo…</option>{ins.map((i) => <option key={i.codigo} value={i.codigo}>{nomeBonito(i.nome)} ({i.unidade})</option>)}
            </select>
            <input className="input" inputMode="decimal" style={{ width: 110 }} value={l.qtd} placeholder="0" onChange={(e) => setLinhas((x) => x.map((y, j) => (j === k ? { ...y, qtd: e.target.value } : y)))} />
            <button className="btn ghost icon" aria-label="Remover" onClick={() => setLinhas((x) => x.filter((_, j) => j !== k))}><Trash2 /></button>
          </div>
        ))}
        <div className="fin-actions">
          <button className="btn sm" onClick={() => setLinhas((x) => [...x, { insumo_codigo: '', qtd: '' }])}><Plus />Insumo</button>
          <span className="muted">Custo: <b>{money(custo)}</b>{n(f.preco) > 0 ? <> · CMV <b>{pct(custo / n(f.preco))}</b></> : null}</span>
        </div>
        <p className="hint" style={{ margin: 0 }}>Quantidade na unidade do insumo (ex.: 0,1 KG de carne = 100 g). Se a ficha for importada da 3LM depois, ela substitui esta.</p>
      </div>
    </Modal>
  )
}

// =====================================================================
// Relatório de CMV (teórico: ficha técnica × preço médio dos insumos)
// =====================================================================
const CMV_PRESETS = [['mes', 'Este mês'], ['d0', 'Desde a contagem'], ['7d', '7 dias'], ['mespassado', 'Mês passado']]
const lerPromo = () => { try { const v = JSON.parse(localStorage.getItem('yb-cmv-promo') || 'null'); return Array.isArray(v) ? v : PROMO_PADRAO } catch { return PROMO_PADRAO } }

function Cmv({ ctx }) {
  const { est, calc, store, hoje, toast } = ctx
  const fin = store.fin
  const [preset, setPreset] = useState('mes')
  const [range, setRange] = useState(null)
  const [incluir, setIncluir] = useState({ eventos: false, hub: false, promo: false })
  const [promo, setPromo] = useState(lerPromo)
  const [promoTxt, setPromoTxt] = useState(() => lerPromo().join(', '))
  const [sort, setSort] = useState({ key: 'custo', dir: 'desc' })
  const ultimoVenda = est.vendas.reduce((mx, v) => (v.dia > mx ? v.dia : mx), '') || hoje
  const presetRange = (k) => {
    const [y, m] = ultimoVenda.split('-').map(Number)
    if (k === 'd0' && calc.d0) return [addDias(calc.d0.corte, 1), ultimoVenda]
    if (k === '7d') return [addDias(ultimoVenda, -6), ultimoVenda]
    if (k === 'mespassado') { const a = new Date(y, m - 2, 1); const b = new Date(y, m - 1, 0); const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return [iso(a), iso(b)] }
    return [`${ultimoVenda.slice(0, 7)}-01`, ultimoVenda]
  }
  const [de, ate] = range || presetRange(preset)
  const R = useMemo(() => cmvRelatorio({ est, fin, transfers: store.transfers, units: store.units, de, ate, promo }), [est, fin, store.transfers, store.units, de, ate, promo])
  const completo = totalCmv(R.grupos, { eventos: true, hub: true, promo: true })
  const filtrado = totalCmv(R.grupos, incluir)
  const comR = !!fin
  const savePromo = () => {
    const v = promoTxt.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean)
    setPromo(v); try { localStorage.setItem('yb-cmv-promo', JSON.stringify(v)) } catch { /* */ }
  }
  const val = (r) => (sort.key === 'nome' ? nomeBonito(r.nome) : r[sort.key])
  const prods = [...R.produtos].sort((a, b) => { const x = val(a); const y = val(b); if (x == null) return 1; if (y == null) return -1; const c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y; return sort.dir === 'asc' ? c : -c })
  const setD = (i, v) => { if (!v) return; const n = [de, ate]; n[i] = v; if (n[0] > n[1]) n[1 - i] = v; setRange(n); setPreset('') }
  const incl = (g) => g.key === 'loja' || g.key === 'perdas' || incluir[g.key]
  const fora = ['eventos', 'hub', 'promo'].filter((k) => !incluir[k]).map((k) => ({ eventos: 'eventos', hub: 'envios aos hubs', promo: 'N1 promo' }[k]))

  const exp = (formato, versao) => {
    const inc = versao === 'completo' ? { eventos: true, hub: true, promo: true } : incluir
    const t = totalCmv(R.grupos, inc)
    const gs = R.grupos.filter((g) => g.key === 'loja' || g.key === 'perdas' || inc[g.key])
    const ps = R.produtos.filter((p) => inc.promo || !p.promo)
    const fx = ['eventos', 'hub', 'promo'].filter((k) => !inc[k]).map((k) => ({ eventos: 'eventos', hub: 'envios aos hubs', promo: 'N1 promo' }[k]))
    return exportar({
      titulo: versao === 'completo' ? 'CMV completo' : 'CMV da loja', arquivo: `cmv_${versao}`,
      subtitulo: `${dateBR(de)} a ${dateBR(ate)}${fx.length ? ` · sem ${fx.join(', ')}` : ' · tudo incluído'}`,
      resumo: [['CMV', t.cmv != null ? pct(t.cmv) : '—'], ['Custo', money(t.custo)], ...(comR ? [['Faturamento', money(t.receita)]] : []), ['CMV completo', completo.cmv != null ? pct(completo.cmv) : '—']],
      colunas: [{ h: 'Origem / produto', w: 34 }, { h: 'Qtd', tipo: 'num' }, ...(comR ? [{ h: 'Faturamento', tipo: 'money' }] : []), { h: 'Custo/un', tipo: 'money' }, { h: 'Custo', tipo: 'money' }, ...(comR ? [{ h: 'CMV', tipo: 'pct' }] : [])],
      linhas: [
        ...gs.map((g) => ({ forte: true, c: [g.nome, null, ...(comR ? [g.receita] : []), null, g.custo, ...(comR ? [g.cmv] : [])] })),
        { forte: true, c: ['Total', null, ...(comR ? [t.receita] : []), null, t.custo, ...(comR ? [t.cmv] : [])] },
        ...ps.map((p) => ({ sub: true, c: [`${nomeBonito(p.nome)}${p.promo ? ' (promo)' : ''}${p.semFicha ? ' (sem ficha)' : ''}`, p.qtd, ...(comR ? [p.receita] : []), p.custoUnit, p.custo, ...(comR ? [p.cmv] : [])] })),
      ],
      notas: ['CMV teórico: quantidade vendida × ficha técnica × preço médio dos insumos. Perdas lançadas entram sempre. Produtos sem ficha técnica ficam com custo zero.'],
    }, formato).catch((e) => toast(e.message, 'error'))
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="filters fin-filters">
          <div className="seg" role="group" aria-label="Período">
            {CMV_PRESETS.filter(([k]) => k !== 'd0' || calc.d0).map(([k, l]) => <button key={k} aria-pressed={preset === k} onClick={() => { setPreset(k); setRange(null) }}>{l}</button>)}
          </div>
          <label className="fin-date">De <input type="date" className="input" value={de} onChange={(e) => setD(0, e.target.value)} /></label>
          <label className="fin-date">Até <input type="date" className="input" value={ate} onChange={(e) => setD(1, e.target.value)} /></label>
          <div style={{ marginLeft: 'auto' }}><ExportMenu onExport={exp} opcoes={[['filtrado', 'Como está na tela'], ['completo', 'Completo (tudo incluído)']]} /></div>
        </div>
        <div className="fin-split cmv-toggles">
          <span className="muted">Incluir no CMV:</span>
          <label className="check-row"><input type="checkbox" className="check" checked={incluir.eventos} onChange={(e) => setIncluir({ ...incluir, eventos: e.target.checked })} /> Eventos</label>
          <label className="check-row"><input type="checkbox" className="check" checked={incluir.hub} onChange={(e) => setIncluir({ ...incluir, hub: e.target.checked })} /> Envio aos hubs (produção)</label>
          <label className="check-row"><input type="checkbox" className="check" checked={incluir.promo} onChange={(e) => setIncluir({ ...incluir, promo: e.target.checked })} /> N1 promo</label>
          <label className="check-row muted">Códigos da promo <input className="input" style={{ width: 110, height: 30 }} value={promoTxt} onChange={(e) => setPromoTxt(e.target.value)} onBlur={savePromo} aria-label="Códigos dos produtos de promoção" /></label>
        </div>
      </div>
      <div className="kpis">
        <Kpi icon={Wallet} label={fora.length ? `CMV sem ${fora.join(', ')}` : 'CMV (tudo incluído)'} value={comR ? pct(filtrado.cmv) : money(filtrado.custo)} sub={comR ? `${money(filtrado.custo)} de custo sobre ${money(filtrado.receita)}` : 'custo teórico no período'} tone="good" />
        <Kpi icon={AlertTriangle} label="CMV completo" value={comR ? pct(completo.cmv) : money(completo.custo)} sub={comR ? 'com eventos, hubs e N1 promo' : 'custo com eventos, hubs e promo'} />
        <Kpi icon={PackageMinus} label="Perdas lançadas" value={money(R.grupos.find((g) => g.key === 'perdas').custo)} sub="entram sempre no CMV" />
        <Kpi icon={CookingPot} label="Vendidos sem ficha" value={R.semFicha.length} sub={R.semFicha.length ? `custo zero: ${R.semFicha.slice(0, 2).map((p) => nomeBonito(p.nome)).join(', ')}` : 'todos com ficha'} tone={R.semFicha.length ? 'warn' : ''} />
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head"><div><h3>CMV por origem</h3><p>Custo teórico: quantidade × ficha técnica × preço médio dos insumos.{!comR && ' O faturamento só aparece para quem tem o Financeiro.'}</p></div></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Origem</th>{comR && <th className="num">Faturamento</th>}<th className="num">Custo</th>{comR && <th className="num">CMV</th>}<th>No CMV</th></tr></thead>
            <tbody>
              {R.grupos.map((g) => (
                <tr key={g.key} className={incl(g) ? '' : 'muted'}>
                  <td><strong>{g.nome}</strong></td>
                  {comR && <td className="num">{g.receita == null ? '—' : money(g.receita)}</td>}
                  <td className="num">{money(g.custo)}</td>
                  {comR && <td className="num">{g.cmv == null ? '—' : pct(g.cmv)}</td>}
                  <td>{incl(g) ? <span className="pill good">incluído</span> : <span className="pill">fora</span>}</td>
                </tr>
              ))}
              <tr className="tot"><td><strong>Total considerado</strong></td>{comR && <td className="num"><strong>{money(filtrado.receita)}</strong></td>}<td className="num"><strong>{money(filtrado.custo)}</strong></td>{comR && <td className="num"><strong>{pct(filtrado.cmv)}</strong></td>}<td /></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h3>Por produto vendido na loja</h3><p>Ordene pelas colunas. Produtos sem ficha técnica ficam com custo zero até a ficha ser cadastrada.</p></div></div>
        <div className="table-wrap" style={{ maxHeight: '60vh' }}>
          <table className="data">
            <thead><tr>
              <SortTh k="nome" sort={sort} setSort={setSort}>Produto</SortTh>
              <SortTh k="qtd" sort={sort} setSort={setSort} className="num">Qtd</SortTh>
              {comR && <SortTh k="receita" sort={sort} setSort={setSort} className="num">Faturamento</SortTh>}
              <SortTh k="custoUnit" sort={sort} setSort={setSort} className="num">Custo/un</SortTh>
              <SortTh k="custo" sort={sort} setSort={setSort} className="num">Custo</SortTh>
              {comR && <SortTh k="cmv" sort={sort} setSort={setSort} className="num">CMV</SortTh>}
            </tr></thead>
            <tbody>
              {prods.map((p) => (
                <tr key={p.codigo} className={p.promo && !incluir.promo ? 'muted' : ''}>
                  <td><strong>{nomeBonito(p.nome)}</strong> <small className="muted">{p.codigo}</small>{p.promo && <span className="pill warn" style={{ marginLeft: 6 }}>promo</span>}{p.semFicha && <span className="pill" style={{ marginLeft: 6 }}>sem ficha</span>}</td>
                  <td className="num">{qf(p.qtd, 1)}</td>
                  {comR && <td className="num">{money(p.receita)}</td>}
                  <td className="num">{p.custoUnit == null ? '—' : money(p.custoUnit)}</td>
                  <td className="num"><strong>{money(p.custo)}</strong></td>
                  {comR && <td className={`num ${p.cmv > 0.35 ? 'txt-danger' : ''}`}>{pct(p.cmv)}</td>}
                </tr>
              ))}
              {!prods.length && <tr><td colSpan={6}><div className="empty"><Inbox /><div>Sem vendas no período.</div></div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
