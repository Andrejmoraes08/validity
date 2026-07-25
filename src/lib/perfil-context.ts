import { createContext, useContext } from 'react'
import type { Perfil } from '@/hooks/usePerfil'

interface PerfilCtx {
  perfil: Perfil | null
  isAdmin: boolean
  tabsPermitidas: string[]
  permissoes: string[]
  can: (key: string) => boolean
}

export const PerfilContext = createContext<PerfilCtx>({
  perfil: null,
  isAdmin: false,
  tabsPermitidas: [],
  permissoes: [],
  can: () => false,
})

export const usePerfílContext = () => useContext(PerfilContext)
