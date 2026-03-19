export default () => ({
  port: parseInt(process.env.PORT || '', 10) || 3000,
  frontendUri: process.env.FRONTEND_URI,
  db: {
    uri: process.env.DATABASE_URI,
    name: process.env.DATABASE_NAME,
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '', 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
});
