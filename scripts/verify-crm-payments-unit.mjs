import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/lib/${specifier.slice(6)}.ts`, import.meta.url).href, context)
  return nextResolve(specifier, context)
} })
const lib = await import('../src/lib/crm-payments.ts')
const plain = text => text.replace(/ /g, ' ')

// Labels and colours' vocabulary: exactly the three statuses the Closer can choose.
assert.deepEqual(lib.PAYMENT_STATUSES.slice().sort(), ['nao_pago', 'pago', 'pendente'])
assert.equal(lib.PAYMENT_STATUS_LABELS.pago, 'Pago')
assert.equal(lib.PAYMENT_STATUS_LABELS.nao_pago, 'Não pago')
assert.equal(lib.PAYMENT_STATUS_LABELS.pendente, 'Pendente')
assert.equal(lib.isPaymentStatus('pago'), true)
assert.equal(lib.isPaymentStatus('quitado'), false)
assert.equal(lib.isPaymentStatus(null), false)
assert.equal(lib.paymentMethodLabel('cartao_credito'), 'Cartão de crédito')
assert.equal(lib.paymentMethodLabel('pix'), 'Pix')
assert.equal(lib.paymentMethodLabel('desconhecida'), 'desconhecida')
assert.equal(lib.paymentMethodLabel(null), 'Não informada')

// Money typed by a person (pt-BR first, en-US tolerated), always > 0 with at most two decimals.
const money = [['500', 500], ['1.234,56', 1234.56], ['R$ 1.200', 1200], [' 99,9 ', 99.9], ['12.50', 12.5], ['1,234.56', 1234.56],
  ['1.500', 1500], ['0,01', 0.01], ['10.000.000', 10000000]]
for (const [text, expected] of money) assert.equal(lib.parseMoneyInput(text), expected, `parse ${text}`)
for (const text of ['', '   ', '0', '0,00', '-5', 'abc', '1,234', '12,345', '1.2.3', '10.000.001', 'R$', '1e3', '12,5,0'])
  assert.equal(lib.parseMoneyInput(text), null, `reject ${text}`)
assert.equal(lib.formatMoneyInput(1234.5), '1234,50')
assert.equal(lib.formatMoneyInput(500), '500,00')

// Lead status: never changes by itself. Every Pago -> Pago; any Não pago -> Não pago; else Pendente; empty -> none.
const row = (status, amount, due = null) => ({ status, amount, due_date: due })
assert.equal(lib.summarizePayments([]).status, null)
assert.equal(lib.summarizePayments([]).count, 0)
let s = lib.summarizePayments([row('pendente', 500, '2026-10-10'), row('pendente', 700, '2026-11-06')])
assert.deepEqual([s.status, s.count, s.pendingCount, s.paidCount, s.unpaidCount, s.total, s.paid, s.nextDue, s.percent], ['pendente', 2, 2, 0, 0, 1200, 0, '2026-10-10', 0])
s = lib.summarizePayments([row('pago', 500, '2026-10-10'), row('pendente', 700, '2026-11-06')])
assert.deepEqual([s.status, s.paidCount, s.paid, s.nextDue, s.percent], ['pendente', 1, 500, '2026-11-06', 42])
s = lib.summarizePayments([row('pago', 500), row('nao_pago', 700)])
assert.deepEqual([s.status, s.unpaidCount, s.paid, s.nextDue], ['nao_pago', 1, 500, null])
s = lib.summarizePayments([row('pago', 500), row('pago', 700.5)])
assert.deepEqual([s.status, s.total, s.paid, s.percent, s.nextDue], ['pago', 1200.5, 1200.5, 100, null])
assert.equal(lib.summarizePayments([row('nao_pago', 10), row('pendente', 10, '2020-01-01')]).status, 'nao_pago')
assert.equal(lib.summarizePayments([row('pendente', 10, '2020-01-01')]).status, 'pendente', 'an overdue pending entry stays Pendente')
assert.equal(lib.summarizePayments([row('pendente', 0.1), row('pago', 0.2)]).total, 0.3, 'cents are summed without float drift')
const fromRpc = lib.paymentSummaryFromRow({ lead_id: 'a', total_count: 3, paid_count: 1, unpaid_count: 0, pending_count: 2,
  total_amount: 3000, paid_amount: 1200, status: 'pendente', next_due_date: '2026-10-20' })
assert.deepEqual([fromRpc.status, fromRpc.count, fromRpc.paidCount, fromRpc.unpaidCount, fromRpc.pendingCount, fromRpc.total, fromRpc.paid, fromRpc.nextDue, fromRpc.percent],
  ['pendente', 3, 1, 0, 2, 3000, 1200, '2026-10-20', 40])
assert.equal(lib.paymentSummaryFromRow({ ...fromRpc, lead_id: 'a', total_count: 1, paid_count: 0, unpaid_count: 0, pending_count: 1,
  total_amount: 10, paid_amount: 0, status: 'estranho', next_due_date: null }).status, null, 'unknown status from the server shows no badge')
assert.equal(plain(lib.paymentSummaryText(lib.summarizePayments([row('pago', 500), row('pago', 700)]))), 'R$ 1.200,00')
assert.equal(plain(lib.paymentSummaryText(lib.summarizePayments([row('pago', 500), row('pendente', 700)]))), 'R$ 500,00 de R$ 1.200,00')

// Entry form: everything checked before the server is called.
const ok = { ...lib.emptyPaymentForm, description: ' Entrada ', amount: '500,00', dueDate: '2026-10-10' }
assert.equal(lib.validatePaymentForm(ok), null)
assert.deepEqual(lib.paymentPayload(ok), { description: 'Entrada', amount: 500, method: 'pix', dueDate: '2026-10-10', notes: null, proofUrl: null })
assert.equal(lib.validatePaymentForm({ ...ok, dueDate: '' }), null)
assert.equal(lib.paymentPayload({ ...ok, dueDate: '', notes: ' obs ', proofUrl: ' https://drive.google.com/file/d/x/view ' }).proofUrl, 'https://drive.google.com/file/d/x/view')
assert.equal(lib.paymentPayload({ ...ok, dueDate: '', notes: ' obs ' }).notes, 'obs')
for (const bad of [{ description: '   ' }, { description: 'x'.repeat(121) }, { amount: '' }, { amount: '0' }, { amount: 'abc' }, { method: 'bitcoin' },
  { dueDate: '2026-02-31' }, { dueDate: '10/10/2026' }, { notes: 'x'.repeat(1001) }, { proofUrl: 'https://evil.test/x' },
  { proofUrl: 'http://drive.google.com/file/d/x' }, { proofUrl: 'https://drive.google.com.evil.test/x' }])
  assert.ok(lib.validatePaymentForm({ ...ok, ...bad }), `reject ${JSON.stringify(bad)}`)
const stored = { id: 'p', lead_id: 'l', description: 'Parcela 1/3', amount: 1234.5, method: 'boleto', due_date: '2026-10-10', status: 'pendente',
  paid_at: null, status_reason: null, proof_url: null, notes: null, created_by: 'u', updated_by: 'u', created_at: '', updated_at: '' }
assert.deepEqual(lib.paymentFormFrom(stored), { description: 'Parcela 1/3', amount: '1234,50', method: 'boleto', dueDate: '2026-10-10', notes: '', proofUrl: '' })

// Status change: Pago needs a real, non-future moment; Não pago and removals need a reason.
const now = Date.parse('2026-10-07T15:00:00Z')
assert.equal(lib.validateStatusChange({ status: 'pago', reason: '', paidAt: '' }, now), null)
assert.equal(lib.validateStatusChange({ status: 'pago', reason: '', paidAt: '2026-10-07T11:30' }, now), null)
assert.ok(lib.validateStatusChange({ status: 'pago', reason: '', paidAt: '2026-10-08T09:00' }, now), 'future paid date')
assert.ok(lib.validateStatusChange({ status: 'pago', reason: '', paidAt: 'ontem' }, now), 'invalid paid date')
assert.equal(lib.validateStatusChange({ status: 'pendente', reason: '', paidAt: '' }, now), null)
assert.ok(lib.validateStatusChange({ status: 'nao_pago', reason: '  ', paidAt: '' }, now))
assert.ok(lib.validateStatusChange({ status: 'nao_pago', reason: 'ab', paidAt: '' }, now))
assert.equal(lib.validateStatusChange({ status: 'nao_pago', reason: 'Cartão recusado', paidAt: '' }, now), null)
assert.ok(lib.validateStatusChange({ status: 'nao_pago', reason: 'x'.repeat(501), paidAt: '' }, now))
assert.equal(lib.validateReason('Lançado por engano'), null)
assert.ok(lib.validateReason(' ab '))
assert.ok(lib.validateReason('x'.repeat(501)))

// Lead timeline: what each payment key shows.
assert.equal(lib.paymentStateValue('payment_status', 'nao_pago'), 'Não pago')
assert.equal(plain(lib.paymentStateValue('payment_amount', 500)), 'R$ 500,00')
assert.equal(lib.paymentStateValue('payment_method', 'boleto'), 'Boleto')
assert.equal(lib.paymentStateValue('payment_due_date', '2026-10-10'), '10/10/2026')
assert.equal(lib.paymentStateValue('payment_paid_at', '2026-10-07T15:30:00+00:00'), '07/10/2026, 12:30')
assert.equal(lib.paymentStateValue('payment_status', null), 'Sem definição')
assert.equal(lib.paymentStateValue('payment_due_date', undefined), 'Sem definição')
console.log('PASS: CRM payments unit contract')
