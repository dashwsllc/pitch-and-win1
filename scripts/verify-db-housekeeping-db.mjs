// Banco descartavel (PGlite). Nada toca producao.
// Manutencao de retencao (db_housekeeping): apaga so registro de maquina vencido e protege tudo que ainda e lido, tem erro, esta em andamento,
// e referenciado por outra tabela ou foi decidido por uma pessoa. Cobre contagem sem apagar, limite de lote, cascata, falha isolada,
// permissoes, agendamento (inclusive os VACUUMs) e o job de 1 minuto que so chama a Edge Function quando ha o que retomar.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '../.verification.local/calendar-tools/node_modules/@electric-sql/pglite/dist/index.js'

const MIGRATION = readFileSync('supabase/migrations/20261021230000_db_housekeeping.sql', 'utf8').replace(/\r\n/g, '\n')
const db = new PGlite()
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const N = async (sql, params) => Number((await one(sql, params)).n)
const ago = days => `now() - interval '${days} days'`
async function rejects(fn, re) { await assert.rejects(Promise.resolve().then(fn), re) }

// Comando real do job meta-insights-resume (sem segredos: so le nomes do Vault).
const RESUME_CMD = `
     SELECT net.http_post(url:='https://x.supabase.co/functions/v1/meta-insights-sync',
       headers:=jsonb_build_object('Content-Type','application/json',
         'Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_cron_anon_key' LIMIT 1),
         'x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='meta_sync_cron_secret' LIMIT 1)),
       body:='{"resumeOnly": true}'::jsonb,timeout_milliseconds:=60000)
     WHERE (SELECT count(DISTINCT name)=2 FROM vault.decrypted_secrets WHERE name IN ('meta_cron_anon_key','meta_sync_cron_secret') AND length(decrypted_secret)>0);`

await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.meta_sync_runs(id uuid primary key default gen_random_uuid(),kind text not null,account_id text,status text not null,rows_synced integer,error_message text,
 started_at timestamptz not null default now(),finished_at timestamptz,request_params jsonb,level text,coverage_state text not null default 'legacy');
create table public.meta_capture_reviews(id uuid primary key default gen_random_uuid(),status text not null,reviewed_by uuid,updated_at timestamptz not null default now(),
 sync_run_id uuid not null references public.meta_sync_runs(id));
create table public.meta_import_batches(id uuid primary key default gen_random_uuid(),sync_run_id uuid references public.meta_sync_runs(id),
 replaced_by_review_id uuid references public.meta_capture_reviews(id));
create table public.meta_traffic_daily(id uuid primary key default gen_random_uuid(),sync_run_id uuid references public.meta_sync_runs(id),
 capture_review_id uuid references public.meta_capture_reviews(id));
create table public.meta_insights_pages(run_id uuid not null references public.meta_sync_runs(id),page_no integer not null,rows jsonb not null default '[]',primary key(run_id,page_no));
create table public.meta_capture_review_rows(review_id uuid not null references public.meta_capture_reviews(id),row_no integer not null,edited boolean not null default false,
 conflict_details jsonb,payload jsonb not null default '{}',primary key(review_id,row_no));
create table public.meta_audit_events(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),entity_type text not null,action text not null,origin text not null);
create table public.crm_context_outbox(event_id uuid primary key default gen_random_uuid(),source_lead_id uuid not null,source_revision bigint not null,state text not null,
 delivered_at timestamptz,unique(source_lead_id,source_revision));
