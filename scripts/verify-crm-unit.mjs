import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crmCapabilities } from '../src/lib/crm-capabilities.ts'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/lib/brasilia-time') return nextResolve(new URL('../src/lib/brasilia-time.ts', import.meta.url).href, context)
  if (specifier === '@/lib/crm-age') return nextResolve(new URL('../src/lib/crm-age.ts', import.meta.url).href, context)
  if (specifier === '@/lib/crm-call-status') return nextResolve(new URL('../src/lib/crm-call-status.ts', import.meta.url).href, context)
  if (specifier === '@/lib/crm-stages') return nextResolve(new URL('../src/lib/crm-stages.ts', import.meta.url).href, context)
  if (specifier === '@/hooks/useCRM') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  if (specifier === '@/lib/sales') return { url: 'data:text/javascript,export {}', shortCircuit: true }
  return nextResolve(specifier, context)
} })
const { emptyContact, validateContact, contactPayload, normalizePhone, findDuplicateLeads } = await import('../src/lib/crm.ts')
const { CLOSED_STAGES, NEGATIVE_STAGES, isClosedStage, isNegativeStage, outcomeLabel } = await import('../src/lib/crm-stages.ts')
const minimal = { ...emptyContact, name: 'Responsável QA', athlete_name: 'Atleta QA', phone: '11999999999' }
assert.equal(validateContact(minimal), null)
for (const field of ['email','athlete_birth_date','athlete_position','athlete_height_cm','athlete_weight_kg','performance_report_url','city_state']) assert.equal(contactPayload(minimal)[field], null)
for (const field of ['name','athlete_name','phone']) assert.ok(validateContact({ ...minimal, [field]: '' }))
assert.ok(validateContact({ ...minimal, email: 'invalid' }))
assert.ok(validateContact({ ...minimal, athlete_height_cm: '999' }))
assert.deepEqual(crmCapabilities(['seller']), { admin: false, executive: false, leads: true, sdr: false, closer: false, sales: true })
assert.equal(crmCapabilities(['seller','sdr']).closer, false)
assert.equal(crmCapabilities(['seller','sdr']).sales, true)
assert.equal(crmCapabilities(['closer']).sdr, true)
assert.equal(crmCapabilities(['closer']).closer, true)
assert.equal(crmCapabilities(['seller','closer']).sdr, true)
assert.equal(crmCapabilities(['sdr']).closer, false)
assert.equal(crmCapabilities(['sdr'], true, true, true).closer, true)
assert.equal(crmCapabilities(['sdr'], true, true, true).sales, false)
assert.equal(crmCapabilities(['sdr'], true, true, true).admin, false)
assert.equal(crmCapabilities(['sdr'], true, false, true).closer, false)
assert.equal(crmCapabilities(['bdr'], true, true, true).closer, false)
assert.equal(crmCapabilities(['bdr'], false).leads, false)
assert.equal(crmCapabilities(['bdr'], true).leads, true)
assert.equal(crmCapabilities(['seller'], true, false).leads, false)
assert.deepEqual(crmCapabilities(['executive']), { admin: false, executive: true, leads: true, sdr: true, closer: true, sales: true })
assert.ok(Object.values(crmCapabilities(['super_admin'])).every(Boolean))
const callsSource = readFileSync(new URL('../src/components/crm/CRMCalls.tsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../src/components/crm/CRMLeadCard.tsx', import.meta.url), 'utf8')
assert.match(callsSource, /isSdrHandoff[\s\S]*handoff_and_schedule_closer_call/)
assert.match(callsSource, /O lead só será enviado ao Closer depois que o agendamento for/)
assert.match(cardSource, /Agendar Call c\/ SDR/)
assert.match(cardSource, /Agendar Call c\/ Closer/)
assert.match(cardSource, /call\?\.call_type === "qualificacao" && !call\.is_completed && capabilities\.sdr && \(/)
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

// Resultados and follow-up share the same records in their dedicated views.
assert.match(crmPageSource, /if \(tab === "leads"\) return !isClosedStage\(lead\.pipeline_stage\)/)
const { leadScheduledOn, leadResult, resultMatches, canReopenResult, inFollowup } = await import('../src/lib/crm-results.ts')
const emptyFilters = { search: '', outcome: 'all', approval: 'all', seller: 'all', from: '', to: '' }
const resultLead = {
  id: 'result', name: 'Responsável', athlete_name: 'Atleta', pipeline_stage: 'fechado_ganho',
  last_result_outcome: 'venda_concluida', last_result_at: '2026-09-22T02:30:00Z',
  last_result_closer_id: 'closer', last_result_closer_name: 'Maria Closer', closer_id: 'closer', sdr_id: 'sdr',
}
const resultSale = { seller_id: 'seller', seller_name: 'Ana Vendas', approval_status: 'rejeitada' }
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, from: '2026-09-21', to: '2026-09-21' }), true)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, from: '2026-09-22' }), false)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, outcome: 'won', approval: 'rejeitada' }), true)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, approval: 'aprovada' }), false)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, seller: 'seller' }), true)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, seller: 'closer' }), false)
assert.equal(resultMatches(resultLead, undefined, { ...emptyFilters, seller: 'closer', approval: 'unregistered' }), true)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, search: 'maria' }), true)
assert.equal(resultMatches(resultLead, resultSale, { ...emptyFilters, outcome: 'lost' }), false)
assert.equal(leadResult({ ...resultLead, pipeline_stage: 'em_qualificacao' }), 'venda_concluida')
assert.equal(resultMatches({ ...resultLead, pipeline_stage: 'em_qualificacao' }, resultSale, emptyFilters), true)
assert.equal(canReopenResult(resultLead, 'other', { executive: false, closer: true, sdr: false }), false)
assert.equal(canReopenResult(resultLead, 'closer', { executive: false, closer: true, sdr: false }), true)
assert.equal(canReopenResult({ ...resultLead, pipeline_stage: 'em_qualificacao' }, 'closer', { executive: true, closer: true, sdr: true }), false)
assert.equal(inFollowup({ pipeline_stage: 'fechado_perdido', followup_status: 'scheduled' }), true)
assert.equal(inFollowup({ pipeline_stage: 'fechado_perdido', followup_status: 'do_not_contact' }), false)
assert.equal(inFollowup({ pipeline_stage: 'em_qualificacao', followup_status: 'reactivated' }), false)
assert.equal(leadScheduledOn({ next_followup_at: null }, ['2026-09-22T02:30:00Z'], '2026-09-21'), true)
assert.equal(leadScheduledOn({ next_followup_at: null }, ['2026-09-22T02:30:00Z'], '2026-09-22'), false)
assert.equal(leadScheduledOn({ next_followup_at: '2026-09-21T16:00:00Z' }, ['2026-09-23T16:00:00Z'], '2026-09-23'), true)
assert.equal(leadScheduledOn({ next_followup_at: '2026-09-21T16:00:00Z' }, [], '2026-09-21'), true)
assert.equal(leadScheduledOn({ next_followup_at: null }, [], '2026-09-21'), false)
assert.equal(leadScheduledOn({ next_followup_at: 'bad-date' }, [], '2026-09-21'), false)
assert.equal(leadScheduledOn({ next_followup_at: '2026-09-21T16:00:00Z' }, [], ''), false)

