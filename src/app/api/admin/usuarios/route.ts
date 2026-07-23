import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// Gestão de usuários pelo administrador.
// Roda no servidor: usa a service_role key (NUNCA exposta ao navegador).

interface Autorizado {
  admin: SupabaseClient
  caller: User
}

// Valida service_role + sessão + perfil admin. Retorna o cliente admin e o chamador,
// ou uma NextResponse de erro para ser retornada direto pelo handler.
async function autorizar(req: Request): Promise<Autorizado | NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' },
      { status: 500 },
    )
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  }

  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller.user) {
    return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })
  }

  const { data: perfilCaller } = await admin
    .from('perfis')
    .select('role')
    .eq('user_id', caller.user.id)
    .maybeSingle()

  if (perfilCaller?.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem gerenciar usuários' }, { status: 403 })
  }

  return { admin, caller: caller.user }
}

// Cria novo usuário
export async function POST(req: Request) {
  const auth = await autorizar(req)
  if (auth instanceof NextResponse) return auth
  const { admin, caller } = auth

  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const senha = String(body?.senha ?? '')
  const nome = String(body?.nome ?? '').trim()
  const role = body?.role === 'admin' ? 'admin' : 'operador'
  const tabsRecebidas: unknown = body?.tabs_permitidas
  const tabs = Array.isArray(tabsRecebidas) ? tabsRecebidas.map(String) : []

  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 })
  }
  if (senha.length < 6) {
    return NextResponse.json({ error: 'A senha deve ter no mínimo 6 caracteres' }, { status: 400 })
  }

  const { data: novo, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  })
  if (createErr || !novo.user) {
    return NextResponse.json(
      { error: createErr?.message ?? 'Erro ao criar usuário' },
      { status: 400 },
    )
  }

  const { error: perfilErr } = await admin.from('perfis').insert({
    user_id: novo.user.id,
    email,
    nome,
    role,
    tabs_permitidas: tabs.length > 0 ? tabs : ['dashboard', 'estoque', 'inspecao', 'wms'],
  })
  if (perfilErr) {
    return NextResponse.json(
      { error: `Usuário criado, mas falhou ao gravar o perfil: ${perfilErr.message}` },
      { status: 500 },
    )
  }

  await admin.from('historico').insert({
    descricao: `Usuário ${email} criado (${role === 'admin' ? 'Admin' : 'Operador'}) pelo administrador`,
    responsavel: caller.email ?? 'admin',
    user_id: caller.id,
  })

  return NextResponse.json({ ok: true })
}

// Altera a senha de um usuário existente
export async function PATCH(req: Request) {
  const auth = await autorizar(req)
  if (auth instanceof NextResponse) return auth
  const { admin, caller } = auth

  const body = await req.json().catch(() => null)
  const userId = String(body?.user_id ?? '').trim()
  const senha = String(body?.senha ?? '')

  if (!userId) {
    return NextResponse.json({ error: 'Usuário não informado' }, { status: 400 })
  }
  if (senha.length < 6) {
    return NextResponse.json({ error: 'A senha deve ter no mínimo 6 caracteres' }, { status: 400 })
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password: senha })
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message ?? 'Erro ao alterar senha' },
      { status: 400 },
    )
  }

  // Busca o e-mail do alvo apenas para o registro no histórico
  const { data: perfilAlvo } = await admin
    .from('perfis')
    .select('email')
    .eq('user_id', userId)
    .maybeSingle()

  await admin.from('historico').insert({
    descricao: `Senha do usuário ${perfilAlvo?.email ?? userId} alterada pelo administrador`,
    responsavel: caller.email ?? 'admin',
    user_id: caller.id,
  })

  return NextResponse.json({ ok: true })
}
