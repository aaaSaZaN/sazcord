import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#070a1a',
          1: '#0d1128',
          2: '#141935',
          3: '#1d2447',
        },
        border: {
          DEFAULT: '#262e58',
        },
        accent: {
          DEFAULT: '#5566ff',
          hover: '#4453f5',
        },
        danger: {
          DEFAULT: '#ef4444',
          hover: '#dc2626',
        },
        success: {
          DEFAULT: '#22c55e',
        },
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        soft: '0 10px 40px -10px rgba(0,0,0,0.6)',
      },
    },
  },
  plugins: [],
} satisfies Config;
