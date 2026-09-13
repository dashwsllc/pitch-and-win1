import assert from 'node:assert/strict'
import { convertContextTxt, CONTEXT_FILE_TYPE_ERROR } from '../src/lib/crm-context-file.ts'

const original = '\uFEFF  [12/09/2026, 10:01] José: Olá 😀\r\n\t*valor*: R$ 20,00\r\nhttps://drive.google.com/file/d/example/view\r\n<script>literal</script>  \r\n'
const converted = await convertContextTxt(new File([original], 'WhatsApp.TXT', { type: 'text/plain' }))
assert.equal(converted.file.name, 'WhatsApp.md')
assert.equal(converted.file.type, 'text/markdown')
assert.equal(converted.content, original)
assert.deepEqual(new Uint8Array(await converted.file.arrayBuffer()), new TextEncoder().encode(original))
for (const [name, type] of [['video.mp4','video/mp4'], ['photo.jpg','image/jpeg'], ['note.md','text/markdown'], ['data.csv','text/csv'], ['photo.txt','image/png']]) {
  await assert.rejects(convertContextTxt(new File(['data'], name, { type })), error => error.message === CONTEXT_FILE_TYPE_ERROR)
}
await assert.rejects(convertContextTxt(new File([new Uint8Array([0x89,0x50,0x4e,0x47])], 'fake.txt')), /UTF-8/)
await assert.rejects(convertContextTxt(new File(['binary\u0000data'], 'fake.txt')), /texto válido/)
await assert.rejects(convertContextTxt(new File([' \r\n\t'], 'empty.txt')), /vazio/)
await assert.rejects(convertContextTxt(new File(['x'.repeat(50001)], 'long.txt')), /excede/)
await assert.rejects(convertContextTxt(new File(['x'.repeat(262145)], 'large.txt')), /256 KB/)
const utf16 = new Uint8Array([0xff,0xfe,...Buffer.from('Olá\r\n', 'utf16le')])
assert.equal((await convertContextTxt(new File([utf16], 'utf16.txt'))).content, '\uFEFFOlá\r\n')
assert.equal((await convertContextTxt(new File(['😀'.repeat(50000)], 'emoji.txt'))).content, '😀'.repeat(50000))
console.log('PASS: faithful UTF-8/UTF-16 → Markdown, BOM/CRLF/whitespace/emoji preservation, text-only file types, binary rejection and limits')
