import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, ArrowLeft, Info, Clock, CalendarClock, Package } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { errorMessage, money } from "@/lib/sales";
import { RecentSalesManagement } from "@/components/sales/RecentSalesManagement";
import { refreshSalesData } from "@/lib/sync";
import { lerValorEmReais, valorParaBanco, valorParaCampo } from "@/lib/valor-reais";

const OUTRO_PRODUTO = "__outro__";
const EMAIL_VALIDO = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

interface LeadVinculado {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  pipeline_stage: string;
  version: number;
  deposit_amount: number | null;
}

/**
 * Registrar venda. O produto do catálogo é opcional (ou pode ser digitado), o ticket é um valor informado em reais,
 * e nome e WhatsApp do comprador são obrigatórios. O pagamento pode ser integral ou com sinal; no faturamento a venda
 * conta pelo valor total. A venda continua nascendo pendente, para aprovação do executive.
 */
export default function RegistrarVenda() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadId = searchParams.get("lead");
  const [leadLoading, setLeadLoading] = useState(!!leadId);
  const [leadError, setLeadError] = useState("");
  const [linkedLead, setLinkedLead] = useState<LeadVinculado | null>(null);
  const { user } = useAuth();
  const { commissionRate, loading: rolesLoading, isExecutive, hasRole } = useRoles();
  const catalog = useProducts();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState("");
  const [produtoDigitado, setProdutoDigitado] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [pagamento, setPagamento] = useState<"integral" | "sinal" | "">("");
  const [valorDoSinal, setValorDoSinal] = useState("");
  const [nomeComprador, setNomeComprador] = useState("");
  const [whatsappComprador, setWhatsappComprador] = useState("");
  const [emailComprador, setEmailComprador] = useState("");

  useEffect(() => {
    let active = true;
    setLinkedLead(null);
    setLeadError("");
    setLeadLoading(!!leadId);
    if (!leadId) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      setLeadError("Lead inválido. Abra a venda pela ficha do CRM ou pela Agenda.");
      setLeadLoading(false);
      return;
    }
    void supabase
      .from("crm_leads")
      .select("id,name,email,phone,pipeline_stage,version,deposit_amount")
      .eq("id", leadId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        setLeadLoading(false);
        // Vale a venda concluída no CRM ou o lead que pagou sinal e ainda está com o Closer.
        const comSinal = data?.pipeline_stage === "repassado_closer" && data.deposit_amount != null;
        if (error || !data || (data.pipeline_stage !== "fechado_ganho" && !comSinal)) {
          setLeadError("Não foi possível vincular o lead. Confirme o acesso e a venda concluída (ou o sinal) no CRM.");
          return;
        }
        setLinkedLead(data);
        setNomeComprador(data.name);
        setWhatsappComprador(data.phone || "");
        setEmailComprador(data.email || "");
        if (data.deposit_amount != null) {
          setPagamento("sinal");
          setValorDoSinal(valorParaCampo(data.deposit_amount));
        }
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  const products = (catalog.data ?? []).filter((product) => product.active);
  const product = products.find((item) => item.id === produtoSelecionado);

  const total = lerValorEmReais(valorTotal);
  const sinal = pagamento === "sinal" ? lerValorEmReais(valorDoSinal) : null;
  const faltaReceber = total !== null && sinal !== null ? Math.max(0, total - sinal) : null;
  const comissaoEstimada = total !== null ? (total * commissionRate) / 100 : null;

  const resetForm = () => {
    setProdutoSelecionado("");
    setProdutoDigitado("");
    setValorTotal("");
    setPagamento("");
    setValorDoSinal("");
    setNomeComprador("");
    setWhatsappComprador("");
    setEmailComprador("");
  };

  const avisar = (description: string) => toast({ title: "Confira a venda", description, variant: "destructive" });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!user) {
      toast({ title: "Erro de autenticação", description: "Você precisa estar logado para registrar uma venda.", variant: "destructive" });
      return;
    }
    if (leadId && (leadLoading || leadError || linkedLead?.id !== leadId)) {
      avisar("Confira o lead no CRM antes de registrar.");
      return;
    }
    // O valor digitado no ticket é o total que entra no faturamento.
    if (total === null) return avisar("Informe o valor total da venda (ex.: 2.997,00).");
    if (pagamento === "sinal") {
      if (sinal === null) return avisar("Informe quanto foi pago de sinal.");
      if (sinal > total) return avisar("O sinal não pode ser maior que o valor total da venda.");
    }
    if (nomeComprador.trim().length < 2) return avisar("O nome do comprador precisa de pelo menos 2 letras.");
    const whatsapp = whatsappComprador.trim();
    if (whatsapp.length < 8 || whatsapp.length > 32) return avisar("Confira o WhatsApp do comprador (de 8 a 32 caracteres).");
    if (emailComprador.trim() && !EMAIL_VALIDO.test(emailComprador.trim())) return avisar("Confira o e-mail do comprador.");

    submitting.current = true;
    setIsSubmitting(true);
    try {
      // Lead com sinal que ainda está com o Closer: registrar a venda conclui a venda no CRM primeiro.
      if (linkedLead && linkedLead.pipeline_stage === "repassado_closer") {
        const { error } = await supabase.rpc("crm_transition", {
          p_lead_id: linkedLead.id,
          p_action: "close",
          p_expected_version: linkedLead.version,
          p_data: { outcome: "venda_concluida", note: "Venda registrada após o sinal" },
        });
        if (error) throw error;
      }
      const produtoDoCatalogo = product && produtoSelecionado !== OUTRO_PRODUTO ? product : null;
      const { error } = await supabase.from("vendas").insert([
        {
          user_id: user.id,
          ...(linkedLead ? { crm_lead_id: linkedLead.id } : {}),
          product_id: produtoDoCatalogo?.id ?? null,
          ticket_id: null,
          nome_produto: produtoDoCatalogo?.name ?? produtoDigitado.trim(),
          valor_venda: total,
          payment_type: pagamento === "sinal" ? "sinal" : "integral",
          deposit_amount: pagamento === "sinal" && sinal !== null ? Number(valorParaBanco(sinal)) : null,
          nome_comprador: nomeComprador.trim(),
          whatsapp_comprador: whatsapp,
          email_comprador: emailComprador.trim(),
        },
      ]);
      if (error) throw error;

      toast({
        title: "Venda registrada com sucesso!",
        description: isExecutive
          ? "A venda foi enviada para validação e já está disponível no painel de vendas."
          : "Aguardando aprovação do executive. O saldo será atualizado após a validação.",
      });
      setJustRegistered(true);
      await refreshSalesData(queryClient);
      resetForm();
      setLinkedLead(null);
      setSearchParams(
        (params) => {
          params.delete("lead");
          return params;
        },
        { replace: true },
      );
      setTimeout(() => setJustRegistered(false), 8000);
    } catch (error: unknown) {
      console.error("Erro ao registrar venda:", error);
      toast({ title: "Erro ao registrar venda", description: errorMessage(error), variant: "destructive" });
      void catalog.refetch();
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  const seletor = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60";

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-success flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Registrar Venda</h1>
              <p className="text-muted-foreground">Registre uma nova venda realizada</p>
            </div>
          </div>
        </div>

        {hasRole('super_admin') && (
          <Button
            variant="outline"
            className="w-full justify-start gap-2 border-amber-400/30 bg-amber-400/[0.07] text-amber-100 hover:bg-amber-400/[0.12] sm:w-auto"
            onClick={() => document.getElementById('vendas-registradas')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            <CalendarClock className="h-4 w-4" />
            Ver vendas registradas e corrigir data da compra
          </Button>
        )}

        {isExecutive && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">Gerencie os produtos e valores disponíveis para sua equipe.</p>
            <Button variant="outline" onClick={() => navigate("/executive?tab=products")}>
              <Package className="mr-2 h-4 w-4" />
              Produtos e tickets
            </Button>
          </div>
        )}
        {leadLoading && <p role="status" className="mb-4">Carregando lead...</p>}
        {leadError && <p role="alert" className="mb-4 text-destructive">{leadError}</p>}
        {linkedLead && (
          <div className="mb-4 rounded border p-4 text-sm">
            Venda vinculada ao lead: <strong>{linkedLead.name}</strong>.
            {linkedLead.deposit_amount != null && (
              <> Sinal já pago: <strong>{money(linkedLead.deposit_amount)}</strong>.</>
            )}
            {linkedLead.pipeline_stage === "repassado_closer" && " Ao registrar, a venda é concluída no CRM."}
          </div>
        )}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Dados da Venda</CardTitle>
          </CardHeader>
          <CardContent>
            {catalog.isError && (
              <div role="alert" className="mb-4 rounded-lg bg-destructive/10 p-4">
                <p className="text-sm text-destructive">
                  Não foi possível carregar o catálogo. Você pode digitar o produto e o valor, ou tentar de novo.
                </p>
                <Button type="button" variant="outline" className="mt-3" disabled={catalog.isFetching} onClick={() => catalog.refetch()}>
                  Atualizar catálogo
                </Button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sale-product">Produto vendido</Label>
                  <select
                    id="sale-product"
                    className={seletor}
                    value={produtoSelecionado}
                    onChange={(e) => setProdutoSelecionado(e.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="">Sem produto do catálogo</option>
                    {products.map((produto) => (
                      <option key={produto.id} value={produto.id}>{produto.name}</option>
                    ))}
                    <option value={OUTRO_PRODUTO}>Outro (digitar o nome)</option>
                  </select>
                  {(produtoSelecionado === OUTRO_PRODUTO || produtoSelecionado === "") && (
                    <Input
                      aria-label="Nome do produto"
                      value={produtoDigitado}
                      onChange={(e) => setProdutoDigitado(e.target.value)}
                      placeholder="Nome do produto (opcional)"
                      maxLength={160}
                      disabled={isSubmitting}
                    />
                  )}
                  {product?.description && <p className="text-xs text-muted-foreground">{product.description}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sale-ticket">Ticket (R$) *</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground" aria-hidden="true">R$</span>
                    <Input
                      id="sale-ticket"
                      inputMode="decimal"
                      required
                      value={valorTotal}
                      onChange={(e) => setValorTotal(e.target.value)}
                      placeholder="Ex.: 2.997,00"
                      className="pl-10"
                      disabled={isSubmitting}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Digite o valor total da venda em reais. É o valor que entra no faturamento, mesmo quando o cliente pagou só o sinal.</p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <fieldset className="space-y-2" disabled={isSubmitting}>
                  <legend className="mb-2 text-sm font-medium leading-none">Pagamento</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Pagamento">
                    {([
                      ["integral", "Valor completo"],
                      ["sinal", "Sinal"],
                    ] as const).map(([valor, rotulo]) => (
                      <label
                        key={valor}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${pagamento === valor ? "border-primary bg-primary/10" : "hover:bg-muted/40"}`}
                      >
                        <input type="radio" name="pagamento" value={valor} checked={pagamento === valor} onChange={() => setPagamento(valor)} />
                        {rotulo}
                      </label>
                    ))}
                  </div>
                  {pagamento === "sinal" && (
                    <div className="space-y-1 pt-1">
                      <Label htmlFor="valor-sinal">Quanto foi pago de sinal (R$) *</Label>
                      <Input id="valor-sinal" inputMode="decimal" value={valorDoSinal} onChange={(e) => setValorDoSinal(e.target.value)} placeholder="Ex.: 500,00" />
                      {faltaReceber !== null && (
                        <p className="text-xs text-muted-foreground">Falta receber {money(faltaReceber)}.</p>
                      )}
                    </div>
                  )}
                </fieldset>
              </div>

              {/* Comissão — somente leitura */}
              {comissaoEstimada !== null && !rolesLoading && !isExecutive && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <Info className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">Sua taxa de comissão: </span>
                    <span className="font-semibold text-foreground">{commissionRate}%</span>
                    <span className="text-muted-foreground ml-2">&mdash; Comissão desta venda: </span>
                    <span className="font-bold text-green-400">{money(comissaoEstimada)}</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="nome_comprador">Nome do comprador *</Label>
                <Input id="nome_comprador" required minLength={2} value={nomeComprador} onChange={(e) => setNomeComprador(e.target.value)} placeholder="Nome completo do cliente" maxLength={160} className="w-full" />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp_comprador">WhatsApp do comprador *</Label>
                  <Input id="whatsapp_comprador" type="tel" required minLength={8} value={whatsappComprador} onChange={(e) => setWhatsappComprador(e.target.value)} placeholder="(11) 99999-9999" maxLength={32} className="w-full" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_comprador">E-mail do comprador</Label>
                  <Input id="email_comprador" value={emailComprador} onChange={(e) => setEmailComprador(e.target.value)} type="email" placeholder="cliente@email.com (opcional)" maxLength={254} className="w-full" />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button type="button" variant="outline" onClick={() => navigate("/")} className="flex-1 md:flex-none">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || rolesLoading || leadLoading || !!leadError || (!!leadId && linkedLead?.id !== leadId)}
                  className="flex-1 md:flex-none bg-gradient-success hover:opacity-90"
                >
                  {isSubmitting ? "Registrando..." : "Registrar Venda"}
                </Button>
              </div>
            </form>

            {/* Banner de sucesso após registro */}
            {justRegistered && (
              <div className="mt-4 p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20 flex items-start gap-3 animate-fade-in">
                <Clock className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Venda registrada! Aguardando aprovação</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isExecutive ? (
                      "A venda foi enviada para validação e já está disponível no painel de vendas."
                    ) : (
                      <>
                        Sua venda foi enviada para validação do executive. Seu saldo será atualizado após a aprovação.
                        Acompanhe o status em{" "}
                        <a href="/minhas-vendas" className="text-primary underline">Minhas Vendas</a>.
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <RecentSalesManagement />
      </div>
    </DashboardLayout>
  );
}
