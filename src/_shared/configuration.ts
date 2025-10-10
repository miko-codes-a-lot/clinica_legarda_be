export default () => ({
  port: parseInt(process.env.PORT || '', 10) || 3000,
  frontendUri: process.env.FRONTEND_URI,
  db: {
    uri: process.env.DATABASE_URI,
    name: process.env.DATABASE_NAME,
  },
});
