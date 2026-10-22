// Painel Nutrição: leitura do texto da nutricionista, pontuação e dados de demonstração.
import { normalize, toISO, today, addDays, weekStart } from './format.js'

// ---------------------------------------------------------------------
// Leitura do relatório: separa frases, identifica funcionário e classifica
// ---------------------------------------------------------------------
const STRONG_POS = ['parabens', 'otimo', 'otima', 'excelente', 'muito bem', 'impecavel', 'exemplar', 'perfeito', 'perfeita']
const POS = ['bom trabalho', 'etiquetou', 'registrou', 'higienizou', 'separou', 'bem feito', 'correto', 'correta', 'corretamente', 'correta', 'organizado', 'organizada', 'organizou', 'limpo', 'limpa', 'impecavel', 'caprich', 'cuidadoso', 'cuidadosa', 'adequado', 'adequada', 'adequadamente', 'elogi', 'destaque', 'perfeito', 'perfeita', 'atento', 'atenta', 'seguiu', 'cumpriu', 'respeitou', 'manteve', 'evoluiu', 'melhorou', 'certinho', 'em dia', 'dentro do padrao', 'exemplar', 'proativ', 'positivo']
const NEG = ['nao ', 'nao.', 'sem ', 'falta', 'faltou', 'faltando', 'sujo', 'suja', 'sujeira', 'errado', 'errada', 'erro', 'atrasou', 'atraso', 'esqueceu', 'esquecendo', 'problema', 'precisa', 'precisam', 'deve ', 'devem', 'melhorar', 'atencao', 'cuidado com', 'vencid', 'desorganizad', 'mal ', 'ruim', 'inadequad', 'incorret', 'contamina', 'fora do padrao', 'fora da validade', 'sem etiqueta', 'descuido', 'bagunca', 'acumul', 'deixou', 'ignorou', 'novamente', 'de novo', 'reincid', 'grave', 'risco', 'negativo', 'acima de', 'abaixo de', 'fora d', 'misturad', 'na bancada', 'aberto sem', 'nao pode']
const CONNECTOR = /^(e|mas|porem|porém|tambem|também|alem disso|além disso|ja|já|so|só|ainda|ela|ele)\s+/i

const countHits = (s, list) => list.reduce((n, w) => n + (s.includes(w) ? 1 : 0), 0)
const hasSignal = (s) => { const n = ` ${normalize(s)} `; return countHits(n, POS) + countHits(n, STRONG_POS) + countHits(n, NEG) > 0 }
// Frases que completam a anterior ("Precisa manter...", "Isso é risco...") viram orientação do mesmo ponto
const FOLLOW_UP = /^(precisa|precisam|deve|devem|isso|isto|o que|pois|porque|orientei|orientado|orientada|lembrar|lembrei)\b/i

function classify(sentence) {
  const s = ` ${normalize(sentence)} `
  const p = countHits(s, POS) + 2 * countHits(s, STRONG_POS)
  const n = countHits(s, NEG)
  if (p > n) return { type: 'pos', check: n > 0 }
  if (n > p) return { type: 'neg', check: p > 0 }
  return { type: n > 0 ? 'neg' : 'pos', check: true }
}