const qualificationSource = readFileSync(new URL('../src/components/crm/CRMQualificationDialog.tsx', import.meta.url), 'utf8')
const followupSource = readFileSync(new URL('../src/components/crm/CRMFollowupDialog.tsx', import.meta.url), 'utf8')
assert.match(qualificationSource, /Faixa de renda média/)
assert.match(qualificationSource, /Quem decide/)
assert.match(qualificationSource, /Resumo para o Closer/)
assert.match(followupSource, /Registrar contato e próxima tentativa/)
assert.match(followupSource, /Reativar para qualificação/)

// Follow-up é uma fila compartilhada: todo SDR e todo Closer (Executive e Super Admin incluídos) abre a aba e acompanha qualquer lead;
// Seller e conta sem função ficam de fora. O banco aplica a mesma regra em crm_update_followup.
const followupAccess = (roles, ...rest) => { const c = crmCapabilities(roles, ...rest); return c.sdr || c.closer }
for (const role of ['sdr', 'closer', 'executive', 'super_admin']) assert.equal(followupAccess([role]), true, role)
assert.equal(followupAccess(['seller']), false, 'Seller não acompanha o follow-up')
assert.equal(followupAccess(['seller'], true), false, 'acesso ao CRM sozinho não abre o follow-up')
assert.equal(followupAccess([]), false)
assert.equal(followupAccess(['sdr'], true, false), false, 'conta suspensa continua bloqueada')
const followupBoardSource = readFileSync(new URL('../src/components/crm/CRMFollowupBoard.tsx', import.meta.url), 'utf8')
assert.match(followupBoardSource, /const canManage = capabilities\.sdr \|\| capabilities\.closer/)
assert.doesNotMatch(followupBoardSource, /sdr_id === user|useAuth/, 'o follow-up não prende o lead ao SDR responsável')
assert.match(crmPageSource, /\(capabilities\.sdr \|\| capabilities\.closer\) && \(\s*<TabsTrigger[^>]*value="followup"/)
assert.match(crmPageSource, /tab === "followup" && \(capabilities\.sdr \|\| capabilities\.closer\)/)
assert.doesNotMatch(crmPageSource, /value: "negative"/, 'o follow-up deixou de ser uma subfila da aba SDR')
assert.match(crmPageSource, /requestedTab === "remarketing" \? "followup"/, 'links antigos continuam abrindo o follow-up')
assert.match(cardSource, /onAction\("send_followup"\)/)
assert.match(cardSource, /Enviar para Follow-up/)
assert.match(crmHookSource, /supabase\.rpc\("crm_update_followup"/)

// Lista de Closers/SDRs dos diálogos do CRM: uma regra só, completa e sem duplicados.
const assigneesModule = await import('../src/lib/crm-assignees.ts')
const { candidatesFor } = assigneesModule
const assigneeRows = [
  { user_id: 'u-pedro', display_name: 'Pedro Iago', role: 'closer' },
  { user_id: 'u-pedro', display_name: 'Pedro Iago', role: 'sdr' },
  { user_id: 'u-ana', display_name: 'ana', role: 'closer' },
  { user_id: 'u-exec', display_name: 'Cleiton', role: 'executive' },
  { user_id: 'u-adm', display_name: 'Admin', role: 'super_admin' },
  { user_id: 'u-sdr', display_name: 'Ismael', role: 'sdr' },
]
assert.deepEqual(candidatesFor('closer', assigneeRows).map(c => c.display_name), ['Admin', 'ana', 'Cleiton', 'Pedro Iago'])
assert.deepEqual(candidatesFor('sdr', assigneeRows).map(c => c.display_name), ['Admin', 'Cleiton', 'Ismael', 'Pedro Iago'])
assert.equal(candidatesFor('closer', assigneeRows).some(c => c.user_id === 'u-sdr'), false)
assert.equal(candidatesFor('closer', assigneeRows.filter(r => r.user_id !== 'u-pedro')).some(c => c.user_id === 'u-pedro'), false)
assert.equal(candidatesFor('closer', [{ user_id: 'u-pedro', display_name: 'Pedro Iago', role: 'sdr' }]).length, 0)
assert.deepEqual(candidatesFor('closer', []), [])
// Quem agenda o fechamento pode ser o Closer dele: um SDR que também é Closer (Pedro Iago) aparece na lista e se escolhe.
const closers = candidatesFor('closer', assigneeRows)
assert.ok(closers.some(c => c.user_id === 'u-pedro'), 'o SDR que também é Closer está na lista de Closers')
assert.equal(assigneesModule.splitSelf, undefined, 'não existe mais a lista que esconde quem agenda')
const schedulerSource = readFileSync(new URL('../src/components/crm/CRMCalls.tsx', import.meta.url), 'utf8')
assert.match(schedulerSource, /useCRMAssignees\(\{ fresh: true \}\)/)
assert.match(schedulerSource, /candidatesFor\(/)
assert.doesNotMatch(schedulerSource, /blockedScheduler|splitSelf|não recebe a própria call/, 'o diálogo não bloqueia mais quem agenda')
assert.match(schedulerSource, /const canCreateClosing = capabilities\.sdr;/, 'qualquer SDR ou Closer agenda o fechamento')
assert.doesNotMatch(schedulerSource, /disabled=\{!call && type === "fechamento_closer" && !!lead\.closer_id\}/, 'o Closer pode ser trocado ao agendar também')
assert.match(readFileSync(new URL('../src/components/crm/CRMLeadCard.tsx', import.meta.url), 'utf8'), /const canCreateClosing = capabilities\.sdr;/)
assert.match(readFileSync(new URL('../src/pages/CRM.tsx', import.meta.url), 'utf8'), /candidatesFor\("closer"/)
assert.match(readFileSync(new URL('../src/components/crm/CRMReturnDialog.tsx', import.meta.url), 'utf8'), /candidatesFor\(target/)

// Edição de call já agendada: só o que mudou vai ao banco, e o horário é comparado como a pessoa o vê (minuto, Brasília).
const { planCallEdit, callEditToast } = await import('../src/lib/crm-call-edit.ts')
const scheduledCall = { assigned_to: 'u-x', scheduled_at: '2026-10-07T18:00:30Z' }
const refNow = Date.parse('2026-10-06T12:00:00Z')
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-x', when: '2026-10-07T15:00' }, refNow), { ok: false, reason: 'nothing' })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: '', when: '2026-10-07T15:00' }, refNow), { ok: false, reason: 'nothing' })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-y', when: '2026-10-07T15:00' }, refNow), { ok: true, assignedTo: 'u-y', scheduledAt: null })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-x', when: '2026-10-08T10:30' }, refNow), { ok: true, assignedTo: null, scheduledAt: '2026-10-08T13:30:00.000Z' })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-y', when: '2026-10-08T10:30' }, refNow), { ok: true, assignedTo: 'u-y', scheduledAt: '2026-10-08T13:30:00.000Z' })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-x', when: '2026-10-05T10:00' }, refNow), { ok: false, reason: 'past_time' })
assert.deepEqual(planCallEdit(scheduledCall, { assignedTo: 'u-x', when: '' }, refNow), { ok: false, reason: 'invalid_time' })
const overdueCall = { assigned_to: 'u-x', scheduled_at: '2026-10-01T18:00:00Z' }
assert.deepEqual(planCallEdit(overdueCall, { assignedTo: 'u-y', when: '2026-10-01T15:00' }, refNow), { ok: true, assignedTo: 'u-y', scheduledAt: null })
assert.equal(callEditToast({ assignedTo: 'u-y', scheduledAt: null }), 'Responsável da call atualizado')
assert.equal(callEditToast({ assignedTo: null, scheduledAt: 'x' }), 'Call reagendada')
assert.equal(callEditToast({ assignedTo: 'u-y', scheduledAt: 'x' }), 'Responsável e horário da call atualizados')
assert.match(cardSource, /const canEditCall = !closed && !!call && !call\.is_completed && capabilities\.sdr;/)
assert.match(cardSource, /Editar call agendada/)
assert.match(schedulerSource, /update_crm_call/)
const editMigration = readFileSync(new URL('../supabase/migrations/20261006100000_crm_edit_scheduled_call.sql', import.meta.url), 'utf8')
assert.match(editMigration, /PERFORM public\.crm_require_role\('sdr'\)/)
assert.match(editMigration, /REVOKE ALL ON FUNCTION public\.update_crm_call\(uuid,uuid,timestamptz,timestamptz\) FROM PUBLIC, anon, authenticated/)
assert.doesNotMatch(editMigration, /GRANT EXECUTE ON FUNCTION public\.update_crm_call\([^)]*\) TO (anon|PUBLIC)/)


