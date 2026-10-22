import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, LayoutDashboard, Package, LogOut, Moon, Sun, KeyRound, ClipboardList, ListChecks, Users, Trophy, Home as HomeIcon, Salad, FileChartColumn } from 'lucide-react'
import { api, DEMO } from './lib/api.js'
import { ToastProvider, ConfirmProvider, Modal, useToast } from './components/ui.jsx'
import Login from './pages/Login.jsx'
import Transfers from './pages/Transfers.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Catalog from './pages/Catalog.jsx'
import Home from './pages/Home.jsx'
import NutriPanel from './pages/NutriPanel.jsx'

// Painéis do sistema. Cada um tem um responsável e suas próprias abas.
export const PANELS = [
  {
    key: 'transferencias', name: 'Transferências', icon: ArrowLeftRight, owner: 'Raquel · Administrativo',
    desc: 'Envios da Yankee para os HubFood, pagamentos em lote e relatórios.',
    tabs: [
      { id: 'transferencias', label: 'Transferências', icon: ArrowLeftRight },
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'cadastros', label: 'Cadastros', icon: Package },
    ],
  },
  {
    key: 'nutricao', name: 'Nutrição', icon: Salad, owner: 'Rebeca · Nutricionista',
    desc: 'Relatórios semanais da nutricionista, ações por funcionário, ranking e metas.',
    tabs: [
      { id: 'nutri-relatorios', label: 'Relatórios', icon: ClipboardList },
      { id: 'nutri-acoes', label: 'Ações', icon: ListChecks },
      { id: 'nutri-equipe', label: 'Equipe', icon: Users },
      { id: 'nutri-entrega', label: 'Relatório da equipe', icon: FileChartColumn },
      { id: 'nutri-ranking', label: 'Ranking e metas', icon: Trophy },
    ],
  },
]
const panelOfTab = (tab) => PANELS.find((p) => p.tabs.some((t) => t.id === tab))

// Quem acessa o quê: masters veem tudo; os demais, só o painel do qual são responsáveis
export function panelsFor(profile) {
  if (!profile) return []
  if (profile.master) return PANELS.map((p) => p.key)
  if (Array.isArray(profile.access) && profile.access.length) return profile.access
  if (profile.role === 'nutri') return ['nutricao']
  if (profile.role === 'admin' || profile.role === 'hub') return ['transferencias']
  return []
}

