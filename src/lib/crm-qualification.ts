export const INCOME_RANGES = [
  { value: "ate_3k", label: "Até R$ 3 mil" },
  { value: "3k_5k", label: "R$ 3 mil a R$ 5 mil" },
  { value: "5k_10k", label: "R$ 5 mil a R$ 10 mil" },
  { value: "10k_20k", label: "R$ 10 mil a R$ 20 mil" },
  { value: "acima_20k", label: "Acima de R$ 20 mil" },
  { value: "nao_informado", label: "Não informado" },
] as const;

export const DECISION_MAKERS = [
  { value: "proprio", label: "O próprio lead decide" },
  { value: "pais_responsaveis", label: "Pais ou responsáveis decidem" },
  { value: "compartilhada", label: "Decisão compartilhada" },
  { value: "outro", label: "Outro decisor" },
  { value: "nao_identificado", label: "Ainda não identificado" },
] as const;

export const PURCHASE_TIMELINES = [
  { value: "imediato", label: "Imediato" },
  { value: "ate_30_dias", label: "Até 30 dias" },
  { value: "31_90_dias", label: "31 a 90 dias" },
  { value: "acima_90_dias", label: "Acima de 90 dias" },
  { value: "sem_previsao", label: "Sem previsão" },
] as const;

export const REMARKETING_STATUS_LABELS: Record<string, string> = {
  pending: "Aguardando planejamento",
  scheduled: "Follow-up agendado",
  nurturing: "Em acompanhamento",
  reactivated: "Reativado",
  do_not_contact: "Não contatar",
};

export function optionLabel(
  options: readonly { value: string; label: string }[],
  value?: string | null,
) {
  return options.find((option) => option.value === value)?.label ?? value ?? "";
}

