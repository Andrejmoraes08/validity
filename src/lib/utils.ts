export function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('pt-BR')
}

export function fmtDateTime(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function clsx(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

// Normaliza endereço para o padrão "Rua - Prédio - Nível - Apto" (4 segmentos; vazio vira 0)
// "6 - 53 - 4 -" → "6 - 53 - 4 - 0" · "6-53-4" → "6 - 53 - 4 - 0" · "6 - 053 - 4 - 0" → "6 - 53 - 4 - 0"
export function normalizarEndereco(e: string): string {
  if (!e || !e.trim()) return ''
  const partes = e.split('-').map(p => p.trim())
  if (partes.every(p => !p)) return ''
  while (partes.length < 4) partes.push('')
  return partes.slice(0, 4)
    .map(p => (p || '0').replace(/^0+(?=\d)/, ''))
    .join(' - ')
}

// Bebidas de validade indeterminada — destilados e afins.
// USO EXCLUSIVO DA IMPORTAÇÃO WMS: itens assim não são recadastrados na carga.
// NÃO aplicar nas inspeções — o inspetor pode registrar qualquer item livremente.
export function semControleValidade(descricao: string): boolean {
  const d = (descricao || '').toUpperCase().trim()
  if (!d) return false

  // Exceções que TÊM validade (baixo teor / RTD / sem álcool / coquetel) — sempre mantidas
  const excecoes = [
    'S/AL', 'S/A ', 'SEM ALCOOL', 'ZERO',        // sem álcool
    'SPRITZ', 'TONICA', '& TONIC', 'COOLER',     // prontos para beber
    'COQUET', 'CLERICOT', 'MOJITO', 'LOVIN',     // coquetéis / marcas RTD
  ]
  if (excecoes.some(e => d.includes(e))) return false

  // Marcas/produtos específicos sem controle (independe da posição no texto)
  const contem = ['CATUABA', 'AMARULA', 'LICOR 43']
  if (contem.some(c => d.includes(c))) return true

  // Categorias por prefixo da descrição
  const prefixos = [
    'WHISKY', 'VODKA', 'CACHA', 'AGUARDENTE', 'CONHAQUE', 'TEQUILA',
    'APERITIVO', 'CHAMPAGNE', 'ESPUMANTE', 'FRISANTE', 'PROSECCO',
    'GIN ', 'RUM ', 'V ',  // "GIN ", "RUM " e "V origem" exigem espaço (não pegam VINAGRE/VERMUTE/VODKA)
  ]
  return prefixos.some(p => d.startsWith(p))
}
