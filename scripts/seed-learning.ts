import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import mongoose, { Model, Types } from 'mongoose';
import {
  Appointment,
  AppointmentSchema,
} from '../src/appointments/entities/appointment.entity';
import { AppointmentStatus } from '../src/_shared/enum/appointment-status.enum';
import { Clinic, ClinicSchema } from '../src/clinics/entities/clinic.entity';
import {
  DentalCatalog,
  DentalCatalogSchema,
} from '../src/dental-catalog/entities/dental-catalog.entity';
import {
  Notification,
  NotificationSchema,
  NotificationType,
} from '../src/notifications/entities/notification.entity';
import { Otp, OtpSchema } from '../src/otp/entities/otp.entity';
import {
  Reason,
  ReasonSchema,
  ReasonUsage,
} from '../src/reason/entities/reason.entity';
import {
  Referral,
  ReferralSchema,
} from '../src/referral/entities/referral.entity';
import { ReferralStatus } from '../src/_shared/enum/referral-status.enum';
import { User, UserSchema } from '../src/users/entities/user.entity';

type SeedDocument = {
  _id: Types.ObjectId;
  [key: string]: unknown;
};

type VerificationSummary = {
  database: string;
  verifyOnly: boolean;
  passwordWasSupplied: boolean;
  passwordsWereReset: boolean;
  otpWasMarkedVerified: boolean;
  collections: Record<string, { managed: number; total: number }>;
  references: {
    checked: number;
    valid: boolean;
  };
};

const DEFAULT_DATABASE_URI = 'mongodb://127.0.0.1:27017/?directConnection=true';
const DEFAULT_DATABASE_NAME = 'clinica_legarda';
const PROTECTED_DATABASES = new Set(['admin', 'config', 'local']);

const id = (hex: string) => new Types.ObjectId(hex);

const ids = {
  clinics: {
    legarda: id('70c100000000000000000001'),
    sampaloc: id('70c100000000000000000002'),
  },
  services: {
    consultation: id('70c200000000000000000001'),
    cleaning: id('70c200000000000000000002'),
    filling: id('70c200000000000000000003'),
    extraction: id('70c200000000000000000004'),
    rootCanal: id('70c200000000000000000005'),
    orthodontic: id('70c200000000000000000006'),
    whitening: id('70c200000000000000000007'),
    pediatric: id('70c200000000000000000008'),
  },
  reasons: {
    specialist: id('70c300000000000000000001'),
    imaging: id('70c300000000000000000002'),
    schedule: id('70c300000000000000000003'),
    equipment: id('70c300000000000000000004'),
    noSlot: id('70c300000000000000000005'),
    patientDeclined: id('70c300000000000000000006'),
    duplicate: id('70c300000000000000000007'),
    incomplete: id('70c300000000000000000008'),
  },
  users: {
    superAdmin: id('70c400000000000000000001'),
    admin: id('70c400000000000000000002'),
    dentistAna: id('70c400000000000000000003'),
    dentistMiguel: id('70c400000000000000000004'),
    dentistSofia: id('70c400000000000000000005'),
    patientAlex: id('70c400000000000000000006'),
    patientJamie: id('70c400000000000000000007'),
    patientSam: id('70c400000000000000000008'),
    patientTaylor: id('70c400000000000000000009'),
  },
  appointments: {
    confirmedToday: id('70c500000000000000000001'),
    pendingToday: id('70c500000000000000000002'),
    completedYesterday: id('70c500000000000000000003'),
    pendingTomorrow: id('70c500000000000000000004'),
    cancelled: id('70c500000000000000000005'),
    noShow: id('70c500000000000000000006'),
    rejected: id('70c500000000000000000007'),
    referred: id('70c500000000000000000008'),
  },
  referrals: {
    confirmed: id('70c600000000000000000001'),
    rejected: id('70c600000000000000000002'),
  },
  notifications: {
    appointmentCreatedPatient: id('70c700000000000000000001'),
    appointmentCreatedDentist: id('70c700000000000000000002'),
    appointmentCreatedAdmin: id('70c700000000000000000003'),
    appointmentConfirmedPatient: id('70c700000000000000000004'),
    appointmentConfirmedDentist: id('70c700000000000000000005'),
    appointmentCompleted: id('70c700000000000000000006'),
  },
};

