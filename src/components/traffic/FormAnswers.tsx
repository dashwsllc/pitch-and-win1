import { metaAnswers, prettyAnswer, prettyQuestion } from '@/lib/meta-leads'

/** Respostas escritas do formulário (ou colunas da planilha) exatamente como o lead enviou. */
export function FormAnswers({ fields }: { fields: unknown }) {
  const answers = metaAnswers(fields)
  return answers.length ? <dl className="mt-3 grid gap-3 sm:grid-cols-2">{answers.map((answer, index) =>
    <div key={index} className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{prettyQuestion(answer.label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{answer.value ? prettyAnswer(answer.value) : '—'}</dd></div>,
  )}</dl> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma resposta adicional.</p>
}
