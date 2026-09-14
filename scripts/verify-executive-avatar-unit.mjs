import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  avatarObjectPath,
  validateAvatarFile,
} from '../src/lib/avatar.ts'

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
const png = new File([pngBytes], 'avatar.png', { type: 'image/png' })
assert.equal(await validateAvatarFile(png), 'png')
await assert.rejects(
  validateAvatarFile(new File(['not an image'], 'fake.png', { type: 'image/png' })),
  /PNG, JPG ou WEBP/,
)
await assert.rejects(
  validateAvatarFile(new File([pngBytes], 'avatar.gif', { type: 'image/gif' })),
  /PNG, JPG ou WEBP/,
)

const userId = '01234567-89ab-4cde-8fab-0123456789ab'
const storedUrl = `https://project.supabase.co/storage/v1/object/public/avatars/${userId}/avatar.png`
assert.equal(avatarObjectPath(storedUrl, userId), `${userId}/avatar.png`)
assert.equal(avatarObjectPath('https://example.com/avatar.png', userId), null)
assert.equal(
  avatarObjectPath(
    'https://project.supabase.co/storage/v1/object/public/avatars/another/avatar.png',
    userId,
  ),
  null,
)

const managementSource = readFileSync(
  new URL('../src/components/executive/ExecutiveUserManagement.tsx', import.meta.url),
  'utf8',
)
assert.doesNotMatch(managementSource, /Foto de perfil \(URL HTTPS\)/)
assert.doesNotMatch(managementSource, /id="account-avatar"/)
assert.match(managementSource, /Selecionar da galeria/)
assert.match(managementSource, /accept="image\/png,image\/jpeg,image\/webp"/)

console.log('PASS: member avatar file validation, safe object cleanup and gallery-only account UI.')
