/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Light workspace theme tokens (from code.html & screen.png)
        canvas: '#F5F6F8',
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F7F8FA',
          hover: '#EAECEF',
          chip: '#F3F4F6',
          avatar: '#E5E7EB',
          code: '#F8FAFC',
        },
        border: {
          DEFAULT: '#E4E6EB',
          strong: '#9CA3AF',
          avatar: '#D1D5DB',
        },
        ink: {
          DEFAULT: '#111827',
          muted: '#6B7280',
          subtle: '#9CA3AF',
          avatar: '#4B5563',
        },
        accent: {
          DEFAULT: '#0D9488',
          hover: '#0B7A6F',
          soft: '#E6F4F2',
          bright: '#2DD4BF',
          on: '#FFFFFF',
        },
        // Design token aliases from DESIGN.md
        primary: {
          DEFAULT: '#0D9488',
          hover: '#0B7A6F',
          container: '#E6F4F2',
          on: '#FFFFFF',
          fixed: '#62FAE3',
          'fixed-dim': '#3CDDC7',
        },
        outline: {
          DEFAULT: '#E4E6EB',
          variant: '#D1D5DB',
        },
        danger: {
          DEFAULT: '#DC2626',
          soft: '#FEF2F2',
          border: '#FECACA',
        },
      },
      fontFamily: {
        sans: [
          'Geist',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        display: ['56px', { lineHeight: '64px', letterSpacing: '-0.03em', fontWeight: '600' }],
        'display-mobile': ['36px', { lineHeight: '44px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'headline-lg': ['40px', { lineHeight: '48px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'headline-md': ['28px', { lineHeight: '36px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-sm': ['18px', { lineHeight: '26px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'body-lg': ['18px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '400' }],
        'body-md': ['15px', { lineHeight: '24px', letterSpacing: '-0.005em', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '20px', letterSpacing: '0.01em', fontWeight: '500' }],
        'label-sm': ['12px', { lineHeight: '16px', letterSpacing: '0.01em', fontWeight: '500' }],
        code: ['13px', { lineHeight: '20px', letterSpacing: '0em', fontWeight: '400' }],
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
        panel: '16px',
        tile: '12px',
        full: '9999px',
      },
      spacing: {
        gutter: '1.5rem',
        'gutter-mobile': '1rem',
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '1rem',
        'space-lg': '1.5rem',
        'space-xl': '2.5rem',
        'space-2xl': '4rem',
        'space-3xl': '6rem',
      },
      boxShadow: {
        none: 'none',
      },
    },
  },
  plugins: [],
};

