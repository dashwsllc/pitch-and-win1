# PROMPT — Reconstruir a "Visão geral" (dashboard) idêntica à referência, na paleta e no nicho do meu projeto

> **Como usar.** Abra o Claude Code na raiz do projeto de **destino** e cole este arquivo inteiro. Se preferir, copie-o para a raiz do projeto como `PROMPT-VISAO-GERAL.md` e escreva: *"Leia o @PROMPT-VISAO-GERAL.md inteiro e execute até o fim."* Anexe também as imagens da pasta `referencias/` (Apêndice A): elas são a verdade visual. O script do Apêndice C também está salvo ao lado como `validar-paleta.mjs`. Você **não tem acesso ao projeto de origem**; tudo de que precisa está neste arquivo: instruções nas seções 0 a 11 e código real nos apêndices B a D.

## Sumário

0. Missão
1. Regras inegociáveis
2. Plano de trabalho e relatório final
3. A referência em uma página (stack, shell, grade, blocos)
4. Medidas e escalas
5. Paleta: como adaptar sem perder o visual
6. Nicho: do que existe na referência para o que existe no seu projeto
7. Dados e sincronização (não desincronizar nada)
8. Estados, acessibilidade e movimento
9. Responsividade
10. Pontos de atenção da referência
11. Checklist de aceite
- Apêndice A — Imagens de referência
- Apêndice B — CSS e tokens completos
- Apêndice C — Validador de paleta (script pronto)
- Apêndice D — Código de referência, arquivo por arquivo

---

## 0. Missão

Reconstrua a página **Visão geral** (o dashboard principal) do projeto em que você está trabalhando para que fique **idêntica** à referência descrita aqui: mesma estrutura, mesmos gráficos, mesma hierarquia tipográfica, mesmos espaçamentos, mesmos cantos, mesmas animações e mesmo comportamento. Só são permitidas **três adaptações**:

1. **Paleta.** Toda cor vem da paleta que o projeto já usa (seção 5). A referência é azul, laranja e verde; o seu projeto não precisa ser.
2. **Nicho.** Textos, métricas, ícones e blocos falam do negócio do seu projeto. A referência é o painel de um encontro com leitura de QR Code, indicações, Instagram e regra de cota. **Nada disso existe no seu projeto e não deve aparecer** (seção 6).
3. **Dados.** Tudo o que o painel atual do seu projeto já mostra continua sendo mostrado, **a partir das mesmas fontes e com os mesmos números** (seção 7). Muda a camada visual e a composição da página; os dados e a sincronização não mudam.

Todo o resto é fixo. "Idêntico" significa que o código do Apêndice D e as imagens do Apêndice A **são** a especificação. Não melhore, não simplifique, não "modernize", não troque a biblioteca de gráficos, não acrescente sombras, degradês ou animações que a referência não tem.

**Fora do escopo:** migrar a stack do projeto, mexer em outras páginas, mudar regras de negócio, criar migrations, alterar permissões.

---

## 1. Regras inegociáveis

**R1 — Dados e sincronização (a mais importante).** O painel de destino já tem uma camada de dados (consultas, store, assinatura em tempo real, polling…). **Reaproveite-a.** Não crie segunda fonte, segundo cache, contador próprio nem outra assinatura. Os números novos saem das mesmas consultas e das mesmas fórmulas do painel atual. Se precisar de um dado novo, estenda a camada existente sem alterar o que ela já entrega. Procedimento e teste de paridade na seção 7.

**R2 — Nenhum dado inventado.** Sem mock, seed, "exemplo" ou número de enfeite em lugar nenhum. Sem dado, valem os estados vazios da seção 8. Um bloco cujo dado não existe no projeto é **omitido** (a grade se reorganiza, 6.3); nunca é preenchido com valor fictício.

**R3 — Cor só por token.** Nenhuma cor hexadecimal, `rgb()` ou classe de paleta do Tailwind (`blue-500`, `emerald-600`…) dentro de componentes. Tudo vem dos tokens do Apêndice B, que derivam da paleta do projeto (seção 5). As únicas exceções são os valores dentro do próprio arquivo de tokens e o `text-white` / `#fff` sobre os degradês de ação (5.5).

**R4 — Fidelidade.** Mesma estrutura de DOM, mesmas classes e medidas, mesmos textos de apoio (adaptados ao nicho), mesmas animações. Não mude raio de borda, peso de linha, espaçamento nem a ordem dos blocos. Só diverja quando o projeto de destino **obrigar** (ex.: outro framework) e registre no relatório.

**R5 — Sem biblioteca de gráficos.** Os gráficos da referência são SVG e HTML/CSS escritos à mão (Apêndice D). Não instale Recharts, Chart.js, Nivo, Victory, D3 etc. As únicas dependências novas admitidas são as da seção 3.1, e só se o projeto ainda não as tiver. Se o projeto já usa uma biblioteca de gráficos em outras telas, não a remova e não a use na Visão geral.

**R6 — Um recorte para a tela inteira.** Período e filtros valem para **todos** os blocos ao mesmo tempo. Cada bloco deriva do mesmo conjunto já filtrado, calculado uma vez (memoizado) a cada mudança de dados ou de filtro. Nunca dois blocos com recortes diferentes sem aviso na tela.

**R7 — Formatos pt-BR.** Números com `Intl.NumberFormat('pt-BR')`; porcentagem com no máximo 1 casa ("59,5%"); hora `HH:mm`; data `dd/MM/aaaa`; duração "1 min 41 s". Horários guardados em UTC e exibidos no **fuso do negócio** (`Intl.DateTimeFormat` com `timeZone`), sem biblioteca de datas. "Última hora", "hoje" e "há X s" usam um relógio que anda sozinho (`useAgora`, `useHa`), nunca `Date.now()` solto durante a renderização.

**R8 — Escopo.** Altere só a Visão geral e o que ela compartilha (tokens, componentes visuais, shell). Não mexa em regra de negócio, rotas existentes, autenticação, permissões ou banco. **Sem migrations.** Não renomeie colunas, campos, rotas nem chaves de armazenamento existentes. Telas fora do painel (site público, login) não podem mudar de aparência: escope os tokens (Apêndice B).

**R9 — O que existia não some.** Todo número, gráfico, tabela, filtro e ação que o dashboard atual mostra continua disponível: no slot equivalente ou num bloco extra no mesmo padrão visual (`Bloco` + `KpiCard`/`Barras`/tabela). Ver 7.5.

**R10 — Acessibilidade e movimento.** Tudo o que a referência faz (seção 8): rótulos ARIA, teclado no gráfico, tabela alternativa em `<details>`, `prefers-reduced-motion`, foco visível, cor nunca sozinha.

**R11 — "Ao vivo" é verdade.** O selo "Ao vivo", a frase "atualiza sozinho" e o "atualizado há X" só aparecem se o projeto realmente se atualiza (tempo real ou polling). Sem isso, omita o selo e a frase e deixe apenas o botão "Atualizar".

**R12 — Execução direta.** Siga até o fim sem pausar para confirmar etapas. Só pare diante de ação destrutiva ou irreversível (apagar dados, migration em produção, `push --force`). Dúvida: escolha a opção mais simples e registre como premissa no relatório final.

**R13 — Idioma.** Interface em pt-BR com acentuação correta (ou o idioma que o projeto já usa). Para identificadores de código, siga a convenção do projeto de destino (a referência usa português: `rotulo`, `valor`, `detalhe`, `lateral`).

**R14 — Privacidade.** Dados pessoais (nome, telefone, e-mail) só aparecem se o painel atual já os mostra, e para os mesmos papéis de usuário. Ações como copiar telefone ou abrir WhatsApp só entram se o projeto já tem esse fluxo.

**R15 — Tipografia.** A fonte da referência é a DM Sans Variable (pesos usados: 400, 500, 600 e 700; `font-optical-sizing: auto`), aplicada só no escopo do painel. Mantenha. Só troque se o guia de marca do projeto **exigir** outra fonte para o painel; nesse caso mantenha os tamanhos, pesos e entrelinhas da seção 4.1 e registre a decisão no relatório.

---

## 2. Plano de trabalho e relatório final

Trabalhe nesta ordem. Cada fase termina com um critério de saída verificável; só avance quando ele for atendido.

### Fase 0 — Auditoria (somente leitura)

Antes de escrever código, leia o projeto de destino e **escreva no chat** um relatório curto com:

- **a) Stack**: framework, estilização, kit de UI, roteamento, biblioteca de gráficos e de datas (se houver), gerenciador de estado, testes, versões.
- **b) Paleta e tokens atuais**: onde vivem (CSS, tema do Tailwind, `DESIGN.md`, guia de marca, logotipo), tema claro/escuro, fonte, raio de borda. **A paleta do projeto é a fonte da verdade das cores.**
- **c) Shell atual**: layout do painel, menu lateral, barra superior, rotas.
- **d) Dashboard atual, inventário completo**: para cada KPI, gráfico, tabela, lista, filtro e ação, anote nome na tela, arquivo, fonte do dado (consulta, hook, endpoint, tabela), fórmula, frequência de atualização e papel de usuário que enxerga. Esse inventário é a base do teste de paridade (7.4).
- **e) Camada de dados**: como carrega, como atualiza (tempo real, polling, manual), onde guarda o estado, como trata erro e offline.
- **f) Mapa slot → dado** (seção 6) com as decisões e as lacunas (o que será omitido e por quê).

**Saída:** relatório escrito; nenhum arquivo alterado.

### Fase 1 — Base visual
Aplique os tokens do Apêndice B **com a paleta do projeto** (seção 5), a fonte, o raio, o tema claro/escuro e o escopo CSS (tokens que não vazam para telas fora do painel). Rode o validador (Apêndice C) nos dois temas.
**Saída:** validador sem `FAIL` nos dois temas; os dois temas mostram fundo, cartão, texto e bordas coerentes.

### Fase 2 — Primitivos
`Bloco`, `KpiCard`, `NumeroAnimado`, `scale.ts`, `geometria.ts`, formatadores de data e hora, `dashboard.css` (Apêndice D).
**Saída:** testes de `niceTicks` passando; `KpiCard` e `Bloco` idênticos às imagens.

### Fase 3 — Gráficos
`Sparkline`, `RingGauge`, gráfico de série temporal (`HourlyChart`), `Barras`, `DistributionChart`, `FunilJornada`.
**Saída:** testes do gráfico (teclado e estado vazio) passando; mira e dica idênticas à imagem 06.

### Fase 4 — Listas e blocos
Pódio (ou top N), feed ao vivo, lista de recentes, ficha lateral e cartão de contexto (só se existir no seu nicho).
**Saída:** estados vazio, 1, 2 e 3+ itens iguais às imagens 10 e 11 e à seção 8.

### Fase 5 — Shell e filtros
Layout com menu e barra superior (selo ao vivo, "atualizado há", atualizar), tema e filtros no endereço. Se o projeto já tem shell, preserve rotas e itens e aplique só o visual e o que falta.
**Saída:** navegação atual intacta; filtros refletidos na URL.

### Fase 6 — Composição e view-model
Monte a página com a grade e os `col-span` do `OverviewPage` do Apêndice D, ligada à camada de dados **existente** por seletores puros e memoizados (seção 7).
**Saída:** todos os slots decididos na Fase 0 renderizam com dados reais; blocos sem dado foram omitidos e a grade se reorganizou (6.3).

### Fase 7 — Verificação
Tudo da seção 11: paridade numérica antes × depois, comparação visual com as imagens (390, 820, 1440 e 1920 px; claro e escuro; vazio), teclado e leitor de tela, `prefers-reduced-motion`, typecheck, lint, testes e build.
**Capturas:** gere imagens da sua página nos mesmos tamanhos de janela (ex.: Playwright com Chromium) e compare lado a lado com as do Apêndice A. Para ver a página cheia use dados reais do ambiente de desenvolvimento; se ele estiver vazio, compare o estado vazio (imagens 10 e 11) e valide os componentes com dados de teste que **não** entram no código de produção (R2). Se não houver como abrir um navegador, registre isso nas pendências.

### Relatório final (formato obrigatório)

1. Resumo em até 5 linhas.
2. Arquivos criados e alterados.
3. Tabela **slot da referência → bloco no projeto → fonte do dado → fórmula → status** (feito / omitido / extra).
4. **Paridade**: cada número do painel antigo × o novo, com o conjunto de dados usado.
5. **Paleta**: tokens finais (claro e escuro) e a saída do validador.
6. **Verificação**: comandos executados e o resultado de cada um; capturas comparadas com as imagens.
7. **Premissas e decisões** (tudo o que foi ambíguo e como foi resolvido).
8. **Pendências e limites** (o que não pôde ser verificado e por quê).

---

## 3. A referência em uma página

### 3.1 Stack e dependências da referência

| Item | Referência |
|---|---|
| Linguagem e build | TypeScript, React 19, Vite |
| Estilo | Tailwind CSS v4 (CSS-first: `@import "tailwindcss"`, `@theme inline`, sem `tailwind.config`) + `tw-animate-css` |
| Kit de UI | shadcn/ui, estilo **`radix-nova`**, base `neutral`, variáveis CSS, ícones `lucide`; pacotes `radix-ui`, `class-variance-authority` e `cn` |
| Componentes usados | Button, Badge, Tooltip, Sidebar (Provider, Inset, Trigger, Menu…), Sheet, Input, Label, Separator, DropdownMenu, AlertDialog (só na ficha), Sonner |
| Ícones | `lucide-react` |
| Fonte | DM Sans Variable (`@fontsource-variable/dm-sans/wght.css`) com `font-optical-sizing: auto` |
| Roteamento | `react-router` (`useSearchParams`, `Link`, `NavLink`, `useNavigate`); cada página em chunk próprio (`lazy` + `Suspense`) |
| Gráficos | **Nenhuma biblioteca.** SVG e HTML/CSS escritos à mão |
| Datas e números | `Intl.DateTimeFormat` e `Intl.NumberFormat`, sem biblioteca de datas |
| Estado ao vivo | store imutável + `useSyncExternalStore` (Apêndice D, `event-store.ts`) |

**Se a stack do destino for outra:**

- *React + Tailwind v3*: registre as cores `viz-*` em `theme.extend.colors` de modo que os modificadores de opacidade (`bg-viz-1/12`) funcionem (valor em `color-mix(...)` ou canais RGB com `<alpha-value>`) e ajuste `bg-gradient-to-*` à versão.
- *Next.js ou Remix*: marque como Client Component o que usa hooks; `useSearchParams` exige `Suspense`; cuide da hidratação de horários (fuso) e de `matchMedia`.
- *Sem Tailwind* (CSS Modules, styled-components…): porte cada classe para CSS com as medidas da seção 4; as classes `stroke-*` e `fill-*` dos SVGs viram regras que apontam para os tokens (`.stroke-viz-1 { stroke: var(--viz-1) }`).
- *Vue, Svelte, Angular…*: porte 1:1 mantendo o **mesmo DOM**, as mesmas medidas, os mesmos atributos ARIA e a mesma lógica. Os utilitários puros (`scale`, `geometria`, `time`, `stats`) portam sem mudança.
- *Sem kit de UI*: use as medidas de Button, Badge, Tooltip, Sheet e Sidebar da seção 4 e dos arquivos do Apêndice D.

### 3.2 Shell (o que existe em volta da página)

- **Menu lateral** (Sidebar do shadcn, `collapsible="icon"`): 16 rem (256 px) de largura, 3 rem recolhido, 18 rem como gaveta no celular (< 768 px). Atalho de teclado `Ctrl/⌘ + B`. Cabeçalho com seletor de evento (ícone dentro de um quadrado de 32 px preenchido com `--gradiente-corrente`); grupos "Acompanhar" e "Gerenciar" (rótulo de 10,5 px, maiúsculas, espaçamento 0,12 em); item ativo com fundo `--sidebar-accent` e **filete de 2 px em `--gradiente-corrente`** à esquerda; rodapé com a conta e o menu de tema (Claro / Escuro / Sistema).
- **Área principal** (`SidebarInset`, elemento `<main>`): fundo `--background` mais a classe **`atmosfera`** (no escuro, dois brilhos radiais muito suaves: canto superior direito e canto inferior esquerdo).
- **Barra superior** (`Topbar`): `sticky top-0 z-20`, 56 px de altura, borda inferior, fundo `background/85` com `backdrop-blur-md`. À esquerda: gatilho do menu, separador vertical, nome do evento (semibold, `--heading`), local (só ≥ 1024 px) e selo de situação (só ≥ 640 px). À direita: pílula de erro (quando houver), **selo "Ao vivo"** (ponto que pulsa), "atualizado há X" (só ≥ 768 px; anda a cada 1 s) e botão de atualizar (gira durante a recarga). Durante a recarga uma **barra de 2 px** corre na borda inferior da barra superior.
- **Contêiner da página**: `mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 pb-12 pt-5 md:px-6 lg:px-8`.
- **Tema**: classe `dark` no `<html>`; abre **escuro** por padrão; a escolha (Claro / Escuro / Sistema) fica em `localStorage`; `color-scheme` acompanha o tema (campos de data e barras de rolagem nativos ficam no tema certo).

### 3.3 A página, de cima para baixo

1. **Cabeçalho**: *eyebrow* (`text-xs`, semibold, maiúsculas, `tracking-[0.14em]`, cor `--viz-1`); `h1` "Visão geral" (`text-3xl`, `md:text-4xl`, semibold, `tracking-tight`, `--heading`); linha de apoio (`text-sm`, atenuada) com ícone de calendário, a data de hoje por extenso no fuso do negócio e uma frase **verdadeira** sobre a atualização.
2. **Barra de filtros** (`mb-5`, `flex flex-wrap items-center gap-2`): controle segmentado *Período* (Tudo / Hoje / Última hora / Intervalo; "Intervalo" revela dois campos `datetime-local` separados por "até") e controle segmentado *Origem* (Todas / QR / Link); botão "Limpar filtros" quando há filtro ativo; mensagem vermelha (`role="alert"`) se o intervalo for inválido. O estado vive na URL: `?periodo=&de=&ate=&origem=`.
3. **Grade**: `grid gap-4 md:grid-cols-2 xl:grid-cols-12`. Blocos, na ordem do DOM:

| # | Bloco | `md` (2 col.) | `xl` (12 col.) | Forma |
|---|---|---|---|---|
| 1 | KPI destaque | 2 | 5 | Cartão com brilho (`cartao-brilho`), número gigante, detalhe e **minigráfico de área** à direita (escondido < 640 px) |
| 2 | KPI com barra dividida | 1 | 3 | Número, barra de 8 px com 2 segmentos e respiro de 2 px, legenda com pontos coloridos e totais |
| 3 | KPI taxa | 1 | 2 | Porcentagem, detalhe "X de Y …", **anel de progresso** (76 px) |
| 4 | KPI meta | 2 | 2 | Número, detalhe, anel com "n de N" no centro, parágrafo explicativo com filete superior |
| 5 | Série temporal | 2 | 8 | `Bloco` com gráfico SVG de área + linha, 280 px de altura, mira, dica, teclado e tabela alternativa; clicar numa hora abre a lista daquela hora |
| 6 | Pódio / top | 2 | 4 | Pódio compacto (2º, 1º, 3º) com degraus que sobem + lista do 4º ao 6º |
| 7 | Funil | 1 | 4 | 3 barras de 10 px em rampa ordinal + rodapé com 2 números |
| 8 | Barras horizontais | 1 | 4 | Lista com avatar de 28 px, valor e % ao lado, barra de 8 px |
| 9 | Feed ao vivo | 2 | 4 | 9 itens de tipos mistos, "há X" que anda, realce nos novos |
| 10 | Últimos registros | 2 | 12 | Lista de 8 linhas (hora, nome e telefone, indicação, selo, ações); a linha inteira abre a ficha |
| 11 | Cartão de contexto (opcional) | 2 | 12 | Endereço e mapa, unidade ou meta |
| 12 | Distribuição A | 1 | 6 | Barras horizontais com trilho e "n (x%)"; **só se o atributo é coletado** |
| 13 | Distribuição B | 1 | 6 | idem |

4. **Ficha lateral** (`Sheet`, `sm:max-w-lg`): abre ao clicar num item do feed ou numa linha de "Últimos registros".

### 3.4 Diagrama

```
xl (≥ 1280 px de viewport)
┌─ Menu 256 px ─┬─ Barra superior (56 px, sticky) ───────────────────────────────────────────┐
│               │ eyebrow · H1 · linha de apoio                                               │
│               │ [Tudo|Hoje|Última hora|Intervalo]  [Todas|QR|Link]                          │
│               │ ┌ KPI destaque · 5 ───────┐┌ KPI · 3 ───┐┌ KPI · 2 ┐┌ KPI · 2 ┐             │
│               │ ┌ Série temporal · 8 ─────────────────────────┐┌ Pódio · 4 ───┐             │
│               │ ┌ Funil · 4 ────┐┌ Barras · 4 ────┐┌ Feed ao vivo · 4 ────────┐              │
│               │ ┌ Últimos registros · 12 ───────────────────────────────────────┐            │
│               │ ┌ Cartão de contexto · 12 ──────────────────────────────────────┐            │
│               │ ┌ Distribuição A · 6 ────────────┐┌ Distribuição B · 6 ─────────┐            │
└───────────────┴─────────────────────────────────────────────────────────────────────────────┘
md (768–1279 px): 2 colunas
  [KPI destaque ········ 2]  [KPI 2][KPI 3]  [KPI meta ········ 2]  [Série ········ 2]
  [Pódio ········ 2]  [Funil][Barras]  [Feed ········ 2]  [Últimos ········ 2]
  [Contexto ········ 2]  [Distribuição A][Distribuição B]
< 768 px: 1 coluna; o menu vira gaveta
```

Atenção: os pontos de quebra são do **viewport**, não do contêiner. Com o menu aberto, entre 1280 e ~1500 px os KPIs de 2 colunas ficam estreitos e o texto quebra em várias linhas (imagem 01). É o comportamento da referência.

---

## 4. Medidas e escalas

Tailwind v4: 1 unidade de espaçamento = 0,25 rem = 4 px. As classes completas estão no Apêndice D; as tabelas abaixo servem para conferir o resultado e para portar fora do Tailwind.

### 4.1 Tipografia (DM Sans Variable)

| Uso | Classe | Tamanho / entrelinha (px) | Peso | Observações |
|---|---|---|---|---|
| Número do KPI destaque | `text-5xl md:text-6xl` | 48 → 60 (`leading-none`) | 600 | `tracking-tight`; dígitos **proporcionais** (sem `tabular-nums`) |
| Número do KPI | `text-4xl` | 36 (`leading-none`) | 600 | idem |
| `h1` | `text-3xl md:text-4xl` | 30/36 → 36/40 | 600 | `tracking-tight` |
| *Eyebrow* | `text-xs` maiúsculas | 12/16 | 600 | `tracking-[0.14em]`, cor `--viz-1` |
| Título de bloco | `text-[0.95rem]` | 15,2 | 600 | `--heading` |
| Rótulo de KPI | `text-sm` | 14/20 | 500 | atenuado |
| Apoio e descrições | `text-xs` | 12/16 | 400 | atenuado |
| Rótulos dos eixos | `text-[11px]` | 11 | 400 | `fill-muted-foreground`, `tabular-nums` nos valores |
| Valor final do gráfico | `text-xs font-semibold tabular-nums` | 12 | 600 | `fill-foreground` |
| Grupo do menu | CSS | 10,5 | 400 | maiúsculas, `letter-spacing: 0.12em` |
| Cabeçalho de tabela | CSS | 11 | 600 | maiúsculas, `letter-spacing: 0.05em` |

### 4.2 Raios (a escala é múltipla de `--radius = 0,625 rem = 10 px`)

| Utilitário | px | Onde |
|---|---|---|
| `rounded-sm` | 6 | foco de links, itens pequenos |
| `rounded-md` | 8 | botões de menu |
| `rounded-lg` | 10 | botões, campos, dica do gráfico, linhas de lista |
| `rounded-xl` | 14 | chip de ícone do KPI, controle segmentado, itens do feed |
| `rounded-2xl` | **18** | **cartões** (KPI, Bloco, contexto) |
| `rounded-4xl` | 26 | selos (`Badge`) |
| `rounded-full` | pílula | barras, trilhos, pontos, avatares, anel |
| `rounded-[0.6rem]` | 9,6 | botão interno do controle segmentado |
| `rounded-[3px]` | 3 | amostra da legenda da área |

**O que vale é o resultado em pixels** (cartão a 18 px, chip e itens a 14 px, controles a 10 px). Se o projeto já usa a escala do shadcn (múltiplos de `--radius`), basta definir `--radius: 0.625rem` no escopo do painel. Se não usa, defina os valores acima no escopo do painel sem alterar o raio de telas fora dele.

### 4.3 Elementos

| Elemento | Medidas |
|---|---|
| Cartão (`KpiCard`, `Bloco`) | `rounded-2xl border p-4 md:p-5` (16 → 20 px), fundo `--card`; destaque: `cartao-brilho border-transparent` |
| Cabeçalho do `KpiCard` | `gap-2.5` (10 px); chip `size-8` (32 px) `rounded-xl bg-viz-1/12 text-viz-1 ring-1 ring-viz-1/20`; ícone `size-4` |
| Corpo do `KpiCard` | `mt-3 flex items-end justify-between gap-3`; detalhe `mt-2 text-xs` |
| `Bloco` | cabeçalho `mb-4 flex items-start justify-between gap-3`; descrição `mt-0.5 text-xs` |
| Grade | `gap-4` (16 px) |
| Minigráfico | SVG 160 × 48 (`w-40`), margem 3, linha 2 px, ponto final r 3,5 com anel de 2 px na cor do cartão, área com degradê de 0,4 a 0 de opacidade |
| Anel | 76 px, traço 8 px, pontas arredondadas, início às 12 h (rotação −90°), transição de `stroke-dashoffset` 700 ms ease-out |
| Barra dividida | altura 8 px, `gap-[2px]`, segmentos `rounded-full` com `flex-grow` = valor; trilho `bg-muted` |
| Gráfico de série | altura **280 px**; margens {topo 16, direita 16, base 30, esquerda 40}; ~4 marcas "redondas" no eixo Y a partir do zero; rótulos de X espaçados por `ceil(n / max(2, floor(larguraÚtil/64)))`; linha principal 2,5 px (`viz-1`), secundária 2 px (`viz-2`), área com degradê 0,26 → 0; ponto final r 4,5 com anel 2 px; no hover, pontos r 5,5 e 5 e mira de 1 px `muted-foreground/50` |
| Dica do gráfico | `min-w-36` (144 px), `rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur`; vira para a esquerda quando a mira passa de 60% da largura |
| Legenda do gráfico | `text-xs`, `gap-x-5`; amostra da área `h-2.5 w-4 rounded-[3px] bg-gradient-to-b from-viz-1/70 to-viz-1/10 ring-1 ring-viz-1`; amostra da linha `w-4 border-t-2 border-viz-2` |
| Lista de barras | linha `rounded-lg px-1.5 py-1` (`hover:bg-muted/50`), `space-y-3`; trilho `h-2 rounded-full bg-viz-track/60`; avatar 28 px |
| Distribuição | grade `grid-cols-[minmax(6rem,9rem)_1fr_5.5rem] gap-3`; barra `h-2.5` com degradê `from-viz-1/50 to-viz-1`; largura mínima de 6 px para valores > 0 |
| Funil | 3 barras `h-2.5` em rampa ordinal; rodapé `mt-4 grid grid-cols-2 gap-2 border-t pt-3 text-xs`, números `text-base font-semibold` |
| Pódio compacto | grade de 3 colunas (`gap-2`), avatares `size-11`, coroa `size-5`, degraus 80 / 56 / 44 px, total `text-2xl` |
| Feed | item `rounded-xl px-1.5 py-2`; ícone `size-8 rounded-full`; "há X" em `text-[11px] tabular-nums` |
| Lista de recentes | linha `rounded-lg px-2 py-2.5`; colunas `3.25rem 1fr auto` (`md`: `3.25rem 1.1fr 1fr auto`); `divide-y divide-border` |
| Controle segmentado | `inline-flex rounded-xl border bg-card p-0.5`; item `h-8 px-3 text-sm font-medium`; ativo `bg-primary text-primary-foreground shadow-sm` |
| Campos de data | `h-9 w-[12.5rem]` |
| Selo ao vivo | `rounded-full border bg-card/60 px-2.5 py-1 text-xs font-medium`; ponto `size-2` |
| Botão atualizar | `Button variant="ghost" size="icon-sm"` (28 px) |
| `Button` | padrão `h-8`, `sm` `h-7`, `icon` `size-8`, `icon-sm` `size-7`; `rounded-lg`; o botão `default` recebe `--gradiente-acao` por CSS (Apêndice B) |

