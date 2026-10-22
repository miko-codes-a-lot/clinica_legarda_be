import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Connection, createConnection, Model } from 'mongoose';
import { Appointment, AppointmentSchema } from './entities/appointment.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { ClinicClosure, ClinicClosureSchema } from '../clinic-closures/entities/clinic-closure.entity';
import { ClinicClosuresService } from '../clinic-closures/clinic-closures.service';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';
import { AppointmentChangeEmail, AppointmentChangeEmailSchema } from '../appointment-change-emails/entities/appointment-change-email.entity';
import { AppointmentSchedulingService } from './appointment-scheduling.service';
import { AppointmentsService } from './appointments.service';
import { RescheduleResponseDto } from './dto/reschedule-response.dto';
import { UserActor } from '../auth/role-policy';

const uri = process.env.TEST_CLOSURE_RESCHEDULE_MONGO_URI;
(uri ? describe : describe.skip)('Closure replacement agreements and expiration', () => {
  let db: Connection, appointments: Model<Appointment>, users: Model<User>, visits: Model<Visit>, outbox: Model<AppointmentChangeEmail>;
  let service: AppointmentsService, closures: ClinicClosuresService;
  let f: { clinic: string; patient: string; dentist: string; admin: string; other: string; appointment: string };
  const now = new Date('2026-10-22T04:00:00Z');
  const actor = (role: 'patient' | 'dentist' | 'admin' | 'other'): UserActor => ({ sub: f[role], role: role === 'patient' || role === 'other' ? 'user' : role, clinics: [f.clinic] });
  const proposal = () => ({ date: new Date('2026-11-04T00:00:00Z'), startTime: '11:00', endTime: '11:30', reason: 'Replacement after closure' });
  const respond = (id: string, who: 'patient' | 'dentist' | 'admin', decision = 'accept') => service.respondToReschedule(f.appointment, { proposalId: id, method: who === 'patient' ? 'patient_portal' : 'clinic_review', decision } as RescheduleResponseDto, actor(who));
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_closure_reschedule_spec?replicaSet=clinica-test') throw new Error('Use owned closure reschedule database only.');
    db = await createConnection(uri).asPromise();
    users = db.model(User.name, UserSchema); appointments = db.model(Appointment.name, AppointmentSchema);
    const clinics = db.model(Clinic.name, ClinicSchema), catalog = db.model(DentalCatalog.name, DentalCatalogSchema), referrals = db.model(Referral.name, ReferralSchema);
    const closureModel = db.model(ClinicClosure.name, ClinicClosureSchema), notifications = db.model(Notification.name, NotificationSchema);
    visits = db.model(Visit.name, VisitSchema); outbox = db.model(AppointmentChangeEmail.name, AppointmentChangeEmailSchema);
    service = new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog, closureModel), referrals, users, undefined, visits, outbox);
    closures = new ClinicClosuresService(closureModel, clinics, appointments, users, notifications, new EventEmitter2(), outbox, visits);
    await Promise.all(Object.values(db.models).map(model => model.init()));
  });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const hours = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => ({ day, startTime: '08:00', endTime: '18:00' }));
    const clinic = await db.model(Clinic.name).create({ name: 'Closure test', operatingHours: hours });
    const people = await users.create([{ role: 'user', status: 'confirmed', username: 'patient' }, { role: 'dentist', status: 'confirmed', clinics: [clinic._id], operatingHours: hours }, { role: 'admin', username: 'Closure admin', clinics: [clinic._id] }, { role: 'user', status: 'confirmed' }]);
    const item = await db.model(DentalCatalog.name).create({ name: 'Consultation', duration: 30 });
    const appointment = await appointments.create({ patient: people[0]._id, dentist: people[1]._id, clinic: clinic._id, services: [item._id], status: 'confirmed', createdBy: people[2]._id, date: '2026-11-02', startTime: '10:00', endTime: '10:30' });
    f = { clinic: String(clinic._id), patient: people[0].id, dentist: people[1].id, admin: people[2].id, other: people[3].id, appointment: appointment.id };
    const dto = { clinic: f.clinic, startDate: '2026-11-02', endDate: '2026-11-02', startTime: '09:00', endTime: '12:00', reason: 'Equipment repairs' };
    await closures.create(actor('admin'), { ...dto, impactToken: (await closures.preview(actor('admin'), dto)).impactToken });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await db?.dropDatabase(); await db?.close(); });

  it.each(['patient', 'dentist'] as const)('requires opposite-side approval for a %s proposal and consumes it once', async proposer => {
    const other = proposer === 'patient' ? 'dentist' : 'patient';
    const offered = await service.reschedule(f.appointment, proposal(), actor(proposer));
    expect(offered.rescheduleProposal).toMatchObject({ origin: 'clinic_closure', proposedBySide: proposer === 'patient' ? 'patient' : 'staff' });
    expect(offered.closureRescheduling?.expiresAt).toBeUndefined();
    await expect(respond(offered.rescheduleProposal!.id, proposer)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approve(f.appointment, actor('dentist'))).rejects.toBeInstanceOf(ConflictException);
    const accepted = await respond(offered.rescheduleProposal!.id, other);
    expect(accepted.status).toBe('confirmed'); expect(accepted.closureRescheduling).toBeUndefined();
    await expect(respond(offered.rescheduleProposal!.id, other)).rejects.toBeInstanceOf(ConflictException);
    expect(await outbox.countDocuments({ kind: 'confirmed' })).toBe(1);
  });
  it.each(['patient', 'dentist'] as const)('returns a declined %s proposal to a fresh one-week window', async proposer => {
    const offered = await service.reschedule(f.appointment, proposal(), actor(proposer));
    const later = new Date('2026-10-24T04:00:00Z'); jest.mocked(Date.now).mockReturnValue(later.getTime());
    const declined = await respond(offered.rescheduleProposal!.id, proposer === 'patient' ? 'admin' : 'patient', 'decline');
    expect(declined.status).toBe('needs_rescheduling'); expect(declined.rescheduleProposal).toBeUndefined();
    expect(declined.closureRescheduling?.expiresAt?.toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(await outbox.countDocuments({ kind: 'confirmed' })).toBe(0);
    expect(await service.expireRescheduleProposals(new Date('2026-10-29T04:00:00Z'))).toBe(0);
  });
  it('cancels at the no-proposal deadline once, retains the closure reason and never uses the original start', async () => {
    const current = await appointments.findById(f.appointment); const deadline = current?.closureRescheduling?.expiresAt;
    expect(deadline).toBeDefined();
    expect(await service.expireRescheduleProposals(new Date(deadline!.getTime() - 1))).toBe(0);
    expect(await service.expireRescheduleProposals(deadline!)).toBe(1);
    expect(await service.expireRescheduleProposals(deadline!)).toBe(0);
    const expired = await appointments.findById(f.appointment);
    expect(expired?.status).toBe('cancelled'); expect(expired?.disruption).toBeUndefined(); expect(expired?.history.at(-1)).toMatchObject({ actorRole: 'system', reason: expect.stringContaining('Equipment repairs') });
    expect(await outbox.countDocuments({ kind: 'cancelled' })).toBe(1);
  });
  it('expires a closure deadline even when the original dentist reference is missing', async () => {
    await users.deleteOne({ _id: f.dentist });
    const current = await appointments.findById(f.appointment);
    expect(await service.expireRescheduleProposals(current!.closureRescheduling!.expiresAt!)).toBe(1);
    expect((await appointments.findById(f.appointment))?.status).toBe('cancelled');
    expect(await outbox.countDocuments({ kind: 'cancelled' })).toBe(1);
  });
  it('refuses a late proposal, even before the worker has scanned it', async () => {
    const current = await appointments.findById(f.appointment); jest.mocked(Date.now).mockReturnValue(current!.closureRescheduling!.expiresAt!.getTime());
    await expect(service.reschedule(f.appointment, proposal(), actor('patient'))).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows authorized cancellation even after the abandoned original time; unrelated patients stay forbidden', async () => {
    await appointments.updateOne({ _id: f.appointment }, { date: '2026-10-20' });
    await expect(service.cancel(f.appointment, actor('other'), 'Cancel')).rejects.toBeInstanceOf(ForbiddenException);
    const cancelled = await service.cancel(f.appointment, actor('patient'), 'Cannot attend');
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.disruption).toBeUndefined();
    expect(await service.expireRescheduleProposals(new Date('2026-12-01'))).toBe(0);
  });
  it('expires either side’s unanswered proposal at its proposed start, not the paused seven-day deadline', async () => {
    const offered = await service.reschedule(f.appointment, proposal(), actor('patient'));
    expect(await service.expireRescheduleProposals(new Date('2026-10-30T04:00:00Z'))).toBe(0);
    expect(await service.expireRescheduleProposals(new Date('2026-11-04T03:00:00Z'))).toBe(1);
    expect((await appointments.findById(offered._id))?.status).toBe('cancelled');
  });
  it('expires an unanswered closure proposal later affected by dentist availability', async () => {
    const offered = await service.reschedule(f.appointment, proposal(), actor('dentist'));
    await appointments.updateOne({ _id: offered._id }, { disruption: {
      closures: [], dentistAvailability: [f.other], flaggedAt: now, message: 'Dentist availability changed',
    } });
    expect(await service.expireRescheduleProposals(new Date('2026-11-04T03:00:00Z'))).toBe(1);
    expect((await appointments.findById(offered._id))?.status).toBe('cancelled');
    expect(await service.expireRescheduleProposals(new Date('2026-11-04T03:00:00Z'))).toBe(0);
    expect(await outbox.countDocuments({ kind: 'cancelled' })).toBe(1);
  });
  it('keeps original participants, parent access and explicit staff-recorded patient agreement', async () => {
    await users.updateOne({ _id: f.patient }, { isDependent: true, loginEnabled: false, guardian: f.other });
    await users.updateOne({ _id: f.other }, { otpVerifiedAt: now });
    const parent = { ...actor('other'), patientIds: [f.patient] };
    const offered = await service.reschedule(f.appointment, { ...proposal(), dentist: f.other, patient: f.other }, parent);
    expect(String(offered.dentist._id)).toBe(f.dentist); expect(String(offered.patient._id)).toBe(f.patient);
    await users.updateOne({ _id: f.patient }, { guardian: f.admin });
    await expect(service.reschedule(f.appointment, { ...proposal(), startTime: '12:00', endTime: '12:30', proposalId: offered.rescheduleProposal!.id }, parent)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not expire deleted patients or ongoing care, and does not enable cross-dentist creation', async () => {
    await visits.create({ patient: f.patient, dentist: f.dentist, clinic: f.clinic, appointment: f.appointment, date: '2026-11-02', checkedInAt: now, purpose: 'consultation', state: 'in_progress', createdBy: f.dentist });
    expect(await service.expireRescheduleProposals(new Date('2026-12-01'))).toBe(0);
    await visits.deleteMany({}); await users.updateOne({ _id: f.patient }, { deletedAt: now });
    expect(await service.expireRescheduleProposals(new Date('2026-12-01'))).toBe(0);
    await expect(service.create({ ...proposal(), patient: f.patient, dentist: f.other, clinic: f.clinic }, actor('dentist'))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('permits attributed patient agreement after reopening without confirming all appointments automatically', async () => {
    const closure = await db.model(ClinicClosure.name).findOne();
    await closures.reopen(actor('admin'), String(closure!._id), 'Repairs finished');
    expect((await appointments.findById(f.appointment))?.status).toBe('needs_rescheduling');
    const unchanged = { ...proposal(), date: new Date('2026-11-02'), startTime: '10:00', endTime: '10:30' };
    const offered = await service.reschedule(f.appointment, unchanged, actor('dentist'));
    const accepted = await service.respondToReschedule(f.appointment, { proposalId: offered.rescheduleProposal!.id, method: 'phone', reason: 'Patient agreed during a phone call' }, actor('admin'));
    expect(accepted.status).toBe('confirmed');
    expect(accepted.history.at(-1)?.reason).toContain('phone call');
  });
  it('does not let proposal acceptance and expiration create contradictory outcomes', async () => {
    const offered = await service.reschedule(f.appointment, proposal(), actor('dentist'));
    const start = new Date('2026-11-04T03:00:00Z'); jest.mocked(Date.now).mockReturnValue(start.getTime());
    const results = await Promise.allSettled([respond(offered.rescheduleProposal!.id, 'patient'), service.expireRescheduleProposals(start)]);
    expect(results[0].status).toBe('rejected');
    expect((await appointments.findById(f.appointment))?.status).toBe('cancelled');
    expect(await outbox.countDocuments({ kind: 'confirmed' })).toBe(0);
    expect(await outbox.countDocuments({ kind: 'cancelled' })).toBe(1);
  });
  it('keeps a winning proposal or expiry atomic under concurrency', async () => {
    const current = await appointments.findById(f.appointment); const deadline = current!.closureRescheduling!.expiresAt!;
    jest.mocked(Date.now).mockReturnValue(deadline.getTime());
    const outcomes = await Promise.allSettled([service.reschedule(f.appointment, proposal(), actor('patient')), service.expireRescheduleProposals(deadline)]);
    expect(outcomes[0].status).toBe('rejected'); expect((await appointments.findById(f.appointment))?.status).toBe('cancelled');
    expect(await outbox.countDocuments({ kind: 'cancelled' })).toBe(1);
  });
});
