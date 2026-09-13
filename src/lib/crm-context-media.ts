export const MAX_CONTEXT_MEDIA_URL_LENGTH = 2048

export const CONTEXT_MEDIA_URL_ERROR =
  'Cole um link compartilhável válido do Google Drive, começando com https://drive.google.com/.'

export function normalizeContextMediaUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const hasControlCharacter = Array.from(trimmed).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
  if (trimmed.length > MAX_CONTEXT_MEDIA_URL_LENGTH || /\s/u.test(trimmed) || hasControlCharacter) {
    throw new Error(CONTEXT_MEDIA_URL_ERROR)
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(CONTEXT_MEDIA_URL_ERROR)
  }

  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'drive.google.com' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname === '/'
  ) {
    throw new Error(CONTEXT_MEDIA_URL_ERROR)
  }

  return url.toString()
}
