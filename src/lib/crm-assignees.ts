export interface CRMAssignee {
  user_id: string
  display_name: string
  role: string
}

export interface CRMCandidate {
  user_id: string
  display_name: string
}

export type CRMAssigneeTarget = 'closer' | 'sdr'

// Mesmos papéis que o banco aceita em schedule_closer_call / crm_transition: quem tem a função (Closer ou SDR)
// mais Executive e Super Admin, que operam as duas áreas. A RPC crm_call_assignees devolve um Executive como
// 'closer' ou como 'executive' conforme a versão, então os dois formatos entram.
const ROLES_BY_TARGET: Record<CRMAssigneeTarget, readonly string[]> = {
  closer: ['closer', 'executive', 'super_admin'],
  sdr: ['sdr', 'executive', 'super_admin'],
}

// Uma única regra para "quem aparece como Closer (ou SDR)" em todos os diálogos do CRM: sem duplicados e em ordem
// alfabética (a RPC vem ordenada por id, que não diz nada pra quem escolhe).
export function candidatesFor(target: CRMAssigneeTarget, assignees: readonly CRMAssignee[]): CRMCandidate[] {
  const roles = ROLES_BY_TARGET[target]
  const seen = new Set<string>()
  const list: CRMCandidate[] = []
  for (const assignee of assignees) {
    if (!roles.includes(assignee.role) || seen.has(assignee.user_id)) continue
    seen.add(assignee.user_id)
    list.push({ user_id: assignee.user_id, display_name: assignee.display_name })
  }
  return list.sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR') || a.user_id.localeCompare(b.user_id))
}