const weekdayHours = [
  { day: 'monday', startTime: '09:00', endTime: '18:00' },
  { day: 'tuesday', startTime: '09:00', endTime: '18:00' },
  { day: 'wednesday', startTime: '09:00', endTime: '18:00' },
  { day: 'thursday', startTime: '09:00', endTime: '18:00' },
  { day: 'friday', startTime: '09:00', endTime: '18:00' },
  { day: 'saturday', startTime: '09:00', endTime: '14:00' },
];

const extendedHours = [
  ...weekdayHours.slice(0, 5),
  { day: 'saturday', startTime: '10:00', endTime: '16:00' },
  { day: 'sunday', startTime: '10:00', endTime: '14:00' },
];

function utcDay(offset: number): Date {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + offset);
  return value;
}

function assertSafeTarget(uri: string, databaseName: string): void {
  if (PROTECTED_DATABASES.has(databaseName)) {
    throw new Error(`Refusing to seed protected database "${databaseName}".`);
  }

  const localUri =
    /^mongodb:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?]|$)/i.test(
      uri,
    );

  if (localUri) return;

  const remoteAllowed = process.env.ALLOW_REMOTE_SEED === 'true';
  const confirmedDatabase = process.env.SEED_CONFIRM_DATABASE;

  if (!remoteAllowed || confirmedDatabase !== databaseName) {
    throw new Error(
      'Remote seeding is disabled. Set ALLOW_REMOTE_SEED=true and ' +
        `SEED_CONFIRM_DATABASE=${databaseName} to confirm the exact target.`,
    );
  }
}

function defineModels() {
  return {
    Clinic: mongoose.model(Clinic.name, ClinicSchema),
    DentalCatalog: mongoose.model(DentalCatalog.name, DentalCatalogSchema),
    Reason: mongoose.model(Reason.name, ReasonSchema),
    User: mongoose.model(User.name, UserSchema),
    Appointment: mongoose.model(Appointment.name, AppointmentSchema),
    Referral: mongoose.model(Referral.name, ReferralSchema),
    Notification: mongoose.model(Notification.name, NotificationSchema),
    Otp: mongoose.model(Otp.name, OtpSchema),
  };
}

