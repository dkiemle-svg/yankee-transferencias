// Camada de dados: usa o Supabase quando configurado, ou o modo demonstração
// (dados da planilha guardados no navegador) quando não houver credenciais.
import { createClient } from '@supabase/supabase-js'
import { round2 } from './format.js'
import { demoNutri, DEFAULT_SETTINGS } from './nutri.js'
import { SUPABASE_URL as URL, SUPABASE_KEY as KEY, toEmail } from '../config.js'

export const DEMO = import.meta.env.MODE === 'demo' || !URL || !KEY || URL.startsWith('__')

// Estoque: a partir de quando as saídas são calculadas
export const EST_INICIO = '2026-11-01'
function normEst(d) {
  const n = (rows, ...ks) => rows.map((r) => { const o = { ...r }; ks.forEach((k) => { if (o[k] != null) o[k] = Number(o[k]) }); return o })
  const itens = n(d.itensCont, 'qtd')
  return {
    insumos: n(d.insumos, 'litros', 'preco_medio', 'preco_ultimo', 'estoque_min', 'tolerancia'),
    pratos: n(d.pratos, 'preco_venda'), fichas: n(d.fichas, 'qtd'), fichasProd: n(d.fichasProd, 'qtd'),
    movs: n(d.movs, 'qtd', 'custo_unit'), transfMap: n(d.transfMap, 'fator'),
    contagens: d.contagens.map((c) => ({ ...c, itens: itens.filter((i) => i.contagem_id === c.id) })),
    saidas: n(d.saidas, 'qtd', 'origem_qtd'), vendas: n(d.vendas, 'qtd'),
  }
}
/** Saídas calculadas no navegador (modo demonstração), igual à função est_saidas do banco. */
function saidasLocal({ itens, fichas, transfers, transfMap, units, de, eventos = [] }) {
  const out = []
  const fx = new Map(); fichas.forEach((f) => { if (!fx.has(f.produto_codigo)) fx.set(f.produto_codigo, []); fx.get(f.produto_codigo).push(f) })
  for (const i of itens) {
    if (i.dia < de || i.unidade !== 'ZN Salão') continue
    for (const f of fx.get(i.codigo) || []) out.push({ dia: i.dia, insumo_codigo: f.insumo_codigo, tipo: 'venda', qtd: i.qtd * f.qtd, origem: `${i.codigo} ${i.nome}`, origem_qtd: i.qtd })
  }
  const mp = new Map(transfMap.map((m) => [m.product_name, m])); const ub = new Map(units.map((u) => [u.id, u]))
  for (const t of transfers) {
    const m = mp.get(t.product_name); if (!m || t.date < de || ub.get(t.origin_id)?.is_hub) continue
    out.push({ dia: t.date, insumo_codigo: m.insumo_codigo, tipo: 'transferencia', qtd: Number(t.quantity) * m.fator, origem: `${t.product_name} → ${ub.get(t.destination_id)?.name || ''}`, origem_qtd: Number(t.quantity) })
  }
  for (const e of eventos) {
    if (e.status !== 'realizado' || e.dia < de) continue
    for (const it of e.itens || []) for (const f of fx.get(it.codigo) || []) out.push({ dia: e.dia, insumo_codigo: f.insumo_codigo, tipo: 'evento', qtd: it.qtd * f.qtd, origem: `${it.codigo} ${it.nome} · evento ${e.nome}`, origem_qtd: it.qtd })
  }
  return out
}

const withTotal = (t) => ({ ...t, quantity: Number(t.quantity), unit_price: Number(t.unit_price), total: round2(Number(t.quantity) * Number(t.unit_price)) })

