export default () => ({
  port: parseInt(process.env.PORT || '', 10) || 3000,
  frontendUri: process.env.FRONTEND_URI,
  appointmentReminders: { enabled: process.env.APPOINTMENT_REMINDERS_ENABLED === 'true' },
  appointmentChangeEmails: { enabled: process.env.APPOINTMENT_CHANGE_EMAILS_ENABLED === 'true' },
  appointmentNoShows: { enabled: process.env.APPOINTMENT_NO_SHOWS_ENABLED === 'true', enforceFrom: process.env.APPOINTMENT_NO_SHOWS_ENFORCE_FROM },
  db: {
    uri: process.env.DATABASE_URI,
    name: process.env.DATABASE_NAME,
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    from: process.env.GMAIL_FROM_EMAIL,
    sendingPausedUntil: process.env.GMAIL_SENDING_PAUSED_UNTIL,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
});
