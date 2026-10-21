import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { X, Check, Clock, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown, Search, CalendarDays } from 'lucide-react'
import { normalize, PRESETS, presetRange, dateBR } from '../lib/format.js'

// ---------------- Toasts ----------------
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random()
    setItems((x) => [...x, { id, msg, kind }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------------- Modal ----------------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fechar"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------- Confirm ----------------
const ConfirmCtx = createContext(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const confirm = useCallback((opts) => new Promise((resolve) => setState({ ...opts, resolve })), [])
  const close = (v) => { state?.resolve(v); setState(null) }
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title || 'Confirmar'} onClose={() => close(false)}
          footer={<>
            <button className="btn" onClick={() => close(false)}>Cancelar</button>
            <button className={`btn ${state.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>{state.ok || 'Confirmar'}</button>
          </>}>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>{state.message}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  )
}

// ---------------- Popover helper ----------------
export function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return { open, setOpen, ref }
}

// ---------------- MultiSelect (filtro com "Selecionar tudo") ----------------
export function MultiSelect({ label, icon: Icon, options, value, onChange, right }) {
  const { open, setOpen, ref } = usePopover()
  const [q, setQ] = useState('')
  const filtered = useMemo(() => options.filter((o) => normalize(o.label).includes(normalize(q))), [options, q])
  const set = new Set(value)
  const toggle = (v) => { const s = new Set(value); s.has(v) ? s.delete(v) : s.add(v); onChange([...s]) }
  const selectAll = () => onChange([...new Set([...value, ...filtered.map((o) => o.value)])])
  const clearAll = () => { const f = new Set(filtered.map((o) => o.value)); onChange(value.filter((v) => !f.has(v))) }
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className={`chip-btn ${value.length ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {Icon && <Icon />}{label}
        {value.length > 0 && <span className="count">{value.length}</span>}
        <ChevronDown />
      </button>
      {open && (
        <div className={`popover ${right ? 'right' : ''}`}>
          <div className="input-icon pop-search"><Search /><input className="input" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          <div className="pop-actions">
            <button type="button" onClick={selectAll}>Selecionar tudo{q ? ' (busca)' : ''}</button>
            <button type="button" onClick={clearAll}>Limpar</button>
          </div>
          <div className="pop-list">
            {filtered.length === 0 && <div className="pop-empty">Nada encontrado</div>}
            {filtered.map((o) => (
              <label key={o.value} className="pop-item">
                <input type="checkbox" className="check" checked={set.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
                {o.hint != null && <span className="right">{o.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- Seletor de período ----------------
export function DateRangePicker({ from, to, onChange }) {
  const { open, setOpen, ref } = usePopover()
  const label = from || to ? `${from ? dateBR(from) : '…'} – ${to ? dateBR(to) : '…'}` : 'Período'
  const current = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === from && b === to })
  return (
    <div className="pop-wrap" ref={ref}>
      <button type="button" className={`chip-btn ${from || to ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <CalendarDays />{current && current[0] !== 'all' ? current[1] : label}<ChevronDown />
      </button>
      {open && (
        <div className="popover" style={{ width: 300 }}>
          <div className="pop-list" style={{ maxHeight: 'none' }}>
            {PRESETS.map(([k, l]) => {
              const on = current?.[0] === k
              return (
                <div key={k} className="pop-item" onClick={() => { const [a, b] = presetRange(k); onChange(a, b); setOpen(false) }}>
                  <span style={{ fontWeight: on ? 600 : 400 }}>{l}</span>
                  {on && <Check className="right" style={{ width: 16, height: 16, color: 'var(--accent)' }} />}
                </div>
              )
            })}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 10 }}>
            <div className="grid-2" style={{ gap: 8 }}>
              <label className="field"><span>De</span><input type="date" className="input" value={from} onChange={(e) => onChange(e.target.value, to)} /></label>
              <label className="field"><span>Até</span><input type="date" className="input" value={to} onChange={(e) => onChange(from, e.target.value)} /></label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- Combobox de produto ----------------
export function ProductCombo({ products, value, onChange, autoFocus }) {
  const { open, setOpen, ref } = usePopover()
  const [q, setQ] = useState(value?.name || '')
  const [hl, setHl] = useState(0)
  useEffect(() => { setQ(value?.name || '') }, [value?.id])
  const list = useMemo(() => {
    const n = normalize(q)
    const act = products.filter((p) => p.active !== false)
    if (!n || n === normalize(value?.name)) return act.slice(0, 60)
    const starts = act.filter((p) => normalize(p.name).startsWith(n))
    const has = act.filter((p) => !normalize(p.name).startsWith(n) && normalize(p.name).includes(n))
    return [...starts, ...has].slice(0, 60)
  }, [products, q, value])
  const pick = (p) => { onChange(p); setQ(p.name); setOpen(false) }
  return (
    <div className="combo" ref={ref}>
      <input className="input" placeholder="Buscar produto…" value={q} autoFocus={autoFocus}
        onFocus={(e) => { setOpen(true); e.target.select() }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, list.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Enter' && open && list[hl]) { e.preventDefault(); pick(list[hl]) }
        }} />
      {open && (
        <div className="popover">
          <div className="pop-list">
            {list.length === 0 && <div className="pop-empty">Produto não cadastrado</div>}
            {list.map((p, i) => (
              <div key={p.id} className={`pop-item ${i === hl ? 'hl' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(p) }} onMouseEnter={() => setHl(i)}>
                <span>{p.name}</span>
                <span className="right">{p.price ? p.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'sem preço'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------- Cabeçalho ordenável ----------------
export function SortTh({ k, sort, setSort, children, className = '' }) {
  const on = sort.key === k
  const Icon = on ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={`sortable ${className}`} onClick={() => setSort(on ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: className.includes('num') || k === 'date' ? 'desc' : 'asc' })}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className={`sort ${on ? 'on' : ''}`}>{children}<Icon /></span>
    </th>
  )
}

export function StatusButton({ paid, onClick, disabled }) {
  return (
    <button type="button" className={`status ${paid ? 'paid' : 'open'}`} onClick={onClick} disabled={disabled}
      title={disabled ? 'Somente o recebedor ou o administrativo pode alterar' : paid ? 'Clique para voltar para Em aberto' : 'Clique para marcar como Pago'}>
      {paid ? <Check /> : <Clock />}{paid ? 'Pago' : 'Em aberto'}
    </button>
  )
}

export const UNIT_COLORS = { ZN: 'var(--series-1)', BV: 'var(--series-2)', YANKEE: 'var(--accent)' }
export function UnitTag({ unit }) {
  if (!unit) return <span className="muted">—</span>
  return <span className="unit-tag"><i className="unit-dot" style={{ background: UNIT_COLORS[unit.code] || 'var(--series-3)' }} />{unit.name}</span>
}
