'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uid } from '@/lib/utils'
import type { Palete, PaleteStatus } from '@/lib/types'

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

  return { paletes, loading, fetchPaletes, criarComDados, criarPool, vincular, atualizar, excluir }
}
