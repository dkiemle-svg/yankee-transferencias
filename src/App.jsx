import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, LayoutDashboard, Package, LogOut, Moon, Sun, KeyRound } from 'lucide-react'
import { api, DEMO } from './lib/api.js'
import { ToastProvider, ConfirmProvider, Modal, useToast } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Transfers from './pages/Transfers.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Catalog from './pages/Catalog.jsx'

const TABS = [
  { id: 'transferencias', label: 'Transferências', icon: ArrowLeftRight },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cadastros', label: 'Produtos', icon: Package },
]

function useHashTab() {
  const read = () => { const h = window.location.hash.replace('#', ''); return TABS.some((t) => t.id === h) ? h : 'transferencias' }
  const [tab, setTab] = useState(read)
  useEffect(() => { const f = () => setTab(read()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return [tab, (t) => { window.location.hash = t; setTab(t) }]
}

function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('yankee-theme') || '' } catch { return '' } })
  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme')
    try { localStorage.setItem('yankee-theme', theme) } catch { /* */ }
  }, [theme])
  const isDark = theme ? theme === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return [isDark, () => setTheme(isDark ? 'light' : 'dark')]
}

export default function App() {
  return <ToastProvider><ConfirmProvider><Shell /></ConfirmProvider></ToastProvider>
}

function Shell() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [data, setData] = useState({ units: [], products: [], transfers: [], loaded: false })
  const [error, setError] = useState('')
  const [tab, setTab] = useHashTab()
  const [isDark, toggleTheme] = useTheme()
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    api.session().then(setSession).catch((e) => { setError(e.message); setSession(null) })
    return api.onAuth((s, ev) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true) })
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const p = await api.profile()
      setProfile(p)
      if (!p || p.role === 'pending') { setData((d) => ({ ...d, loaded: true })); return }
      const [units, products, transfers] = await Promise.all([api.units(), api.products(), api.transfers()])
      setData({ units, products, transfers, loaded: true })
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { if (session) loadAll(); else { setProfile(null); setData({ units: [], products: [], transfers: [], loaded: false }) } }, [session?.user?.id, loadAll])

  const unitsById = useMemo(() => Object.fromEntries(data.units.map((u) => [u.id, u])), [data.units])
  const measureOf = useMemo(() => {
    const byId = new Map(data.products.map((p) => [p.id, p.unit]))
    const byName = new Map(data.products.map((p) => [p.name, p.unit]))
    return (t) => (t.product_id && byId.get(t.product_id)) || byName.get(t.product_name) || ''
  }, [data.products])
  const store = {
    ...data, unitsById, measureOf, profile, isAdmin: profile?.role === 'admin', reload: loadAll,
    setTransfers: (fn) => setData((d) => ({ ...d, transfers: typeof fn === 'function' ? fn(d.transfers) : fn })),
    setProducts: (fn) => setData((d) => ({ ...d, products: typeof fn === 'function' ? fn(d.products) : fn })),
    setUnits: (fn) => setData((d) => ({ ...d, units: typeof fn === 'function' ? fn(d.units) : fn })),
    setProfile,
  }

  if (session === undefined) return <Loading />
  if (!session) return <Login />

  const myUnit = profile?.unit_id ? unitsById[profile.unit_id] : null
  const initials = (profile?.name || profile?.email || '?').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()

  return (
    <>
      {DEMO && <DemoBanner profile={profile} onSwitch={async (id) => { await api.viewAs(id); await loadAll() }} onReset={async () => { await api.resetDemo(); await loadAll() }} />}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand"><div className="brand-mark">Y</div><div>Yankee Burger<small>Transferências entre unidades</small></div></div>
          <nav className="tabs" role="tablist">
            {TABS.map(({ id, label, icon: I }) => (
              <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}><I size={16} />{id === 'cadastros' && store.isAdmin ? 'Cadastros' : label}</button>
            ))}
          </nav>
          <div className="topbar-right">
            <button className="btn ghost icon" onClick={toggleTheme} aria-label="Alternar tema" title="Alternar tema claro/escuro">{isDark ? <Sun /> : <Moon />}</button>
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <div className="who">{profile?.name || profile?.email}<small>{store.isAdmin ? 'Administrativo' : myUnit?.name || 'Aguardando liberação'}</small></div>
              {!DEMO && <button className="btn ghost icon" onClick={() => setRecovery(true)} aria-label="Trocar senha" title="Trocar minha senha"><KeyRound /></button>}
              {!DEMO && <button className="btn ghost icon" onClick={() => api.signOut()} aria-label="Sair" title="Sair"><LogOut /></button>}
            </div>
          </div>
        </div>
      </header>
      <main className="page">
        {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
        {!data.loaded ? <Loading /> : profile?.role === 'pending' || (profile?.role === 'hub' && !myUnit) ? <Pending profile={profile} /> : (
          <>
            {tab === 'transferencias' && <Transfers store={store} />}
            {tab === 'dashboard' && <Dashboard store={store} />}
            {tab === 'cadastros' && <Catalog store={store} />}
          </>
        )}
      </main>
      {recovery && <NewPassword onClose={() => setRecovery(false)} />}
    </>
  )
}

function Loading() { return <div className="center-screen"><div><div className="spinner" />Carregando…</div></div> }

function Pending({ profile }) {
  return (
    <div className="center-screen">
      <div className="card card-pad" style={{ maxWidth: 440 }}>
        <h2 style={{ marginTop: 0 }}>Conta aguardando liberação</h2>
        <p>Olá, {profile?.name || profile?.email}. Seu acesso foi criado e agora precisa ser liberado pelo administrativo, que vai vincular você à sua unidade.</p>
        <button className="btn" onClick={() => window.location.reload()}>Verificar novamente</button>
      </div>
    </div>
  )
}

function DemoBanner({ profile, onSwitch, onReset }) {
  return (
    <div className="demo-banner"><div className="inner">
      <strong>Modo demonstração</strong>
      <span>dados da planilha salvos só neste navegador.</span>
      <label>Ver como:{' '}
        <select value={profile?.id || 'demo-admin'} onChange={(e) => onSwitch(e.target.value)}>
          <option value="demo-admin">Raquel · Administrativo</option>
          <option value="demo-zn">Equipe HubFood ZN</option>
          <option value="demo-bv">Equipe HubFood BV</option>
        </select>
      </label>
      <button onClick={onReset}>Restaurar dados originais</button>
    </div></div>
  )
}

function NewPassword({ onClose }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const toast = useToast()
  const save = async (e) => {
    e.preventDefault()
    try { await api.updatePassword(pw); toast('Senha alterada.'); onClose() } catch (e2) { setErr(e2.message) }
  }
  return (
    <Modal title="Trocar minha senha" onClose={onClose} footer={<button className="btn primary" form="np">Salvar senha</button>}>
      <form id="np" onSubmit={save} className="field">
        <span>Nova senha</span>
        <input className="input" type="password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
        {err && <div className="err">{err}</div>}
      </form>
    </Modal>
  )
}
