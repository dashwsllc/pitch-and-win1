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
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-lg">Relatório de Permissões</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-2">
        <p className="text-xs leading-4 text-muted-foreground">
          Sellers sem SDR ou Closer trabalham nas duas áreas. Funções
          específicas definem a área operacional. Contas suspensas permanecem
          bloqueadas.
        </p>
        <Input
          className="h-9"
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
        <div className="grid items-start gap-2 xl:grid-cols-2">
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
                  className="min-w-0 space-y-1 rounded-md border p-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <p className="text-sm font-medium break-words">
                      {u.display_name || u.user_id}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {roles.map((r) => ROLE_LABELS[r]).join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {u.suspended ? (
                      <Badge className="h-5 px-2 text-[10px]" variant="destructive">Suspenso</Badge>
                    ) : (
                      Object.entries(access)
                        .filter(([, enabled]) => enabled)
                        .map(([key]) => (
                          <Badge className="h-5 px-2 text-[10px]" key={key} variant="secondary">
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
                      <Badge className="h-5 px-2 text-[10px]" variant="outline">Sem acesso CRM</Badge>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
        {!loading && !error && !users.length && (
          <p>Nenhum usuário encontrado.</p>
        )}
      </CardContent>
    </Card>
  );
}
