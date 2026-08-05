'use client'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'

// Tipos mínimos da BarcodeDetector API (nativa no Chrome Android) — não vem no lib do TS
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> }
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function getDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

interface QrScannerProps {
  open: boolean
  onClose: () => void
  onDetect: (code: string) => void
  title?: string
  // Modo contínuo: não para na primeira leitura — segue lendo (inspeção por QR).
  continuo?: boolean
  // Em modo contínuo, pausa a detecção (ex.: enquanto mostra o card de confirmação).
  pausado?: boolean
  // Camada sobreposta à câmera (ex.: card "Palete Validado").
  overlay?: React.ReactNode
  // Rodapé fixo abaixo da câmera (ex.: contador + botão Encerrar).
  footer?: React.ReactNode
}

export function QrScanner({
  open, onClose, onDetect, title = 'Ler QR Code',
  continuo = false, pausado = false, overlay, footer,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<number | null>(null)
  const jaDetectouRef = useRef(false)
  // onDetect é recriado a cada render do pai; guardamos num ref para não
  // reiniciar a câmera (o efeito depende só de `open`).
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  // Estado atual de pausa/último código lidos pelo loop sem reiniciar a câmera
  const pausadoRef = useRef(pausado)
  pausadoRef.current = pausado
  const continuoRef = useRef(continuo)
  continuoRef.current = continuo
  const ultimoCodigoRef = useRef<string | null>(null)

  const [erro, setErro] = useState<string | null>(null)
  const [suportado, setSuportado] = useState(true)
  const [manual, setManual] = useState('')

  useEffect(() => {
    if (!open) return
    jaDetectouRef.current = false
    ultimoCodigoRef.current = null
    setErro(null)
    let cancelado = false

    const Ctor = getDetectorCtor()
    if (!Ctor) {
      setSuportado(false)
      return
    }
    setSuportado(true)
    const detector = new Ctor({ formats: ['qr_code'] })

    const iniciar = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelado) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const tick = async () => {
          if (cancelado) return
          if (!continuoRef.current && jaDetectouRef.current) return
          try {
            // Em modo contínuo, mantém a câmera viva mas não lê enquanto pausado
            if (!(continuoRef.current && pausadoRef.current)) {
              const codes = await detector.detect(video)
              const val = codes[0]?.rawValue?.trim()
              if (val) {
                if (continuoRef.current) {
                  // Só emite um código novo (evita re-disparar o mesmo palete em vista)
                  if (val !== ultimoCodigoRef.current) {
                    ultimoCodigoRef.current = val
                    try { navigator.vibrate?.(120) } catch { /* sem vibração */ }
                    onDetectRef.current(val)
                  }
                } else {
                  jaDetectouRef.current = true
                  try { navigator.vibrate?.(150) } catch { /* sem vibração */ }
                  onDetectRef.current(val)
                  return
                }
              }
            }
          } catch {
            // falha pontual de frame — ignora e continua
          }
          loopRef.current = window.setTimeout(tick, 250)
        }
        tick()
      } catch (e) {
        const err = e as DOMException
        if (err?.name === 'NotAllowedError') setErro('Permissão de câmera negada. Autorize o acesso à câmera no navegador.')
        else if (err?.name === 'NotFoundError') setErro('Nenhuma câmera encontrada no dispositivo.')
        else setErro('Não foi possível acessar a câmera.')
      }
    }
    iniciar()

    return () => {
      cancelado = true
      if (loopRef.current) { clearTimeout(loopRef.current); loopRef.current = null }
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [open])

  const enviarManual = () => {
    const v = manual.trim()
    if (!v) return
    setManual('')
    onDetect(v)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {suportado && !erro && (
            <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              {/* Moldura-guia */}
              <div className="absolute inset-0 pointer-events-none grid place-items-center">
                <div className="w-2/3 aspect-square border-2 border-white/80 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              <p className="absolute bottom-2 inset-x-0 text-center text-white/90 text-xs">
                Aponte a câmera para o QR da etiqueta do item
              </p>
              {/* Camada sobreposta (card de confirmação no modo contínuo) */}
              {overlay && <div className="absolute inset-0">{overlay}</div>}
            </div>
          )}

          {erro && (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{erro}</div>
          )}

          {!suportado && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm p-3">
              Este navegador não suporta leitura por câmera. Digite o código manualmente abaixo.
            </div>
          )}

          {/* Fallback manual — sempre disponível */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-600">Ou digite o código</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manual}
                onChange={e => setManual(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') enviarManual() }}
                placeholder="IT-000123"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono flex-1 focus:outline-none focus:border-blue-500"
              />
              <Button variant="primary" onClick={enviarManual}>Buscar</Button>
            </div>
          </div>

          {footer}
        </div>
      </div>
    </div>
  )
}