function createSeedData() {
  const clinics: SeedDocument[] = [
    {
      _id: ids.clinics.legarda,
      name: 'Clinica Legarda Learning Dental Center',
      address: '101 Learning Avenue, Sampaloc, Manila',
      mobileNumber: '+639000000101',
      emailAddress: 'legarda-clinic@example.test',
      operatingHours: extendedHours,
    },
    {
      _id: ids.clinics.sampaloc,
      name: 'Sampaloc Community Dental Training Clinic',
      address: '202 Practice Street, Sampaloc, Manila',
      mobileNumber: '+639000000102',
      emailAddress: 'sampaloc-clinic@example.test',
      operatingHours: weekdayHours,
    },
  ];

  const services: SeedDocument[] = [
    {
      _id: ids.services.consultation,
      name: 'Dental Consultation',
      duration: 30,
    },
    {
      _id: ids.services.cleaning,
      name: 'Oral Prophylaxis',
      duration: 45,
    },
    {
      _id: ids.services.filling,
      name: 'Tooth Filling',
      duration: 60,
    },
    {
      _id: ids.services.extraction,
      name: 'Simple Tooth Extraction',
      duration: 60,
    },
    {
      _id: ids.services.rootCanal,
      name: 'Root Canal Treatment',
      duration: 120,
    },
    {
      _id: ids.services.orthodontic,
      name: 'Orthodontic Consultation',
      duration: 45,
    },
    {
      _id: ids.services.whitening,
      name: 'Teeth Whitening',
      duration: 90,
    },
    {
      _id: ids.services.pediatric,
      name: 'Pediatric Dental Check-up',
      duration: 30,
    },
  ];

  const reasons: SeedDocument[] = [
    {
      _id: ids.reasons.specialist,
      code: 'SPECIALIST_CARE_REQUIRED',
      label: 'Specialist care is required',
      description: 'The patient needs treatment from a dental specialist.',
      usage: ReasonUsage.REFERRAL,
      isActive: true,
      sortOrder: 10,
    },
    {
      _id: ids.reasons.imaging,
      code: 'ADVANCED_IMAGING_REQUIRED',
      label: 'Advanced imaging is required',
      description: 'Additional imaging is needed before treatment.',
      usage: ReasonUsage.REFERRAL,
      isActive: true,
      sortOrder: 20,
    },
    {
      _id: ids.reasons.schedule,
      code: 'SCHEDULE_TRANSFER',
      label: 'Schedule transfer requested',
      description: 'The patient needs a schedule available at another clinic.',
      usage: ReasonUsage.REFERRAL,
      isActive: true,
      sortOrder: 30,
    },
    {
      _id: ids.reasons.equipment,
      code: 'EQUIPMENT_UNAVAILABLE',
      label: 'Required equipment is unavailable',
      description: 'The requested procedure needs unavailable equipment.',
      usage: ReasonUsage.BOTH,
      isActive: true,
      sortOrder: 40,
    },
    {
      _id: ids.reasons.noSlot,
      code: 'NO_AVAILABLE_SLOT',
      label: 'No available appointment slot',
      description: 'No compatible clinic or dentist schedule is available.',
      usage: ReasonUsage.DECLINE,
      isActive: true,
      sortOrder: 50,
    },
    {
      _id: ids.reasons.patientDeclined,
      code: 'PATIENT_DECLINED',
      label: 'Patient declined the referral',
      description: 'The patient chose not to continue with the referral.',
      usage: ReasonUsage.DECLINE,
      isActive: true,
      sortOrder: 60,
    },
    {
      _id: ids.reasons.duplicate,
      code: 'DUPLICATE_REQUEST',
      label: 'Duplicate request',
      description: 'Another active referral already covers the same request.',
      usage: ReasonUsage.DECLINE,
      isActive: true,
      sortOrder: 70,
    },
    {
      _id: ids.reasons.incomplete,
      code: 'INCOMPLETE_INFORMATION',
      label: 'Incomplete referral information',
      description: 'More patient or treatment information is required.',
      usage: ReasonUsage.BOTH,
      isActive: true,
      sortOrder: 80,
    },
  ];

  const users: SeedDocument[] = [
    {
      _id: ids.users.superAdmin,
      firstName: 'Morgan',
      middleName: 'Learning',
      lastName: 'Reyes',
      emailAddress: 'superadmin@example.test',
      mobileNumber: '+639000000201',
      address: '1 Admin Lane, Manila',
      username: 'learning.superadmin',
      role: 'super-admin',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.admin,
      firstName: 'Casey',
      middleName: 'Demo',
      lastName: 'Santos',
      emailAddress: 'admin@example.test',
      mobileNumber: '+639000000202',
      address: '2 Admin Lane, Manila',
      username: 'learning.admin',
      role: 'admin',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.dentistAna,
      firstName: 'Ana',
      middleName: 'Demo',
      lastName: 'Cruz',
      emailAddress: 'ana.dentist@example.test',
      mobileNumber: '+639000000203',
      address: '3 Dentist Road, Manila',
      username: 'learning.dentist.ana',
      role: 'dentist',
      clinic: ids.clinics.legarda,
      operatingHours: extendedHours,
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.dentistMiguel,
      firstName: 'Miguel',
      middleName: 'Demo',
      lastName: 'Garcia',
      emailAddress: 'miguel.dentist@example.test',
      mobileNumber: '+639000000204',
      address: '4 Dentist Road, Manila',
      username: 'learning.dentist.miguel',
      role: 'dentist',
      clinic: ids.clinics.legarda,
      operatingHours: weekdayHours,
      maxWorkingMinutesPerDay: 420,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.dentistSofia,
      firstName: 'Sofia',
      middleName: 'Demo',
      lastName: 'Lim',
      emailAddress: 'sofia.dentist@example.test',
      mobileNumber: '+639000000205',
      address: '5 Dentist Road, Manila',
      username: 'learning.dentist.sofia',
      role: 'dentist',
      clinic: ids.clinics.sampaloc,
      operatingHours: weekdayHours,
      maxWorkingMinutesPerDay: 420,
      appointmentBufferMinutes: 20,
    },
    {
      _id: ids.users.patientAlex,
      firstName: 'Alex',
      middleName: 'Demo',
      lastName: 'Rivera',
      emailAddress: 'alex.patient@example.test',
      mobileNumber: '+639000000206',
      address: '6 Patient Street, Manila',
      username: 'learning.patient.alex',
      role: 'user',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.patientJamie,
      firstName: 'Jamie',
      middleName: 'Demo',
      lastName: 'Flores',
      emailAddress: 'jamie.patient@example.test',
      mobileNumber: '+639000000207',
      address: '7 Patient Street, Manila',
      username: 'learning.patient.jamie',
      role: 'user',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.patientSam,
      firstName: 'Sam',
      middleName: 'Demo',
      lastName: 'Navarro',
      emailAddress: 'sam.patient@example.test',
      mobileNumber: '+639000000208',
      address: '8 Patient Street, Manila',
      username: 'learning.patient.sam',
      role: 'user',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
    {
      _id: ids.users.patientTaylor,
      firstName: 'Taylor',
      middleName: 'Demo',
      lastName: 'Mendoza',
      emailAddress: 'taylor.patient@example.test',
      mobileNumber: '+639000000209',
      address: '9 Patient Street, Manila',
      username: 'learning.patient.taylor',
      role: 'user',
      operatingHours: [],
      maxWorkingMinutesPerDay: 480,
      appointmentBufferMinutes: 15,
    },
  ];

  const appointments: SeedDocument[] = [
    {
      _id: ids.appointments.confirmedToday,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientAlex,
      dentist: ids.users.dentistAna,
      services: [ids.services.consultation, ids.services.cleaning],
      date: utcDay(0),
      startTime: '09:00',
      endTime: '10:15',
      status: AppointmentStatus.CONFIRMED,
      notes: {
        patientNotes: 'First visit to the learning clinic.',
        clinicNotes: 'Review brushing technique during consultation.',
      },
      history: [
        { action: 'Appointment created.' },
        { action: 'Appointment approved.' },
      ],
    },
    {
      _id: ids.appointments.pendingToday,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientJamie,
      dentist: ids.users.dentistMiguel,
      services: [ids.services.filling],
      date: utcDay(0),
      startTime: '10:30',
      endTime: '11:30',
      status: AppointmentStatus.PENDING,
      notes: {
        patientNotes: 'Sensitive tooth on the upper left side.',
        clinicNotes: '',
      },
      history: [{ action: 'Appointment created.' }],
    },
    {
      _id: ids.appointments.completedYesterday,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientSam,
      dentist: ids.users.dentistAna,
      services: [ids.services.pediatric],
      date: utcDay(-1),
      startTime: '13:00',
      endTime: '13:30',
      status: AppointmentStatus.COMPLETED,
      notes: {
        patientNotes: 'Routine check-up.',
        clinicNotes: 'No urgent concerns found.',
      },
      history: [
        { action: 'Appointment created.' },
        { action: 'Appointment approved.' },
        { action: 'Appointment completed.' },
      ],
    },
    {
      _id: ids.appointments.pendingTomorrow,
      clinic: ids.clinics.sampaloc,
      patient: ids.users.patientTaylor,
      dentist: ids.users.dentistSofia,
      services: [ids.services.orthodontic],
      date: utcDay(1),
      startTime: '09:30',
      endTime: '10:15',
      status: AppointmentStatus.PENDING,
      notes: {
        patientNotes: 'Interested in alignment options.',
        clinicNotes: '',
      },
      history: [{ action: 'Appointment created.' }],
    },
    {
      _id: ids.appointments.cancelled,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientAlex,
      dentist: ids.users.dentistMiguel,
      services: [ids.services.whitening],
      date: utcDay(-2),
      startTime: '14:00',
      endTime: '15:30',
      status: AppointmentStatus.CANCELLED,
      notes: {
        patientNotes: 'Schedule conflict.',
        clinicNotes: '',
      },
      history: [
        { action: 'Appointment created.' },
        { action: 'Appointment cancelled.' },
      ],
    },
    {
      _id: ids.appointments.noShow,
      clinic: ids.clinics.sampaloc,
      patient: ids.users.patientJamie,
      dentist: ids.users.dentistSofia,
      services: [ids.services.extraction],
      date: utcDay(-3),
      startTime: '11:00',
      endTime: '12:00',
      status: AppointmentStatus.NO_SHOW,
      notes: {
        patientNotes: '',
        clinicNotes: 'Patient did not arrive for the appointment.',
      },
      history: [
        { action: 'Appointment created.' },
        { action: 'Appointment marked as no-show.' },
      ],
    },
    {
      _id: ids.appointments.rejected,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientSam,
      dentist: ids.users.dentistAna,
      services: [ids.services.rootCanal],
      date: utcDay(2),
      startTime: '15:00',
      endTime: '17:00',
      status: AppointmentStatus.REJECTED,
      notes: {
        patientNotes: 'Requested an afternoon slot.',
        clinicNotes: 'Needs additional imaging before scheduling.',
      },
      history: [
        { action: 'Appointment created.' },
        { action: 'Appointment rejected.' },
      ],
    },
    {
      _id: ids.appointments.referred,
      clinic: ids.clinics.legarda,
      patient: ids.users.patientTaylor,
      dentist: ids.users.dentistAna,
      services: [ids.services.rootCanal],
      date: utcDay(3),
      startTime: '10:30',
      endTime: '12:30',
      status: AppointmentStatus.CONFIRMED,
      notes: {
        patientNotes: 'Referred from the training clinic.',
        clinicNotes: 'Review existing imaging before treatment.',
      },
      history: [
        { action: 'Appointment created from referral.' },
        { action: 'Appointment approved.' },
      ],
      referral: ids.referrals.confirmed,
    },
  ];

  const referrals: SeedDocument[] = [
    {
      _id: ids.referrals.confirmed,
      fromDoctorId: ids.users.dentistSofia,
      fromClinicId: ids.clinics.sampaloc,
      reason: 'Specialist care is required',
      reasonOfDecline: '',
      appointment: ids.appointments.referred,
      status: ReferralStatus.CONFIRMED,
    },
    {
      _id: ids.referrals.rejected,
      fromDoctorId: ids.users.dentistMiguel,
      fromClinicId: ids.clinics.legarda,
      reason: 'Advanced imaging is required',
      reasonOfDecline: 'Incomplete referral information',
      status: ReferralStatus.REJECTED,
    },
  ];

  const notifications: SeedDocument[] = [
    {
      _id: ids.notifications.appointmentCreatedPatient,
      recipient: ids.users.patientJamie,
      triggeredBy: ids.users.patientJamie,
      message:
        'Your appointment with Dr. Miguel Garcia has been booked and is pending confirmation.',
      read: false,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/app/my-appointment/details/${ids.appointments.pendingToday.toHexString()}`,
    },
    {
      _id: ids.notifications.appointmentCreatedDentist,
      recipient: ids.users.dentistMiguel,
      triggeredBy: ids.users.patientJamie,
      message: 'You have a new appointment request from Jamie Flores.',
      read: false,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/admin/appointment/details/${ids.appointments.pendingToday.toHexString()}`,
    },
    {
      _id: ids.notifications.appointmentCreatedAdmin,
      recipient: ids.users.admin,
      triggeredBy: ids.users.patientJamie,
      message:
        'New appointment created for Dr. Miguel Garcia by patient Jamie Flores.',
      read: true,
      type: NotificationType.APPOINTMENT_CREATED,
      link: `/admin/appointment/details/${ids.appointments.pendingToday.toHexString()}`,
    },
    {
      _id: ids.notifications.appointmentConfirmedPatient,
      recipient: ids.users.patientAlex,
      triggeredBy: ids.users.dentistAna,
      message: 'Your appointment with Dr. Ana Cruz has been confirmed.',
      read: false,
      type: NotificationType.APPOINTMENT_STATUS_UPDATED,
      link: `/app/my-appointment/details/${ids.appointments.confirmedToday.toHexString()}`,
    },
    {
      _id: ids.notifications.appointmentConfirmedDentist,
      recipient: ids.users.dentistAna,
      triggeredBy: ids.users.dentistAna,
      message: 'You have confirmed the appointment for Alex Rivera.',
      read: true,
      type: NotificationType.APPOINTMENT_STATUS_UPDATED,
      link: `/admin/appointment/details/${ids.appointments.confirmedToday.toHexString()}`,
    },
    {
      _id: ids.notifications.appointmentCompleted,
      recipient: ids.users.patientSam,
      triggeredBy: ids.users.dentistAna,
      message: 'Your appointment with Dr. Ana Cruz is complete. Thank you!',
      read: false,
      type: NotificationType.APPOINTMENT_STATUS_UPDATED,
      link: `/app/my-appointment/details/${ids.appointments.completedYesterday.toHexString()}`,
    },
  ];

  return {
    clinics,
    services,
    reasons,
    users,
    appointments,
    referrals,
    notifications,
  };
}

async function upsertDocuments(
  model: Model<unknown>,
  documents: SeedDocument[],
  session: mongoose.ClientSession,
): Promise<void> {
  for (const document of documents) {
    const { _id, ...fields } = document;
    await model.updateOne(
      { _id },
      { $set: fields },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session,
      },
    );
  }
}

