import { dateBR, money, num2, qty, today } from './format.js'

function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
}

const COLS = ['Data', 'Origem', 'Destino', 'Produto', 'Quantidade', 'Unid.', 'Valor unitário', 'Valor total', 'Status', 'Observação']

// CSV no padrão brasileiro (separador ";", vírgula decimal) — abre direto no Excel
export function exportCSV(rows, unitName, measureOf = () => '', fileBase = 'transferencias') {
  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [COLS.join(';')]
  rows.forEach((t) => lines.push([
    dateBR(t.date), unitName(t.origin_id), unitName(t.destination_id), t.product_name,
    String(t.quantity).replace('.', ','), measureOf(t), num2(t.unit_price), num2(t.total), t.paid ? 'Pago' : 'Em aberto', t.notes || '',
  ].map(esc).join(';')))
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${fileBase}_${today()}.csv`)
}

export async function exportPDF(rows, unitName, { title = 'Transferências entre unidades', subtitle = '', fileBase = 'transferencias', measureOf = () => '' } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  const total = rows.reduce((s, t) => s + t.total, 0)
  const paid = rows.filter((t) => t.paid).reduce((s, t) => s + t.total, 0)

  doc.setFillColor(178, 34, 34); doc.rect(0, 0, W, 6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20)
  doc.text('Yankee Burger', 40, 40)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90)
  doc.text(title, 40, 58)
  if (subtitle) { doc.setFontSize(9); doc.text(subtitle, 40, 73) }
  doc.setFontSize(9); doc.text(`Gerado em ${dateBR(today())}`, W - 40, 40, { align: 'right' })

  const boxes = [['Transferências', String(rows.length)], ['Valor total', money(total)], ['Pago', money(paid)], ['Em aberto', money(total - paid)]]
  boxes.forEach(([k, v], i) => {
    const x = 40 + i * 160
    doc.setDrawColor(220); doc.roundedRect(x, 86, 150, 40, 4, 4)
    doc.setFontSize(8); doc.setTextColor(110); doc.text(k.toUpperCase(), x + 10, 101)
    doc.setFontSize(12); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(v, x + 10, 118); doc.setFont('helvetica', 'normal')
  })

  autoTable(doc, {
    startY: 140,
    head: [[...COLS.slice(0, 5), ...COLS.slice(6, 9)]],
    body: rows.map((t) => [dateBR(t.date), unitName(t.origin_id), unitName(t.destination_id), t.product_name, `${qty(t.quantity)} ${measureOf(t)}`.trim(), money(t.unit_price), money(t.total), t.paid ? 'Pago' : 'Em aberto']),
    foot: [['', '', '', 'Total', '', '', money(total), '']],
    styles: { fontSize: 8, cellPadding: 4, textColor: 30 },
    headStyles: { fillColor: [33, 33, 33], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [245, 245, 243], textColor: 20, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section !== 'body' && [4, 5, 6].includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'body' && d.column.index === 7) d.cell.styles.textColor = d.cell.raw === 'Pago' ? [0, 110, 0] : [180, 110, 0]
    },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      doc.setFontSize(8); doc.setTextColor(150)
      doc.text(`Página ${doc.internal.getNumberOfPages()}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' })
    },
  })
  doc.save(`${fileBase}_${today()}.pdf`)
}
