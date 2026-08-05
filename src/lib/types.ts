export type ItemStatus = 'ativo' | 'segregado' | 'bloqueado' | 'quarentena' | 'baixado'

export interface Item {
  id: string
  sku: string
  descricao: string
  lote: string
  endereco_frac: string
  endereco_gran: string
  quantidade: number
  validade: string
  status: ItemStatus
  nf_perda?: string
  segregado_em?: string
  segregado_por?: string
  bloqueado_em?: string
  bloqueado_por?: string
  quarentena_em?: string
  quarentena_por?: string
  motivo_baixa?: string
  baixado_em?: string
  ultima_inspecao?: string
  inspecionado_por?: string
  observacao_inspecao?: string
  foto_inspecao?: string
  created_at: string
  updated_at: string
  user_id: string
}

export interface Baixa {
  id: string
  item_id?: string
  sku: string
  descricao: string
  lote: string
  endereco_frac: string
  endereco_gran: string
  quantidade: number
  validade: string
  nf: string
  motivo?: string
  responsavel: string
  created_at: string
  user_id: string
}

export interface Historico {
  id: string
  descricao: string
  tipo?: string
  responsavel: string
  created_at: string
  user_id: string
}

export interface Config {
  id: string
  gsheets_url: string
  responsavel: string
  user_id: string
  updated_at: string
}

// ─── Módulo QR Code (paletes / LPN) — foco no PULMÃO ────────────────────────
export type PaleteStatus = 'vazio' | 'ativo' | 'movimentando' | 'baixado'

export interface Palete {
  id: string
  lpn: number
  codigo: string
  sku?: string
  descricao?: string
  lote?: string
  quantidade?: number
  validade?: string
  endereco_atual: string
  status: PaleteStatus
  item_id?: string
  impressa_em?: string
  vinculado_em?: string
  vinculado_por?: string
  ultima_leitura?: string
  observacao?: string
  created_at: string
  updated_at: string
  user_id: string
}

export interface Movimentacao {
  id: string
  palete_id: string
  codigo: string
  origem: string
  destino: string
  responsavel: string
  created_at: string
  user_id: string
}

export type ZoneName = 'vencido' | 'vermelho' | 'amarelo' | 'verde' | 'azul'

export interface ZoneInfo {
  name: ZoneName
  label: string
  color: string
  bg: string
  textColor: string
  dias: number
}
