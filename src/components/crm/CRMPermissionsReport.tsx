import { useState } from "react";
import { useAllUsers, useRoles, ROLE_LABELS } from "@/hooks/useRoles";
import { crmCapabilities } from "@/lib/crm-capabilities";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/sales";

export function CRMPermissionsReport() {
  const { isExecutive } = useRoles();
  const { users, loading, error, refetch } = useAllUsers();
  const [search, setSearch] = useState("");
  if (!isExecutive)
    return <p role="alert">Acesso restrito a executive e super_admin.</p>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatório de Permissões</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Sellers sem SDR ou Closer trabalham nas duas áreas. Funções
          específicas definem a área operacional. Contas suspensas permanecem
          bloqueadas.
        </p>
        <Input
          aria-label="Buscar usuário no relatório"
          placeholder="Buscar usuário"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {loading && <p role="status">Carregando permissões...</p>}
        {error && (
          <div role="alert">
            {errorMessage(error)}{" "}
            <Button variant="outline" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}
        {users
          .filter((u) =>
            `${u.display_name} ${u.email}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((u) => {
            const roles = u.user_roles.map((r) => r.role);
            const access = crmCapabilities(
              roles,
              u.user_roles.some((r) => r.crm_access),
              !u.suspended,
            );
            return (
              <article
                key={u.user_id}
                className="rounded-lg border p-4 space-y-2 min-w-0"
              >
                <p className="font-medium break-words">
                  {u.display_name || u.user_id}
                </p>
                <p className="text-xs text-muted-foreground">
                  {roles.map((r) => ROLE_LABELS[r]).join(", ")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {u.suspended ? (
                    <Badge variant="destructive">Suspenso</Badge>
                  ) : (
                    Object.entries(access)
                      .filter(([, enabled]) => enabled)
                      .map(([key]) => (
                        <Badge key={key} variant="secondary">
                          {
                            {
                              admin: "Gerenciar Usuários + Permissões",
                              leads: "Leads",
                              sdr: "SDR",
                              closer: "Closer",
                              sales: "Vendas",
                            }[key]
                          }
                        </Badge>
                      ))
                  )}
                  {!u.suspended && !access.leads && (
                    <Badge variant="outline">Sem acesso CRM</Badge>
                  )}
                </div>
              </article>
            );
          })}
        {!loading && !error && !users.length && (
          <p>Nenhum usuário encontrado.</p>
        )}
      </CardContent>
    </Card>
  );
}
