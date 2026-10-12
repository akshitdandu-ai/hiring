import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dispatch: {
          50: '#f8f7ff',
          100: '#f2f0ff',
          200: '#e7e0ff',
          300: '#d4c5ff',
          400: '#b9a0ff',
          500: '#9975ff',
          600: '#7d4dff',
          700: '#6b2dff',
          800: '#5d1fdf',
          900: '#3d0fb8',
        },
      },
    },
  },
  plugins: [],
}

export default config
