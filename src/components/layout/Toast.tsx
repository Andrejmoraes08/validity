'use client'
import { createContext, useCallback, useContext, useState } from 'react'

interface ToastItem { id: string; message: string; type: 'success' | 'error' | 'info' }

interface ToastCtx { toast: (message: string, type?: ToastItem['type']) => void }

const Ctx = createContext<ToastCtx>({ toast: () => {} })

export function useToast() { return useContext(Ctx) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, type: ToastItem['type'] = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600' }

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`${colors[t.type]} text-white px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-3 animate-in slide-in-from-right`}>
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'info' && 'ℹ'}
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