create table public.crm_context_delivery_attempts(id bigserial primary key,event_id uuid not null references public.crm_context_outbox(event_id) on delete cascade);
create schema net; create table net._http_response(id bigserial primary key,status_code integer,created timestamptz default now());
create function net.http_post(url text,headers jsonb default '{}',body jsonb default '{}',timeout_milliseconds integer default 5000) returns bigint language sql as $$select 1::bigint$$;
create schema vault; create table vault.decrypted_secrets(name text,decrypted_secret text);
create schema cron;
create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,active boolean default true);
create table cron.job_run_details(runid bigserial primary key,jobid bigint,status text,start_time timestamptz,end_time timestamptz);
create function cron.schedule(n text,s text,c text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid$$;
create function cron.unschedule(j bigint) returns boolean language sql as $$delete from cron.job where jobid=j returning true$$;
create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null)
 returns void language sql as $$update cron.job set command=coalesce($3,command),schedule=coalesce($2,schedule),active=coalesce($6,active) where jobid=$1$$;`)
await db.query(`insert into cron.job(jobname,schedule,command) values('meta-insights-resume','* * * * *',$1)`, [RESUME_CMD])
await db.exec(MIGRATION)

const run = async (dry, batch = 10000) => (await one('select public.db_housekeeping($1,$2) r', [dry, batch])).r
const reset = () => db.exec(`truncate cron.job_run_details,public.meta_audit_events,public.meta_capture_review_rows,public.meta_insights_pages,public.meta_import_batches,public.meta_traffic_daily,
 public.meta_capture_reviews,public.meta_sync_runs,public.crm_context_delivery_attempts,public.crm_context_outbox,net._http_response cascade`)
const newRun = async ({ kind = 'leads_reconciliation', account = 'pageA', status = 'success', rows = 0, error = null, days = 5, discover = false, finished = true, level = null, coverage = 'legacy' }) =>
  (await one(`insert into public.meta_sync_runs(kind,account_id,status,rows_synced,error_message,started_at,finished_at,request_params,level,coverage_state)
   values($1,$2,$3,$4,$5,${ago(days)},${finished ? ago(days) : 'null'},$6::jsonb,$7,$8) returning id`, [kind, account, status, rows, error, JSON.stringify({ discover }), level, coverage])).id
const alive = async ids => new Set((await q('select id from public.meta_sync_runs where id=any($1::uuid[])', [ids])).map(r => r.id))
const aliveReviews = async ids => new Set((await q('select id from public.meta_capture_reviews where id=any($1::uuid[])', [ids])).map(r => r.id))

// ---------- instalacao: permissoes e agendamento (manutencao, VACUUM do cron e do pg_net) ----------
{
  for (const sig of ['public.db_housekeeping(boolean,integer)', 'public.db_housekeeping_run()'])
    for (const role of ['anon', 'authenticated', 'service_role'])
      assert.equal((await one(`select has_function_privilege('${role}','${sig}','EXECUTE') p`)).p, false, `${role} nao executa ${sig}`)
  const jobsNow = () => q(`select jobname,schedule,command,active from cron.job where jobname like 'db-%' order by jobname`)
  const expected = [
    { jobname: 'db-housekeeping', schedule: '17 6 * * *', command: 'SELECT public.db_housekeeping_run()', active: true },
    { jobname: 'db-vacuum-cron-history', schedule: '27 6 * * *', command: 'VACUUM cron.job_run_details', active: true },
    { jobname: 'db-vacuum-net-responses', schedule: '7 */6 * * *', command: 'VACUUM net._http_response', active: true }]
  assert.equal(JSON.stringify(await jobsNow()), JSON.stringify(expected), 'tres jobs: manutencao, VACUUM do historico do cron e VACUUM das respostas do pg_net')
  await db.exec(MIGRATION)
  assert.equal(JSON.stringify(await jobsNow()), JSON.stringify(expected), 'reaplicar nao duplica nenhum job')
  await rejects(() => run(false, 50), /Invalid housekeeping batch/); await rejects(() => run(false, 50001), /Invalid housekeeping batch/)
  await rejects(() => one('select public.db_housekeeping(false,null) r'), /Invalid housekeeping batch/)
}

// ---------- job de 1 minuto: so chama a Edge Function quando ha captura de insights a retomar ----------
{
  await reset()
  const cmd = async () => (await one(`select command from cron.job where jobname='meta-insights-resume'`)).command
  const c1 = await cmd()
  assert.equal((c1.match(/FROM public\.meta_sync_runs/g) || []).length, 1, 'a protecao entra uma vez')
  assert.match(c1, /status IN \('running','partial'\) AND level IS NOT NULL\);\s*$/, 'continua um unico comando terminado em ;')
  assert(c1.includes("body:='{\"resumeOnly\": true}'") && c1.includes('timeout_milliseconds:=60000'), 'o resto do comando segue igual')
  await db.exec(MIGRATION)
  assert.equal(await cmd(), c1, 'reaplicar nao acrescenta a protecao de novo')
  // comportamento: sem segredos nada sai (como antes); com segredos, so sai quando ha execucao running/partial de insights com nivel
  const fires = async () => (await q(c1)).length
  assert.equal(await fires(), 0, 'sem os segredos do Vault: nao chama (como antes)')
  await db.exec(`insert into vault.decrypted_secrets values('meta_cron_anon_key','a'),('meta_sync_cron_secret','b')`)
  assert.equal(await fires(), 0, 'nada a retomar: nao chama a Edge Function')
  await newRun({ kind: 'insights', level: 'campaign', status: 'success', days: 0.01 }); await newRun({ kind: 'leads_reconciliation', status: 'running', finished: false, days: 0.01 })
  await newRun({ kind: 'insights', level: null, status: 'partial', days: 0.01 })
  assert.equal(await fires(), 0, 'sucesso, execucao de leads e execucao sem nivel nao contam')
  await newRun({ kind: 'insights', level: 'adset', status: 'partial', days: 0.01 }); assert.equal(await fires(), 1, 'ha captura parcial: chama')
  await db.exec(`update public.meta_sync_runs set status='success' where level='adset'`); assert.equal(await fires(), 0)
  await newRun({ kind: 'insights', level: 'ad', status: 'running', finished: false, days: 0.01 }); assert.equal(await fires(), 1, 'em andamento: chama')
  await db.exec(`delete from vault.decrypted_secrets`)
  // comando que nao termina na clausula conhecida nao e alterado (e nao quebra a migration)
  await db.exec(`update cron.job set command='SELECT 1;' where jobname='meta-insights-resume'`)
  await db.exec(MIGRATION); assert.equal(await cmd(), 'SELECT 1;', 'comando desconhecido fica como esta')
  await db.exec(`delete from cron.job where jobname='meta-insights-resume'`); await db.exec(MIGRATION)
}

// ---------- batida de coracao vazia do worker de leads ----------
{
  await reset()
  const keep = [], drop = []
  // modo "false": ha execucoes recentes, entao as antigas e vazias podem sair
  const recent = await newRun({ days: 0.01 }); keep.push(recent)
  for (const d of [4, 5, 9, 20]) drop.push(await newRun({ days: d }))
  // modo "true" (descoberta): so existem antigas -> a mais recente fica (e a que a tela e os alertas leem), as demais saem
  const latestDiscover = await newRun({ days: 4, discover: true }); keep.push(latestDiscover)
  for (const d of [6, 8, 12]) drop.push(await newRun({ days: d, discover: true }))
  // outra conta: protecao e por conta e modo
  const otherAccountOnly = await newRun({ days: 30, account: 'pageB' }); keep.push(otherAccountOnly)
  // nunca saem: recente, com linhas, erro, parcial, em andamento, outro tipo, execucao com mensagem
  keep.push(await newRun({ days: 1 }), await newRun({ days: 10, rows: 3 }), await newRun({ days: 10, status: 'error', error: 'falhou', rows: 0 }),
    await newRun({ days: 10, status: 'partial' }), await newRun({ days: 10, status: 'running', finished: false }), await newRun({ days: 10, kind: 'insights' }),
    await newRun({ days: 10, error: 'aviso' }))
  // referenciadas por outra tabela: ficam (a chave estrangeira recusaria; a regra nem tenta)
  const withReview = await newRun({ days: 12 }), withBatch = await newRun({ days: 12 }), withDaily = await newRun({ days: 12 }), withPage = await newRun({ days: 5 }) // entre os prazos: a pagina fica (7 dias) e a execucao tambem
  await db.query(`insert into public.meta_capture_reviews(status,sync_run_id) values('pendente',$1)`, [withReview])
  await db.query('insert into public.meta_import_batches(sync_run_id) values($1)', [withBatch]); await db.query('insert into public.meta_traffic_daily(sync_run_id) values($1)', [withDaily])
  await db.query(`insert into public.meta_insights_pages(run_id,page_no) values($1,0)`, [withPage]); keep.push(withReview, withBatch, withDaily, withPage)

  const dry = await run(true)
  assert.equal(dry.dry_run, true); assert.equal(Number(dry.idle_heartbeats), drop.length, 'a contagem diz exatamente quantas saem')
  assert.equal((await alive([...keep, ...drop])).size, keep.length + drop.length, 'o modo so contagem nao apaga nada')
  const real = await run(false)
  assert.equal(Number(real.idle_heartbeats), drop.length); assert.deepEqual(real.errors, {})
  const left = await alive([...keep, ...drop])
  for (const id of keep) assert(left.has(id), 'foi apagada uma execucao que tinha de ficar: ' + id)
  for (const id of drop) assert(!left.has(id), 'sobrou uma batida vazia vencida: ' + id)
  assert.equal(Number((await run(false)).idle_heartbeats), 0, 'segunda passada nao muda nada')
}

// ---------- ruido de auditoria e eventos automaticos da captura ----------
{
  await reset()
  const ev = (days, entity, action, origin) => db.query(`insert into public.meta_audit_events(created_at,entity_type,action,origin) values(${ago(days)},$1,$2,$3)`, [entity, action, origin])
  for (let i = 0; i < 5; i++) await ev(40 + i, 'metrics_row', 'metric.updated', 'api')            // saem
  await ev(2, 'metrics_row', 'metric.updated', 'api'); await ev(29, 'metrics_row', 'metric.updated', 'api')   // recentes: ficam
  await ev(90, 'metrics_row', 'metric.updated', 'csv')                                             // outra origem: fica
  // eventos automaticos da captura: saem depois de 60 dias; entre 30 e 60 ficam
  for (const a of ['capture.prepared', 'capture.auto_approved']) { await ev(61, 'capture_review', a, 'api'); await ev(75, 'capture_review', a, 'api'); await ev(45, 'capture_review', a, 'api'); await ev(1, 'capture_review', a, 'api') }
  // decisoes de pessoa e outros dominios: sem prazo
  for (const [e, a] of [['metrics_row', 'metric.published'], ['metrics_row', 'metric.edited'], ['metrics_row', 'metric.removed'], ['capture_review', 'capture.aprovado'],
    ['capture_review', 'capture.rejeitado'], ['capture_review', 'capture.substituido'], ['lead', 'lead.received'], ['lead_wave', 'wave.approved'], ['lead', 'lead.approved']]) await ev(120, e, a, 'api')
  await ev(120, 'metrics_row', 'capture.prepared', 'api'); await ev(120, 'capture_review', 'capture.prepared', 'csv')   // outro tipo de entidade / outra origem: ficam
  const total = await N('select count(*) n from public.meta_audit_events')
  const dry = await run(true)
  assert.equal(Number(dry.audit_noise), 5); assert.equal(Number(dry.audit_capture), 4); assert.equal(await N('select count(*) n from public.meta_audit_events'), total)
  const real = await run(false)
  assert.equal(Number(real.audit_noise), 5); assert.equal(Number(real.audit_capture), 4)
  assert.equal(await N('select count(*) n from public.meta_audit_events'), total - 9, 'so as atualizacoes automaticas e os eventos automaticos vencidos saem')
  assert.equal(await N(`select count(*) n from public.meta_audit_events where created_at<${ago(100)}`), 11, 'toda auditoria de acao humana e de decisao fica, sem prazo (e os 2 de outro tipo/origem)')
  assert.equal(await N(`select count(*) n from public.meta_audit_events where action in('capture.prepared','capture.auto_approved') and entity_type='capture_review' and origin='api'`), 4, 'os de menos de 60 dias ficam')
}

// ---------- paginas brutas de captura concluida ----------
{
  await reset()
  const pagesOf = async (id, n) => { for (let i = 0; i < n; i++) await db.query('insert into public.meta_insights_pages(run_id,page_no) values($1,$2)', [id, i]) }
  const old = await newRun({ kind: 'insights', days: 10 }), fresh = await newRun({ kind: 'insights', days: 2 }), failed = await newRun({ kind: 'insights', days: 10, status: 'error', error: 'x' })
  const partial = await newRun({ kind: 'insights', days: 10, status: 'partial' }), running = await newRun({ kind: 'insights', days: 10, status: 'running', finished: false })
  await pagesOf(old, 3); await pagesOf(fresh, 2); await pagesOf(failed, 2); await pagesOf(partial, 1); await pagesOf(running, 1)
  assert.equal(Number((await run(true)).capture_pages), 3)
  assert.equal(Number((await run(false)).capture_pages), 3)
  const left = Object.fromEntries((await q('select run_id,count(*) n from public.meta_insights_pages group by 1')).map(r => [r.run_id, Number(r.n)]))
  assert.deepEqual(left, { [fresh]: 2, [failed]: 2, [partial]: 1, [running]: 1 }, 'so as paginas de captura concluida e antiga saem')
}

// ---------- candidatas de revisao decididas pelo sistema, e a propria revisao depois de 30 dias ----------
{
  await reset()
  const base = await newRun({ kind: 'insights', days: 1 })
  const review = async (status, days, by) => (await one(`insert into public.meta_capture_reviews(status,reviewed_by,updated_at,sync_run_id) values($1,$2,${ago(days)},$3) returning id`, [status, by, base])).id
  const rows = async (id, specs) => { let n = 0; for (const s of specs) await db.query('insert into public.meta_capture_review_rows(review_id,row_no,edited,conflict_details) values($1,$2,$3,$4::jsonb)', [id, n++, !!s.edited, s.conflict ? '{"reason":"x"}' : null]) }
  const user = '00000000-0000-4000-8000-000000000009'
  const auto = await review('aprovado', 10, null), replaced = await review('substituido', 10, null), human = await review('aprovado', 10, user), rejected = await review('rejeitado', 10, null)
  const pending = await review('pendente', 10, null), recent = await review('aprovado', 2, null)
  await rows(auto, [{}, {}, {}, { edited: true }, { conflict: true }]); await rows(replaced, [{}, {}]); await rows(human, [{}, {}]); await rows(rejected, [{}])
  await rows(pending, [{}, {}]); await rows(recent, [{}, {}])
  assert.equal(Number((await run(true)).review_rows), 5, 'conta 3 do automatico + 2 do substituido')
  assert.equal(Number((await run(false)).review_rows), 5)
  const by = Object.fromEntries((await q('select review_id,count(*) n from public.meta_capture_review_rows group by 1')).map(r => [r.review_id, Number(r.n)]))
  assert.deepEqual(by, { [auto]: 2, [human]: 2, [rejected]: 1, [pending]: 2, [recent]: 2 }, 'ficam: editada, em conflito, decisao humana, rejeitada, pendente e recente')
  assert.equal(await N('select count(*) n from public.meta_capture_reviews'), 6, 'com menos de 30 dias as revisoes em si ficam todas')
}
{
  await reset()
  const base = await newRun({ kind: 'insights', days: 1 })
  const review = async (status, days, by = null) => (await one(`insert into public.meta_capture_reviews(status,reviewed_by,updated_at,sync_run_id) values($1,$2,${ago(days)},$3) returning id`, [status, by, base])).id
  const row = async (id, edited = false, conflict = false) => db.query('insert into public.meta_capture_review_rows(review_id,row_no,edited,conflict_details) values($1,0,$2,$3::jsonb)', [id, edited, conflict ? '{"reason":"x"}' : null])
  const user = '00000000-0000-4000-8000-000000000009'
  const dropEmpty = await review('aprovado', 40), dropReplaced = await review('substituido', 45), dropWithPlainRows = await review('aprovado', 50)   // as linhas simples saem na mesma execucao
  await row(dropWithPlainRows)
  const keepEdited = await review('aprovado', 50), keepConflict = await review('substituido', 50), keepHuman = await review('aprovado', 50, user), keepRejected = await review('rejeitado', 50)
  await row(keepEdited, true); await row(keepConflict, false, true)
  const keepPending = await review('pendente', 50), keepRecent = await review('aprovado', 20), keepFact = await review('aprovado', 50), keepBatch = await review('aprovado', 50)
  await db.query('insert into public.meta_traffic_daily(capture_review_id) values($1)', [keepFact]); await db.query('insert into public.meta_import_batches(replaced_by_review_id) values($1)', [keepBatch])
  const dropIds = [dropEmpty, dropReplaced, dropWithPlainRows], keepIds = [keepEdited, keepConflict, keepHuman, keepRejected, keepPending, keepRecent, keepFact, keepBatch]
  const dry = await run(true)
  assert.equal(Number(dry.reviews), 2, 'a contagem so ve as ja sem linhas; a que ainda tem linha simples depende da regra anterior')
  assert.equal((await aliveReviews([...dropIds, ...keepIds])).size, dropIds.length + keepIds.length, 'contagem nao apaga')
  const real = await run(false)
  assert.equal(Number(real.review_rows), 1); assert.equal(Number(real.reviews), 3, 'na execucao real a cascata (linhas e depois a revisao) acontece junto'); assert.deepEqual(real.errors, {})
  const left = await aliveReviews([...dropIds, ...keepIds])
  for (const id of keepIds) assert(left.has(id), 'foi apagada uma revisao que tinha de ficar: ' + id)
  for (const id of dropIds) assert(!left.has(id), 'sobrou revisao do sistema vencida e sem linhas: ' + id)
  assert.equal(await N('select count(*) n from public.meta_capture_review_rows'), 2, 'as linhas editadas e em conflito seguem a revisao e ficam')
  assert.equal(Number((await run(false)).reviews), 0, 'segunda passada nao muda nada')
}

// ---------- execucoes de captura de insights ----------
{
  await reset()
  const keep = [], drop = []
  const ins = o => newRun({ kind: 'insights', status: 'success', coverage: 'complete', level: 'campaign', ...o })
  // grupo (A, campaign): a mais recente e a ultima completa ficam; as antigas sem referencia saem
  keep.push(await ins({ days: 31 }))                                     // ultima completa do grupo (so existem antigas)
  for (const d of [40, 50, 90]) drop.push(await ins({ days: d }))
  // grupo (A, adset): a mais recente e uma parcial nova; a ultima COMPLETA e antiga e tem de ficar
  const lastComplete = await ins({ days: 60, level: 'adset' }); keep.push(lastComplete)
  drop.push(await ins({ days: 70, level: 'adset' }))
  keep.push(await ins({ days: 2, level: 'adset', status: 'partial', coverage: 'partial', finished: false }))
  // grupo (C, campaign): dentro dos 30 dias ficam, mesmo as que nao sao a mais recente do grupo (prazo, nao protecao)
  keep.push(await ins({ days: 3, account: 'C' }), await ins({ days: 10, account: 'C' }), await ins({ days: 20, account: 'C' }), await ins({ days: 29, account: 'C' }))
  // grupo (B, ad): recentes, erro, parcial e em andamento ficam
  keep.push(await ins({ days: 5, account: 'B', level: 'ad' }), await ins({ days: 40, account: 'B', level: 'ad', status: 'error', error: 'falhou' }), await ins({ days: 41, account: 'B', level: 'ad', status: 'partial', coverage: 'partial' }))
  keep.push(await ins({ days: 45, account: 'B', level: 'ad', status: 'running', finished: false }))
  // com referencia ficam: revisao, lote, metrica publicada. A pagina bruta de uma captura concluida e velha sai primeiro (regra das paginas) e a execucao, ja sem referencia, sai na mesma passada
  const r = await ins({ days: 100 }), b = await ins({ days: 101 }), f = await ins({ days: 102 }), p = await ins({ days: 103 })
  await db.query(`insert into public.meta_capture_reviews(status,sync_run_id,updated_at) values('pendente',$1,now())`, [r]); await db.query('insert into public.meta_import_batches(sync_run_id) values($1)', [b])
  await db.query('insert into public.meta_traffic_daily(sync_run_id) values($1)', [f]); await db.query('insert into public.meta_insights_pages(run_id,page_no) values($1,0)', [p]); keep.push(r, b, f)
  // outro tipo de execucao nao e desta regra
  keep.push(await newRun({ kind: 'leads_reconciliation', days: 100, rows: 7 }))
  const dry = await run(true)
  assert.equal(Number(dry.insights_runs), drop.length, 'a contagem diz exatamente quantas saem')
  assert.equal((await alive([...keep, ...drop])).size, keep.length + drop.length, 'contagem nao apaga')
  const real = await run(false)
  assert.equal(Number(real.insights_runs), drop.length + 1, 'as de antes e a da pagina em cascata'); assert.deepEqual(real.errors, {})
  const left = await alive([...keep, ...drop, p])
  assert(!left.has(p), 'a execucao cujas paginas venceram sai na mesma passada'); assert.equal(await N('select count(*) n from public.meta_insights_pages where run_id=$1', [p]), 0)
  for (const id of keep) assert(left.has(id), 'foi apagada uma execucao que tinha de ficar: ' + id)
  for (const id of drop) assert(!left.has(id), 'sobrou execucao vencida e sem referencia: ' + id)
  assert.equal(Number((await run(false)).insights_runs), 0, 'segunda passada nao muda nada')
}

// ---------- ponte dash->VOXEN: so as revisoes superadas e ja entregues ----------
{
  await reset()
  const rev = (lead, n, state, days) => one(`insert into public.crm_context_outbox(source_lead_id,source_revision,state,delivered_at) values($1,$2,$3,${days == null ? 'null' : ago(days)}) returning event_id`, [lead, n, state])
  const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1', C = '00000000-0000-4000-8000-0000000000c1', D = '00000000-0000-4000-8000-0000000000d1', E = '00000000-0000-4000-8000-0000000000e1'
  const a = []; for (let n = 1; n <= 4; n++) a.push((await rev(A, n, 'delivered', 20)).event_id)    // 1..3 saem, a 4 e a mais recente
  const b1 = (await rev(B, 1, 'delivered', 40)).event_id                                            // unica do atleta: fica, por mais antiga que seja
  const c1 = (await rev(C, 1, 'delivered', 20)).event_id; const c2 = (await rev(C, 2, 'pending', null)).event_id   // superada por uma pendente: sai; a pendente fica
  const d1 = (await rev(D, 1, 'delivered', 5)).event_id; const d2 = (await rev(D, 2, 'delivered', 0.1)).event_id    // a 1 e recente: fica
  const e1 = (await rev(E, 1, 'blocked', null)).event_id; const e2 = (await rev(E, 2, 'delivered', 30)).event_id    // bloqueada nao sai (precisa de decisao); a 2 e a mais recente
  const F = '00000000-0000-4000-8000-0000000000f2'; const f1 = (await rev(F, 1, 'pending', 30)).event_id; const f2 = (await rev(F, 2, 'delivered', 1)).event_id   // so "entregue" conta, mesmo que a data de entrega esteja preenchida
  for (const id of [...a, b1, c1]) await db.query('insert into public.crm_context_delivery_attempts(event_id) values($1)', [id])
  const maxBefore = Object.fromEntries((await q('select source_lead_id,max(source_revision) m from public.crm_context_outbox group by 1')).map(r => [r.source_lead_id, Number(r.m)]))
  assert.equal(Number((await run(true)).crm_outbox), 4); assert.equal(await N('select count(*) n from public.crm_context_outbox'), 13, 'contagem nao apaga')
  const real = await run(false); assert.equal(Number(real.crm_outbox), 4); assert.deepEqual(real.errors, {})
  const left = new Set((await q('select event_id from public.crm_context_outbox')).map(r => r.event_id))
  for (const id of [a[3], b1, c2, d1, d2, e1, e2, f1, f2]) assert(left.has(id), 'foi apagada uma revisao que tinha de ficar: ' + id)
  for (const id of [a[0], a[1], a[2], c1]) assert(!left.has(id), 'sobrou revisao superada e ja entregue: ' + id)
  const maxAfter = Object.fromEntries((await q('select source_lead_id,max(source_revision) m from public.crm_context_outbox group by 1')).map(r => [r.source_lead_id, Number(r.m)]))
  assert.deepEqual(maxAfter, maxBefore, 'o numero da revisao mais recente de cada atleta nunca muda (e ele que da o proximo numero)')
  assert.equal(await N('select count(*) n from public.crm_context_delivery_attempts'), 2, 'os registros de tentativa saem junto com a revisao apagada (cascata)')
  assert.equal(Number((await run(false)).crm_outbox), 0, 'segunda passada nao muda nada')
}

// ---------- historico do cron e respostas do pg_net: tamanho visivel ----------
{
  await reset()
  for (const [s, e] of [[3, 3], [10, 9.9], [1, 1], [0.5, 0.4]]) await db.query(`insert into cron.job_run_details(jobid,status,start_time,end_time) values(1,'succeeded',${ago(s)},${ago(e)})`)
  await db.exec(`insert into cron.job_run_details(jobid,status,start_time,end_time) values(1,'running',${ago(20)},null)`)
  const dry = await run(true)
  assert.equal(Number(dry.cron_history), 2)
  assert(Number.isInteger(Number(dry.cron_heap_bytes)) && Number(dry.cron_heap_bytes) >= 0 && Number.isInteger(Number(dry.net_heap_bytes)), 'o resultado traz o tamanho em disco das duas tabelas que o autovacuum nao enxerga')
  assert.equal(Number((await run(false)).cron_history), 2)
  assert.equal(await N('select count(*) n from cron.job_run_details'), 3, 'ficam o recente e o que ainda esta rodando')
}

// ---------- limite de lote: retoma na chamada seguinte ----------
{
  await reset()
  await db.exec(`insert into cron.job_run_details(jobid,status,start_time,end_time) select 1,'succeeded',now()-interval '5 days',now()-interval '5 days' from generate_series(1,250)`)
  let r = await run(false, 100)
  assert.equal(Number(r.cron_history), 100); assert.equal(r.more, true, 'bateu no limite: ha mais')
  assert.equal(await N('select count(*) n from cron.job_run_details'), 150)
  r = await run(false, 100); assert.equal(r.more, true); r = await run(false, 100)
  assert.equal(Number(r.cron_history), 50); assert.equal(r.more, false); assert.equal(await N('select count(*) n from cron.job_run_details'), 0)
  // o agendador esvazia um atraso grande numa chamada so (ate 6 lotes)
  await db.exec(`insert into cron.job_run_details(jobid,status,start_time,end_time) select 1,'succeeded',now()-interval '5 days',now()-interval '5 days' from generate_series(1,25000)`)
  await db.exec('select public.db_housekeeping_run()')
  assert.equal(await N('select count(*) n from cron.job_run_details'), 0, 'db_housekeeping_run esvazia o atraso')
}

// ---------- falha de uma regra nao impede as outras ----------
{
  await reset()
  await db.exec(`insert into cron.job_run_details(jobid,status,start_time,end_time) values(1,'succeeded',${ago(9)},${ago(9)})`)
  await db.exec(`insert into public.meta_audit_events(created_at,entity_type,action,origin) values(${ago(60)},'metrics_row','metric.updated','api')`)
  await db.exec('alter table cron.job_run_details rename to job_run_details_bak')
  try {
    const r = await run(false)
    assert.equal(r.errors.cron_history, '42P01', 'a falha vira codigo, nunca erro para o agendador')
    assert.equal(Number(r.audit_noise), 1, 'as demais regras seguem')
  } finally { await db.exec('alter table cron.job_run_details_bak rename to job_run_details') }
  await reset()
  const lead = '00000000-0000-4000-8000-0000000000f1'
  await db.query(`insert into public.crm_context_outbox(source_lead_id,source_revision,state,delivered_at) values($1,1,'delivered',${ago(30)}),($1,2,'delivered',${ago(30)})`, [lead])
  await db.exec(`insert into public.meta_audit_events(created_at,entity_type,action,origin) values(${ago(60)},'metrics_row','metric.updated','api')`)
  await db.exec('alter table public.crm_context_outbox rename to crm_context_outbox_bak')
  try {
    const r = await run(false)
    assert.equal(Number(r.crm_outbox), 0); assert.deepEqual(r.errors, {}, 'sem a tabela da ponte a regra nem existe, sem erro'); assert.equal(Number(r.audit_noise), 1)
  } finally { await db.exec('alter table public.crm_context_outbox_bak rename to crm_context_outbox') }
  // a tabela existe mas a consulta falha: vira codigo e as regras do Meta seguem
  await db.exec('alter table public.crm_context_outbox rename column source_revision to revisao_x')
  try {
    const r = await run(false)
    assert.equal(r.errors.crm_outbox, '42703'); assert.equal(Number(r.audit_noise), 0, 'o evento de auditoria ja tinha sido apagado na execucao anterior: so o isolamento importa aqui')
  } finally { await db.exec('alter table public.crm_context_outbox rename column revisao_x to source_revision') }
}

console.log('verify-db-housekeeping-db: OK')