function useHashRoute() {
  const read = () => { const h = window.location.hash.replace('#', ''); return panelOfTab(h) ? h : 'inicio' }
  const [route, setRoute] = useState(read)
  useEffect(() => { const f = () => setRoute(read()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, [])
  return [route, (r) => { window.location.hash = r; setRoute(r); window.scrollTo(0, 0) }]
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

const EMPTY = { units: [], products: [], transfers: [], nutri: null, loaded: false }

function Shell() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [data, setData] = useState(EMPTY)
  const [error, setError] = useState('')
  const [route, setRoute] = useHashRoute()
  const [isDark, toggleTheme] = useTheme()
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    api.session().then(setSession).catch((e) => { setError(e.message); setSession(null) })
    return api.onAuth((s, ev) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true) })
  }, [])

  const loadAll = useCallback(async () => {
    try {
      setError('')
      const p = await api.profile()
      setProfile(p)
      const allowed = panelsFor(p)
      if (!p || p.role === 'pending' || !allowed.length) { setData({ ...EMPTY, loaded: true }); return }
      const [units, products, transfers, nutri] = await Promise.all([
        allowed.includes('transferencias') || allowed.includes('nutricao') ? api.units() : [],
        allowed.includes('transferencias') ? api.products() : [],
        allowed.includes('transferencias') ? api.transfers() : [],
        allowed.includes('nutricao') && api.nutriLoad ? api.nutriLoad() : null,
      ])
      setData({ units, products, transfers, nutri, loaded: true })
    } catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { if (session) loadAll(); else { setProfile(null); setData(EMPTY) } }, [session?.user?.id, loadAll])

  const unitsById = useMemo(() => Object.fromEntries(data.units.map((u) => [u.id, u])), [data.units])
  const measureOf = useMemo(() => {
    const byId = new Map(data.products.map((p) => [p.id, p.unit]))
    const byName = new Map(data.products.map((p) => [p.name, p.unit]))
    return (t) => (t.product_id && byId.get(t.product_id)) || byName.get(t.product_name) || ''
  }, [data.products])
  const allowed = panelsFor(profile)
  const store = {
    ...data, unitsById, measureOf, profile, isAdmin: profile?.role === 'admin', isMaster: !!profile?.master, allowed, reload: loadAll,
    setTransfers: (fn) => setData((d) => ({ ...d, transfers: typeof fn === 'function' ? fn(d.transfers) : fn })),
    setProducts: (fn) => setData((d) => ({ ...d, products: typeof fn === 'function' ? fn(d.products) : fn })),
    setUnits: (fn) => setData((d) => ({ ...d, units: typeof fn === 'function' ? fn(d.units) : fn })),
    setNutri: (fn) => setData((d) => ({ ...d, nutri: typeof fn === 'function' ? fn(d.nutri) : fn })),
    setProfile, go: setRoute,
  }

  if (session === undefined) return <Loading />
  if (!session) return <Login />

  const myUnit = profile?.unit_id ? unitsById[profile.unit_id] : null
  const initials = (profile?.name || profile?.email || '?').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()
  const panel = panelOfTab(route)
  const canSee = panel && allowed.includes(panel.key)
  const roleLabel = profile?.master ? 'Acesso master' : profile?.role === 'nutri' ? 'Nutricionista' : profile?.role === 'admin' ? 'Administrativo' : myUnit?.name || 'Aguardando liberação'

  return (
    <>
      {DEMO && <DemoBanner profile={profile} onSwitch={async (id) => { await api.viewAs(id); setRoute('inicio'); await loadAll() }} onReset={async () => { await api.resetDemo(); await loadAll() }} />}
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand brand-btn" onClick={() => setRoute('inicio')} title="Voltar para o início">
            <div className="brand-mark">Y</div>
            <div>Yankee Burger<small>{panel ? `Painel ${panel.name}` : 'Central de gestão'}</small></div>
          </button>
          {panel && canSee && <nav className="tabs" role="tablist">
            {(
              <>
                <button className="tab" onClick={() => setRoute('inicio')} aria-label="Início"><HomeIcon size={16} /><span className="hide-sm">Início</span></button>
                {panel.tabs.map(({ id, label, icon: I }) => (
                  <button key={id} role="tab" className="tab" aria-selected={route === id} onClick={() => setRoute(id)}>
                    <I size={16} />{id === 'cadastros' && !store.isAdmin ? 'Produtos' : label}
                  </button>
                ))}
              </>
            )}
          </nav>}
          <div className="topbar-right">
            <button className="btn ghost icon" onClick={toggleTheme} aria-label="Alternar tema" title="Alternar tema claro/escuro">{isDark ? <Sun /> : <Moon />}</button>
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <div className="who">{profile?.name || profile?.email}<small>{roleLabel}</small></div>
              {!DEMO && <button className="btn ghost icon" onClick={() => setRecovery(true)} aria-label="Trocar senha" title="Trocar minha senha"><KeyRound /></button>}
              {!DEMO && <button className="btn ghost icon" onClick={() => api.signOut()} aria-label="Sair" title="Sair"><LogOut /></button>}
            </div>
          </div>
        </div>
      </header>
      <main className="page">
        {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
        {!data.loaded ? <Loading /> : profile?.role === 'pending' || !allowed.length || (profile?.role === 'hub' && !myUnit) ? <Pending profile={profile} /> : (
          <>
            {(!panel || !canSee) && <Home store={store} panels={PANELS} />}
            {canSee && route === 'transferencias' && <Transfers store={store} />}
            {canSee && route === 'dashboard' && <Dashboard store={store} />}
            {canSee && route === 'cadastros' && <Catalog store={store} />}
            {canSee && panel.key === 'nutricao' && <NutriPanel store={store} tab={route} go={setRoute} />}
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
        <p>Olá, {profile?.name || profile?.email}. Seu acesso foi criado e agora precisa ser liberado por um administrador, que vai definir quais painéis você vê.</p>
        <button className="btn" onClick={() => window.location.reload()}>Verificar novamente</button>
      </div>
    </div>
  )
}

function DemoBanner({ profile, onSwitch, onReset }) {
  return (
    <div className="demo-banner"><div className="inner">
      <strong>Prévia para aprovação</strong>
      <span>dados de exemplo, salvos só neste navegador.</span>
      <label>Ver como:{' '}
        <select value={profile?.id || 'demo-daniel'} onChange={(e) => onSwitch(e.target.value)}>
          <option value="demo-daniel">Daniel · Master</option>
          <option value="demo-admin">Raquel · Transferências</option>
          <option value="demo-rebeca">Rebeca · Nutricionista</option>
          <option value="demo-zn">Equipe HubFood ZN</option>
        </select>
      </label>
      <button onClick={onReset}>Restaurar dados de exemplo</button>
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
