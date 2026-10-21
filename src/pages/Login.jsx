import React, { useState } from 'react'
import { api } from '../lib/api.js'

const ERRORS = {
  'Invalid login credentials': 'Usuário ou senha incorretos.',
  'User already registered': 'Esse usuário já existe. Use “Entrar”.',
  'Email not confirmed': 'Conta ainda não confirmada. Fale com o administrativo.',
}

export default function Login() {
  const [mode, setMode] = useState('login') // login | signup
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      if (!/^[a-zA-Z0-9._-]{3,}$/.test(user.trim()) && !user.includes('@')) throw new Error('Usuário: use pelo menos 3 letras ou números, sem espaços.')
      if (mode === 'login') await api.signIn(user, password)
      else {
        const r = await api.signUp(user, password, name.trim())
        if (!r?.session) { setMsg({ ok: true, text: 'Conta criada. Agora é só entrar.' }); setMode('login') }
      }
    } catch (err) {
      setMsg({ ok: false, text: ERRORS[err.message] || err.message })
    } finally { setBusy(false) }
  }

  const swap = (m) => (e) => { e.preventDefault(); setMode(m); setMsg(null) }

  return (
    <div className="login">
      <div className="login-art">
        <div className="brand"><div className="brand-mark">Y</div><div>Yankee Burger<small style={{ color: '#9a9993' }}>Transferências entre unidades</small></div></div>
        <div>
          <h2>Tudo o que sai da Yankee para os HubFood, num só lugar.</h2>
          <p>Lançamentos, pagamentos e relatórios de HubFood ZN e HubFood BV, sem planilha.</p>
        </div>
        <small style={{ color: '#6f6e69', position: 'relative' }}>Acesso restrito à equipe</small>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <div>
            <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>{mode === 'signup' ? 'Escolha um usuário e uma senha. O administrativo libera seu acesso.' : 'Use seu usuário e senha.'}</p>
          </div>
          {mode === 'signup' && <label className="field"><span>Nome</span><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>}
          <label className="field"><span>Usuário</span><input id="user" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} required /></label>
          <label className="field"><span>Senha</span><input id="password" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {msg && <div className={msg.ok ? 'toast' : 'err'} style={msg.ok ? { maxWidth: 'none', animation: 'none' } : {}}>{msg.text}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 12 }}>
            {mode === 'login'
              ? <><a href="#" onClick={swap('signup')}>Criar conta</a><span className="muted">Esqueceu a senha? Peça ao administrativo.</span></>
              : <a href="#" onClick={swap('login')}>← Voltar para entrar</a>}
          </div>
        </form>
      </div>
    </div>
  )
}
