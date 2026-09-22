import { useMemo } from 'react'
import { useAllUsers } from './useRoles'

const SALES_ROLES = new Set(['seller', 'closer', 'executive', 'super_admin'])

export function useSaleAssignees(enabled = true) {
  const directory = useAllUsers(enabled)
  const assignees = useMemo(() => directory.users
    .filter(account => !account.suspended && account.user_roles.some(role => SALES_ROLES.has(role.role)))
    .map(account => ({
      user_id: account.user_id,
      display_name: account.display_name?.trim() || account.email?.trim() || 'Usuário sem nome',
      avatar_url: account.avatar_url,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR')),
  [directory.users])

  return { ...directory, assignees }
}
