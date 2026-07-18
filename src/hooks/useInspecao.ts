'use client'
import { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Item } from '@/lib/types'

export type TipoEndereco = 'frac' | 'gran'
export type AcaoInspecao = 'ok' | 'segregado' | 'baixa'

export interface EntradaFila {
  item: Item
  tipo: TipoEndereco
  endereco: string
}

export interface Resultado {
  entrada: EntradaFila
  ok: boolean
  acao: AcaoInspecao
  validadeEncontrada: string
  validadeAlterada: boolean
  obs: string
  foto?: string
}

// Formatos persistidos no banco (jsonb) — enxutos, sem snapshot completo do item
interface FilaPersist {
  item_id: string
  sku: string
  tipo: TipoEndereco
  endereco: string
}

interface ResultadoPersist {
  item_id: string
  sku: string
  tipo: TipoEndereco
  endereco: string
  ok: boolean
  acao: AcaoInspecao
  validadeCadastrada: string
  validadeEncontrada: string
  validadeAlterada: boolean
  obs: string
  foto?: string
}

export interface InspecaoAberta {
  id: string
  numero: number
  responsavel: string
  status: string
  fila: FilaPersist[]
  atual: number
  resultados: ResultadoPersist[]
  iniciada_em: string
}

export interface InspecaoState {
  phase: 'idle' | 'active' | 'done'
  inspecaoId: string | null
  numero: number | null
  iniciadaEm: string | null
  responsavel: string
  fila: EntradaFila[]
  atual: number
  resultados: Resultado[]
}

const initial: InspecaoState = {
  phase: 'idle',
  inspecaoId: null,
  numero: null,
  iniciadaEm: null,
  responsavel: '',
  fila: [],
  atual: 0,
  resultados: [],
}

function toResultadoPersist(r: Resultado): ResultadoPersist {
  return {
    item_id: r.entrada.item.id,
    sku: r.entrada.item.sku,
    tipo: r.entrada.tipo,
    endereco: r.entrada.endereco,
    ok: r.ok,
    acao: r.acao,
    validadeCadastrada: r.entrada.item.validade,
    validadeEncontrada: r.validadeEncontrada,
    validadeAlterada: r.validadeAlterada,
    obs: r.obs,
    // Persiste somente URLs (fotos já enviadas ao Storage) — nunca base64
    foto: r.foto && r.foto.startsWith('http') ? r.foto : undefined,
  }
}

async function uploadFoto(dataUrl: string, numero: number | null, sku: string): Promise<string | undefined> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const path = `inspecao-${numero ?? 'avulsa'}/${sku}-${Date.now()}.jpg`
    const { error } = await supabase.storage
      .from('fotos-inspecao')
      .upload(path, blob, { contentType: blob.type || 'image/jpeg' })
    if (error) {
      console.error('photo upload failed:', error.message)
      return undefined
    }
    return supabase.storage.from('fotos-inspecao').getPublicUrl(path).data.publicUrl
  } catch (e) {
    console.error('photo upload error:', e)
    return undefined
  }
}

