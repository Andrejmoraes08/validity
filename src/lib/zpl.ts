// Geração de ZPL para etiqueta de palete 100x40mm (impressora Zebra).
// QR Code via ^BQ; texto via fontes escaláveis A0. Coordenadas em "dots".
// 203 dpi = 8 dots/mm → 100x40mm = 800x320 dots (padrão da maioria das Zebra desktop).
// 300 dpi = 12 dots/mm → 1200x480 dots.

import { fmtDate } from '@/lib/utils'
import type { Palete } from '@/lib/types'

export type Dpi = 203 | 300

// ZPL não lida bem com acentos nas fontes internas → remove acentos.
// Também neutraliza os caracteres de controle do ZPL (^ e ~).
const semAcento = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const san = (s: unknown) => semAcento(String(s ?? '')).replace(/[\^~]/g, ' ').trim()

interface Geo {
  W: number; H: number
  s: (n: number) => number   // escala 203→dpi
  qrMag: number
}

function geometria(dpi: Dpi): Geo {
  const k = dpi === 300 ? 1.5 : 1
  const s = (n: number) => Math.round(n * k)
  return { W: s(800), H: s(320), s, qrMag: dpi === 300 ? 8 : 5 }
}

// Etiqueta completa (palete com dados) — SKU, descrição, endereço, qtd, validade + QR
export function gerarZpl(p: Partial<Palete>, dpi: Dpi = 203): string {
  const g = geometria(dpi)
  const { s } = g

  const sku = san(p.sku) || '-'
  const desc = san(p.descricao)
  const end = san(p.endereco_atual) || '-'
  const qtd = p.quantidade != null ? String(p.quantidade) : '-'
  const val = p.validade ? san(fmtDate(p.validade)) : '-'
  const codigo = san(p.codigo)

  return [
    '^XA',
    `^PW${g.W}`,
    `^LL${g.H}`,
    '^CI28',
    '^LH0,0',
    // Moldura externa
    `^FO${s(8)},${s(8)}^GB${g.W - s(16)},${g.H - s(16)},${s(2)}^FS`,
    // SKU (destaque)
    `^FO${s(24)},${s(18)}^A0N,${s(58)},${s(58)}^FD${sku}^FS`,
    // Descrição (até 2 linhas, largura 540 dots)
    `^FO${s(24)},${s(84)}^A0N,${s(24)},${s(24)}^FB${s(540)},2,0,L^FD${desc}^FS`,
    // Endereço de pulmão
    `^FO${s(24)},${s(150)}^A0N,${s(20)},${s(20)}^FDEND. PULMAO^FS`,
    `^FO${s(24)},${s(174)}^A0N,${s(36)},${s(36)}^FD${end}^FS`,
    // Quantidade
    `^FO${s(360)},${s(150)}^A0N,${s(20)},${s(20)}^FDQTD^FS`,
    `^FO${s(360)},${s(174)}^A0N,${s(36)},${s(36)}^FD${qtd}^FS`,
    // Validade (caixa em destaque)
    `^FO${s(24)},${s(228)}^GB${s(528)},${s(66)},${s(3)}^FS`,
    `^FO${s(36)},${s(236)}^A0N,${s(20)},${s(20)}^FDVALIDADE^FS`,
    `^FO${s(36)},${s(258)}^A0N,${s(40)},${s(40)}^FD${val}^FS`,
    // QR à direita (dados = código do palete)
    `^FO${s(600)},${s(28)}^BQN,2,${g.qrMag}^FDMA,${codigo}^FS`,
    // Código legível sob o QR
    `^FO${s(586)},${s(252)}^A0N,${s(24)},${s(24)}^FD${codigo}^FS`,
    '^XZ',
  ].join('\n')
}

// Etiqueta "em branco" (pool) — só QR grande + código; sem dados do produto.
export function gerarZplVazio(codigo: string, dpi: Dpi = 203): string {
  const g = geometria(dpi)
  const { s } = g
  const cod = san(codigo)
  const mag = dpi === 300 ? 11 : 7
  return [
    '^XA',
    `^PW${g.W}`,
    `^LL${g.H}`,
    '^CI28',
    '^LH0,0',
    `^FO${s(8)},${s(8)}^GB${g.W - s(16)},${g.H - s(16)},${s(2)}^FS`,
    `^FO${s(40)},${s(60)}^A0N,${s(30)},${s(30)}^FDETIQUETA EM BRANCO^FS`,
    `^FO${s(40)},${s(100)}^A0N,${s(22)},${s(22)}^FDVincular na entrada^FS`,
    `^FO${s(40)},${s(180)}^A0N,${s(48)},${s(48)}^FD${cod}^FS`,
    // QR grande à direita
    `^FO${s(470)},${s(40)}^BQN,2,${mag}^FDMA,${cod}^FS`,
    '^XZ',
  ].join('\n')
}

// Concatena várias etiquetas num único job de impressão
export function gerarZplLote(paletes: Partial<Palete>[], dpi: Dpi = 203): string {
  return paletes.map(p => (p.status === 'vazio'
    ? gerarZplVazio(p.codigo || '', dpi)
    : gerarZpl(p, dpi))).join('\n')
}