// ---- Lead duplicado: o mesmo WhatsApp escrito de jeitos diferentes é a mesma pessoa; o aviso nunca vem do próprio lead.
assert.equal(normalizePhone('(11) 99879-2426'), '11998792426')
assert.equal(normalizePhone('+55 11 99879-2426'), '11998792426', 'o código do país é ignorado')
assert.equal(normalizePhone('5511998792426'), '11998792426')
assert.equal(normalizePhone('11998792426'), '11998792426')
assert.equal(normalizePhone('1234'), '', 'curto demais para comparar')
assert.equal(normalizePhone(null), '')
const existentes = [
  { id: 'a', phone: '11998792426', email: 'Mae@Exemplo.com' },
  { id: 'b', phone: '(61) 99232-2770', email: null },
  { id: 'c', phone: null, email: 'outro@exemplo.com' },
]
assert.deepEqual(findDuplicateLeads({ phone: '+55 (11) 99879-2426' }, existentes).map((l) => l.id), ['a'], 'WhatsApp em outro formato')
assert.deepEqual(findDuplicateLeads({ email: ' mae@exemplo.COM ' }, existentes).map((l) => l.id), ['a'], 'e-mail sem diferenciar maiúsculas')
assert.deepEqual(findDuplicateLeads({ phone: '61992322770', email: 'outro@exemplo.com' }, existentes).map((l) => l.id), ['b', 'c'], 'WhatsApp de um e e-mail de outro')
assert.deepEqual(findDuplicateLeads({ phone: '11998792426' }, existentes, 'a'), [], 'o próprio lead não é duplicado dele mesmo')
assert.deepEqual(findDuplicateLeads({ phone: '', email: '' }, existentes), [], 'sem contato não há o que comparar')
assert.deepEqual(findDuplicateLeads({ phone: '11900000000' }, existentes), [])

