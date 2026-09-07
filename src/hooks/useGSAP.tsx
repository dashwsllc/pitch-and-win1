import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

export function useGSAP() {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    // Initialize Lenis smooth scroll
    const lenis = new Lenis({
      duration: 0.9,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.9,
    })

    lenisRef.current = lenis

    // Connect Lenis to GSAP ScrollTrigger
    lenis.on('scroll', ScrollTrigger.update)

    const updateLenis = (time: number) => {
      lenis.raf(time * 1000)
    }

    gsap.ticker.add(updateLenis)

    return () => {
      gsap.ticker.remove(updateLenis)
      lenis.off('scroll', ScrollTrigger.update)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  return { lenis: lenisRef }
}

export function useScrollReveal(ref: React.RefObject<HTMLElement>, options?: { stagger?: number; delay?: number }) {
  useEffect(() => {
    if (!ref.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const children = ref.current.children

    const context = gsap.context(() => {
      gsap.fromTo(children,
        { opacity: 0, y: 24 },
        {
          opacity: 1,
          y: 0,
          duration: 0.55,
          stagger: options?.stagger || 0.08,
          delay: options?.delay || 0,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: ref.current,
            start: 'top 88%',
            once: true,
          }
        }
      )
    }, ref)

    return () => context.revert()
  }, [ref, options?.stagger, options?.delay])
}
