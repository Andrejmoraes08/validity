// Integração com o Zebra Browser Print (utilitário local instalado na máquina
// ligada à impressora). Ele expõe uma API HTTP local:
//   - HTTPS em https://127.0.0.1:9101 (usado por páginas HTTPS, ex. Vercel)
//   - HTTP  em http://127.0.0.1:9100  (usado em dev http://localhost)
// A resposta inclui CORS liberado, então dá para chamar do navegador.
//
// Observação: numa página HTTPS, o navegador só chama a base HTTPS e exige que o
// certificado do Browser Print esteja confiável (o instalador cuida disso).

export interface ZebraDevice {
  name: string
  uid: string
  connection: string
  deviceType: string
  provider?: string
  manufacturer?: string
  version?: string
}

const BASES = ['https://127.0.0.1:9101', 'http://127.0.0.1:9100']
let baseCache: string | null = null

async function descobrirBase(): Promise<string | null> {
  if (baseCache) return baseCache
  for (const base of BASES) {
    try {
      const r = await fetch(`${base}/available`, { method: 'GET' })
      if (r.ok) { baseCache = base; return base }
    } catch {
      // tenta a próxima base
    }
  }
  return null
}

export async function browserPrintDisponivel(): Promise<boolean> {
  return (await descobrirBase()) !== null
}

export async function listarImpressoras(): Promise<ZebraDevice[]> {
  const base = await descobrirBase()
  if (!base) return []
  try {
    const r = await fetch(`${base}/available`)
    const j = await r.json()
    const lista = (j?.printer ?? j?.device ?? []) as ZebraDevice[]
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

export async function impressoraPadrao(): Promise<ZebraDevice | null> {
  const base = await descobrirBase()
  if (!base) return null
  try {
    const r = await fetch(`${base}/default?type=printer`)
    if (!r.ok) return null
    const j = await r.json()
    if (j && (j as ZebraDevice).uid) return j as ZebraDevice
    return null
  } catch {
    return null
  }
}

export interface ResultadoImpressao { ok: boolean; erro?: string; impressora?: string }

export async function imprimirZpl(zpl: string, device?: ZebraDevice): Promise<ResultadoImpressao> {
  const base = await descobrirBase()
  if (!base) {
    return { ok: false, erro: 'Zebra Browser Print não detectado. Instale/abra o utilitário na máquina da impressora.' }
  }
  const dev = device ?? await impressoraPadrao() ?? (await listarImpressoras())[0]
  if (!dev) {
    return { ok: false, erro: 'Nenhuma impressora Zebra encontrada no Browser Print.' }
  }
  try {
    const r = await fetch(`${base}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: dev, data: zpl }),
    })
    if (!r.ok) return { ok: false, erro: `Falha ao enviar para a impressora (HTTP ${r.status})`, impressora: dev.name }
    return { ok: true, impressora: dev.name }
  } catch (e) {
    return { ok: false, erro: `Erro de comunicação com o Browser Print: ${String(e)}` }
  }
}

// Fallback: baixa o ZPL como arquivo .zpl (para enviar manualmente à impressora)
export function baixarZpl(zpl: string, nome: string) {
  const blob = new Blob([zpl], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome.endsWith('.zpl') ? nome : `${nome}.zpl`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
