'use client'
import { useMemo } from 'react'
import { useItens } from '@/hooks/useItens'
import { KpiCard } from '@/components/ui/KpiCard'
import { ZoneCell } from '@/components/ui/ZoneCell'
import { getZone, diasParaVencer } from '@/lib/zones'
import { fmtDate } from '@/lib/utils'

export default function DashboardPage() {
  const { itens, loading } = useItens()

  const ativos = useMemo(() => itens.filter(i => i.status === 'ativo'), [itens])
  const bloqueados = useMemo(() => itens.filter(i => i.status === 'bloqueado'), [itens])

  const skusUnicos = useMemo(() => new Set(ativos.map(i => i.sku)).size, [ativos])
  const enderecosAtivos = useMemo(() =>
    ativos.reduce((n, i) => n + (i.endereco_frac ? 1 : 0) + (i.endereco_gran ? 1 : 0), 0),
    [ativos]
  )
  const porStatus = useMemo(() => {
    const c: Record<string, number> = { ativo: 0, segregado: 0, quarentena: 0, bloqueado: 0, baixado: 0 }
    for (const i of itens) c[i.status] = (c[i.status] ?? 0) + 1
    return c
  }, [itens])

  const vencidos = useMemo(() => ativos.filter(i => diasParaVencer(i.validade) < 0).length, [ativos])
  const criticos = useMemo(() => ativos.filter(i => { const d = diasParaVencer(i.validade); return d >= 0 && d < 30 }).length, [ativos])
  const atencao = useMemo(() => ativos.filter(i => { const d = diasParaVencer(i.validade); return d >= 30 && d < 91 }).length, [ativos])

  const topVencimento = useMemo(() =>
    [...ativos].sort((a, b) => diasParaVencer(a.validade) - diasParaVencer(b.validade)).slice(0, 10),
    [ativos]
  )

  const zonasDist = useMemo(() => {
    const counts = { vencido: 0, vermelho: 0, amarelo: 0, verde: 0, azul: 0 }
    for (const i of ativos) counts[getZone(i.validade).name]++
    return counts
  }, [ativos])

  const DIA = 86400000

  // Projeção de vencimentos — unidades e itens que vencem em até 30/60/90 dias (cumulativo)
  const projecao = useMemo(() => {
    const w = [30, 60, 90].map(dias => {
      const grupo = ativos.filter(i => { const d = diasParaVencer(i.validade); return d >= 0 && d < dias })
      return { dias, itens: grupo.length, un: grupo.reduce((s, i) => s + i.quantidade, 0) }
    })
    return w
  }, [ativos])
  const projMax = useMemo(() => Math.max(1, ...projecao.map(p => p.un)), [projecao])

  // Cobertura de inspeção — % dos endereços ativos já inspecionados
  const cobertura = useMemo(() => {
    const agora = Date.now()
    const total = ativos.length
    const inspecionados = ativos.filter(i => i.ultima_inspecao).length
    const ultimos30 = ativos.filter(i => i.ultima_inspecao && (agora - new Date(i.ultima_inspecao).getTime()) / DIA <= 30).length
    return {
      total, inspecionados, nunca: total - inspecionados, ultimos30,
      pct: total ? Math.round(inspecionados / total * 100) : 0,
      pct30: total ? Math.round(ultimos30 / total * 100) : 0,
    }
  }, [ativos])

  // Envelhecimento da quarentena — há quanto tempo cada produto aguarda
  const quarentenaAging = useMemo(() => {
    const agora = Date.now()
    const q = itens.filter(i => i.status === 'quarentena')
    const b = { recente: 0, medio: 0, antigo: 0, total: q.length, un: 0 }
    for (const i of q) {
      b.un += i.quantidade
      const dias = i.quarentena_em ? (agora - new Date(i.quarentena_em).getTime()) / DIA : 0
      if (dias < 7) b.recente++
      else if (dias <= 30) b.medio++
      else b.antigo++
    }
    return b
  }, [itens])

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-400">Visão geral do estoque — {fmtDate(new Date().toISOString().split('T')[0])}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="SKUs Únicos" value={skusUnicos} color="#1f6feb" />
        <KpiCard label="Endereços Ativos" value={enderecosAtivos} color="#0e7490" />
        <KpiCard label="Vencidos" value={vencidos} color="#1a1d24" />
        <KpiCard label="Críticos (<30d)" value={criticos} color="#dc2626" />
        <KpiCard label="Atenção (30-90d)" value={atencao} color="#d4a017" />
        <KpiCard label="Bloqueados" value={bloqueados.length} color="#7c3aed" />
      </div>

      <p className="text-xs text-gray-400 -mt-3">
        Registros no sistema: <strong className="text-gray-600 font-mono">{itens.length}</strong> —{' '}
        <span className="font-mono">{porStatus.ativo}</span> ativos ·{' '}
        <span className="font-mono">{porStatus.segregado}</span> segregados ·{' '}
        <span className="font-mono">{porStatus.quarentena}</span> quarentena ·{' '}
        <span className="font-mono">{porStatus.bloqueado}</span> bloqueados ·{' '}
        <span className="font-mono">{porStatus.baixado}</span> baixados
      </p>

      {/* Painéis analíticos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projeção de vencimentos */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700">Projeção de Vencimentos</h2>
          <p className="text-xs text-gray-400 mb-4">Unidades a vencer (acumulado)</p>
          <div className="flex flex-col gap-3">
            {projecao.map((p, idx) => {
              const cor = ['#dc2626', '#ea580c', '#d4a017'][idx]
              return (
                <div key={p.dias} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-gray-600 w-20">Em {p.dias} dias</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                    <div className="h-2.5 rounded-full transition-all" style={{ width: `${Math.round(p.un / projMax * 100)}%`, background: cor }} />
                  </div>
                  <div className="text-right w-24">
                    <span className="text-sm font-mono font-extrabold" style={{ color: cor }}>{p.un}</span>
                    <span className="text-[10px] text-gray-400"> un · {p.itens} it.</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Cobertura de inspeção */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700">Cobertura de Inspeção</h2>
          <p className="text-xs text-gray-400 mb-4">Endereços ativos já inspecionados</p>
          <div className="flex items-center gap-5">
            <div className="relative w-24 h-24 flex-shrink-0">
              <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f3f4f6" strokeWidth="3.5" />
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#1f6feb" strokeWidth="3.5"
                  strokeDasharray={`${cobertura.pct} 100`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <span className="text-lg font-extrabold text-gray-800">{cobertura.pct}%</span>
              </div>
            </div>
            <div className="flex flex-col gap-2 text-xs">
              <div><span className="font-mono font-bold text-gray-800">{cobertura.inspecionados}</span> <span className="text-gray-400">de {cobertura.total} inspecionados</span></div>
              <div><span className="font-mono font-bold text-green-600">{cobertura.ultimos30}</span> <span className="text-gray-400">nos últimos 30 dias ({cobertura.pct30}%)</span></div>
              <div><span className="font-mono font-bold text-amber-600">{cobertura.nunca}</span> <span className="text-gray-400">nunca inspecionados</span></div>
            </div>
          </div>
        </div>

        {/* Envelhecimento da quarentena */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700">Quarentena — Envelhecimento</h2>
          <p className="text-xs text-gray-400 mb-4">Tempo aguardando devolução/descarte</p>
          {quarentenaAging.total === 0 ? (
            <div className="grid place-items-center h-24 text-sm text-gray-300">Nenhum produto em quarentena</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {([['recente', 'Até 7 dias', '#16a34a'], ['medio', '7 a 30 dias', '#d4a017'], ['antigo', 'Mais de 30 dias', '#dc2626']] as const).map(([key, label, cor]) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: cor }} />
                  <span className="text-xs text-gray-600 flex-1">{label}</span>
                  <span className="text-sm font-mono font-extrabold" style={{ color: cor }}>{quarentenaAging[key]}</span>
                </div>
              ))}
              <div className="border-t border-gray-100 pt-2 mt-1 flex justify-between text-xs">
                <span className="text-gray-400">Total</span>
                <span className="font-mono font-bold text-gray-700">{quarentenaAging.total} produtos · {quarentenaAging.un} un</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Distribuição por zona */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Distribuição por Zona</h2>
          <div className="flex flex-col gap-3">
            {[
              { name: 'Vencido', key: 'vencido' as const, color: '#1a1d24' },
              { name: 'Crítico', key: 'vermelho' as const, color: '#dc2626' },
              { name: 'Atenção', key: 'amarelo' as const, color: '#d4a017' },
              { name: 'Seguro', key: 'verde' as const, color: '#16a34a' },
              { name: 'OK', key: 'azul' as const, color: '#1f6feb' },
            ].map(z => {
              const count = zonasDist[z.key]
              const pct = ativos.length ? Math.round(count / ativos.length * 100) : 0
              return (
                <div key={z.key} className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: z.color }} />
                  <span className="text-xs text-gray-600 w-16">{z.name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: z.color }} />
                  </div>
                  <span className="text-xs font-mono font-bold text-gray-700 w-8 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top vencimento */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h2 className="text-sm font-bold text-gray-700 mb-4">Próximos a Vencer</h2>
          {topVencimento.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhum item ativo</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 text-gray-400 font-medium">SKU</th>
                    <th className="text-left py-2 text-gray-400 font-medium">Descrição</th>
                    <th className="text-left py-2 text-gray-400 font-medium">Endereço</th>
                    <th className="text-left py-2 text-gray-400 font-medium">Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {topVencimento.map(item => (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 font-mono font-semibold text-gray-700">{item.sku}</td>
                      <td className="py-2 text-gray-600 max-w-[200px] truncate">{item.descricao}</td>
                      <td className="py-2 font-mono text-gray-500">{item.endereco_frac}</td>
                      <td className="py-2"><ZoneCell validade={item.validade} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
