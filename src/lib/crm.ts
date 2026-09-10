import type { CRMLead } from "@/hooks/useCRM";

export const ATHLETE_POSITIONS = [
  "Goleiro",
  "Zagueiro",
  "Lateral",
  "Volante",
  "Meia",
  "Atacante",
];
export const emptyContact = {
  name: "",
  phone: "",
  email: "",
  city_state: "",
  athlete_name: "",
  athlete_birth_date: "",
  athlete_position: "",
  athlete_height_cm: "",
  athlete_weight_kg: "",
  performance_report_url: "",
};
export type ContactForm = typeof emptyContact;
export function contactFromLead(lead: CRMLead): ContactForm {
  return Object.fromEntries(
    Object.keys(emptyContact).map((key) => [
      key,
      String(lead[key as keyof ContactForm] ?? ""),
    ]),
  ) as ContactForm;
}
export function contactPayload(form: ContactForm) {
  return {
    ...form,
    name: form.name.trim(),
    phone: form.phone.trim(),
    email: form.email.trim() || null,
    athlete_birth_date: form.athlete_birth_date || null,
    athlete_position: form.athlete_position || null,
    athlete_name: form.athlete_name.trim(),
    athlete_height_cm:
      form.athlete_height_cm === "" ? null : Number(form.athlete_height_cm),
    athlete_weight_kg:
      form.athlete_weight_kg === "" ? null : Number(form.athlete_weight_kg),
    performance_report_url: form.performance_report_url.trim() || null,
    city_state: form.city_state.trim() || null,
  };
}
export function validateContact(form: ContactForm) {
  if (form.name.trim().length < 2 || form.athlete_name.trim().length < 2)
    return "Informe os nomes do responsável e do atleta (mínimo de 2 caracteres).";
  if (form.phone.trim().length < 8 || form.phone.trim().length > 32)
    return "Informe um WhatsApp válido.";
  if (
    form.email.trim() &&
    !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(form.email.trim())
  )
    return "Informe um e-mail válido.";
  const date = new Date(`${form.athlete_birth_date}T00:00:00`);
  if (
    form.athlete_birth_date &&
    (!Number.isFinite(+date) ||
      date > new Date() ||
      form.athlete_birth_date < "1900-01-01")
  )
    return "Informe uma data de nascimento válida, sem data futura.";
  if (
    form.athlete_position &&
    !ATHLETE_POSITIONS.includes(form.athlete_position)
  )
    return "Selecione uma posição válida.";
  if (
    form.athlete_height_cm !== "" &&
    (!Number.isFinite(Number(form.athlete_height_cm)) ||
      Number(form.athlete_height_cm) < 30 ||
      Number(form.athlete_height_cm) > 250)
  )
    return "Altura deve ficar entre 30 e 250 cm.";
  if (
    form.athlete_weight_kg !== "" &&
    (!Number.isFinite(Number(form.athlete_weight_kg)) ||
      Number(form.athlete_weight_kg) < 1 ||
      Number(form.athlete_weight_kg) > 300)
  )
    return "Peso deve ficar entre 1 e 300 kg.";
  if (
    form.performance_report_url &&
    !/^https:\/\/[^/\s]+/.test(form.performance_report_url)
  )
    return "Use um link HTTPS para o relatório.";
  return null;
}

export const callDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Sem horário";
