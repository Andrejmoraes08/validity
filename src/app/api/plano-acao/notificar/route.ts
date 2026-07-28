import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Notificação por e-mail das ações do Plano de Ação.
// Envia para todos os usuários com acesso à aba "plano-acao".
// Roda no servidor: usa service_role (RLS) + RESEND_API_KEY (envio).

const ACOES: Record<string, { titulo: string; cor: string; verbo: string }> = {
  solicitar_bloqueio:  { titulo: 'Solicitação de Bloqueio', cor: '#dc2626', verbo: 'solicitou o bloqueio de' },
  bloqueio_confirmado: { titulo: 'Bloqueio Confirmado',     cor: '#7c3aed', verbo: 'confirmou o bloqueio de' },
  estorno:             { titulo: 'Estorno de Segregação',   cor: '#1f6feb', verbo: 'estornou a segregação de' },
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM || 'VALIDITY <onboarding@resend.dev>'

  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Servidor sem configuração do Supabase' }, { status: 500 })
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Autentica o chamador
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: caller, error: callerErr } = await admin.auth.getUser(token)
  if (callerErr || !caller.user) return NextResponse.json({ error: 'Sessão inválida' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const acaoKey = String(body?.acao ?? '')
  const acao = ACOES[acaoKey]
  if (!acao) return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  const item = body?.item ?? {}
  const sku = String(item.sku ?? '')
  const descricao = String(item.descricao ?? '')
  const endereco = String(item.endereco ?? '')
  const validade = String(item.validade ?? '')
  const quantidade = item.quantidade ?? ''
  const responsavel = String(body?.responsavel ?? caller.user.email ?? '')
  const obs = String(body?.obs ?? '')

  // Destinatários: usuários com acesso à aba Plano de Ação
  const { data: perfis } = await admin.from('perfis').select('email, tabs_permitidas')
  const destinatarios = (perfis ?? [])
    .filter(p => Array.isArray(p.tabs_permitidas) && p.tabs_permitidas.includes('plano-acao'))
    .map(p => String(p.email))
    .filter(e => /.+@.+\..+/.test(e))

  const validadeBR = validade
    ? new Date(validade + 'T00:00:00').toLocaleDateString('pt-BR')
    : '—'

  // Registro na timeline (auditoria da notificação)
  await admin.from('historico').insert({
    descricao: `📧 ${acao.titulo}: ${sku} — ${endereco} · notificado a ${destinatarios.length} usuário(s)`,
    responsavel,
    user_id: caller.user.id,
  })

  // Sem chave Resend → estrutura pronta, mas não envia (degrada com aviso)
  if (!resendKey) {
    return NextResponse.json({ ok: true, enviados: 0, destinatarios: destinatarios.length, semProvedor: true })
  }
  if (destinatarios.length === 0) {
    return NextResponse.json({ ok: true, enviados: 0, destinatarios: 0 })
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:${acao.cor};color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">VALIDITY · ${acao.titulo}</h2>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:20px;border-radius:0 0 8px 8px">
        <p style="font-size:14px;color:#333"><strong>${responsavel}</strong> ${acao.verbo}:</p>
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin:12px 0">
          <tr><td style="padding:6px 0;color:#888;width:120px">SKU</td><td style="font-weight:bold">${sku}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Descrição</td><td>${descricao}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Endereço</td><td style="font-family:monospace">${endereco}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Quantidade</td><td>${quantidade}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Validade</td><td style="color:${acao.cor};font-weight:bold">${validadeBR}</td></tr>
          ${obs ? `<tr><td style="padding:6px 0;color:#888">Observação</td><td>${obs}</td></tr>` : ''}
        </table>
        <p style="font-size:12px;color:#aaa;margin-top:16px">
          Acesse o Plano de Ação no VALIDITY para tratar esta ocorrência.
        </p>
      </div>
    </div>`

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: destinatarios,
      subject: `[VALIDITY] ${acao.titulo} — ${sku} (${endereco})`,
      html,
    }),
  })

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '')
    return NextResponse.json({ error: `Falha no envio: ${detalhe.slice(0, 200)}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, enviados: destinatarios.length, destinatarios: destinatarios.length })
}
