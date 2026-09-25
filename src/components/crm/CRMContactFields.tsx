import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ATHLETE_POSITIONS, ContactForm } from "@/lib/crm";
import { MAX_ATHLETE_AGE, MIN_ATHLETE_AGE, ageFromBirthDate, athleteAgeConflict } from "@/lib/crm-age";

export function CRMContactFields({
  value,
  onChange,
  prefix,
  requireComplete = false,
}: {
  value: ContactForm;
  onChange: (value: ContactForm) => void;
  prefix: string;
  requireComplete?: boolean;
}) {
  const field = (
    key: keyof ContactForm,
    label: string,
    type = "text",
    required = false,
    min?: string,
    max?: string,
  ) => (
    <div className="space-y-1" key={key}>
      <Label className="text-xs" htmlFor={`${prefix}-${key}`}>
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        id={`${prefix}-${key}`}
        type={type}
        required={required}
        min={min}
        max={max}
        step={type === "number" ? (key === "athlete_age" ? "1" : "0.1") : undefined}
        maxLength={
          key === "email"
            ? 254
            : key === "phone"
              ? 32
              : key === "performance_report_url"
                ? 2048
                : 160
        }
        value={value[key]}
        className="h-9 text-sm"
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );
  const calculatedAge = ageFromBirthDate(value.athlete_birth_date);
  const ageConflict = athleteAgeConflict({
    athlete_birth_date: value.athlete_birth_date,
    athlete_age: value.athlete_age === "" ? null : Number(value.athlete_age),
  });
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados do responsável</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {field("name", "Nome do responsável", "text", true)}
        {field("phone", "WhatsApp", "tel", true)}
        {field("email", requireComplete ? "E-mail" : "E-mail (opcional)", "email", requireComplete)}
        {field("city_state", "Cidade / UF")}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados do atleta</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {field("athlete_name", "Nome do atleta", "text", true)}
        {field(
          "athlete_birth_date",
          "Data de nascimento",
          "date",
          requireComplete,
          "1900-01-01",
        )}
        <div className="space-y-1">
          {field(
            "athlete_age",
            "Idade do atleta",
            "number",
            false,
            String(MIN_ATHLETE_AGE),
            String(MAX_ATHLETE_AGE),
          )}
          {calculatedAge !== null ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              Pela data de nascimento: {calculatedAge}{" "}
              {calculatedAge === 1 ? "ano" : "anos"}. Esse cálculo tem
              prioridade sobre a idade digitada.
            </p>
          ) : (
            <p className="text-[11px] leading-4 text-muted-foreground">
              Use quando não houver data de nascimento. Informar a idade não
              registra uma data de nascimento.
            </p>
          )}
          {ageConflict && (
            <p role="status" className="text-[11px] leading-4 text-amber-400">
              A data de nascimento indica {ageConflict.calculated}{" "}
              {ageConflict.calculated === 1 ? "ano" : "anos"} e a idade digitada
              é {ageConflict.informed}. O CRM exibirá{" "}
              {ageConflict.calculated}.
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`${prefix}-position`}>Posição em campo</Label>
          <select
            id={`${prefix}-position`}
            required={requireComplete}
            value={value.athlete_position}
            onChange={(e) =>
              onChange({ ...value, athlete_position: e.target.value })
            }
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            <option value="">Selecionar</option>
            {ATHLETE_POSITIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        {field(
          "athlete_height_cm",
          "Altura (cm)",
          "number",
          false,
          "30",
          "250",
        )}
        {field("athlete_weight_kg", "Peso (kg)", "number", false, "1", "300")}
      </div>
      {field(
        "performance_report_url",
        "Link do relatório de performance",
        "url",
      )}
      <p className="text-[11px] leading-4 text-muted-foreground">
        {requireComplete
          ? "Para importar no CRM, complete responsável, WhatsApp, e-mail, atleta, nascimento e posição."
          : "Somente responsável, atleta e WhatsApp são obrigatórios. Complete os demais dados quando estiverem disponíveis."}
      </p>
    </div>
  );
}
