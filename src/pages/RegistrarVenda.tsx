import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { ShoppingCart, ArrowLeft, Info, Clock, Package } from "lucide-react";
import { useProducts } from "@/hooks/useProducts";
import { errorMessage, money } from "@/lib/sales";

export default function RegistrarVenda() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadId = searchParams.get("lead");
  const [leadLoading, setLeadLoading] = useState(!!leadId);
  const [leadError, setLeadError] = useState("");
  const [linkedLead, setLinkedLead] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const { user } = useAuth();
  const { commissionRate, loading: rolesLoading, isExecutive } = useRoles();
  const catalog = useProducts();
  const queryClient = useQueryClient();
  const submitting = useRef(false);
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  const [produtoSelecionado, setProdutoSelecionado] = useState("");
  const [valorSelecionado, setValorSelecionado] = useState("");
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null);
  const [nomeComprador, setNomeComprador] = useState("");
  const [whatsappComprador, setWhatsappComprador] = useState("");
  const [emailComprador, setEmailComprador] = useState("");

  useEffect(() => {
    let active = true;
    setLinkedLead(null);
    setLeadError("");
    setLeadLoading(!!leadId);
    if (!leadId) return;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        leadId,
      )
    ) {
      setLeadError("Lead inválido. Abra a venda pela ficha do CRM.");
      setLeadLoading(false);
      return;
    }
    void supabase
      .from("crm_leads")
      .select("id,name,email,phone,pipeline_stage")
      .eq("id", leadId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        setLeadLoading(false);
        if (error || !data || data.pipeline_stage !== "fechado_ganho") {
          setLeadError(
            "Não foi possível vincular o lead. Confirme o acesso e a venda concluída no CRM.",
          );
          return;
        }
        setLinkedLead(data);
        setNomeComprador(data.name);
        setWhatsappComprador(data.phone || "");
        setEmailComprador(data.email || "");
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  const products = (catalog.data ?? []).filter(
    (product) =>
      product.active && product.product_tickets.some((ticket) => ticket.active),
  );
  const product = products.find((item) => item.id === produtoSelecionado);
  const tickets = (product?.product_tickets ?? [])
    .filter((ticket) => ticket.active)
    .sort((a, b) => a.price - b.price);
  const ticket = tickets.find((item) => item.id === valorSelecionado);
  const valorNumerico = ticket?.price ?? 0;
  const comissaoEstimada = (valorNumerico * commissionRate) / 100;

  useEffect(() => {
    if (!catalog.data || !produtoSelecionado) return;
    if (!product || (valorSelecionado && !ticket)) {
      if (!product) setProdutoSelecionado("");
      setValorSelecionado("");
      setSelectedPrice(null);
      toast({
        title: "Catálogo atualizado",
        description:
          "O produto ou ticket selecionado foi desativado. Escolha uma opção disponível.",
      });
    } else if (
      ticket &&
      selectedPrice !== null &&
      selectedPrice !== ticket.price
    ) {
      setSelectedPrice(ticket.price);
      toast({
        title: "Preço do ticket atualizado",
        description: `Confira o novo valor de ${money(ticket.price)} antes de registrar a venda.`,
      });
    }
  }, [
    catalog.data,
    produtoSelecionado,
    valorSelecionado,
    product,
    ticket,
    selectedPrice,
    toast,
  ]);

  const resetForm = () => {
    setProdutoSelecionado("");
    setValorSelecionado("");
    setSelectedPrice(null);
    setNomeComprador("");
    setWhatsappComprador("");
    setEmailComprador("");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting.current) return;
    if (!user) {
      toast({
        title: "Erro de autenticação",
        description: "Você precisa estar logado para registrar uma venda.",
        variant: "destructive",
      });
      return;
    }

    if (leadId && (leadLoading || leadError || linkedLead?.id !== leadId)) {
      toast({
        title: "Vínculo com lead indisponível",
        description: "Confira o lead no CRM antes de registrar.",
        variant: "destructive",
      });
      return;
    }

    // Validate all fields before submitting
    if (catalog.isError || catalog.isPending) {
      toast({
        title: "Catálogo indisponível",
        description: "Atualize o catálogo antes de registrar a venda.",
        variant: "destructive",
      });
      return;
    }
    if (!product) {
      toast({
        title: "Campo obrigatório",
        description: "Selecione o produto vendido.",
        variant: "destructive",
      });
      return;
    }
    if (!ticket) {
      toast({
        title: "Campo obrigatório",
        description: "Selecione um ticket ativo para este produto.",
        variant: "destructive",
      });
      return;
    }
    if (!nomeComprador.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "Informe o nome do comprador.",
        variant: "destructive",
      });
      return;
    }
    if (!whatsappComprador.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "Informe o WhatsApp do comprador.",
        variant: "destructive",
      });
      return;
    }
    if (!emailComprador.trim()) {
      toast({
        title: "Campo obrigatório",
        description: "Informe o email do comprador.",
        variant: "destructive",
      });
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);

    try {
      const { error } = await supabase.from("vendas").insert([
        {
          user_id: user.id,
          ...(linkedLead ? { crm_lead_id: linkedLead.id } : {}),
          product_id: product.id,
          ticket_id: ticket.id,
          nome_produto: product.name,
          valor_venda: ticket.price,
          nome_comprador: nomeComprador.trim(),
          whatsapp_comprador: whatsappComprador.trim(),
          email_comprador: emailComprador.trim(),
        },
      ]);

      if (error) {
        throw error;
      }

      toast({
        title: "Venda registrada com sucesso!",
        description:
          "Aguardando aprovação do executive. O saldo será atualizado após a validação.",
      });
      setJustRegistered(true);
      void queryClient.invalidateQueries({ queryKey: ["sales-board"] });
      void queryClient.invalidateQueries({ queryKey: ["crm"] });
      window.dispatchEvent(new Event("dashboard-data-changed"));
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
      toast({
        title: "Erro ao registrar venda",
        description: errorMessage(error),
        variant: "destructive",
      });
      void catalog.refetch();
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-success flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Registrar Venda
              </h1>
              <p className="text-muted-foreground">
                Registre uma nova venda realizada
              </p>
            </div>
          </div>
        </div>

        {isExecutive && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Gerencie os produtos e valores disponíveis para sua equipe.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate("/executive?tab=products")}
            >
              <Package className="mr-2 h-4 w-4" />
              Produtos e tickets
            </Button>
          </div>
        )}
        {leadLoading && (
          <p role="status" className="mb-4">
            Carregando lead...
          </p>
        )}
        {leadError && (
          <p role="alert" className="mb-4 text-destructive">
            {leadError}
          </p>
        )}
        {linkedLead && (
          <div className="mb-4 rounded border p-4 text-sm">
            Venda vinculada ao lead: <strong>{linkedLead.name}</strong>. Confira
            os dados e selecione produto e ticket.
          </div>
        )}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-foreground">Dados da Venda</CardTitle>
          </CardHeader>
          <CardContent>
            {catalog.isPending && (
              <p role="status" className="mb-4 text-sm text-muted-foreground">
                Carregando produtos e tickets...
              </p>
            )}
            {catalog.isError && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-destructive/10 p-4"
              >
                <p className="text-sm text-destructive">
                  Não foi possível carregar o catálogo. Tente novamente antes de
                  registrar a venda.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  disabled={catalog.isFetching}
                  onClick={() => catalog.refetch()}
                >
                  Atualizar catálogo
                </Button>
              </div>
            )}
            {!catalog.isPending &&
              !catalog.isError &&
              products.length === 0 && (
                <p className="mb-4 rounded-lg border p-4 text-sm text-muted-foreground">
                  Nenhum produto com ticket ativo disponível.{" "}
                  {isExecutive
                    ? "Cadastre um produto e ticket pelo botão acima."
                    : "Aguarde o executive disponibilizar produtos e tickets para venda."}
                </p>
              )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="sale-product">
                    Nome Do Produto Vendido *
                  </Label>
                  <Select
                    value={produtoSelecionado}
                    onValueChange={(value) => {
                      setProdutoSelecionado(value);
                      setValorSelecionado("");
                      setSelectedPrice(null);
                    }}
                    disabled={
                      isSubmitting ||
                      catalog.isPending ||
                      catalog.isError ||
                      !products.length
                    }
                  >
                    <SelectTrigger id="sale-product" className="w-full">
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((produto) => (
                        <SelectItem key={produto.id} value={produto.id}>
                          {produto.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {product?.description && (
                    <p className="text-xs text-muted-foreground">
                      {product.description}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sale-ticket">Ticket e valor da venda *</Label>
                  <Select
                    value={valorSelecionado}
                    onValueChange={(value) => {
                      setValorSelecionado(value);
                      setSelectedPrice(
                        tickets.find((item) => item.id === value)?.price ??
                          null,
                      );
                    }}
                    disabled={isSubmitting || !product || catalog.isError}
                  >
                    <SelectTrigger id="sale-ticket" className="w-full">
                      <SelectValue
                        placeholder={
                          product
                            ? "Selecione o ticket"
                            : "Selecione primeiro o produto"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {tickets.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} — {money(item.price)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Commission Info — somente leitura */}
              {ticket && !rolesLoading && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                  <Info className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">
                      Sua taxa de comissão:{" "}
                    </span>
                    <span className="font-semibold text-foreground">
                      {commissionRate}%
                    </span>
                    <span className="text-muted-foreground ml-2">
                      &mdash; Comissão desta venda:{" "}
                    </span>
                    <span className="font-bold text-green-400">
                      {new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(comissaoEstimada)}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="nome_comprador">Nome Do Comprador *</Label>
                <Input
                  id="nome_comprador"
                  value={nomeComprador}
                  onChange={(e) => setNomeComprador(e.target.value)}
                  placeholder="Nome completo do cliente"
                  required
                  className="w-full"
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp_comprador">
                    WhatsApp Do Comprador *
                  </Label>
                  <Input
                    id="whatsapp_comprador"
                    value={whatsappComprador}
                    onChange={(e) => setWhatsappComprador(e.target.value)}
                    placeholder="(11) 99999-9999"
                    required
                    className="w-full"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email_comprador">Email Do Comprador *</Label>
                  <Input
                    id="email_comprador"
                    value={emailComprador}
                    onChange={(e) => setEmailComprador(e.target.value)}
                    type="email"
                    placeholder="cliente@email.com"
                    required
                    className="w-full"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/")}
                  className="flex-1 md:flex-none"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    rolesLoading ||
                    catalog.isPending ||
                    catalog.isError ||
                    !ticket ||
                    !product ||
                    leadLoading ||
                    !!leadError ||
                    (!!leadId && linkedLead?.id !== leadId)
                  }
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
                  <p className="font-medium text-foreground">
                    Venda registrada! Aguardando aprovação
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Sua venda foi enviada para validação do executive. Seu saldo
                    será atualizado após a aprovação. Acompanhe o status em{" "}
                    <a href="/minhas-vendas" className="text-primary underline">
                      Minhas Vendas
                    </a>
                    .
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
