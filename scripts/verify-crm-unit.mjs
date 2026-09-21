import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crmCapabilities } from '../src/lib/crm-capabilities.ts'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/brasilia-time') return nextResolve(new URL('../src/lib/brasilia-time.ts', import.meta.url).href, context)
  if (specifier === '@/lib/crm-age') return nextResolve(new URL('../src/lib/crm-age.ts', import.meta.url).href, context)
  if (specifier === '@/lib/crm-call-status') return nextResolve(new URL('../src/lib/crm-call-status.ts', import.meta.url).href, context)
  if (specifier === '@/hooks/useCRM') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  if (specifier === '@/lib/sales') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  return nextResolve(specifier, context)
} })
const { emptyContact, validateContact, contactPayload } = await import('../src/lib/crm.ts')
const minimal = { ...emptyContact, name: 'Responsável QA', athlete_name: 'Atleta QA', phone: '11999999999' }
assert.equal(validateContact(minimal), null)
for (const field of ['email','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','performance_report_url','city_state']) assert.equal(contactPayload(minimal)[field], null)
for (const field of ['name','athlete_name','phone']) assert.ok(validateContact({ ...minimal, [field]: '' }))
assert.ok(validateContact({ ...minimal, email: 'invalid' }))
assert.ok(validateContact({ ...minimal, athlete_height_cm: '999' }))
assert.deepEqual(crmCapabilities(['seller']), { admin: false, executive: false, leads: true, sdr: false, closer: false, sales: true })
assert.equal(crmCapabilities(['seller','sdr']).closer, false)
assert.equal(crmCapabilities(['seller','sdr']).sales, true)
assert.equal(crmCapabilities(['seller','closer']).sdr, false)
assert.equal(crmCapabilities(['bdr'], false).leads, false)
assert.equal(crmCapabilities(['bdr'], true).leads, true)
assert.equal(crmCapabilities(['seller'], true, false).leads, false)
assert.deepEqual(crmCapabilities(['executive']), { admin: false, executive: true, leads: true, sdr: true, closer: true, sales: true })
assert.ok(Object.values(crmCapabilities(['super_admin'])).every(Boolean))
const callsSource = readFileSync(new URL('../src/components/crm/CRMCalls.tsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../src/components/crm/CRMLeadCard.tsx', import.meta.url), 'utf8')
assert.match(callsSource, /isSdrHandoff[\s\S]*handoff_and_schedule_closer_call/)
assert.match(callsSource, /O lead só será enviado ao Closer depois que o agendamento for/)
assert.match(cardSource, /Agendar qualificação/)
assert.match(cardSource, /Agendar fechamento e enviar ao Closer/)
assert.doesNotMatch(cardSource, /onAction\("handoff"\)/)
// ---------------------------------------------------------------------------
// Idade do atleta
// ---------------------------------------------------------------------------
const { ageFromBirthDate, resolveAthleteAge, athleteAgeConflict } = await import('../src/lib/crm-age.ts')
const hoje = new Date('2026-09-14T12:00:00Z')
// Aniversario ja ocorreu no ano corrente.
assert.equal(ageFromBirthDate('2010-05-15', hoje), 16)
// Aniversario ainda nao ocorreu: nao basta subtrair os anos.
assert.equal(ageFromBirthDate('2010-12-31', hoje), 15)
// Aniversario exatamente hoje ja conta.
assert.equal(ageFromBirthDate('2010-09-14', hoje), 16)
assert.equal(ageFromBirthDate(null, hoje), null)
assert.equal(ageFromBirthDate('data-invalida', hoje), null)
// A data de nascimento tem prioridade sobre a idade digitada.
assert.deepEqual(resolveAthleteAge({ athlete_birth_date: '2010-05-15', athlete_age: 17 }, hoje), { age: 16, source: 'birth_date' })
// Sem nascimento, vale a idade manual.
assert.deepEqual(resolveAthleteAge({ athlete_birth_date: null, athlete_age: 16 }, hoje), { age: 16, source: 'manual' })
assert.deepEqual(resolveAthleteAge({ athlete_birth_date: null, athlete_age: null }, hoje), { age: null, source: null })
// Idade fora da faixa nao e aceita como fonte.
assert.equal(resolveAthleteAge({ athlete_age: 0 }, hoje).age, null)
assert.equal(resolveAthleteAge({ athlete_age: 200 }, hoje).age, null)
assert.deepEqual(athleteAgeConflict({ athlete_birth_date: '2010-05-15', athlete_age: 17 }, hoje), { calculated: 16, informed: 17 })
assert.equal(athleteAgeConflict({ athlete_birth_date: '2010-05-15', athlete_age: 16 }, hoje), null)
// Informar idade nunca inventa uma data de nascimento.
const comIdade = contactPayload({ ...minimal, athlete_age: '16' })
assert.equal(comIdade.athlete_age, 16)
assert.equal(comIdade.athlete_birth_date, null)
assert.equal(contactPayload(minimal).athlete_age, null)
assert.equal(validateContact({ ...minimal, athlete_age: '16' }), null)
assert.ok(validateContact({ ...minimal, athlete_age: '0' }))
assert.ok(validateContact({ ...minimal, athlete_age: '200' }))
assert.ok(validateContact({ ...minimal, athlete_age: '16.5' }))

