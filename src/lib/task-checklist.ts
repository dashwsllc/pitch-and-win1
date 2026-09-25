import type { Json } from "@/integrations/supabase/types";

export interface TaskChecklistItem {
  id: string;
  text: string;
  done: boolean;
  completed_at: string | null;
}

export function taskChecklistItems(value: Json): TaskChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, Json | undefined>;
    if (typeof item.id !== "string" || typeof item.text !== "string" || typeof item.done !== "boolean") return [];
    return [{ id: item.id, text: item.text, done: item.done,
      completed_at: typeof item.completed_at === "string" ? item.completed_at : null }];
  });
}

export function taskTimeRemaining(deadline: string, now: number) {
  const difference = Date.parse(deadline) - now;
  const seconds = Math.floor(Math.abs(difference) / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  const clock = days ? `${days}d ${hours}h ${minutes}min` : `${hours}h ${minutes}min ${remainder}s`;
  return difference >= 0 ? `Restam ${clock}` : `Atrasada há ${clock}`;
}
