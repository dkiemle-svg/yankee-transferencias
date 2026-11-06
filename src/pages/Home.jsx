import React, { useEffect, useState } from 'react'
import { ArrowRight, Lock, UserPlus } from 'lucide-react'
import { api, DEMO } from '../lib/api.js'

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite' }

// Página inicial: só os nomes dos painéis que a pessoa pode abrir
export default function Home({ store, panels }) {
  const { profile, allowed, isMaster } = store
  const first = (profile?.name || '').split(' ')[0]
  const [waiting, setWaiting] = useState(0)
  useEffect(() => {
    if (!isMaster || DEMO) return
    api.profiles().then((l) => setWaiting(l.filter((p) => p.role === 'pending').length)).catch(() => {})
  }, [isMaster])

  const visible = panels.filter((p) => allowed.includes(p.key) || (isMaster && !p.restricted))

  return (
    <div className="home">
      <div className="home-head">
        <p className="eyebrow">{(() => { const s = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1) })()}</p>
        <h1>{greeting()}{first ? `, ${first}` : ''}.</h1>
        <p className="muted">{visible.length > 1 ? 'Escolha um painel para começar.' : 'Este é o seu painel.'}</p>
      </div>

      {waiting > 0 && (
        <button className="note warn waiting-note" onClick={() => store.go('cadastros')}>
          <UserPlus size={16} />
          <span><strong>{waiting} conta{waiting > 1 ? 's' : ''} aguardando liberação.</strong> Ninguém tem acesso até você liberar em Cadastros → Usuários.</span>
        </button>
      )}

      <div className="panel-grid">
        {visible.map((p) => {
          const I = p.icon
          const can = allowed.includes(p.key)
          return (
            <button key={p.key} className={`panel-card panel-card-min ${can ? '' : 'locked'}`} onClick={() => can && store.go(p.tabs[0].id)} disabled={!can}>
              <span className={`panel-icon pi-${p.key}`}><I /></span>
              <strong className="panel-name">{p.name}</strong>
              {can ? <ArrowRight className="panel-go" /> : <Lock className="panel-go" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
