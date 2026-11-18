import type { Config } from 'tailwindcss';

/** Every colour is a design token defined in src/index.css (light + .dark), so opacity
 *  modifiers (`bg-primary/10`) and dark mode work everywhere without per-page overrides. */
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        surface: token('surface'),
        sidebar: {
          DEFAULT: token('sidebar'),
          foreground: token('sidebar-foreground'),
          muted: token('sidebar-muted'),
          border: token('sidebar-border'),
          active: token('sidebar-active'),
        },
        profit: token('profit'),
        loss: token('loss'),
        warning: token('warning'),
        info: token('info'),
        navy: token('navy'),
        teal: token('teal'),
        chart: {
          1: token('chart-1'),
          2: token('chart-2'),
          3: token('chart-3'),
          4: token('chart-4'),
          5: token('chart-5'),
          6: token('chart-6'),
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI Variable Text',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
      borderRadius: {
        '2xl': '1.1rem',
        xl: '0.9rem',
        lg: '0.7rem',
        md: '0.5rem',
        sm: '0.35rem',
      },
      fontSize: {
        '2xs': ['0.68rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        // soft, layered "elevated" shadows tinted with the ink colour
        xs: '0 1px 2px 0 hsl(var(--shadow) / 0.05)',
        card: '0 1px 2px 0 hsl(var(--shadow) / 0.04), 0 1px 3px 0 hsl(var(--shadow) / 0.06)',
        elevated:
          '0 1px 2px 0 hsl(var(--shadow) / 0.04), 0 4px 12px -2px hsl(var(--shadow) / 0.08), 0 12px 32px -8px hsl(var(--shadow) / 0.10)',
        pop: '0 10px 38px -10px hsl(var(--shadow) / 0.35), 0 10px 20px -15px hsl(var(--shadow) / 0.25)',
        'inner-hl': 'inset 0 1px 0 0 hsl(0 0% 100% / 0.08)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
