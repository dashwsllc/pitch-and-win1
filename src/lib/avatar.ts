export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

const ALLOWED_AVATAR_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

async function hasValidImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if (file.type === 'image/png') {
    return bytes
      .slice(0, 8)
      .every(
        (byte, index) =>
          byte === [137, 80, 78, 71, 13, 10, 26, 10][index],
      )
  }
  if (file.type === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (file.type === 'image/webp') {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    )
  }
  return false
}

export async function validateAvatarFile(file: File) {
  const extension = ALLOWED_AVATAR_TYPES.get(file.type)
  if (
    !extension ||
    file.size < 1 ||
    file.size > AVATAR_MAX_BYTES ||
    !(await hasValidImageSignature(file))
  ) {
    throw new Error('Use uma imagem PNG, JPG ou WEBP válida de até 2 MB.')
  }
  return extension
}

export function avatarObjectPath(
  publicUrl: string | null | undefined,
  userId: string,
) {
  if (!publicUrl) return null
  try {
    const marker = '/storage/v1/object/public/avatars/'
    const pathname = new URL(publicUrl).pathname
    const markerAt = pathname.indexOf(marker)
    if (markerAt < 0) return null
    const path = decodeURIComponent(pathname.slice(markerAt + marker.length))
    if (!path.startsWith(`${userId}/`) || path.includes('..')) return null
    return path
  } catch {
    return null
  }
}
