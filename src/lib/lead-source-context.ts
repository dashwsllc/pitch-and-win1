import { metaAnswers, prettyQuestion } from './meta-leads'
import { leadDateTime } from './meta-waves'
import { importGenerationLabel } from './crm-imports'

export const sourceContextCategories = ['Contato e identificação', 'Perfil do atleta', 'Histórico no futebol', 'Objetivos e dificuldades', 'Comprometimento', 'Relatório do site', 'Consentimentos', 'Origem da campanha', 'Outras respostas', 'Dados de entrada e revisão'] as const
export type SourceContextCategory = typeof sourceContextCategories[number]
const normalized = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_?.,/]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
const labels: Record<string, string> = {
 full_name:'Nome informado no formulário', name:'Nome informado', phone_number:'WhatsApp', phone:'WhatsApp', email:'E-mail', email_address:'E-mail',
 date_of_birth:'Data de nascimento informada', state:'Estado', city:'Cidade', age:'Idade informada', position:'Posição', category:'Categoria',
 height:'Altura (cm)', weight:'Peso (kg)', preferredFoot:'Pé preferido', nationality:'Nacionalidade', hasDualCitizenship:'Possui dupla cidadania',
 notes:'Observações', summary:'Resumo', description:'Descrição', passing:'Passe', shooting:'Finalização', pace:'Velocidade',
 dribbling:'Drible', defending:'Defesa', physical:'Físico', score:'Nota', value:'Valor', label:'Característica',
 ad_name:'Anúncio', ad_id:'Código do anúncio', adset_name:'Conjunto de anúncios', adset_id:'Código do conjunto de anúncios', campaign_name:'Campanha',
 campaign_id:'Código da campanha', form_name:'Formulário', form_id:'Código do formulário', platform:'Plataforma', is_organic:'Captação orgânica',
 utm_source:'Origem do acesso', utm_medium:'Meio de divulgação', utm_campaign:'Campanha de origem', utm_content:'Conteúdo do anúncio', utm_term:'Termo da campanha',
 gclid:'Identificador de clique Google', fbclid:'Identificador de clique Meta', ttclid:'Identificador de clique TikTok',
 created_time:'Data/hora informada na origem', lead_status:'Status na origem', report:'Relatório', stats:'Notas', stat_details:'Detalhes das notas',
 strengths:'Pontos fortes', weaknesses:'Pontos a melhorar', recommendations:'Recomendações', technicalAnalysis:'Análise técnica',
 qualification:'Qualificação', question:'Pergunta', answer:'Resposta', answers:'Respostas', goal:'Objetivo', context:'Contexto',
 imported_by:'Importado por',reviewed_by:'Revisado por',imported_at:'Importado em',reviewed_at:'Revisado em',review_note:'Observação da revisão',
 received_at:'Recebido em',first_received_at:'Primeiro recebimento',created_at:'Registrado em',updated_at:'Atualizado em',
 status:'Situação informada',approval_status:'Situação da revisão',crm_sync_status:'Situação do envio ao CRM',crm_sync_error:'Problema no envio ao CRM',
 crm_sync_attempts:'Tentativas de envio ao CRM',crm_sync_last_at:'Última tentativa de envio',traffic_edited_at:'Corrigido pela equipe em',
 source_revision:'Versão da informação',schema_version:'Versão do formato',source_file:'Arquivo de origem',source_row:'Linha do arquivo',
 batch_filename:'Arquivo importado',entry_channel:'Origem do contato',import_method:'Forma de entrada',time_known:'Horário conhecido',source_has_date:'Data conhecida',
 raw_notes:'Observações originais',complete:'Informações completas',warnings:'Observações da importação',import_warning:'Observação da importação',
 id:'Código do registro',meta_lead_id:'Código do contato na Meta',page_id:'Página de origem',wave_id:'Leva de revisão',lead_import_batch_id:'Código da importação',
 crm_lead_id:'Código do cadastro no CRM',ignored_reason:'Motivo da decisão',overall:'Nota geral',accepted:'Aceite informado',title:'Texto do aceite',
 leadgen_id:'Código do contato na Meta',event_id:'Código do recebimento',processing_attempts:'Tentativas de processamento',
 athlete_position:'Posição do atleta',athlete_age:'Idade informada do atleta',athlete_birth_date:'Data de nascimento do atleta',
}
const readableLabels = Object.fromEntries(Object.entries(labels).map(([key,label]) => [normalized(key),label]))
export function sourceQuestionLabel(name: string) {
 return name.split(' / ').map(part => readableLabels[normalized(part)] ?? prettyQuestion(part)).join(' / ')
}
export function sourceAnswerCategory(name: string): SourceContextCategory {
 const key = normalized(name).replace(/^(registro original|dados revisados) /, '')
 if (/^(relatorio|report)\b/.test(key)) return 'Relatório do site'
 if (/^consentimentos\b/.test(key)) return 'Consentimentos'
 if (/^perfil do atleta\b/.test(key)) return 'Perfil do atleta'
 if (/^(origem|attribution)\b/.test(key) || /^utm /.test(key)) return 'Origem da campanha'
 if (isTechnicalSourceField(name)) return 'Dados de entrada e revisão'
 if (/quem .*preenchendo|^(full name|name|nome|phone|telefone|whatsapp|email|e mail|date of birth|data de nascimento|state|estado|city|cidade|contato)\b/.test(key)) return 'Contato e identificação'
 if (/compromet|compromisso|de 0 a 10/.test(key)) return 'Comprometimento'
 if (/objetivo|impedindo|dificuldade|obstaculo|goal|objective/.test(key)) return 'Objetivos e dificuldades'
 if (/clube|peneira|avaliou|avaliacoes|oportunidade|historico/.test(key)) return 'Histórico no futebol'
 if (/atleta|posicao|position|categoria|category|idade|age|height|altura|weight|peso|preferred foot|pe preferido|nationality|nacionalidade|citizenship|cidadania|caracteristica|melhorar/.test(key)) return 'Perfil do atleta'
 return 'Outras respostas'
}
export function categorizedSourceAnswers(fields: unknown) {
 const answers = metaAnswers(fields)
 return sourceContextCategories.map(category => ({ category, answers: answers.filter(answer => sourceAnswerCategory(answer.label) === category) })).filter(group => group.answers.length)
}
/** Distinguish entry details from the lead's qualification, without deleting either. */
export function isTechnicalSourceField(name: string) {
 const key = normalized(name.split(' / ').at(-1) ?? name)
 return /^(id|.* id|imported by|imported at|reviewed by|reviewed at|review note|received at|first received at|created at|created time|updated at|source revision|schema version|approval status|status|lead status|crm sync.*|traffic edited at|source file|source row|batch filename|entry channel|import method|time known|source has date|raw notes|complete|warnings|.*count|gclid|fbclid|ttclid|ad name|adset name|campaign name|form name|platform|is organic)$/.test(key)
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
type Field = { name: string; values: string[] }
const scalarText = (value: unknown): string => value == null ? '' : typeof value === 'boolean' ? value ? 'Sim' : 'Não' : String(value)

/** Read the complete capture, never the clipped CRM summary; no writes or inferred answers. */
export function completeSourceFields(source: Record<string, unknown>): Field[] {
 const result: Field[] = [], seen = new Set<string>()
 const add = (name: string, values: string[]) => {
  const identity = JSON.stringify([normalized(name), values])
  if (!seen.has(identity)) { seen.add(identity); result.push({ name, values }) }
 }
 const walk = (value: unknown, path: string[]) => {
  if (Array.isArray(value)) {
   if (value.every(item => item == null || typeof item !== 'object')) add(path.join(' / '), value.map(scalarText))
   else value.forEach((item, index) => walk(item, [...path, String(index + 1)]))
  } else if (value && typeof value === 'object') {
   const entries = Object.entries(value)
   if (!entries.length) add(path.join(' / '), [])
   else entries.forEach(([key, item]) => walk(item, [...path, key]))
  } else add(path.join(' / '), [scalarText(value)])
 }
 const saved = record(source.source_snapshot)
 const payload = record(record(saved.site_event).payload)
 if (Object.keys(payload).length) {
  const contact = record(payload.contact)
  Object.entries(contact).forEach(([key, value]) => walk(value, ['Contato', key]))
  Object.entries(record(payload.profile)).forEach(([key, value]) => walk(value, ['Perfil do atleta', key]))
  if (payload.report != null) walk(payload.report, ['Relatório'])
  Object.entries(record(payload.attribution)).forEach(([key, value]) => walk(value, ['Origem', key]))
  // Original server columns can carry contact/attribution that older captures lack.
  const known = { ...contact, ...record(payload.attribution) }
  Object.entries(record(payload.source_record)).filter(([key, value]) => !Object.prototype.hasOwnProperty.call(known, key) || JSON.stringify(value) !== JSON.stringify(known[key]))
   .forEach(([key, value]) => walk(value, ['Registro original', key]))
  Object.entries(payload).filter(([key]) => !['contact','profile','report','attribution','source_record'].includes(key))
   .forEach(([key, value]) => walk(value, [key]))
 } else {
  const manual = record(saved.manual_row)
  const originals = Array.isArray(saved.field_data) ? metaAnswers(saved.field_data) : Array.isArray(manual.field_data) ? metaAnswers(manual.field_data) : null
  originals?.forEach(answer => add(answer.label, [answer.value]))
  metaAnswers(source.field_data).forEach(answer => {
   const unchanged = originals?.some(original => normalized(original.label) === normalized(answer.label) && original.value === answer.value)
   if (!unchanged) add(originals ? 'Dados revisados / ' + answer.label : answer.label, [answer.value])
  })
  const cells = manual.raw_cells ?? saved.raw_cells
  if (Array.isArray(cells)) cells.forEach(cell => {
   const item = record(cell)
   if (typeof item.header === 'string') walk(item.value, [item.header])
  })
  else Object.entries(record(cells)).forEach(([key, value]) => walk(value, [key]))
 }
 if (source.custom_disclaimer_responses != null) walk(source.custom_disclaimer_responses, ['Consentimentos'])
 if (!Object.keys(payload).length) Object.entries(saved).filter(([key]) => key.startsWith('utm_') && saved[key] != null && saved[key] !== '').forEach(([key,value]) => walk(value,['Origem',key]))
 return result
}

/** Flat entry details from the preserved capture; qualification answers stay above. */
export function sourceEntryFields(source: Record<string, unknown>): Field[] {
 const displayed = completeSourceFields(source)
 return Object.entries(source).filter(([name,value]) => !['created_time','campaign_name','form_name'].includes(name)
  && (isTechnicalSourceField(name) || ['import_warning','ignored_reason'].includes(name))
  && value != null && typeof value !== 'object' && scalarText(value).trim() !== ''
  && (['imported by','reviewed by'].includes(normalized(name))
   || !displayed.some(field => normalized(field.name) === normalized(name) && field.values.join(', ') === scalarText(value))))
  .map(([name,value]) => ({name,values:[scalarText(value)]}))
}

export function sourceEntryValue(name: string, value: string, names: Record<string,string> = {}, source: Record<string,unknown> = {}) {
 const key = normalized(name.split(' / ').at(-1) ?? name)
 if (key === 'imported by' || key === 'reviewed by') return names[value] || value
 if (key === 'created time') {
  const contact = record(source.import_contact)
  return importGenerationLabel(value,contact.time_known !== false,typeof contact.source_has_date === 'boolean' ? contact.source_has_date : undefined)
 }
 if (/^(imported at|reviewed at|received at|first received at|created at|created time|updated at|traffic edited at|crm sync last at)$/.test(key)
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return leadDateTime(value)
 const choices: Record<string,Record<string,string>> = {
  'crm sync status':{enviado:'Enviado ao CRM',pendente:'Aguardando envio',falhou:'Envio não concluído',nao_aplicavel:'Envio não necessário'},
  'approval status':{aprovado:'Aprovado',pendente:'Aguardando revisão',rejeitado:'Não aprovado'},
  status:{novo:'Aguardando revisão',importado:'Importado',ignorado:'Não encaminhado'},
  'entry channel':{form:'Formulário',website:'Site / conversão direta'},'import method':{automatic:'Automática',manual:'Manual'},
  platform:{ig:'Instagram',fb:'Facebook'},
 }
 return choices[key]?.[value] || value
}

export function siteCaptureAvailability(source: Record<string, unknown>) {
 const payload = record(record(record(source.source_snapshot).site_event).payload)
 return Object.keys(payload).length ? { profile: Object.keys(record(payload.profile)).length > 0, report: payload.report != null } : null
}

/** A contact record or operator note cannot stand in for the lead's form responses. */
export function formAnswersPresent(source: Record<string, unknown>) {
 const contactKeys = new Set(['full name','name','nome','nome completo','phone','phone number','telefone','whatsapp',
  'email','email address','e mail','date of birth','data de nascimento','state','estado','uf','city','cidade'])
 return completeSourceFields(source).some(field => {
  const key = normalized(field.name.split(' / ').at(-1) ?? field.name)
  return !isTechnicalSourceField(field.name) && !contactKeys.has(key) && sourceAnswerCategory(field.name) !== 'Origem da campanha'
   && sourceAnswerCategory(field.name) !== 'Consentimentos' && field.values.some(value => value.trim() !== '')
 })
}
