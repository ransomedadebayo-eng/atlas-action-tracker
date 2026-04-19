/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          primary: 'var(--bg-primary)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-hover)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
        },
        amber: {
          DEFAULT: '#f4b860',
          muted: 'rgba(244, 184, 96, 0.12)',
        },
        coral: {
          DEFAULT: '#ff9993',
          muted: 'rgba(255, 153, 147, 0.12)',
        },
        success: {
          DEFAULT: '#10b981',
          muted: 'rgba(16, 185, 129, 0.12)',
        },
        warning: {
          DEFAULT: '#ff9993',
          muted: 'rgba(255, 153, 147, 0.12)',
        },
        danger: {
          DEFAULT: '#ee7d77',
          muted: 'rgba(238, 125, 119, 0.12)',
        },
        business: {
          riddim: '#10b981',
          realestate: '#8cb8ff',
          investments: '#f0a6c4',
          personal: '#f4b860',
          fitness: '#ee7d77',
        },
        priority: {
          p0: '#ee7d77',
          p1: '#ff9993',
          p2: '#f4b860',
          p3: '#525252',
        },
        status: {
          not_started: '#525252',
          in_progress: '#8cb8ff',
          waiting: '#f4b860',
          blocked: '#ee7d77',
          done: '#10b981',
        },
      },
      fontFamily: {
        headline: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '4px',
        md: '10px',
        lg: '16px',
        xl: '16px',
        '2xl': '24px',
        '3xl': '24px',
        full: '999px',
      },
      boxShadow: {
        panel: '0 18px 40px rgba(0, 0, 0, 0.22)',
        overlay: '0 12px 32px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
