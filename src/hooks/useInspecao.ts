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

export type AcaoInspecao = 'ok' | 'segregado' | 'baixa'

export interface Resultado {
  entrada: EntradaFila
  ok: boolean
  acao: AcaoInspecao
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
    quantidadeSegregada?: number,
  ) => {
    const entrada = state.fila[state.atual]
    const { item, tipo } = entrada
    const validadeAlterada = validadeEncontrada !== item.validade
    const resultado: Resultado = { entrada, ok, acao: ok ? 'ok' : 'segregado', validadeEncontrada, validadeAlterada, obs, foto }
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
        status: ok ? 'ativo' : 'segregado',
        ...(ok ? {} : { segregado_em: now, segregado_por: state.responsavel }),
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
    const qtdInfo = !ok && quantidadeSegregada ? ` | Qtd: ${quantidadeSegregada}` : ''
    const descricao = validadeAlterada
      ? `Inspeção ${endLabel}: ${item.sku} — validade corrigida ${item.validade} → ${validadeEncontrada}${ok ? '' : ` | Segregado${qtdInfo}`}`
      : `Inspeção ${endLabel}: ${item.sku} — ${ok ? 'OK' : `Segregado${qtdInfo}`}`

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

  // Baixa de endereço: zera saldo e remove do estoque (status 'baixado')
  const baixarEndereco = async (obs: string) => {
    const entrada = state.fila[state.atual]
    const { item, tipo } = entrada
    const { data: { user } } = await supabase.auth.getUser()
    const now = new Date().toISOString()

    await supabase.from('itens').update({
      quantidade: 0,
      status: 'baixado',
      baixado_em: now,
      ultima_inspecao: now,
      inspecionado_por: state.responsavel,
      observacao_inspecao: obs || null,
    }).eq('id', item.id)

    const endLabel = tipo === 'frac' ? 'Frac.' : 'Gran.'
    await supabase.from('historico').insert({
      descricao: `Baixa de endereço ${endLabel}: ${item.sku} — ${entrada.endereco} (saldo zerado na inspeção)`,
      responsavel: state.responsavel,
      user_id: user!.id,
    })

    const resultado: Resultado = {
      entrada, ok: true, acao: 'baixa',
      validadeEncontrada: item.validade, validadeAlterada: false, obs,
    }
    const novosResultados = [...state.resultados, resultado]
    const proximo = state.atual + 1
    if (proximo >= state.fila.length) {
      setState(s => ({ ...s, resultados: novosResultados, phase: 'done' }))
    } else {
      setState(s => ({ ...s, resultados: novosResultados, atual: proximo }))
    }
  }

  const reiniciar = () => setState(initial)

  const registrarExtra = (resultado: Resultado) => {
    setState(s => ({ ...s, resultados: [...s.resultados, resultado] }))
  }

  return { state, iniciar, confirmar, baixarEndereco, reiniciar, registrarExtra }
}
