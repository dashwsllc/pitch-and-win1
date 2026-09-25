import { useEffect, useRef, useState } from "react";
import { BellRing, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { isParallelFunnelSale, type ArenaEvent } from "@/lib/arena";

function playSaleBell(context: AudioContext) {
  const started = context.currentTime;
  for (const [frequency, offset] of [[660, 0], [880, 0.13]]) {
    const note = context.createOscillator();
    const gain = context.createGain();
    note.type = "sine";
    note.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, started + offset);
    gain.gain.exponentialRampToValueAtTime(0.12, started + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, started + offset + 0.24);
    note.connect(gain).connect(context.destination);
    note.start(started + offset);
    note.stop(started + offset + 0.25);
  }
}

export function ArenaSoundToggle() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());
  const storageKey = user ? `arena-sale-sound:${user.id}` : null;

  useEffect(() => {
    let saved = false;
    try { saved = !!storageKey && localStorage.getItem(storageKey) === "on"; }
    catch { /* Private browsing may deny local storage. */ }
    enabledRef.current = saved;
    setEnabled(saved);
    seen.current.clear();
  }, [storageKey]);

  useEffect(() => {
    if (!enabled || !user) return;
    const prepare = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch { /* Audio remains muted if the browser has no output device. */ }
    };
    // Browsers require a user gesture before allowing playback after reload.
    window.addEventListener("pointerdown", prepare, { once: true });
    return () => window.removeEventListener("pointerdown", prepare);
  }, [enabled, user]);

  useEffect(() => {
    const receive = (raw: Event) => {
      const event = (raw as CustomEvent<ArenaEvent>).detail;
      // Toca para vendas fechadas por Closer e também para vendas avulsas
      // (funil paralelo, sem lead do CRM), não só para o funil SDR → Closer.
      if (!enabledRef.current || event.action_type !== "sale.approved" ||
        event.provenance !== "live" ||
        (event.responsible_role !== "closer" && !isParallelFunnelSale(event)) ||
        seen.current.has(event.id)) return;
      seen.current.add(event.id);
      if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value!);
      const context = audio.current;
      if (!context || context.state !== "running") return;
      playSaleBell(context);
    };
    window.addEventListener("arena-fresh-event", receive);
    return () => window.removeEventListener("arena-fresh-event", receive);
  }, []);

  useEffect(() => () => {
    const context = audio.current;
    audio.current = null;
    void context?.close();
  }, []);

  const toggle = () => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    setEnabled(next);
    try { if (storageKey) localStorage.setItem(storageKey, next ? "on" : "off"); }
    catch { /* The current page still keeps the selected state. */ }
    if (next) {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume();
      } catch { /* The icon remains available to retry after device recovery. */ }
    } else if (audio.current) {
      void audio.current.suspend();
    }
  };

  const triggerBell = async () => {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      if (audio.current.state !== "running") throw new Error("Áudio indisponível");
      playSaleBell(audio.current);
      window.dispatchEvent(new Event("arena-manual-sale-bell"));
    } catch {
      toast.error("Não foi possível tocar o sino. Verifique o áudio do navegador.");
    }
  };

  return <>
    {/* Somente o ícone: sem o texto "Soar sino" ao lado, mas com o mesmo
        clique e som de antes. */}
    <Button type="button" variant="outline" size="icon" onClick={() => void triggerBell()}
      className="h-9 w-9 shrink-0 border-ember/40 bg-ember/10 text-ember hover:bg-ember/20 hover:text-ember"
      aria-label="Soar o sino de venda manualmente" title="Soar sino de venda">
      <BellRing aria-hidden="true" />
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={toggle}
      className={`shrink-0 gap-2 border px-3 font-medium ${enabled
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 hover:text-emerald-100"
        : "border-white/25 bg-white/[0.07] text-white hover:bg-white/[0.13] hover:text-white"}`}
      aria-label={enabled ? "Desligar avisos sonoros automáticos da Arena" : "Ligar avisos sonoros automáticos da Arena"}
      aria-pressed={enabled} title={enabled ? "Avisos automáticos ligados" : "Avisos automáticos desligados"}>
      {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      <span>Som auto {enabled ? "ligado" : "desligado"}</span>
    </Button>
  </>;
}