export function useInspecao() {
  const [state, setState] = useState<InspecaoState>(initial)

  const persistir = async (id: string, atual: number, resultados: Resultado[], done: boolean) => {
    await supabase.from('inspecoes').update({
      atual,
      resultados: resultados.map(toResultadoPersist),
      ...(done ? { status: 'concluida', finalizada_em: new Date().toISOString() } : {}),
    }).eq('id', id)
  }

  const buscarAberta = useCallback(async (): Promise<InspecaoAberta | null> => {
    const { data } = await supabase
      .from('inspecoes')
      .select('*')
      .eq('status', 'aberta')
      .order('iniciada_em', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as InspecaoAberta) ?? null
  }, [])

  const cancelarAberta = useCallback(async (aberta: InspecaoAberta) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('inspecoes').update({
      status: 'cancelada',
      finalizada_em: new Date().toISOString(),
    }).eq('id', aberta.id)
    await supabase.from('historico').insert({
      descricao: `Inspeção #${aberta.numero} cancelada (substituída por nova inspeção)`,
      responsavel: user?.email ?? 'sistema',
      user_id: user!.id,
    })
  }, [])

  const iniciar = async (fila: EntradaFila[], responsavel: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    const filaPersist: FilaPersist[] = fila.map(e => ({
      item_id: e.item.id, sku: e.item.sku, tipo: e.tipo, endereco: e.endereco,
    }))
    const { data, error } = await supabase
      .from('inspecoes')
      .insert({ responsavel, fila: filaPersist, user_id: user!.id })
      .select()
      .single()
    if (error || !data) return { error: error ?? new Error('insert failed') }

    await supabase.from('historico').insert({
      descricao: `Inspeção #${data.numero} iniciada — ${fila.length} endereços`,
      responsavel,
      user_id: user!.id,
    })

    setState({
      phase: 'active',
      inspecaoId: data.id,
      numero: data.numero,
      iniciadaEm: data.iniciada_em,
      responsavel,
      fila,
      atual: 0,
      resultados: [],
    })
    return { error: null }
  }

  // Reconstrói o estado a partir de uma inspeção aberta no banco
  const retomar = (aberta: InspecaoAberta, itens: Item[]) => {
    const mapa = new Map(itens.map(i => [i.id, i]))

    let atual = aberta.atual
    const fila: EntradaFila[] = []
    aberta.fila.forEach((f, idx) => {
      const item = mapa.get(f.item_id)
      if (item) {
        fila.push({ item, tipo: f.tipo, endereco: f.endereco })
      } else if (idx < aberta.atual) {
        atual = Math.max(0, atual - 1)
      }
    })

    const resultados: Resultado[] = (aberta.resultados ?? []).map(r => {
      const real = mapa.get(r.item_id)
      const base = real ?? ({
        id: r.item_id, sku: r.sku, descricao: '', lote: '',
        endereco_frac: r.tipo === 'frac' ? r.endereco : '',
        endereco_gran: r.tipo === 'gran' ? r.endereco : '',
        quantidade: 0, validade: r.validadeCadastrada, status: 'ativo',
        created_at: '', updated_at: '', user_id: '',
      } as Item)
      return {
        entrada: { item: { ...base, validade: r.validadeCadastrada }, tipo: r.tipo, endereco: r.endereco },
        ok: r.ok,
        acao: r.acao,
        validadeEncontrada: r.validadeEncontrada,
        validadeAlterada: r.validadeAlterada,
        obs: r.obs,
        foto: r.foto,
      }
    })

    const done = atual >= fila.length
    if (done) persistir(aberta.id, atual, resultados, true)

    setState({
      phase: done ? 'done' : 'active',
      inspecaoId: aberta.id,
      numero: aberta.numero,
      iniciadaEm: aberta.iniciada_em,
      responsavel: aberta.responsavel,
      fila,
      atual,
      resultados,
    })
  }

  const confirmar = async (
    ok: boolean,
    validadeEncontrada: string,
    obs: string,
    foto?: string,
    quantidadeSegregada?: number,
    quantidadeEncontrada?: number,
  ) => {
    const entrada = state.fila[state.atual]
    const { item, tipo } = entrada
    const validadeAlterada = validadeEncontrada !== item.validade
    const { data: { user } } = await supabase.auth.getUser()
    const now = new Date().toISOString()

    // Foto vai para o Storage; guarda a URL (não a imagem em memória)
    let fotoUrl: string | undefined
    if (foto) fotoUrl = await uploadFoto(foto, state.numero, item.sku)

    const resultado: Resultado = {
      entrada, ok, acao: ok ? 'ok' : 'segregado',
      validadeEncontrada, validadeAlterada, obs,
      foto: fotoUrl ?? foto,
    }
    const novosResultados = [...state.resultados, resultado]

    const jaInspecionado = state.resultados.some(r => r.entrada.item.id === item.id)
    if (!jaInspecionado) {
      await supabase.from('itens').update({
        ultima_inspecao: now,
        inspecionado_por: state.responsavel,
        observacao_inspecao: obs || null,
        ...(fotoUrl ? { foto_inspecao: fotoUrl } : {}),
        ...(validadeAlterada ? { validade: validadeEncontrada } : {}),
        ...(quantidadeEncontrada !== undefined ? { quantidade: quantidadeEncontrada } : {}),
        status: ok ? 'ativo' : 'segregado',
        ...(ok ? {} : { segregado_em: now, segregado_por: state.responsavel }),
      }).eq('id', item.id)
    } else {
      if (obs || validadeAlterada || fotoUrl || quantidadeEncontrada !== undefined) {
        await supabase.from('itens').update({
          ...(obs ? { observacao_inspecao: obs } : {}),
          ...(fotoUrl ? { foto_inspecao: fotoUrl } : {}),
          ...(validadeAlterada ? { validade: validadeEncontrada } : {}),
          ...(quantidadeEncontrada !== undefined ? { quantidade: quantidadeEncontrada } : {}),
        }).eq('id', item.id)
      }
    }

    const endLabel = tipo === 'frac' ? 'Frac.' : 'Gran.'
    const qtdInfo = !ok && quantidadeSegregada ? ` | Qtd: ${quantidadeSegregada}` : ''
    const saldoInfo = quantidadeEncontrada !== undefined ? ` | Saldo registrado: ${quantidadeEncontrada}` : ''
    const descricao = (validadeAlterada
      ? `Inspeção #${state.numero} ${endLabel}: ${item.sku} — validade corrigida ${item.validade} → ${validadeEncontrada}${ok ? '' : ` | Segregado${qtdInfo}`}`
      : `Inspeção #${state.numero} ${endLabel}: ${item.sku} — ${ok ? 'OK' : `Segregado${qtdInfo}`}`) + saldoInfo

    await supabase.from('historico').insert({
      descricao,
      responsavel: state.responsavel,
      user_id: user!.id,
    })

    const proximo = state.atual + 1
    const done = proximo >= state.fila.length
    if (state.inspecaoId) await persistir(state.inspecaoId, proximo, novosResultados, done)
    if (done) {
      await supabase.from('historico').insert({
        descricao: `Inspeção #${state.numero} concluída — ${novosResultados.length} endereços inspecionados`,
        responsavel: state.responsavel,
        user_id: user!.id,
      })
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
      descricao: `Baixa de endereço ${endLabel}: ${item.sku} — ${entrada.endereco} (saldo zerado na inspeção #${state.numero})`,
      responsavel: state.responsavel,
      user_id: user!.id,
    })

    const resultado: Resultado = {
      entrada, ok: true, acao: 'baixa',
      validadeEncontrada: item.validade, validadeAlterada: false, obs,
    }
    const novosResultados = [...state.resultados, resultado]
    const proximo = state.atual + 1
    const done = proximo >= state.fila.length
    if (state.inspecaoId) await persistir(state.inspecaoId, proximo, novosResultados, done)
    if (done) {
      setState(s => ({ ...s, resultados: novosResultados, phase: 'done' }))
    } else {
      setState(s => ({ ...s, resultados: novosResultados, atual: proximo }))
    }
  }

  const registrarExtra = async (resultado: Resultado) => {
    const novosResultados = [...state.resultados, resultado]
    setState(s => ({ ...s, resultados: novosResultados }))
    if (state.inspecaoId) await persistir(state.inspecaoId, state.atual, novosResultados, false)
  }

  const reiniciar = () => setState(initial)

  return { state, iniciar, retomar, buscarAberta, cancelarAberta, confirmar, baixarEndereco, reiniciar, registrarExtra }
}
