import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Search, FileDown, FileSpreadsheet, Upload, Pencil, Trash2, ArrowRight, Package, Building2, Check, Clock, X, Inbox } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, qty, dateBR, normalize } from '../lib/format.js'
import { exportCSV, exportPDF } from '../lib/export.js'
import { MultiSelect, DateRangePicker, SortTh, StatusButton, UnitTag, useToast, useConfirm } from '../components/ui.jsx'
import TransferForm from '../components/TransferForm.jsx'
import ImportDialog from '../components/ImportDialog.jsx'

const PAGE_SIZES = [25, 50, 100, 250]
const loadFilters = () => { try { return JSON.parse(sessionStorage.getItem('yankee-filters') || 'null') } catch { return null } }

export default function Transfers({ store }) {
  const { transfers, products, units, unitsById, measureOf, isAdmin, profile } = store
  const toast = useToast()
  const confirm = useConfirm()
  const saved = loadFilters()

  const [q, setQ] = useState(saved?.q || '')
  const [from, setFrom] = useState(saved?.from || '')
  const [to, setTo] = useState(saved?.to || '')
  const [prodSel, setProdSel] = useState(saved?.prodSel || [])
  const [unitSel, setUnitSel] = useState(saved?.unitSel || [])
  const [status, setStatus] = useState(saved?.status || 'all')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [selected, setSelected] = useState(() => new Set())
  const [editing, setEditing] = useState(null) // null | 'new' | transfer
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { try { sessionStorage.setItem('yankee-filters', JSON.stringify({ q, from, to, prodSel, unitSel, status })) } catch { /* */ } }, [q, from, to, prodSel, unitSel, status])
  useEffect(() => setPage(0), [q, from, to, prodSel, unitSel, status, pageSize])

  const unitName = (id) => unitsById[id]?.name || '—'
  const canPay = (t) => isAdmin || t.destination_id === profile.unit_id
  const canEdit = (t) => isAdmin || (t.created_by === profile.id && !t.paid)

  // Opções dos filtros com contagem
  const prodOptions = useMemo(() => {
    const c = new Map()
    transfers.forEach((t) => c.set(t.product_name, (c.get(t.product_name) || 0) + 1))
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, k]) => ({ value: n, label: n, hint: k }))
  }, [transfers])
  const unitOptions = units.filter((u) => u.is_hub).map((u) => ({ value: u.id, label: u.name }))

  const filtered = useMemo(() => {
    const nq = normalize(q)
    const ps = new Set(prodSel), us = new Set(unitSel)
    const rows = transfers.filter((t) =>
      (!from || t.date >= from) && (!to || t.date <= to) &&
      (!ps.size || ps.has(t.product_name)) &&
      (!us.size || us.has(t.destination_id) || us.has(t.origin_id)) &&
      (status === 'all' || (status === 'paid') === t.paid) &&
      (!nq || normalize(`${t.product_name} ${t.notes || ''} ${unitName(t.origin_id)} ${unitName(t.destination_id)}`).includes(nq)))
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (t) => sort.key === 'origin' ? unitName(t.origin_id) : sort.key === 'destination' ? unitName(t.destination_id) : t[sort.key]
    return rows.sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'number' ? x - y : typeof x === 'boolean' ? Number(x) - Number(y) : String(x ?? '').localeCompare(String(y ?? ''))
      return c * dir || b.date.localeCompare(a.date)
    })
  }, [transfers, q, from, to, prodSel, unitSel, status, sort, unitsById])

  const sum = (rows) => rows.reduce((s, t) => s + t.total, 0)
  const totals = useMemo(() => {
    const paid = filtered.filter((t) => t.paid)
    return { n: filtered.length, total: sum(filtered), paid: sum(paid), open: sum(filtered) - sum(paid), kg: filtered.filter((t) => measureOf(t) === 'kg').reduce((s, t) => s + t.quantity, 0), un: filtered.filter((t) => measureOf(t) === 'un').reduce((s, t) => s + t.quantity, 0) }
  }, [filtered])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize)

  // Seleção
  const selRows = filtered.filter((t) => selected.has(t.id))
  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))
  const somePage = pageRows.some((t) => selected.has(t.id))
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAllFiltered = () => setSelected(new Set(filtered.map((t) => t.id)))
  const clearSel = () => setSelected(new Set())
  const togglePage = () => setSelected((s) => { const n = new Set(s); const allOn = pageRows.every((t) => n.has(t.id)); pageRows.forEach((t) => (allOn ? n.delete(t.id) : n.add(t.id))); return n })

  const hasFilters = q || from || to || prodSel.length || unitSel.length || status !== 'all'
  const clearFilters = () => { setQ(''); setFrom(''); setTo(''); setProdSel([]); setUnitSel([]); setStatus('all') }

  async function markPaid(rows, value) {
    const ids = rows.filter((t) => t.paid !== value && canPay(t)).map((t) => t.id)
    const blocked = rows.filter((t) => t.paid !== value && !canPay(t)).length
    if (!ids.length) { toast(blocked ? 'Você só pode alterar o pagamento do que a sua unidade recebeu.' : `Já ${value ? 'estão pagas' : 'estão em aberto'}.`, blocked ? 'error' : 'ok'); return }
    if (ids.length > 1) {
      const val = sum(rows.filter((t) => ids.includes(t.id)))
      const ok = await confirm({ title: value ? 'Marcar como pago' : 'Voltar para em aberto', message: `${ids.length} transferências · ${money(val)}. Confirmar?`, ok: value ? 'Marcar como pago' : 'Marcar em aberto' })
      if (!ok) return
    }
    setBusy(true)
    try {
      await api.setPaid(ids, value)
      const s = new Set(ids), now = new Date().toISOString()
      store.setTransfers((all) => all.map((t) => (s.has(t.id) ? { ...t, paid: value, paid_at: value ? now : null } : t)))
      toast(`${ids.length} ${ids.length === 1 ? 'transferência marcada' : 'transferências marcadas'} como ${value ? 'paga' : 'em aberto'}${blocked ? ` · ${blocked} sem permissão` : ''}`)
      if (rows.length > 1) clearSel()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  async function remove(rows) {
    const allowed = rows.filter(canEdit)
    if (!allowed.length) { toast('Sem permissão para excluir essas transferências.', 'error'); return }
    const ok = await confirm({ title: 'Excluir transferências', message: `Excluir ${allowed.length} ${allowed.length === 1 ? 'transferência' : 'transferências'} (${money(sum(allowed))})? Essa ação não pode ser desfeita.`, ok: 'Excluir', danger: true })
    if (!ok) return
    try {
      await api.deleteTransfers(allowed.map((t) => t.id))
      const s = new Set(allowed.map((t) => t.id))
      store.setTransfers((all) => all.filter((t) => !s.has(t.id)))
      setSelected((sel) => { const n = new Set(sel); s.forEach((id) => n.delete(id)); return n })
      toast('Excluído.')
    } catch (e) { toast(e.message, 'error') }
  }

  const filterDesc = () => {
    const parts = []
    if (from || to) parts.push(`Período: ${from ? dateBR(from) : 'início'} a ${to ? dateBR(to) : 'hoje'}`)
    if (unitSel.length) parts.push(`Unidade: ${unitSel.map(unitName).join(', ')}`)
    if (status !== 'all') parts.push(status === 'paid' ? 'Somente pagos' : 'Somente em aberto')
    if (prodSel.length) parts.push(`Produtos: ${prodSel.length <= 4 ? prodSel.join(', ') : `${prodSel.length} selecionados`}`)
    if (q) parts.push(`Busca: "${q}"`)
    return parts.join('  ·  ')
  }
  const exportRows = selRows.length ? selRows : filtered

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transferências</h1>
          <p>{isAdmin ? 'Todas as movimentações entre a Yankee e os HubFood.' : `Movimentações da ${unitName(profile.unit_id)}.`}</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => exportCSV(exportRows, unitName, measureOf)} title={selRows.length ? 'Exporta as selecionadas' : 'Exporta o resultado do filtro'}><FileSpreadsheet />CSV{selRows.length ? ` (${selRows.length})` : ''}</button>
          <button className="btn" onClick={() => exportPDF(exportRows, unitName, { subtitle: filterDesc(), measureOf })}><FileDown />PDF{selRows.length ? ` (${selRows.length})` : ''}</button>
          {isAdmin && <button className="btn" onClick={() => setImporting(true)}><Upload />Importar planilha</button>}
          <button className="btn primary" onClick={() => setEditing('new')}><Plus />Nova transferência</button>
        </div>
      </div>

      <div className="card">
        <div className="filters">
          <div className="input-icon"><Search /><input className="input" placeholder="Buscar produto, observação…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <DateRangePicker from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
          <MultiSelect label="Produtos" icon={Package} options={prodOptions} value={prodSel} onChange={setProdSel} />
          {isAdmin && <MultiSelect label="Unidade" icon={Building2} options={unitOptions} value={unitSel} onChange={setUnitSel} />}
          <div className="seg" role="group" aria-label="Status de pagamento">
            {[['all', 'Todos'], ['open', 'Em aberto'], ['paid', 'Pagos']].map(([k, l]) => <button key={k} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          {hasFilters ? <button className="clear-link" onClick={clearFilters}>Limpar filtros</button> : null}
          <div className="grow" />
          <button className="btn sm" onClick={allFilteredSelected ? clearSel : selectAllFiltered} disabled={!filtered.length}>
            <Check />{allFilteredSelected ? 'Desmarcar tudo' : `Selecionar tudo (${filtered.length})`}
          </button>
        </div>

        <div className="summary">
          <div><small>Transferências</small><strong>{totals.n.toLocaleString('pt-BR')}</strong></div>
          <div><small>Quantidade</small><strong title="Soma separada por unidade de medida">{qty(totals.kg)} kg · {qty(totals.un)} un</strong></div>
          <div><small>Valor total</small><strong>{money(totals.total)}</strong></div>
          <div><small>Pago</small><strong className="good">{money(totals.paid)}</strong></div>
          <div><small>Em aberto</small><strong className="warn">{money(totals.open)}</strong></div>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="w-check">
                  <input type="checkbox" className="check" aria-label="Selecionar página" checked={pageRows.length > 0 && pageRows.every((t) => selected.has(t.id))}
                    ref={(el) => { if (el) el.indeterminate = somePage && !pageRows.every((t) => selected.has(t.id)) }} onChange={togglePage} />
                </th>
                <SortTh k="date" sort={sort} setSort={setSort}>Data</SortTh>
                <SortTh k="origin" sort={sort} setSort={setSort}>Origem</SortTh>
                <SortTh k="destination" sort={sort} setSort={setSort}>Destino</SortTh>
                <SortTh k="product_name" sort={sort} setSort={setSort}>Produto</SortTh>
                <SortTh k="quantity" sort={sort} setSort={setSort} className="num">Qtd</SortTh>
                <SortTh k="unit_price" sort={sort} setSort={setSort} className="num">Valor unit.</SortTh>
                <SortTh k="total" sort={sort} setSort={setSort} className="num">Valor total</SortTh>
                <SortTh k="paid" sort={sort} setSort={setSort}>Pagamento</SortTh>
                <th style={{ width: 70 }}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id} className={selected.has(t.id) ? 'selected' : ''}>
                  <td className="w-check"><input type="checkbox" className="check" aria-label={`Selecionar ${t.product_name}`} checked={selected.has(t.id)} onChange={() => toggleOne(t.id)} /></td>
                  <td className="num" style={{ textAlign: 'left' }}>{dateBR(t.date)}</td>
                  <td><UnitTag unit={unitsById[t.origin_id]} /></td>
                  <td><UnitTag unit={unitsById[t.destination_id]} /></td>
                  <td className="prod-cell">{t.product_name}{t.notes && <small title={t.notes}>{t.notes}</small>}</td>
                  <td className="num">{qty(t.quantity)} <span className="muted" style={{ fontSize: 12 }}>{measureOf(t)}</span></td>
                  <td className="num">{money(t.unit_price)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{money(t.total)}</td>
                  <td><StatusButton paid={t.paid} disabled={!canPay(t) || busy} onClick={() => markPaid([t], !t.paid)} /></td>
                  <td>
                    {canEdit(t) && <div className="row-actions">
                      <button className="btn ghost icon" aria-label="Editar" title="Editar" onClick={() => setEditing(t)}><Pencil /></button>
                      <button className="btn ghost icon" aria-label="Excluir" title="Excluir" onClick={() => remove([t])}><Trash2 /></button>
                    </div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty"><Inbox /><div>{transfers.length ? 'Nenhuma transferência com esses filtros.' : 'Nenhuma transferência lançada ainda.'}</div></div>}
        </div>

        <div className="pager">
          <span>{filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} de ${filtered.length.toLocaleString('pt-BR')}` : '0 resultados'}</span>
          <div className="pg">
            <select className="select" style={{ width: 'auto', height: 30 }} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Linhas por página">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} por página</option>)}
            </select>
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <span>{page + 1} / {pages}</span>
            <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Próxima</button>
          </div>
        </div>
      </div>

      {selRows.length > 0 && (
        <div className="selbar" role="region" aria-label="Ações em lote">
          <span className="info"><strong>{selRows.length}</strong> selecionada{selRows.length > 1 ? 's' : ''} · {money(sum(selRows))}</span>
          {!allFilteredSelected && <button className="btn sm" onClick={selectAllFiltered}>Selecionar todas do filtro ({filtered.length})</button>}
          <span className="sep" />
          <button className="btn sm good" disabled={busy} onClick={() => markPaid(selRows, true)}><Check />Marcar pago</button>
          <button className="btn sm" disabled={busy} onClick={() => markPaid(selRows, false)}><Clock />Em aberto</button>
          {isAdmin && <button className="btn sm" onClick={() => remove(selRows)}><Trash2 />Excluir</button>}
          <button className="btn sm icon" onClick={clearSel} aria-label="Limpar seleção"><X /></button>
        </div>
      )}

      {editing && <TransferForm store={store} transfer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog store={store} onClose={() => setImporting(false)} />}
    </>
  )
}
