export type MetaLevel = 'campaign' | 'adset' | 'ad'

export interface MetaDailyRow {
  id: string
  date: string
  account_id: string
  account_name: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  adset_name: string
  ad_id: string
  ad_name: string
  level: MetaLevel
  currency: string
  attribution_window: string
  spend: number
  leads: number
  purchases: number
  purchase_value: number
  impressions: number
  reach: number
  link_clicks: number
  messaging_conversations_started: number
  updated_at: string
}

export type ImportRow = Omit<MetaDailyRow, 'id' | 'updated_at'> & { present_metrics?: string[] }
export type CsvField = keyof Pick<ImportRow,
  'date' | 'account_id' | 'account_name' | 'campaign_id' | 'campaign_name' |
  'adset_id' | 'adset_name' | 'ad_id' | 'ad_name' | 'spend' | 'leads' |
  'purchases' | 'purchase_value' | 'impressions' | 'reach' | 'link_clicks' | 'currency' |
  'messaging_conversations_started'>
export type CsvMapping = Record<CsvField, string>

export const csvFields: { key: CsvField; label: string; required: boolean }[] = [
  { key: 'date', label: 'Data do relatório', required: true },
  { key: 'account_id', label: 'ID da conta', required: true },
  { key: 'account_name', label: 'Nome da conta', required: false },
  { key: 'campaign_id', label: 'ID da campanha', required: true },
  { key: 'campaign_name', label: 'Campanha', required: true },
  { key: 'adset_id', label: 'ID do conjunto', required: false },
  { key: 'adset_name', label: 'Conjunto', required: false },
  { key: 'ad_id', label: 'ID do anúncio', required: false },
  { key: 'ad_name', label: 'Anúncio', required: false },
  { key: 'currency', label: 'Moeda', required: false },
  { key: 'spend', label: 'Valor gasto (BRL)', required: true },
  { key: 'leads', label: 'Leads Meta', required: false },
  { key: 'purchases', label: 'Compras Meta', required: false },
  { key: 'purchase_value', label: 'Valor das compras Meta', required: false },
  { key: 'impressions', label: 'Impressões', required: false },
  { key: 'reach', label: 'Alcance', required: false },
  { key: 'link_clicks', label: 'Cliques no link', required: false },
  { key: 'messaging_conversations_started', label: 'Conversas por mensagem iniciadas', required: false },
]

const aliases: Record<CsvField, string[]> = {
  date: ['reporting starts', 'date start', 'date', 'data', 'inicio dos relatorios', 'inicio do relatorio'],
  account_id: ['account id', 'id da conta', 'id da conta de anuncios'],
  account_name: ['account name', 'nome da conta', 'nome da conta de anuncios'],
  campaign_id: ['campaign id', 'id da campanha'],
  campaign_name: ['campaign name', 'nome da campanha', 'campanha'],
  adset_id: ['ad set id', 'adset id', 'id do conjunto de anuncios'],
  adset_name: ['ad set name', 'adset name', 'nome do conjunto de anuncios'],
  ad_id: ['ad id', 'id do anuncio'],
  ad_name: ['ad name', 'nome do anuncio'],
  currency: ['currency', 'moeda'],
  spend: ['amount spent brl', 'amount spent', 'valor gasto brl', 'valor gasto', 'spend'],
  leads: ['leads', 'cadastros', 'leads meta'],
  purchases: ['purchases', 'compras', 'compras meta'],
  purchase_value: ['purchases conversion value', 'purchase conversion value', 'valor de conversao de compras', 'valor das compras'],
  impressions: ['impressions', 'impressoes'],
  reach: ['reach', 'alcance'],
  link_clicks: ['link clicks', 'cliques no link', 'inline link clicks'],
  messaging_conversations_started: [
    'messaging conversations started', 'new messaging conversations',
    'messaging conversations started 7d', 'novas conversas por mensagem iniciadas',
    'conversas por mensagem iniciadas', 'conversas iniciadas por mensagem',
    'novas conversas por mensagem', 'conversas por mensagem iniciadas no periodo',
  ],
}

function normalizeHeader(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, match => match.toLowerCase().includes('brl') ? ' brl' : '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
}

export function defaultCsvMapping(headers: string[]): CsvMapping {
  return Object.fromEntries(csvFields.map(({ key }) => [key,
    headers.find(header => aliases[key].includes(normalizeHeader(header))) ?? '',
  ])) as CsvMapping
}