function aliasRegex(alias) {
  const a = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${a}([^a-z0-9]|$)`)
}

function tidy(text) {
  let t = text.trim().replace(/^[-•*·\d.)\s]+/, '').replace(/\s+/g, ' ')
  t = t.replace(CONNECTOR, '')
  if (!t) return ''
  t = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/**
 * Transforma o texto corrido em pontos { employee_id|null, type: 'pos'|'neg', text, check }.
 * - Frases sem nome herdam o último funcionário citado no mesmo parágrafo.
 * - "X fez bem, mas esqueceu Y" vira dois pontos (um positivo e um negativo).
 */
export function parseFreeText(text, employees) {
  const matchers = employees.filter((e) => e.active !== false).map((e) => ({
    id: e.id,
    res: [e.name, e.name.split(' ')[0], ...(e.aliases || [])].filter(Boolean).map(aliasRegex),
  }))
  const points = []
  for (const para of String(text || '').split(/\n\s*\n|\n(?=\s*[-•*·\d])/)) {
    let current = []
    const sentences = para.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
    for (const sentence of sentences) {
      const ns = normalize(sentence)
      const found = matchers.filter((m) => m.res.some((r) => r.test(ns))).map((m) => m.id)
      const who = found.length ? found : current
      if (found.length) current = found
      if (!found.length && FOLLOW_UP.test(sentence.trim()) && points.length && current.length) {
        // completa o(s) ponto(s) anterior(es) do mesmo funcionário
        const extra = tidy(sentence)
        const last = points.slice(-current.length)
        last.forEach((pt) => { pt.text = `${pt.text} ${extra}`; if (classify(extra).type === 'neg') { pt.type = 'neg'; pt.check = false } })
        continue
      }
      if (!who.length && (!hasSignal(sentence) || /:$/.test(sentence.trim()))) continue // título ou frase solta
      const clauses = sentence.split(/,?\s+(?:mas|porém|porem|entretanto|no entanto|contudo|só que|so que)\s+/i)
      for (const clause of clauses) {
        const t = tidy(clause)
        if (t.length < 8) continue
        const { type, check } = classify(clause)
        for (const id of who.length ? who : [null]) points.push({ employee_id: id, type, text: t, check })
      }
    }
  }
  return points
}

// ---------------------------------------------------------------------
// Formato da Rebeca: título com data, setores ("*Cozinha:*") e itens (+)/(-)
// Em cada item, separa quem é o responsável, quem vai cobrar e quem só informou.
// ---------------------------------------------------------------------
const ITEM = /^\s*[(\[]\s*([+\-–−])\s*[)\]]\s*/
const isTitle = (line) => /relat/i.test(line) && /\d{1,2}[/.]\d{1,2}/.test(line)
const isSeparator = (line) => /^\s*[-–—_=]{3,}\s*$/.test(line)
const sectionOf = (line) => {
  const t = line.trim().replace(/^\*+|\*+$/g, '').trim()
  return t.length <= 45 && !ITEM.test(line) && /^[\p{L}][\p{L}\s/.()-]*:?$/u.test(t) && (t.endsWith(':') || /^\*.*\*$/.test(line.trim())) ? t.replace(/:$/, '').trim() : null
}

export function dateFromTitle(title, ref = today()) {
  const m = String(title || '').match(/(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?/)
  if (!m) return null
  const [ry] = ref.split('-').map(Number)
  let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ry
  let d = toISO(new Date(y, Number(m[2]) - 1, Number(m[1])))
  if (!m[3] && d > addDays(ref, 7)) d = toISO(new Date(y - 1, Number(m[2]) - 1, Number(m[1])))
  return d
}

/** Separa um texto com vários relatórios colados (um título por relatório). */
export function splitReports(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  const out = []
  let cur = null
  for (const line of lines) {
    if (isTitle(line)) { cur = { title: line.replace(/\*/g, '').trim(), lines: [] }; out.push(cur); continue }
    if (isSeparator(line)) { cur = null; continue }
    if (!cur) { if (!line.trim()) continue; cur = { title: '', lines: [] }; out.push(cur) }
    cur.lines.push(line)
  }
  return out.map((r) => ({ title: r.title, text: [r.title && `*${r.title}*`, ...r.lines].filter((x) => x !== '').join('\n').trim() }))
    .filter((r) => r.text.replace(/\*[^*]*\*/g, '').trim().length > 0)
}

function mentionsIn(n, matchers) {
  const out = []
  for (const m of matchers) {
    for (const re of m.global) {
      re.lastIndex = 0
      let r
      while ((r = re.exec(n))) { const start = r.index + r[1].length; out.push({ id: m.id, start, end: start + r[2].length }) }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

function mentionRole(n, m) {
  const pre = n.slice(Math.max(0, m.start - 45), m.start)
  const post = n.slice(m.end, m.end + 45)
  if (/(informei|repassar|repassei|avisei|comuniquei|informad[oa]s? por|segundo|de acordo com)\s+(a\s|ao\s|para\s|com\s|por\s)?\s*$/.test(pre)) return 'info'
  if (/^\s*,?\s*(que\s+)?(informou|disse|falou|relatou|acha)\b/.test(post)) return 'info'
  if (/(pedi|solicitei|orientei|sinalizei|falei)\s+(a\s|ao\s|para\s|com\s)?\s*$/.test(pre) && /^\s*,?\s*(que|para que)\s+(solicite|cobre|cobrar|programe|peca|oriente|verifique)/.test(post)) return 'follow'
  if (/^\s*(tambem\s+)?(esta|ficou|fica)\s+ciente\s+para\s+cobr/.test(post) || /^\s*ficou de\b/.test(post)) return 'follow'
  return 'target'
}

export function parseReport(text, employees) {
  if (!/^\s*[(\[]\s*[+\-–−]\s*[)\]]/m.test(String(text || ''))) return parseFreeText(text, employees)
  const active = employees.filter((e) => e.active !== false)
  const matchers = active.map((e) => ({
    id: e.id,
    global: [...new Set([e.name, e.name.split(' ')[0], ...(e.aliases || [])].filter((a) => a && a.length > 1).map((a) => normalize(a)))]
      .map((a) => new RegExp(`(^|[^a-z0-9])(${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=[^a-z0-9]|$)`, 'g')),
  }))
  const roleOwner = (section) => {
    const ns = normalize(section || '')
    return ns ? active.filter((e) => e.role && normalize(e.role).split(/[\s/,]+/)[0] === ns).map((e) => e.id) : []
  }
  const items = []
  let section = 'Geral'
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line || isTitle(line) || isSeparator(line)) continue
    const sec = sectionOf(line)
    if (sec) { section = sec; continue }
    const m = line.match(ITEM)
    if (m) items.push({ type: m[1] === '+' ? 'pos' : 'neg', text: line.replace(ITEM, ''), section })
    else if (items.length) items[items.length - 1].text += ` ${line}`
  }
  const points = []
  for (const it of items) {
    const n = normalize(it.text)
    const roles = {}
    for (const men of mentionsIn(n, matchers)) {
      const r = mentionRole(n, men)
      if (r === 'target' || !roles[men.id]) roles[men.id] = r
    }
    let targets = Object.keys(roles).filter((id) => roles[id] === 'target')
    const follow = Object.keys(roles).filter((id) => roles[id] === 'follow')
    let check = false
    if (!targets.length) {
      const owner = roleOwner(it.section)
      if (owner.length) targets = owner
    }
    if (targets.length > 1 && it.type === 'pos') check = true
    const t = it.text.replace(/\s+/g, ' ').trim()
    for (const id of targets.length ? targets : [null]) {
      points.push({ employee_id: id, type: it.type, text: t, sector: it.section, involved: follow.filter((f) => f !== id), check })
    }
  }
  return points
}

// ---------------------------------------------------------------------
// Pontuação e metas
// ---------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  weights: { pos: 1, neg: -1, resolved: 0.5 },
  goal: { min_score: 4, max_open: 1, reward: 'Bônus de R$ 150 no mês', active: true },
}

export function scoreOf(points, weights) {
  const pos = points.filter((p) => p.type === 'pos').length
  const neg = points.filter((p) => p.type === 'neg').length
  const resolved = points.filter((p) => p.type === 'neg' && p.status === 'resolvido').length
  const open = neg - resolved
  const score = pos * weights.pos + neg * weights.neg + resolved * weights.resolved
  return { pos, neg, resolved, open, score: Math.round(score * 10) / 10 }
}

export const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return [toISO(new Date(y, m - 1, 1)), toISO(new Date(y, m, 0))]
}

export const isOverdue = (p) => p.type === 'neg' && p.status !== 'resolvido' && p.due_date && p.due_date < today()

// ---------------------------------------------------------------------
// Texto para WhatsApp
// ---------------------------------------------------------------------
export function whatsappText(emp, pts, periodLabel) {
  const pos = pts.filter((p) => p.type === 'pos')
  const neg = pts.filter((p) => p.type === 'neg')
  const lines = [`*Relatório da nutrição — ${emp.name}*`, `_${periodLabel}_`, '']
  lines.push('*O que está bom*')
  lines.push(...(pos.length ? pos.map((p) => `• ${p.text}`) : ['• Sem registros no período.']))
  lines.push('', '*O que precisa melhorar*')
  if (!neg.length) lines.push('• Nada a melhorar no período. Continue assim!')
  neg.forEach((p) => {
    lines.push(`• ${p.text}`)
    if (p.response) lines.push(`   ↳ Combinado: ${p.response}${p.due_date ? ` (até ${p.due_date.split('-').reverse().join('/')})` : ''}`)
    if (p.status === 'resolvido') lines.push('   ↳ Resolvido ✔')
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------
// Dados de exemplo para a prévia
// ---------------------------------------------------------------------
export function demoNutri() {
  const employees = [
    { id: 'e1', name: 'Carlos Souza', aliases: ['Carlinhos'], role: 'Chapeiro', unit: 'YANKEE', active: true },
    { id: 'e2', name: 'Juliana Lima', aliases: ['Ju'], role: 'Cozinha / produção', unit: 'YANKEE', active: true },
    { id: 'e3', name: 'Lucas Ferreira', aliases: [], role: 'Estoque', unit: 'YANKEE', active: true },
    { id: 'e4', name: 'Marina Alves', aliases: ['Mari'], role: 'Montagem', unit: 'ZN', active: true },
    { id: 'e5', name: 'Diego Ramos', aliases: [], role: 'Chapeiro', unit: 'BV', active: true },
    { id: 'e6', name: 'Bruna Costa', aliases: [], role: 'Montagem', unit: 'BV', active: true },
  ]
  const ws = weekStart(today())
  const texts = [
    [addDays(today(), -24), `Visita Yankee e HubFood ZN.

Carlos manteve a chapa limpa durante todo o serviço e as carnes estavam bem identificadas, mas esqueceu a touca no início do turno.
Juliana organizou a câmara fria com PVPS correto, parabéns. Ela também etiquetou todos os molhos com validade.
Lucas deixou caixas de papelão no chão do estoque seco. Precisa manter tudo sobre os paletes.
Mari estava com unhas compridas e esmalte, não pode na montagem.`],
    [addDays(today(), -16), `Relatório semanal.

Carlos melhorou no uso da touca, ficou o turno todo com ela. Porém a temperatura das carnes no balcão estava acima de 5°C.
Ju segue impecável na produção dos molhos.
Lucas organizou o estoque seco, tudo sobre paletes e com validade visível.
Diego na BV descongelou carne fora da geladeira, na bancada. Isso é risco de contaminação.
Bruna higienizou as bancadas corretamente entre um pedido e outro.`],
    [addDays(today(), -9), `Pontos da semana:

Marina já está sem esmalte e com unhas curtas, muito bem.
Diego descongelou novamente na bancada, precisa usar a geladeira.
Carlos controlou a temperatura do balcão e registrou na planilha, ótimo.
Juliana esqueceu de etiquetar o creme de milho.
Bruna manteve a montagem organizada e limpa.`],
    [addDays(today(), -2), `Visita de rotina.

Lucas deixou produto vencido misturado no estoque, atenção ao PEPS.
Carlos excelente, chapa limpa e uniforme completo.
Diego passou a descongelar na geladeira, seguiu a orientação.
Mari separou os utensílios por cor corretamente.`],
  ]
  const reports = [], points = []
  texts.forEach(([date, text], i) => {
    const id = `r${i + 1}`
    reports.push({ id, date, text, photos: [], author: 'Rebeca (Nutricionista)', created_at: `${date}T15:00:00` })
    parseReport(text, employees).forEach((p, j) => points.push({
      id: `${id}-p${j}`, report_id: id, date, ...p,
      status: p.type === 'neg' ? 'aberto' : null, response: '', due_date: null,
    }))
  })
  // alguns pontos já tratados
  const set = (match, patch) => { const p = points.find((x) => x.text.includes(match)); if (p) Object.assign(p, patch) }
  set('esqueceu a touca', { status: 'resolvido', response: 'Conversa com o Carlos e touca reserva no vestiário.', due_date: addDays(today(), -20) })
  set('caixas de papelão', { status: 'resolvido', response: 'Comprar 2 paletes extras para o estoque seco.', due_date: addDays(today(), -12) })
  set('unhas compridas', { status: 'resolvido', response: 'Reforçar regra de unhas no treinamento de admissão.', due_date: addDays(today(), -12) })
  set('acima de 5', { status: 'resolvido', response: 'Termômetro novo no balcão e registro 2x por turno.', due_date: addDays(today(), -6) })
  set('descongelou carne fora', { response: 'Treinamento de descongelamento com o Diego.', due_date: addDays(today(), -5) })
  set('etiquetar o creme', { response: 'Checklist de etiquetas no fim da produção.', due_date: addDays(today(), 4) })
  return { employees, reports, points, settings: DEFAULT_SETTINGS }
}
