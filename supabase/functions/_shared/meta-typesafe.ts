import type { ChoiceAnswer, ExtractedLeadFields } from './meta-lead-extract.ts'
import type { GraphBudget } from './meta-graph.ts'

export async function callJev(criteria: Record<string, string>, instructions: Partial<Record<keyof ExtractedLeadFields, string>>, budget: GraphBudget): Promise<Record<string, ChoiceAnswer>> {
  const apiKey = Deno.env.get('TYPESAFE_API_KEY')
  if (!apiKey) throw new Error('TypeSafe não configurado')
  const keys = Object.keys(instructions)
  if (!keys.length) return {}
  if (Object.keys(criteria).length > 255) throw new Error('Limite de opções TypeSafe excedido')
  const remaining = budget.deadlineMs - Date.now()
  if (remaining <= 0 || budget.signal?.aborted) throw new Error('Orçamento TypeSafe esgotado')
  const controller = new AbortController(), abort = () => controller.abort()
  budget.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, Math.min(3000, remaining))
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'Formulário de captação de leads (agência esportiva) via Meta Lead Ads.', model: 'jev-latest',
        questions: Object.fromEntries(keys.map(key => [key, { type: 'choice', instructions: instructions[key as keyof ExtractedLeadFields], criteria }])) }),
    })
    if (!response.ok) throw new Error(`TypeSafe indisponível (${response.status})`)
    const data = await response.json()
    return Object.fromEntries(keys.map(key => {
      const answer = data?.answers?.[key]
      return [key, { choice: typeof answer?.choice === 'string' ? answer.choice : '', confidence: typeof answer?.confidence === 'number' ? answer.confidence : 0 }]
    }))
  } finally {
    clearTimeout(timer)
    budget.signal?.removeEventListener('abort', abort)
  }
}
