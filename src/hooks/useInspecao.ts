'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Item } from '@/lib/types'

export type TipoEndereco = 'frac' | 'gran'

export interface EntradaFila {
  item: Item
  tipo: TipoEndereco
  endereco: string
}

export interface Resultado {
  entrada: EntradaFila
  ok: boolean
  validadeEncontrada: string
  validadeAlterada: boolean
  obs: string
  foto?: string
}

export interface InspecaoState {
  phase: 'idle' | 'active' | 'done'
  responsavel: string
  fila: EntradaFila[]
  atual: number
  resultados: Resultado[]
}

const initial: InspecaoState = {
  phase: 'idle',
  responsavel: '',
  fila: [],
  atual: 0,
  resultados: [],
}

export function useInspecao() {
  const [state, setState] = useState<InspecaoState>(initial)

  const iniciar = (fila: EntradaFila[], responsavel: string) => {
    setState({ phase: 'active', responsavel, fila, atual: 0, resultados: [] })
  }

  const confirmar = async (
    ok: boolean,
    validadeEncontrada: string,
    obs: string,
    foto?: string,
    quantidadeBloqueada?: number,
  ) => {
    const entrada = state.fila[state.atual]
    const { item, tipo } = entrada
    const validadeAlterada = validadeEncontrada !== item.validade
    const resultado: Resultado = { entrada, ok, validadeEncontrada, validadeAlterada, obs, foto }
    const novosResultados = [...state.resultados, resultado]
    const { data: { user } } = await supabase.auth.getUser()
    const now = new Date().toISOString()

    const jaInspecionado = state.resultados.some(r => r.entrada.item.id === item.id)
    if (!jaInspecionado) {
      await supabase.from('itens').update({
        ultima_inspecao: now,
        inspecionado_por: state.responsavel,
        observacao_inspecao: obs || null,
        ...(validadeAlterada ? { validade: validadeEncontrada } : {}),
        status: ok ? 'ativo' : 'bloqueado',
        ...(ok ? {} : { bloqueado_em: now, bloqueado_por: state.responsavel }),
      }).eq('id', item.id)
    } else {
      if (obs || validadeAlterada) {
        await supabase.from('itens').update({
          ...(obs ? { observacao_inspecao: obs } : {}),
          ...(validadeAlterada ? { validade: validadeEncontrada } : {}),
        }).eq('id', item.id)
      }
    }

    const endLabel = tipo === 'frac' ? 'Frac.' : 'Gran.'
    const qtdInfo = !ok && quantidadeBloqueada ? ` | Qtd: ${quantidadeBloqueada}` : ''
    const descricao = validadeAlterada
      ? `Inspeção ${endLabel}: ${item.sku} — validade corrigida ${item.validade} → ${validadeEncontrada}${ok ? '' : ` | Bloqueado${qtdInfo}`}`
      : `Inspeção ${endLabel}: ${item.sku} — ${ok ? 'OK' : `Bloqueado${qtdInfo}`}`

    await supabase.from('historico').insert({
      descricao,
      responsavel: state.responsavel,
      user_id: user!.id,
    })

    const proximo = state.atual + 1
    if (proximo >= state.fila.length) {
      setState(s => ({ ...s, resultados: novosResultados, phase: 'done' }))
    } else {
      setState(s => ({ ...s, resultados: novosResultados, atual: proximo }))
    }
  }

  const reiniciar = () => setState(initial)

  const inserirNaFila = (entrada: EntradaFila) => {
    setState(s => {
      const pos = s.atual + 1
      const novaFila = [...s.fila.slice(0, pos), entrada, ...s.fila.slice(pos)]
      return { ...s, fila: novaFila }
    })
  }

  return { state, iniciar, confirmar, reiniciar, inserirNaFila }
}
