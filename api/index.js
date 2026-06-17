/**
 * Vercel serverless entry — routes all /api/* requests to the Express app.
 */
const app = require('../src/app');
module.exports = app;
