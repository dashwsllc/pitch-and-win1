import { z } from 'zod';

export const emailSchema = z
  .string({ required_error: 'Informe o e-mail.' })
  .trim()
  .toLowerCase()
  .email('Informe um e-mail válido.')
  .max(254, 'O e-mail é muito longo.');

export const loginPasswordSchema = z
  .string({ required_error: 'Informe a senha.' })
  .min(1, 'Informe a senha.')
  .max(128, 'A senha é muito longa.');

export const strongPasswordSchema = z
  .string({ required_error: 'Informe a senha.' })
  .min(12, 'Use pelo menos 12 caracteres.')
  .max(128, 'A senha é muito longa.')
  .regex(/[a-z]/, 'Inclua uma letra minúscula.')
  .regex(/[A-Z]/, 'Inclua uma letra maiúscula.')
  .regex(/[0-9]/, 'Inclua um número.')
  .regex(/[^A-Za-z0-9]/, 'Inclua um símbolo.');

export const displayNameSchema = z
  .string({ required_error: 'Informe o nome.' })
  .trim()
  .min(2, 'O nome deve ter pelo menos 2 caracteres.')
  .max(120, 'O nome deve ter no máximo 120 caracteres.');

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Confira os dados informados.';
}

export function publicAuthError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível autenticar com os dados informados.';
}