---

## 5. Paleta: como adaptar sem perder o visual

O visual da referência vem de **papéis de cor**, não de cores específicas: fundo → cartão → popover sobem em degraus de luminosidade; o texto tem 3 níveis; as bordas são filetes quase invisíveis; os dados usam 2 cores principais bem separadas; o destaque da marca aparece em poucos lugares (eyebrow, chip de ícone, item ativo, botão principal, brilho do cartão de destaque). **Preserve os papéis e troque os valores pela paleta do projeto.**

### 5.1 Papéis e valores de referência

Os tokens são os do Apêndice B. A coluna "Como obter do projeto" diz de onde tirar o valor.

| Token | Papel | Claro (ref.) | Escuro (ref.) | Como obter do projeto |
|---|---|---|---|---|
| `--background` | fundo da página | `#f3f6fb` | `#070b14` | fundo do app. Claro: cinza muito leve com o matiz da marca (L ≈ 0,97). Escuro: o degrau mais escuro (L ≈ 0,15) |
| `--card` | cartões | `#ffffff` | `#0d1422` | claro: branco. Escuro: **1 degrau acima** do fundo |
| `--popover` | dica, menus, gaveta | `#ffffff` | `#111a2c` | **1 degrau acima** do cartão (escuro) |
| `--muted` / `--secondary` | trilhas, chips, hover de linha | `#eef2f8` | `#131d31` / `#152036` | cinza com o matiz da marca, entre o fundo e o cartão |
| `--accent` | hover de itens | `#e8eef8` | `#16233b` | um passo além de `--muted` |
| `--foreground` | texto corrido | `#0f172a` | `#d7e0ee` | texto principal (contraste ≥ 7:1 sobre o cartão) |
| `--heading` | títulos e números grandes | `#0b1b33` | `#ffffff` | mais forte que o texto corrido |
| `--muted-foreground` | texto secundário | `#5b6b82` | `#8b99b2` | contraste ≥ 4,5:1 sobre o cartão |
| `--border` | filetes | `#e2e8f0` | `rgb(148 163 184 / .13)` | claro: cinza claro. Escuro: **translúcido** (cinza-azulado a 10–13%) |
| `--input` | borda de campos | `#d5dde9` | `rgb(148 163 184 / .2)` | um pouco mais forte que `--border` |
| `--ring` | foco | `#3b82f6` | `#60a5fa` | cor de ação, mais clara no escuro |
| `--primary` | ação e seleção ativa | `#2563eb` | `#3b82f6` | **cor principal da marca** |
| `--destructive` | erro e exclusão | `#dc2626` | `#f87171` | vermelho de erro do projeto |
| `--viz-1` | série 1 (área, barras, anel, brilho) | `#2a78d6` | `#3987e5` | **cor da marca** (ou a mais representativa do projeto) |
| `--viz-2` | série 2 (linha, 2º segmento) | `#eb6834` | `#d95926` | cor **contrastante** com a 1 (matiz a ≥ 90° de distância, ou a 2ª cor da marca) |
| `--viz-3` | série 3 (só em selos na Visão geral) | `#1baf7a` | `#199e70` | 3ª cor distinta |
| `--viz-track` | trilho de barras e anel | `#cde2fb` | `#1a2a45` | `--viz-1` bem claro (claro) ou bem escuro (escuro) |
| `--viz-grid` | grade do gráfico | `#e8edf4` | `#1a2438` | quase igual a `--border` |
| `--viz-ord-1/2/3` | rampa ordinal do funil | `#86b6ef` `#3987e5` `#1c5cab` | `#6da7ec` `#3987e5` `#256abf` | 3 degraus do **mesmo matiz** de `--viz-1`, do claro ao escuro |
| `--viz-alerta`, `--viz-critico` | reservados (não usados na Visão geral) | `#fab219`, `#d03b3b` | idem | estados do projeto, se houver |
| `--ouro`, `--prata`, `--bronze` | medalhas do pódio (só ali) | `#d99a1e` `#8795ab` `#b8703a` | `#f5b83d` `#c3cfdf` `#d48c55` | convenção universal; só ajuste a luminosidade por tema |
| `--ok`, `--ok-forte`, `--aviso`, `--erro` | selo ao vivo, itens "positivos" do feed | `#10b981` `#059669` `#f59e0b` `#ef4444` | `--ok-forte`: `#34d399` | tokens de sucesso, atenção e erro do projeto |
| `--filete` | filete interno do cartão destaque | `rgb(15 23 42 / .07)` | `rgb(255 255 255 / .08)` | neutro translúcido |
| `--gradiente-acao` | botão principal | `135deg, #2563eb → #0ea5e9` | idem | da cor de ação para um vizinho **analógico** mais claro (matiz ± 20–40°) |
| `--gradiente-corrente` | logotipo do menu, filete do item ativo, barra de recarga | `135deg, #2563eb → #06b6d4` | idem | idem, ligeiramente mais frio |
| `--avatar-de`, `--avatar-ate` | fundo dos avatares com iniciais | `rgb(59 130 246 / .15)` → `rgb(34 211 238 / .10)` | idem | cor da marca a 15% → vizinha a 10% |
| `--atmosfera-1`, `--atmosfera-2` | brilhos dos cantos (só no escuro) | `rgb(37 99 235 / .10)`, `rgb(6 182 212 / .06)` | idem | marca a 10% e vizinha a 6% |
| `--sidebar*` | menu lateral | ver Apêndice B | ver Apêndice B | mesmos degraus do fundo/cartão |

### 5.2 Procedimento

1. **Descubra a paleta do projeto**: variáveis CSS, tema do Tailwind, `DESIGN.md` ou guia de marca, cores do logotipo. Liste: fundo, superfície, borda, texto (3 níveis), marca, segunda cor, estados.
2. **Preencha a tabela 5.1** com valores da paleta do projeto. Onde o projeto não tem o papel, derive: rotação de matiz e ajuste de luminosidade a partir da marca. **Nunca use cinza para identificar série.**
3. **Tema claro**: superfícies claras, texto escuro, marca no valor de ação.
4. **Tema escuro**: não é inversão. Superfícies em **degraus** (fundo < cartão < popover < muted/accent), texto em 3 níveis, bordas translúcidas, marca um pouco mais clara. Cada cor de série tem o seu próprio passo no escuro.
5. **Valide** (Apêndice C) as cores de série `--viz-1, --viz-2, --viz-3` em cada tema **contra a cor do cartão do tema** (não contra o fundo da página) e a rampa `--viz-ord-*` como rampa ordinal. Corrija até não haver `FAIL`.
6. **Confira contrastes de texto**: `--foreground`, `--heading` e `--muted-foreground` sobre `--card`, `--popover` e `--background` (≥ 4,5:1; ideal ≥ 7:1 no corrido). O texto branco sobre `--gradiente-acao` (botão principal, logotipo do menu) também precisa ser legível: na referência o contraste é 5,2:1 no início do degradê (`#2563eb`) e 2,8:1 no fim (`#0ea5e9`); no seu projeto mantenha ≥ 4,5:1 no início e ≥ 3:1 no fim.
7. **Compare com as imagens**: a hierarquia (o que salta aos olhos primeiro, o que fica no fundo) deve ser a mesma, mesmo com outras cores.

### 5.3 Regras de uso de cor (não negociáveis; a referência as segue)

- **Texto nunca usa a cor da série.** Valores, rótulos e legendas ficam em `--foreground`, `--heading` ou `--muted-foreground`; ao lado vai uma marca colorida (ponto, traço, barra) que carrega a identidade.
- **A cor nunca é o único portador do dado.** Todo valor aparece escrito. A cor verde-água da referência tem só 2,82:1 no tema claro e por isso sempre sai com o número ao lado.
- **A cor segue a entidade, não a posição.** A série 1 é sempre `--viz-1`, mesmo que um filtro tire a série 2.
- **Um eixo só.** Nunca eixo duplo. Duas medidas de escalas muito diferentes → dois gráficos.
- **Sequência = um matiz do claro ao escuro** (funil). **Identidade = matizes distintos** (séries). Nada de arco-íris.
- **Estados são reservados** (ok, aviso, erro): nunca viram "série 4"; sempre vêm com texto e ícone ou ponto.
- **Marcas finas**: linhas de 2 a 2,5 px; barras de 8 a 10 px totalmente arredondadas; respiro de 2 px entre segmentos; anel de 2 px da cor do cartão em volta de pontos que se sobrepõem.
- **Medalhas só no pódio.**
- **Dois temas, cada um validado.** Escuro não é o claro invertido.

### 5.4 Valores de referência do validador

A paleta da referência passa com: ΔE para daltonismo (vizinhas) **9,2** no claro e **9,4** no escuro (alvo ≥ 8); ΔE em visão normal **27,6** e **26,5** (mínimo 15); croma ≥ 0,10; luminosidade dentro da faixa. No claro, o verde `#1baf7a` fica em 2,82:1 sobre `#ffffff` (aviso, aceito porque o número vem escrito). Use isso como régua do que "passando" significa; a paleta do seu projeto pode ter números diferentes, desde que sem `FAIL`.

### 5.5 Cores que, na referência, estavam fixas no componente (e viraram token neste prompt)

Para que **nenhum componente** tenha cor fixa (R3), o Apêndice D já traz estes pontos trocados por tokens:

| Onde | Antes (referência) | Agora |
|---|---|---|
| `FunilJornada` (3 etapas) | `bg-[#86b6ef] dark:bg-[#6da7ec]` etc. | `bg-viz-ord-1`, `bg-viz-ord-2`, `bg-viz-ord-3` |
| `Iniciais` (avatar) | `from-blue-500/15 to-cyan-400/10` | `from-avatar-de to-avatar-ate` |
| `LiveBadge` | `bg-emerald-500`, `bg-amber-500`, `bg-red-500` | `bg-ok`, `bg-aviso`, `bg-erro` |
| `FeedAoVivo` | `bg-emerald-500/15 text-emerald-600 dark:text-emerald-400`; `ring-emerald-500/70` | `bg-ok/15 text-ok-forte`; `ring-ok/70` |
| `AppSidebar` (logotipo) | `shadow-blue-600/25` | `shadow-primary/25` |
| CSS global | brilhos e gradientes com `rgb(...)` literais | `--atmosfera-*`, `--gradiente-*` |

Só restam `text-white` e `color: #fff` sobre os degradês de ação (botão principal e logotipo), por regra de contraste do item 6 acima.

---

## 6. Nicho: do que existe na referência para o que existe no seu projeto

### 6.1 O que a referência mede (e que você vai traduzir)

A referência acompanha um **encontro com cadastro por QR Code**: pessoas leem um QR, abrem um formulário, se cadastram e dizem quem as indicou. O painel mostra cadastros, leituras, conversão, ranking de indicações, o funil "do QR ao cadastro", cliques em perfis do Instagram, últimos cadastros e uma regra de cota que credita 1 a cada N indicações a uma pessoa-alvo.

**Seu projeto não tem isso.** Faça a tradução abaixo. Regra geral: *mantenha a forma do bloco e troque o conteúdo pelo que existe de verdade no seu negócio.*

### 6.2 Tabela de tradução (decida cada linha na Fase 0)

| Slot | Na referência | No seu projeto (responda na Fase 0) | Sem equivalente |
|---|---|---|---|
| Cabeçalho | *eyebrow* "Encontro ao vivo"; "Visão geral"; data + "atualiza sozinho a cada leitura, cadastro e clique · horários de {fuso}" | *eyebrow* com o contexto (ex.: "Operação ao vivo", "Resultados do mês"); título "Visão geral"; data de hoje no fuso + frase **verdadeira** de atualização (R11) | manter título e data; omitir a frase |
| Filtros | Período (Tudo, Hoje, Última hora, Intervalo) + Origem (Todas, QR, Link) | Período com as janelas que o negócio usa (operação diária: Hoje, 7 dias, 30 dias, Intervalo). 2ª dimensão = canal, unidade, status ou responsável que o projeto já tenha | só Período (`semOrigem`) |
| KPI destaque | "Cadastros": total, "+N na última hora · último às HH:MM", minigráfico acumulado | a **entidade principal** que o negócio conta (leads, pedidos, vendas, pacientes, alunos, atendimentos…); detalhe "+N na janela recente · último às HH:MM"; acumulado da série | obrigatório: sempre há uma entidade principal |
| KPI barra dividida | "Leituras do QR e aberturas": total + barra QR × link | o **volume de entrada do funil** (visitas, acessos, orçamentos, solicitações…) repartido em 2 grupos relevantes (ex.: canal A × B) | KPI com número e barra de 1 segmento, ou omitir |
| KPI taxa | "Conversão" + anel; "X de Y leituras viraram cadastro" | a **taxa** que o negócio já acompanha (conversão, aprovação, ocupação, retenção…) com "X de Y …" | omitir |
| KPI meta | "Para {alvo}": total, anel "n de N", frase da regra de cota | **meta, capacidade ou SLA** com anel de progresso e uma frase que explique a regra | omitir (os outros KPIs se redistribuem, 6.3) |
| Série temporal | "Atividade por hora": área = cadastros, linha = leituras/aberturas; clique abre as pessoas daquela hora | as **2 medidas** mais importantes no tempo (área = a principal; linha = a de topo de funil); passo por hora, ou por dia se o negócio é diário; clique abre a lista do intervalo, **se a página de destino existir** | sem 2ª medida: só a área; sem página de destino: sem clique |
| Pódio | "Pódio das indicações": top 3 + 4º ao 6º | **ranking** de quem ou o que mais contribui (vendedores, campanhas, produtos, unidades, parceiros) | trocar por `Barras` com os 5 maiores, ou omitir |
| Funil | "Do QR ao cadastro": leram → começaram → concluíram, conversão e tempo mediano | **funil real** do negócio em 3 etapas ordenadas, conversão e tempo mediano entre a 1ª e a última (só se houver horários das etapas) | omitir |
| Barras com avatar | "Instagram": pessoas que abriram cada perfil | **ranking horizontal** de uma dimensão categórica (canal, produto, categoria, região…) com ícone ou avatar opcional | omitir |
| Feed ao vivo | "Ao vivo": cadastros, perfis abertos, leituras sem cadastro | **últimos eventos reais** de tipos mistos (novo X, mudança de status, pagamento…), com ícone por tipo | omitir |
| Últimos registros | "Últimos cadastros": hora, nome, telefone, indicação, selo da regra, WhatsApp e copiar | os **8 registros mais recentes** com as colunas que o projeto já exibe; linha clicável abre a ficha | obrigatório se há registros |
| Cartão de contexto | "Local do encontro" + mapa | endereço, mapa, unidade ou meta, **só se** houver contexto real | omitir |
| Distribuições | "Gênero" e "Faixa etária" | distribuições de atributos que o projeto **já coleta** (status, categoria, faixa de valor…) | omitir; nunca mostrar atributo não coletado |
| Ficha lateral | detalhe do cadastro: dados, jornada, Instagram, local, aparelho, crédito, auditoria, exclusão LGPD | detalhe do registro com os dados e o histórico que o projeto **já tem**; mesmo casco (6.5) | usar a ficha ou rota de detalhe existente com o visual novo |

### 6.3 Reorganização da grade quando um bloco é omitido

A grade tem 12 colunas no `xl`. Ao omitir blocos, redistribua **sem deixar buracos**:

| Linha | Completa | Se faltar |
|---|---|---|
| KPIs | 5 · 3 · 2 · 2 | 3 KPIs: **6 · 3 · 3**; 2 KPIs: **7 · 5**; 1 KPI: 12 |
| Gráfico + lateral | 8 · 4 | sem pódio/top: gráfico **12**; sem gráfico: lateral 12 |
| Trio (funil, barras, feed) | 4 · 4 · 4 | 2 blocos: **6 · 6**; 1 bloco: 12 |
| Recentes | 12 | — |
| Contexto | 12 | omitido |
| Distribuições | 6 · 6 | 1 bloco: 12; 3 blocos: **4 · 4 · 4** |

No `md` (2 colunas) mantenha `col-span-2` nos blocos que precisam de largura (KPI destaque, KPI meta, série, pódio, feed, recentes, contexto). A ordem do DOM é a ordem de leitura; não a mude.

### 6.4 O que remover por completo

- **QR Code**: leituras, origem "QR/Link", jornada do QR, página e item de menu do QR, ícones `QrCode` e `Smartphone` do feed.
- **Instagram e perfis**: bloco "Instagram", cliques em perfis, avatares dos perfis, o catálogo `PERFIS`, `InstagramIcon`.
- **Regra de cota e alvo**: KPI "Para {alvo}", anel "n de N", frase da regra, selos "Direta / Cota / Manual / Padrão" (`RegraBadge`), mesclas de nomes, auditoria de atribuição.
- **Indicações**: o pódio só fica se o seu nicho tem um ranking análogo; troque o vocabulário.
- **Local do encontro** (nome, endereço, mapa do OpenStreetMap): remova; o cartão largo só permanece se houver contexto geográfico real.
- **LGPD específica da referência** (anonimizar, excluir a pedido): só mantenha as ações que o seu painel já tem.
- **Passe Livre, formulário público e tela de entrada**: não fazem parte da Visão geral.
- **Nunca copie** nomes, fotos, links, coordenadas, telefones, e-mails ou textos de pessoas e organizações da referência. Nenhum nome próprio do projeto de origem pode aparecer no destino. (As imagens do Apêndice A usam dados sintéticos e neutros.)

### 6.5 Ficha lateral: casco que deve ser mantido

`Sheet` à direita (`w-full sm:max-w-lg`, rolagem vertical). **Cabeçalho** com `border-b bg-muted/40`: avatar de iniciais grande (`size-14`), título (`text-lg`, truncado), descrição ("Registro nº N · data e hora"), linha de contato com ações e, para quem pode escrever, os botões "Editar dados" e "Excluir". **Corpo** `space-y-6 px-4 pb-6`, com seções cujo título é `text-xs font-semibold uppercase tracking-wide text-muted-foreground`:

- pares rótulo/valor: `dl divide-y`, linha `grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-sm`;
- linha do tempo: `ol ml-2 space-y-3 border-l border-border pl-4`; cada passo com ponto `absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-viz-1 ring-4 ring-background`, título `font-medium text-heading` e carimbo `text-xs tabular-nums`; resumo em `rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium text-heading`;
- itens em cartão: `rounded-xl border px-3 py-2`;
- explicação em `rounded-lg bg-muted/60 px-3 py-2 text-xs`;
- zona de perigo: `rounded-lg border border-destructive/30 p-3`.

O conteúdo (quais seções) é o que o **seu** projeto já mostra no detalhe; não invente seções. O código das peças genéricas (`Linha`, `Passo`, `Secao`) e do casco está no Apêndice D.

### 6.6 Texto (microcopy)

- pt-BR, frases curtas, sem exclamações e sem emojis; maiúscula só no início da frase.
- Rótulo de KPI: substantivo curto (≤ 3 palavras). Detalhe de KPI: fato com número ("+27 na última hora · último às 11:07"; "88 de 148 leituras viraram cadastro" vira "X de Y {entrada} viraram {resultado}").
- Descrição de bloco: **uma** frase que diz o que o bloco mostra e, se for clicável, o que o clique faz ("Clique numa hora para ver quem se cadastrou nela").
- Estados vazios: "Aguardando os primeiros {itens}." · "{Itens} aparecem aqui assim que {acontecerem}." · "Sem respostas ainda." (seção 8).
- Links de seção no canto do `Bloco`: substantivo curto + seta (`Ranking →`, `Detalhes →`, `Todas as pessoas →`), só se existir a página de destino.

---

## 7. Dados e sincronização (não desincronizar nada)

O painel de destino já tem dados, regras e (talvez) atualização ao vivo. **Nada disso muda.** O trabalho é trocar a camada visual e a composição, lendo dos mesmos lugares e mostrando os mesmos números.

### 7.1 Princípios (copiados da referência; valem também no destino)

- **P1 — Fonte única.** A página lê **um** snapshot (coleções + configuração do negócio) vindo da camada de dados. Nada de contadores locais, de `fetch` por bloco ou de estado duplicado.
- **P2 — Recorte antes de tudo.** Uma função pura `selectDashboardData(snapshot, filtro)` devolve cada coleção já filtrada pelo **seu próprio horário** (cadastro por `created_at`, visita por `created_at`, clique por `created_at`) e pela 2ª dimensão (origem). Todo bloco consome esse resultado (ou `computeJourney`, que aplica o mesmo filtro). Ver `dashboard.ts` no Apêndice D.
- **P3 — Derivações puras e memoizadas.** `computeOverview`, `computeJourney`, `computeRanking`… são funções puras (entrada → saída), chamadas em `useMemo` com as dependências exatas. Sem efeitos colaterais e sem `Date.now()` dentro delas.
- **P4 — Relógio vivo.** `useAgora(30 s)` alimenta "última hora", "hoje" e o cabeçalho; `useHa(1 s)` alimenta "há X s". Os dois vivem em estado do React e re-renderizam sozinhos.
- **P5 — Atualização ao vivo idempotente.** Mudanças recebidas entram por *upsert* por id (reaplicar não duplica). Mudanças que chegam **durante** uma carga completa são guardadas e reaplicadas sobre o resultado dela. Mudanças estruturais pedem recarga; recargas simultâneas aproveitam a mesma. **Falha na recarga mantém os dados antigos na tela** e mostra o erro na barra superior; nunca esvazie a tela.
- **P6 — Taxa por coorte.** Conversão = `convertidos ÷ entradas da mesma coorte`: as entradas que começaram dentro do recorte e o que aconteceu com elas **até o fim do recorte** (sem fim: tudo o que já chegou). Não divida registros sem entrada por entradas. Ver `computeJourney`.
- **P7 — Horas no fuso do negócio.** Cada evento cai num balde `'yyyy-MM-dd HH'` calculado com `Intl.DateTimeFormat` no fuso do negócio. A série é **contínua**: todas as horas entre o primeiro e o último evento, inclusive as com zero (a referência percorre o intervalo em passos de 15 minutos e anota a hora local de cada passo; replique `horasContinuas` do Apêndice D). Rótulo `HHh`, ou `dd/MM HHh` quando a série cruza dias.
- **P8 — Números sempre exatos.** A animação de contagem termina no valor exato; com `prefers-reduced-motion` o valor aparece direto.
- **P9 — Nenhum dado pessoal novo na tela** (R14).

### 7.2 Fluxo de dados da referência

```
api.loadSnapshot ─► EventStore (snapshot imutável) ◄─ api.subscribe (mudanças ao vivo, status)
                         │  getSnapshot / getStatus / getError / getUpdatedAt / isRefreshing / reload
                         ▼
        useSyncExternalStore ─► contexto (useEventData) ─► OverviewPage
                                                              │ agora      = useAgora()            (30 s)
                                                              │ filtro     = useFiltroPainel(tz)   (URL → ISO)
                                                              │ dados      = selectDashboardData(snapshot, filtro)
                                                              │ visao      = computeOverview(dados, …)
                                                              │ jornada    = computeJourney(snapshot, filtro)
                                                              │ ranking    = computeRanking(dados.submissions, …)
                                                              └ blocos recebem só props já calculadas
```

### 7.3 Contrato sugerido do view-model

Adapte os **nomes** ao projeto; mantenha o **formato** (cada bloco recebe dados prontos, nunca consulta nada).

```ts
/** Recorte do painel: janela em ISO (UTC, inclusiva) e 2ª dimensão opcional. Vale para a tela inteira. */
export interface FiltroDoPainel { de?: string; ate?: string; origem?: string }

export interface PontoDaSerie {
  /** 'yyyy-MM-dd HH' no fuso do negócio (chave do balde; série contínua, sem buracos). */
  hora: string
  /** '14h' ou '30/09 14h' quando a série cruza dias. */
  rotulo: string
  principal: number // série da ÁREA (a medida mais importante)
  secundaria: number // série da LINHA (a medida de topo de funil)
}

export interface VisaoGeral {
  principal: { total: number; naUltimaHora: number; ultimoEm: string | null; acumulado: number[] }
  volume: { total: number; grupoA: number; grupoB: number } // barra dividida (2 segmentos)
  taxa: { fracao: number | null; numerador: number; denominador: number } // null se o denominador é 0
  meta: { total: number; atual: number; de: number } | null // anel "atual de N"; null = omitir o KPI
  serie: PontoDaSerie[]
  ranking: Array<{ posicao: number; chave: string; nome: string; total: number }>
  funil: { etapas: Array<{ rotulo: string; valor: number }>; conversao: number | null; medianaMs: number | null }
  porCategoria: Array<{ chave: string; rotulo: string; total: number; fracao: number | null }>
  atividade: Array<{ tipo: string; chave: string; em: string }> // feed: mais novo primeiro, no máximo 9
  recentes: Array<{ id: number | string; em: string }> // no máximo 8, mais novo primeiro
  distribuicoes: Array<{ titulo: string; itens: Array<{ rotulo: string; total: number }> }> // só atributos coletados
}
```

