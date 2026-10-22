import { dateBR, today } from './format.js'

const UNIT_NAMES = { YANKEE: 'Yankee Burger', ZN: 'HubFood ZN', BV: 'HubFood BV' }

// Um funcionário por página: o que está bom, o que melhorar e o combinado
export async function exportNutriPDF(sections, periodLabel) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  const M = 48, maxW = W - M * 2

  sections.forEach(({ emp, points, score }, idx) => {
    if (idx) doc.addPage()
    let y = 0
    doc.setFillColor(178, 34, 34); doc.rect(0, 0, W, 6, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(120)
    doc.text('YANKEE BURGER · RELATÓRIO DA NUTRIÇÃO', M, 40)
    doc.setFontSize(22); doc.setTextColor(20); doc.text(emp.name, M, 72)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100)
    doc.text(`${emp.role || ''} · ${UNIT_NAMES[emp.unit] || ''} · ${periodLabel}`, M, 92)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(score.score >= 0 ? 0 : 180, score.score >= 0 ? 110 : 60, 0)
    doc.text(`${score.score > 0 ? '+' : ''}${score.score} pts`, W - M, 72, { align: 'right' })
    y = 124

    const section = (title, color, items, render) => {
      doc.setFillColor(...color); doc.roundedRect(M, y, maxW, 24, 4, 4, 'F')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255); doc.text(title, M + 12, y + 16)
      y += 38
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(30)
      if (!items.length) { doc.setTextColor(130); doc.text('Nada registrado no período.', M + 12, y); y += 24; return }
      items.forEach((p) => {
        const lines = doc.splitTextToSize(`•  ${p.text}`, maxW - 24)
        if (y + lines.length * 15 > H - 60) { doc.addPage(); y = 60 }
        doc.setTextColor(30); doc.text(lines, M + 12, y); y += lines.length * 15
        const extra = render?.(p)
        if (extra) {
          const l2 = doc.splitTextToSize(extra, maxW - 40)
          doc.setTextColor(110); doc.setFontSize(10); doc.text(l2, M + 28, y); doc.setFontSize(11); y += l2.length * 13
        }
        y += 6
      })
      y += 12
    }
    section('O QUE ESTÁ BOM', [10, 125, 10], points.filter((p) => p.type === 'pos'))
    section('O QUE PRECISA MELHORAR', [190, 120, 0], points.filter((p) => p.type === 'neg'), (p) => [
      p.response ? `Combinado: ${p.response}` : null,
      p.due_date ? `Prazo: ${dateBR(p.due_date)}` : null,
      p.status === 'resolvido' ? 'Situação: resolvido' : 'Situação: em aberto',
    ].filter(Boolean).join('  ·  '))

    doc.setFontSize(9); doc.setTextColor(150)
    doc.text(`Gerado em ${dateBR(today())}`, M, H - 30)
  })
  doc.save(`relatorio_nutricao_${today()}.pdf`)
}