async function upsertUsers(
  model: Model<unknown>,
  documents: SeedDocument[],
  passwordHash: string,
  resetPasswords: boolean,
  markOtpVerified: boolean,
  session: mongoose.ClientSession,
): Promise<void> {
  for (const document of documents) {
    const { _id, ...fields } = document;
    const setFields: Record<string, unknown> = { ...fields };
    const setOnInsert: Record<string, unknown> = {};

    if (resetPasswords) {
      setFields.password = passwordHash;
    } else {
      setOnInsert.password = passwordHash;
    }

    if (markOtpVerified) {
      setFields.otpVerifiedAt = new Date();
    }

    await model.updateOne(
      { _id },
      {
        $set: setFields,
        ...(Object.keys(setOnInsert).length > 0 && {
          $setOnInsert: setOnInsert,
        }),
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
        session,
      },
    );
  }
}

async function assertExists(
  model: Model<unknown>,
  documentId: Types.ObjectId,
  relationship: string,
): Promise<void> {
  const exists = await model.exists({ _id: documentId });
  if (!exists) {
    throw new Error(
      `Seed verification failed: missing ${relationship} (${documentId.toHexString()}).`,
    );
  }
}

async function verifyReferences(
  models: ReturnType<typeof defineModels>,
  data: ReturnType<typeof createSeedData>,
): Promise<number> {
  let checked = 0;
  const users = await models.User.find({
    _id: { $in: data.users.map(({ _id }) => _id) },
  }).lean();

  for (const user of users) {
    if (user.clinic) {
      await assertExists(
        models.Clinic,
        user.clinic as unknown as Types.ObjectId,
        'user clinic',
      );
      checked += 1;
    }
  }

  const appointments = await models.Appointment.find({
    _id: { $in: data.appointments.map(({ _id }) => _id) },
  }).lean();

  for (const appointment of appointments) {
    await assertExists(
      models.Clinic,
      appointment.clinic as unknown as Types.ObjectId,
      'appointment clinic',
    );
    checked += 1;
    await assertExists(
      models.User,
      appointment.patient as unknown as Types.ObjectId,
      'appointment patient',
    );
    checked += 1;
    await assertExists(
      models.User,
      appointment.dentist as unknown as Types.ObjectId,
      'appointment dentist',
    );
    checked += 1;
    for (const service of appointment.services) {
      await assertExists(
        models.DentalCatalog,
        service as unknown as Types.ObjectId,
        'appointment service',
      );
      checked += 1;
    }
    if (appointment.referral) {
      await assertExists(
        models.Referral,
        appointment.referral as unknown as Types.ObjectId,
        'appointment referral',
      );
      checked += 1;
    }
  }

  const referrals = await models.Referral.find({
    _id: { $in: data.referrals.map(({ _id }) => _id) },
  }).lean();

  for (const referral of referrals) {
    await assertExists(
      models.User,
      referral.fromDoctorId as unknown as Types.ObjectId,
      'referral doctor',
    );
    checked += 1;
    await assertExists(
      models.Clinic,
      referral.fromClinicId as unknown as Types.ObjectId,
      'referral clinic',
    );
    checked += 1;
    if (referral.appointment) {
      await assertExists(
        models.Appointment,
        referral.appointment as unknown as Types.ObjectId,
        'referral appointment',
      );
      checked += 1;
    }
  }

  const notifications = await models.Notification.find({
    _id: { $in: data.notifications.map(({ _id }) => _id) },
  }).lean();

  for (const notification of notifications) {
    await assertExists(
      models.User,
      notification.recipient as unknown as Types.ObjectId,
      'notification recipient',
    );
    checked += 1;
    if (notification.triggeredBy) {
      await assertExists(
        models.User,
        notification.triggeredBy as unknown as Types.ObjectId,
        'notification actor',
      );
      checked += 1;
    }
  }

  return checked;
}

