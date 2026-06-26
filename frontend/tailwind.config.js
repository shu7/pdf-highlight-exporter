/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#1F4E79',
        brandLight: '#EBF3FB',
      },
    },
  },
  plugins: [],
}
