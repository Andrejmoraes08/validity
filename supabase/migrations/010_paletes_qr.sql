-- 010: Módulo de controle por QR Code (paletes / LPN) — foco no PULMÃO
-- ------------------------------------------------------------------------
-- Paradigma: cada QR identifica um PALETE físico (License Plate Number).
-- O picking (variável) segue no modelo atual "por linha" da tabela itens;
-- o pulmão (estático) passa a ser controlado por palete via QR.
--
-- Ciclo de vida do palete (status):
--   vazio        -> etiqueta pré-impressa, ID gerado, ainda sem dados
--   ativo        -> vinculado a um palete físico na entrada (com dados)
--   movimentando -> em trânsito entre endereços (opcional)
--   baixado      -> consumido / descido do pulmão
--
-- Seguro para reexecutar (create ... if not exists / drop policy if exists).

-- =========================================================
-- TABELA: paletes
-- =========================================================
create table if not exists public.paletes (
  id uuid primary key default gen_random_uuid(),
  lpn serial,                                  -- número sequencial legível (impresso na etiqueta)
  codigo text unique not null,                 -- conteúdo lido do QR (ex.: "PAL-000123")
  sku text,
  descricao text,
  lote text,
  quantidade integer,
  validade date,
  endereco_atual text not null default '',     -- endereço no pulmão (Rua - Prédio - Nível - Apto)
  status text not null default 'vazio'
    check (status in ('vazio', 'ativo', 'movimentando', 'baixado')),
  item_id uuid references public.itens(id) on delete set null,  -- vínculo opcional à linha de estoque
  impressa_em timestamptz,                     -- quando a etiqueta foi impressa
  vinculado_em timestamptz,                    -- quando recebeu os dados na entrada
  vinculado_por text,
  ultima_leitura timestamptz,                  -- última vez que o QR foi bipado (inspeção de posição)
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid references auth.users(id)
);

create index if not exists idx_paletes_codigo on public.paletes(codigo);
create index if not exists idx_paletes_endereco on public.paletes(endereco_atual);
create index if not exists idx_paletes_status on public.paletes(status);

drop trigger if exists tr_paletes_updated on public.paletes;
create trigger tr_paletes_updated
  before update on public.paletes
  for each row execute function update_updated_at();

alter table public.paletes enable row level security;

drop policy if exists "paletes_select" on public.paletes;
drop policy if exists "paletes_insert" on public.paletes;
drop policy if exists "paletes_update" on public.paletes;
drop policy if exists "paletes_delete" on public.paletes;

create policy "paletes_select" on public.paletes for select to authenticated using (auth.uid() is not null);
create policy "paletes_insert" on public.paletes for insert to authenticated with check (auth.uid() is not null);
create policy "paletes_update" on public.paletes for update to authenticated using (auth.uid() is not null);
create policy "paletes_delete" on public.paletes for delete to authenticated using (auth.uid() is not null);

-- =========================================================
-- TABELA: movimentacoes (log de movimentação entre endereços)
-- =========================================================
create table if not exists public.movimentacoes (
  id uuid primary key default gen_random_uuid(),
  palete_id uuid references public.paletes(id) on delete cascade not null,
  codigo text not null,                        -- cópia do código do palete (histórico)
  origem text not null default '',
  destino text not null,
  responsavel text not null default '',
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id)
);

create index if not exists idx_movimentacoes_palete on public.movimentacoes(palete_id);

alter table public.movimentacoes enable row level security;

drop policy if exists "movimentacoes_select" on public.movimentacoes;
drop policy if exists "movimentacoes_insert" on public.movimentacoes;

create policy "movimentacoes_select" on public.movimentacoes for select to authenticated using (auth.uid() is not null);
create policy "movimentacoes_insert" on public.movimentacoes for insert to authenticated with check (auth.uid() is not null);
