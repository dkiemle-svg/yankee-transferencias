import { dateBR, today } from './format.js'
import { shortText } from './nutri.js'

// Relatório da equipe em PDF (paisagem): resumo, mapa por pessoa e por setor e as listas
export async function exportNutriPDF(r, periodLabel, who = 'Equipe') {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 36
  const GREEN = [12, 140, 12], AMBER = [196, 128, 0], RED = [200, 50, 50]

  doc.setFillColor(178, 34, 34); doc.rect(0, 0, W, 6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20)
  doc.text(`Relatório da Nutrição · ${who}`, M, 38)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100)
  doc.text(`Yankee Burger · ${periodLabel}`, M, 54)
  doc.setFontSize(8); doc.text(`Gerado em ${dateBR(today())}`, W - M, 38, { align: 'right' })

  const t = r.totals
  const boxes = [
    ['Pontos positivos', t.pos, GREEN], ['Resolvidos (contam como positivo)', t.resolved, GREEN],
    ['Novos a melhorar', t.neg, AMBER], [`Falta resolver${t.pendOld ? ` · ${t.pendOld} antigos` : ''}`, t.pending, t.late ? RED : AMBER],
  ]
  const bw = (W - M * 2 - 30) / 4
  boxes.forEach(([k, v, c], i) => {
    const x = M + i * (bw + 10)
    doc.setDrawColor(225); doc.setFillColor(250, 250, 249); doc.roundedRect(x, 66, bw, 44, 4, 4, 'FD')
    doc.setFillColor(...c); doc.rect(x, 66, 3, 44, 'F')
    doc.setFontSize(7.5); doc.setTextColor(110); doc.text(k.toUpperCase(), x + 12, 81)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20); doc.text(String(v), x + 12, 101); doc.setFont('helvetica', 'normal')
    if (i === 3 && t.late) { doc.setFontSize(8); doc.setTextColor(...RED); doc.text(`${t.late} atrasado${t.late > 1 ? 's' : ''}`, x + bw - 10, 101, { align: 'right' }) }
  })

  const heat = (cols) => (d) => {
    if (d.section !== 'body') return
    const c = cols[d.column.index]
    if (!c) return
    const v = Number(d.cell.raw) || 0
    if (!v) { d.cell.styles.textColor = 190; return }
    const k = Math.min(1, v / (c.max || 1))
    const base = c.color
    d.cell.styles.fillColor = base.map((x) => Math.round(255 - (255 - x) * (0.12 + 0.38 * k)))
    d.cell.styles.fontStyle = 'bold'
  }
  const mapTable = (title, rows, startY) => {
    const max = (f) => Math.max(1, ...rows.map(f))
    const cols = {
      1: { color: GREEN, max: max((x) => x.pos) }, 2: { color: GREEN, max: max((x) => x.resolved) },
      3: { color: AMBER, max: max((x) => x.neg) }, 4: { color: RED, max: max((x) => x.pendOld) }, 5: { color: AMBER, max: max((x) => x.pendNew) },
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(20); doc.text(title, M, startY)
    autoTable(doc, {
      startY: startY + 6,
      head: [['', 'Positivos', 'Resolvidos', 'Novos a melhorar', 'Pendentes antigos', 'Pendentes do período', 'Saldo']],
      body: rows.map((x) => [x.sub ? `${x.label}\n${x.sub}` : x.label, x.pos, x.resolved, x.neg, x.pendOld, x.pendNew, `${x.score > 0 ? '+' : ''}${String(x.score).replace('.', ',')}`]),
      styles: { fontSize: 8.5, cellPadding: 5, textColor: 30, halign: 'center', valign: 'middle', lineColor: 235, lineWidth: 0.5 },
      headStyles: { fillColor: [33, 33, 33], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { halign: 'left', cellWidth: 190 } },
      didParseCell: (d) => {
        heat(cols)(d)
        if (d.section === 'body' && d.column.index === 0) { d.cell.styles.fontStyle = 'bold' }
        if (d.section === 'body' && d.column.index === 6) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = String(d.cell.raw).startsWith('-') ? RED : GREEN }
      },
      margin: { left: M, right: M },
    })
    return doc.lastAutoTable.finalY + 22
  }
  let y = mapTable('Mapa da equipe', r.people, 134)
  if (r.sectors.length) {
    if (y > H - 120) { doc.addPage(); y = 44 }
    y = mapTable('Mapa por setor', r.sectors, y)
  }

  const list = (title, head, body, colStyles, color) => {
    if (!body.length) return
    if (y > H - 110) { doc.addPage(); y = 44 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...color); doc.text(title, M, y)
    autoTable(doc, {
      startY: y + 6, head: [head], body,
      styles: { fontSize: 8, cellPadding: 4, textColor: 30, valign: 'top', overflow: 'linebreak' },
      headStyles: { fillColor: [245, 245, 243], textColor: 60, fontStyle: 'bold' },
      columnStyles: colStyles,
      margin: { left: M, right: M },
    })
    y = doc.lastAutoTable.finalY + 22
  }
  list('Resolvidos no período (contam como ponto positivo)', ['Apontado', 'Resolvido', 'Responsável', 'Setor', 'Ponto', 'O que foi feito'],
    r.resolved.map((p) => [dateBR(p.date), `${dateBR(p.resolvedOn)}\n${p.days} dia${p.days === 1 ? '' : 's'}`, r.nameOf(p), p.sector || '', shortText(p.text, 260), p.response || '']),
    { 0: { cellWidth: 52 }, 1: { cellWidth: 58 }, 2: { cellWidth: 80 }, 3: { cellWidth: 70 }, 5: { cellWidth: 170 } }, GREEN)
  list('Ainda falta resolver', ['Desde', 'Origem', 'Responsável', 'Setor', 'Ponto', 'Combinado / prazo', 'Situação'],
    r.pending.map((p) => [`${dateBR(p.date)}\n${p.age} dias`, p.old ? 'Anterior' : 'Do período', r.nameOf(p), p.sector || '', shortText(p.text, 240),
      [p.response, p.due_date ? `até ${dateBR(p.due_date)}` : null].filter(Boolean).join(' · ') || '—', p.late ? 'Atrasado' : p.due_date ? 'No prazo' : 'Sem prazo']),
    { 0: { cellWidth: 52 }, 1: { cellWidth: 52 }, 2: { cellWidth: 80 }, 3: { cellWidth: 70 }, 5: { cellWidth: 140 }, 6: { cellWidth: 56 } }, AMBER)
  list('Pontos positivos do período', ['Data', 'Responsável', 'Setor', 'Ponto'],
    r.positives.map((p) => [dateBR(p.date), r.nameOf(p), p.sector || '', shortText(p.text, 300)]),
    { 0: { cellWidth: 52 }, 1: { cellWidth: 90 }, 2: { cellWidth: 80 } }, GREEN)

  const pages = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150)
    doc.text(`Página ${i} de ${pages}`, W - M, H - 18, { align: 'right' })
  }
  doc.save(`relatorio_nutricao_${today()}.pdf`)
}
