# Ferramentas de performance

Medem a dashboard de forma reproduzível, **sem tocar em produção**.

## Como funciona

- O build de benchmark usa uma URL do Supabase **falsa** (`https://benchmock.supabase.co`). Nada consegue chegar ao banco real.
- `mock.mjs` simula o backend em memória: REST/PostgREST (com filtros, ordenação e paginação), RPCs, Auth e Realtime (WebSocket Phoenix), com latência configurável e dados determinísticos.
- Usa o Playwright que já está em `.verification.local/node_modules`. Não instala nada novo.
- Saídas ficam em `.verification.local/perf/` (ignorado pelo git).

## Passo a passo

```bash
# 1. Build de benchmark (backend falso). Rode uma vez por versão do código.
VITE_SUPABASE_URL=https://benchmock.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=bench-anon-key VITE_TURNSTILE_SITE_KEY= \
  npx vite build --outDir .verification.local/perf/dist-atual --emptyOutDir
# (acrescente --sourcemap se for usar profile.mjs)

# 2. Tamanho do bundle: bruto/gzip/brotli e caminho crítico de cada rota
node scripts/perf/measure-dist.mjs .verification.local/perf/dist-atual atual

# 3. Runtime: boot, ociosidade, scroll, clique em filtro, "tempestade" de eventos realtime, navegação
node scripts/perf/bench.mjs --dist .verification.local/perf/dist-atual --label atual --runs 5 --cpu 1 \
  --out .verification.local/perf/atual.json
#   --cpu 4            simula uma máquina 4x mais lenta
#   --net fast4g       perfil de rede dos assets (cable | fast4g | slow4g)
#   --api-latency 150  latência simulada do backend (ms). O banco real está em us-east-2.
#   --scenarios boot,idle,scroll,filter,storm,nav

# 4. Comparar duas versões (mesmas opções nas duas medições)
node scripts/perf/compare.mjs .verification.local/perf/antes.json .verification.local/perf/atual.json "titulo"
#    ou A/B intercalado (recomendado: cancela a deriva da máquina)
scripts/perf/ab-run.sh <distA> <distB> 5 1 .verification.local/perf/ab
node scripts/perf/compare.mjs .verification.local/perf/ab/A.json .verification.local/perf/ab/B.json "A vs B"
```

## Verificações de comportamento (rode depois de qualquer otimização)

```bash
# Semântica da sincronização: 1 onda por mudança, sem repetição pelo poll, fallback sem Realtime, aba oculta, lacuna na assinatura
node scripts/perf/sync-tests.mjs --dist <dist-de-benchmark>

# Texto e visual das telas principais, antes x depois (relógio congelado, sem animação)
node scripts/perf/snap.mjs --dist <dist-antes>  --out .verification.local/perf/snap-antes
node scripts/perf/snap.mjs --dist <dist-depois> --out .verification.local/perf/snap-depois
node scripts/perf/diffsnap.mjs .verification.local/perf/snap-antes .verification.local/perf/snap-depois

# Suíte de verificação do próprio repo (scripts/verify-*.mjs totalmente mockados), contra um build com o .env REAL
npx vite build --outDir .verification.local/perf/dist-real --emptyOutDir
scripts/perf/run-suite.sh .verification.local/perf/dist-real atual
```

`run-suite.sh` só inclui scripts que mockam todo request ao Supabase e bloqueiam o WebSocket. **Não** rode `verify-crm-ui.mjs`, `verify-products-ui.mjs`, `check-*-db.mjs` nem `apply-*-migration.mjs` sem saber o que fazem: eles falam com o banco real.

## Diagnóstico

```bash
node scripts/perf/profile.mjs --dist <dist com --sourcemap> --steps boot,idle,filter,scroll,storm --cpu 4   # CPU por módulo do app
node scripts/perf/trace-idle.mjs --dist <dist> --runs 3 --label x                                          # tempo próprio por evento com a página parada
```

## Como ler os números

- Esta máquina tem variância grande entre execuções idênticas (o boot variou 1,5 a 2,6 s). Use **medianas de 5 ou mais execuções** e o A/B intercalado.
- O headless renderiza por software: os valores absolutos de paint/scroll são pessimistas. Valem para comparar versões, não como número de GPU real.
- Os dados de teste são maiores que os de produção em alguns pontos e menores em outros; o gargalo real hoje é latência (banco em Ohio) e re-renderização, não volume.
