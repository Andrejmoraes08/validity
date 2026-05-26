export type ItemStatus = 'ativo' | 'bloqueado' | 'baixado'

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
  bloqueado_em?: string
  bloqueado_por?: string
  baixado_em?: string
  ultima_inspecao?: string
  inspecionado_por?: string
  observacao_inspecao?: string
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
  responsavel: string
  created_at: string
  user_id: string
}

export interface Historico {
  id: string
  descricao: string
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

export type ZoneName = 'vencido' | 'vermelho' | 'amarelo' | 'verde' | 'azul'

export interface ZoneInfo {
  name: ZoneName
  label: string
  color: string
  bg: string
  textColor: string
  dias: number
}
