// Geração de QR Code como data URL (para preview HTML e para embutir no PDF A4).
// A impressão na Zebra usa o QR nativo do ZPL (^BQ) e não passa por aqui.
import QRCode from 'qrcode'

export async function qrDataUrl(texto: string, size = 240): Promise<string> {
  return QRCode.toDataURL(texto || ' ', {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}
