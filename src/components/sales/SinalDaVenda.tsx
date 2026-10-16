import { money } from '@/lib/sales'

/** Venda com sinal: quanto já foi pago e quanto falta. A venda conta pelo valor total no faturamento. */
export function SinalDaVenda({ venda, className = '' }: { venda: { valor_venda: number; payment_type?: string | null; deposit_amount?: number | null }; className?: string }) {
  if (venda.payment_type !== 'sinal' || venda.deposit_amount == null) return null
  const falta = Math.max(0, Number(venda.valor_venda) - Number(venda.deposit_amount))
  return (
    <p className={`text-[11px] leading-4 text-amber-300 ${className}`}>
      Sinal {money(Number(venda.deposit_amount))} · falta {money(falta)}
    </p>
  )
}
