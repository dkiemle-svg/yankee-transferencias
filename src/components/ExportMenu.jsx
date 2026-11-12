import React, { useState } from 'react'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'

/** Botão de exportar com escolha de formato (e, opcionalmente, de versão do relatório). */
export default function ExportMenu({ onExport, opcoes = null, label = 'Exportar' }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [op, setOp] = useState(opcoes?.[0]?.[0] || null)
  const go = async (f) => { setBusy(true); try { await onExport(f, op) } finally { setBusy(false); setOpen(false) } }
  return (
    <div className="export-menu">
      <button className="btn" onClick={() => setOpen((o) => !o)} disabled={busy} aria-expanded={open}><Download />{busy ? 'Gerando…' : label}</button>
      {open && (
        <div className="export-pop" role="menu">
          {opcoes && <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
            {opcoes.map(([k, l]) => <label key={k} className="check-row"><input type="radio" name="exp-op" checked={op === k} onChange={() => setOp(k)} /> {l}</label>)}
          </div>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => go('xlsx')}><FileSpreadsheet />Excel</button>
            <button className="btn sm" onClick={() => go('pdf')}><FileText />PDF</button>
          </div>
        </div>
      )}
    </div>
  )
}
