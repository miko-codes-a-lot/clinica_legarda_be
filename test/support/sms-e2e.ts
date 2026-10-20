import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import * as cookieParser from 'cookie-parser';
import { Model } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { NotificationListenerService } from '../../src/notifications/notification-listener.service';

export const MONGO_HOST = 'mongodb://127.0.0.1:27028';
export const REPLICA_SET = 'replicaSet=clinica-test';

/** What Semaphore received: one entry per text. */
export interface SentText { number: string; message: string; sendername: string; apikey: string }
export const sentTexts = (): SentText[] =>
  (axios.post as jest.Mock).mock.calls.map(([, body]) => Object.fromEntries(body as URLSearchParams) as unknown as SentText);

/** Retries an assertion until it holds or the time is up, because the workers run on their own timers. */
export async function eventually(assertion: () => void, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return assertion(); }
    catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

export const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A Monday or Tuesday (the test clinic's open days) at least three days ahead, as YYYY-MM-DD. */
export function futureClinicDay(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + 3);
  while (![1, 2].includes(day.getUTCDay())) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

/** A Manila calendar day and clock time `hoursAhead` from now, for an appointment the 24-hour reminder window covers. */
export function manilaSoon(hoursAhead: number): { date: string; startTime: string; endTime: string } {
  const clock = (value: Date) => `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  const start = new Date(Date.now() + hoursAhead * 3_600_000 + 8 * 3_600_000); // UTC getters now read Manila time
  return { date: start.toISOString().slice(0, 10), startTime: clock(start), endTime: clock(new Date(start.getTime() + 30 * 60_000)) };
}

/**
 * The real application, as main.ts builds it, against the isolated test database. Seed through `model` before
 * calling `app.init()`: the workers' first scan runs the moment the application starts.
 */
export async function createApp(database: string, smsEnabled: boolean) {
  process.env.DATABASE_URI = `${MONGO_HOST}/?${REPLICA_SET}`;
  process.env.DATABASE_NAME = database;
  process.env.APPOINTMENT_SMS_ENABLED = smsEnabled ? 'true' : 'false';
  process.env.SEMAPHORE_API_KEY = 'e2e-key';
  process.env.SEMAPHORE_SENDER_NAME = 'E2ECLINIC';
  process.env.ANTHROPIC_API_KEY = 'e2e-not-used';
  process.env.GMAIL_FROM_EMAIL = 'sender@clinic-mail.ph';
  // The in-app notification watcher is unrelated to texts. It opens a MongoDB change stream with no error handler and
  // never closes it, so closing the application would otherwise end the test run with an unhandled stream error.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NotificationListenerService).useValue({}).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  app.use(cookieParser());
  const model = <T>(name: string) => moduleRef.get<Model<T>>(getModelToken(name), { strict: false });
  return { app, moduleRef, model };
}
