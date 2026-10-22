import React, { useMemo, useState } from 'react'
import { Plus, Search, Pencil, Trash2, Package, Building2, Users, Inbox } from 'lucide-react'
import { api } from '../lib/api.js'
import { money, dateBR, normalize, parseNum, round2 } from '../lib/format.js'
import { toUser } from '../config.js'
import { Modal, SortTh, useToast, useConfirm, UNIT_COLORS } from '../components/ui.jsx'

export default function Catalog({ store }) {
  const [sub, setSub] = useState('produtos')
  const { isAdmin } = store
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isAdmin ? 'Cadastros' : 'Produtos'}</h1>
          <p>{isAdmin ? 'Produtos com preço de transferência, unidades e acessos da equipe.' : 'Tabela de preços usada nas transferências.'}</p>
        </div>
      </div>
      {isAdmin && (
        <div className="seg subtabs" role="tablist">
          <button aria-pressed={sub === 'produtos'} onClick={() => setSub('produtos')}><Package size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Produtos</button>
          <button aria-pressed={sub === 'unidades'} onClick={() => setSub('unidades')}><Building2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Unidades</button>
          <button aria-pressed={sub === 'usuarios'} onClick={() => setSub('usuarios')}><Users size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Usuários</button>
        </div>
      )}
      {sub === 'produtos' && <Products store={store} />}
      {sub === 'unidades' && isAdmin && <Units store={store} />}
      {sub === 'usuarios' && isAdmin && <UsersAdmin store={store} />}
    </>
  )
}

