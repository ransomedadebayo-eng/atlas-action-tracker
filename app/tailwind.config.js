/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#131313',
          surface: '#191919',
          elevated: '#201f1f',
        },
        border: {
          DEFAULT: '#2a2a2a',
          hover: '#3a3a3a',
        },
        text: {
          primary: '#e5e2e1',
          secondary: '#a0a0a0',
          muted: '#666666',
        },
        accent: {
          DEFAULT: '#4be277',
          hover: '#22c55e',
          muted: 'rgba(75, 226, 119, 0.15)',
        },
        amber: {
          DEFAULT: '#ffb95f',
          muted: 'rgba(255, 185, 95, 0.15)',
        },
        coral: {
          DEFAULT: '#ffb4ae',
          muted: 'rgba(255, 180, 174, 0.15)',
        },
        business: {
          riddim: '#22c55e',
          realestate: '#3b82f6',
          investments: '#a855f7',
          personal: '#ffb95f',
          fitness: '#ef4444',
        },
        priority: {
          p0: '#ef4444',
          p1: '#f97316',
          p2: '#eab308',
          p3: '#71717a',
        },
        status: {
          not_started: '#71717a',
          in_progress: '#3b82f6',
          waiting: '#ffb95f',
          blocked: '#ef4444',
          done: '#4be277',
        },
      },
      fontFamily: {
        headline: ['Manrope', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
