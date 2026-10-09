import { MailerService } from './mailer.service';

const mockTransport = jest.fn();
jest.mock('googleapis', () => {
  const { google } = jest.requireActual<typeof import('googleapis')>('googleapis');
  const OAuth2 = google.auth.OAuth2;
  return { google: {
    auth: { OAuth2: class extends OAuth2 {
      constructor(...args: ConstructorParameters<typeof OAuth2>) {
        super(...args);
        // Only the HTTP adapter is replaced; exercise real OAuth refresh and
        // Gaxios defaults merging before the Gmail request.
        this.transporter.defaults.adapter = mockTransport;
      }
    } },
    gmail: google.gmail.bind(google),
  } };
});
jest.mock('../_shared/configuration', () => ({ __esModule: true, default: () => ({
  gmail: { clientId: 'test', clientSecret: 'test', refreshToken: 'test', from: 'sender@example.test' },
}) }));

it('bounds token refresh and Gmail transport below the five-minute reminder lease', async () => {
  mockTransport.mockImplementation(async config => ({
    config, status: 200, statusText: 'OK', headers: new Headers(),
    data: String(config.url).includes('/token') ? { access_token: 'local-token', expires_in: 3600 } : { id: 'captured' },
  }));
  await new MailerService().sendAppointmentReminder('patient@example.test', {
    clinicName: 'Local clinic', clinicAddress: '', date: '2026-10-10', startTime: '09:00', endTime: '09:30',
  });
  expect(mockTransport).toHaveBeenCalledTimes(2);
  const [refresh, delivery] = mockTransport.mock.calls.map(([config]) => config);
  expect(String(refresh.url)).toContain('/token');
  expect(refresh.timeout).toBeGreaterThan(0);
  expect(refresh.timeout).toBeLessThanOrEqual(30_000);
  expect(refresh.retryConfig.retry).toBe(0);
  expect(String(delivery.url)).toContain('/messages/send');
  expect(delivery.timeout).toBeLessThanOrEqual(30_000);
  expect(delivery.retry).toBe(false);
});
