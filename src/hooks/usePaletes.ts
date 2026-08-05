'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uid, normalizarEndereco } from '@/lib/utils'
import type { Palete, PaleteStatus, Movimentacao } from '@/lib/types'

// Dados que o conferente informa ao vincular um palete na entrada
export interface PaleteDados {
  sku?: string
  descricao?: string
  lote?: string
  quantidade?: number
  validade?: string
  endereco_atual?: string
  item_id?: string
  observacao?: string
}

// Código legível/QR derivado do número sequencial (lpn) do banco: "PAL-000123"
function codigoDoLpn(lpn: number): string {
  return `PAL-${String(lpn).padStart(6, '0')}`
}

export function usePaletes() {
  const [paletes, setPaletes] = useState<Palete[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPaletes = useCallback(async () => {
    setLoading(true)
    // Busca paginada — o PostgREST limita cada consulta a 1000 linhas
    const todos: Palete[] = []
    const pagina = 1000
    for (let offset = 0; ; offset += pagina) {
      const { data, error } = await supabase
        .from('paletes')
        .select('*')
        .order('lpn', { ascending: false })
        .range(offset, offset + pagina - 1)
      if (error || !data) break
      todos.push(...(data as Palete[]))
      if (data.length < pagina) break
    }
    setPaletes(todos)
    setLoading(false)
  }, [])

  useEffect(() => { fetchPaletes() }, [fetchPaletes])

  // Cria um palete e define o código a partir do lpn (serial do banco).
  // Passo 1: insere com código temporário único; passo 2: grava o código final "PAL-<lpn>".
  const criarUm = useCallback(async (
    status: PaleteStatus,
    dados: PaleteDados,
    userId: string,
  ): Promise<{ error: Error | null; palete?: Palete }> => {
    const agora = new Date().toISOString()
    const base: Record<string, unknown> = {
      codigo: `tmp-${uid()}`,
      status,
      endereco_atual: dados.endereco_atual ?? '',
      user_id: userId,
    }
    if (status === 'ativo') {
      base.sku = dados.sku ?? null
      base.descricao = dados.descricao ?? null
      base.lote = dados.lote ?? null
      base.quantidade = dados.quantidade ?? null
      base.validade = dados.validade || null
      base.item_id = dados.item_id ?? null
      base.observacao = dados.observacao ?? null
      base.vinculado_em = agora
    }

    const { data, error } = await supabase.from('paletes').insert(base).select().single()
    if (error || !data) return { error: (error as Error) ?? new Error('Falha ao criar palete') }

    const codigo = codigoDoLpn((data as Palete).lpn)
    const { error: e2 } = await supabase.from('paletes').update({ codigo }).eq('id', (data as Palete).id)
    if (e2) return { error: e2 as Error }
    return { error: null, palete: { ...(data as Palete), codigo } }
  }, [])

  // (b) Palete com dados na entrada — status "ativo"
  const criarComDados = useCallback(async (dados: PaleteDados, responsavel: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: new Error('Sessão expirada') }
    const res = await criarUm('ativo', { ...dados, observacao: dados.observacao }, user.id)
    if (!res.error && res.palete) {
      await supabase.from('paletes').update({ vinculado_por: responsavel }).eq('id', res.palete.id)
      await fetchPaletes()
    }
    return res
  }, [criarUm, fetchPaletes])

  // (a) Pool de etiquetas "em branco" — só ID/QR, status "vazio"
  const criarPool = useCallback(async (quantidade: number) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: new Error('Sessão expirada'), criados: 0 }
    const n = Math.max(1, Math.min(200, Math.floor(quantidade)))
    let criados = 0
    let ultimoErro: Error | null = null
    for (let i = 0; i < n; i++) {
      const { error } = await criarUm('vazio', {}, user.id)
      if (error) { ultimoErro = error; break }
      criados++
    }
    await fetchPaletes()
    return { error: ultimoErro, criados }
  }, [criarUm, fetchPaletes])

  // Vincula dados a uma etiqueta "vazia" existente → status "ativo"
  const vincular = useCallback(async (id: string, dados: PaleteDados, responsavel: string) => {
    const agora = new Date().toISOString()
    const { error } = await supabase.from('paletes').update({
      status: 'ativo',
      sku: dados.sku ?? null,
      descricao: dados.descricao ?? null,
      lote: dados.lote ?? null,
      quantidade: dados.quantidade ?? null,
      validade: dados.validade || null,
      endereco_atual: dados.endereco_atual ?? '',
      item_id: dados.item_id ?? null,
      observacao: dados.observacao ?? null,
      vinculado_em: agora,
      vinculado_por: responsavel,
    }).eq('id', id)
    if (!error) await fetchPaletes()
    return { error }
  }, [fetchPaletes])

  const atualizar = useCallback(async (id: string, updates: Partial<Palete>) => {
    const { error } = await supabase.from('paletes').update(updates).eq('id', id)
    if (!error) await fetchPaletes()
    return { error }
  }, [fetchPaletes])

  const excluir = useCallback(async (id: string) => {
    const { error } = await supabase.from('paletes').delete().eq('id', id)
    if (!error) await fetchPaletes()
    return { error }
  }, [fetchPaletes])

  // Busca direta por código (usada na leitura de QR) — não depende da lista carregada
  const buscarPorCodigo = useCallback(async (codigo: string) => {
    const { data, error } = await supabase
      .from('paletes')
      .select('*')
      .eq('codigo', codigo.trim())
      .maybeSingle()
    return { palete: (data as Palete) ?? null, error }
  }, [])

  // Inspeção de pulmão: confirma que o palete está na posição registrada.
  // Grava apenas ultima_leitura. Não refaz o fetch da lista (leituras em sequência).
  const confirmarPosicao = useCallback(async (id: string) => {
    const { error } = await supabase.from('paletes')
      .update({ ultima_leitura: new Date().toISOString() })
      .eq('id', id)
    return { error }
  }, [])

  // Inspeção de pulmão: registra uma ocorrência (avaria/divergência) no palete —
  // acrescenta à observação, grava ultima_leitura e registra no histórico do sistema.
  const registrarOcorrencia = useCallback(async (palete: Palete, nota: string, responsavel: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: new Error('Sessão expirada') }
    const carimbo = new Date().toLocaleString('pt-BR')
    const obsAnterior = palete.observacao ? `${palete.observacao}\n` : ''
    const { error } = await supabase.from('paletes').update({
      observacao: `${obsAnterior}[${carimbo}] ${nota}`,
      ultima_leitura: new Date().toISOString(),
    }).eq('id', palete.id)
    if (!error) {
      await supabase.from('historico').insert({
        descricao: `Inspeção pulmão — ocorrência no palete ${palete.codigo}${palete.sku ? ` (${palete.sku})` : ''} @ ${palete.endereco_atual || 's/ endereço'}: ${nota}`,
        responsavel,
        user_id: user.id,
      })
    }
    return { error }
  }, [])

  // Movimentação: muda o palete de endereço e registra o evento (origem→destino).
  const moverPalete = useCallback(async (palete: Palete, destino: string, responsavel: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: new Error('Sessão expirada') }
    const origem = palete.endereco_atual || ''
    const destinoNorm = normalizarEndereco(destino)
    if (!destinoNorm) return { error: new Error('Informe um endereço de destino válido') }
    if (destinoNorm === origem) return { error: new Error('O destino é igual ao endereço atual') }

    const { error } = await supabase.from('paletes').update({
      endereco_atual: destinoNorm,
      ultima_leitura: new Date().toISOString(),
    }).eq('id', palete.id)
    if (error) return { error }

    const { error: e2 } = await supabase.from('movimentacoes').insert({
      palete_id: palete.id,
      codigo: palete.codigo,
      origem,
      destino: destinoNorm,
      responsavel,
      user_id: user.id,
    })
    await supabase.from('historico').insert({
      descricao: `Movimentação palete ${palete.codigo}${palete.sku ? ` (${palete.sku})` : ''}: ${origem || 's/ endereço'} → ${destinoNorm}`,
      responsavel,
      user_id: user.id,
    })
    return { error: e2, destino: destinoNorm }
  }, [])

  // Histórico de movimentações de um palete (mais recentes primeiro)
  const historicoMovimentacoes = useCallback(async (paleteId: string): Promise<Movimentacao[]> => {
    const { data } = await supabase.from('movimentacoes')
      .select('*')
      .eq('palete_id', paleteId)
      .order('created_at', { ascending: false })
      .limit(10)
    return (data as Movimentacao[]) ?? []
  }, [])

  // Marca data de impressão de uma ou mais etiquetas (num único update)
  const marcarImpressas = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return { error: null }
    const { error } = await supabase.from('paletes')
      .update({ impressa_em: new Date().toISOString() })
      .in('id', ids)
    if (!error) await fetchPaletes()
    return { error }
  }, [fetchPaletes])

  return { paletes, loading, fetchPaletes, criarComDados, criarPool, vincular, atualizar, excluir, marcarImpressas, buscarPorCodigo, confirmarPosicao, registrarOcorrencia, moverPalete, historicoMovimentacoes }
}
