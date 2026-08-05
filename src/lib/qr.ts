// Geração de QR Code como data URL (para preview HTML e para embutir no PDF A4).
// A etiqueta do item é impressa em A4 (jsPDF) usando este data URL — o QR
// carrega o código do item (codigo_qr, ex.: IT-000123) para leitura na inspeção.
import QRCode from 'qrcode'

export async function qrDataUrl(texto: string, size = 240): Promise<string> {
  return QRCode.toDataURL(texto || ' ', {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
}