// ======================= Produtos =======================
function Products({ store }) {
  const { products, transfers, isAdmin } = store
  const toast = useToast()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all') // all | used | noprice | inactive
  const [sort, setSort] = useState({ key: 'n', dir: 'desc' })
  const [editing, setEditing] = useState(null)

  const usage = useMemo(() => {
    const u = {}
    transfers.forEach((t) => { const k = t.product_name; u[k] ??= { n: 0, last: '' }; u[k].n++; if (t.date > u[k].last) u[k].last = t.date })
    return u
  }, [transfers])

  const rows = useMemo(() => {
    const nq = normalize(q)
    const list = products.map((p) => ({ ...p, n: usage[p.name]?.n || 0, last: usage[p.name]?.last || '' }))
      .filter((p) => (!nq || normalize(p.name).includes(nq)) &&
        (show === 'all' ? p.active !== false : show === 'used' ? p.n > 0 : show === 'noprice' ? !p.price : p.active === false))
    const d = sort.dir === 'asc' ? 1 : -1
    return list.sort((a, b) => (typeof a[sort.key] === 'number' ? a[sort.key] - b[sort.key] : String(a[sort.key] || '').localeCompare(String(b[sort.key] || ''))) * d)
  }, [products, usage, q, show, sort])

  async function remove(p) {
    const used = usage[p.name]?.n || 0
    const ok = await confirm({
      title: 'Excluir produto', danger: true, ok: 'Excluir',
      message: used ? `“${p.name}” aparece em ${used} transferências. Elas continuam no histórico com o nome e o valor gravados. Excluir mesmo assim? (Dica: você pode só desativar.)` : `Excluir “${p.name}”?`,
    })
    if (!ok) return
    try { await api.deleteProduct(p.id); store.setProducts((ps) => ps.filter((x) => x.id !== p.id)); toast('Produto excluído.') } catch (e) { toast(e.message, 'error') }
  }

  const noPrice = products.filter((p) => !p.price && p.active !== false).length

  return (
    <div className="card">
      <div className="filters">
        <div className="input-icon"><Search /><input className="input" placeholder="Buscar produto…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="seg">
          {[['all', 'Ativos'], ['used', 'Já transferidos'], ['noprice', `Sem preço (${noPrice})`], ['inactive', 'Inativos']].map(([k, l]) => <button key={k} aria-pressed={show === k} onClick={() => setShow(k)}>{l}</button>)}
        </div>
        <div className="grow" />
        {isAdmin && <button className="btn primary" onClick={() => setEditing({ name: '', price: '', unit: '', active: true })}><Plus />Novo produto</button>}
      </div>
      <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 270px)' }}>
        <table className="data">
          <thead><tr>
            <SortTh k="name" sort={sort} setSort={setSort}>Produto</SortTh>
            <SortTh k="unit" sort={sort} setSort={setSort}>Unidade de medida</SortTh>
            <SortTh k="price" sort={sort} setSort={setSort} className="num">Valor unitário</SortTh>
            <SortTh k="n" sort={sort} setSort={setSort} className="num">Transferências</SortTh>
            <SortTh k="last" sort={sort} setSort={setSort}>Último envio</SortTh>
            {isAdmin && <th style={{ width: 80 }}><span className="sr-only">Ações</span></th>}
          </tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="prod-cell">{p.name} {p.active === false && <span className="pill">inativo</span>}</td>
                <td className="muted">{p.unit || '—'}</td>
                <td className="num" style={{ fontWeight: 600 }}>{p.price ? money(p.price) : <span className="pill warn">sem preço</span>}</td>
                <td className="num">{p.n || <span className="muted">0</span>}</td>
                <td>{p.last ? dateBR(p.last) : <span className="muted">—</span>}</td>
                {isAdmin && <td><div className="row-actions">
                  <button className="btn ghost icon" aria-label="Editar" title="Editar" onClick={() => setEditing(p)}><Pencil /></button>
                  <button className="btn ghost icon" aria-label="Excluir" title="Excluir" onClick={() => remove(p)}><Trash2 /></button>
                </div></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <div className="empty"><Inbox /><div>Nenhum produto encontrado.</div></div>}
      </div>
      <div className="pager"><span>{rows.length} produto(s)</span></div>
      {editing && <ProductForm product={editing} store={store} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ProductForm({ product, store, onClose }) {
  const toast = useToast()
  const [name, setName] = useState(product.name || '')
  const [price, setPrice] = useState(product.price !== '' && product.price != null ? String(product.price).replace('.', ',') : '')
  const [unit, setUnit] = useState(product.unit || 'kg')
  const [active, setActive] = useState(product.active !== false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e) {
    e.preventDefault(); setErr('')
    const p = parseNum(price)
    if (!name.trim()) return setErr('Informe o nome.')
    if (!(p >= 0)) return setErr('Valor unitário inválido.')
    setBusy(true)
    try {
      const saved = await api.saveProduct({ ...(product.id ? { id: product.id } : {}), name: name.trim().toUpperCase(), price: round2(p), unit: unit.trim() || null, active })
      if (product.id && product.name !== saved.name) {
        // mantém o nome nas transferências vinculadas (somente na tela; o banco guarda o nome do lançamento)
      }
      store.setProducts((ps) => (product.id ? ps.map((x) => (x.id === saved.id ? saved : x)) : [...ps, saved]).sort((a, b) => a.name.localeCompare(b.name)))
      toast(product.id ? 'Produto atualizado.' : 'Produto cadastrado.')
      onClose()
    } catch (e2) { setErr(/duplicate|unique/i.test(e2.message) ? 'Já existe um produto com esse nome.' : e2.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={product.id ? 'Editar produto' : 'Novo produto'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" form="pf" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></>}>
      <form id="pf" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field"><span>Produto</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></label>
        <div className="grid-2">
          <label className="field"><span>Valor unitário (R$)</span><input className="input num" inputMode="decimal" placeholder="0,00" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="field"><span>Unidade de medida</span><select className="select" value={unit || 'kg'} onChange={(e) => setUnit(e.target.value)}><option value="kg">kg (quilo)</option><option value="un">un (unidade)</option></select></label>
        </div>
        <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={active} onChange={(e) => setActive(e.target.checked)} />Ativo (aparece na lista ao lançar transferências)</label>
        {product.id && <p className="hint" style={{ margin: 0 }}>Alterar o preço vale para os próximos lançamentos; os já feitos mantêm o valor da época.</p>}
        {err && <div className="err">{err}</div>}
      </form>
    </Modal>
  )
}

// ======================= Unidades =======================
function Units({ store }) {
  const { units, transfers } = store
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(null)

  async function remove(u) {
    if (transfers.some((t) => t.origin_id === u.id || t.destination_id === u.id)) return toast('Essa unidade tem transferências e não pode ser excluída.', 'error')
    if (!(await confirm({ title: 'Excluir unidade', message: `Excluir “${u.name}”?`, ok: 'Excluir', danger: true }))) return
    try { await api.deleteUnit(u.id); store.setUnits((us) => us.filter((x) => x.id !== u.id)); toast('Unidade excluída.') } catch (e) { toast(e.message, 'error') }
  }
  async function save(e) {
    e.preventDefault()
    try {
      const saved = await api.saveUnit({ ...editing, code: editing.code.trim().toUpperCase(), name: editing.name.trim() })
      store.setUnits((us) => (editing.id ? us.map((x) => (x.id === saved.id ? saved : x)) : [...us, saved]))
      toast('Unidade salva.'); setEditing(null)
    } catch (e2) { toast(e2.message, 'error') }
  }

  return (
    <div className="card">
      <div className="filters"><div className="grow" /><button className="btn primary" onClick={() => setEditing({ code: '', name: '', is_hub: true })}><Plus />Nova unidade</button></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Unidade</th><th>Código</th><th>Tipo</th><th className="num">Transferências</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td><span className="unit-tag"><i className="unit-dot" style={{ background: UNIT_COLORS[u.code] || 'var(--series-3)' }} /><strong>{u.name}</strong></span></td>
                <td className="muted">{u.code}</td>
                <td>{u.is_hub ? <span className="pill accent">Delivery (HubFood)</span> : <span className="pill">Loja / cozinha</span>}</td>
                <td className="num">{transfers.filter((t) => t.origin_id === u.id || t.destination_id === u.id).length}</td>
                <td><div className="row-actions">
                  <button className="btn ghost icon" aria-label="Editar" onClick={() => setEditing(u)}><Pencil /></button>
                  <button className="btn ghost icon" aria-label="Excluir" onClick={() => remove(u)}><Trash2 /></button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing.id ? 'Editar unidade' : 'Nova unidade'} onClose={() => setEditing(null)}
          footer={<><button className="btn" onClick={() => setEditing(null)}>Cancelar</button><button className="btn primary" form="uf">Salvar</button></>}>
          <form id="uf" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid-2">
              <label className="field"><span>Nome</span><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required autoFocus /></label>
              <label className="field"><span>Código curto</span><input className="input" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value })} required maxLength={12} /></label>
            </div>
            <label className="pop-item" style={{ padding: 0 }}><input type="checkbox" className="check" checked={editing.is_hub} onChange={(e) => setEditing({ ...editing, is_hub: e.target.checked })} />É uma unidade de delivery (aparece nos filtros e no dashboard)</label>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ======================= Usuários =======================
function UsersAdmin({ store }) {
  const { units, profile: me } = store
  const toast = useToast()
  const [list, setList] = useState(null)
  const [pwFor, setPwFor] = useState(null)
  const [pw, setPw] = useState('')
  React.useEffect(() => { api.profiles().then(setList).catch((e) => toast(e.message, 'error')) }, [])

  async function update(p, patch) {
    const next = { ...p, ...patch }
    if (next.role !== 'hub') next.unit_id = null
    next.access = next.role === 'nutri' ? ['nutricao'] : []
    try { await api.saveProfile(next); setList((l) => l.map((x) => (x.id === p.id ? next : x))); toast('Acesso atualizado.') } catch (e) { toast(e.message, 'error') }
  }

  if (!list) return <div className="card empty"><div className="spinner" /></div>
  const pending = list.filter((p) => p.role === 'pending').length
  return (
    <div className="card">
      <div className="card-head" style={{ paddingBottom: 14 }}>
        <div><h3>Equipe com acesso</h3><p>Cada pessoa cria a própria conta na tela de login; aqui você define o perfil e a unidade.{pending ? ` ${pending} aguardando liberação.` : ''}</p></div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Unidade</th><th>Master</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.name || '—'}</strong> {p.role === 'pending' && <span className="pill warn">aguardando</span>}</td>
                <td className="muted">{toUser(p.email)}</td>
                <td>
                  <select className="select" style={{ width: 200 }} value={p.role} disabled={p.id === me.id} onChange={(e) => update(p, { role: e.target.value, unit_id: e.target.value === 'hub' ? (p.unit_id || units.find((u) => u.is_hub)?.id) : null })}>
                    <option value="pending">Sem acesso</option>
                    <option value="hub">Equipe de delivery</option>
                    <option value="nutri">Nutricionista</option>
                    <option value="admin">Administrativo</option>
                  </select>
                </td>
                <td>
                  {p.role === 'hub' ? (
                    <select className="select" style={{ width: 200 }} value={p.unit_id || ''} onChange={(e) => update(p, { unit_id: e.target.value })}>
                      {units.filter((u) => u.is_hub).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  ) : <span className="muted">{p.role === 'admin' ? 'Todas' : '—'}</span>}
                </td>
                <td><label className="pop-item" style={{ padding: 0 }} title="Master vê todos os painéis"><input type="checkbox" className="check" checked={!!p.master} disabled={p.id === me.id} onChange={(e) => update(p, { master: e.target.checked, role: e.target.checked ? 'admin' : p.role })} />Todos os painéis</label></td>
                <td><button className="btn sm" onClick={() => setPwFor(p)}>Redefinir senha</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pwFor && (
        <Modal title={`Nova senha para ${pwFor.name || toUser(pwFor.email)}`} onClose={() => { setPwFor(null); setPw('') }}
          footer={<><button className="btn" onClick={() => { setPwFor(null); setPw('') }}>Cancelar</button><button className="btn primary" form="pwf">Salvar senha</button></>}>
          <form id="pwf" className="field" onSubmit={async (e) => {
            e.preventDefault()
            try { await api.setUserPassword(pwFor.id, pw); toast('Senha redefinida.'); setPwFor(null); setPw('') } catch (e2) { toast(e2.message, 'error') }
          }}>
            <span>Nova senha (mínimo 6 caracteres)</span>
            <input id="newpw" className="input" type="text" autoComplete="off" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
            <p className="hint" style={{ margin: 0 }}>Passe a senha para a pessoa; ela pode trocar depois pelo ícone de chave no topo.</p>
          </form>
        </Modal>
      )}
    </div>
  )
}