export function parseCsv(source: string) {
  const text = source.replace(/^\uFEFF/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = [';', ',', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1 }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim()); cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell.trim()); cell = ''
      if (row.some(value => value !== '')) rows.push(row)
      row = []
    } else cell += char
  }
  if (quoted) throw new Error('CSV com aspas não fechadas.')
  row.push(cell.trim())
  if (row.some(value => value !== '')) rows.push(row)
  const [headers, ...values] = rows
  if (!headers?.length || !values.length) throw new Error('CSV sem cabeçalho ou linhas de dados.')
  if (values.some(line => line.length !== headers.length)) throw new Error('CSV com quantidade irregular de colunas.')
  return { headers, values }
}

function csvNumber(value: string, integer: boolean) {
  const clean = value.replace(/\s|R\$|%/g, '')
  if (!clean) return 0
  const comma = clean.lastIndexOf(',')
  const dot = clean.lastIndexOf('.')
  let normalized = clean
  if (comma >= 0 && dot >= 0) normalized = comma > dot
    ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '')
  else if (comma >= 0) normalized = /,\d{3}$/.test(clean) ? clean.replace(/,/g, '') : clean.replace(',', '.')
  else if (dot >= 0 && /\.\d{3}$/.test(clean)) normalized = clean.replace(/\./g, '')
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isSafeInteger(number)))
    throw new Error(`Número inválido: ${value}`)
  return number
}

function csvDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (() => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value)
    return match ? `${match[3]}-${match[2]}-${match[1]}` : ''
  })()
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!date || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
    throw new Error(`Data inválida: ${value}`)
  return date
}

export function buildImportRows(values: string[][], headers: string[], mapping: CsvMapping,
  level: MetaLevel, today: string, attributionWindow: string): ImportRow[] {
  for (const field of csvFields.filter(item => item.required || (level !== 'campaign' && item.key === 'adset_id') || (level === 'ad' && item.key === 'ad_id'))) {
    if (!mapping[field.key]) throw new Error(`Selecione a coluna “${field.label}”.`)
  }
  if (values.length > 2000) throw new Error('Importe até 2.000 linhas por arquivo.')
  const seen = new Set<string>()
  return values.map((line, index) => {
    const get = (field: CsvField) => line[headers.indexOf(mapping[field])] ?? ''
    try {
      const date = csvDate(get('date'))
      if (date > today) throw new Error('data futura')
      const account_id = get('account_id')
      const campaign_id = get('campaign_id')
      const campaign_name = get('campaign_name')
      const adset_id = level === 'campaign' ? '' : get('adset_id')
      const ad_id = level === 'ad' ? get('ad_id') : ''
      const currency = get('currency').toUpperCase() || 'BRL'
      if (currency !== 'BRL') throw new Error('moeda diferente de BRL')
      if (!account_id || !campaign_id || !campaign_name || (level !== 'campaign' && !adset_id) || (level === 'ad' && !ad_id))
        throw new Error('IDs ou nome da campanha ausentes')
      const key = [date, account_id, campaign_id, adset_id, ad_id].join(':')
      if (seen.has(key)) throw new Error('linha duplicada no arquivo')
      seen.add(key)
      return {
        date, account_id, account_name: get('account_name'), campaign_id, campaign_name,
        adset_id, adset_name: level === 'campaign' ? '' : get('adset_name'),
        ad_id, ad_name: level === 'ad' ? get('ad_name') : '', level, currency,
        attribution_window: attributionWindow.trim() || 'Conforme exportação Meta',
        spend: csvNumber(get('spend'), false), leads: csvNumber(get('leads'), true),
        purchases: csvNumber(get('purchases'), true), purchase_value: csvNumber(get('purchase_value'), false),
        impressions: csvNumber(get('impressions'), true), reach: csvNumber(get('reach'), true),
        link_clicks: csvNumber(get('link_clicks'), true),
        messaging_conversations_started: csvNumber(get('messaging_conversations_started'), true),
        present_metrics: ['leads','purchases','purchase_value','impressions','reach','link_clicks','messaging_conversations_started']
          .filter(field => !!mapping[field as CsvField]),
      }
    } catch (error) { throw new Error(`Linha ${index + 2}: ${error instanceof Error ? error.message : 'inválida'}`) }
  })
}

export function cost(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null
}

export function aggregateMeta(rows: Array<MetaDailyRow | ImportRow>) {
  const sum = (field: keyof ImportRow) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
  const spend = sum('spend'), leads = sum('leads'), purchases = sum('purchases')
  const purchaseValue = sum('purchase_value'), impressions = sum('impressions'), linkClicks = sum('link_clicks')
  const messagesStarted = sum('messaging_conversations_started')
  return { spend, leads, purchases, purchaseValue, impressions, linkClicks, messagesStarted,
    cpl: cost(spend, leads), cpa: cost(spend, purchases), roas: cost(purchaseValue, spend),
    cpm: cost(spend * 1000, impressions), cpc: cost(spend, linkClicks),
    costPerMessage: cost(spend, messagesStarted),
    ctr: cost(linkClicks * 100, impressions) }
}
