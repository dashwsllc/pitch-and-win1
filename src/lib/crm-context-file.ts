export const MAX_CONTEXT_LENGTH = 50_000
export const MAX_CONTEXT_FILE_BYTES = 256 * 1024
export const CONTEXT_FILE_TYPE_ERROR = 'Apenas arquivos .txt são aceitos aqui. Vídeos e fotos devem ser enviados por link no contexto.'

export interface CRMContextFile {
  sourceName: string
  file: File
  content: string
}

export function validateContextFileText(text: string) {
  if (!text.trim()) throw new Error('O arquivo está vazio.')
  if (Array.from(text).length > MAX_CONTEXT_LENGTH) {
    throw new Error('O conteúdo excede 50.000 caracteres. Divida-o em arquivos menores.')
  }
  // Reject binary/control data, rather than silently deleting it from the source.
  if (Array.from(text).some(char => {
    const code = char.codePointAt(0)!
    return code < 32 && ![9, 10, 13].includes(code)
  })) throw new Error('O arquivo não contém texto válido. Exporte a conversa como .txt.')
  return text
}

export async function convertContextTxt(file: File): Promise<CRMContextFile> {
  if (!/\.txt$/i.test(file.name) || (file.type && file.type !== 'text/plain' && file.type !== 'application/octet-stream')) {
    throw new Error(CONTEXT_FILE_TYPE_ERROR)
  }
  if (file.size < 1 || file.size > MAX_CONTEXT_FILE_BYTES) throw new Error('Use um arquivo .txt de até 256 KB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  let text: string
  try {
    // Fatal decoding avoids silently replacing accents or other original text.
    // Preserve the BOM, whitespace, line endings, timestamps and message order.
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error('Não foi possível ler o texto. Salve o .txt em UTF-8 e tente novamente.')
  }
  validateContextFileText(text)
  const name = file.name.replace(/\.txt$/i, '.md')
  return { sourceName: file.name, content: text, file: new File([text], name, { type: 'text/markdown' }) }
}

export function downloadContextMarkdown(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
