export default () => ({
  port: parseInt(process.env.PORT || '', 10) || 3000,
  frontendUri: process.env.FRONTEND_URI,
  db: {
    uri: process.env.DATABASE_URI,
    name: process.env.DATABASE_NAME,
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    from: process.env.GMAIL_FROM_EMAIL,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});
