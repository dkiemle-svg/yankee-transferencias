// Conexão com o Supabase. A chave "publishable/anon" é pública por natureza:
// o acesso aos dados é controlado pelas regras de segurança (RLS) do banco.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://dtivxqinubbwgyppqkyx.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_26axbnWqKXvvFm0x5DAAzw_gy7ckhp7'

// Login por usuário: o Supabase exige e-mail, então "raquel" vira "raquel@<domínio>" por baixo.
export const LOGIN_DOMAIN = 'yankeeburger.com.br'
export const toEmail = (user) => {
  const u = String(user || '').trim().toLowerCase()
  return u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`
}
export const toUser = (email) => String(email || '').replace(`@${LOGIN_DOMAIN}`, '')