// ---------------------------------------------------------------------------
// Estado temporal das calls
// ---------------------------------------------------------------------------
const { callTimingState, isCallPastDue, callMatchesDateKey, callStateLabel, minutesUntilCall } =
  await import('../src/lib/crm-call-status.ts')
const agora = new Date('2026-09-14T12:00:00Z').getTime()
const emMinutos = (m) => ({ scheduled_at: new Date(agora + m * 60_000).toISOString() })
assert.equal(callTimingState(emMinutos(120), agora), 'upcoming')
assert.equal(callTimingState(emMinutos(45), agora), 'soon')
assert.equal(callTimingState(emMinutos(20), agora), 'approaching')
assert.equal(callTimingState(emMinutos(5), agora), 'urgent')
assert.equal(callTimingState(emMinutos(0), agora), 'now')
assert.equal(callTimingState(emMinutos(-10), agora), 'now')
assert.equal(callTimingState(emMinutos(-45), agora), 'overdue')
// Call concluida ou com resultado nunca gera alerta de atraso.
assert.equal(callTimingState({ ...emMinutos(-120), is_completed: true }, agora), 'completed')
assert.equal(callTimingState({ ...emMinutos(-120), outcome: 'venda_concluida' }, agora), 'completed')
// Lead encerrado tambem nao gera alerta.
assert.equal(callTimingState(emMinutos(-120), agora, 'fechado_ganho'), 'completed')
assert.equal(callTimingState(null, agora), 'none')
assert.equal(isCallPastDue(emMinutos(-45), agora), true)
assert.equal(isCallPastDue(emMinutos(5), agora), false)
assert.equal(isCallPastDue({ ...emMinutos(-45), is_completed: true }, agora), false)
// A urgencia sempre tem texto, nunca depende so de cor.
assert.equal(callStateLabel('overdue', -45), 'Call não efetuada')
assert.equal(callStateLabel('now', 0), 'Call agora')
assert.equal(callStateLabel('upcoming', 120), null)
assert.equal(minutesUntilCall(emMinutos(30), agora), 30)
// O dia da call usa o calendario de Brasilia, nao o UTC.
assert.equal(callMatchesDateKey({ scheduled_at: '2026-09-14T02:00:00Z' }, '2026-09-13'), true)
assert.equal(callMatchesDateKey({ scheduled_at: '2026-09-14T02:00:00Z' }, '2026-09-14'), false)
assert.equal(callMatchesDateKey({ scheduled_at: null }, '2026-09-14'), false)
assert.equal(callMatchesDateKey({ scheduled_at: '2026-09-14T18:00:00Z' }, null), false)

