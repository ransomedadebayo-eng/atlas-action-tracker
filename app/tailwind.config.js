/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0f1117',
          surface: '#1a1d27',
          elevated: '#22252f',
        },
        border: {
          DEFAULT: '#2a2d3a',
          hover: '#3a3d4a',
        },
        text: {
          primary: '#e4e4e7',
          secondary: '#71717a',
          muted: '#52525b',
        },
        accent: {
          DEFAULT: '#f59e0b',
          hover: '#d97706',
          muted: 'rgba(245, 158, 11, 0.15)',
        },
        business: {
          riddim: '#22c55e',
          realestate: '#3b82f6',
          investments: '#a855f7',
          personal: '#f59e0b',
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
          waiting: '#f59e0b',
          blocked: '#ef4444',
          done: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
