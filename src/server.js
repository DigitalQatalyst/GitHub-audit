/**
 * Local development server. On Vercel, api/index.js is used instead.
 */
const app = require('./app');
const { getServerPat } = require('./config');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GitHub Audit Dashboard running at http://localhost:${PORT}`);
  if (getServerPat()) console.log('Server-side PAT configured');
  else console.log('No server PAT — enter token in dashboard or set PAT in .env');
});
