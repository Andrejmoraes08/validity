-- =============================================
-- Ajuste de RLS: dados compartilhados entre todos os usuários autenticados
-- Em um armazém, todos os operadores veem o mesmo estoque
-- =============================================

-- ITENS
drop policy if exists "itens_select" on public.itens;
drop policy if exists "itens_insert" on public.itens;
drop policy if exists "itens_update" on public.itens;
drop policy if exists "itens_delete" on public.itens;

create policy "itens_select" on public.itens for select using (auth.uid() is not null);
create policy "itens_insert" on public.itens for insert with check (auth.uid() is not null);
create policy "itens_update" on public.itens for update using (auth.uid() is not null);
create policy "itens_delete" on public.itens for delete using (auth.uid() is not null);

-- BAIXAS
drop policy if exists "baixas_select" on public.baixas;
drop policy if exists "baixas_insert" on public.baixas;

create policy "baixas_select" on public.baixas for select using (auth.uid() is not null);
create policy "baixas_insert" on public.baixas for insert with check (auth.uid() is not null);

-- HISTORICO
drop policy if exists "historico_select" on public.historico;
drop policy if exists "historico_insert" on public.historico;
drop policy if exists "historico_delete" on public.historico;

create policy "historico_select" on public.historico for select using (auth.uid() is not null);
create policy "historico_insert" on public.historico for insert with check (auth.uid() is not null);
create policy "historico_delete" on public.historico for delete using (auth.uid() is not null);

-- CONFIG
drop policy if exists "config_select" on public.config;
drop policy if exists "config_insert" on public.config;
drop policy if exists "config_update" on public.config;

create policy "config_select" on public.config for select using (auth.uid() is not null);
create policy "config_insert" on public.config for insert with check (auth.uid() is not null);
create policy "config_update" on public.config for update using (auth.uid() is not null);
