// Geração de ZPL para etiqueta de item 100x40mm (impressora Zebra).
// QR Code via ^BQ; texto via fontes escaláveis A0. Coordenadas em "dots".
// 203 dpi = 8 dots/mm → 100x40mm = 800x320 dots (padrão da maioria das Zebra desktop).
// 300 dpi = 12 dots/mm → 1200x480 dots.

import { fmtDate } from '@/lib/utils'
import type { Item } from '@/lib/types'

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

// Etiqueta 100x40 do ITEM de estoque — QR do codigo_qr + SKU, descrição,
// endereço de pulmão, quantidade e validade.
export function gerarZplItem(item: Partial<Item>, dpi: Dpi = 203): string {
  const g = geometria(dpi)
  const { s } = g

  const sku = san(item.sku) || '-'
  const desc = san(item.descricao)
  const end = san(item.endereco_gran) || '-'
  const qtd = item.quantidade != null ? String(item.quantidade) : '-'
  const val = item.validade ? san(fmtDate(item.validade)) : '-'
  const codigo = san(item.codigo_qr)

  return [
    '^XA',
    `^PW${g.W}`,
    `^LL${g.H}`,
    '^CI28',
    '^LH0,0',
    `^FO${s(8)},${s(8)}^GB${g.W - s(16)},${g.H - s(16)},${s(2)}^FS`,
    `^FO${s(24)},${s(18)}^A0N,${s(58)},${s(58)}^FD${sku}^FS`,
    `^FO${s(24)},${s(84)}^A0N,${s(24)},${s(24)}^FB${s(540)},2,0,L^FD${desc}^FS`,
    `^FO${s(24)},${s(150)}^A0N,${s(20)},${s(20)}^FDEND. PULMAO^FS`,
    `^FO${s(24)},${s(174)}^A0N,${s(36)},${s(36)}^FD${end}^FS`,
    `^FO${s(360)},${s(150)}^A0N,${s(20)},${s(20)}^FDQTD^FS`,
    `^FO${s(360)},${s(174)}^A0N,${s(36)},${s(36)}^FD${qtd}^FS`,
    `^FO${s(24)},${s(228)}^GB${s(528)},${s(66)},${s(3)}^FS`,
    `^FO${s(36)},${s(236)}^A0N,${s(20)},${s(20)}^FDVALIDADE^FS`,
    `^FO${s(36)},${s(258)}^A0N,${s(40)},${s(40)}^FD${val}^FS`,
    `^FO${s(600)},${s(28)}^BQN,2,${g.qrMag}^FDMA,${codigo}^FS`,
    `^FO${s(586)},${s(252)}^A0N,${s(24)},${s(24)}^FD${codigo}^FS`,
    '^XZ',
  ].join('\n')
}

export function gerarZplItemLote(itens: Partial<Item>[], dpi: Dpi = 203): string {
  return itens.map(i => gerarZplItem(i, dpi)).join('\n')
}