// =====================================================================
// Supabase
// =====================================================================
function supabaseApi() {
  const sb = createClient(URL, KEY)
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data }

  return {
    demo: false,
    async session() { return ok(await sb.auth.getSession()).session },
    onAuth(cb) { const { data } = sb.auth.onAuthStateChange((e, s) => cb(s, e)); return () => data.subscription.unsubscribe() },
    async signIn(user, password) { ok(await sb.auth.signInWithPassword({ email: toEmail(user), password })) },
    async signUp(user, password, name) {
      const r = ok(await sb.auth.signUp({ email: toEmail(user), password, options: { data: { name }, emailRedirectTo: window.location.href.split('#')[0] } }))
      return r
    },
    async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] })) },
    async updatePassword(password) { ok(await sb.auth.updateUser({ password })) },
    async signOut() { await sb.auth.signOut() },

    async profile() {
      const s = await this.session(); if (!s) return null
      return ok(await sb.from('profiles').select('*').eq('id', s.user.id).single())
    },
    async savePrefs(prefs) { ok(await sb.rpc('save_prefs', { value: prefs })) },

    async units() { return ok(await sb.from('units').select('*').order('is_hub').order('name')) },
    async saveUnit(u) {
      const { id, ...rest } = u
      return id ? ok(await sb.from('units').update(rest).eq('id', id).select().single())
                : ok(await sb.from('units').insert(rest).select().single())
    },
    async deleteUnit(id) { ok(await sb.from('units').delete().eq('id', id)) },

    async products() {
      const all = []
      for (let from = 0; ; from += 1000) {
        const page = ok(await sb.from('products').select('*').order('name').range(from, from + 999))
        all.push(...page); if (page.length < 1000) break
      }
      return all.map((p) => ({ ...p, price: Number(p.price) }))
    },
    async saveProduct(p) {
      const { id, ...rest } = p
      const r = id ? ok(await sb.from('products').update(rest).eq('id', id).select().single())
                   : ok(await sb.from('products').insert(rest).select().single())
      return { ...r, price: Number(r.price) }
    },
    async deleteProduct(id) { ok(await sb.from('products').delete().eq('id', id)) },

    async transfers() {
      const all = []
      for (let from = 0; ; from += 1000) {
        const page = ok(await sb.from('transfers').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999))
        all.push(...page); if (page.length < 1000) break
      }
      return all.map(withTotal)
    },
    async createTransfers(rows) {
      const clean = rows.map(({ total, id, ...r }) => r)
      const out = []
      for (let i = 0; i < clean.length; i += 500) out.push(...ok(await sb.from('transfers').insert(clean.slice(i, i + 500)).select()))
      return out.map(withTotal)
    },
    async updateTransfer(t) {
      const { id, total, paid, paid_at, paid_by, created_at, created_by, ...rest } = t
      return withTotal(ok(await sb.from('transfers').update(rest).eq('id', id).select().single()))
    },
    async deleteTransfers(ids) {
      for (let i = 0; i < ids.length; i += 200) ok(await sb.from('transfers').delete().in('id', ids.slice(i, i + 200)))
    },
    async setPaid(ids, value) {
      let n = 0
      for (let i = 0; i < ids.length; i += 500) n += ok(await sb.rpc('set_paid', { ids: ids.slice(i, i + 500), value }))
      return n
    },

    async profiles() { return ok(await sb.from('profiles').select('*').order('created_at')) },
    async saveProfile(p) { ok(await sb.from('profiles').update({ role: p.role, unit_id: p.unit_id || null, name: p.name, master: !!p.master, access: p.access || [] }).eq('id', p.id)) },
    async setUserPassword(id, password) { ok(await sb.rpc('admin_set_password', { target: id, new_password: password })) },

    // ----- Painel Nutrição -----
    async nutriLoad() {
      const all = async (table, order) => {
        const out = []
        for (let from = 0; ; from += 1000) {
          const page = ok(await sb.from(table).select('*').order(order).range(from, from + 999))
          out.push(...page); if (page.length < 1000) break
        }
        return out
      }
      const [employees, reports, points, settings] = await Promise.all([
        all('nutri_employees', 'name'), all('nutri_reports', 'date'), all('nutri_points', 'created_at'),
        sb.from('nutri_settings').select('data').eq('id', 1).maybeSingle().then(ok),
      ])
      return { employees, reports: await signPhotos(reports), points, settings: { ...DEFAULT_SETTINGS, ...(settings?.data || {}) } }
    },
    async nutriSaveEmployee(e) {
      const { id, ...rest } = e
      return id ? ok(await sb.from('nutri_employees').update(rest).eq('id', id).select().single())
                : ok(await sb.from('nutri_employees').insert(rest).select().single())
    },
    async nutriDeleteEmployee(id) { ok(await sb.from('nutri_employees').delete().eq('id', id)) },
    async nutriCreateReport(report, points) {
      const s = await this.session(); const me = await this.profile()
      const rid = crypto.randomUUID()
      const paths = []
      for (const [i, dataUrl] of (report.photos || []).entries()) {
        const blob = await (await fetch(dataUrl)).blob()
        const path = `${rid}/${i + 1}.jpg`
        ok(await sb.storage.from('nutri-fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }))
        paths.push(path)
      }
      const r = ok(await sb.from('nutri_reports').insert({ id: rid, date: report.date, text: report.text, photos: paths, author_id: s.user.id, author_name: me?.name || '' }).select().single())
      const rows = points.map((p) => ({ report_id: rid, date: report.date, employee_id: p.employee_id || null, type: p.type, sector: p.sector || null, text: p.text, involved: p.involved || [], status: p.type === 'neg' ? 'aberto' : null, due_date: p.type === 'neg' ? p.due_date || null : null }))
      const ps = rows.length ? ok(await sb.from('nutri_points').insert(rows).select()) : []
      return { report: (await signPhotos([r]))[0], points: ps }
    },
    async nutriDeleteReport(id) {
      const r = ok(await sb.from('nutri_reports').select('photos').eq('id', id).single())
      if (r.photos?.length) await sb.storage.from('nutri-fotos').remove(r.photos)
      ok(await sb.from('nutri_reports').delete().eq('id', id))
    },
    async nutriUpdatePoint(id, patch) {
      const p = { ...patch }
      if (patch.status === 'resolvido') p.resolved_at = new Date().toISOString()
      if (patch.status === 'aberto') p.resolved_at = null
      return ok(await sb.from('nutri_points').update(p).eq('id', id).select().single())
    },
    async nutriSaveSettings(settings) { ok(await sb.from('nutri_settings').upsert({ id: 1, data: settings })); return settings },

    // ----- Painel Financeiro -----
    async finLoad() {
      const all = async (table, order) => {
        const out = []
        for (let from = 0; ; from += 1000) {
          const page = ok(await sb.from(table).select('*').order(order).range(from, from + 999))
          out.push(...page); if (page.length < 1000) break
        }
        return out
      }
      const opt = (p) => p.catch(() => []) // tabelas de produtos podem ainda não existir
      const [lancamentos, pagamentos, custos_fixos, vendas, historico, itens, produtos, eventos, evItens, insights, pratos] = await Promise.all([
        all('fin_lancamentos', 'vencimento'), all('fin_pagamentos', 'id'), all('fin_custos_fixos', 'created_at'),
        all('fin_vendas', 'dia'), all('fin_historico', 'mes'), opt(all('fin_itens', 'dia')), opt(all('fin_produtos', 'codigo')),
        opt(all('fin_eventos', 'dia')), opt(all('fin_evento_itens', 'evento_id')), opt(all('fin_insights', 'dia')), opt(all('est_pratos', 'codigo')),
      ])
      const n = (rows, ...ks) => rows.map((r) => { const o = { ...r }; ks.forEach((k) => { if (o[k] != null) o[k] = Number(o[k]) }); return o })
      const ei = n(evItens, 'qtd', 'preco')
      return { lancamentos: n(lancamentos, 'valor'), pagamentos, custos_fixos: n(custos_fixos, 'valor', 'dia'), vendas: n(vendas, 'valor'), historico: n(historico, 'total', 'promo_valor'), itens: n(itens, 'qtd', 'qtd_lanc', 'valor'), produtos,
        eventos: eventos.map((e) => ({ ...e, itens: ei.filter((i) => i.evento_id === e.id) })), insights, pratos: n(pratos, 'preco_venda') }
    },
    async finSaveEvento(ev, itens) {
      const { id, itens: _i, ...rest } = ev
      const row = { ...rest, updated_at: new Date().toISOString() }
      const saved = id ? ok(await sb.from('fin_eventos').update(row).eq('id', id).select().single()) : ok(await sb.from('fin_eventos').insert(row).select().single())
      ok(await sb.from('fin_evento_itens').delete().eq('evento_id', saved.id))
      if (itens.length) ok(await sb.from('fin_evento_itens').insert(itens.map((i) => ({ evento_id: saved.id, codigo: i.codigo, nome: i.nome, qtd: i.qtd, preco: i.preco }))))
      return { ...saved, itens: itens.map((i) => ({ ...i, evento_id: saved.id })) }
    },
    async finSetEventoStatus(id, status) { ok(await sb.from('fin_eventos').update({ status, updated_at: new Date().toISOString() }).eq('id', id)) },
    async finDeleteEvento(id) { ok(await sb.from('fin_eventos').delete().eq('id', id)) },
    async finDeleteInsight(id) { ok(await sb.from('fin_insights').delete().eq('id', id)) },
    async finSetPago(ids, data) {
      if (data) ok(await sb.from('fin_pagamentos').upsert(ids.map((id) => ({ id, data, at: new Date().toISOString() }))))
      else ok(await sb.from('fin_pagamentos').delete().in('id', ids))
    },
    async finSaveFixo(f) {
      const { id, ...rest } = f
      return id ? ok(await sb.from('fin_custos_fixos').update(rest).eq('id', id).select().single())
                : ok(await sb.from('fin_custos_fixos').insert(rest).select().single())
    },
    async finDeleteFixo(id) { ok(await sb.from('fin_custos_fixos').delete().eq('id', id)) },
    async finSaveLancamento(l) { return ok(await sb.from('fin_lancamentos').upsert({ ...l, updated_at: new Date().toISOString() }).select().single()) },
    async finDeleteLancamento(id) { ok(await sb.from('fin_lancamentos').delete().eq('id', id)); await sb.from('fin_pagamentos').delete().eq('id', id) },
    async finImport(kind, rows) {
      const table = { lancamentos: 'fin_lancamentos', vendas: 'fin_vendas', historico: 'fin_historico' }[kind]
      const onConflict = { lancamentos: 'id', vendas: 'dia,unidade,forma', historico: 'mes,unidade' }[kind]
      for (let i = 0; i < rows.length; i += 500) ok(await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict }))
    },
    // Itens vendidos: troca os dias do arquivo inteiros (o que sumiu do 3LM some daqui também)
    async finImportItens(unidade, dias, rows) {
      ok(await sb.from('fin_itens').delete().eq('unidade', unidade).in('dia', dias))
      for (let i = 0; i < rows.length; i += 500) ok(await sb.from('fin_itens').insert(rows.slice(i, i + 500)))
    },
    async finSaveProdutos(rows) {
      const at = new Date().toISOString()
      for (let i = 0; i < rows.length; i += 500) ok(await sb.from('fin_produtos').upsert(rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: at })), { onConflict: 'codigo' }))
    },

    // ----- Painel de Estoque -----
    async estLoad(de = EST_INICIO) {
      const all = async (table, order) => {
        const out = []
        for (let from = 0; ; from += 1000) {
          const page = ok(await sb.from(table).select('*').order(order).range(from, from + 999))
          out.push(...page); if (page.length < 1000) break
        }
        return out
      }
      const rpc = async (fn, args) => ok(await sb.rpc(fn, args))
      const [insumos, pratos, fichas, fichasProd, movs, contagens, itensCont, transfMap, saidas, vendas] = await Promise.all([
        all('est_insumos', 'codigo'), all('est_pratos', 'codigo'), all('est_fichas', 'produto_codigo'), all('est_fichas_producao', 'processado_codigo'),
        all('est_movs', 'dia'), all('est_contagens', 'corte'), all('est_contagem_itens', 'contagem_id'), all('est_transf_map', 'product_name'),
        rpc('est_saidas', { de }), rpc('est_vendas', { de }),
      ])
      return normEst({ insumos, pratos, fichas, fichasProd, movs, contagens, itensCont, transfMap, saidas, vendas })
    },
    async estProdutosTransf() { return ok(await sb.rpc('est_produtos_transf')) },
    async estImport3lm({ insumos, existentes, pratos, linhas }) {
      const at = new Date().toISOString()
      const novos = insumos.filter((i) => !existentes.has(i.codigo))
      const velhos = insumos.filter((i) => existentes.has(i.codigo)).map(({ ativo, litros, ...r }) => ({ ...r, updated_at: at }))
      for (let i = 0; i < novos.length; i += 500) ok(await sb.from('est_insumos').insert(novos.slice(i, i + 500)))
      for (let i = 0; i < velhos.length; i += 500) ok(await sb.from('est_insumos').upsert(velhos.slice(i, i + 500), { onConflict: 'codigo' }))
      if (pratos?.length) {
        ok(await sb.from('est_pratos').upsert(pratos.map(({ codigo, nome, secao, preco_venda }) => ({ codigo, nome, secao, preco_venda, updated_at: at })), { onConflict: 'codigo' }))
        ok(await sb.from('est_fichas').delete().in('produto_codigo', pratos.map((p) => p.codigo)))
        for (let i = 0; i < linhas.length; i += 500) ok(await sb.from('est_fichas').insert(linhas.slice(i, i + 500)))
      }
    },
    async estSaveInsumo(codigo, patch) { ok(await sb.from('est_insumos').update({ ...patch, updated_at: new Date().toISOString() }).eq('codigo', codigo)) },
    async estSavePrato(codigo, patch) { ok(await sb.from('est_pratos').update(patch).eq('codigo', codigo)) },
    async estAddInsumo(row) { ok(await sb.from('est_insumos').insert(row)) },
    async estUpsertPrato(row) { ok(await sb.from('est_pratos').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'codigo' })) },
    async estSaveFicha(produto, linhas) {
      ok(await sb.from('est_fichas').delete().eq('produto_codigo', produto))
      if (linhas.length) ok(await sb.from('est_fichas').insert(linhas.map((l) => ({ produto_codigo: produto, insumo_codigo: l.insumo_codigo, qtd: l.qtd }))))
    },
    async estAddMovs(rows) { return ok(await sb.from('est_movs').insert(rows).select()) },
    async estDeleteMov(m) { ok(m.lote ? await sb.from('est_movs').delete().eq('lote', m.lote) : await sb.from('est_movs').delete().eq('id', m.id)) },
    async estNovaContagem(corte) { return ok(await sb.from('est_contagens').insert({ corte }).select().single()) },
    async estContar(contagem_id, insumo_codigo, qtd) {
      if (qtd == null) ok(await sb.from('est_contagem_itens').delete().eq('contagem_id', contagem_id).eq('insumo_codigo', insumo_codigo))
      else ok(await sb.from('est_contagem_itens').upsert({ contagem_id, insumo_codigo, qtd, at: new Date().toISOString() }))
    },
    async estFecharContagem(id, aberta = false) {
      const s = await this.session()
      ok(await sb.from('est_contagens').update(aberta ? { status: 'aberta', fechada_em: null, fechada_por: null } : { status: 'fechada', fechada_em: new Date().toISOString(), fechada_por: s?.user?.id }).eq('id', id))
    },
    async estExcluirContagem(id) { ok(await sb.from('est_contagens').delete().eq('id', id)) },
    async estSaveFichaProducao(processado, linhas) {
      ok(await sb.from('est_fichas_producao').delete().eq('processado_codigo', processado))
      if (linhas.length) ok(await sb.from('est_fichas_producao').insert(linhas.map((l) => ({ processado_codigo: processado, insumo_codigo: l.insumo_codigo, qtd: l.qtd }))))
    },
    async estSaveTransfMap(product_name, insumo_codigo, fator) {
      if (!insumo_codigo) ok(await sb.from('est_transf_map').delete().eq('product_name', product_name))
      else ok(await sb.from('est_transf_map').upsert({ product_name, insumo_codigo, fator }))
    },
  }

  async function signPhotos(reports) {
    const paths = reports.flatMap((r) => r.photos || [])
    if (!paths.length) return reports.map((r) => ({ ...r, photos: [] }))
    const { data } = await sb.storage.from('nutri-fotos').createSignedUrls(paths, 60 * 60 * 6)
    const url = Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]))
    return reports.map((r) => ({ ...r, photos: (r.photos || []).map((p) => url[p]).filter(Boolean) }))
  }
}

