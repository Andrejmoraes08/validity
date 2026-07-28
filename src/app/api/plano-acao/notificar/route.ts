import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

// Notificação por e-mail das ações do Plano de Ação.
// Envia para todos os usuários com acesso à aba "plano-acao".
// Roda no servidor (Node). Provedor de envio:
//   1) Brevo via API HTTP (recomendado — funciona a partir da nuvem)
//   2) SMTP (nodemailer) como fallback
export const runtime = 'nodejs'

const ACOES: Record<string, { titulo: string; cor: string; verbo: string }> = {
  solicitar_bloqueio:  { titulo: 'Solicitação de Bloqueio', cor: '#dc2626', verbo: 'solicitou o bloqueio de' },
  bloqueio_confirmado: { titulo: 'Bloqueio Confirmado',     cor: '#7c3aed', verbo: 'confirmou o bloqueio de' },
  estorno:             { titulo: 'Estorno de Segregação',   cor: '#1f6feb', verbo: 'estornou a segregação de' },
}

// Extrai nome e e-mail de "Nome <email>" ou "email"
function parseFrom(raw: string): { nome: string; email: string } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { nome: m[1] || 'VALIDITY', email: m[2].trim() }
  return { nome: 'VALIDITY', email: raw.trim() }
}

interface EnvioResult { ok: boolean; semProvedor?: boolean; erro?: string }

// Envio unificado: Brevo (API) se houver BREVO_API_KEY; senão SMTP; senão degrada.
async function enviarEmail(opts: { to: string[]; subject: string; html: string }): Promise<EnvioResult> {
  const brevoKey = process.env.BREVO_API_KEY
  const fromRaw = process.env.EMAIL_FROM || process.env.BREVO_FROM || process.env.SMTP_FROM
    || (process.env.SMTP_USER ? `VALIDITY <${process.env.SMTP_USER}>` : '')
  const from = parseFrom(fromRaw)

  if (opts.to.length === 0) return { ok: true }

  // 1) Brevo via API HTTP
  if (brevoKey && from.email) {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: from.nome, email: from.email },
        to: [{ email: from.email, name: from.nome }],
        bcc: opts.to.map(email => ({ email })),
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    })
    if (!resp.ok) {
      const detalhe = await resp.text().catch(() => '')
      return { ok: false, erro: `Brevo: ${detalhe.slice(0, 200)}` }
    }
    return { ok: true }
  }

  // 2) SMTP (fallback)
  const smtpHost = process.env.SMTP_HOST
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASS
  if (smtpHost && smtpUser && smtpPass) {
    const smtpPort = Number(process.env.SMTP_PORT || 587)
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000,
      })
      await transporter.sendMail({
        from: fromRaw, to: from.email, bcc: opts.to,
        subject: opts.subject, html: opts.html,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, erro: `SMTP: ${e instanceof Error ? e.message : 'erro'}` }
    }
  }

  // 3) Nenhum provedor configurado
  return { ok: true, semProvedor: true }
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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

  // Ação especial de teste: envia só para o próprio solicitante
  if (acaoKey === 'teste') {
    const alvo = caller.user.email
    if (!alvo) return NextResponse.json({ error: 'Sua conta não tem e-mail' }, { status: 400 })
    const html = `<div style="font-family:Arial,sans-serif">
      <h2 style="color:#16a34a">✓ Envio funcionando</h2>
      <p>Este é um e-mail de teste do VALIDITY. Se você recebeu, as notificações do Plano de Ação estão ativas.</p>
      <p style="font-size:12px;color:#aaa">Enviado por ${caller.user.email} em ${new Date().toLocaleString('pt-BR')}</p>
    </div>`
    const r = await enviarEmail({ to: [alvo], subject: '[VALIDITY] E-mail de teste', html })
    if (r.semProvedor) return NextResponse.json({ ok: true, enviados: 0, semProvedor: true })
    if (!r.ok) return NextResponse.json({ error: `Falha no envio — ${r.erro}` }, { status: 502 })
    return NextResponse.json({ ok: true, enviados: 1, teste: alvo })
  }

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

  const r = await enviarEmail({
    to: destinatarios,
    subject: `[VALIDITY] ${acao.titulo} — ${sku} (${endereco})`,
    html,
  })
  if (r.semProvedor) return NextResponse.json({ ok: true, enviados: 0, destinatarios: destinatarios.length, semProvedor: true })
  if (!r.ok) return NextResponse.json({ error: `Falha no envio — ${r.erro}` }, { status: 502 })

  return NextResponse.json({ ok: true, enviados: destinatarios.length, destinatarios: destinatarios.length })
}
