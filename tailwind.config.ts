import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        gold: "hsl(var(--gold))",
        silver: "hsl(var(--silver))",
        bronze: "hsl(var(--bronze))",
        role: {
          admin: "hsl(var(--role-admin))",
          closer: "hsl(var(--role-closer))",
          sdr: "hsl(var(--role-sdr))",
          bdr: "hsl(var(--role-bdr))",
          traffic: "hsl(var(--role-traffic))",
          seller: "hsl(var(--role-seller))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        ember: {
          DEFAULT: 'hsl(27 98% 57%)',
          dark: 'hsl(18 100% 50%)',
          scorch: 'hsl(8 100% 59%)',
          glow: 'hsl(8 31% 25%)',
        },
        electric: {
          DEFAULT: 'hsl(207 93% 40%)',
          violet: 'hsl(265 80% 53%)',
        },
        void: {
          base: 'hsl(264 64% 5%)',
          elevated: 'hsl(261 24% 11%)',
          panel: 'hsl(261 25% 12%)',
          shell: 'hsl(264 11% 18%)',
        },
        ash: 'hsl(0 2% 81%)',
        fog: 'hsl(0 3% 60%)',
      },
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-success": "var(--gradient-success)",  
        "gradient-card": "var(--gradient-card)",
        "gradient-ember": "linear-gradient(30deg, rgb(253, 137, 37), rgb(255, 12, 0))",
        "gradient-electric": "linear-gradient(141deg, rgb(7, 122, 199), rgb(107, 33, 239))",
      },
      background: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-success": "var(--gradient-success)",
        "gradient-card": "var(--gradient-card)",
        "gradient-ember": "var(--gradient-ember)",
        "gradient-electric": "var(--gradient-electric)",
      },
      boxShadow: {
        "glow": "var(--shadow-glow)",
        "card": "var(--shadow-card)",
        "subtle": "var(--shadow-subtle)",
        "inset-glow": "var(--shadow-inset-glow)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "pulse-glow": {
          "0%, 100%": { 
            boxShadow: "0 0 20px hsl(262 83% 58% / 0.3)"
          },
          "50%": { 
            boxShadow: "0 0 40px hsl(262 83% 58% / 0.6)"
          }
        },
        "bounce-medal": {
          "0%, 20%, 50%, 80%, 100%": { transform: "translateY(0)" },
          "40%": { transform: "translateY(-10px)" },
          "60%": { transform: "translateY(-5px)" }
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "glow-ember": {
          "0%, 100%": { boxShadow: "0 0 5px rgba(253, 137, 37, 0.3)" },
          "50%": { boxShadow: "0 0 25px rgba(253, 137, 37, 0.5)" },
        },
        "rank-slide": {
          "0%": { opacity: "0", transform: "translateX(-30px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "progress-fill": {
          from: { width: "0%" },
          to: { width: "var(--progress-width, 100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out",
        "slide-up": "slide-up 0.4s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "bounce-medal": "bounce-medal 2s ease-in-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "glow-ember": "glow-ember 2s ease-in-out infinite",
        "rank-slide": "rank-slide 0.5s ease-out forwards",
        "float": "float 3s ease-in-out infinite",
        "progress-fill": "progress-fill 1.5s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
