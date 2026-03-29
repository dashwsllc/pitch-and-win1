# SQL para executar no Supabase Dashboard

## Como executar

1. Acesse: https://supabase.com/dashboard/project/mbzwchnxtskysqplqiyy
2. Vá em **SQL Editor**
3. Cole e execute o conteúdo do arquivo `supabase/migrations/20260329080000_complete_audit_fix.sql`

## O que essa migration faz

### Correção Crítica do Bug de Saldo
- Atualiza a função `get_available_balance` para filtrar `withdrawn = false`
  - **Antes**: somava todas as comissões aprovadas (incluindo já sacadas)
  - **Depois**: soma apenas comissões aprovadas E ainda não sacadas

### Tabela `saques` (nova estrutura)
- Cria a tabela `saques` com o schema correto compatível com o código:
  - `valor_solicitado`, `chave_pix`, `tipo_chave_pix`, `nome_titular`, `cpf_titular`
  - `status`, `motivo_rejeicao`, `previsao_pagamento`, `pago_em`
  - `revisado_por`, `revisado_em`, `vendas_incluidas`
- RLS configurado: vendedores veem apenas seus saques, executives veem todos

### Campos `withdrawn` na tabela `vendas`
- `withdrawn boolean DEFAULT false` - controla se a comissão foi incluída em um saque
- `withdrawn_at timestamptz` - quando foi incluída
- `withdrawal_id uuid` - qual saque incluiu essa comissão

### Nova função `get_pending_commission`
- Calcula a soma das comissões pendentes de aprovação do vendedor

### Correção de RLS em `vendas`
- Sellers podem atualizar apenas suas próprias vendas com status `pendente`
- Executives podem atualizar qualquer venda
- Remove a policy antiga muito permissiva

## Verificação pós-execução

Execute no SQL Editor para confirmar:

```sql
-- Verificar função de saldo disponível
SELECT get_available_balance('SEU-USER-ID-AQUI');

-- Verificar função de comissão pendente  
SELECT get_pending_commission('SEU-USER-ID-AQUI');

-- Verificar estrutura da tabela saques
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'saques' AND table_schema = 'public'
ORDER BY ordinal_position;

-- Verificar estrutura da tabela vendas (campos novos)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vendas' AND table_schema = 'public'
ORDER BY ordinal_position;
```
