import { ZoneInfo, ZoneName } from './types'

export function diasParaVencer(validade: string): number {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const val = new Date(validade + 'T00:00:00')
  return Math.floor((val.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
}

export function getZone(validade: string): ZoneInfo {
  const dias = diasParaVencer(validade)

  if (dias < 0) return {
    name: 'vencido', label: 'Vencido', dias,
    color: '#1a1d24', bg: 'rgba(26,29,36,.10)', textColor: '#ffffff'
  }
  if (dias < 30) return {
    name: 'vermelho', label: 'Crítico', dias,
    color: '#dc2626', bg: 'rgba(220,38,38,.10)', textColor: '#ffffff'
  }
  if (dias < 91) return {
    name: 'amarelo', label: 'Atenção', dias,
    color: '#d4a017', bg: 'rgba(212,160,23,.14)', textColor: '#1a1d24'
  }
  if (dias < 181) return {
    name: 'verde', label: 'Seguro', dias,
    color: '#16a34a', bg: 'rgba(22,163,74,.10)', textColor: '#ffffff'
  }
  return {
    name: 'azul', label: 'OK', dias,
    color: '#1f6feb', bg: 'rgba(31,111,235,.10)', textColor: '#ffffff'
  }
}

const ZONE_ORDER: ZoneName[] = ['vencido', 'vermelho', 'amarelo', 'verde', 'azul']

export function worstZone(valididades: string[]): ZoneInfo | null {
  if (!valididades.length) return null
  let worst: ZoneInfo | null = null
  for (const v of valididades) {
    const z = getZone(v)
    if (!worst || ZONE_ORDER.indexOf(z.name) < ZONE_ORDER.indexOf(worst.name)) {
      worst = z
    }
  }
  return worst
}

export function sortByZone(items: { validade: string }[]): typeof items {
  return [...items].sort((a, b) => {
    const da = diasParaVencer(a.validade)
    const db = diasParaVencer(b.validade)
    return da - db
  })
}
