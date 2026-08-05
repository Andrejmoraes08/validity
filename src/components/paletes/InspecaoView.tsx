'use client'
import { useState } from 'react'
import { usePaletes } from '@/hooks/usePaletes'
import { QrScanner } from '@/components/qr/QrScanner'
import { StatusBadge } from '@/components/paletes/StatusBadge'
import { Button } from '@/components/ui/Button'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { useToast } from '@/components/layout/Toast'
import { usePerfílContext } from '@/lib/perfil-context'
import type { Palete } from '@/lib/types'

interface Registro { codigo: string; sku: string; endereco: string; resultado: 'ok' | 'ocorrencia' }

export function InspecaoView() {
  const { buscarPorCodigo, confirmarPosicao, registrarOcorrencia } = usePaletes()
  const { toast } = useToast()
  const { perfil } = usePerfílContext()
  const responsavel = perfil?.nome?.trim() || perfil?.email || 'sistema'

  const [scannerAberto, setScannerAberto] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [atual, setAtual] = useState<Palete | null>(null)
  const [naoEncontrado, setNaoEncontrado] = useState<string | null>(null)
  const [ocorrenciaAberta, setOcorrenciaAberta] = useState(false)
  const [nota, setNota] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [sessao, setSessao] = useState<Registro[]>([])

  const handleDetect = async (code: string) => {
    setScannerAberto(false)
    setNaoEncontrado(null)
    setAtual(null)
    setOcorrenciaAberta(false)
    setNota('')
    setBuscando(true)
    const { palete, error } = await buscarPorCodigo(code)
    setBuscando(false)
    if (error) { toast('Erro ao consultar o palete', 'error'); return }
    if (!palete) { setNaoEncontrado(code); return }
    setAtual(palete)
  }

  const registrar = (p: Palete, resultado: Registro['resultado']) =>
    setSessao(s => [{ codigo: p.codigo, sku: p.sku || '—', endereco: p.endereco_atual || '—', resultado }, ...s])

  const confirmar = async () => {
    if (!atual) return
    setSalvando(true)
    const { error } = await confirmarPosicao(atual.id)
    setSalvando(false)
    if (error) { toast('Erro ao confirmar', 'error'); return }
    registrar(atual, 'ok')
    toast(`Posição confirmada — ${atual.codigo}`, 'success')
    setAtual(null)
  }

  const salvarOcorrencia = async () => {
    if (!atual) return
    const texto = nota.trim()
    if (!texto) { toast('Descreva a ocorrência', 'info'); return }
    setSalvando(true)
    const { error } = await registrarOcorrencia(atual, texto, responsavel)
    setSalvando(false)
    if (error) { toast('Erro ao registrar ocorrência', 'error'); return }
    registrar(atual, 'ocorrencia')
    toast(`Ocorrência registrada — ${atual.codigo}`, 'success')
    setAtual(null)
    setOcorrenciaAberta(false)
    setNota('')
  }

  const naoVinculado = atual && atual.status === 'vazio'
  const okCount = sessao.filter(r => r.resultado === 'ok').length
  const ocCount = sessao.filter(r => r.resultado === 'ocorrencia').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Inspeção de pulmão (QR)</h1>
          <p className="text-sm text-gray-400">
            Leia o QR e confirme se o palete está no endereço registrado. A validade vem da entrada — não precisa redigitar.
          </p>
        </div>
        {!atual && !buscando && (
          <Button variant="primary" onClick={() => setScannerAberto(true)}>
            {sessao.length === 0 ? 'Ler QR Code' : 'Ler próximo palete'}
          </Button>
        )}
      </div>

      {/* Resumo da sessão */}
      {sessao.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-gray-400">Nesta sessão:</span>
          <span className="text-green-600 font-semibold">{okCount} confirmado(s)</span>
          <span className="text-gray-300">·</span>
          <span className="text-amber-600 font-semibold">{ocCount} ocorrência(s)</span>
        </div>
      )}

      {buscando && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          Consultando…
        </div>
      )}

      {naoEncontrado && !buscando && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-4">
          Nenhum palete encontrado com o código <span className="font-mono font-bold">{naoEncontrado}</span>.
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => setScannerAberto(true)}>Ler novamente</Button>
          </div>
        </div>
      )}

      {/* Palete lido — conferência de posição */}
      {atual && !buscando && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="font-mono font-extrabold text-lg text-gray-900">{atual.codigo}</span>
              <StatusBadge status={atual.status} />
            </div>
            {atual.validade
              ? <ZoneCell validade={atual.validade} />
              : <span className="text-xs text-gray-300">sem validade</span>}
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div>
              <div className="text-sm text-gray-500">{atual.sku || '—'} · {atual.descricao || 'sem descrição'}</div>
            </div>

            {naoVinculado ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
                Esta etiqueta ainda não foi vinculada a um palete (em branco). Vincule na aba <strong>Paletes (QR)</strong> antes de inspecionar.
              </div>
            ) : (
              <>
                {/* Endereço esperado — destaque para conferência */}
                <div className="rounded-xl border-2 border-gray-900 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Endereço registrado (pulmão)</div>
                  <div className="font-mono font-extrabold text-3xl text-gray-900 mt-1">{atual.endereco_atual || '—'}</div>
                  <div className="text-sm text-gray-500 mt-2">O palete está fisicamente neste endereço?</div>
                </div>

                {!ocorrenciaAberta ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button variant="primary" onClick={confirmar} disabled={salvando} className="flex-1 justify-center bg-green-600 hover:bg-green-700">
                      {salvando ? 'Salvando…' : '✓ Confirmar posição'}
                    </Button>
                    <Button variant="secondary" onClick={() => setOcorrenciaAberta(true)} disabled={salvando} className="flex-1 justify-center">
                      ⚠ Reportar ocorrência
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-600">Ocorrência (avaria, endereço divergente, etc.)</label>
                    <textarea
                      value={nota}
                      onChange={e => setNota(e.target.value)}
                      rows={3}
                      placeholder="Ex.: palete avariado / encontrado em 6-53-4-0 / caixa violada…"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-3">
                      <Button variant="ghost" onClick={() => { setOcorrenciaAberta(false); setNota('') }}>Cancelar</Button>
                      <Button variant="primary" onClick={salvarOcorrencia} disabled={salvando} className="bg-amber-600 hover:bg-amber-700">
                        {salvando ? 'Salvando…' : 'Salvar ocorrência'}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Estado inicial */}
      {!atual && !naoEncontrado && !buscando && sessao.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 grid place-items-center text-gray-400 text-sm p-12 text-center">
          Toque em <strong className="mx-1">Ler QR Code</strong> e aponte a câmera para a etiqueta do palete no pulmão.
        </div>
      )}

      {/* Histórico da sessão */}
      {sessao.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Código', 'SKU', 'Endereço', 'Resultado'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessao.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-4 py-2.5 font-mono font-bold text-gray-800">{r.codigo}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-700">{r.sku}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{r.endereco}</td>
                  <td className="px-4 py-2.5">
                    {r.resultado === 'ok'
                      ? <span className="text-green-600 font-semibold">✓ Confirmado</span>
                      : <span className="text-amber-600 font-semibold">⚠ Ocorrência</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QrScanner
        open={scannerAberto}
        onClose={() => setScannerAberto(false)}
        onDetect={handleDetect}
        title="Ler QR do palete"
      />
    </div>
  )
}