Regras de montagem (iguais às da referência): `naUltimaHora` = registros com horário ≥ `agora − 1 h`; `acumulado` = soma acumulada da série principal por hora; `recentes` = os 8 maiores ids; `atividade` = união ordenada por horário decrescente, cortada em 9; `ranking` = ordem decrescente por total, desempate por quem chegou primeiro àquele total e depois por nome (`localeCompare('pt-BR')`).

### 7.4 Inventário e teste de paridade (obrigatório)

1. **Antes de alterar qualquer arquivo**, escolha um conjunto de dados fixo (fixture do projeto ou um recorte real de um dia) e registre **cada número que o painel antigo mostra**: totais, séries por hora, rankings, taxas e listas. Guarde como JSON e como captura de tela.
2. Implemente o view-model chamando **as mesmas funções, consultas e fórmulas** do painel antigo. Se uma fórmula precisar ser reescrita, mantenha a antiga disponível e escreva um teste que compare antiga × nova para a mesma entrada, incluindo: zero registros, 1 registro, muitos registros, virada de hora e de dia, fuso com horário de verão, filtro por período e por 2ª dimensão, registros removidos ou anonimizados.
3. Depois de pronto, rode o mesmo conjunto e preencha a **tabela de paridade** do relatório final. Qualquer diferença bloqueia a entrega, salvo diferença deliberada e documentada.
4. **Sincronia ao vivo**: com a tela aberta, gere um evento novo (em desenvolvimento ou homologação, **nunca** poluindo produção) e confirme que KPI, gráfico, feed, lista e ranking mudam **juntos**, sem recarregar a página, e que os contadores animam até o valor exato.
5. **Falha de rede**: simule uma recarga com erro e confirme que os dados antigos permanecem e que o erro aparece na barra superior.

### 7.5 O que o painel antigo tinha e não tem slot (R9)

Nada some. Crie **blocos extras no mesmo padrão visual**, junto do bloco temático mais próximo (ou ao final, antes das distribuições):

| O painel antigo tinha | Bloco extra |
|---|---|
| Um número (KPI) | `KpiCard` sem `destaque`. Passou de 4 KPIs? Abra outra linha de KPIs com `xl:col-span-3` × 4 (ou 6 · 3 · 3) |
| Um gráfico de barras ou de categorias | `Bloco` + `Barras` (uma série) ou `DistributionChart` |
| Um gráfico no tempo | `Bloco` + o gráfico de série (a mesma componente, com outra série) |
| Uma tabela | `Bloco` + tabela com cabeçalho de 11 px, 600, maiúsculas, `tracking 0.05em` (regra CSS no `dashboard.css`) e linhas com `divide-y divide-border` |
| Uma lista | `Bloco` + lista no estilo de "Últimos registros" |
| Um filtro | opção no controle segmentado ou novo controle segmentado na barra de filtros |
| Uma ação (exportar, criar…) | `Button variant="outline" size="sm"` no slot `acao` do `Bloco` |

### 7.6 Camada ao vivo (só se o projeto não tiver nenhuma)

Se o projeto já atualiza (tempo real, polling, SWR…), **mantenha o mecanismo** e apenas exponha ao shell: `status` (`conectando` / `ao_vivo` / `offline`), `atualizadoEm`, `recarregando`, `erro` e `reload()`. Se não tiver nada, use o padrão do `event-store.ts` (Apêndice D) com ligação por `useSyncExternalStore`; sem canal em tempo real, faça polling de 30 s chamando `reload()` e **omita o selo "Ao vivo"** (R11), mantendo "atualizado há X" e o botão de atualizar.

### 7.7 Filtros na URL

`?periodo=` (`tudo` é o padrão e não é gravado; `hoje`, `hora`, `intervalo`), `&de=` e `&ate=` (horário local do negócio, no formato de `datetime-local`; só com `intervalo`), `&origem=` (2ª dimensão). Regras da referência, em `filtro-painel.ts`:

- gravar com `setSearchParams(..., { replace: true })`, **preservando os outros parâmetros** do endereço;
- a conversão local → UTC usa o fuso do negócio (`zonedLocalToUtc`); o fim do intervalo vale até o **último milissegundo do minuto** informado (`+ 59 999 ms`);
- intervalo invertido (início depois do fim) **não filtra** e mostra "O início do intervalo é depois do fim." em vermelho (`role="alert"`); nunca uma métrica enganosa em silêncio;
- clicar numa hora do gráfico navega para a lista do negócio com `periodo=intervalo&de=aaaa-mm-ddTHH:00&ate=aaaa-mm-ddTHH:59` (e a 2ª dimensão atual);
- o filtro vale para **a tela inteira** e acompanha o link compartilhado.

---

## 8. Estados, acessibilidade e movimento

### 8.1 Estados (comportamento exato da referência)

| Situação | O que acontece |
|---|---|
| Carregando a rota (chunk) | Spinner centralizado na altura da janela (`min-h-dvh`): `size-7 animate-spin rounded-full border-[3px] border-muted border-t-foreground`, `role="status" aria-live="polite"`, texto "Carregando…" só para leitor de tela. **Não há esqueletos de bloco.** |
| Carregando os dados | O shell já aparece (menu sem itens e barra superior com o título genérico) e o conteúdo mostra o mesmo spinner com o rótulo "Carregando evento…" |
| Registro/evento não encontrado | Título "Evento não encontrado", frase com o endereço e botão `outline` "Ver todos os eventos" (adapte ao seu nicho) |
| Erro na carga inicial | "Não foi possível carregar o evento", a mensagem do erro e botão `outline` "Tentar de novo" |
| Recarga em andamento | Botão de atualizar desabilitado com o ícone girando (`motion-safe:animate-spin`); barra de 2 px com degradê correndo na borda inferior da barra superior; **os dados antigos permanecem** |
| Falha na recarga | Pílula `role="alert"` "Falha ao atualizar" (o texto só ≥ 640 px; o ícone sempre), borda `destructive/40`; a dica diz a mensagem do erro + "— os dados na tela são os da última atualização." |
| Conexão | Selo: **Ao vivo** (ponto `ok`, pulsa com `motion-safe:animate-ping`) · **Conectando…** (`aviso`, sem pulso) · **Offline — reconectando** (`erro`, sem pulso) |
| "atualizado há X" | "agora" (< 5 s) · "há N s" (< 60 s) · "há N min" · "há N h"; `title` com a hora completa `HH:mm:ss` |
| Filtro inválido | Mensagem vermelha `role="alert"` sob os filtros; o intervalo é ignorado até ser corrigido |
| Evento novo ao vivo | Contadores contam até o novo valor (550 ms) e "sobem" 0,18 em; novas linhas do feed ganham lavagem de `--viz-1` a 20% que some em 2,6 s |
| Papel somente leitura | Botões de editar, excluir e acrescentar não aparecem |

**Sem dados** (zero registros), bloco a bloco — a moldura aparece, **nenhum valor é inventado**:

| Bloco | Vazio |
|---|---|
| KPI destaque | `0`; "+0 na última hora" (sem "último às"); sem minigráfico (precisa de ≥ 2 pontos) |
| KPI barra dividida | `0`; trilho vazio; legenda com 0 e 0 |
| KPI taxa | "—"; sem anel; detalhe "0 de 0 …" |
| KPI meta | `0`; anel vazio ("0 de N"); frase da regra |
| Série temporal | Moldura tracejada (`rounded-lg border border-dashed`, 280 px) com linha de base em `bottom-8` e o texto "Aguardando os primeiros cadastros."; a legenda continua visível |
| Pódio | 3 degraus "1º / 2º / 3º lugar em aberto", avatar "?", opacidade 50% |
| Funil | 3 barras em zero; "—" na conversão e na mediana |
| Barras | "Ninguém abriu um perfil ainda." (`py-6`, centralizado, atenuado) |
| Feed | "As leituras do QR, os cadastros e os perfis abertos aparecem aqui assim que acontecem." (`py-8`) |
| Últimos registros | "Os cadastros aparecem aqui assim que chegarem." (`py-8`) |
| Distribuições | "Sem respostas ainda." (`py-8`); o bloco só existe se o atributo é coletado |

**Poucos itens**: o pódio mostra só posições reais e deixa as outras "em aberto"; a série com 1 ponto desenha o ponto no centro e nenhuma área; a lista de 4º ao 6º só aparece com mais de 3 itens no ranking.

### 8.2 Movimento

| Elemento | Animação |
|---|---|
| `NumeroAnimado` | conta de 0 até o valor em **900 ms** na primeira vez e **550 ms** nas mudanças, com `1 − (1 − k)³`; ao mudar, o elemento remonta e "sobe" 0,18 em em 500 ms (`painel-numero-subiu`, `cubic-bezier(0.2, 0.8, 0.2, 1)`) |
| Barras e anel | `transition-[width]` e `stroke-dashoffset`, 700 ms `ease-out` |
| Pódio | degraus sobem (`scaleY .35 → 1`, 750 ms; o 1º com atraso de 80 ms e o 3º de 160 ms); coroa balança (3,2 s, infinito); brilho cruza o degrau do 1º (4,5 s, atraso de 1 s, infinito) |
| Linha nova do feed | lavagem de 2,6 s `ease-out` (`painel-linha-nova`) |
| Barra de recarga | 1,1 s `ease-in-out`, infinito (`painel-progresso`) |
| Selo ao vivo | ponto com `animate-ping` (`motion-safe:`) |
| Gaveta (`Sheet`) | deslize de 200 ms (padrão do shadcn) |

Com `prefers-reduced-motion: reduce`: `NumeroAnimado` mostra o valor exato sem contar; as animações do `dashboard.css` são desligadas; o spin e o ping usam `motion-safe:`.

### 8.3 Acessibilidade (tudo o que a referência faz)

- Cartões: KPI é `<section aria-label>`; `Bloco` usa `aria-label` (ou `aria-labelledby`); um `<h1>` por página e `<h2>` nos cartões.
- **Gráfico de série**: `<figure>`; o contêiner tem `role="img"`, `tabIndex={0}` e `aria-label` que resume ("… Use as setas para percorrer as horas e Enter para ver as pessoas daquela hora. Última hora (14h): 7 envios e 9 aberturas."); `←`/`→` percorrem, `Home`/`End` vão às pontas, `Enter` abre a hora; o foco mostra a última hora; o SVG é `aria-hidden`; a dica é `role="tooltip"`; anel de foco visível; **tabela alternativa** em `<details>` ("Ver dados em tabela").
- Anel: `role="meter"` com `aria-valuemin`, `aria-valuemax`, `aria-valuenow` e `aria-label`.
- Barras, distribuição e funil: `<ul aria-label>`; as barras são `aria-hidden` porque o número está escrito; `Barras` também traz tabela alternativa.
- Pódio: `<ol aria-label="Pódio">`; a ordem **visual** (2º, 1º, 3º) vem de CSS `order`, e a ordem do **DOM** é 1º, 2º, 3º; cada posição é um botão com rótulo completo.
- Feed: `<ol aria-label="Atividade ao vivo">`; horários em `<time dateTime title>`.
- Selo ao vivo: `role="status" aria-live="polite"`; falha: `role="alert"`.
- Filtros: `role="radiogroup"` com `role="radio" aria-checked`; campos de data com `aria-label`.
- Foco visível em todo controle customizado: `focus-visible:ring-2 focus-visible:ring-ring/60`.
- A cor nunca é o único portador: todo valor está escrito; selos têm texto e ponto.
- Alvos de toque: botões de ícone de 28 px; linhas clicáveis inteiras.

---

## 9. Responsividade

Os pontos de quebra são do **viewport** (Tailwind padrão: `sm` 640, `md` 768, `lg` 1024, `xl` 1280).

| Viewport | Menu | Grade | O que muda |
|---|---|---|---|
| < 640 px | gaveta (`Sheet`, 18 rem) aberta pelo gatilho | 1 coluna | minigráfico escondido; local, selo de situação e "atualizado há" escondidos; "Falha ao atualizar" só com o ícone; lista de recentes em 3 colunas (hora · nome e telefone · ações) com a indicação na 2ª linha e sem selo |
| 640–767 px | gaveta | 1 coluna | minigráfico aparece; selo de situação aparece; selo da regra aparece na lista |
| 768–1023 px | **fixo** de 16 rem (recolhe para ícones) | 2 colunas | "atualizado há" aparece; `h1` em 36 px; paddings `md:px-6` e `md:p-5`; lista de recentes em 4 colunas |
| 1024–1279 px | fixo | 2 colunas | o local aparece na barra superior; `lg:px-8` |
| ≥ 1280 px | fixo | **12 colunas** | conforme 3.3; conteúdo limitado a 1600 px e centralizado |

O gráfico mede a largura real do contêiner (`ResizeObserver`, mínimo de 280 px) e redesenha o SVG em pixels reais, sem distorcer texto nem pontos.

---

## 10. Pontos de atenção da referência (não "corrija" sem avisar)

1. **Quebras por viewport.** Com o menu aberto, entre 1280 e ~1500 px os KPIs de 2 colunas ficam estreitos (imagem 01). É o comportamento da referência; usar *container queries* seria uma melhoria opcional.
2. **`touch-none` no SVG do gráfico.** Em telas de toque, começar o arrasto sobre o gráfico não rola a página. Melhoria permitida sem mudar o visual: `touch-pan-y`. Se adotar, registre no relatório.
3. **Um `setInterval` por linha do feed** (`useHa`, até 9 timers de 1 s). Funciona; um relógio compartilhado seria equivalente.
4. **`NumeroAnimado` remonta a cada mudança de valor** (`key={valor}`) para repetir o "sobe". É proposital.
5. **Largura mínima de 6 px** nas barras de `DistributionChart` para valores > 0: um valor pequeno nunca desaparece.
6. **Realce do feed**: só ganha a lavagem o que chega **depois** da primeira pintura; o que já estava na tela é considerado visto.
7. **Duas famílias de cor de dados**: `--viz-1/2/3` identificam séries; `--viz-ord-*` é a rampa **ordinal** do funil (as etapas têm ordem). Não misture.
8. **A linha de apoio do cabeçalho e o selo "Ao vivo" são afirmações.** Só mantenha se verdadeiras (R11).
9. **Escopo CSS no `<html>`, não num contêiner.** A referência usa `html.painel` (classe posta no `<html>` quando o painel monta) para isolar o visual do painel do site público. Tooltip, Sheet, DropdownMenu e Toaster renderizam em **portais**, fora do contêiner da página: se os tokens ficarem presos a um elemento interno, a dica perde a cor e a gaveta fica transparente. Num app de um bundle só, ponha a classe no `<html>` ao montar o layout do painel e retire-a ao desmontar (`useEffect`), e o mesmo para `dark`.
10. **Dígitos**: números grandes dos KPIs usam dígitos **proporcionais**; contagens em listas, eixos e tabelas usam `tabular-nums`.

---

## 11. Checklist de aceite

**Dados**
- [ ] Nenhuma fonte, consulta, assinatura ou cache novo; os números vêm das fontes do painel antigo.
- [ ] Tabela de paridade preenchida: antes × depois, diferença 0 (ou documentada).
- [ ] Todos os blocos usam o mesmo recorte; mudar período ou 2ª dimensão muda a tela inteira junto.
- [ ] Um evento novo ao vivo muda KPI, gráfico, feed, lista e ranking **juntos**, sem recarregar.
- [ ] Falha de rede mantém os dados antigos e mostra o erro na barra superior.
- [ ] Nada do painel antigo desapareceu (R9) e nada foi inventado (R2).
- [ ] Horas no fuso do negócio; série contínua; rótulos `HHh` e `dd/MM HHh`.
- [ ] "Ao vivo", "atualiza sozinho" e "atualizado há" só existem se forem verdadeiros.

**Visual**
- [ ] Cada bloco confere com as imagens 01 a 11 (1440 claro e escuro, 1920, 820, 390): hierarquia, espaçamento, cantos, tamanho dos números.
- [ ] Raios: cartões 18 px, chips e itens 14 px, controles 10 px.
- [ ] Fonte DM Sans Variable (ou decisão registrada); números dos KPIs com dígitos proporcionais; contagens com `tabular-nums`.
- [ ] Cartão destaque com brilho no canto; no escuro, atmosfera nos cantos da página.
- [ ] Item ativo do menu com filete de 2 px; rótulos de grupo de 10,5 px.

**Cores**
- [ ] Nenhuma cor fixa em componente: busque `#`, `rgb(`, `blue-`, `emerald-`, `amber-`, `red-`, `cyan-`, `sky-` fora do arquivo de tokens (exceção: `text-white` e `#fff` sobre degradê de ação).
- [ ] Validador sem `FAIL` nos dois temas e na rampa do funil; contrastes de texto conferidos.
- [ ] Telas fora do painel não mudaram de aparência.

**Gráficos**
- [ ] Série: 280 px, margens, ~4 marcas redondas no eixo Y a partir do zero, rótulos de X sem colisão, área + linha, ponto final com valor, mira e dica, clique ou `Enter` abre a lista, tabela alternativa.
- [ ] Testes de `niceTicks` e do gráfico (vazio e teclado) portados e passando.
- [ ] Anéis com `role="meter"`; barras com o valor escrito; legenda presente com 2 ou mais séries.

**Interação e estados**
- [ ] Todos os estados da seção 8.1 reproduzidos (carregando, erro, recarga, falha, offline, vazio, 1–2 itens, filtro inválido, novo ao vivo).
- [ ] Contadores animam até o valor exato; `prefers-reduced-motion` desliga as animações.
- [ ] Ficha lateral abre pelo feed e pela lista; `Esc` fecha; o foco volta ao elemento de origem.

**Acessibilidade**
- [ ] Teclado alcança todos os controles; foco visível; gráfico com setas, `Home`, `End` e `Enter`.
- [ ] Rótulos ARIA conforme 8.3; `<time dateTime>` nas horas; o leitor de tela lê o pódio como 1º, 2º, 3º.
- [ ] Nenhuma informação só por cor.

**Responsivo**
- [ ] 390, 820, 1280, 1440 e 1920 px sem rolagem horizontal, sem texto cortado e sem sobreposição.
- [ ] O menu vira gaveta abaixo de 768 px.

**Qualidade**
- [ ] `typecheck`, `lint`, testes e `build` sem erro.
- [ ] Nenhum `console.error` ao abrir a página; sem avisos do React (chaves, hidratação).
- [ ] Nenhuma dependência nova além das da seção 3.1; nenhuma biblioteca de gráficos.
- [ ] Relatório final no formato da seção 2.

---

## Apêndice A — Imagens de referência

Anexe estas imagens à conversa (a pasta `referencias/` acompanha este arquivo). **Elas são a verdade visual**: a hierarquia, os espaços, os cantos e os pesos devem bater. Foram geradas com os componentes reais e com **dados sintéticos e neutros** ("Encontro de Exemplo", nomes de exemplo); os textos do nicho de origem (QR, Instagram, indicações) estão ali só para mostrar a forma dos blocos e **não devem ser copiados** (seção 6). As cores das imagens são as da referência; no seu projeto valem as da sua paleta (seção 5). Se as imagens não vierem anexadas, siga o código do Apêndice D (suficiente para reproduzir o visual) e registre a ausência no relatório; não interrompa o trabalho por isso.

| Arquivo | O que mostra |
|---|---|
| `01-desktop-escuro-1440.png` | Página completa, tema escuro (padrão), viewport de 1440 px: grade de 12 colunas, menu aberto (KPIs de 2 colunas estreitos) |
| `02-desktop-claro-1440.png` | O mesmo, tema claro |
| `08-desktop-escuro-1920.png` | Tela larga, escuro: conteúdo limitado a 1600 px |
| `09-desktop-claro-1920.png` | Tela larga, claro |
| `03-tablet-escuro-820.png` | 2 colunas (`md`), menu fixo |
| `04-celular-escuro-390.png` | 1 coluna; o menu vira gaveta |
| `05-celular-claro-390.png` | 1 coluna, claro |
| `06-grafico-por-hora-com-dica-escuro.png` | Gráfico de série com mira, pontos e dica (hover) |
| `07-ficha-do-cadastro-escuro.png` | Ficha lateral (`Sheet`) aberta pela lista de recentes |
| `10-estado-vazio-escuro-1440.png` | Sem dados, escuro: moldura sem valores inventados |
| `11-estado-vazio-claro-1440.png` | Sem dados, claro |

---

## Apêndice B — CSS e tokens completos

Cole no CSS de entrada do projeto (ex.: `src/index.css`) **com a paleta do projeto** (seção 5). Onde o projeto já tem o item (shadcn, Tailwind v4), não duplique: acrescente só o que está marcado **NOVO**. O escopo da referência é `html.painel` (classe no `<html>`, para que os portais do Radix também recebam os tokens; ver seção 10, item 9); troque pelo escopo que isole o painel das telas que não podem mudar, **mantendo-o no `<html>`**. Os valores abaixo são os da **referência**: substitua-os, não os copie às cegas.

### B.1 Tema do Tailwind: variáveis → utilitários

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css"; /* só se o projeto usa shadcn */

@custom-variant dark (&:is(.dark *)); /* tema escuro = classe .dark no <html> */