// ---------------------------------------------------------------------------
// Janelas e deduplicação das notificações proativas
// ---------------------------------------------------------------------------
const {
  callReminderMilestone,
  passedCallMilestones,
  saleNotificationState,
  followupNotificationState,
  leadNotificationOwner,
} = await import('../src/lib/crm-notifications.ts')
const notificationAt = (m) => new Date(agora + m * 60_000).toISOString()
assert.equal(callReminderMilestone(emMinutos(31), agora), null)
assert.equal(callReminderMilestone(emMinutos(25), agora), 30)
assert.equal(callReminderMilestone(emMinutos(8), agora), 10)
assert.equal(callReminderMilestone(emMinutos(0), agora), 0)
assert.equal(callReminderMilestone(emMinutos(-4), agora), 0)
assert.equal(callReminderMilestone(emMinutos(-6), agora), null)
assert.deepEqual(passedCallMilestones(10), [30])
assert.deepEqual(passedCallMilestones(0), [30, 10])
const aprovada = { approval_status: 'aprovada', reviewed_at: notificationAt(-60) }
assert.equal(saleNotificationState(aprovada, agora), 'eligible')
assert.equal(saleNotificationState({ ...aprovada, reviewed_at: notificationAt(-59) }, agora), 'waiting')
assert.equal(saleNotificationState({ ...aprovada, reviewed_at: notificationAt(-71) }, agora), 'expired')
assert.equal(saleNotificationState({ ...aprovada, approval_status: 'pendente' }, agora), 'invalid')
assert.equal(followupNotificationState({ pipeline_stage: 'em_contato', next_followup_at: notificationAt(-10) }, agora), 'eligible')
assert.equal(followupNotificationState({ pipeline_stage: 'em_contato', next_followup_at: notificationAt(-16) }, agora), 'expired')
assert.equal(followupNotificationState({ pipeline_stage: 'fechado_ganho', next_followup_at: notificationAt(0) }, agora), 'invalid')
assert.equal(leadNotificationOwner({ pipeline_stage: 'repassado_closer', closer_id: 'closer', sdr_id: 'sdr', assigned_to: null, created_by: 'creator' }), 'closer')
assert.equal(leadNotificationOwner({ pipeline_stage: 'repassado_closer', closer_id: null, sdr_id: 'sdr', assigned_to: 'sdr', created_by: 'creator' }), null)
assert.equal(leadNotificationOwner({ pipeline_stage: 'em_contato', closer_id: null, sdr_id: 'sdr', assigned_to: null, created_by: 'creator' }), 'sdr')

// ---------------------------------------------------------------------------
// Hierarquia do atleta na interface
// ---------------------------------------------------------------------------
const detailSource = readFileSync(new URL('../src/components/crm/CRMLeadDetail.tsx', import.meta.url), 'utf8')
const crmPageSource = readFileSync(new URL('../src/pages/CRM.tsx', import.meta.url), 'utf8')
const crmHookSource = readFileSync(new URL('../src/hooks/useCRM.tsx', import.meta.url), 'utf8')
assert.match(cardSource, /athleteLabel = lead\.athlete_name\?\.trim\(\) \|\| lead\.name/)
assert.match(cardSource, /<h3 className="font-semibold text-sm break-words">\{athleteLabel\}<\/h3>/)
assert.match(cardSource, /Responsável: \{lead\.name\?\.trim\(\) \|\| "Não informado"\}/)
assert.match(detailSource, /\["Atleta", lead\.athlete_name\][\s\S]*\["Responsável", lead\.name\]/)