// ---- Etapas e resultados: uma lista só, e lead perdido nunca aparece como "Venda recusada".
assert.deepEqual([...CLOSED_STAGES], ['fechado_ganho', 'fechado_perdido', 'lead_perdido'])
assert.deepEqual([...NEGATIVE_STAGES], ['fechado_perdido', 'lead_perdido'])
for (const stage of CLOSED_STAGES) assert.equal(isClosedStage(stage), true, stage)
for (const stage of ['novo', 'em_qualificacao', 'pronto_closer', 'repassado_closer', null, undefined]) assert.equal(isClosedStage(stage), false, String(stage))
assert.equal(isNegativeStage('lead_perdido'), true)
assert.equal(isNegativeStage('fechado_ganho'), false)
assert.equal(outcomeLabel('venda_concluida'), 'Venda concluída')
assert.equal(outcomeLabel('venda_perdida'), 'Venda recusada')
assert.equal(outcomeLabel('lead_perdido'), 'Lead perdido', 'lead perdido não é venda recusada')
assert.equal(outcomeLabel('followup_sdr'), 'Follow-up do SDR', 'todo desfecho que o banco aceita tem texto')
assert.equal(outcomeLabel(null), null)
assert.equal(outcomeLabel('algo_novo'), 'algo_novo', 'um desfecho desconhecido sai como veio, nunca vazio')
// Nenhuma tela volta a escrever a lista de etapas fechadas à mão.
for (const arquivo of ['src/pages/CRM.tsx', 'src/components/crm/CRMLeadCard.tsx', 'src/components/crm/CRMResults.tsx', 'src/components/crm/CRMFollowupBoard.tsx', 'src/lib/crm-order.ts', 'src/lib/crm-results.ts', 'src/lib/crm-notifications.ts', 'src/lib/crm-call-status.ts']) {
  assert.doesNotMatch(readFileSync(new URL(`../${arquivo}`, import.meta.url), 'utf8'), /['"]fechado_ganho['"]\s*,\s*['"]fechado_perdido['"]/, `${arquivo} repete a lista de etapas fechadas`)
}
const detalhe = readFileSync(new URL('../src/components/crm/CRMLeadDetail.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(detalhe, /"Venda perdida"/, 'o histórico chama venda_perdida de "Venda recusada", como o resto do CRM')
assert.match(detalhe, /outcomeLabel\(lead\.last_result_outcome\)/)

console.log('PASS: CRM validation, strict roles, SDR qualification calls, follow-up queues and shared access, athlete data, lead deletion, call states, notifications, ordering, athlete-first hierarchy and the shared Closer/SDR assignee list and editing of already scheduled calls.')
