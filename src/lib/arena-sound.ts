let context: AudioContext | undefined

// Browsers cannot override the device's volume. Keep the generated signal
// close to full scale without clipping, and run it only from a click.
export async function previewSaleBell() {
  context ??= new AudioContext()
  if (context.state === 'suspended') await context.resume()

  const audio = context
  const compressor = audio.createDynamicsCompressor()
  compressor.threshold.value = -9
  compressor.knee.value = 3
  compressor.ratio.value = 12
  compressor.attack.value = 0.003
  compressor.release.value = 0.22

  const master = audio.createGain()
  master.gain.value = 0.95
  compressor.connect(master).connect(audio.destination)

  const frequencies = [880, 1320, 1760]
  const volumes = [0.62, 0.35, 0.2]
  const start = audio.currentTime
  let remaining = frequencies.length * 2

  for (const offset of [0, 0.27]) {
    frequencies.forEach((frequency, index) => {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      const at = start + offset
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.001, at)
      gain.gain.exponentialRampToValueAtTime(volumes[index], at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.001, at + 1.65)
      oscillator.connect(gain).connect(compressor)
      oscillator.start(at)
      oscillator.stop(at + 1.7)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
        remaining -= 1
        if (remaining === 0) {
          compressor.disconnect()
          master.disconnect()
        }
      }
    })
  }
}
