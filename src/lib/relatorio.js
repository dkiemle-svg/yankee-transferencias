// Exportação de relatórios (DRE, CMV, estoque, produtos, eventos) em Excel (.xlsx) ou PDF.
import { dateBR, money, today } from './format.js'

/**
 * rel = {
 *   titulo, subtitulo, arquivo,
 *   resumo: [[rótulo, valor formatado]],          // caixinhas no topo do PDF / linhas no topo do Excel
 *   colunas: [{ h, tipo: 'text'|'money'|'num'|'pct', w }],
 *   linhas: [{ c: [valores], forte?: bool, sub?: bool }],
 *   notas: [texto]
 * }
 */
const fmtCel = (v, tipo) => {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && Math.abs(v) < 1e-9) v = 0
  if (tipo === 'money') return money(v)
  if (tipo === 'pct') return `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  if (tipo === 'num') return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 })
  return String(v)
}

export async function exportar(rel, formato) {
  if (formato === 'pdf') return exportPdf(rel)
  return exportXlsx(rel)
}

async function exportXlsx(rel) {
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const n = rel.colunas.length
  const pad = (row) => [...row, ...Array(Math.max(0, n - row.length)).fill(null)]
  const data = [
    pad([{ value: `Yankee Burger · ${rel.titulo}`, fontWeight: 'bold', fontSize: 14 }]),
    pad([rel.subtitulo ? `${rel.subtitulo} · gerado em ${dateBR(today())}` : `Gerado em ${dateBR(today())}`]),
    pad([]),
  ]
  for (const [k, v] of rel.resumo || []) data.push(pad([{ value: k, fontWeight: 'bold' }, v]))
  if (rel.resumo?.length) data.push(pad([]))
  data.push(rel.colunas.map((c) => ({ value: c.h, fontWeight: 'bold', backgroundColor: '#212121', textColor: '#FFFFFF', align: c.tipo && c.tipo !== 'text' ? 'right' : 'left' })))
  for (const l of rel.linhas) {
    data.push(rel.colunas.map((c, i) => {
      const v = l.c[i]
      const base = { fontWeight: l.forte ? 'bold' : undefined, backgroundColor: l.forte ? '#F3F3F1' : undefined }
      if (v == null || v === '') return { value: null, ...base }
      if (c.tipo === 'money') return { value: Number(v), type: Number, format: '"R$" #,##0.00;[Red]-"R$" #,##0.00', ...base }
      if (c.tipo === 'pct') return { value: Number(v), type: Number, format: '0.0%', ...base }
      if (c.tipo === 'num') return { value: Number(v), type: Number, format: '#,##0.###', ...base }
      return { value: String(v), ...base, indent: l.sub && i === 0 ? 1 : undefined }
    }))
  }
  for (const t of rel.notas || []) { data.push(pad([])); data.push(pad([{ value: t, textColor: '#666666' }])) }
  await writeExcelFile(data, { columns: rel.colunas.map((c) => ({ width: c.w || (c.tipo === 'text' || !c.tipo ? 34 : 16) })), sheet: rel.titulo.slice(0, 31) })
    .toFile(`${rel.arquivo || 'relatorio'}_${today()}.xlsx`)
}

async function exportPdf(rel) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const larga = rel.colunas.length > 5
  const doc = new jsPDF({ orientation: larga ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  doc.setFillColor(178, 34, 34); doc.rect(0, 0, W, 6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20); doc.text('Yankee Burger', 40, 40)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90); doc.text(rel.titulo, 40, 58)
  if (rel.subtitulo) { doc.setFontSize(9); doc.text(rel.subtitulo, 40, 73) }
  doc.setFontSize(9); doc.text(`Gerado em ${dateBR(today())}`, W - 40, 40, { align: 'right' })
  let y = 86
  const resumo = rel.resumo || []
  if (resumo.length) {
    const bw = Math.min(150, (W - 80 - (resumo.length - 1) * 10) / resumo.length)
    resumo.forEach(([k, v], i) => {
      const x = 40 + i * (bw + 10)
      doc.setDrawColor(220); doc.roundedRect(x, y, bw, 40, 4, 4)
      doc.setFontSize(7.5); doc.setTextColor(110); doc.text(String(k).toUpperCase(), x + 8, y + 14, { maxWidth: bw - 12 })
      doc.setFontSize(11); doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.text(String(v), x + 8, y + 31); doc.setFont('helvetica', 'normal')
    })
    y += 54
  }
  const direita = rel.colunas.map((c, i) => (c.tipo && c.tipo !== 'text' ? i : -1)).filter((i) => i >= 0)
  autoTable(doc, {
    startY: y,
    head: [rel.colunas.map((c) => c.h)],
    body: rel.linhas.map((l) => rel.colunas.map((c, i) => `${l.sub && i === 0 ? '   ' : ''}${fmtCel(l.c[i], c.tipo)}`)),
    styles: { fontSize: 8, cellPadding: 4, textColor: 30 },
    headStyles: { fillColor: [33, 33, 33], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    didParseCell: (d) => {
      if (direita.includes(d.column.index)) d.cell.styles.halign = 'right'
      if (d.section === 'body' && rel.linhas[d.row.index]?.forte) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.fillColor = [243, 243, 241] }
      if (d.section === 'body' && typeof d.cell.raw === 'string' && d.cell.raw.startsWith('-R$')) d.cell.styles.textColor = [170, 30, 30]
    },
    margin: { left: 40, right: 40 },
    didDrawPage: () => { doc.setFontSize(8); doc.setTextColor(150); doc.text(`Página ${doc.internal.getNumberOfPages()}`, W - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' }) },
  })
  let fy = doc.lastAutoTable.finalY + 18
  doc.setFontSize(8); doc.setTextColor(110)
  for (const t of rel.notas || []) {
    const ls = doc.splitTextToSize(t, W - 80)
    if (fy + ls.length * 10 > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); fy = 40 }
    doc.text(ls, 40, fy); fy += ls.length * 10 + 6
  }
  doc.save(`${rel.arquivo || 'relatorio'}_${today()}.pdf`)
}
