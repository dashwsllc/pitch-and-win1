import { parseCsv } from './meta-traffic.ts'

export async function parseSpreadsheetFile(file: File): Promise<{ headers: string[]; values: string[][] }> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    if (!sheet) throw new Error('Planilha sem nenhuma aba.')
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
      .map(row => row.map(cell => String(cell ?? '').trim()))
    const [headers, ...values] = rows
    if (!headers?.length || !values.length) throw new Error('Planilha sem cabeçalho ou linhas de dados.')
    for (const line of values) while (line.length < headers.length) line.push('')
    return { headers, values }
  }
  return parseCsv(await file.text())
}
