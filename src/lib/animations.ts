import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function staggerReveal(selector: string | Element[], container?: string | Element) {
  const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : selector
  
  gsap.fromTo(elements, 
    { opacity: 0, y: 40 },
    { 
      opacity: 1, 
      y: 0, 
      duration: 0.6, 
      stagger: 0.1, 
      ease: 'power2.out',
      scrollTrigger: container ? {
        trigger: container,
        start: 'top 85%',
        toggleActions: 'play none none none'
      } : undefined
    }
  )
}

export function scaleReveal(selector: string | Element[], delay = 0) {
  const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : selector
  
  gsap.fromTo(elements,
    { opacity: 0, scale: 0.8 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      delay,
      stagger: 0.15,
      ease: 'back.out(1.7)'
    }
  )
}

export function slideFromLeft(selector: string | Element[]) {
  const elements = typeof selector === 'string' ? document.querySelectorAll(selector) : selector
  
  gsap.fromTo(elements,
    { opacity: 0, x: -50 },
    {
      opacity: 1,
      x: 0,
      duration: 0.6,
      stagger: 0.08,
      ease: 'power2.out'
    }
  )
}

export function animateProgress(element: Element, targetPercent: number) {
  gsap.fromTo(element,
    { width: '0%' },
    {
      width: `${Math.min(targetPercent, 100)}%`,
      duration: 1.2,
      ease: 'power2.out'
    }
  )
}

export function glowPulse(element: Element) {
  gsap.to(element, {
    boxShadow: '0 0 25px rgba(253, 137, 37, 0.5), inset 0 0 0 1px rgba(255, 142, 93, 0.2)',
    duration: 1,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut'
  })
}

export function numberCountUp(element: Element, target: number, duration = 1.5) {
  const obj = { value: 0 }
  gsap.to(obj, {
    value: target,
    duration,
    ease: 'power1.out',
    onUpdate: () => {
      element.textContent = Math.round(obj.value).toLocaleString('pt-BR')
    }
  })
}

export function podiumReveal(selector: string) {
  const elements = document.querySelectorAll(selector)
  if (elements.length < 3) return
  
  const tl = gsap.timeline()
  
  // 3rd place first
  tl.fromTo(elements[2], { opacity: 0, y: 60, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.7)' })
  // 2nd place
  tl.fromTo(elements[1], { opacity: 0, y: 60, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.7)' }, '-=0.3')
  // 1st place - most dramatic
  tl.fromTo(elements[0], { opacity: 0, y: 80, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(2)' }, '-=0.3')
}