// A lixeira acompanha o lápis no card e na ficha. A tela exige confirmação e
// o hook usa a operação versionada/auditada do banco, nunca DELETE direto.
assert.match(cardSource, /icon: Pencil[\s\S]*icon: Trash2/)
assert.match(detailSource, /<Pencil[\s\S]*<Trash2/)
assert.match(crmPageSource, /<AlertDialogTitle>Excluir este lead\?<\/AlertDialogTitle>/)
assert.match(crmPageSource, /crm\.deleteLead\(deleting\)/)
assert.match(crmHookSource, /supabase\.rpc\("crm_delete_lead"/)
assert.doesNotMatch(crmHookSource, /\.from\("crm_leads"\)[\s\S]{0,120}\.delete\(\)/)

// ---------------------------------------------------------------------------
// Ordenacao operacional: atrasadas, acontecendo agora, proximas e o resto
// ---------------------------------------------------------------------------
const { compareCallProximity, compareLeadRecency, compareLeadUrgency } = await import('../src/lib/crm-order.ts')
const quando = (m) => new Date(agora + m * 60_000).toISOString()
const leadBase = { created_at: '2026-09-01T00:00:00Z', pipeline_stage: 'repassado_closer' }
const ordenado = [
  { ...leadBase, id: 'd-futura-tarde', next_followup_at: quando(600) },
  { ...leadBase, id: 'e-sem-agenda', next_followup_at: null },
  { ...leadBase, id: 'c-proxima', next_followup_at: quando(20) },
  { ...leadBase, id: 'a-muito-atrasada', next_followup_at: quando(-300) },
  { ...leadBase, id: 'f-encerrada', pipeline_stage: 'fechado_ganho', next_followup_at: quando(-10) },
  { ...leadBase, id: 'b-agora', next_followup_at: quando(-5) },
]
  .sort((x, y) => compareLeadUrgency(x, y))
  .map((lead) => lead.id)
assert.deepEqual(ordenado.slice(0, 4), ['a-muito-atrasada', 'b-agora', 'c-proxima', 'd-futura-tarde'])
// Sem agenda e leads encerrados ficam no fim.
assert.deepEqual(ordenado.slice(4).sort(), ['e-sem-agenda', 'f-encerrada'])

const porCriacao = [
  { id: 'antigo', created_at: '2026-09-10T10:00:00Z', pipeline_stage: 'novo' },
  { id: 'recente', created_at: '2026-09-14T10:00:00Z', pipeline_stage: 'novo' },
  { id: 'intermediario', created_at: '2026-09-12T10:00:00Z', pipeline_stage: 'novo' },
].sort(compareLeadRecency).map((lead) => lead.id)
assert.deepEqual(porCriacao, ['recente', 'intermediario', 'antigo'])

// Em um dia escolhido, horarios futuros sobem em ordem crescente. Horarios
// ja passados aparecem depois, começando pelo mais próximo do momento atual.
const callsNoDia = [
  { id: 'passada-antiga', at: quando(-180) },
  { id: 'futura-tarde', at: quando(180) },
  { id: 'passada-recente', at: quando(-30) },
  { id: 'futura-breve', at: quando(20) },
].sort((a, b) => compareCallProximity(a.at, b.at, agora)).map((call) => call.id)
assert.deepEqual(callsNoDia, ['futura-breve', 'futura-tarde', 'passada-recente', 'passada-antiga'])

assert.match(crmPageSource, /useState\("newest"\)/)
assert.match(crmPageSource, /callDateFilter !== "all"[\s\S]*compareCallProximity/)
assert.match(crmPageSource, /data-call-date-option=\{option\.value\}/)
assert.match(crmPageSource, /<span className="shrink-0">\{option\.label\}<\/span>/)

// Leads encerrados saem da lista ativa. SDR mantém subfilas explícitas para
// atendimento, calls, fechados e negativas; a negativa também possui o
// departamento dedicado de Remarketing.
assert.match(crmPageSource, /const negativeStages = \["fechado_perdido", "lead_perdido"\]/)
assert.match(crmPageSource, /\{ value: "closed", label: "Fechados" \}/)
assert.match(crmPageSource, /\{ value: "negative", label: "Negativas \/ Remarketing" \}/)
assert.match(crmPageSource, /if \(tab === "leads"\) return !closedStages\.includes/)
assert.match(crmPageSource, /value="remarketing">Remarketing/)

const qualificationSource = readFileSync(new URL('../src/components/crm/CRMQualificationDialog.tsx', import.meta.url), 'utf8')
const remarketingSource = readFileSync(new URL('../src/components/crm/CRMRemarketingDialog.tsx', import.meta.url), 'utf8')
assert.match(qualificationSource, /Faixa de renda média/)
assert.match(qualificationSource, /Quem decide/)
assert.match(qualificationSource, /Resumo para o Closer/)
assert.match(remarketingSource, /Registrar contato e próxima tentativa/)
assert.match(remarketingSource, /Reativar para qualificação/)

console.log('PASS: CRM validation, strict roles, SDR qualification calls, remarketing queues, athlete data, lead deletion, call states, notifications, ordering and athlete-first hierarchy.')