// =====================================================================
// Modo demonstração (localStorage)
// =====================================================================
function demoApi() {
  const KEY_DB = 'yankee-demo-db-v5'
  const KEY_NUTRI = 'yankee-demo-nutri-v2'
  const KEY_FIN = 'yankee-demo-fin-v1'
  let fin = null
  const saveFin = () => { try { localStorage.setItem(KEY_FIN, JSON.stringify(fin)) } catch { /* */ } }
  const loadFin = () => {
    if (fin) return fin
    try { const raw = localStorage.getItem(KEY_FIN); if (raw) fin = JSON.parse(raw) } catch { /* */ }
    if (!fin) { fin = { lancamentos: [], pagamentos: [], custos_fixos: [], vendas: [], historico: [] }; saveFin() }
    fin.itens ||= []; fin.produtos ||= []; fin.eventos ||= []; fin.insights ||= []
    return fin
  }
  const KEY_EST = 'yankee-demo-est-v1'
  let est = null
  const saveEst = () => { try { localStorage.setItem(KEY_EST, JSON.stringify(est)) } catch { /* */ } }
  const loadEst = () => {
    if (est) return est
    try { const raw = localStorage.getItem(KEY_EST); if (raw) est = JSON.parse(raw) } catch { /* */ }
    if (!est) { est = { insumos: [], pratos: [], fichas: [], fichasProd: [], movs: [], contagens: [], itensCont: [], transfMap: [] }; saveEst() }
    return est
  }
  const KEY_AS = 'yankee-demo-as'
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
  let db = null
  const save = () => { try { localStorage.setItem(KEY_DB, JSON.stringify(db)) } catch { /* sem storage: mantém em memória */ } }
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 60))
  let nutri = null
  const saveNutri = () => { try { localStorage.setItem(KEY_NUTRI, JSON.stringify(nutri)) } catch { /* fotos grandes podem estourar o espaço; mantém em memória */ } }
  const loadNutri = () => {
    if (nutri) return nutri
    try { const raw = localStorage.getItem(KEY_NUTRI); if (raw) nutri = JSON.parse(raw) } catch { /* */ }
    if (!nutri) { nutri = demoNutri(); saveNutri() }
    nutri.settings = { ...DEFAULT_SETTINGS, ...nutri.settings }
    return nutri
  }
  const clone = (x) => JSON.parse(JSON.stringify(x))

  async function load() {
    if (db) return db
    try { const raw = localStorage.getItem(KEY_DB); if (raw) db = JSON.parse(raw) } catch { /* ignora */ }
    if (db) return db
    // seed.json fica fora do git (.gitignore) para não expor dados no repositório
    const loader = import.meta.glob('./seed.json')['./seed.json']
    const seed = loader ? (await loader()).default : { products: [], transfers: [] }
    const units = [
      { id: 'u-yankee', code: 'YANKEE', name: 'Yankee Burger', is_hub: false },
      { id: 'u-zn', code: 'ZN', name: 'HubFood ZN', is_hub: true },
      { id: 'u-bv', code: 'BV', name: 'HubFood BV', is_hub: true },
    ]
    const byCode = Object.fromEntries(units.map((u) => [u.code, u.id]))
    const products = seed.products.map((p) => ({ id: uid(), name: p.name, price: p.price, unit: p.unit || 'kg', active: true, created_at: new Date().toISOString() }))
    const byName = Object.fromEntries(products.map((p) => [p.name, p.id]))
    const transfers = seed.transfers.map((t, i) => ({
      id: uid(), date: t.date, origin_id: byCode[t.origin], destination_id: byCode[t.destination],
      product_id: byName[t.product] || null, product_name: t.product, quantity: t.quantity, unit_price: t.unit_price,
      notes: t.notes, paid: t.paid, paid_at: null, created_by: 'demo-admin', created_at: new Date(Date.parse(t.date) + i).toISOString(),
    }))
    const profiles = [
      { id: 'demo-daniel', email: 'danielkiemle@yankeeburger.com.br', name: 'Daniel Kiemle', role: 'admin', master: true, access: ['financeiro'], unit_id: null, prefs: {} },
      { id: 'demo-rebeca', email: 'rebeca@yankeeburger.com.br', name: 'Rebeca', role: 'nutri', access: ['nutricao'], unit_id: null, prefs: {} },
      { id: 'demo-admin', email: 'raquel@yankeeburger.com.br', name: 'Raquel', role: 'admin', access: ['transferencias'], unit_id: null, prefs: {} },
      { id: 'demo-zn', email: 'zn@yankeeburger.com.br', name: 'Equipe HubFood ZN', role: 'hub', unit_id: 'u-zn', prefs: {} },
      { id: 'demo-bv', email: 'bv@yankeeburger.com.br', name: 'Equipe HubFood BV', role: 'hub', unit_id: 'u-bv', prefs: {} },
    ]
    db = { units, products, transfers, profiles }
    save()
    return db
  }
  const me = () => { let id = 'demo-daniel'; try { id = localStorage.getItem(KEY_AS) || id } catch { /* */ } return db.profiles.find((p) => p.id === id) || db.profiles[0] }
  const visible = (t) => { const p = me(); return p.role === 'admin' || t.origin_id === p.unit_id || t.destination_id === p.unit_id }

  return {
    demo: true,
    async session() { await load(); return { user: { id: me().id, email: me().email } } },
    onAuth() { return () => {} },
    async signIn() {}, async signUp() {}, async resetPassword() {}, async updatePassword() {}, async signOut() {},
    async viewAs(id) { try { localStorage.setItem(KEY_AS, id) } catch { /* */ } },
    async resetDemo() { try { localStorage.removeItem(KEY_DB); localStorage.removeItem(KEY_NUTRI); localStorage.removeItem(KEY_FIN); localStorage.removeItem(KEY_EST) } catch { /* */ } db = null; nutri = null; fin = null; est = null; await load() },

    async profile() { await load(); return { ...me() } },
    async savePrefs(prefs) { await load(); me().prefs = prefs; save() },

    async units() { await load(); return delay(db.units.map((u) => ({ ...u }))) },
    async saveUnit(u) {
      await load()
      if (u.id) { Object.assign(db.units.find((x) => x.id === u.id), u) } else { u = { ...u, id: uid() }; db.units.push(u) }
      save(); return { ...u }
    },
    async deleteUnit(id) {
      await load()
      if (db.transfers.some((t) => t.origin_id === id || t.destination_id === id)) throw new Error('Unidade possui transferências e não pode ser excluída')
      db.units = db.units.filter((u) => u.id !== id); save()
    },

    async products() { await load(); return delay(db.products.map((p) => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name))) },
    async saveProduct(p) {
      await load()
      const dupe = db.products.find((x) => x.name.toLowerCase() === p.name.toLowerCase() && x.id !== p.id)
      if (dupe) throw new Error('Já existe um produto com esse nome')
      if (p.id) Object.assign(db.products.find((x) => x.id === p.id), p, { updated_at: new Date().toISOString() })
      else { p = { active: true, ...p, id: uid(), created_at: new Date().toISOString() }; db.products.push(p) }
      save(); return { ...p }
    },
    async deleteProduct(id) {
      await load()
      db.products = db.products.filter((p) => p.id !== id)
      db.transfers.forEach((t) => { if (t.product_id === id) t.product_id = null })
      save()
    },

    async transfers() {
      await load()
      return delay(db.transfers.filter(visible).map(withTotal).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)))
    },
    async createTransfers(rows) {
      await load()
      const created = rows.map((r) => ({ paid: false, paid_at: null, notes: null, ...r, id: uid(), created_by: me().id, created_at: new Date().toISOString() }))
      db.transfers.push(...created); save()
      return created.map(withTotal)
    },
    async updateTransfer(t) {
      await load()
      const cur = db.transfers.find((x) => x.id === t.id)
      const { total, paid, paid_at, ...rest } = t
      Object.assign(cur, rest); save(); return withTotal(cur)
    },
    async deleteTransfers(ids) { await load(); const s = new Set(ids); db.transfers = db.transfers.filter((t) => !s.has(t.id)); save() },
    async setPaid(ids, value) {
      await load()
      const p = me(); const s = new Set(ids); let n = 0
      db.transfers.forEach((t) => {
        if (s.has(t.id) && (p.role === 'admin' || t.destination_id === p.unit_id)) {
          t.paid = value; t.paid_at = value ? new Date().toISOString() : null; n++
        }
      })
      save(); return n
    },

    async profiles() { await load(); return db.profiles.map((p) => ({ ...p })) },
    async setUserPassword() {},

    // ----- Painel Nutrição -----
    async nutriLoad() { await load(); return delay(clone(loadNutri())) },
    async nutriSaveEmployee(e) {
      const n = loadNutri()
      if (e.id) Object.assign(n.employees.find((x) => x.id === e.id), e)
      else { e = { active: true, ...e, id: uid() }; n.employees.push(e) }
      saveNutri(); return clone(e)
    },
    async nutriDeleteEmployee(id) { const n = loadNutri(); n.employees = n.employees.filter((e) => e.id !== id); n.points.forEach((p) => { if (p.employee_id === id) p.employee_id = null }); saveNutri() },
    async nutriCreateReport(report, points) {
      const n = loadNutri()
      const r = { ...report, id: uid(), author: me().name, created_at: new Date().toISOString() }
      const ps = points.map((p) => ({ ...p, id: uid(), report_id: r.id, date: r.date, status: p.type === 'neg' ? 'aberto' : null, response: '', due_date: p.type === 'neg' ? p.due_date || null : null }))
      n.reports.push(r); n.points.push(...ps); saveNutri()
      return clone({ report: r, points: ps })
    },
    async nutriDeleteReport(id) { const n = loadNutri(); n.reports = n.reports.filter((r) => r.id !== id); n.points = n.points.filter((p) => p.report_id !== id); saveNutri() },
    async nutriUpdatePoint(id, patch) {
      const n = loadNutri(); const p = n.points.find((x) => x.id === id)
      Object.assign(p, patch); if (patch.status === 'resolvido') p.resolved_at = new Date().toISOString()
      saveNutri(); return clone(p)
    },
    async nutriSaveSettings(settings) { const n = loadNutri(); n.settings = settings; saveNutri(); return clone(settings) },

    // ----- Painel Financeiro (demonstração: guardado no navegador) -----
    async finLoad() { await load(); const f = clone(loadFin()); f.pratos = clone(loadEst().pratos); return delay(f) },
    async finSetPago(ids, data) {
      const f = loadFin(); f.pagamentos = f.pagamentos.filter((p) => !ids.includes(p.id))
      if (data) f.pagamentos.push(...ids.map((id) => ({ id, data, at: new Date().toISOString() })))
      saveFin()
    },
    async finSaveFixo(x) {
      const f = loadFin()
      if (x.id) Object.assign(f.custos_fixos.find((c) => c.id === x.id), x)
      else { x = { ...x, id: uid(), created_at: new Date().toISOString() }; f.custos_fixos.push(x) }
      saveFin(); return clone(x)
    },
    async finDeleteFixo(id) { const f = loadFin(); f.custos_fixos = f.custos_fixos.filter((c) => c.id !== id); saveFin() },
    async finSaveLancamento(l) { const f = loadFin(); f.lancamentos = [...f.lancamentos.filter((x) => x.id !== l.id), l]; saveFin(); return clone(l) },
    async finDeleteLancamento(id) { const f = loadFin(); f.lancamentos = f.lancamentos.filter((x) => x.id !== id); f.pagamentos = f.pagamentos.filter((p) => p.id !== id); saveFin() },
    async finImport(kind, rows) {
      const f = loadFin()
      const key = { lancamentos: (r) => r.id, vendas: (r) => `${r.dia}|${r.unidade}|${r.forma}`, historico: (r) => `${r.mes}|${r.unidade}` }[kind]
      const m = new Map(f[kind].map((r) => [key(r), r])); rows.forEach((r) => m.set(key(r), r)); f[kind] = [...m.values()]; saveFin()
    },
    async finImportItens(unidade, dias, rows) {
      const f = loadFin(); f.itens = [...f.itens.filter((r) => !(r.unidade === unidade && dias.includes(r.dia))), ...rows]; saveFin()
    },
    async finSaveProdutos(rows) {
      const f = loadFin(); const m = new Map(f.produtos.map((p) => [p.codigo, p])); rows.forEach((r) => m.set(r.codigo, r)); f.produtos = [...m.values()]; saveFin()
    },
    async finSaveEvento(ev, itens) {
      const f = loadFin(); f.eventos = f.eventos || []
      const x = { status: 'agendado', ...ev, id: ev.id || uid(), itens: itens.map((i) => ({ ...i })) }
      f.eventos = [...f.eventos.filter((e) => e.id !== x.id), x]; saveFin(); return clone(x)
    },
    async finSetEventoStatus(id, status) { const f = loadFin(); Object.assign(f.eventos.find((e) => e.id === id), { status }); saveFin() },
    async finDeleteEvento(id) { const f = loadFin(); f.eventos = (f.eventos || []).filter((e) => e.id !== id); saveFin() },
    async finDeleteInsight(id) { const f = loadFin(); f.insights = (f.insights || []).filter((e) => e.id !== id); saveFin() },

    // ----- Estoque (demonstração) -----
    async estLoad(de = EST_INICIO) {
      await load(); const e = loadEst(); const f = loadFin()
      const saidas = saidasLocal({ itens: f.itens, fichas: e.fichas, transfers: db.transfers, transfMap: e.transfMap, units: db.units, de, eventos: f.eventos })
      return delay(clone(normEst({ ...e, fichasProd: e.fichasProd, itensCont: e.itensCont, saidas, vendas: f.itens.filter((i) => i.dia >= de && i.unidade === 'ZN Salão') })))
    },
    async estProdutosTransf() {
      await load(); const m = new Map()
      for (const t of db.transfers) { const p = db.products.find((x) => x.id === t.product_id); const o = m.get(t.product_name) || { product_name: t.product_name, unit: p?.unit || '', qtd: 0 }; o.qtd += Number(t.quantity); m.set(t.product_name, o) }
      return [...m.values()]
    },
    async estImport3lm({ insumos, existentes, pratos, linhas }) {
      const e = loadEst(); const m = new Map(e.insumos.map((i) => [i.codigo, i]))
      insumos.forEach((i) => { const old = m.get(i.codigo); m.set(i.codigo, old ? { ...old, ...i, ativo: old.ativo, litros: old.litros ?? i.litros } : { estoque_min: 0, tolerancia: 0.03, ...i }) })
      e.insumos = [...m.values()]
      if (pratos?.length) {
        const pm = new Map(e.pratos.map((p) => [p.codigo, p])); pratos.forEach((p) => pm.set(p.codigo, { estrategico: false, ...pm.get(p.codigo), ...p })); e.pratos = [...pm.values()]
        const cods = new Set(pratos.map((p) => p.codigo)); e.fichas = [...e.fichas.filter((f) => !cods.has(f.produto_codigo)), ...linhas]
      }
      saveEst()
    },
    async estSaveInsumo(codigo, patch) { const e = loadEst(); Object.assign(e.insumos.find((i) => i.codigo === codigo), patch); saveEst() },
    async estSavePrato(codigo, patch) { const e = loadEst(); Object.assign(e.pratos.find((i) => i.codigo === codigo), patch); saveEst() },
    async estAddInsumo(row) { const e = loadEst(); if (e.insumos.some((i) => i.codigo === row.codigo)) throw new Error('Já existe um insumo com esse código.'); e.insumos.push({ estoque_min: 0, tolerancia: 0.03, preco_medio: 0, preco_ultimo: 0, ...row }); saveEst() },
    async estUpsertPrato(row) { const e = loadEst(); const o = e.pratos.find((p) => p.codigo === row.codigo); if (o) Object.assign(o, row); else e.pratos.push({ estrategico: false, ...row }); saveEst() },
    async estSaveFicha(produto, linhas) { const e = loadEst(); e.fichas = [...e.fichas.filter((f) => f.produto_codigo !== produto), ...linhas.map((l) => ({ produto_codigo: produto, insumo_codigo: l.insumo_codigo, qtd: l.qtd }))]; saveEst() },
    async estAddMovs(rows) { const e = loadEst(); const out = rows.map((r) => ({ id: uid(), created_at: new Date().toISOString(), ...r })); e.movs.push(...out); saveEst(); return clone(out) },
    async estDeleteMov(m) { const e = loadEst(); e.movs = e.movs.filter((x) => (m.lote ? x.lote !== m.lote : x.id !== m.id)); saveEst() },
    async estNovaContagem(corte) { const e = loadEst(); const c = { id: uid(), corte, status: 'aberta', created_at: new Date().toISOString() }; e.contagens.push(c); saveEst(); return clone(c) },
    async estContar(contagem_id, insumo_codigo, qtd) {
      const e = loadEst(); e.itensCont = e.itensCont.filter((i) => !(i.contagem_id === contagem_id && i.insumo_codigo === insumo_codigo))
      if (qtd != null) e.itensCont.push({ contagem_id, insumo_codigo, qtd, at: new Date().toISOString() }); saveEst()
    },
    async estFecharContagem(id, aberta = false) { const e = loadEst(); Object.assign(e.contagens.find((c) => c.id === id), aberta ? { status: 'aberta', fechada_em: null } : { status: 'fechada', fechada_em: new Date().toISOString() }); saveEst() },
    async estExcluirContagem(id) { const e = loadEst(); e.contagens = e.contagens.filter((c) => c.id !== id); e.itensCont = e.itensCont.filter((i) => i.contagem_id !== id); saveEst() },
    async estSaveFichaProducao(processado, linhas) { const e = loadEst(); e.fichasProd = [...e.fichasProd.filter((f) => f.processado_codigo !== processado), ...linhas.map((l) => ({ processado_codigo: processado, ...l }))]; saveEst() },
    async estSaveTransfMap(product_name, insumo_codigo, fator) { const e = loadEst(); e.transfMap = e.transfMap.filter((m) => m.product_name !== product_name); if (insumo_codigo) e.transfMap.push({ product_name, insumo_codigo, fator }); saveEst() },
    async saveProfile(p) { await load(); Object.assign(db.profiles.find((x) => x.id === p.id), { role: p.role, unit_id: p.unit_id || null, name: p.name }); save() },
  }
}

export const api = DEMO ? demoApi() : supabaseApi()
