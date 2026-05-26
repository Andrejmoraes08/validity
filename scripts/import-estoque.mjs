import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { read, utils } from 'xlsx'

// Carregar .env.local manualmente
const env = readFileSync('.env.local', 'utf-8')
const envVars = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => l.split('=').map(s => s.trim()))
)

const supabase = createClient(
  envVars['NEXT_PUBLIC_SUPABASE_URL'],
  envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY']
)

function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000))
  return d.toISOString().split('T')[0]
}

async function run() {
  // 1. Login
  const email = process.argv[2]
  const password = process.argv[3]
  if (!email || !password) {
    console.error('Uso: node scripts/import-estoque.mjs <email> <senha>')
    process.exit(1)
  }

  console.log('Autenticando...')
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) { console.error('Erro de autenticação:', authError.message); process.exit(1) }
  const userId = authData.user.id
  console.log('Autenticado como:', email)

  // 2. Ler planilha
  const wb = read(readFileSync('C:/Users/leodi/OneDrive/Área de Trabalho/picking_ajustado.xlsx'))
  const rows = utils.sheet_to_json(wb.Sheets['picking'], { defval: '' })
  console.log(`Total de linhas na planilha: ${rows.length}`)

  // 3. Filtrar e mapear
  const validos = rows
    .filter(r => r.DataValidade && typeof r.DataValidade === 'number')
    .map(r => ({
      sku: String(r.idProduto),
      descricao: String(r.DescricaoProduto).trim(),
      lote: r.Lote ? String(r.Lote).trim() : 'S/L',
      endereco_frac: r['Endereço Fracionado'] ? String(r['Endereço Fracionado']).trim() : (r['Endereço Grandeza'] ? String(r['Endereço Grandeza']).trim() : ''),
      endereco_gran: r['Endereço Grandeza'] ? String(r['Endereço Grandeza']).trim() : '',
      quantidade: Number(r.Qtde) || 0,
      validade: excelDateToISO(r.DataValidade),
      status: 'ativo',
      user_id: userId,
    }))
    .filter(r => r.endereco_frac) // endereco_frac é obrigatório

  console.log(`Itens válidos para importar: ${validos.length}`)
  console.log(`Pulados (sem data ou sem endereço): ${rows.length - validos.length}`)

  // 4. Inserir em lotes de 100
  let inseridos = 0
  let erros = 0
  const BATCH = 100

  for (let i = 0; i < validos.length; i += BATCH) {
    const lote = validos.slice(i, i + BATCH)
    const { error } = await supabase.from('itens').insert(lote)
    if (error) {
      console.error(`Erro no lote ${i}-${i+BATCH}:`, error.message)
      erros += lote.length
    } else {
      inseridos += lote.length
      process.stdout.write(`\rInserindo... ${inseridos}/${validos.length}`)
    }
  }

  console.log(`\n\nConcluído!`)
  console.log(`  ✓ Inseridos: ${inseridos}`)
  console.log(`  ✕ Erros:     ${erros}`)
}

run().catch(console.error)
