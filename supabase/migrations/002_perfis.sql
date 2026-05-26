-- =============================================
-- TABELA: perfis (controle de acesso por usuário)
-- =============================================
create table public.perfis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade not null,
  email text not null,
  nome text default '',
  role text not null default 'operador' check (role in ('admin', 'operador')),
  tabs_permitidas text[] not null default array['dashboard', 'estoque', 'inspecao'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tr_perfis_updated
before update on public.perfis
for each row execute function update_updated_at();

create index idx_perfis_user on public.perfis(user_id);

alter table public.perfis enable row level security;

-- Todos os autenticados podem ler todos os perfis (ferramenta interna)
create policy "perfis_select" on public.perfis
  for select using (auth.uid() is not null);

-- Cada usuário cria o seu próprio perfil
create policy "perfis_insert" on public.perfis
  for insert with check (auth.uid() = user_id);

-- Qualquer autenticado pode atualizar (admin gerencia via app)
create policy "perfis_update" on public.perfis
  for update using (auth.uid() is not null);
