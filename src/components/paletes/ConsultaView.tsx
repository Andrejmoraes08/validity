'use client'
import { useState } from 'react'
import { usePaletes } from '@/hooks/usePaletes'
import { QrScanner } from '@/components/qr/QrScanner'
import { StatusBadge } from '@/components/paletes/StatusBadge'
import { Button } from '@/components/ui/Button'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { useToast } from '@/components/layout/Toast'
import { fmtDateTime } from '@/lib/utils'
import type { Palete } from '@/lib/types'

export function ConsultaView() {
  const { buscarPorCodigo } = usePaletes()
  const { toast } = useToast()
  const [scannerAberto, setScannerAberto] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [palete, setPalete] = useState<Palete | null>(null)
  const [naoEncontrado, setNaoEncontrado] = useState<string | null>(null)

  const handleDetect = async (code: string) => {
    setScannerAberto(false)
    setBuscando(true)
    setNaoEncontrado(null)
    const { palete: p, error } = await buscarPorCodigo(code)
    setBuscando(false)
    if (error) { toast('Erro ao consultar o palete', 'error'); return }
    if (!p) { setPalete(null); setNaoEncontrado(code); return }
    setPalete(p)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">Consultar palete</h1>
          <p className="text-sm text-gray-400">
            Leia o QR Code do palete com a câmera para ver os dados cadastrados na entrada.
          </p>
        </div>
        <Button variant="primary" onClick={() => setScannerAberto(true)}>Ler QR Code</Button>
      </div>

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
            <Button variant="secondary" size="sm" onClick={() => setScannerAberto(true)}>Ler outro</Button>
          </div>
        </div>
      )}

      {palete && !buscando && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-3">
              <span className="font-mono font-extrabold text-lg text-gray-900">{palete.codigo}</span>
              <StatusBadge status={palete.status} />
            </div>
            <Button variant="secondary" size="sm" onClick={() => setScannerAberto(true)}>Ler outro</Button>
          </div>

          <div className="p-5 grid grid-cols-2 gap-x-6 gap-y-4">
            <Campo label="SKU"><span className="font-mono font-bold text-gray-900">{palete.sku || '—'}</span></Campo>
            <Campo label="Quantidade"><span className="font-mono font-bold text-gray-900">{typeof palete.quantidade === 'number' ? palete.quantidade : '—'}</span></Campo>
            <Campo label="Descrição" full><span className="text-gray-800">{palete.descricao || '—'}</span></Campo>
            <Campo label="Lote"><span className="font-mono text-gray-800">{palete.lote || '—'}</span></Campo>
            <Campo label="Validade">
              {palete.validade ? <ZoneCell validade={palete.validade} /> : <span className="text-gray-300">—</span>}
            </Campo>
            <Campo label="Endereço de pulmão" full><span className="font-mono font-bold text-gray-900">{palete.endereco_atual || '—'}</span></Campo>
            {palete.observacao && (
              <Campo label="Observação" full><span className="text-gray-700">{palete.observacao}</span></Campo>
            )}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-400 flex flex-wrap gap-x-6 gap-y-1">
            {palete.vinculado_por && <span>Vinculado por {palete.vinculado_por}{palete.vinculado_em ? ` · ${fmtDateTime(palete.vinculado_em)}` : ''}</span>}
            {palete.impressa_em && <span>Impressa em {fmtDateTime(palete.impressa_em)}</span>}
            {palete.ultima_leitura && <span>Última leitura {fmtDateTime(palete.ultima_leitura)}</span>}
          </div>
        </div>
      )}

      {!palete && !naoEncontrado && !buscando && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 grid place-items-center text-gray-400 text-sm p-12 text-center">
          Toque em <strong className="mx-1">Ler QR Code</strong> e aponte a câmera para a etiqueta do palete.
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

function Campo({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 ${full ? 'col-span-2' : ''}`}>
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
      {children}
    </div>
  )
}
