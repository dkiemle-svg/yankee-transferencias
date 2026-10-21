import React, { useMemo, useState } from 'react'
import { Plus, Trash2, ArrowRight } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, today, parseNum, lineTotal, round2 } from '../lib/format.js'
import { Modal, ProductCombo, useToast } from './ui.jsx'

const emptyLine = () => ({ key: Math.random(), product: null, quantity: '', unit_price: '', notes: '' })

export default function TransferForm({ store, transfer, onClose }) {
  const { units, products, isAdmin, profile } = store
  const toast = useToast()
  const editing = !!transfer
  const yankee = units.find((u) => u.code === 'YANKEE') || units[0]
  const hubs = units.filter((u) => u.is_hub)
  const myUnit = profile.unit_id

  const [origin, setOrigin] = useState(transfer?.origin_id || yankee?.id || '')
  const [destination, setDestination] = useState(transfer?.destination_id || (isAdmin ? hubs[0]?.id : myUnit) || '')
  const [date, setDate] = useState(transfer?.date || today())
  const [lines, setLines] = useState(() => editing
    ? [{ key: 1, product: products.find((p) => p.id === transfer.product_id) || { id: null, name: transfer.product_name, price: transfer.unit_price }, quantity: String(transfer.quantity).replace('.', ','), unit_price: String(transfer.unit_price).replace('.', ','), notes: transfer.notes || '' }]
    : [emptyLine()])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const total = useMemo(() => lines.reduce((s, l) => s + lineTotal(parseNum(l.quantity), parseNum(l.unit_price)), 0), [lines])

  async function save(e) {
    e.preventDefault(); setErr('')
    if (!origin || !destination) return setErr('Informe origem e destino.')
    if (origin === destination) return setErr('Origem e destino precisam ser diferentes.')
    if (!isAdmin && origin !== myUnit && destination !== myUnit) return setErr('A sua unidade precisa ser a origem ou o destino.')
    const rows = []
    for (const [i, l] of lines.entries()) {
      const q = parseNum(l.quantity), p = parseNum(l.unit_price)
      if (!l.product?.name) return setErr(`Item ${i + 1}: escolha o produto.`)
      if (!(q > 0)) return setErr(`Item ${i + 1}: quantidade inválida.`)
      if (!(p >= 0)) return setErr(`Item ${i + 1}: valor unitário inválido.`)
      rows.push({ date, origin_id: origin, destination_id: destination, product_id: l.product.id || null, product_name: l.product.name, quantity: Math.round(q * 10000) / 10000, unit_price: round2(p), notes: l.notes.trim() || null })
    }
    setBusy(true)
    try {
      if (editing) {
        const updated = await api.updateTransfer({ ...transfer, ...rows[0] })
        store.setTransfers((all) => all.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
        toast('Transferência atualizada.')
      } else {
        const created = await api.createTransfers(rows)
        store.setTransfers((all) => [...created, ...all])
        toast(`${created.length} ${created.length === 1 ? 'item lançado' : 'itens lançados'} · ${money(total)}`)
      }
      onClose()
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  const priceEditable = isAdmin

  return (
    <Modal title={editing ? 'Editar transferência' : 'Nova transferência'} onClose={onClose} wide
      footer={<>
        <span className="left">{lines.length} {lines.length === 1 ? 'item' : 'itens'} · <strong style={{ color: 'var(--text)' }}>{money(total)}</strong></span>
        <button className="btn" type="button" onClick={onClose}>Cancelar</button>
        <button className="btn primary" form="tf" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar' : 'Lançar transferência'}</button>
      </>}>
      <form id="tf" onSubmit={save}>
        <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr 160px' }}>
          <label className="field"><span>Origem</span>
            <select className="select" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Destino</span>
            <select className="select" value={destination} onChange={(e) => setDestination(e.target.value)}>
              {units.map((u) => <option key={u.id} value={u.id} disabled={u.id === origin}>{u.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Data</span><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        </div>

        <div className="lines">
          <div className="lines-head"><span>Produto</span><span>Quantidade (kg/un)</span><span>Valor unitário</span><span style={{ textAlign: 'right' }}>Valor total</span><span /></div>
          {lines.map((l, i) => (
            <div className="line" key={l.key}>
              <ProductCombo products={products} value={l.product} autoFocus={!editing && i === lines.length - 1 && i > 0}
                onChange={(p) => setLine(l.key, { product: p, unit_price: String(p.price ?? '').replace('.', ',') })} />
              <input className="input num" inputMode="decimal" placeholder={l.product?.unit || "0"} title={l.product?.unit ? `Quantidade em ${l.product.unit}` : undefined} aria-label="Quantidade" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
              <input className="input num" inputMode="decimal" placeholder="0,00" aria-label="Valor unitário" value={l.unit_price} readOnly={!priceEditable}
                title={priceEditable ? 'Preenchido pelo cadastro do produto — pode ajustar' : 'Preenchido pelo cadastro do produto'}
                style={!priceEditable ? { background: 'var(--surface-3)' } : undefined} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} />
              <span className="tot">{money(lineTotal(parseNum(l.quantity), parseNum(l.unit_price)))}</span>
              <button type="button" className="btn ghost icon" aria-label="Remover item" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></button>
              <input className="input line-note" placeholder="Observação (opcional)" value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} style={{ height: 32, fontSize: 13 }} />
            </div>
          ))}
          <div className="lines-foot">
            {!editing ? <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}><Plus />Adicionar item</button> : <span />}
            <span className="muted">Total <strong style={{ color: 'var(--text)', marginLeft: 6 }}>{money(total)}</strong></span>
          </div>
        </div>
        <p className="hint">O valor unitário vem do cadastro de produtos e fica gravado na transferência — mudanças futuras de preço não alteram lançamentos antigos.</p>
        {err && <div className="err">{err}</div>}
      </form>
    </Modal>
  )
}
