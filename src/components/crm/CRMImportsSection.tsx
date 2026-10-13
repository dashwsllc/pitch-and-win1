import { Button } from '@/components/ui/button'
import type { CRMLead } from '@/hooks/useCRM'
import { matchesCRMImport, type ImportSection, type ImportMethodFilter } from '@/lib/crm-imports'

export function CRMImportsSection({ leads, section, method, onSection, onMethod }: {
  leads: CRMLead[]; section: ImportSection; method: ImportMethodFilter
  onSection: (value: ImportSection) => void; onMethod: (value: ImportMethodFilter) => void
}) {
  return <section className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="Importações do SDR">
    <div><h2 className="font-semibold">Importações · SDR</h2><p className="mt-1 text-xs text-muted-foreground">Contatos aprovados, com dados e contexto da origem. Recebimentos mais recentes primeiro · data e horário de Brasília.</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Origem dos leads importados">
      {([{value:'all',label:'Todas'}, {value:'form',label:'Formulários'}, {value:'website',label:'Site / conversão direta'}] as const).map(item =>
        <Button key={item.value} size="sm" variant={section === item.value ? 'default' : 'outline'} aria-pressed={section === item.value} onClick={() => onSection(item.value)}>
          {item.label} · {leads.filter(lead => matchesCRMImport(lead, item.value, 'all')).length}
        </Button>)}
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Forma de entrada dos leads importados">
      {([{value:'all',label:'Automáticas e manuais'}, {value:'automatic',label:'Automáticas'}, {value:'manual',label:'Manuais'}] as const).map(item =>
        <Button key={item.value} size="sm" variant={method === item.value ? 'secondary' : 'ghost'} aria-pressed={method === item.value} onClick={() => onMethod(item.value)}>{item.label}</Button>)}
    </div>
  </section>
}
