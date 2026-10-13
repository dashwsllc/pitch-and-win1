import { prettyAnswer } from '@/lib/meta-leads'
import { categorizedSourceAnswers, sourceQuestionLabel } from '@/lib/lead-source-context'

/** Respostas escritas do formulário (ou colunas da planilha) exatamente como o lead enviou. */
export function FormAnswers({ fields }: { fields: unknown }) {
  const groups = categorizedSourceAnswers(fields)
  return groups.length ? <div className="mt-3 space-y-4">{groups.map(group =>
    <section key={group.category} aria-label={group.category} className="space-y-2">
      <h3 className="text-sm font-semibold">{group.category}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">{group.answers.map((answer, index) =>
        <div key={index} className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="text-xs leading-5 text-muted-foreground">{sourceQuestionLabel(answer.label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{answer.value ? prettyAnswer(answer.value) : 'Não informado na origem'}</dd></div>,
      )}</dl>
    </section>,
  )}</div> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma resposta adicional.</p>
}
