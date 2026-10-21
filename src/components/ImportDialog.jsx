import React, { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, dateBR } from '../lib/format.js'
import { parseTransfersFile } from '../lib/importer.js'
import { Modal, useToast } from './ui.jsx'

const sig = (t) => `${t.date}|${t.origin_id}|${t.destination_id}|${t.product_name.toLowerCase()}|${Number(t.quantity).toFixed(4)}`

export default function ImportDialog({ store, onClose }) {
  const { units, products, transfers, unitsById } = store
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState('')
  const [skipDupes, setSkipDupes] = useState(true)
  const [createProducts, setCreateProducts] = useState(true)
  const [busy, setBusy] = useState(false)

  async function onFile(f) {
    setFile(f); setErr(''); setParsed(null)
    if (!f) return
    try { setParsed(await parseTransfersFile(f, units, products)) } catch (e) { setErr(e.message) }
  }

  const info = useMemo(() => {
    if (!parsed) return null
    const existing = new Set(transfers.map(sig))
    const dupes = parsed.rows.filter((r) => existing.has(sig(r)))
    const rows = skipDupes ? parsed.rows.filter((r) => !existing.has(sig(r))) : parsed.rows
    const newProducts = [...new Set(rows.filter((r) => !r.product_id).map((r) => r.product_name))]
    const byDest = {}
    rows.forEach((r) => { const k = unitsById[r.destination_id]?.name; byDest[k] = (byDest[k] || 0) + r.quantity * r.unit_price })
    const dates = rows.map((r) => r.date).sort()
    return { rows, dupes: dupes.length, newProducts, byDest, first: dates[0], last: dates[dates.length - 1], total: rows.reduce((s, r) => s + r.quantity * r.unit_price, 0) }
  }, [parsed, skipDupes, transfers])

  async function run() {
    setBusy(true); setErr('')
    try {
      let rows = info.rows
      if (createProducts && info.newProducts.length) {
        const map = {}
        for (const name of info.newProducts) {
          const last = rows.filter((r) => r.product_name === name).sort((a, b) => b.date.localeCompare(a.date))[0]
          const p = await api.saveProduct({ name, price: last.unit_price, unit: 'kg', active: true })
          map[name] = p.id
          store.setProducts((ps) => [...ps, p].sort((a, b) => a.name.localeCompare(b.name)))
        }
        rows = rows.map((r) => (r.product_id ? r : { ...r, product_id: map[r.product_name] || null }))
      }
      const created = await api.createTransfers(rows)
      store.setTransfers((all) => [...created, ...all])
      toast(`${created.length} transferências importadas.`)
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Importar planilha" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={!info?.rows.length || busy} onClick={run}>{busy ? 'Importando…' : info ? `Importar ${info.rows.length} linhas` : 'Importar'}</button>
      </>}>
      <p className="muted" style={{ marginTop: 0 }}>Aceita a planilha <strong>Controle Yankee Hub</strong> (.xlsx, aba “Controle”) ou um CSV com as colunas Data, Origem, Destino, Produto, Quantidade e Valor unitário. “Hubfood - ZS” é importado como HubFood BV.</p>
      <label className="chip-btn" style={{ width: '100%', justifyContent: 'center', height: 64, cursor: 'pointer' }}>
        <Upload />{file ? file.name : 'Escolher arquivo .xlsx ou .csv'}
        <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {info && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <table className="mini-table">
            <tbody>
              <tr><td>Linhas válidas para importar</td><td className="num"><strong>{info.rows.length}</strong></td></tr>
              <tr><td>Período</td><td className="num">{info.first ? `${dateBR(info.first)} a ${dateBR(info.last)}` : '—'}</td></tr>
              {Object.entries(info.byDest).map(([k, v]) => <tr key={k}><td>Destino {k}</td><td className="num">{money(v)}</td></tr>)}
              <tr><td><strong>Valor total</strong></td><td className="num"><strong>{money(info.total)}</strong></td></tr>
            </tbody>
          </table>
          <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={skipDupes} onChange={(e) => setSkipDupes(e.target.checked)} />Ignorar linhas que já existem no sistema ({info.dupes})</label>
          {info.newProducts.length > 0 && <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={createProducts} onChange={(e) => setCreateProducts(e.target.checked)} />Cadastrar {info.newProducts.length} produto(s) novo(s) com o último preço usado</label>}
          {parsed.errors.length > 0 && <details><summary className="muted">{parsed.errors.length} linha(s) ignorada(s) por erro</summary><div className="hint">{parsed.errors.slice(0, 50).map((e) => <div key={e}>{e}</div>)}</div></details>}
        </div>
      )}
      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  )
}
