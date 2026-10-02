import React, { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  actualTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // A Home (src/painel) abre escura por padrão, como o resto do app sempre foi; quem escolheu Claro, Escuro ou
  // Sistema em Configurações continua com a escolha guardada.
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme')
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark'
  })

  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>('dark')

  useEffect(() => {
    const updateTheme = () => {
      let newActualTheme: 'light' | 'dark'
      
      if (theme === 'system') {
        newActualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } else {
        newActualTheme = theme
      }
      
      setActualTheme(newActualTheme)
      
      const root = window.document.documentElement
      root.classList.remove('light', 'dark')
      
      if (newActualTheme === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.add('light')
      }
    }

    updateTheme()
    localStorage.setItem('theme', theme)

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      mediaQuery.addEventListener('change', updateTheme)
      return () => mediaQuery.removeEventListener('change', updateTheme)
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}