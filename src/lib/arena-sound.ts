const KEY = "arena-sale-sound";
let context: AudioContext | undefined;
let preference: boolean | undefined;
const listeners = new Set<() => void>();
export const subscribeSound = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const soundEnabled = () => {
  if (preference === undefined) {
    try {
      preference = localStorage.getItem(KEY) === "enabled";
    } catch {
      preference = false;
    }
  }
  return preference;
};
export async function toggleSound() {
  const enabled = !soundEnabled();
  if (enabled) {
    context ??= new AudioContext();
    await context.resume();
  }
  preference = enabled;
  try {
    localStorage.setItem(KEY, enabled ? "enabled" : "disabled");
  } catch {
    // Keep the preference for this session when browser storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}
export async function unlockSound() {
  if (!soundEnabled()) return;
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
}
function ringSaleBell(audio: AudioContext) {
  // Short additive bell; every oscillator disconnects after its envelope.
  [880, 1320, 1760].forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.14 / (index + 1), start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 1.8);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 1.85);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  });
}
export function playSaleBell() {
  if (!soundEnabled() || !context || context.state !== "running") return;
  ringSaleBell(context);
}
export async function previewSaleBell() {
  context ??= new AudioContext();
  if (context.state === "suspended") await context.resume();
  ringSaleBell(context);
}