@theme inline {
    --font-heading: var(--font-sans);
    --font-sans: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';

    /* shadcn: superfície, texto e ação */
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-card: var(--card);
    --color-card-foreground: var(--card-foreground);
    --color-popover: var(--popover);
    --color-popover-foreground: var(--popover-foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-secondary: var(--secondary);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-accent: var(--accent);
    --color-accent-foreground: var(--accent-foreground);
    --color-destructive: var(--destructive);
    --color-border: var(--border);
    --color-input: var(--input);
    --color-ring: var(--ring);
    --color-sidebar: var(--sidebar);
    --color-sidebar-foreground: var(--sidebar-foreground);
    --color-sidebar-primary: var(--sidebar-primary);
    --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
    --color-sidebar-accent: var(--sidebar-accent);
    --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
    --color-sidebar-border: var(--sidebar-border);
    --color-sidebar-ring: var(--sidebar-ring);

    /* raios: múltiplos de --radius (a referência usa 0.625rem; ver 4.2) */
    --radius-sm: calc(var(--radius) * 0.6);
    --radius-md: calc(var(--radius) * 0.8);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) * 1.4);
    --radius-2xl: calc(var(--radius) * 1.8);
    --radius-3xl: calc(var(--radius) * 2.2);
    --radius-4xl: calc(var(--radius) * 2.6);

    /* NOVO: dados e acabamento */
    --color-viz-1: var(--viz-1);
    --color-viz-2: var(--viz-2);
    --color-viz-3: var(--viz-3);
    --color-viz-track: var(--viz-track);
    --color-viz-grid: var(--viz-grid);
    --color-viz-alerta: var(--viz-alerta);
    --color-viz-critico: var(--viz-critico);
    --color-viz-ord-1: var(--viz-ord-1);
    --color-viz-ord-2: var(--viz-ord-2);
    --color-viz-ord-3: var(--viz-ord-3);
    --color-heading: var(--heading);
    --color-ouro: var(--ouro);
    --color-prata: var(--prata);
    --color-bronze: var(--bronze);
    --color-ok: var(--ok);
    --color-ok-forte: var(--ok-forte);
    --color-aviso: var(--aviso);
    --color-erro: var(--erro);
    --color-avatar-de: var(--avatar-de);
    --color-avatar-ate: var(--avatar-ate);
}
```

### B.2 Tokens do tema claro (valores da referência: substitua pela paleta do projeto)

```css
html.painel {
    --radius: 0.625rem;
    font-family: 'DM Sans Variable', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-optical-sizing: auto;

    /* superfícies e texto */
    --background: #f3f6fb;
    --foreground: #0f172a;
    --card: #ffffff;
    --card-foreground: #0f172a;
    --popover: #ffffff;
    --popover-foreground: #0f172a;
    --primary: #2563eb;
    --primary-foreground: #ffffff;
    --secondary: #eef2f8;
    --secondary-foreground: #0f172a;
    --muted: #eef2f8;
    --muted-foreground: #5b6b82;
    --accent: #e8eef8;
    --accent-foreground: #0f172a;
    --destructive: #dc2626;
    --border: #e2e8f0;
    --input: #d5dde9;
    --ring: #3b82f6;
    --heading: #0b1b33;

    /* menu lateral */
    --sidebar: #ffffff;
    --sidebar-foreground: #334155;
    --sidebar-primary: #2563eb;
    --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #edf2fb;
    --sidebar-accent-foreground: #0f172a;
    --sidebar-border: #e5eaf2;
    --sidebar-ring: #3b82f6;

    /* dados (validados: 3 séries, claro sobre o cartão #ffffff) */
    --viz-1: #2a78d6;
    --viz-2: #eb6834;
    --viz-3: #1baf7a;
    --viz-track: #cde2fb;
    --viz-grid: #e8edf4;
    --viz-alerta: #fab219;
    --viz-critico: #d03b3b;
    /* rampa ordinal do funil (um matiz só, do claro ao escuro) */
    --viz-ord-1: #86b6ef;
    --viz-ord-2: #3987e5;
    --viz-ord-3: #1c5cab;
    /* medalhas: só nas 3 primeiras posições do pódio */
    --ouro: #d99a1e;
    --prata: #8795ab;
    --bronze: #b8703a;

    /* estados */
    --ok: #10b981;
    --ok-forte: #059669;
    --aviso: #f59e0b;
    --erro: #ef4444;

    /* acabamento */
    --filete: rgb(15 23 42 / 0.07);
    --gradiente-acao: linear-gradient(135deg, #2563eb, #0ea5e9);
    --gradiente-corrente: linear-gradient(135deg, #2563eb, #06b6d4);
    --avatar-de: rgb(59 130 246 / 0.15);
    --avatar-ate: rgb(34 211 238 / 0.1);
    --atmosfera-1: rgb(37 99 235 / 0.1);
    --atmosfera-2: rgb(6 182 212 / 0.06);
}
```

### B.3 Tokens do tema escuro (o padrão do painel)

```css
html.painel.dark {
    --background: #070b14;
    --foreground: #d7e0ee;
    --card: #0d1422;
    --card-foreground: #d7e0ee;
    --popover: #111a2c;
    --popover-foreground: #e2e8f0;
    --primary: #3b82f6;
    --primary-foreground: #ffffff;
    --secondary: #152036;
    --secondary-foreground: #e2e8f0;
    --muted: #131d31;
    --muted-foreground: #8b99b2;
    --accent: #16233b;
    --accent-foreground: #ffffff;
    --destructive: #f87171;
    --border: rgb(148 163 184 / 0.13);
    --input: rgb(148 163 184 / 0.2);
    --ring: #60a5fa;
    --heading: #ffffff;

    --sidebar: #080d18;
    --sidebar-foreground: #c3cddd;
    --sidebar-primary: #3b82f6;
    --sidebar-primary-foreground: #ffffff;
    --sidebar-accent: #121c30;
    --sidebar-accent-foreground: #ffffff;
    --sidebar-border: rgb(148 163 184 / 0.1);
    --sidebar-ring: #60a5fa;

    /* dados (validados: escuro sobre o cartão #0d1422) */
    --viz-1: #3987e5;
    --viz-2: #d95926;
    --viz-3: #199e70;
    --viz-track: #1a2a45;
    --viz-grid: #1a2438;
    --viz-ord-1: #6da7ec;
    --viz-ord-2: #3987e5;
    --viz-ord-3: #256abf;
    --ouro: #f5b83d;
    --prata: #c3cfdf;
    --bronze: #d48c55;

    --ok-forte: #34d399;
    --filete: rgb(255 255 255 / 0.08);
}
```

### B.4 Base e utilitários (NOVO)

```css
@layer base {
    * {
        @apply border-border outline-ring/50;
    }
    body {
        @apply bg-background text-foreground;
    }
    html {
        @apply font-sans;
    }
}

/* Botão principal: degradê de ação, a cor de ação do painel. */
html.painel [data-slot='button'][data-variant='default'] {
    background-image: var(--gradiente-acao);
    color: #fff;
}
html.painel [data-slot='button'][data-variant='default']:hover {
    filter: brightness(1.08) saturate(1.05);
}

/* Cartão de destaque: brilho suave no canto e filete interno. */
.cartao-brilho {
    background:
        radial-gradient(120% 140% at 100% 0%, color-mix(in oklab, var(--viz-1) 16%, transparent), transparent 58%),
        var(--card);
    box-shadow: inset 0 0 0 1px var(--filete);
}

/* Atmosfera da página: brilhos muito suaves nos cantos, só no escuro. */
.dark .atmosfera {
    background-image:
        radial-gradient(60% 50% at 100% 0%, var(--atmosfera-1), transparent 70%),
        radial-gradient(55% 45% at 0% 100%, var(--atmosfera-2), transparent 70%);
    background-attachment: fixed;
}

/* Item ativo do menu: filete de 2 px à esquerda. */
html.painel [data-sidebar='menu-button'][data-active='true'] {
    position: relative;
}
html.painel [data-sidebar='menu-button'][data-active='true']::before {
    content: '';
    position: absolute;
    inset: 6px auto 6px 0;
    width: 2px;
    border-radius: 2px;
    background-image: var(--gradiente-corrente);
}
```

O restante do CSS do painel (rótulos de grupo do menu, cabeçalho de tabela, animações, pódio, mapa) está em `dashboard.css`, no Apêndice D (D.5). O `entry.tsx` do painel importa a fonte (`@fontsource-variable/dm-sans/wght.css`) e esse `dashboard.css` e põe a classe `painel` no `<html>`.

---

## Apêndice C — Validador de paleta (script pronto)

Salve como `validar-paleta.mjs` (já vem pronto ao lado deste arquivo; Node 18+; não precisa instalar nada). Rode **uma vez por tema**, passando as 3 cores de série **na ordem de uso** e a cor do **cartão** do tema:

```
node validar-paleta.mjs "#VIZ1,#VIZ2,#VIZ3" claro  "#CARTAO_CLARO"
node validar-paleta.mjs "#VIZ1,#VIZ2,#VIZ3" escuro "#CARTAO_ESCURO"
node validar-paleta.mjs "#ORD1,#ORD2,#ORD3" claro  "#CARTAO_CLARO"  --ordinal   # rampa do funil
node validar-paleta.mjs "#ORD1,#ORD2,#ORD3" escuro "#CARTAO_ESCURO" --ordinal   # rampa do funil
```

Se aparecer `FAIL`, ajuste **a luminosidade ou o matiz da cor indicada** (mantendo a identidade da marca) e rode de novo. `WARN` de contraste significa "o valor tem de aparecer escrito ao lado da marca" (a referência já faz isso). Se a skill `dataviz` estiver disponível, o `scripts/validate_palette.js` dela faz o mesmo (com `--ordinal` para a rampa do funil); o script abaixo reproduz os números dela. Conferido com a paleta da referência: séries 9,2 / 27,6 / 2,82 no claro e 9,4 / 26,5 no escuro; rampa do funil com extremo a 2,11:1 (claro) e 3,41:1 (escuro).

````js
// validar-paleta.mjs — confere as cores de dados de um gráfico (2 a 8 cores, na ordem em que serão usadas).
// Uso (uma vez por tema; o 3º argumento é a cor do CARTÃO onde o gráfico fica, não a do fundo da página):
//   node validar-paleta.mjs "#cor1,#cor2,#cor3" claro  "#ffffff"
//   node validar-paleta.mjs "#cor1,#cor2,#cor3" escuro "#0d1422"
//   node validar-paleta.mjs "#etapa1,#etapa2,#etapa3" claro "#ffffff" --ordinal     (rampa do funil)
//
// SÉRIES (identidade; OKLab/OKLCH; ΔE = distância euclidiana em OKLab × 100):
//   luminosidade L: claro 0,43–0,77 · escuro 0,48–0,67                  (FAIL fora da faixa)
//   croma C ≥ 0,10 (abaixo disso a cor "vira cinza" e não identifica)   (FAIL)
//   ΔE entre vizinhas, daltonismo (protan/deutan): ≥ 8 ok · 6–8 só com o número escrito junto (WARN) · < 6 FAIL
//   ΔE entre vizinhas, visão normal: ≥ 15                               (FAIL abaixo)
//   contraste contra a superfície ≥ 3:1; abaixo (WARN) o valor TEM de aparecer escrito ao lado da marca.
// RAMPA ORDINAL (--ordinal): luminosidade monótona · degraus com ΔL ≥ 0,06 · extremo mais próximo da superfície
//   com contraste ≥ 2:1 · um só matiz (dispersão ≤ 40°).
const args = process.argv.slice(2)
const ordinal = args.includes('--ordinal')
const [lista = '', modoArg = 'claro', superficieArg] = args.filter((a) => !a.startsWith('--'))
const modo = modoArg === 'escuro' || modoArg === 'dark' ? 'escuro' : 'claro'
const superficie = (superficieArg ?? (modo === 'claro' ? '#ffffff' : '#0d1422')).toLowerCase()
const cores = lista.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
if (cores.length < 2 || !cores.every((c) => /^#[0-9a-f]{6}$/.test(c)) || !/^#[0-9a-f]{6}$/.test(superficie)) {
  console.error('Informe 2 ou mais cores no formato #rrggbb separadas por vírgula (e a superfície também em #rrggbb).')
  process.exit(2)
}

const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
}
const paraLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lin = (hex) => [1, 3, 5].map((i) => paraLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
const limitar = (v) => Math.max(0, Math.min(1, v))
const simular = (hex, tipo) => { const [r, g, b] = lin(hex); return MACHADO[tipo].map((l) => limitar(l[0] * r + l[1] * g + l[2] * b)) }
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const lab = (hex) => oklab(lin(hex))
const luminosidade = (hex) => lab(hex)[0]
const croma = (hex) => Math.hypot(lab(hex)[1], lab(hex)[2])
const matiz = (hex) => ((Math.atan2(lab(hex)[2], lab(hex)[1]) * 180) / Math.PI + 360) % 360
const deltaE = (a, b, tipo) => {
  const x = oklab(tipo ? simular(a, tipo) : lin(a))
  const y = oklab(tipo ? simular(b, tipo) : lin(b))
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
const brilho = (hex) => { const [r, g, b] = lin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contraste = (a, b) => { const [alto, baixo] = [brilho(a), brilho(b)].sort((x, y) => y - x); return (alto + 0.05) / (baixo + 0.05) }

const linhas = []
const registrar = (estado, nome, detalhe) => linhas.push([estado, nome, detalhe])

if (ordinal) {
  const Ls = cores.map(luminosidade)
  const ordem = [...Ls.keys()].sort((a, b) => Ls[a] - Ls[b])
  const monotona = ordem.every((v, i) => v === i) || ordem.every((v, i) => v === Ls.length - 1 - i)
  registrar(monotona ? 'PASS' : 'FAIL', 'Luminosidade monótona', monotona ? 'os degraus vão do claro ao escuro' : `fora de ordem: L = ${Ls.map((l) => l.toFixed(2)).join(', ')}`)

  const finas = Ls.slice(1).map((l, i) => [cores[i], cores[i + 1], Math.abs(l - Ls[i])]).filter(([, , g]) => g < 0.06)
  registrar(finas.length ? 'FAIL' : 'PASS', 'Distância entre degraus', finas.length ? `degraus colados (ΔL < 0,06): ${finas.map(([a, b, g]) => `${a}↔${b} ${g.toFixed(3)}`).join(', ')}` : 'todos ΔL ≥ 0,06')

  const porL = [...cores].sort((a, b) => luminosidade(a) - luminosidade(b))
  const extremo = modo === 'claro' ? porL[porL.length - 1] : porL[0]
  const cr = contraste(extremo, superficie)
  registrar(cr >= 2 ? 'PASS' : 'FAIL', 'Extremo × superfície', `${extremo} a ${cr.toFixed(2)}:1 contra ${superficie}${cr >= 2 ? '' : ' — abaixo de 2:1'}`)

  const matizes = cores.map(matiz)
  let dispersao = Math.max(...matizes) - Math.min(...matizes)
  if (dispersao > 180) dispersao = 360 - dispersao
  registrar(dispersao <= 40 ? 'PASS' : 'FAIL', 'Um só matiz', `dispersão de ${dispersao.toFixed(0)}°${dispersao <= 40 ? '' : ' — acima de 40°, não é uma rampa'}`)
} else {
  const faixa = modo === 'claro' ? [0.43, 0.77] : [0.48, 0.67]
  const pares = cores.slice(1).map((c, i) => [cores[i], c])
  const minimo = (fn) => pares.reduce((pior, [a, b]) => { const d = fn(a, b); return !pior || d < pior.d ? { d, a, b } : pior }, null)

  const fora = cores.filter((c) => luminosidade(c) < faixa[0] || luminosidade(c) > faixa[1]).map((c) => `${c} (L ${luminosidade(c).toFixed(2)})`)
  registrar(fora.length ? 'FAIL' : 'PASS', 'Faixa de luminosidade', fora.length ? `fora de ${faixa.join('–')}: ${fora.join(', ')}` : `todas dentro de ${faixa.join('–')}`)

  const cinzas = cores.filter((c) => croma(c) < 0.1).map((c) => `${c} (C ${croma(c).toFixed(2)})`)
  registrar(cinzas.length ? 'FAIL' : 'PASS', 'Croma mínimo', cinzas.length ? `parecem cinza: ${cinzas.join(', ')}` : 'todas ≥ 0,10')

  const cvd = ['protan', 'deutan'].map((t) => ({ t, ...minimo((a, b) => deltaE(a, b, t)) })).sort((x, y) => x.d - y.d)[0]
  registrar(cvd.d >= 8 ? 'PASS' : cvd.d >= 6 ? 'WARN' : 'FAIL', 'Daltonismo (vizinhas)', `pior par ${cvd.a} ↔ ${cvd.b}: ΔE ${cvd.d.toFixed(1)} (${cvd.t})${cvd.d >= 6 && cvd.d < 8 ? ' — só vale com o número escrito junto' : ''}`)

  const normal = minimo((a, b) => deltaE(a, b))
  registrar(normal.d >= 15 ? 'PASS' : 'FAIL', 'Visão normal (vizinhas)', `pior par ${normal.a} ↔ ${normal.b}: ΔE ${normal.d.toFixed(1)}`)

  const baixos = cores.filter((c) => contraste(c, superficie) < 3).map((c) => `${c} ${contraste(c, superficie).toFixed(2)}:1`)
  registrar(baixos.length ? 'WARN' : 'PASS', `Contraste contra ${superficie}`, baixos.length ? `abaixo de 3:1 (escreva o valor ao lado da marca): ${baixos.join(', ')}` : 'todas ≥ 3:1')
}

console.log(`\n${ordinal ? 'Rampa ordinal' : 'Paleta'} (${modo}, superfície ${superficie}): ${cores.join(' ')}`)
for (const [estado, nome, detalhe] of linhas) console.log(`  [${estado}] ${nome.padEnd(26)} ${detalhe}`)
const falhou = linhas.some(([estado]) => estado === 'FAIL')
console.log(`\n  → ${falhou ? 'REPROVADA: ajuste a luminosidade ou o matiz da cor indicada e rode de novo' : 'APROVADA (WARN exige o valor escrito ao lado da marca)'}\n`)
process.exit(falhou ? 1 : 0)
````

---

## Apêndice D — Código de referência, arquivo por arquivo

Este é o código **real** da referência, na ordem de dependência. As únicas alterações em relação ao original são as trocas de cor fixa por token (5.5), marcadas em cada nota. Pontos importantes:

- Os caminhos `@/...` são os do projeto de origem (`@` = `src/`); **adapte aos caminhos do destino**.
- Cada arquivo tem uma **Nota** com o que **manter** e o que **adaptar ao nicho** (textos, importações de domínio como `PERFIS`, `RegraBadge`, `formatPhoneDisplay`).
- Os nomes em português (`rotulo`, `valor`, `detalhe`, `lateral`, `destaque`, `acao`) fazem parte da API dos componentes; mantenha-os ou renomeie de forma consistente com o projeto.
- Arquivos do shadcn (Button, Badge, Tooltip) estão aqui **para fixar as medidas**; se o projeto já tem esses componentes, compare com os tamanhos da seção 4.3 e ajuste só o necessário.
- O que **não** está aqui (Sidebar, Sheet, Input, Separator, DropdownMenu, AlertDialog, Sonner, Table, Tabs) é o padrão do shadcn `radix-nova`; use o do projeto ou gere com `npx shadcn@latest add <nome>`.

### D.1 — `src/components/ui/button.tsx`

**Nota.** Gerado pelo shadcn (estilo `radix-nova`). **Mantém:** alturas (`default` 32 px, `sm` 28 px, `icon` 32 px, `icon-sm` 28 px), `rounded-lg`, anel de foco de 3 px. O botão `default` ganha o degradê de ação por CSS (B.4). Se o projeto já tem `Button`, ajuste só o que divergir das medidas da seção 4.3.

````tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
````

### D.2 — `src/components/ui/badge.tsx`

**Nota.** shadcn `radix-nova`. **Mantém** `h-5`, `rounded-4xl` (pílula) e `text-xs`. Na Visão geral aparece na barra superior: `secondary` (situação aberta) e `destructive` (pausada).

````tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
````

### D.3 — `src/components/ui/tooltip.tsx`

**Nota.** shadcn. Dica de ícones e do menu recolhido: fundo `--foreground`, texto `--background`. O `TooltipProvider` do painel usa `delayDuration={300}` (ver `entry.tsx`).

````tsx
"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
````

### D.4 — `src/lib/utils.ts`

**Nota.** Na referência `cn` vem do pacote `cn`; no shadcn padrão é `clsx` + `tailwind-merge`. Use o que o projeto já tem.

````ts
export { cn } from "cn"
````

### D.5 — `src/admin/dashboard.css`

**Nota.** CSS do painel: rótulos de grupo do menu e cabeçalho de tabela, cartões (`painel-cartao*`, usados por outras páginas), barra de recarga, linha nova do feed, "número que subiu", **pódio** (ouro, prata e bronze só aqui), mapa e pino (só servem ao cartão de local: remova se não usar), `painel-desdobrar`. Todas as cores são tokens. Respeita `prefers-reduced-motion`. **Mantém integralmente** (menos o que for do nicho).

````css
/* Painel do encontro: movimento, pódio e detalhes de acabamento. As cores (tokens) ficam em src/index.css. */

html.painel [data-sidebar='group-label'] {
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
html.painel [data-slot='table-head'] {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* Cartões do painel: superfície, filete e um leve levantar ao passar o mouse nos que são clicáveis. */
.painel-cartao {
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--card-foreground);
  border-radius: 1rem;
}
.painel-cartao-clicavel {
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}
.painel-cartao-clicavel:hover {
  border-color: color-mix(in oklab, var(--viz-1) 35%, var(--border));
  box-shadow: 0 10px 30px -18px color-mix(in oklab, var(--viz-1) 55%, transparent);
  transform: translateY(-1px);
}

/* Faixa de atualização: fina, no topo, enquanto uma recarga completa acontece (os dados anteriores seguem na tela). */
@keyframes painel-progresso {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
.painel-progresso {
  position: absolute;
  inset: auto 0 -1px 0;
  height: 2px;
  overflow: hidden;
}
.painel-progresso::after {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  background-image: var(--gradiente-corrente);
  animation: painel-progresso 1.1s ease-in-out infinite;
}

/* Linha que acabou de chegar pelo tempo real: lavagem azul que some. */
@keyframes painel-linha-nova {
  from {
    background-color: color-mix(in oklab, var(--viz-1) 20%, transparent);
  }
  to {
    background-color: transparent;
  }
}
.painel-linha-nova {
  animation: painel-linha-nova 2.6s ease-out;
}

/* Número que mudou ao vivo: sobe um pouquinho. */
@keyframes painel-numero-subiu {
  from {
    transform: translateY(0.18em);
  }
  to {
    transform: none;
  }
}
.painel-numero-subiu {
  display: inline-block;
  animation: painel-numero-subiu 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
}

/* ---------------------------------------------------------------------------
   Pódio: 2º, 1º e 3º lado a lado; os degraus sobem ao abrir. Ouro, prata e bronze só aqui.
   --------------------------------------------------------------------------- */
.podio {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: end;
  gap: 0.75rem;
}
.podio-lugar {
  --medalha: var(--prata);
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.podio-lugar[data-lugar='1'] {
  --medalha: var(--ouro);
}
.podio-lugar[data-lugar='3'] {
  --medalha: var(--bronze);
}
.podio-avatar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  font-weight: 600;
  color: var(--heading);
  background: color-mix(in oklab, var(--medalha) 18%, var(--card));
  box-shadow:
    0 0 0 2px var(--card),
    0 0 0 4px var(--medalha);
}
.podio-degrau {
  position: relative;
  width: 100%;
  border-radius: 14px 14px 6px 6px;
  border: 1px solid color-mix(in oklab, var(--medalha) 38%, var(--border));
  background:
    linear-gradient(180deg, color-mix(in oklab, var(--medalha) 26%, var(--card)) 0%, var(--card) 88%);
  transform-origin: bottom;
}
.podio-lugar[data-lugar='1'] .podio-degrau {
  box-shadow: 0 18px 40px -26px var(--medalha);
}
.podio-numero {
  font-weight: 700;
  line-height: 1;
  color: color-mix(in oklab, var(--medalha) 70%, var(--heading));
}
@keyframes podio-subir {
  from {
    transform: scaleY(0.35);
  }
  to {
    transform: none;
  }
}
@keyframes podio-coroa {
  0%,
  100% {
    transform: translateY(0) rotate(-6deg);
    filter: drop-shadow(0 0 0 transparent);
  }
  50% {
    transform: translateY(-3px) rotate(4deg);
    filter: drop-shadow(0 4px 10px color-mix(in oklab, var(--ouro) 70%, transparent));
  }
}
@keyframes podio-brilho {
  0% {
    transform: translateX(-130%) skewX(-18deg);
  }
  60%,
  100% {
    transform: translateX(330%) skewX(-18deg);
  }
}
.podio-coroa {
  color: var(--ouro);
}

/* Mapa do OpenStreetMap no tema escuro: mesmas ruas, tons invertidos para não ofuscar. */
.dark .mapa-tema {
  filter: invert(0.9) hue-rotate(180deg) saturate(0.75) brightness(0.95) contrast(0.92);
}

/* Pino pulsando sobre o mapa. */
@keyframes pino-onda {
  from {
    transform: scale(0.6);
    opacity: 0.7;
  }
  to {
    transform: scale(2.4);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .podio-degrau {
    animation: podio-subir 0.75s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .podio-lugar[data-lugar='1'] .podio-degrau {
    animation-delay: 0.08s;
  }
  .podio-lugar[data-lugar='3'] .podio-degrau {
    animation-delay: 0.16s;
  }
  .podio-coroa {
    animation: podio-coroa 3.2s ease-in-out infinite;
  }
  .podio-lugar[data-lugar='1'] .podio-degrau::after {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    border-radius: inherit;
    background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--ouro) 28%, transparent), transparent);
    animation: podio-brilho 4.5s ease-in-out 1s infinite;
    pointer-events: none;
  }
  .pino-onda {
    animation: pino-onda 1.8s ease-out infinite;
  }
}
@media (prefers-reduced-motion: reduce) {
  .painel-linha-nova,
  .painel-numero-subiu,
  .painel-progresso::after {
    animation: none;
  }
}

/* Lista que se abre embaixo de uma linha (seguidores por indicador). */
@keyframes painel-desdobrar {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .painel-desdobrar {
    animation: painel-desdobrar 0.22s ease-out;
  }
}
````

### D.6 — `src/admin/components/charts/scale.ts`

**Nota.** Utilitários puros e portáveis. `niceTicks(max, alvo = 4)` devolve marcas **inteiras a partir do zero** (o 2,5 só entra a partir das dezenas); `formatarNumero` e `formatarPct` usam `Intl` pt-BR (porcentagem com até 1 casa). Testes no fim do apêndice.

````ts
/** Marcas "redondas" para um eixo de contagens (inteiros), começando em zero. */
export function niceTicks(max: number, alvo = 4): number[] {
  const m = Math.max(1, max)
  const bruto = m / alvo
  const magnitude = 10 ** Math.floor(Math.log10(bruto))
  // 2,5 só a partir das dezenas: contagem não tem meio.
  const multiplos = magnitude >= 10 ? [1, 2, 2.5, 5] : [1, 2, 5]
  const passo = Math.max(1, multiplos.map((p) => p * magnitude).find((p) => p >= bruto) ?? 10 * magnitude)
  const topo = Math.ceil(m / passo) * passo
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo)
}

const numero = new Intl.NumberFormat('pt-BR')
export const formatarNumero = (n: number) => numero.format(n)

const porcento = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })
export const formatarPct = (fracao: number) => porcento.format(fracao)
````

### D.7 — `src/admin/components/charts/geometria.ts`

**Nota.** `caminhoSuave`: curva cúbica **monotônica** (Fritsch–Carlson), suave sem criar picos ou vales que não existem nos dados. `indiceMaisProximo` encaixa o ponteiro no ponto mais próximo. Portável sem mudança.

````ts
// Geometria dos gráficos em SVG: curva suave que não "ultrapassa" os dados e encaixe do ponteiro.

type Ponto = [number, number]

const r = (n: number) => Math.round(n * 100) / 100

/**
 * Curva cúbica monotônica (Fritsch–Carlson): suave, mas sem criar picos ou vales que não existem nos dados.
 * Os x precisam ser crescentes.
 */
export function caminhoSuave(pontos: Ponto[]): string {
  if (pontos.length === 0) return ''
  const [x0, y0] = pontos[0]
  if (pontos.length === 1) return `M${r(x0)},${r(y0)}`

  const n = pontos.length
  const dx: number[] = []
  const inclinacao: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pontos[i + 1][0] - pontos[i][0])
    inclinacao.push((pontos[i + 1][1] - pontos[i][1]) / dx[i])
  }

  const tangente: number[] = [inclinacao[0]]
  for (let i = 1; i < n - 1; i++) {
    tangente.push(inclinacao[i - 1] * inclinacao[i] <= 0 ? 0 : (inclinacao[i - 1] + inclinacao[i]) / 2)
  }
  tangente.push(inclinacao[n - 2])

  for (let i = 0; i < n - 1; i++) {
    if (inclinacao[i] === 0) {
      tangente[i] = 0
      tangente[i + 1] = 0
      continue
    }
    const a = tangente[i] / inclinacao[i]
    const b = tangente[i + 1] / inclinacao[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      tangente[i] = t * a * inclinacao[i]
      tangente[i + 1] = t * b * inclinacao[i]
    }
  }

  let d = `M${r(x0)},${r(y0)}`
  for (let i = 0; i < n - 1; i++) {
    const [xa, ya] = pontos[i]
    const [xb, yb] = pontos[i + 1]
    const c1: Ponto = [xa + dx[i] / 3, ya + (tangente[i] * dx[i]) / 3]
    const c2: Ponto = [xb - dx[i] / 3, yb - (tangente[i + 1] * dx[i]) / 3]
    d += ` C${r(c1[0])},${r(c1[1])} ${r(c2[0])},${r(c2[1])} ${r(xb)},${r(yb)}`
  }
  return d
}

/** Índice do ponto mais próximo do ponteiro, com `n` pontos distribuídos de 0 a `largura`. */
export function indiceMaisProximo(x: number, n: number, largura: number): number {
  if (n <= 1) return 0
  const passo = largura / (n - 1)
  return Math.min(n - 1, Math.max(0, Math.round(x / passo)))
}
````

### D.8 — `src/domain/time.ts`

**Nota.** Datas em UTC, exibidas no **fuso do negócio** com `Intl.DateTimeFormat` (sem biblioteca). `hourBucket` gera a chave `yyyy-MM-dd HH`; `zonedLocalToUtc` converte o horário local do `datetime-local` (duas passadas resolvem o horário de verão); `formatarDuracao` produz "47 s", "1 min 07 s", "1 h 05 min". Troque `FUSO_PADRAO` pelo fuso do seu negócio.

````ts
// Datas sempre armazenadas em UTC (ISO) e exibidas no fuso do evento, sem bibliotecas de data.
// Tudo passa por Intl.DateTimeFormat + formatToParts, que conhece as regras de horário de verão.

export const FUSO_PADRAO = 'America/Sao_Paulo'

interface Partes {
  ano: string
  mes: string
  dia: string
  hora: string
  minuto: string
  segundo: string
}

const formatadores = new Map<string, Intl.DateTimeFormat>()

function formatador(tz: string): Intl.DateTimeFormat {
  let f = formatadores.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatadores.set(tz, f)
  }
  return f
}

function partes(instante: string | number | Date, tz: string): Partes {
  const p: Record<string, string> = {}
  for (const { type, value } of formatador(tz).formatToParts(new Date(instante))) p[type] = value
  return {
    ano: p.year,
    mes: p.month,
    dia: p.day,
    // Alguns motores ainda devolvem "24" à meia-noite mesmo com h23.
    hora: p.hour === '24' ? '00' : p.hour,
    minuto: p.minute,
    segundo: p.second,
  }
}

/** dd/MM/yyyy HH:mm:ss no fuso informado. */
export function formatDateTime(iso: string, tz: string): string {
  const p = partes(iso, tz)
  return `${p.dia}/${p.mes}/${p.ano} ${p.hora}:${p.minuto}:${p.segundo}`
}

/** HH:mm (tela de sucesso). */
export function formatHourMinute(iso: string, tz: string): string {
  const p = partes(iso, tz)
  return `${p.hora}:${p.minuto}`
}

/** HH:mm:ss (relógio ao vivo do Passe Livre). */
export function formatHoraCompleta(instante: string | number, tz: string): string {
  const p = partes(instante, tz)
  return `${p.hora}:${p.minuto}:${p.segundo}`
}

/** dd/MM HH:mm:ss (ranking). */
export function formatDayMonthTime(iso: string, tz: string): string {
  const p = partes(iso, tz)
  return `${p.dia}/${p.mes} ${p.hora}:${p.minuto}:${p.segundo}`
}

/** 'yyyy-MM-dd' (coluna date) → dd/MM/yyyy, sem passar por fuso. */
export function formatDateOnly(data: string): string {
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

/** Chave da hora local: 'yyyy-MM-dd HH'. */
export function hourBucket(iso: string, tz: string): string {
  const p = partes(iso, tz)
  return `${p.ano}-${p.mes}-${p.dia} ${p.hora}`
}

/** Diferença (ms) entre o relógio local do fuso e UTC no instante dado. */
function offsetMs(instante: number, tz: string): number {
  const p = partes(instante, tz)
  const comoUtc = Date.UTC(+p.ano, +p.mes - 1, +p.dia, +p.hora, +p.minuto, +p.segundo)
  return comoUtc - Math.floor(instante / 1000) * 1000
}

/** 'yyyy-MM-ddTHH:mm[:ss]' no relógio do fuso → ISO em UTC. */
export function zonedLocalToUtc(local: string, tz: string): string {
  const [data, hora = '00:00'] = local.split('T')
  const [ano, mes, dia] = data.split('-').map(Number)
  const [h, m, s = 0] = hora.split(':').map(Number)
  const comoUtc = Date.UTC(ano, mes - 1, dia, h, m, s)
  // Duas passadas resolvem a troca de offset no horário de verão.
  let instante = comoUtc - offsetMs(comoUtc, tz)
  instante = comoUtc - offsetMs(instante, tz)
  return new Date(instante).toISOString()
}

/** Início do dia corrente (00:00 no fuso do evento), em UTC. */
export function startOfTodayUtc(agoraIso: string, tz: string): string {
  const p = partes(agoraIso, tz)
  return zonedLocalToUtc(`${p.ano}-${p.mes}-${p.dia}T00:00`, tz)
}

/** Agora menos uma hora, em UTC. */
export function lastHourUtc(agoraIso: string): string {
  return new Date(new Date(agoraIso).getTime() - 60 * 60 * 1000).toISOString()
}

/** Valor para <input type="datetime-local"> no fuso do evento. */
export function toZonedLocalInput(iso: string, tz: string): string {
  const p = partes(iso, tz)
  return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}`
}

const DIAS_DA_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

/** "Quarta-feira, 30/09/2026": o dia exato no fuso do evento (usado no formulário). */
export function formatDiaDaSemana(iso: string, tz: string): string {
  const p = partes(iso, tz)
  const semana = new Date(Date.UTC(+p.ano, +p.mes - 1, +p.dia)).getUTCDay()
  return `${DIAS_DA_SEMANA[semana]}, ${p.dia}/${p.mes}/${p.ano}`
}

const doisDigitos = (n: number) => String(n).padStart(2, '0')

/** Duração curta para pessoas: "47 s", "1 min 07 s", "1 h 05 min" (tempo entre a leitura do QR e o envio). */
export function formatarDuracao(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 1) return 'menos de 1 s'
  if (s < 60) return `${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return s % 60 ? `${min} min ${doisDigitos(s % 60)} s` : `${min} min`
  const h = Math.floor(min / 60)
  return min % 60 ? `${h} h ${doisDigitos(min % 60)} min` : `${h} h`
}
````

### D.9 — `src/admin/components/KpiCard.tsx`

**Nota.** O coração visual da página: `KpiCard` (chip de ícone + rótulo, valor grande, detalhe, complemento `lateral` e `children`) e `Bloco` (título, descrição e ação à direita). `destaque` usa `.cartao-brilho`. **Mantém integralmente.**

````tsx
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Indicador do painel: rótulo, valor (grande, dígitos proporcionais), detalhe e um complemento visual opcional. */
export function KpiCard({
  rotulo,
  icone: Icone,
  valor,
  detalhe,
  lateral,
  destaque = false,
  children,
  className = '',
}: {
  rotulo: string
  icone?: LucideIcon
  valor: ReactNode
  detalhe?: ReactNode
  /** À direita do valor (anel, minigráfico). */
  lateral?: ReactNode
  /** Cartão principal da linha: brilho azul no canto. */
  destaque?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={rotulo}
      className={`relative overflow-hidden rounded-2xl border p-4 md:p-5 ${destaque ? 'cartao-brilho border-transparent' : 'bg-card'} ${className}`}
    >
      <div className="flex items-center gap-2.5">
        {Icone && (
          <span className="flex size-8 items-center justify-center rounded-xl bg-viz-1/12 text-viz-1 ring-1 ring-viz-1/20" aria-hidden="true">
            <Icone className="size-4" />
          </span>
        )}
        <h2 className="text-sm font-medium text-muted-foreground">{rotulo}</h2>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className={`${destaque ? 'text-5xl md:text-6xl' : 'text-4xl'} font-semibold leading-none tracking-tight text-heading`}>{valor}</p>
          {detalhe && <div className="mt-2 text-xs text-muted-foreground">{detalhe}</div>}
        </div>
        {lateral}
      </div>
      {children}
    </section>
  )
}

/** Painel com título, descrição e ação à direita. */
export function Bloco({
  titulo,
  descricao,
  acao,
  children,
  className = '',
  id,
}: {
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section aria-labelledby={id} aria-label={id ? undefined : titulo} className={`min-w-0 rounded-2xl border bg-card p-4 text-card-foreground md:p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-[0.95rem] font-semibold text-heading">
            {titulo}
          </h2>
          {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  )
}
````

