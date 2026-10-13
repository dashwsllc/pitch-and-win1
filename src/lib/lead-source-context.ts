import { metaAnswers, prettyQuestion } from './meta-leads'

export const sourceContextCategories = ['Contato e identificação', 'Perfil do atleta', 'Histórico no futebol', 'Objetivos e dificuldades', 'Comprometimento', 'Relatório do site', 'Origem da campanha', 'Outras respostas'] as const
export type SourceContextCategory = typeof sourceContextCategories[number]
const normalized = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_?.,/]+/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
const labels: Record<string, string> = {
 full_name:'Nome informado no formulário', name:'Nome informado', phone_number:'WhatsApp', phone:'WhatsApp', email:'E-mail', email_address:'E-mail',
 date_of_birth:'Data de nascimento informada', state:'Estado', city:'Cidade', age:'Idade informada', position:'Posição', category:'Categoria',
 height:'Altura (cm)', weight:'Peso (kg)', preferredFoot:'Pé preferido', nationality:'Nacionalidade', hasDualCitizenship:'Possui dupla cidadania',
 notes:'Observações', summary:'Resumo', description:'Descrição', passing:'Passe', shooting:'Finalização', pace:'Velocidade',
 dribbling:'Drible', defending:'Defesa', physical:'Físico', score:'Nota', value:'Valor', label:'Característica',
 ad_name:'Anúncio', ad_id:'ID do anúncio', adset_name:'Conjunto de anúncios', adset_id:'ID do conjunto de anúncios', campaign_name:'Campanha',
 campaign_id:'ID da campanha', form_name:'Formulário', form_id:'ID do formulário', platform:'Plataforma', is_organic:'Captação orgânica',
 utm_source:'UTM origem', utm_medium:'UTM mídia', utm_campaign:'UTM campanha', utm_content:'UTM conteúdo', utm_term:'UTM termo',
 gclid:'Identificador de clique Google', fbclid:'Identificador de clique Meta', ttclid:'Identificador de clique TikTok',
 created_time:'Data/hora informada na origem', lead_status:'Status na origem', report:'Relatório', stats:'Notas', stat_details:'Detalhes das notas',
 strengths:'Pontos fortes', weaknesses:'Pontos a melhorar', recommendations:'Recomendações', technicalAnalysis:'Análise técnica',
}
export function sourceQuestionLabel(name: string) {
 return name.split(' / ').map(part => labels[part] ?? prettyQuestion(part)).join(' / ')
}
export function sourceAnswerCategory(name: string): SourceContextCategory {
 const key = normalized(name)
 if (/^(relatorio|report)\b/.test(key)) return 'Relatório do site'
 if (/^(origem|attribution)\b/.test(key) || /^(utm |ad |adset |campaign |form |platform$|is organic$|gclid$|fbclid$|ttclid$|created time$|lead status$|id$)/.test(key)) return 'Origem da campanha'
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
  Object.entries(contact).forEach(([key, value]) => walk(value, [key]))
  Object.entries(record(payload.profile)).forEach(([key, value]) => walk(value, [key]))
  if (payload.report != null) walk(payload.report, ['Relatório'])
  Object.entries(record(payload.attribution)).forEach(([key, value]) => walk(value, ['Origem', key]))
  // Original server columns can carry contact/attribution that older captures lack.
  const known = { ...contact, ...record(payload.attribution) }
  Object.entries(record(payload.source_record)).filter(([key]) => !(key in known) && !['id','created_at','updated_at','source_revision'].includes(key))
   .forEach(([key, value]) => walk(value, [key]))
 } else {
  metaAnswers(source.field_data).forEach(answer => add(answer.label, [answer.value]))
  const manual = record(saved.manual_row)
  metaAnswers(manual.field_data).forEach(answer => add(answer.label, [answer.value]))
  const cells = manual.raw_cells ?? saved.raw_cells
  if (Array.isArray(cells)) cells.forEach(cell => {
   const item = record(cell)
   if (typeof item.header === 'string') walk(item.value, [item.header])
  })
  else Object.entries(record(cells)).forEach(([key, value]) => walk(value, [key]))
 }
 return result
}

export function siteCaptureAvailability(source: Record<string, unknown>) {
 const payload = record(record(record(source.source_snapshot).site_event).payload)
 return Object.keys(payload).length ? { profile: Object.keys(record(payload.profile)).length > 0, report: payload.report != null } : null
}