async function collectionSummary(
  model: Model<unknown>,
  managedIds: Types.ObjectId[],
): Promise<{ managed: number; total: number }> {
  const [managed, total] = await Promise.all([
    model.countDocuments({ _id: { $in: managedIds } }),
    model.countDocuments(),
  ]);
  return { managed, total };
}

async function verifySeed(
  models: ReturnType<typeof defineModels>,
  data: ReturnType<typeof createSeedData>,
  databaseName: string,
  verifyOnly: boolean,
  passwordWasSupplied: boolean,
  passwordsWereReset: boolean,
  otpWasMarkedVerified: boolean,
): Promise<VerificationSummary> {
  const collections = {
    clinics: await collectionSummary(
      models.Clinic,
      data.clinics.map(({ _id }) => _id),
    ),
    services: await collectionSummary(
      models.DentalCatalog,
      data.services.map(({ _id }) => _id),
    ),
    reasons: await collectionSummary(
      models.Reason,
      data.reasons.map(({ _id }) => _id),
    ),
    users: await collectionSummary(
      models.User,
      data.users.map(({ _id }) => _id),
    ),
    appointments: await collectionSummary(
      models.Appointment,
      data.appointments.map(({ _id }) => _id),
    ),
    referrals: await collectionSummary(
      models.Referral,
      data.referrals.map(({ _id }) => _id),
    ),
    notifications: await collectionSummary(
      models.Notification,
      data.notifications.map(({ _id }) => _id),
    ),
    otps: await collectionSummary(models.Otp, []),
  };

  const expectedManagedCounts = {
    clinics: data.clinics.length,
    services: data.services.length,
    reasons: data.reasons.length,
    users: data.users.length,
    appointments: data.appointments.length,
    referrals: data.referrals.length,
    notifications: data.notifications.length,
    otps: 0,
  };

  for (const collection of Object.keys(
    expectedManagedCounts,
  ) as (keyof typeof expectedManagedCounts)[]) {
    const expected = expectedManagedCounts[collection];
    const actual = collections[collection].managed;
    if (actual !== expected) {
      throw new Error(
        `Seed verification failed for ${collection}: expected ${expected} managed documents, found ${actual}.`,
      );
    }
  }

  const checkedReferences = await verifyReferences(models, data);

  return {
    database: databaseName,
    verifyOnly,
    passwordWasSupplied,
    passwordsWereReset,
    otpWasMarkedVerified,
    collections,
    references: {
      checked: checkedReferences,
      valid: true,
    },
  };
}

