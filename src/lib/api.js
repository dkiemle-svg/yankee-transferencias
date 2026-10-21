// Camada de dados: usa o Supabase quando configurado, ou o modo demonstração
// (dados da planilha guardados no navegador) quando não houver credenciais.
import { createClient } from '@supabase/supabase-js'
import { round2 } from './format.js'
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
    async saveProfile(p) { ok(await sb.from('profiles').update({ role: p.role, unit_id: p.unit_id || null, name: p.name }).eq('id', p.id)) },
    async setUserPassword(id, password) { ok(await sb.rpc('admin_set_password', { target: id, new_password: password })) },
  }
}

// =====================================================================
// Modo demonstração (localStorage)
// =====================================================================
function demoApi() {
  const KEY_DB = 'yankee-demo-db-v3'
  const KEY_AS = 'yankee-demo-as'
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
  let db = null
  const save = () => { try { localStorage.setItem(KEY_DB, JSON.stringify(db)) } catch { /* sem storage: mantém em memória */ } }
  const delay = (v) => new Promise((r) => setTimeout(() => r(v), 60))

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
      { id: 'demo-admin', email: 'raquel@yankeeburger.com.br', name: 'Raquel (Administrativo)', role: 'admin', unit_id: null, prefs: {} },
      { id: 'demo-zn', email: 'zn@yankeeburger.com.br', name: 'Equipe HubFood ZN', role: 'hub', unit_id: 'u-zn', prefs: {} },
      { id: 'demo-bv', email: 'bv@yankeeburger.com.br', name: 'Equipe HubFood BV', role: 'hub', unit_id: 'u-bv', prefs: {} },
    ]
    db = { units, products, transfers, profiles }
    save()
    return db
  }
  const me = () => { let id = 'demo-admin'; try { id = localStorage.getItem(KEY_AS) || id } catch { /* */ } return db.profiles.find((p) => p.id === id) || db.profiles[0] }
  const visible = (t) => { const p = me(); return p.role === 'admin' || t.origin_id === p.unit_id || t.destination_id === p.unit_id }

  return {
    demo: true,
    async session() { await load(); return { user: { id: me().id, email: me().email } } },
    onAuth() { return () => {} },
    async signIn() {}, async signUp() {}, async resetPassword() {}, async updatePassword() {}, async signOut() {},
    async viewAs(id) { try { localStorage.setItem(KEY_AS, id) } catch { /* */ } },
    async resetDemo() { try { localStorage.removeItem(KEY_DB) } catch { /* */ } db = null; await load() },

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
    async saveProfile(p) { await load(); Object.assign(db.profiles.find((x) => x.id === p.id), { role: p.role, unit_id: p.unit_id || null, name: p.name }); save() },
  }
}

export const api = DEMO ? demoApi() : supabaseApi()
