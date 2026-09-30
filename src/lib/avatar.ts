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

// Avatars are drawn at 32-96 px, yet uploads may be up to 2 MB and every ranking,
// sales card and header downloads them. Re-encoding on the client keeps each
// picture to a few KB. Any decoder/encoder limitation returns the original file,
// so a picture can never fail to upload because of this step.
const AVATAR_MIN_SIDE_PX = 256
const AVATAR_MAX_SIDE_PX = 1024
const AVATAR_SKIP_BELOW_BYTES = 60 * 1024
const AVATAR_WEBP_QUALITY = 0.86

export async function optimizeAvatar(file: File, extension: string): Promise<{ file: File; extension: string }> {
  const original = { file, extension }
  if (file.size <= AVATAR_SKIP_BELOW_BYTES) return original
  try {
    const bitmap = await createImageBitmap(file)
    try {
      const shortSide = Math.min(bitmap.width, bitmap.height)
      const longSide = Math.max(bitmap.width, bitmap.height)
      if (!shortSide) return original
      const scale = Math.min(1, AVATAR_MIN_SIDE_PX / shortSide, AVATAR_MAX_SIDE_PX / longSide)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return original
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', AVATAR_WEBP_QUALITY))
      // Browsers without WebP encoding silently return PNG; never make the file larger.
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return original
      return { file: new File([blob], 'avatar.webp', { type: 'image/webp' }), extension: 'webp' }
    } finally {
      bitmap.close()
    }
  } catch {
    return original
  }
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