### D.10 — `src/admin/components/NumeroAnimado.tsx`

**Nota.** Contagem animada até o valor **exato** (900 ms na primeira vez, 550 ms depois); sem animação com `prefers-reduced-motion`. **Mantém integralmente.**

````tsx
import { useEffect, useRef, useState } from 'react'
import { formatarNumero } from './charts/scale'

function reduzMovimento(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Número que conta até o valor ao abrir e quando muda ao vivo (com um leve realce ao mudar). Sem animação para quem pede
 * menos movimento. O valor final é sempre o exato.
 */
export function NumeroAnimado({ valor, formatar = formatarNumero, className }: { valor: number; formatar?: (n: number) => string; className?: string }) {
  // null: mostra o valor exato. Um número: a contagem em andamento.
  const [contando, setContando] = useState<number | null>(() => (reduzMovimento() ? null : 0))
  // O que está na tela agora: a animação parte daqui (sobrevive ao efeito rodar duas vezes no modo estrito do React).
  const mostrado = useRef(0)

  useEffect(() => {
    const de = mostrado.current
    if (reduzMovimento()) {
      mostrado.current = valor
      return
    }
    const inicio = performance.now()
    const duracao = de === 0 ? 900 : 550
    let quadro = 0
    const passo = (t: number) => {
      const k = de === valor ? 1 : Math.min(1, (t - inicio) / duracao)
      const atual = de + (valor - de) * (1 - (1 - k) ** 3)
      mostrado.current = k < 1 ? atual : valor
      setContando(k < 1 ? atual : null)
      if (k < 1) quadro = requestAnimationFrame(passo)
    }
    quadro = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(quadro)
  }, [valor])

  return (
    <span key={valor} className={`painel-numero-subiu ${className ?? ''}`}>
      {formatar(Math.round(contando ?? valor))}
    </span>
  )
}
````

### D.11 — `src/admin/components/charts/Sparkline.tsx`

**Nota.** Minigráfico **decorativo** (`aria-hidden`; o número fica ao lado). Usa `useId` para o id do degradê. Precisa de pelo menos 2 pontos.

````tsx
import { useId } from 'react'
import { caminhoSuave } from './geometria'

/** Minigráfico decorativo (o número principal fica ao lado): área suave com degradê. */
export function Sparkline({ valores, largura = 160, altura = 48 }: { valores: number[]; largura?: number; altura?: number }) {
  const id = useId().replace(/:/g, '')
  if (valores.length < 2) return null
  const max = Math.max(1, ...valores)
  const pad = 3
  const x = (i: number) => (i / (valores.length - 1)) * largura
  const y = (v: number) => pad + (altura - pad * 2) * (1 - v / max)
  const linha = caminhoSuave(valores.map((v, i) => [x(i), y(v)]))
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} className="block h-auto max-w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0.4 }} />
          <stop offset="100%" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={`${linha} L${largura},${altura} L0,${altura} Z`} fill={`url(#${id})`} />
      <path d={linha} fill="none" className="stroke-viz-1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={largura} cy={y(valores[valores.length - 1])} r={3.5} className="fill-viz-1 stroke-card" strokeWidth={2} />
    </svg>
  )
}
````

### D.12 — `src/admin/components/charts/RingGauge.tsx`

**Nota.** Anel de progresso (0 a 1) com o conteúdo no centro; `role="meter"`. O trilho é `--viz-track`.

````tsx
import type { ReactNode } from 'react'

/** Anel de progresso (0 a 1) com o valor no centro. O trilho é um tom mais claro do mesmo azul. */
export function RingGauge({
  fracao,
  tamanho = 76,
  espessura = 8,
  rotulo,
  children,
}: {
  fracao: number
  tamanho?: number
  espessura?: number
  rotulo: string
  children: ReactNode
}) {
  const f = Math.min(1, Math.max(0, fracao))
  const raio = (tamanho - espessura) / 2
  const circunferencia = 2 * Math.PI * raio
  return (
    <div
      className="relative shrink-0"
      style={{ width: tamanho, height: tamanho }}
      role="meter"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
    >
      <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} className="-rotate-90" aria-hidden="true">
        <circle cx={tamanho / 2} cy={tamanho / 2} r={raio} fill="none" className="stroke-viz-track" strokeWidth={espessura} />
        <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={raio}
          fill="none"
          className="stroke-viz-1 transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth={espessura}
          strokeLinecap="round"
          strokeDasharray={circunferencia}
          strokeDashoffset={f === 0 ? circunferencia : circunferencia * (1 - f)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight">{children}</div>
    </div>
  )
}
````

### D.13 — `src/admin/components/charts/HourlyChart.tsx`

**Nota.** O gráfico principal: SVG puro, **um eixo**, área + linha, mira, dica, teclado e tabela alternativa; estado vazio com moldura tracejada. Os nomes dos campos (`envios`, `aberturas`) e das legendas ("Envios", "Aberturas") são do nicho: troque pelas suas duas medidas (a da **área** primeiro). Importa o tipo `HourPoint` de `stats.ts`. Mantém tudo o mais. Testes no fim do apêndice.

````tsx
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { HourPoint } from '@/domain/stats'
import { caminhoSuave, indiceMaisProximo } from './geometria'
import { formatarNumero, niceTicks } from './scale'

const ALTURA = 280
const MARGEM = { topo: 16, direita: 16, base: 30, esquerda: 40 }

function Legenda() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      <li className="flex items-center gap-2">
        <span className="h-2.5 w-4 rounded-[3px] bg-gradient-to-b from-viz-1/70 to-viz-1/10 ring-1 ring-viz-1" aria-hidden="true" />
        Envios
      </li>
      <li className="flex items-center gap-2">
        <span className="w-4 border-t-2 border-viz-2" aria-hidden="true" />
        Aberturas
      </li>
    </ul>
  )
}

/** Largura real do contêiner (o SVG é desenhado em pixels, sem distorcer texto nem pontos). */
function useLargura(padrao = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(padrao)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      if (w > 0) setLargura(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, largura }
}

/**
 * Envios (área com degradê) e aberturas (linha) por hora no fuso do evento, num só eixo, com mira e tooltip.
 * Com onSelecionar, clicar numa hora (ou Enter no teclado) abre o que aconteceu naquela hora.
 */
