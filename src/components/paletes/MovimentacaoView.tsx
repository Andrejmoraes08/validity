'use client'
import { useState } from 'react'
import { usePaletes } from '@/hooks/usePaletes'
import { QrScanner } from '@/components/qr/QrScanner'
import { StatusBadge } from '@/components/paletes/StatusBadge'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/layout/Toast'
import { usePerfílContext } from '@/lib/perfil-context'
import { fmtDateTime, normalizarEndereco } from '@/lib/utils'
import type { Palete, Movimentacao } from '@/lib/types'

interface Registro { codigo: string; origem: string; destino: string }

export function MovimentacaoView() {
  const { buscarPorCodigo, moverPalete, historicoMovimentacoes } = usePaletes()
  const { toast } = useToast()
  const { perfil } = usePerfílContext()
  const responsavel = perfil?.nome?.trim() || perfil?.email || 'sistema'

  const [scannerAlvo, setScannerAlvo] = useState<'palete' | 'destino' | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [atual, setAtual] = useState<Palete | null>(null)
  const [naoEncontrado, setNaoEncontrado] = useState<string | null>(null)
  const [destino, setDestino] = useState('')
  const [historico, setHistorico] = useState<Movimentacao[]>([])
  const [salvando, setSalvando] = useState(false)
  const [sessao, setSessao] = useState<Registro[]>([])

  const resetPalete = () => { setAtual(null); setDestino(''); setHistorico([]); setNaoEncontrado(null) }

  const handleDetect = async (code: string) => {
    const alvo = scannerAlvo
    setScannerAlvo(null)
    if (alvo === 'destino') { setDestino(code.trim()); return }
    // alvo === 'palete'
    resetPalete()
    setBuscando(true)
    const { palete, error } = await buscarPorCodigo(code)
    setBuscando(false)
    if (error) { toast('Erro ao consultar o palete', 'error'); return }
    if (!palete) { setNaoEncontrado(code); return }
    setAtual(palete)
    setHistorico(await historicoMovimentacoes(palete.id))
  }

  const destinoPreview = normalizarEndereco(destino)
  const podeMover = !!atual && !!destinoPreview && destinoPreview !== (atual.endereco_atual || '')

  const confirmar = async () => {
    if (!atual) return
    setSalvando(true)
    const { error, destino: dest } = await moverPalete(atual, destino, responsavel)
    setSalvando(false)
    if (error) { toast(error.message || 'Erro ao mover', 'error'); return }
    setSessao(s => [{ codigo: atual.codigo, origem: atual.endereco_atual || '—', destino: dest || destinoPreview }, ...s])
    toast(`Palete ${atual.codigo} movido para ${dest || destinoPreview}`, 'success')
    resetPalete()
  }

  const naoMovivel = atual && (atual.status === 'vazio' || atual.status === 'baixado')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Movimentação de paletes</h1>
          <p className="text-sm text-gray-400">
            Leia o palete, informe o endereço de destino e confirme. A mudança fica registrada no histórico.
          </p>
        </div>
        {!atual && !buscando && (
          <Button variant="primary" onClick={() => setScannerAlvo('palete')}>
            {sessao.length === 0 ? 'Ler palete' : 'Mover outro palete'}
          </Button>
        )}
      </div>

      {sessao.length > 0 && (
        <div className="text-xs text-gray-400">{sessao.length} movimentação(ões) nesta sessão</div>
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
            <Button variant="secondary" size="sm" onClick={() => setScannerAlvo('palete')}>Ler novamente</Button>
          </div>
        </div>
      )}

      {atual && !buscando && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="font-mono font-extrabold text-lg text-gray-900">{atual.codigo}</span>
              <StatusBadge status={atual.status} />
            </div>
            <span className="text-sm text-gray-500">{atual.sku || '—'}</span>
          </div>

          <div className="p-5 flex flex-col gap-4">
            {naoMovivel ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
                {atual.status === 'vazio'
                  ? 'Etiqueta em branco (sem palete vinculado) — vincule antes de movimentar.'
                  : 'Palete já baixado — não pode ser movimentado.'}
              </div>
            ) : (
              <>
                {/* Origem → Destino */}
                <div className="flex items-stretch gap-3">
                  <div className="flex-1 rounded-xl border border-gray-200 p-3 text-center">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Origem (atual)</div>
                    <div className="font-mono font-bold text-lg text-gray-800 mt-1">{atual.endereco_atual || '—'}</div>
                  </div>
                  <div className="grid place-items-center text-gray-300 text-2xl">→</div>
                  <div className="flex-1 rounded-xl border-2 border-blue-500 p-3 text-center">
                    <div className="text-[11px] uppercase tracking-wide text-blue-500 font-semibold">Destino</div>
                    <div className="font-mono font-bold text-lg text-gray-900 mt-1">{destinoPreview || '—'}</div>
                  </div>
                </div>

                {/* Entrada do destino */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">Endereço de destino</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={destino}
                      onChange={e => setDestino(e.target.value)}
                      placeholder="Rua - Prédio - Nível - Apto"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:border-blue-500"
                    />
                    <Button variant="secondary" onClick={() => setScannerAlvo('destino')} title="Bipar etiqueta de endereço, se houver">Bipar</Button>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={resetPalete}>Cancelar</Button>
                  <Button variant="primary" onClick={confirmar} disabled={salvando || !podeMover} className="flex-1 justify-center">
                    {salvando ? 'Movendo…' : 'Confirmar movimentação'}
                  </Button>
                </div>

                {/* Histórico do palete */}
                {historico.length > 0 && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Movimentações anteriores</div>
                    <ul className="flex flex-col gap-1">
                      {historico.map(m => (
                        <li key={m.id} className="text-xs text-gray-600 font-mono flex flex-wrap gap-x-2">
                          <span className="text-gray-400">{fmtDateTime(m.created_at)}</span>
                          <span>{m.origem || 's/ end'} → {m.destino}</span>
                          <span className="text-gray-400">· {m.responsavel}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!atual && !naoEncontrado && !buscando && sessao.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 grid place-items-center text-gray-400 text-sm p-12 text-center">
          Toque em <strong className="mx-1">Ler palete</strong> e aponte a câmera para a etiqueta do palete a movimentar.
        </div>
      )}

      {/* Movimentações da sessão */}
      {sessao.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Código', 'Origem', 'Destino'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left text-gray-500 font-semibold text-[11px] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessao.map((r, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="px-4 py-2.5 font-mono font-bold text-gray-800">{r.codigo}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{r.origem}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-800">{r.destino}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QrScanner
        open={scannerAlvo !== null}
        onClose={() => setScannerAlvo(null)}
        onDetect={handleDetect}
        title={scannerAlvo === 'destino' ? 'Bipar endereço de destino' : 'Ler QR do palete'}
      />
    </div>
  )
}
