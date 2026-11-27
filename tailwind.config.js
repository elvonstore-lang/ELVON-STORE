// Tailwind build for tw.css (run: npx tailwindcss@3.4.17 -c tailwind.config.js -o tw.css --minify)
module.exports = {
  content: ['./index.html', './elvon-ai-boost.js', './marketing.html'],
  darkMode: 'class',
  theme: { extend: { fontFamily: { sans: ['Cairo', 'sans-serif'] }, colors: { elvon: { black: '#050505', dark: '#0B0B0D', card: '#131316', cardHover: '#1A1A1F', border: '#242429', red: '#DC0A14', redHover: '#B90810', orange: '#DC0A14', orangeHover: '#B90810', whatsapp: '#25D366' } } } }
};
