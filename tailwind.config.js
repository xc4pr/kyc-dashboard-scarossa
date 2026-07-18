/** Statischer Tailwind-Build (ersetzt die Play-CDN-Runtime).
 *  Build: npm run css  →  renderer/lib/tailwind.css  */
module.exports = {
  content: ['./renderer/index.html', './renderer/form-sections.html', './renderer/ui.js'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: '#f7931a', light: '#ffab3d', muted: '#b96a00' } }
    }
  },
  plugins: []
};
