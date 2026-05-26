'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Item } from '@/lib/types'

export function useItens() {
  const [itens, setItens] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItens = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('itens')
      .select('*')
      .order('validade', { ascending: true })
    if (!error && data) setItens(data as Item[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchItens() }, [fetchItens])

  const addItem = async (item: Omit<Item, 'id' | 'created_at' | 'updated_at' | 'user_id'>) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('itens').insert({ ...item, user_id: user!.id })
    if (!error) await fetchItens()
    return { error }
  }

  const updateItem = async (id: string, updates: Partial<Item>) => {
    const { error } = await supabase.from('itens').update(updates).eq('id', id)
    if (!error) await fetchItens()
    return { error }
  }

  const deleteItem = async (id: string) => {
    const { error } = await supabase.from('itens').delete().eq('id', id)
    if (!error) await fetchItens()
    return { error }
  }

  const bloquearItem = async (id: string, responsavel: string) => {
    const now = new Date().toISOString()
    const { error } = await supabase.from('itens').update({
      status: 'bloqueado',
      bloqueado_em: now,
      bloqueado_por: responsavel,
    }).eq('id', id)
    if (!error) {
      await supabase.from('historico').insert({
        descricao: `Item bloqueado`,
        responsavel,
        user_id: (await supabase.auth.getUser()).data.user!.id,
      })
      await fetchItens()
    }
    return { error }
  }

  const baixarItem = async (id: string, nf: string, responsavel: string) => {
    const item = itens.find(i => i.id === id)
    if (!item) return { error: new Error('Item não encontrado') }
    const { data: { user } } = await supabase.auth.getUser()
    const now = new Date().toISOString()

    const { error: errUpdate } = await supabase.from('itens').update({
      status: 'baixado',
      nf_perda: nf,
      baixado_em: now,
      quantidade: 0,
    }).eq('id', id)

    if (!errUpdate) {
      await supabase.from('baixas').insert({
        item_id: id,
        sku: item.sku,
        descricao: item.descricao,
        lote: item.lote,
        endereco_frac: item.endereco_frac,
        endereco_gran: item.endereco_gran,
        quantidade: item.quantidade,
        validade: item.validade,
        nf,
        responsavel,
        user_id: user!.id,
      })
      await supabase.from('historico').insert({
        descricao: `Baixa registrada — NF ${nf}`,
        responsavel,
        user_id: user!.id,
      })
      await fetchItens()
    }
    return { error: errUpdate }
  }

  return { itens, loading, fetchItens, addItem, updateItem, deleteItem, bloquearItem, baixarItem }
}
