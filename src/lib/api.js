// Camada de dados: usa o Supabase quando configurado, ou o modo demonstração
// (dados da planilha guardados no navegador) quando não houver credenciais.
import { createClient } from '@supabase/supabase-js'
import { round2 } from './format.js'
import { demoNutri, DEFAULT_SETTINGS } from './nutri.js'
import { SUPABASE_URL as URL, SUPABASE_KEY as KEY, toEmail } from '../config.js'

export const DEMO = import.meta.env.MODE === 'demo' || !URL || !KEY || URL.startsWith('__')

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
      const rows = points.map((p) => ({ report_id: rid, date: report.date, employee_id: p.employee_id || null, type: p.type, sector: p.sector || null, text: p.text, involved: p.involved || [], status: p.type === 'neg' ? 'aberto' : null }))
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
  const KEY_DB = 'yankee-demo-db-v4'
  const KEY_NUTRI = 'yankee-demo-nutri-v2'
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
      { id: 'demo-daniel', email: 'danielkiemle@yankeeburger.com.br', name: 'Daniel Kiemle', role: 'admin', master: true, unit_id: null, prefs: {} },
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
    async resetDemo() { try { localStorage.removeItem(KEY_DB); localStorage.removeItem(KEY_NUTRI) } catch { /* */ } db = null; nutri = null; await load() },

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
      const ps = points.map((p) => ({ ...p, id: uid(), report_id: r.id, date: r.date, status: p.type === 'neg' ? 'aberto' : null, response: '', due_date: null }))
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
    async saveProfile(p) { await load(); Object.assign(db.profiles.find((x) => x.id === p.id), { role: p.role, unit_id: p.unit_id || null, name: p.name }); save() },
  }
}

export const api = DEMO ? demoApi() : supabaseApi()