export function HourlyChart({ pontos, onSelecionar }: { pontos: HourPoint[]; onSelecionar?(hora: string): void }) {
  const { ref, largura } = useLargura()
  const [ativo, setAtivo] = useState<number | null>(null)
  const idGradiente = useId().replace(/:/g, '')

  if (pontos.length === 0) {
    // Antes do primeiro cadastro: a moldura do gráfico aparece vazia (nenhum valor inventado).
    return (
      <figure>
        <Legenda />
        <div className="relative mt-4 rounded-lg border border-dashed" style={{ height: ALTURA }}>
          <div aria-hidden="true" className="absolute inset-x-0 bottom-8 border-t border-border" />
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
            Aguardando os primeiros cadastros.
          </p>
        </div>
      </figure>
    )
  }

  const W = Math.max(280, largura)
  const plotW = W - MARGEM.esquerda - MARGEM.direita
  const plotH = ALTURA - MARGEM.topo - MARGEM.base
  const ticks = niceTicks(Math.max(...pontos.flatMap((p) => [p.envios, p.aberturas])))
  const topo = ticks[ticks.length - 1]
  const n = pontos.length
  const x = (i: number) => MARGEM.esquerda + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => MARGEM.topo + plotH - (v / topo) * plotH
  const base = MARGEM.topo + plotH

  const linhaEnvios = caminhoSuave(pontos.map((p, i) => [x(i), y(p.envios)]))
  const linhaAberturas = caminhoSuave(pontos.map((p, i) => [x(i), y(p.aberturas)]))
  const areaEnvios = n > 1 ? `${linhaEnvios} L${x(n - 1)},${base} L${x(0)},${base} Z` : ''
  const cadaRotulo = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 64))))
  const ultimo = pontos[n - 1]

  function mover(e: PointerEvent<SVGSVGElement>) {
    const caixa = e.currentTarget.getBoundingClientRect()
    const escala = caixa.width > 0 ? W / caixa.width : 1
    setAtivo(indiceMaisProximo((e.clientX - caixa.left) * escala - MARGEM.esquerda, n, plotW))
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') setAtivo((a) => Math.max(0, (a ?? n - 1) - 1))
    else if (e.key === 'ArrowRight') setAtivo((a) => Math.min(n - 1, (a ?? n - 1) + 1))
    else if (e.key === 'Home') setAtivo(0)
    else if (e.key === 'End') setAtivo(n - 1)
    else if (e.key === 'Enter' && onSelecionar) onSelecionar(pontos[ativo ?? n - 1].hora)
    else return
    e.preventDefault()
  }

  const p = ativo === null ? null : pontos[ativo]
  const xAtivo = ativo === null ? 0 : x(ativo)

  return (
    <figure>
      <Legenda />
      <div
        ref={ref}
        role="img"
        aria-label={`Envios e aberturas por hora, no fuso do evento. Use as setas para percorrer as horas${onSelecionar ? ' e Enter para ver as pessoas daquela hora' : ''}. Última hora (${ultimo.rotulo}): ${ultimo.envios} envios e ${ultimo.aberturas} aberturas.`}
        tabIndex={0}
        onFocus={() => setAtivo((a) => a ?? n - 1)}
        onBlur={() => setAtivo(null)}
        onKeyDown={teclar}
        className="relative mt-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <svg
          width={W}
          height={ALTURA}
          viewBox={`0 0 ${W} ${ALTURA}`}
          className={`block h-auto max-w-full touch-none select-none ${onSelecionar ? 'cursor-pointer' : ''}`}
          onPointerMove={mover}
          onClick={() => {
            if (onSelecionar && ativo !== null) onSelecionar(pontos[ativo].hora)
          }}
          onPointerLeave={() => setAtivo(null)}
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0.26 }} />
              <stop offset="100%" style={{ stopColor: 'var(--viz-1)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={MARGEM.esquerda}
                x2={W - MARGEM.direita}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? 'stroke-border' : 'stroke-viz-grid'}
                strokeWidth={1}
              />
              <text x={MARGEM.esquerda - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {formatarNumero(t)}
              </text>
            </g>
          ))}

          {pontos.map((pt, i) =>
            i % cadaRotulo === 0 || i === n - 1 ? (
              <text key={pt.hora} x={x(i)} y={ALTURA - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {pt.rotulo}
              </text>
            ) : null,
          )}

          {areaEnvios && <path d={areaEnvios} fill={`url(#${idGradiente})`} />}
          <path d={linhaAberturas} fill="none" className="stroke-viz-2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          <path d={linhaEnvios} fill="none" className="stroke-viz-1" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Ponto e rótulo só no fim da série principal (rotulagem seletiva). */}
          <circle cx={x(n - 1)} cy={y(ultimo.envios)} r={4.5} className="fill-viz-1 stroke-card" strokeWidth={2} />
          {ativo === null && (
            <text x={x(n - 1)} y={y(ultimo.envios) - 12} textAnchor={n === 1 ? 'middle' : 'end'} className="fill-foreground text-xs font-semibold tabular-nums">
              {formatarNumero(ultimo.envios)}
            </text>
          )}

          {p && (
            <g>
              <line x1={xAtivo} x2={xAtivo} y1={MARGEM.topo} y2={base} className="stroke-muted-foreground/50" strokeWidth={1} />
              <circle cx={xAtivo} cy={y(p.aberturas)} r={5} className="fill-viz-2 stroke-card" strokeWidth={2} />
              <circle cx={xAtivo} cy={y(p.envios)} r={5.5} className="fill-viz-1 stroke-card" strokeWidth={2} />
            </g>
          )}
        </svg>

        {p && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-lg backdrop-blur"
            style={{
              left: `${(xAtivo / W) * 100}%`,
              transform: `translateX(${xAtivo > W * 0.6 ? 'calc(-100% - 12px)' : '12px'})`,
            }}
          >
            <p className="mb-1.5 font-medium text-muted-foreground">{p.rotulo}</p>
            <p className="flex items-center gap-2">
              <span className="w-3 border-t-2 border-viz-1" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{formatarNumero(p.envios)}</strong>
              <span className="text-muted-foreground">envios</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="w-3 border-t-2 border-viz-2" aria-hidden="true" />
              <strong className="tabular-nums text-foreground">{formatarNumero(p.aberturas)}</strong>
              <span className="text-muted-foreground">aberturas</span>
            </p>
            {onSelecionar && <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">Clique para ver as pessoas desta hora</p>}
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Hora</th>
              <th className="py-1 text-right font-medium">Envios</th>
              <th className="py-1 text-right font-medium">Aberturas</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pontos.map((pt) => (
              <tr key={pt.hora} className="border-t">
                <td className="py-1">{pt.rotulo}</td>
                <td className="py-1 text-right">{pt.envios}</td>
                <td className="py-1 text-right">{pt.aberturas}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
````

### D.14 — `src/admin/components/charts/Barras.tsx`

**Nota.** Barras horizontais de **uma** série (a cor segue a entidade, não o valor), valor escrito na ponta, destaque ao passar o mouse e tabela alternativa. `inicio` aceita avatar ou ícone.

````tsx
import type { ReactNode } from 'react'
import { formatarNumero, formatarPct } from './scale'

export interface ItemBarra {
  chave: string
  rotulo: ReactNode
  /** Texto do rótulo para leitores de tela e tabela. */
  rotuloTexto: string
  total: number
  /** Fração exibida ao lado do número (ex.: da base de cadastros). */
  fracao?: number | null
  /** Elemento antes do rótulo (foto, ícone). */
  inicio?: ReactNode
  /** Classe da cor da barra; padrão: série 1. */
  cor?: string
}

/**
 * Barras horizontais finas (uma série): valor na ponta, escala do maior item, trilha na mesma família de cor.
 * Cada linha é o alvo do mouse (realça ao passar) e o total sempre sai escrito — a cor nunca carrega o dado sozinha.
 */
export function Barras({ itens, rotulo, vazio = 'Sem dados ainda.' }: { itens: ItemBarra[]; rotulo: string; vazio?: string }) {
  const max = Math.max(0, ...itens.map((i) => i.total))
  if (itens.length === 0 || max === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>
  }
  return (
    <figure>
      <ul aria-label={rotulo} className="space-y-3">
        {itens.map((i) => (
          <li key={i.chave} className="group rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/50">
            <div className="flex items-center gap-2.5">
              {i.inicio}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-foreground">{i.rotulo}</span>
                  <span className="shrink-0 tabular-nums">
                    <strong className="font-semibold text-heading">{formatarNumero(i.total)}</strong>
                    {i.fracao != null && <span className="text-xs text-muted-foreground"> · {formatarPct(i.fracao)}</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-viz-track/60" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-[width] duration-700 ease-out group-hover:brightness-110 ${i.cor ?? 'bg-viz-1'}`}
                    style={{ width: `${(i.total / max) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Ver dados em tabela</summary>
        <table className="mt-2 w-full text-left text-xs">
          <tbody className="tabular-nums">
            {itens.map((i) => (
              <tr key={i.chave} className="border-t">
                <td className="py-1">{i.rotuloTexto}</td>
                <td className="py-1 text-right">{i.total}</td>
                {itens.some((x) => x.fracao != null) && <td className="py-1 text-right">{i.fracao == null ? '—' : formatarPct(i.fracao)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
````

### D.15 — `src/admin/components/charts/DistributionChart.tsx`

**Nota.** Distribuição (barra com trilho, valor e porcentagem). Só renderize se o atributo **é coletado**. Largura mínima de 6 px para valores > 0.

````tsx
import { formatarNumero, formatarPct } from './scale'

/** Barras horizontais de uma série (distribuição), com trilho e o valor na ponta. */
export function DistributionChart({ itens, rotuloAcessivel }: { itens: Array<{ rotulo: string; total: number }>; rotuloAcessivel: string }) {
  const soma = itens.reduce((s, i) => s + i.total, 0)
  const max = Math.max(1, ...itens.map((i) => i.total))

  if (soma === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Sem respostas ainda.</p>

  return (
    <ul className="space-y-3" aria-label={rotuloAcessivel}>
      {itens.map((i) => (
        <li key={i.rotulo} className="group grid grid-cols-[minmax(6rem,9rem)_1fr_5.5rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{i.rotulo}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-viz-1/50 to-viz-1 transition-[width] duration-700 ease-out group-hover:to-viz-1/80"
              style={{ width: i.total === 0 ? 0 : `max(6px, ${(i.total / max) * 100}%)` }}
            />
          </span>
          <span className="text-right text-xs tabular-nums">
            <strong className="font-semibold">{formatarNumero(i.total)}</strong>{' '}
            <span className="text-muted-foreground">({formatarPct(i.total / soma)})</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
````

### D.16 — `src/admin/components/FunilJornada.tsx`

**Nota.** Funil de 3 etapas com **rampa ordinal**. **Troca de cor fixa por token** (`bg-viz-ord-1/2/3`). Os rótulos e os campos (`visitas`, `iniciadas`, `convertidas`) são do nicho; o tipo `Jornada` vem de `dashboard.ts`.

````tsx
import { formatarNumero, formatarPct } from '@/admin/components/charts/scale'
import type { Jornada } from '@/domain/dashboard'
import { formatarDuracao } from '@/domain/time'

// Etapas ordenadas: um azul só, do mais claro ao mais escuro (rampa ordinal do guia de dados).
const ETAPAS = [
  { rotulo: 'Leram o QR ou o link', campo: 'visitas', cor: 'bg-viz-ord-1' },
  { rotulo: 'Começaram o cadastro', campo: 'iniciadas', cor: 'bg-viz-ord-2' },
  { rotulo: 'Concluíram', campo: 'convertidas', cor: 'bg-viz-ord-3' },
] as const

/** Do QR ao cadastro: leram → começaram → concluíram, na escala de quem leu, com a conversão e o tempo mediano. */
export function FunilJornada({ jornada }: { jornada: Jornada }) {
  const base = Math.max(jornada.visitas, 1)
  return (
    <div>
      <ul aria-label="Do QR ao cadastro" className="space-y-3.5">
        {ETAPAS.map((e, i) => {
          const valor = jornada[e.campo]
          return (
            <li key={e.rotulo}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-muted-foreground">{e.rotulo}</span>
                <span className="tabular-nums">
                  <strong className="font-semibold text-heading">{formatarNumero(valor)}</strong>
                  {i > 0 && jornada.visitas > 0 && <span className="text-xs text-muted-foreground"> · {formatarPct(valor / jornada.visitas)}</span>}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 rounded-full bg-muted" aria-hidden="true">
                <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${e.cor}`} style={{ width: `${(valor / base) * 100}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t pt-3 text-xs">
        <p className="text-muted-foreground">
          Conversão
          <strong className="mt-0.5 block text-base font-semibold text-heading">{jornada.conversao === null ? '—' : formatarPct(jornada.conversao)}</strong>
        </p>
        <p className="text-muted-foreground">
          Tempo mediano do QR ao cadastro:{' '}
          <strong className="mt-0.5 block text-base font-semibold text-heading">{jornada.medianaMs === null ? '—' : formatarDuracao(jornada.medianaMs)}</strong>
        </p>
      </div>
    </div>
  )
}
````

### D.17 — `src/admin/components/Iniciais.tsx`

**Nota.** Avatar neutro com as iniciais (sem cor por pessoa: a cor do painel é reservada aos dados). **Troca de cor fixa por token** (`from-avatar-de to-avatar-ate`).

````tsx
/** Iniciais do nome ("Maria Eduarda Silva" → "MS"); vazio vira "?". */
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => /\p{L}/u.test(p))
  if (partes.length === 0) return '?'
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

const TAMANHO = {
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-xs',
  lg: 'size-14 text-base',
} as const

/** Avatar neutro com as iniciais da pessoa (sem cor por pessoa: a cor do painel é reservada aos dados). */
export function Iniciais({ nome, tamanho = 'md', className = '' }: { nome: string | null | undefined; tamanho?: keyof typeof TAMANHO; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-avatar-de to-avatar-ate font-semibold text-heading ring-1 ring-border ${TAMANHO[tamanho]} ${className}`}
    >
      {nome ? iniciais(nome) : '—'}
    </span>
  )
}
````

### D.18 — `src/admin/components/Podio.tsx`

**Nota.** Pódio com o 1º no centro (CSS `order`), degraus que sobem, coroa e brilho; o CSS está em `dashboard.css`. Importa `textoComposicao` (composição das indicações: nicho) e o tipo `RankingRow`: no destino use o seu tipo (`posicao`, `chave`, `nome`, `total`) e remova a composição e a marca "alvo" se não existirem. A lista do 4º ao 6º fica no `OverviewPage`.

````tsx
import { CrownIcon, MedalIcon } from 'lucide-react'
import type { CSSProperties } from 'react'
import { textoComposicao } from '@/admin/lib/composicao'
import type { RankingRow } from '@/domain/ranking'
import { iniciais } from './Iniciais'
import { NumeroAnimado } from './NumeroAnimado'

const LUGARES = [
  { lugar: 1, ordem: 2, altura: 'h-32', alturaCompacta: 'h-20' },
  { lugar: 2, ordem: 1, altura: 'h-24', alturaCompacta: 'h-14' },
  { lugar: 3, ordem: 3, altura: 'h-[4.5rem]', alturaCompacta: 'h-11' },
] as const

/**
 * Pódio das indicações: o 1º no centro, o 2º à esquerda e o 3º à direita. Na leitura (teclado e leitor de tela) a ordem
 * continua 1º, 2º, 3º. Só posições reais: sem gente suficiente, o degrau fica "em aberto".
 */
export function Podio({
  linhas,
  alvo,
  onAbrir,
  compacto = false,
}: {
  linhas: RankingRow[]
  alvo?: string
  onAbrir?(linha: RankingRow): void
  compacto?: boolean
}) {
  const lider = linhas[0]?.total ?? 0
  return (
    <ol className={`podio ${compacto ? 'gap-2' : 'gap-3 md:gap-5'}`} aria-label="Pódio">
      {LUGARES.map(({ lugar, ordem, altura, alturaCompacta }) => {
        const l = linhas[lugar - 1]
        const estilo: CSSProperties = { order: ordem }
        if (!l) {
          return (
            <li key={lugar} className="podio-lugar opacity-50" data-lugar={lugar} style={estilo}>
              <span className={`podio-avatar ${compacto ? 'size-10' : 'size-14'} text-muted-foreground`} aria-hidden="true">
                ?
              </span>
              <p className="mt-2 text-xs text-muted-foreground">{lugar}º lugar em aberto</p>
              <div className={`podio-degrau mt-2 ${compacto ? alturaCompacta : altura}`} aria-hidden="true" />
            </li>
          )
        }
        const composicao = textoComposicao(l)
        const conteudo = (
          <>
            <span className="relative">
              {lugar === 1 && (
                <CrownIcon
                  aria-hidden="true"
                  className={`podio-coroa absolute left-1/2 -translate-x-1/2 ${compacto ? '-top-4 size-5' : '-top-6 size-7'}`}
                  strokeWidth={2.2}
                />
              )}
              <span className={`podio-avatar ${compacto ? 'size-11 text-sm' : lugar === 1 ? 'size-20 text-2xl' : 'size-16 text-lg'}`}>
                {iniciais(l.nome)}
              </span>
            </span>
            <span className={`mt-2 flex min-w-0 max-w-full items-center justify-center gap-1.5 font-semibold text-heading ${compacto ? 'text-xs' : 'text-sm'}`}>
              <span className="truncate">{l.nome}</span>
              {l.chave === alvo && !compacto && (
                <span className="shrink-0 rounded-full border border-viz-2/45 bg-viz-2/10 px-1.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
                  alvo
                </span>
              )}
            </span>
            <span className={`font-semibold leading-none tracking-tight text-heading ${compacto ? 'mt-1 text-2xl' : 'mt-1.5 text-4xl'}`}>
              <NumeroAnimado valor={l.total} />
            </span>
            <span className="mt-0.5 text-[11px] text-muted-foreground">{l.total === 1 ? 'indicação' : 'indicações'}</span>
            {!compacto && (
              <span className="mt-1 min-h-4 text-[11px] tabular-nums text-muted-foreground">
                {lugar === 1 ? (composicao ?? 'na liderança') : lider - l.total === 0 ? 'empatado com o 1º' : `a ${lider - l.total} do 1º`}
              </span>
            )}
            <span className={`podio-degrau mt-2 flex items-start justify-center pt-2 ${compacto ? alturaCompacta : altura}`}>
              <span className={`podio-numero flex items-center gap-1 ${compacto ? 'text-lg' : 'text-3xl'}`}>
                {lugar}
                <MedalIcon aria-hidden="true" className={compacto ? 'size-3.5' : 'size-5'} />
              </span>
            </span>
          </>
        )
        return (
          <li key={l.chave} className="podio-lugar" data-lugar={lugar} style={estilo}>
            {onAbrir ? (
              <button
                type="button"
                onClick={() => onAbrir(l)}
                aria-label={`${lugar}º lugar: ${l.nome}, ${l.total} ${l.total === 1 ? 'indicação' : 'indicações'}. Ver quem ${l.total === 1 ? 'veio' : 'vieram'} por essa pessoa.`}
                className="flex w-full min-w-0 flex-col items-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                {conteudo}
              </button>
            ) : (
              <div className="flex w-full min-w-0 flex-col items-center">{conteudo}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
````

### D.19 — `src/admin/components/FeedAoVivo.tsx`

**Nota.** Feed misto com realce dos itens novos. Os três tipos (`cadastro`, `perfil`, `leitura`), os ícones e os textos são do nicho; **mantenha a estrutura** (união ordenada, corte em 9, conjunto `vistos`, lavagem de 2,6 s, `Quando` com `useHa`). **Troca de cor fixa por token** (`bg-ok/15 text-ok-forte`, `ring-ok/70`).

````tsx
import { QrCodeIcon, SmartphoneIcon, UserRoundCheckIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useHa } from '@/admin/layout/Topbar'
import type { ProfileClickRecord, SubmissionRecord, ViewRecord } from '@/data/types'
import { formatHoraCompleta } from '@/domain/time'
import { PERFIS } from '@/public/perfis'

type Item =
  | { tipo: 'cadastro'; chave: string; em: string; envio: SubmissionRecord }
  | { tipo: 'perfil'; chave: string; em: string; clique: ProfileClickRecord; envio: SubmissionRecord | null }
  | { tipo: 'leitura'; chave: string; em: string; visita: ViewRecord }

function Quando({ em, tz }: { em: string; tz: string }) {
  const ha = useHa(em)
  return (
    <time dateTime={em} title={formatHoraCompleta(em, tz)} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
      {ha}
    </time>
  )
}

/**
 * O que está acontecendo agora: cadastros, perfis abertos no Instagram e leituras do QR que ainda não viraram cadastro,
 * do mais novo para o mais antigo. O que chega enquanto a tela está aberta aparece com um realce.
 */
export function FeedAoVivo({
  submissions,
  views,
  clicks,
  tz,
  nomear,
  onAbrir,
  limite = 9,
}: {
  submissions: SubmissionRecord[]
  views: ViewRecord[]
  clicks: ProfileClickRecord[]
  tz: string
  nomear(atribuido: string | null): string
  onAbrir(id: number): void
  limite?: number
}) {
  const itens = useMemo(() => {
    const envios = new Map(submissions.map((s) => [s.id, s]))
    const cadastroDaVisita = new Map(views.filter((v) => v.submission_id != null).map((v) => [v.id, v.submission_id!]))
    const lista: Item[] = [
      ...submissions.map((s): Item => ({ tipo: 'cadastro', chave: `c${s.id}`, em: s.created_at, envio: s })),
      ...clicks.map((c): Item => {
        const id = cadastroDaVisita.get(c.view_id)
        return { tipo: 'perfil', chave: `p${c.id}`, em: c.created_at, clique: c, envio: id == null ? null : envios.get(id) ?? null }
      }),
      // Leituras que ainda não viraram cadastro (as que viraram já aparecem como cadastro).
      ...views.filter((v) => v.submission_id == null).map((v): Item => ({ tipo: 'leitura', chave: `l${v.id}`, em: v.created_at, visita: v })),
    ]
    return lista.sort((a, b) => Date.parse(b.em) - Date.parse(a.em)).slice(0, limite)
  }, [submissions, views, clicks, limite])

  // Chaves já vistas na primeira pintura: só o que chegar depois ganha o realce (e perde quando a lavagem termina).
  const [vistos, setVistos] = useState(() => new Set(itens.map((i) => i.chave)))
  useEffect(() => {
    if (itens.every((i) => vistos.has(i.chave))) return
    const t = setTimeout(() => setVistos((v) => new Set([...v, ...itens.map((i) => i.chave)])), 2600)
    return () => clearTimeout(t)
  }, [itens, vistos])

  if (itens.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">As leituras do QR, os cadastros e os perfis abertos aparecem aqui assim que acontecem.</p>
  }

  return (
    <ol aria-label="Atividade ao vivo" className="-mx-1.5 space-y-0.5">
      {itens.map((i) => {
        const novo = !vistos.has(i.chave)
        const classe = `flex items-start gap-3 rounded-xl px-1.5 py-2 ${novo ? 'painel-linha-nova' : ''}`
        if (i.tipo === 'cadastro') {
          const indicacao = i.envio.atribuido_a ? nomear(i.envio.atribuido_a) : null
          return (
            <li key={i.chave} className={classe}>
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok-forte" aria-hidden="true">
                <UserRoundCheckIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onAbrir(i.envio.id)} className="max-w-full truncate text-left text-sm font-medium text-heading hover:underline">
                  {i.envio.nome ?? 'Cadastro anonimizado'}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  Cadastrou-se{indicacao ? <> · indicado por <span className="text-foreground">{indicacao}</span></> : null}
                </p>
              </div>
              <Quando em={i.em} tz={tz} />
            </li>
          )
        }
        if (i.tipo === 'perfil') {
          const perfil = PERFIS.find((p) => p.usuario === i.clique.profile_key)
          return (
            <li key={i.chave} className={classe}>
              {perfil ? (
                <img src={perfil.foto} alt="" width={32} height={32} className="mt-0.5 size-8 shrink-0 rounded-full object-cover ring-2 ring-ok/70" />
              ) : (
                <span className="mt-0.5 size-8 shrink-0 rounded-full bg-muted" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                {i.envio ? (
                  <button type="button" onClick={() => onAbrir(i.envio!.id)} className="max-w-full truncate text-left text-sm font-medium text-heading hover:underline">
                    {i.envio.nome ?? 'Cadastro anonimizado'}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-heading">Visitante</p>
                )}
                <p className="truncate text-xs text-muted-foreground">
                  Abriu o Instagram de <span className="text-foreground">{perfil?.nome ?? `@${i.clique.profile_key}`}</span>
                </p>
              </div>
              <Quando em={i.em} tz={tz} />
            </li>
          )
        }
        return (
          <li key={i.chave} className={classe}>
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-viz-1/12 text-viz-1" aria-hidden="true">
              {i.visita.origem === 'qr' ? <QrCodeIcon className="size-4" /> : <SmartphoneIcon className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-heading">{i.visita.origem === 'qr' ? 'Leitura do QR' : 'Abertura do link'}</p>
              <p className="truncate text-xs text-muted-foreground">{i.visita.iniciado_em ? 'Está preenchendo o cadastro' : 'Ainda não começou o cadastro'}</p>
            </div>
            <Quando em={i.em} tz={tz} />
          </li>
        )
      })}
    </ol>
  )
}
````

### D.20 — `src/admin/components/UltimosCadastros.tsx`

**Nota.** Lista dos 8 mais recentes: grade `3.25rem | 1fr | auto` (4 colunas a partir de `md`), linha inteira clicável com o nome como botão (teclado e leitor de tela). As colunas (telefone, indicação, selo da regra, ações) são do nicho: use as do seu painel.

````tsx
import { ArrowRightIcon } from 'lucide-react'
import { AcoesTelefone } from '@/admin/components/AcoesTelefone'
import { RegraBadge } from '@/admin/components/RegraBadge'
import type { SubmissionRecord } from '@/data/types'
import { formatPhoneDisplay } from '@/domain/phone'
import { formatDayMonthTime, formatHourMinute } from '@/domain/time'

/** Feed dos cadastros mais recentes: horário, nome, telefone, o que a pessoa digitou e para quem a indicação foi. */
export function UltimosCadastros({
  envios,
  tz,
  nomear,
  onAbrir,
}: {
  envios: SubmissionRecord[]
  tz: string
  nomear: (atribuido: string | null) => string
  onAbrir: (id: number) => void
}) {
  if (envios.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Os cadastros aparecem aqui assim que chegarem.</p>
  }

  return (
    <ol className="-mx-2 divide-y divide-border">
      {envios.map((s) => {
        const declarada = s.indicacao_declarada?.trim()
        const atribuida = nomear(s.atribuido_a)
        const mudou = Boolean(declarada && s.atribuido_a && atribuida.toLowerCase() !== declarada.toLowerCase())
        return (
          <li key={s.id}>
            {/* A linha inteira abre a ficha com o mouse; para teclado e leitor de tela, o botão é o nome. */}
            <div
              onClick={() => onAbrir(s.id)}
              className="grid cursor-pointer grid-cols-[3.25rem_1fr_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 md:grid-cols-[3.25rem_minmax(0,1.1fr)_minmax(0,1fr)_auto]"
            >
              <time dateTime={s.created_at} title={formatDayMonthTime(s.created_at, tz)} className="text-sm tabular-nums text-muted-foreground">
                {formatHourMinute(s.created_at, tz)}
              </time>

              <div className="min-w-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onAbrir(s.id)
                  }}
                  className="block max-w-full truncate rounded-sm text-left text-sm font-medium text-heading outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  {s.nome ?? <span className="text-muted-foreground">— anonimizado —</span>}
                </button>
                <p className="text-xs tabular-nums text-muted-foreground">{formatPhoneDisplay(s.phone_e164)}</p>
              </div>

              <div className="col-start-2 row-start-2 min-w-0 md:col-start-3 md:row-start-1">
                {declarada ? (
                  <p className="flex min-w-0 items-center gap-1.5 text-sm">
                    <span className="truncate">{declarada}</span>
                    {mudou && (
                      <>
                        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="creditada a" />
                        <span className="truncate font-medium text-heading">{atribuida}</span>
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem indicação</p>
                )}
              </div>

              <div className="row-span-2 flex items-center gap-1 justify-self-end md:row-span-1">
                {/* No celular o selo apertaria o nome; a seta "→ nome" já mostra para quem foi o crédito. */}
                <span className="hidden sm:inline-flex">
                  <RegraBadge regra={s.regra_aplicada} />
                </span>
                <AcoesTelefone e164={s.phone_e164} nome={s.nome} />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
````

### D.21 — `src/admin/components/RegraBadge.tsx`

**Nota.** Selo com **ponto colorido e texto na cor de texto** (a identidade nunca depende só da cor). No destino, troque os estados pelos do seu nicho (ex.: status do pedido) usando `viz-1/2/3`, `muted` e `ok/aviso/erro`. `ACAO_ROTULO` e `REGRA_DESCRICAO` são do nicho.

````tsx
import type { AcaoAudit, Regra } from '@/data/types'

export const REGRA_ROTULO: Record<Regra, string> = {
  nenhuma: 'Nenhuma',
  padrao: 'Padrão',
  direta: 'Direta',
  cota: 'Cota',
  manual: 'Manual',
}

export const REGRA_DESCRICAO: Record<Regra, string> = {
  nenhuma: 'Sem indicação',
  padrao: 'Creditada a quem foi digitado',
  direta: 'Digitou o alvo (ou algo parecido)',
  cota: 'Regra da casa: a cada N de terceiros',
  manual: 'Ajuste feito por um administrador',
}

export const ACAO_ROTULO: Record<AcaoAudit, string> = {
  atribuicao: 'Atribuição',
  manual: 'Edição manual',
  recalculo: 'Recálculo',
  regra: 'Regra alterada',
  evento: 'Evento alterado',
  status: 'Formulário pausado/reaberto',
  mescla: 'Mescla de nomes',
  anonimizacao: 'Anonimização (LGPD)',
  cadastro_manual: 'Cadastro feito no painel',
  edicao: 'Dados corrigidos no painel',
  exclusao: 'Cadastro excluído no painel',
}

// A cor fica no ponto e no fundo; o texto continua na cor de texto (a identidade nunca depende só da cor).
// Direta e cota são as duas formas de crédito ao alvo: azul (digitou o alvo) e laranja (regra da cota).
const ESTILO: Record<Regra, { caixa: string; ponto: string }> = {
  nenhuma: { caixa: 'border-transparent bg-muted text-muted-foreground', ponto: 'bg-muted-foreground/60' },
  padrao: { caixa: 'border-border bg-transparent text-foreground', ponto: 'bg-foreground/40' },
  direta: { caixa: 'border-viz-1/40 bg-viz-1/10 text-foreground', ponto: 'bg-viz-1' },
  cota: { caixa: 'border-viz-2/45 bg-viz-2/10 text-foreground', ponto: 'bg-viz-2' },
  manual: { caixa: 'border-viz-3/40 bg-viz-3/10 text-foreground', ponto: 'bg-viz-3' },
}

export function RegraBadge({ regra }: { regra: Regra }) {
  const estilo = ESTILO[regra]
  return (
    <span
      title={REGRA_DESCRICAO[regra]}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${estilo.caixa}`}
    >
      <span className={`size-1.5 rounded-full ${estilo.ponto}`} aria-hidden="true" />
      {REGRA_ROTULO[regra]}
    </span>
  )
}
````

### D.22 — `src/admin/components/AcoesTelefone.tsx`

**Nota.** Ações de contato (WhatsApp e copiar). **Só se o seu painel já tem esse fluxo** (R14). Mostra o padrão `Tooltip` + `Button ghost icon-sm` + `toast`.

````tsx
import { CopyIcon, MessageCircleIcon } from 'lucide-react'
import type { MouseEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Abrir a conversa no WhatsApp e copiar o número (E.164, cola em qualquer app). Some quando o envio foi anonimizado. */
export function AcoesTelefone({ e164, nome }: { e164: string | null; nome: string | null }) {
  if (!e164) return null
  const quem = nome ?? 'esta pessoa'
  // Os botões ficam dentro de linhas clicáveis: o clique não pode abrir a ficha do envio.
  const parar = (e: MouseEvent) => e.stopPropagation()

  async function copiar(e: MouseEvent) {
    parar(e)
    try {
      await navigator.clipboard.writeText(e164!)
      toast.success('Telefone copiado', { description: e164! })
    } catch {
      toast.error('Não foi possível copiar. Selecione o número e copie à mão.')
    }
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm" onClick={parar}>
            <a href={`https://wa.me/${e164.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir conversa no WhatsApp com ${quem}`}>
              <MessageCircleIcon />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Abrir no WhatsApp</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={(e) => void copiar(e)} aria-label={`Copiar o telefone de ${quem}`}>
            <CopyIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copiar telefone</TooltipContent>
      </Tooltip>
    </span>
  )
}
````

### D.23 — `src/admin/components/LocalDoEncontro.tsx`

**Nota.** Cartão largo de contexto (texto à esquerda, mapa à direita). **Opcional** (6.2). Importa helpers de coordenadas (`local-do-encontro.ts`, omitido por ser do nicho). **Mantém a forma:** `grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]`, rótulo `text-xs uppercase tracking-[0.12em]`, mini-cartões `rounded-xl bg-muted/60 p-3`.

````tsx
import { ExternalLinkIcon, MapPinIcon, NavigationIcon } from 'lucide-react'
import {
  coordenadasDecimais,
  coordenadasGms,
  linkGoogleMaps,
  linkOpenStreetMap,
  localDoEvento,
  mapaIncorporado,
  temCoordenadas,
} from '@/admin/lib/local-do-encontro'
import type { EventRecord } from '@/data/types'

/** Cartão do local do encontro: endereço, coordenadas e o mapa do OpenStreetMap com o marcador. */
export function LocalDoEncontroCard({ evento, total }: { evento: Pick<EventRecord, 'local'>; total: number }) {
  const local = localDoEvento(evento)
  if (!temCoordenadas(local)) {
    return (
      <section aria-label="Local do encontro" className="rounded-2xl border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Local do encontro</p>
        <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-heading">
          <MapPinIcon className="size-5 text-viz-1" aria-hidden="true" />
          {local.nome}
        </p>
      </section>
    )
  }
  const { latitude: lat, longitude: lon } = local
  return (
    <section aria-label="Local do encontro" className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
      <div className="flex flex-col justify-between gap-5 p-5 md:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Local do encontro</p>
          <p className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-heading">
            <MapPinIcon className="size-6 text-viz-1" aria-hidden="true" />
            {local.nome}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {local.endereco} · {local.bairro}
            <br />
            {local.cidade} – {local.uf} · CEP {local.cep}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Latitude, longitude</dt>
            <dd className="mt-1 font-mono text-xs text-heading">{coordenadasDecimais(lat, lon)}</dd>
          </div>
          <div className="rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Graus</dt>
            <dd className="mt-1 font-mono text-xs text-heading">{coordenadasGms(lat, lon)}</dd>
          </div>
          <div className="col-span-2 rounded-xl bg-muted/60 p-3">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Cadastros no local</dt>
            <dd className="mt-1 text-heading">
              <strong className="text-lg font-semibold">{total.toLocaleString('pt-BR')}</strong>{' '}
              <span className="text-xs text-muted-foreground">{total === 1 ? 'pessoa cadastrada' : 'pessoas cadastradas'} no encontro</span>
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <a
            href={linkGoogleMaps(lat, lon)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white shadow-sm outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ backgroundImage: 'var(--gradiente-acao)' }}
          >
            <NavigationIcon className="size-4" aria-hidden="true" /> Abrir no Google Maps
          </a>
          <a
            href={linkOpenStreetMap(lat, lon)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ExternalLinkIcon className="size-4" aria-hidden="true" /> OpenStreetMap
          </a>
        </div>
      </div>
      <div className="relative min-h-60 border-t md:border-l md:border-t-0">
        <iframe
          title={`Mapa: ${local.nome}, ${local.cidade} – ${local.uf}`}
          src={mapaIncorporado(lat, lon)}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="mapa-tema absolute inset-0 size-full border-0"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-card/85 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
          © OpenStreetMap
        </span>
      </div>
    </section>
  )
}
````

### D.24 — Ficha lateral (trechos de `src/admin/components/SubmissionSheet.tsx`)

**Nota.** **Trechos (não compila sozinho)** do casco da ficha: `Linha`, `Passo`, a linha do tempo, `Secao`, e o cabeçalho com avatar, título, descrição, contato e a 1ª seção. As demais seções são do nicho (Instagram, local, aparelho, crédito, auditoria, LGPD). Ver 6.5.

````tsx
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function Passo({ rotulo, quando, delta }: { rotulo: string; quando: string; delta?: string }) {
  return (
    <li className="relative">
      <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 size-2.5 rounded-full bg-viz-1 ring-4 ring-background" />
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-heading">{rotulo}</span>
        {delta && <span className="text-xs tabular-nums text-muted-foreground">{delta}</span>}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">{quando}</p>
    </li>
  )
}

// [...]

/** Do QR ao cadastro: quando leu o QR (ou abriu o link), quando começou o formulário e quando concluiu. */
function Jornada({ lido, iniciado, enviado, origem, tz }: { lido: string | null; iniciado: string | null; enviado: string; origem: string | null; tz: string }) {
  if (!lido) {
    return <p className="text-sm text-muted-foreground">Cadastro sem leitura registrada (feito sem passar pela leitura do QR ou pelo link).</p>
  }
  const ms = (de: string, ate: string) => Date.parse(ate) - Date.parse(de)
  const viaLink = origem === 'outro'
  return (
    <>
      <ol className="ml-2 space-y-3 border-l border-border pl-4">
        <Passo rotulo={viaLink ? 'Abriu o link' : 'Leu o QR'} quando={formatDateTime(lido, tz)} />
        {iniciado && <Passo rotulo="Começou o cadastro" quando={formatDateTime(iniciado, tz)} delta={`+${formatarDuracao(ms(lido, iniciado))}`} />}
        <Passo rotulo="Concluiu" quando={formatDateTime(enviado, tz)} delta={`+${formatarDuracao(ms(iniciado ?? lido, enviado))}`} />
      </ol>
      <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm font-medium text-heading">
        {`${viaLink ? 'Da abertura ao cadastro' : 'Do QR ao cadastro'}: ${formatarDuracao(ms(lido, enviado))}`}
      </p>
    </>
  )
}

// [...]

function Secao({ titulo, children, id }: { titulo: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

// [...]

  return (
    <Sheet open={envio !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {envio && (
          <>
            <SheetHeader className="border-b bg-muted/40">
              <div className="flex items-center gap-3.5 pr-6">
                <Iniciais nome={envio.nome} tamanho="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{envio.anonimizado_em ? 'Envio anonimizado' : envio.nome}</SheetTitle>
                  <SheetDescription>
                    Cadastro nº {envio.id} · {formatDateTime(envio.created_at, tz)}
                  </SheetDescription>
                  {envio.phone_e164 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-sm tabular-nums text-heading">
                      {formatPhoneDisplay(envio.phone_e164)}
                      <AcoesTelefone e164={envio.phone_e164} nome={envio.nome} />
                    </p>
                  )}
                </div>
              </div>
              {canWrite && !envio.anonimizado_em && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                    <PencilIcon /> Editar dados
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setExcluindo(true)}>
                    <Trash2Icon /> Excluir cadastro
                  </Button>
                </div>
              )}
            </SheetHeader>
            {editando && <EditarPessoa envio={envio} onFechar={() => setEditando(false)} />}
            {excluindo && <ExcluirPessoa envio={envio} onFechar={() => setExcluindo(false)} onExcluida={onClose} />}

            <div className="space-y-6 px-4 pb-6">
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como enviado</h3>
                <dl className="divide-y">
                  <Linha rotulo="Enviado em">{formatDateTime(envio.created_at, tz)}</Linha>
                  <Linha rotulo="Enviado em (UTC)">
                    <span className="font-mono text-xs">{envio.created_at}</span>
                  </Linha>
                  <Linha rotulo="Nome">{envio.nome ?? '— anonimizado —'}</Linha>
                  <Linha rotulo="Telefone">{envio.phone_e164 ? formatPhoneDisplay(envio.phone_e164) : '— anonimizado —'}</Linha>
                  {envio.extras?.email && <Linha rotulo="E-mail">{envio.extras.email}</Linha>}
                  {genero && <Linha rotulo="Gênero">{genero}</Linha>}
                  {envio.extras?.idade != null && <Linha rotulo="Idade">{envio.extras.idade}</Linha>}
                  <Linha rotulo="Indicação declarada">{envio.indicacao_declarada ?? <span className="text-muted-foreground">(vazia)</span>}</Linha>
                  <Linha rotulo="Consentimento">Versão {envio.consent_version} da política</Linha>
                </dl>
              </section>

// [...]

            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
````

### D.25 — Relógio e recorte de período (`src/admin/components/PeriodFilter.tsx`, só o que a Visão geral usa)

**Nota.** Só o que a Visão geral usa: `Periodo`, `useAgora` (relógio de 30 s) e `intervaloDoPeriodo` (converte a escolha em `{ from, to }` ISO no fuso do negócio). O componente `PeriodFilter` (com `Select`) é de outras telas e foi omitido.

````tsx
import { useEffect, useState } from 'react'
import { lastHourUtc, startOfTodayUtc, zonedLocalToUtc } from '@/domain/time'

export type Periodo = 'tudo' | 'hora' | 'hoje' | 'intervalo'

/** "Agora" que anda sozinho, para "última hora" e "hoje" continuarem certos com a tela aberta. */
export function useAgora(intervaloMs = 30_000): string {
  const [agora, setAgora] = useState(() => new Date().toISOString())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date().toISOString()), intervaloMs)
    return () => clearInterval(t)
  }, [intervaloMs])
  return agora
}

/** Converte a escolha em {from, to} ISO, sempre no fuso do evento. */
export function intervaloDoPeriodo(p: Periodo, agora: string, tz: string, de: string, ate: string): { from?: string; to?: string } | undefined {
  if (p === 'hora') return { from: lastHourUtc(agora) }
  if (p === 'hoje') return { from: startOfTodayUtc(agora, tz) }
  if (p === 'intervalo') {
    return {
      from: de ? zonedLocalToUtc(de, tz) : undefined,
      to: ate ? new Date(Date.parse(zonedLocalToUtc(ate, tz)) + 59_999).toISOString() : undefined,
    }
  }
  return undefined
}
````

### D.26 — `src/admin/components/FiltroPainel.tsx`

**Nota.** Linha única de filtros acima de tudo o que ela recorta; controle segmentado (`radiogroup`); `semOrigem` esconde a 2ª dimensão. As opções ("Tudo / Hoje / Última hora / Intervalo" e "Todas / QR / Link") são do nicho.

````tsx
import { XIcon } from 'lucide-react'
import type { FiltroUrl } from '@/admin/lib/filtro-painel'
import type { Periodo } from '@/admin/components/PeriodFilter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Origem } from '@/data/types'

const PERIODOS: Array<{ valor: Periodo; rotulo: string }> = [
  { valor: 'tudo', rotulo: 'Tudo' },
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'hora', rotulo: 'Última hora' },
  { valor: 'intervalo', rotulo: 'Intervalo' },
]

const ORIGENS: Array<{ valor: Origem | null; rotulo: string }> = [
  { valor: null, rotulo: 'Todas' },
  { valor: 'qr', rotulo: 'QR' },
  { valor: 'outro', rotulo: 'Link' },
]

function Segmentos<T extends string | null>({
  rotulo,
  opcoes,
  valor,
  onChange,
}: {
  rotulo: string
  opcoes: Array<{ valor: T; rotulo: string }>
  valor: T
  onChange(v: T): void
}) {
  return (
    <div role="radiogroup" aria-label={rotulo} className="inline-flex rounded-xl border bg-card p-0.5">
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            key={String(o.valor)}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.valor)}
            className={`h-8 rounded-[0.6rem] px-3 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring/60 ${
              ativo ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {o.rotulo}
          </button>
        )
      })}
    </div>
  )
}

/** Uma linha de filtros acima de tudo o que ela recorta: período (no fuso do evento) e origem da visita. */
export function FiltroPainel({
  valor,
  erro,
  ativo,
  onMudar,
  onLimpar,
  semOrigem = false,
}: {
  valor: FiltroUrl
  erro: string | null
  ativo: boolean
  onMudar(parcial: Partial<FiltroUrl>): void
  onLimpar(): void
  semOrigem?: boolean
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Segmentos rotulo="Período" opcoes={PERIODOS} valor={valor.periodo} onChange={(periodo) => onMudar({ periodo })} />
      {valor.periodo === 'intervalo' && (
        <span className="flex flex-wrap items-center gap-1.5">
          <Input
            type="datetime-local"
            aria-label="Início do intervalo"
            value={valor.de}
            onChange={(e) => onMudar({ de: e.target.value })}
            className="h-9 w-[12.5rem]"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="datetime-local"
            aria-label="Fim do intervalo"
            value={valor.ate}
            onChange={(e) => onMudar({ ate: e.target.value })}
            className="h-9 w-[12.5rem]"
          />
        </span>
      )}
      {!semOrigem && <Segmentos rotulo="Origem" opcoes={ORIGENS} valor={valor.origem} onChange={(origem) => onMudar({ origem })} />}
      {ativo && (
        <Button variant="ghost" size="sm" onClick={onLimpar}>
          <XIcon /> Limpar filtros
        </Button>
      )}
      {erro && (
        <p role="alert" className="w-full text-sm font-medium text-destructive">
          {erro}
        </p>
      )}
    </div>
  )
}
````

### D.27 — `src/admin/lib/filtro-painel.ts`

**Nota.** Filtro na URL (`?periodo=&de=&ate=&origem=`) com conversão para ISO no fuso do negócio e validação do intervalo; `horaComoIntervalo` transforma a hora clicada no gráfico em `de` e `ate`. Importa `DashboardFilter` de `dashboard.ts`.

````ts
// Filtro do painel no endereço (?periodo=&de=&ate=&origem=): vale para a tela toda e acompanha o link compartilhado.
// "de" e "ate" ficam no horário local do evento (como o campo datetime-local), a conversão para UTC é feita aqui.
import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { intervaloDoPeriodo, useAgora, type Periodo } from '@/admin/components/PeriodFilter'
import type { Origem } from '@/data/types'
import type { DashboardFilter } from '@/domain/dashboard'

export interface FiltroUrl {
  periodo: Periodo
  de: string
  ate: string
  origem: Origem | null
}

const PERIODOS: Periodo[] = ['tudo', 'hoje', 'hora', 'intervalo']

export function lerFiltro(params: URLSearchParams): FiltroUrl {
  const periodo = params.get('periodo') as Periodo | null
  const origem = params.get('origem')
  return {
    periodo: periodo && PERIODOS.includes(periodo) ? periodo : 'tudo',
    de: params.get('de') ?? '',
    ate: params.get('ate') ?? '',
    origem: origem === 'qr' || origem === 'outro' ? origem : null,
  }
}

/** Grava o filtro sem apagar os outros parâmetros do endereço. */
export function escreverFiltro(atual: URLSearchParams, f: FiltroUrl): URLSearchParams {
  const p = new URLSearchParams(atual)
  for (const chave of ['periodo', 'de', 'ate', 'origem']) p.delete(chave)
  if (f.periodo !== 'tudo') p.set('periodo', f.periodo)
  if (f.periodo === 'intervalo' && f.de) p.set('de', f.de)
  if (f.periodo === 'intervalo' && f.ate) p.set('ate', f.ate)
  if (f.origem) p.set('origem', f.origem)
  return p
}

/** Converte a escolha em recorte ISO; um intervalo invertido vira erro (nada de métrica enganosa em silêncio). */
export function recorte(f: FiltroUrl, agoraIso: string, tz: string): { filtro: DashboardFilter; erro: string | null } {
  const intervalo = intervaloDoPeriodo(f.periodo, agoraIso, tz, f.de, f.ate) ?? {}
  if (intervalo.from && intervalo.to && Date.parse(intervalo.from) > Date.parse(intervalo.to)) {
    return { filtro: { origem: f.origem ?? undefined }, erro: 'O início do intervalo é depois do fim.' }
  }
  return { filtro: { ...intervalo, origem: f.origem ?? undefined }, erro: null }
}

/** 'yyyy-MM-dd HH' (hora do gráfico, no fuso do evento) → intervalo daquela hora para os campos datetime-local. */
export function horaComoIntervalo(hora: string): Pick<FiltroUrl, 'de' | 'ate'> {
  const [data, hh] = hora.split(' ')
  return { de: `${data}T${hh}:00`, ate: `${data}T${hh}:59` }
}

export const filtroAtivo = (f: FiltroUrl) => f.periodo !== 'tudo' || f.origem !== null

export function useFiltroPainel(tz: string) {
  const [params, setParams] = useSearchParams()
  const agora = useAgora()
  const valor = lerFiltro(params)
  const { filtro, erro } = useMemo(
    () => recorte(valor, agora, tz),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valor.periodo, valor.de, valor.ate, valor.origem, agora, tz],
  )
  const mudar = (parcial: Partial<FiltroUrl>) => setParams((p) => escreverFiltro(p, { ...lerFiltro(p), ...parcial }), { replace: true })
  const limpar = () => setParams((p) => escreverFiltro(p, { periodo: 'tudo', de: '', ate: '', origem: null }), { replace: true })
  return { valor, filtro, erro, mudar, limpar, ativo: filtroAtivo(valor) }
}
````

### D.28 — `src/admin/layout/ThemeProvider.tsx`

**Nota.** Tema claro, escuro ou do sistema; padrão **escuro**; `color-scheme` acompanha. Troque a chave de `localStorage` (`captacao-tema`) pelo prefixo do projeto. Se o projeto já tem tema, reaproveite o dele.

````tsx
// Tema do painel: claro, escuro ou do sistema (o formulário público é sempre claro).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Tema = 'light' | 'dark' | 'system'

const CHAVE = 'captacao-tema'
const ContextoTema = createContext<{ tema: Tema; resolvido: 'light' | 'dark'; setTema(t: Tema): void }>({
  tema: 'dark',
  resolvido: 'dark',
  setTema: () => {},
})

/** O painel abre no modo noturno, salvo escolha explícita da pessoa (claro, escuro ou do sistema). */
function lerTema(): Tema {
  try {
    const t = localStorage.getItem(CHAVE)
    return t === 'light' || t === 'dark' || t === 'system' ? t : 'dark'
  } catch {
    return 'dark'
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTemaEstado] = useState<Tema>(lerTema)
  const [sistemaEscuro, setSistemaEscuro] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const ouvir = () => setSistemaEscuro(mq.matches)
    mq.addEventListener('change', ouvir)
    return () => mq.removeEventListener('change', ouvir)
  }, [])

  const resolvido = tema === 'system' ? (sistemaEscuro ? 'dark' : 'light') : tema

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvido === 'dark')
    document.documentElement.style.colorScheme = resolvido
  }, [resolvido])

  const setTema = (t: Tema) => {
    setTemaEstado(t)
    try {
      localStorage.setItem(CHAVE, t)
    } catch {
      // preferência só nesta aba
    }
  }

  return <ContextoTema.Provider value={{ tema, resolvido, setTema }}>{children}</ContextoTema.Provider>
}

export const useTheme = () => useContext(ContextoTema)
````

### D.29 — `src/admin/layout/LiveBadge.tsx`

**Nota.** Selo de conexão. **Troca de cor fixa por token** (`bg-ok`, `bg-aviso`, `bg-erro`). Só use se há canal ao vivo (R11).

````tsx
import type { LiveStatus } from '@/data/api'

const ROTULOS: Record<LiveStatus, { texto: string; cor: string; pulso: boolean }> = {
  ao_vivo: { texto: 'Ao vivo', cor: 'bg-ok', pulso: true },
  conectando: { texto: 'Conectando…', cor: 'bg-aviso', pulso: false },
  offline: { texto: 'Offline — reconectando', cor: 'bg-erro', pulso: false },
}

export function LiveBadge({ status }: { status: LiveStatus }) {
  const r = ROTULOS[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border bg-card/60 px-2.5 py-1 text-xs font-medium"
      role="status"
      aria-live="polite"
    >
      <span className="relative flex size-2" aria-hidden="true">
        {r.pulso && <span className={`absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping ${r.cor}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${r.cor}`} />
      </span>
      {r.texto}
    </span>
  )
}
````

### D.30 — `src/admin/layout/Topbar.tsx`

**Nota.** Barra superior (sticky, 56 px) com status, "atualizado há X" e botão de atualizar; `useHa` também alimenta o feed. São do nicho: o local do evento e o selo "Formulário aberto/pausado" (troque pelo contexto do seu negócio ou remova). `env.dataSource === 'mock'` só mostra "Modo local" na demonstração: remova no destino.

````tsx
import { MapPinIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LiveStatus } from '@/data/api'
import type { EventRecord } from '@/data/types'
import { localDoEvento, temCoordenadas } from '@/admin/lib/local-do-encontro'
import { formatHoraCompleta } from '@/domain/time'
import { env } from '@/env'
import { LiveBadge } from './LiveBadge'

/** "há 5 s", "há 3 min": anda sozinho a cada segundo enquanto a tela está aberta. */
export function useHa(iso: string | null | undefined): string | null {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!iso) return null
  const s = Math.max(0, Math.round((agora - Date.parse(iso)) / 1000))
  if (s < 5) return 'agora'
  if (s < 60) return `há ${s} s`
  const min = Math.floor(s / 60)
  if (min < 60) return `há ${min} min`
  return `há ${Math.floor(min / 60)} h`
}

interface Props {
  evento?: EventRecord
  status?: LiveStatus
  atualizadoEm?: string | null
  recarregando?: boolean
  erro?: Error | null
  onAtualizar?(): void
}

export function Topbar({ evento, status, atualizadoEm, recarregando, erro, onAtualizar }: Props) {
  const ha = useHa(atualizadoEm)
  const local = evento ? localDoEvento(evento) : null
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur-md md:px-6">
      <SidebarTrigger className="-ml-1" aria-label="Mostrar ou ocultar o menu" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-heading">{evento?.nome ?? 'Painel'}</p>
        {local && (
          <span className="hidden min-w-0 items-center gap-1 truncate text-xs text-muted-foreground lg:inline-flex">
            <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
            {temCoordenadas(local) ? `${local.nome} · ${local.cidade}, ${local.uf}` : local.nome}
          </span>
        )}
        {evento && (
          <Badge variant={evento.status === 'aberto' ? 'secondary' : 'destructive'} className="hidden shrink-0 sm:inline-flex">
            {evento.status === 'aberto' ? 'Formulário aberto' : 'Formulário pausado'}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {env.dataSource === 'mock' && (
          <Badge variant="outline" className="hidden sm:inline-flex">
            Modo local
          </Badge>
        )}
        {erro && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 px-2 py-1 text-xs text-destructive" role="alert">
                <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Falha ao atualizar</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{erro.message} — os dados na tela são os da última atualização.</TooltipContent>
          </Tooltip>
        )}
        {status && <LiveBadge status={status} />}
        {atualizadoEm && evento && (
          <span className="hidden text-xs tabular-nums text-muted-foreground md:inline" title={formatHoraCompleta(atualizadoEm, evento.fuso_horario)}>
            atualizado {ha}
          </span>
        )}
        {onAtualizar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={onAtualizar} disabled={recarregando} aria-label="Atualizar os dados agora">
                <RefreshCwIcon className={recarregando ? 'motion-safe:animate-spin' : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Atualizar agora</TooltipContent>
          </Tooltip>
        )}
      </div>
      {recarregando && <span className="painel-progresso" aria-hidden="true" />}
    </header>
  )
}
````

### D.31 — `src/admin/layout/AdminLayout.tsx`

**Nota.** Casco: `SidebarProvider` + `AppSidebar` + `SidebarInset` (com `atmosfera`) + `Topbar` + contêiner de 1600 px.

````tsx
import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type { LiveStatus } from '@/data/api'
import type { EventRecord } from '@/data/types'
import { AppSidebar } from './AppSidebar'
import { Topbar } from './Topbar'

interface Props {
  evento?: EventRecord
  status?: LiveStatus
  atualizadoEm?: string | null
  recarregando?: boolean
  erro?: Error | null
  onAtualizar?(): void
  children: ReactNode
}

export function AdminLayout({ evento, status, atualizadoEm, recarregando, erro, onAtualizar, children }: Props) {
  return (
    <SidebarProvider>
      <AppSidebar evento={evento} />
      <SidebarInset className="atmosfera min-w-0">
        <Topbar evento={evento} status={status} atualizadoEm={atualizadoEm} recarregando={recarregando} erro={erro} onAtualizar={onAtualizar} />
        <div className="mx-auto w-full min-w-0 max-w-[1600px] flex-1 px-4 pb-12 pt-5 md:px-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
````

### D.32 — `src/admin/layout/AppSidebar.tsx`

**Nota.** Menu lateral. Os grupos e itens (`GRUPOS`) são do nicho: use as rotas do seu painel e **mantenha a estrutura** (cabeçalho com seletor, grupos com rótulo, item ativo, rodapé com conta e tema). **Troca de cor fixa por token** (`shadow-primary/25`). Remova "Apagar cadastros locais" (modo demonstração).

````tsx
import {
  ChevronsUpDownIcon,
  GitMergeIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  QrCodeIcon,
  RotateCcwIcon,
  RouteIcon,
  ScaleIcon,
  SettingsIcon,
  SunIcon,
  TrophyIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useAuth } from '@/admin/auth/AuthProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { InstagramIcon } from '@/public/components/InstagramIcon'
import type { EventRecord } from '@/data/types'
import { useTheme, type Tema } from './ThemeProvider'

type Icone = LucideIcon | typeof InstagramIcon

const GRUPOS: Array<{ titulo: string; itens: Array<{ caminho: string; rotulo: string; icone: Icone }> }> = [
  {
    titulo: 'Acompanhar',
    itens: [
      { caminho: '', rotulo: 'Visão geral', icone: LayoutDashboardIcon },
      { caminho: 'participantes', rotulo: 'Pessoas', icone: UsersIcon },
      { caminho: 'ranking', rotulo: 'Ranking e pódio', icone: TrophyIcon },
      { caminho: 'jornada', rotulo: 'Jornada do QR', icone: RouteIcon },
      { caminho: 'instagram', rotulo: 'Instagram', icone: InstagramIcon },
    ],
  },
  {
    titulo: 'Gerenciar',
    itens: [
      { caminho: 'indicacoes', rotulo: 'Indicações', icone: GitMergeIcon },
      { caminho: 'qr', rotulo: 'QR do evento', icone: QrCodeIcon },
      { caminho: 'regra', rotulo: 'Regra de atribuição', icone: ScaleIcon },
      { caminho: 'configuracoes', rotulo: 'Configurações', icone: SettingsIcon },
      { caminho: 'auditoria', rotulo: 'Auditoria', icone: HistoryIcon },
    ],
  },
]

const TEMAS: Array<{ valor: Tema; rotulo: string; icone: typeof SunIcon }> = [
  { valor: 'light', rotulo: 'Claro', icone: SunIcon },
  { valor: 'dark', rotulo: 'Escuro', icone: MoonIcon },
  { valor: 'system', rotulo: 'Sistema', icone: MonitorIcon },
]

export function AppSidebar({ evento }: { evento?: EventRecord }) {
  const { api, session, sair } = useAuth()
  const { tema, setTema } = useTheme()
  const navegar = useNavigate()
  const local = useLocation()
  const [eventos, setEventos] = useState<EventRecord[]>([])

  useEffect(() => {
    api.listEvents().then(setEventos, () => setEventos([]))
  }, [api, evento?.id])

  const base = evento ? `/admin/e/${evento.slug}` : null
  const IconeTema = TEMAS.find((t) => t.valor === tema)?.icone ?? MonitorIcon

  async function resetar() {
    if (!api.resetDemo || !confirm('Apagar os cadastros salvos neste navegador (modo local, sem Supabase)? O evento volta ao estado inicial.')) return
    await api.resetDemo()
    toast.success('Cadastros locais apagados.')
    navegar('/admin')
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip="Trocar de evento">
                  <span
                    className="flex aspect-square size-8 items-center justify-center rounded-lg text-white shadow-md shadow-primary/25"
                    style={{ backgroundImage: 'var(--gradiente-corrente)' }}
                  >
                    <UsersRoundIcon className="size-4" />
                  </span>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold text-heading">{evento?.nome ?? 'Eventos'}</span>
                    <span className="truncate text-xs text-muted-foreground">{evento ? 'Painel do encontro' : 'Escolha um evento'}</span>
                  </span>
                  <ChevronsUpDownIcon className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start">
                <DropdownMenuLabel>Eventos</DropdownMenuLabel>
                {eventos.map((e) => (
                  <DropdownMenuItem key={e.id} onSelect={() => navegar(`/admin/e/${e.slug}`)}>
                    <span className="truncate">{e.nome}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navegar('/admin')}>Todos os eventos</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {base &&
          GRUPOS.map((grupo) => (
            <SidebarGroup key={grupo.titulo}>
              <SidebarGroupLabel>{grupo.titulo}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {grupo.itens.map((item) => {
                    const destino = item.caminho ? `${base}/${item.caminho}` : base
                    const ativo = item.caminho ? local.pathname.startsWith(destino) : local.pathname === base
                    return (
                      <SidebarMenuItem key={item.rotulo}>
                        <SidebarMenuButton asChild isActive={ativo} tooltip={item.rotulo}>
                          <NavLink to={destino} end={!item.caminho}>
                            <item.icone />
                            <span>{item.rotulo}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip="Conta e tema">
                  <span className="flex aspect-square size-8 items-center justify-center rounded-lg border bg-background text-xs font-semibold uppercase">
                    {session?.email.slice(0, 2)}
                  </span>
                  <span className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{session?.email}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {session?.papel === 'admin' ? 'Administrador' : 'Staff (somente leitura)'}
                    </span>
                  </span>
                  <IconeTema className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60" align="start" side="top">
                <DropdownMenuLabel>Tema</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={tema} onValueChange={(v) => setTema(v as Tema)}>
                  {TEMAS.map((t) => (
                    <DropdownMenuRadioItem key={t.valor} value={t.valor}>
                      <t.icone /> {t.rotulo}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {api.resetDemo && session?.papel === 'admin' && (
                  <DropdownMenuItem onSelect={() => void resetar()}>
                    <RotateCcwIcon /> Apagar cadastros locais
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void sair().then(() => navegar('/admin/login'))}>
                  <LogOutIcon /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
````

### D.33 — `src/admin/entry.tsx`

**Nota.** Montagem do painel: fonte, CSS, classe `painel` no `<html>`, `ThemeProvider` > `TooltipProvider` (300 ms) > `AuthProvider` > roteador, e `Toaster richColors closeButton`.

````tsx
// Bundle do painel administrativo.
import '@fontsource-variable/dm-sans/wght.css'
import './dashboard.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from './auth/AuthProvider'
import { ThemeProvider } from './layout/ThemeProvider'
import { router } from './router'

export function mount(elemento: HTMLElement) {
  document.title = 'Conecta — Painel do encontro'
  document.documentElement.classList.add('painel')
  createRoot(elemento).render(
    <StrictMode>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
          <Toaster richColors closeButton />
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}
````

### D.34 — `src/admin/pages/OverviewPage.tsx`

**Nota.** A **composição** da página: a grade `grid gap-4 md:grid-cols-2 xl:grid-cols-12` e os `col-span` de cada bloco (3.3), os `useMemo` com o recorte e as derivações, `abrirHora`, `useAgora`. **Mantenha a estrutura e as classes**; troque blocos e textos pelo seu nicho (6.2). São do nicho: `ranking`, `engagement`, `rule-text`, `PERFIS` e o componente local `Origens` (barra dividida em 2 segmentos, com respiro de 2 px).

````tsx
import { ArrowRightIcon, CalendarClockIcon, PercentIcon, QrCodeIcon, TargetIcon, UsersRoundIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { DistributionChart } from '@/admin/components/charts/DistributionChart'
import { Barras } from '@/admin/components/charts/Barras'
import { HourlyChart } from '@/admin/components/charts/HourlyChart'
import { RingGauge } from '@/admin/components/charts/RingGauge'
import { formatarNumero, formatarPct } from '@/admin/components/charts/scale'
import { Sparkline } from '@/admin/components/charts/Sparkline'
import { FeedAoVivo } from '@/admin/components/FeedAoVivo'
import { FiltroPainel } from '@/admin/components/FiltroPainel'
import { FunilJornada } from '@/admin/components/FunilJornada'
import { Bloco, KpiCard } from '@/admin/components/KpiCard'
import { LocalDoEncontroCard } from '@/admin/components/LocalDoEncontro'
import { NumeroAnimado } from '@/admin/components/NumeroAnimado'
import { useAgora } from '@/admin/components/PeriodFilter'
import { Podio } from '@/admin/components/Podio'
import { SubmissionSheet } from '@/admin/components/SubmissionSheet'
import { UltimosCadastros } from '@/admin/components/UltimosCadastros'
import { escreverFiltro, horaComoIntervalo, useFiltroPainel } from '@/admin/lib/filtro-painel'
import { criarNomeador, mapaDeMesclas } from '@/admin/lib/snapshot'
import { useEventData } from '@/admin/state/event-context'
import { computeJourney, selectDashboardData } from '@/domain/dashboard'
import { perfisPorCadastro, resumirConexoes } from '@/domain/engagement'
import { computeRanking } from '@/domain/ranking'
import { faltamParaCota } from '@/domain/rule-text'
import { computeOverview } from '@/domain/stats'
import { formatDiaDaSemana, formatHourMinute } from '@/domain/time'
import { PERFIS } from '@/public/perfis'

const USUARIOS = PERFIS.map((p) => p.usuario)

function LinkSecao({ para, children }: { para: string; children: ReactNode }) {
  return (
    <Link to={para} className="flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
      {children} <ArrowRightIcon className="size-3" aria-hidden="true" />
    </Link>
  )
}

/** Barra dividida QR × link (2px de respiro entre os segmentos). */
function Origens({ qr, outro }: { qr: number; outro: number }) {
  return (
    <div className="mt-4">
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {qr > 0 && <span className="h-full rounded-full bg-viz-1" style={{ flexGrow: qr }} />}
        {outro > 0 && <span className="h-full rounded-full bg-viz-2" style={{ flexGrow: outro }} />}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-viz-1" aria-hidden="true" />
          Pelo QR <strong className="font-semibold tabular-nums text-heading">{formatarNumero(qr)}</strong>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-viz-2" aria-hidden="true" />
          Pelo link <strong className="font-semibold tabular-nums text-heading">{formatarNumero(outro)}</strong>
        </span>
      </div>
    </div>
  )
}

export function OverviewPage() {
  const { snapshot } = useEventData()
  const { event: evento, rule: regra, aliases } = snapshot
  const base = `/admin/e/${evento.slug}`
  const tz = evento.fuso_horario
  const navegar = useNavigate()
  const filtro = useFiltroPainel(tz)
  const [aberto, setAberto] = useState<number | null>(null)
  // "Agora" que anda sozinho (a cada 30 s): a última hora e a data do cabeçalho continuam certas com a tela aberta.
  const agora = useAgora()

  const dados = useMemo(() => selectDashboardData(snapshot, filtro.filtro), [snapshot, filtro.filtro])
  const { submissions, views, clicks } = dados

  const visao = useMemo(
    () => computeOverview({ submissions, views, capacidade: evento.capacidade, tz, extras: evento.campos_extras }),
    [submissions, views, evento.capacidade, tz, evento.campos_extras],
  )
  const jornada = useMemo(() => computeJourney(snapshot, filtro.filtro), [snapshot, filtro.filtro])
  const ranking = useMemo(
    () => computeRanking(submissions, { mode: 'atribuida', rule: regra, aliases: mapaDeMesclas(aliases) }),
    [submissions, regra, aliases],
  )
  const conexoes = useMemo(() => resumirConexoes(submissions, perfisPorCadastro(snapshot.views, clicks), USUARIOS), [submissions, snapshot.views, clicks])
  const nomear = useMemo(() => criarNomeador(snapshot.submissions, regra), [snapshot.submissions, regra])
  const recentes = useMemo(() => [...submissions].sort((a, b) => b.id - a.id).slice(0, 8), [submissions])
  const acumulado = useMemo(() => visao.porHora.reduce<number[]>((soma, h) => [...soma, (soma.at(-1) ?? 0) + h.envios], []), [visao.porHora])
  const ultimaHora = useMemo(() => {
    const limite = Date.parse(agora) - 3_600_000
    return submissions.filter((s) => Date.parse(s.created_at) >= limite).length
  }, [submissions, agora])

  const doAlvo = ranking.find((l) => l.chave === regra.alvo)
  const lider = ranking[0]
  const ultimo = recentes[0]?.created_at ?? null
  const faltam = faltamParaCota(regra.contador, regra.n)
  const naVolta = regra.contador % regra.n
  const rastreamento = snapshot.tracking?.available !== false

  function abrirHora(hora: string) {
    const destino = escreverFiltro(new URLSearchParams(), { periodo: 'intervalo', ...horaComoIntervalo(hora), origem: filtro.valor.origem })
    navegar(`${base}/participantes?${destino.toString()}`)
  }

  return (
    <>
      <div className="mb-5 flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-viz-1">Encontro ao vivo</p>
        <h1 className="text-3xl font-semibold tracking-tight text-heading md:text-4xl">Visão geral</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <CalendarClockIcon className="size-4" aria-hidden="true" />
          {formatDiaDaSemana(agora, tz)} · atualiza sozinho a cada leitura, cadastro e clique · horários de {tz}
        </p>
      </div>

      <FiltroPainel valor={filtro.valor} erro={filtro.erro} ativo={filtro.ativo} onMudar={filtro.mudar} onLimpar={filtro.limpar} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <KpiCard
          destaque
          rotulo="Cadastros"
          icone={UsersRoundIcon}
          valor={<NumeroAnimado valor={visao.envios} />}
          detalhe={
            <>
              <strong className="font-semibold text-heading">+{formatarNumero(ultimaHora)}</strong> na última hora
              {ultimo && <> · último às {formatHourMinute(ultimo, tz)}</>}
            </>
          }
          lateral={
            <div className="hidden w-40 sm:block" aria-hidden="true">
              <Sparkline valores={acumulado} />
            </div>
          }
          className="md:col-span-2 xl:col-span-5"
        />
        <KpiCard
          rotulo="Leituras do QR e aberturas"
          icone={QrCodeIcon}
          valor={<NumeroAnimado valor={visao.aberturas.total} />}
          className="xl:col-span-3"
        >
          <Origens qr={visao.aberturas.qr} outro={visao.aberturas.outro} />
        </KpiCard>
        <KpiCard
          rotulo="Conversão"
          icone={PercentIcon}
          valor={jornada.conversao === null ? '—' : formatarPct(jornada.conversao)}
          detalhe={`${formatarNumero(jornada.convertidas)} de ${formatarNumero(jornada.visitas)} leituras viraram cadastro`}
          lateral={
            jornada.conversao !== null && (
              <RingGauge fracao={Math.min(1, jornada.conversao)} rotulo="Leituras que viraram cadastro">
                <UsersRoundIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              </RingGauge>
            )
          }
          className="xl:col-span-2"
        />
        <KpiCard
          rotulo={`Para ${regra.alvo_exibicao}`}
          icone={TargetIcon}
          valor={<NumeroAnimado valor={doAlvo?.total ?? 0} />}
          detalhe={
            <>
              {formatarNumero(doAlvo?.digitadas ?? 0)} digitaram · {formatarNumero(doAlvo?.cota ?? 0)} pela cota
              {doAlvo && doAlvo.manual > 0 && ` · ${formatarNumero(doAlvo.manual)} manuais`}
            </>
          }
          lateral={
            regra.ativa && (
              <RingGauge fracao={naVolta / regra.n} rotulo={`${naVolta} de ${regra.n} indicações de outras pessoas até a próxima cota`}>
                <span className="text-base font-semibold tabular-nums text-heading">{naVolta}</span>
                <span className="text-[10px] text-muted-foreground">de {regra.n}</span>
              </RingGauge>
            )
          }
          className="md:col-span-2 xl:col-span-2"
        >
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            {regra.ativa ? (
              <>
                1 a cada {regra.n} indicações de outras pessoas vai para {regra.alvo_exibicao}. Próxima em{' '}
                <strong className="font-semibold text-heading">{faltam}</strong>.
              </>
            ) : (
              'Regra da cota desativada: cada indicação fica com quem foi digitado.'
            )}
          </p>
        </KpiCard>

        <Bloco
          titulo="Atividade por hora"
          descricao="Cadastros e leituras do QR em cada hora. Clique numa hora para ver quem se cadastrou nela."
          className="md:col-span-2 xl:col-span-8"
        >
          <HourlyChart pontos={visao.porHora} onSelecionar={abrirHora} />
        </Bloco>

        <Bloco
          titulo="Pódio das indicações"
          descricao={lider ? `${lider.nome} lidera com ${lider.total} ${lider.total === 1 ? 'indicação' : 'indicações'}` : 'Quem mais trouxe gente para o encontro'}
          acao={<LinkSecao para={`${base}/ranking`}>Ranking</LinkSecao>}
          className="md:col-span-2 xl:col-span-4"
        >
          <div className="pt-6">
            <Podio linhas={ranking.slice(0, 3)} alvo={regra.alvo} compacto />
          </div>
          {ranking.length > 3 && (
            <ol className="mt-4 space-y-1.5 border-t pt-3 text-sm" start={4}>
              {ranking.slice(3, 6).map((l) => (
                <li key={l.chave} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-6 text-xs tabular-nums text-muted-foreground">{l.posicao}º</span>
                    <span className="truncate text-heading">{l.nome}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{l.total}</span>
                </li>
              ))}
            </ol>
          )}
        </Bloco>

        <Bloco titulo="Do QR ao cadastro" descricao="Leituras que começaram e concluíram, no mesmo recorte" className="xl:col-span-4">
          <FunilJornada jornada={jornada} />
        </Bloco>

        <Bloco
          titulo="Instagram"
          descricao={
            rastreamento
              ? conexoes.taxa === null
                ? 'Perfis abertos na tela de confirmação'
                : `${formatarPct(conexoes.taxa)} das pessoas abriram pelo menos um perfil`
              : 'Aguardando a atualização do banco para registrar os cliques'
          }
          acao={<LinkSecao para={`${base}/instagram`}>Detalhes</LinkSecao>}
          className="xl:col-span-4"
        >
          <Barras
            rotulo="Pessoas que abriram cada perfil"
            vazio="Ninguém abriu um perfil ainda."
            itens={conexoes.porPerfil.map((p) => {
              const perfil = PERFIS.find((x) => x.usuario === p.perfil)!
              return {
                chave: p.perfil,
                rotulo: perfil.nome,
                rotuloTexto: perfil.nome,
                total: p.total,
                fracao: p.fracao,
                inicio: <img src={perfil.foto} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full object-cover" />,
              }
            })}
          />
        </Bloco>

        <Bloco titulo="Ao vivo" descricao="O que acabou de acontecer no encontro" className="md:col-span-2 xl:col-span-4">
          <FeedAoVivo submissions={submissions} views={views} clicks={clicks} tz={tz} nomear={nomear} onAbrir={setAberto} />
        </Bloco>

        <Bloco
          titulo="Últimos cadastros"
          descricao="Quem acabou de chegar: horário, nome, telefone e indicação. Clique para ver a ficha completa."
          acao={<LinkSecao para={`${base}/participantes`}>Todas as pessoas</LinkSecao>}
          className="md:col-span-2 xl:col-span-12"
        >
          <UltimosCadastros envios={recentes} tz={tz} nomear={nomear} onAbrir={setAberto} />
        </Bloco>

        <div className="md:col-span-2 xl:col-span-12">
          <LocalDoEncontroCard evento={evento} total={snapshot.submissions.length} />
        </div>

        {visao.genero && (
          <Bloco titulo="Gênero" className="md:col-span-1 xl:col-span-6">
            <DistributionChart rotuloAcessivel="Distribuição por gênero" itens={visao.genero.map((g) => ({ rotulo: g.rotulo, total: g.total }))} />
          </Bloco>
        )}
        {visao.faixaEtaria && (
          <Bloco titulo="Faixa etária" className="md:col-span-1 xl:col-span-6">
            <DistributionChart rotuloAcessivel="Distribuição por faixa etária" itens={visao.faixaEtaria.map((f) => ({ rotulo: f.faixa, total: f.total }))} />
          </Bloco>
        )}
      </div>

      <SubmissionSheet envioId={aberto} onClose={() => setAberto(null)} />
    </>
  )
}
````

### D.35 — `src/domain/stats.ts`

**Nota.** Derivações da Visão geral: contagens, **série contínua por hora no fuso**, distribuições e jornada. `horasContinuas` e o rótulo `HHh` / `dd/MM HHh` valem para qualquer nicho; `genero`, `faixaEtaria`, `cotas` e `jornada` são do nicho.

````ts
// Números da Visão geral, calculados no navegador sobre o snapshot do evento.
import type { Regra } from './attribution'
import { hourBucket } from './time'
import { GENEROS, type CamposExtras, type Extras } from './validation'

export interface OverviewSubmission {
  created_at: string
  regra_aplicada: Regra
  extras: Extras | null
  /** Horário da leitura do QR (ou da abertura do link) ligada a este envio. */
  lido_em?: string | null
}

export interface OverviewView {
  created_at: string
  origem: 'qr' | 'outro'
  /** Quando o formulário foi aberto. */
  iniciado_em?: string | null
}

export interface HourPoint {
  /** 'yyyy-MM-dd HH' no fuso do evento. */
  hora: string
  rotulo: string
  envios: number
  aberturas: number
}

export interface Overview {
  aberturas: { total: number; qr: number; outro: number }
  envios: number
  /** envios ÷ aberturas; null sem aberturas. */
  conversao: number | null
  porHora: HourPoint[]
  capacidade: { limite: number; usados: number; pct: number } | null
  cotas: number
  diretas: number
  genero: Array<{ valor: string; rotulo: string; total: number }> | null
  faixaEtaria: Array<{ faixa: string; total: number }> | null
  /** Do QR ao cadastro: quantos leram, quantos começaram, quantos concluíram e o tempo mediano leitura → envio. */
  jornada: { leituras: number; comecaram: number; concluiram: number; medianaMs: number | null }
}

export const FAIXAS_ETARIAS = [
  { faixa: '< 18', ate: 17 },
  { faixa: '18–24', ate: 24 },
  { faixa: '25–34', ate: 34 },
  { faixa: '35–44', ate: 44 },
  { faixa: '45–54', ate: 54 },
  { faixa: '55+', ate: Infinity },
] as const

const QUINZE_MIN = 15 * 60 * 1000

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2
}

/** Horas contínuas (no fuso) entre o primeiro e o último instante. */
function horasContinuas(instantes: number[], tz: string): string[] {
  if (instantes.length === 0) return []
  const inicio = Math.min(...instantes)
  const fim = Math.max(...instantes)
  const horas: string[] = []
  const adicionar = (ms: number) => {
    const h = hourBucket(new Date(ms).toISOString(), tz)
    if (horas[horas.length - 1] !== h) horas.push(h)
  }
  for (let ms = inicio; ms < fim; ms += QUINZE_MIN) adicionar(ms)
  adicionar(fim)
  return horas
}

export function computeOverview(input: {
  submissions: OverviewSubmission[]
  views: OverviewView[]
  capacidade: number | null
  tz: string
  extras: CamposExtras
}): Overview {
  const { submissions, views, capacidade, tz, extras } = input

  const qr = views.filter((v) => v.origem === 'qr').length
  const aberturas = { total: views.length, qr, outro: views.length - qr }
  const envios = submissions.length

  const porHoraEnvios = new Map<string, number>()
  const porHoraAberturas = new Map<string, number>()
  const conta = (mapa: Map<string, number>, iso: string) => {
    const h = hourBucket(iso, tz)
    mapa.set(h, (mapa.get(h) ?? 0) + 1)
  }
  submissions.forEach((s) => conta(porHoraEnvios, s.created_at))
  views.forEach((v) => conta(porHoraAberturas, v.created_at))

  const horas = horasContinuas([...submissions, ...views].map((x) => Date.parse(x.created_at)), tz)
  const variosDias = horas.length > 0 && horas[0].slice(0, 10) !== horas[horas.length - 1].slice(0, 10)
  const porHora = horas.map((hora) => {
    const [data, hh] = hora.split(' ')
    const [, mes, dia] = data.split('-')
    return {
      hora,
      rotulo: variosDias ? `${dia}/${mes} ${hh}h` : `${hh}h`,
      envios: porHoraEnvios.get(hora) ?? 0,
      aberturas: porHoraAberturas.get(hora) ?? 0,
    }
  })

  const genero = extras.genero
    ? GENEROS.map((g) => ({
        valor: g.valor as string,
        rotulo: g.rotulo as string,
        total: submissions.filter((s) => s.extras?.genero === g.valor).length,
      }))
    : null

  let faixaEtaria: Overview['faixaEtaria'] = null
  if (extras.idade) {
    const totais = FAIXAS_ETARIAS.map(() => 0)
    for (const s of submissions) {
      const idade = s.extras?.idade
      if (idade == null) continue
      totais[FAIXAS_ETARIAS.findIndex((f) => idade <= f.ate)]++
    }
    faixaEtaria = FAIXAS_ETARIAS.map((f, i) => ({ faixa: f.faixa, total: totais[i] }))
  }

  return {
    aberturas,
    envios,
    conversao: aberturas.total > 0 ? envios / aberturas.total : null,
    porHora,
    capacidade: capacidade ? { limite: capacidade, usados: envios, pct: (envios / capacidade) * 100 } : null,
    cotas: submissions.filter((s) => s.regra_aplicada === 'cota').length,
    diretas: submissions.filter((s) => s.regra_aplicada === 'direta').length,
    genero,
    faixaEtaria,
    jornada: {
      leituras: views.length,
      comecaram: views.filter((v) => v.iniciado_em).length,
      concluiram: envios,
      medianaMs: mediana(
        submissions
          .filter((s) => s.lido_em)
          .map((s) => Date.parse(s.created_at) - Date.parse(s.lido_em!))
          .filter((ms) => ms >= 0),
      ),
    },
  }
}
````

### D.36 — `src/domain/dashboard.ts`

**Nota.** Trecho: o recorte (`DashboardFilter`, `dentroDoPeriodo`, `selectDashboardData`) e a taxa por coorte (`computeJourney`). A ideia vale para qualquer nicho: **cada coleção filtrada pelo seu próprio horário e pela 2ª dimensão; a conversão é da mesma coorte** (P2 e P6).

````ts
// Recortes e métricas do painel do encontro, calculados no navegador sobre o snapshot (funções puras).
import type { Dispositivo, EventSnapshot, Origem, ProfileClickRecord, SubmissionRecord, ViewRecord } from '@/data/types'

/** Recorte do painel: período (ISO, inclusivo) e origem da visita. */
export interface DashboardFilter {
  from?: string
  to?: string
  origem?: Origem
}

export const dentroDoPeriodo = (iso: string, f: DashboardFilter): boolean => {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) && ms >= (f.from ? Date.parse(f.from) : -Infinity) && ms <= (f.to ? Date.parse(f.to) : Infinity)
}

/** Visita ligada a cada cadastro (a leitura do QR ou a abertura do link que virou este cadastro). */
export function visitaPorCadastro(views: ViewRecord[]): Map<number, ViewRecord> {
  const mapa = new Map<number, ViewRecord>()
  for (const v of views) if (v.submission_id != null) mapa.set(v.submission_id, v)
  return mapa
}

/** Por onde o cadastro chegou: o que o servidor gravou no envio ou, em cadastros antigos, a visita ligada. */
export function origemDoCadastro(s: SubmissionRecord, visitas: Map<number, ViewRecord>): Origem | null {
  return s.origem ?? visitas.get(s.id)?.origem ?? null
}

/** Cadastros, visitas e cliques dentro do recorte: cada um pelo seu próprio horário e pela origem da visita. */
export function selectDashboardData(
  snapshot: Pick<EventSnapshot, 'submissions' | 'views' | 'tracking'>,
  filtro: DashboardFilter,
): { submissions: SubmissionRecord[]; views: ViewRecord[]; clicks: ProfileClickRecord[] } {
  const visitas = visitaPorCadastro(snapshot.views)
  const porId = new Map(snapshot.views.map((v) => [v.id, v]))
  const origemOk = (o: Origem | null | undefined) => !filtro.origem || o === filtro.origem
  return {
    submissions: snapshot.submissions.filter((s) => dentroDoPeriodo(s.created_at, filtro) && origemOk(origemDoCadastro(s, visitas))),
    views: snapshot.views.filter((v) => dentroDoPeriodo(v.created_at, filtro) && origemOk(v.origem)),
    clicks: (snapshot.tracking?.clicks ?? []).filter((c) => dentroDoPeriodo(c.created_at, filtro) && origemOk(porId.get(c.view_id)?.origem)),
  }
}

export interface Jornada {
  visitas: number
  iniciadas: number
  convertidas: number
  /** Cadastros ÷ visitas da mesma coorte; null sem visitas. */
  conversao: number | null
  /** Mediana da leitura ao envio, em ms. */
  medianaMs: number | null
}

export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const meio = Math.floor(ordenados.length / 2)
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2
}

/**
 * Jornada de uma coorte: as visitas que começaram no recorte e o que aconteceu com elas até o fim do recorte (sem fim,
 * tudo o que já chegou; o relógio deste aparelho não entra, porque os horários são do servidor).
 * Não divide cadastros sem visita por visitas: a conversão é sempre da mesma coorte.
 */
export function computeJourney(snapshot: Pick<EventSnapshot, 'submissions' | 'views'>, filtro: DashboardFilter): Jornada {
  const visitas = snapshot.views.filter((v) => dentroDoPeriodo(v.created_at, filtro) && (!filtro.origem || v.origem === filtro.origem))
  const limite = filtro.to ? Date.parse(filtro.to) : Infinity
  const envios = new Map(snapshot.submissions.map((s) => [s.id, s]))
  const duracoes: number[] = []
  let iniciadas = 0
  let convertidas = 0
  for (const v of visitas) {
    if (v.iniciado_em && Date.parse(v.iniciado_em) <= limite) iniciadas++
    const envio = v.submission_id == null ? undefined : envios.get(v.submission_id)
    if (envio && Date.parse(envio.created_at) <= limite) {
      convertidas++
      const ms = Date.parse(envio.created_at) - Date.parse(v.created_at)
      if (ms >= 0) duracoes.push(ms)
    }
  }
  return {
    visitas: visitas.length,
    iniciadas,
    convertidas,
    conversao: visitas.length ? convertidas / visitas.length : null,
    medianaMs: mediana(duracoes),
  }
}
````

### D.37 — `src/admin/state/event-store.ts`

**Nota.** **OPCIONAL**, só se o projeto **não** tem camada ao vivo (7.6): snapshot imutável, *upsert* por id, mudanças durante a carga reaplicadas, recargas coalescidas, erro com dados antigos preservados. **Não substitua** a camada existente por este arquivo.

````ts
// Snapshot do evento mantido ao vivo: carga inicial + mudanças do Realtime (ou do mock).
// Imutável a cada mudança, para o useSyncExternalStore do React perceber a troca.
import type { AdminApi, LiveStatus } from '@/data/api'
import type { ChangeEvent, EventSnapshot } from '@/data/types'

export interface EventStore {
  ready: Promise<void>
  getSnapshot(): EventSnapshot | null
  getStatus(): LiveStatus
  getError(): Error | null
  /** Última vez (ISO) que os dados mudaram: carga completa ou mudança recebida ao vivo. */
  getUpdatedAt(): string | null
  /** Uma recarga completa está em andamento (a tela mantém os dados anteriores enquanto isso). */
  isRefreshing(): boolean
  subscribe(cb: () => void): () => void
  /** Recarrega tudo do servidor. Chamadas simultâneas aproveitam a mesma recarga. */
  reload(): Promise<void>
  dispose(): void
}

function upsertPorId<T extends { id: number }>(lista: T[], item: T): T[] {
  const i = lista.findIndex((x) => x.id === item.id)
  if (i === -1) return [...lista, item]
  const copia = lista.slice()
  copia[i] = item
  return copia
}

type Aplicavel = Exclude<ChangeEvent, { type: 'RESYNC' } | { table: 'name_aliases' }>

/** Aplica uma mudança de linha ao snapshot (idempotente: reaplicar a mesma mudança não duplica nada). */
function aplicarNoSnapshot(s: EventSnapshot, c: Aplicavel): EventSnapshot {
  switch (c.table) {
    case 'form_submissions':
      return { ...s, submissions: upsertPorId(s.submissions, c.row) }
    case 'form_views':
      return { ...s, views: upsertPorId(s.views, c.row) }
    case 'attribution_rules':
      return { ...s, rule: c.row }
    case 'events':
      return { ...s, event: c.row }
    case 'social_profile_clicks': {
      const cliques = s.tracking?.clicks ?? []
      return { ...s, tracking: { available: true, clicks: upsertPorId(cliques, c.row) } }
    }
  }
}

const exigeRecarga = (c: ChangeEvent): c is Exclude<ChangeEvent, Aplicavel> =>
  // As mesclas mudam em bloco (e o DELETE do Realtime só traz a chave): recarrega.
  c.type === 'RESYNC' || c.table === 'name_aliases'

export function createEventStore(api: AdminApi, eventId: string): EventStore {
  let snapshot: EventSnapshot | null = null
  let status: LiveStatus = 'conectando'
  let erro: Error | null = null
  let atualizadoEm: string | null = null
  let recarregando = false
  let descartado = false
  /** Mudanças recebidas durante a carga em andamento: reaplicadas sobre o snapshot novo, que pode ser anterior a elas. */
  let recebidasNaCarga: Aplicavel[] | null = null
  let carga: Promise<void> | null = null
  /** Pediram outra recarga (RESYNC) com uma em andamento: ela pode ter lido o banco antes do que motivou o pedido. */
  let repetir = false
  const ouvintes = new Set<() => void>()

  const avisar = () => {
    for (const cb of ouvintes) cb()
  }

  async function executarCargas(): Promise<void> {
    do {
      repetir = false
      const recebidas: Aplicavel[] = []
      recebidasNaCarga = recebidas
      try {
        const novo = await api.loadSnapshot(eventId)
        if (descartado) return
        let s = novo
        for (const c of recebidas) s = aplicarNoSnapshot(s, c)
        snapshot = s
        erro = null
        atualizadoEm = new Date().toISOString()
      } catch (e) {
        if (descartado) return
        // Falhou: os dados anteriores continuam na tela (com as mudanças que chegaram) e o erro aparece.
        erro = e instanceof Error ? e : new Error(String(e))
      } finally {
        recebidasNaCarga = null
      }
    } while (repetir && !descartado)
  }

  function carregar(): Promise<void> {
    if (carga) return carga
    recarregando = true
    avisar()
    carga = executarCargas().finally(() => {
      carga = null
      recarregando = false
      if (!descartado) avisar()
    })
    return carga
  }

  function aplicar(c: ChangeEvent): void {
    if (descartado) return
    if (exigeRecarga(c)) {
      if (carga) repetir = true
      else void carregar()
      return
    }
    recebidasNaCarga?.push(c)
    if (!snapshot) return
    snapshot = aplicarNoSnapshot(snapshot, c)
    atualizadoEm = new Date().toISOString()
    avisar()
  }

  // A carga começa antes da inscrição: o que chegar pelo canal já encontra a fila da carga aberta.
  const ready = carregar()
  const cancelar = api.subscribe(eventId, aplicar, (s) => {
    status = s
    avisar()
  })

  return {
    ready,
    getSnapshot: () => snapshot,
    getStatus: () => status,
    getError: () => erro,
    getUpdatedAt: () => atualizadoEm,
    isRefreshing: () => recarregando,
    subscribe(cb) {
      ouvintes.add(cb)
      return () => ouvintes.delete(cb)
    },
    reload: carregar,
    dispose() {
      descartado = true
      cancelar()
      ouvintes.clear()
    },
  }
}
````

### D.38 — `tests/admin/charts.test.ts`

**Nota.** Teste das marcas "redondas" do eixo (valores esperados). Porte junto com `scale.ts`.

````ts
import { describe, expect, it } from 'vitest'
import { niceTicks } from '@/admin/components/charts/scale'

describe('niceTicks (eixo de contagens)', () => {
  it.each([
    [0, [0, 1]],
    [1, [0, 1]],
    [3, [0, 1, 2, 3]],
    [7, [0, 2, 4, 6, 8]],
    [23, [0, 10, 20, 30]],
    [100, [0, 25, 50, 75, 100]],
    [1234, [0, 500, 1000, 1500]],
  ])('máximo %i → %j', (max, esperado) => {
    expect(niceTicks(max)).toEqual(esperado)
  })
})
````

### D.39 — `tests/admin/hourly-chart.test.tsx`

**Nota.** Testes do gráfico: estado vazio sem valores inventados, teclado (foco mostra a última hora; setas percorrem) e tabela alternativa com os mesmos números. Porte e adapte os nomes das medidas.

````tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { HourlyChart } from '@/admin/components/charts/HourlyChart'

afterEach(() => cleanup())

describe('HourlyChart sem dados', () => {
  it('mostra a estrutura do gráfico (legenda e eixo) com a mensagem de espera, sem inventar valores', () => {
    render(<HourlyChart pontos={[]} />)
    expect(screen.getByText('Envios')).toBeInTheDocument()
    expect(screen.getByText('Aberturas')).toBeInTheDocument()
    expect(screen.getByText('Aguardando os primeiros cadastros.')).toBeInTheDocument()
    expect(screen.queryAllByRole('group')).toHaveLength(0)
  })
})

describe('HourlyChart com dados', () => {
  const pontos = [
    { hora: '2026-09-30 18', rotulo: '18h', envios: 3, aberturas: 5 },
    { hora: '2026-09-30 19', rotulo: '19h', envios: 0, aberturas: 1 },
    { hora: '2026-09-30 20', rotulo: '20h', envios: 7, aberturas: 9 },
  ]

  it('pelo teclado: o foco mostra a última hora e as setas percorrem as horas', async () => {
    render(<HourlyChart pontos={pontos} />)
    const grafico = screen.getByRole('img', { name: /Envios e aberturas por hora/ })
    act(() => grafico.focus())
    const dica = await screen.findByRole('tooltip')
    expect(dica).toHaveTextContent('20h')
    expect(dica).toHaveTextContent('7envios')
    expect(dica).toHaveTextContent('9aberturas')
    fireEvent.keyDown(grafico, { key: 'ArrowLeft' })
    expect(screen.getByRole('tooltip')).toHaveTextContent('19h')
    expect(screen.getByRole('tooltip')).toHaveTextContent('0envios')
  })

  it('traz a tabela com os mesmos números', () => {
    render(<HourlyChart pontos={pontos} />)
    const linhas = screen.getAllByRole('row').slice(1).map((tr) => tr.textContent)
    expect(linhas).toEqual(['18h35', '19h01', '20h79'])
  })
})
````
