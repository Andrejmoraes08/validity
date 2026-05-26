import { createContext, useContext } from 'react'
import type { Perfil } from '@/hooks/usePerfil'

interface PerfilCtx {
  perfil: Perfil | null
  isAdmin: boolean
  tabsPermitidas: string[]
}

export const PerfilContext = createContext<PerfilCtx>({
  perfil: null,
  isAdmin: false,
  tabsPermitidas: [],
})

export const usePerfílContext = () => useContext(PerfilContext)