async function main(): Promise<void> {
  const uri = process.env.DATABASE_URI?.trim() || DEFAULT_DATABASE_URI;
  const databaseName =
    process.env.DATABASE_NAME?.trim() || DEFAULT_DATABASE_NAME;
  const verifyOnly = process.argv.includes('--verify-only');
  const suppliedPassword = process.env.SEED_USER_PASSWORD;
  const resetPasswords = process.env.SEED_RESET_PASSWORDS === 'true';
  const markOtpVerified = process.env.SEED_MARK_OTP_VERIFIED === 'true';

  assertSafeTarget(uri, databaseName);

  if (suppliedPassword && suppliedPassword.length < 12) {
    throw new Error('SEED_USER_PASSWORD must contain at least 12 characters.');
  }

  if (resetPasswords && !suppliedPassword) {
    throw new Error('SEED_RESET_PASSWORDS=true requires SEED_USER_PASSWORD.');
  }

  await mongoose.connect(uri, { dbName: databaseName });

  const models = defineModels();
  const data = createSeedData();

  if (!verifyOnly) {
    for (const model of Object.values(models)) {
      await model.createIndexes();
    }

    const password = suppliedPassword || randomBytes(48).toString('base64url');
    const passwordHash = await bcrypt.hash(password, 12);
    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        await upsertDocuments(models.Clinic, data.clinics, session);
        await upsertDocuments(models.DentalCatalog, data.services, session);
        await upsertDocuments(models.Reason, data.reasons, session);
        await upsertUsers(
          models.User,
          data.users,
          passwordHash,
          resetPasswords,
          markOtpVerified,
          session,
        );
        await upsertDocuments(models.Appointment, data.appointments, session);
        await upsertDocuments(models.Referral, data.referrals, session);
        await upsertDocuments(models.Notification, data.notifications, session);
      });
    } finally {
      await session.endSession();
    }
  }

  const summary = await verifySeed(
    models,
    data,
    databaseName,
    verifyOnly,
    Boolean(suppliedPassword),
    resetPasswords,
    markOtpVerified,
  );

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (!verifyOnly && !suppliedPassword) {
    process.stdout.write(
      'Seed users received undisclosed random passwords. ' +
        'Rerun with SEED_USER_PASSWORD and SEED_RESET_PASSWORDS=true ' +
        'to set a known local learning password without storing it in Git.\n',
    );
  }
}

async function run(): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Learning seed failed: ${message}\n`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void run();
