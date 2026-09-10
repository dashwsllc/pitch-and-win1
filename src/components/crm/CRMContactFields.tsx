import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ATHLETE_POSITIONS, ContactForm } from '@/lib/crm'

export function CRMContactFields({
  value,
  onChange,
  prefix
}: {
  value: ContactForm
  onChange: (value: ContactForm) => void
  prefix: string
}) {
  const field = (
    key: keyof ContactForm,
    label: string,
    type = 'text',
    required = false,
    min?: string,
    max?: string
  ) => (
    <div className="space-y-2" key={key}>
      <Label htmlFor={`${prefix}-${key}`}>
        {label}
        {required ? ' *' : ''}
      </Label>
      <Input
        id={`${prefix}-${key}`}
        type={type}
        required={required}
        min={min}
        max={max}
        step={type === 'number' ? '0.1' : undefined}
        maxLength={
          key === 'email' ? 254 : key === 'phone' ? 32 : key === 'performance_report_url' ? 2048 : 160
        }
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  )
  return (
    <div className="space-y-4">
      <p className="font-semibold text-sm">Dados do responsável</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'Nome do responsável', 'text', true)}
        {field('phone', 'WhatsApp', 'tel', true)}
        {field('email', 'E-mail', 'email', true)}
        {field('city_state', 'Cidade / UF')}
      </div>
      <p className="font-semibold text-sm">Dados do atleta</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('athlete_name', 'Nome do atleta', 'text', true)}
        {field('athlete_birth_date', 'Data de nascimento', 'date', true, '1900-01-01')}
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-position`}>Posição em campo *</Label>
          <select
            id={`${prefix}-position`}
            required
            value={value.athlete_position}
            onChange={(e) => onChange({ ...value, athlete_position: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Selecionar</option>
            {ATHLETE_POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        {field('athlete_height_cm', 'Altura (cm)', 'number', false, '30', '250')}
        {field('athlete_weight_kg', 'Peso (kg)', 'number', false, '1', '300')}
      </div>
      {field('performance_report_url', 'Link do relatório de performance', 'url')}
      <p className="text-xs text-muted-foreground">Altura, peso e relatório são opcionais.</p>
    </div>
  )
}
