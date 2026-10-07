// Fonte única de quais etapas do CRM encerram o atendimento, quais mandam o lead para remarketing e como cada resultado é
// escrito. Estas listas estavam copiadas em sete arquivos (cartão, quadro, resultados, notificações, ordenação, estado das
// calls e a própria tela): quando uma etapa muda, todos têm de mudar juntos, então ela vive aqui.

/** Etapas em que o atendimento acabou (ganho, venda recusada ou lead perdido). */
export const CLOSED_STAGES = ['fechado_ganho', 'fechado_perdido', 'lead_perdido'] as const
/** Etapas negativas: o lead não comprou e segue para o remarketing. */
export const NEGATIVE_STAGES = ['fechado_perdido', 'lead_perdido'] as const

export function isClosedStage(pipelineStage: string | null | undefined) {
  return !!pipelineStage && (CLOSED_STAGES as readonly string[]).includes(pipelineStage)
}

export function isNegativeStage(pipelineStage: string | null | undefined) {
  return !!pipelineStage && (NEGATIVE_STAGES as readonly string[]).includes(pipelineStage)
}

// Os resultados que o banco aceita em crm_leads.last_result_outcome (venda_concluida, venda_perdida, lead_perdido) e nas
// calls (avancou, followup_sdr, followup, repassado_closer, devolvido_sdr, além dos três acima). "Venda recusada" é o
// nome que o time usa para venda_perdida em todas as telas; lead_perdido é outra coisa (o SDR encerrou o lead sem chegar
// à venda) e nunca pode aparecer como "Venda recusada".
const OUTCOME_LABELS: Record<string, string> = {
  venda_concluida: 'Venda concluída',
  venda_perdida: 'Venda recusada',
  lead_perdido: 'Lead perdido',
  avancou: 'Avançou',
  followup: 'Follow-up necessário',
  followup_sdr: 'Follow-up do SDR',
  repassado_closer: 'Enviado ao Closer',
  devolvido_sdr: 'Devolvido ao SDR',
}

/** O texto de um resultado ou desfecho de call; um valor que o app não conhece sai como veio (nunca vazio). */
export function outcomeLabel(outcome: string | null | undefined) {
  if (!outcome) return null
  return OUTCOME_LABELS[outcome] ?? outcome
}
