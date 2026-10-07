import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/lib/')) return nextResolve(new URL(`../src/lib/${specifier.slice(6)}.ts`, import.meta.url).href, context)
  return nextResolve(specifier, context)
} })
const { isPaymentStatus, paymentStateValue } = await import('../src/lib/crm-payments.ts')
for (const status of ['pago', 'pendente', 'nao_pago']) assert.equal(isPaymentStatus(status), true)
for (const invalid of [null, undefined, '', 'quitado', 'Pago', 0, {}, ' pendente']) assert.equal(isPaymentStatus(invalid), false)
for (const [value, expected] of [['pago', 'Pago'], ['nao_pago', 'Não pago'], ['pendente', 'Pendente'], [null, 'Sem definição'], ['unknown', 'unknown']]) {
  assert.equal(paymentStateValue('payment_status', value), expected)
}
// Old history remains readable after removing installment forms.
assert.equal(paymentStateValue('payment_amount', 1500).replace(/\u00a0/g, ' '), 'R$ 1.500,00')
assert.equal(paymentStateValue('payment_method', 'cartao_credito'), 'Cartão de crédito')
assert.equal(paymentStateValue('payment_method', 'legacy'), 'legacy')
assert.equal(paymentStateValue('payment_due_date', '2026-10-07'), '07/10/2026')
assert.equal(paymentStateValue('payment_paid_at', '2026-10-07T15:30:00.000Z'), '07/10/2026, 12:30')
console.log('PASS: payment status validation and current/legacy timeline formatting.')
