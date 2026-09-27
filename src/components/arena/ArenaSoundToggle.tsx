import { useEffect, useRef, useState } from "react";
import { BellRing, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { isParallelFunnelSale, type ArenaEvent } from "@/lib/arena";

const HORN_SECONDS = 10;
let stopActiveHorn: (() => void) | null = null;

function saturation(amount: number) {
  const curve = new Float32Array(2048);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

// Buzina de ar sintetizada: acorde de sawtooths saturado. A saturação fica no
// fim da cadeia para manter o volume no máximo sem clipar a saída.
function playSaleBell(context: AudioContext) {
  stopActiveHorn?.();
  const start = context.currentTime + 0.01;
  const end = start + HORN_SECONDS;

  const body = context.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 1100;
  body.Q.value = 1.1;
  body.gain.value = 9;
  const drive = context.createWaveShaper();
  drive.curve = saturation(4);
  drive.oversample = "4x";
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4800;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(0.95, start + 0.03);
  master.gain.setValueAtTime(0.95, end - 0.3);
  master.gain.exponentialRampToValueAtTime(0.0001, end);
  body.connect(tone).connect(drive).connect(master).connect(context.destination);

  const oscillators: OscillatorNode[] = [];
  for (const frequency of [311.13, 369.99, 466.16]) {
    for (const detune of [-7, 7]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sawtooth";
      oscillator.detune.value = detune;
      oscillator.frequency.setValueAtTime(frequency * 0.86, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, start + 0.12);
      oscillator.frequency.setValueAtTime(frequency, end - 0.4);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.94, end);
      gain.gain.value = 0.17;
      oscillator.connect(gain).connect(body);
      oscillator.start(start);
      oscillator.stop(end + 0.05);
      oscillators.push(oscillator);
    }
  }

  const stop = () => {
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    for (const oscillator of oscillators) oscillator.stop(now + 0.06);
  };
  stopActiveHorn = stop;
  oscillators[0].onended = () => { if (stopActiveHorn === stop) stopActiveHorn = null; };
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
      stopActiveHorn?.();
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
    {/* Somente o ícone: sem o texto "Soar sino" ao lado. */}
    <Button type="button" variant="outline" size="icon" onClick={() => void triggerBell()}
      className="h-9 w-9 shrink-0 border-ember/40 bg-ember/10 text-ember hover:bg-ember/20 hover:text-ember"
      aria-label="Soar o sino de venda manualmente" title="Soar sino de venda">
      <BellRing aria-hidden="true" />
    </Button>
    <Button type="button" variant="outline" size="sm" onClick={toggle}
      className={`shrink-0 gap-2 border px-3 font-medium ${enabled
        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 hover:text-emerald-100"
        : "border-white/25 bg-white/[0.07] text-white hover:bg-white/[0.13] hover:text-white"}`}
      aria-label={enabled ? "Mutar som da Arena" : "Desmutar som da Arena"}
      aria-pressed={enabled} title={enabled ? "Som alto ligado — clique para mutar" : "Som mutado — clique para desmutar"}>
      {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
      <span>Som</span>
    </Button>
  </>;
}
