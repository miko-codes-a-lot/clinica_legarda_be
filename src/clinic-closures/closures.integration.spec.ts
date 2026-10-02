import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Connection, createConnection, Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as request from 'supertest';
import { User, UserSchema } from '../users/entities/user.entity';
import { Clinic, ClinicSchema } from '../clinics/entities/clinic.entity';
import { Appointment, AppointmentSchema } from '../appointments/entities/appointment.entity';
import { DentalCatalog, DentalCatalogSchema } from '../dental-catalog/entities/dental-catalog.entity';
import { Referral, ReferralSchema } from '../referral/entities/referral.entity';
import { Visit, VisitSchema } from '../care/entities/visit.entity';
import { TreatmentCase, TreatmentCaseSchema } from '../care/entities/treatment-case.entity';
import { CareAccessService } from '../care/care-access.service';
import { VisitsService } from '../care/visits.service';
import { VisitsController } from '../care/visits.controller';
import { assignedClinicIds } from '../users/clinic-membership';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentSchedulingService } from '../appointments/appointment-scheduling.service';
import { AppointmentsController } from '../appointments/appointments.controller';
import { ClinicClosure, ClinicClosureSchema } from './entities/clinic-closure.entity';
import { ClinicClosuresService } from './clinic-closures.service';
import { ClinicClosuresController } from './clinic-closures.controller';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';
import { manilaDay } from '../care/visit-rules';
const uri = process.env.TEST_CARE_MONGO_URI;
(uri ? describe : describe.skip)('Closure handling and appointment transaction boundaries', () => {
  let db: Connection; let app: INestApplication; let users: Model<User>; let appointments: Model<Appointment>;
  let f: { clinic: string; outside: string; admin: string; super: string; dentist: string; patient: string; appointment: string; service: string };
  const day = () => new Date(Date.parse(manilaDay()) + 86400000).toISOString().slice(0,10);
  const later = () => new Date(Date.parse(manilaDay()) + 172800000).toISOString().slice(0,10);
  beforeAll(async () => {
    if (uri !== 'mongodb://127.0.0.1:27028/clinica_care_spec?replicaSet=clinica-test') throw new Error('Use isolated care task database only.');
    db = await createConnection(uri).asPromise(); users = db.model(User.name, UserSchema); appointments = db.model(Appointment.name, AppointmentSchema);
    const clinics = db.model(Clinic.name, ClinicSchema), catalog = db.model(DentalCatalog.name, DentalCatalogSchema), referrals = db.model(Referral.name, ReferralSchema);
    const visits = db.model(Visit.name, VisitSchema), cases = db.model(TreatmentCase.name, TreatmentCaseSchema), closures = db.model(ClinicClosure.name, ClinicClosureSchema), notifications = db.model(Notification.name, NotificationSchema);
    const access = new CareAccessService(users, appointments, visits);
    const reflector = new Reflector();
    const guard: CanActivate = { canActivate: async (ctx: ExecutionContext) => {
      if (reflector.getAllAndOverride('isPublic', [ctx.getHandler(), ctx.getClass()])) return true;
      const req = ctx.switchToHttp().getRequest<{ headers: Record<string,string>; user?: unknown }>(); const user = await users.findById(req.headers['x-fixture-user']).lean();
      if (!user) throw new UnauthorizedException(); req.user = { sub: user._id.toString(), role: user.role, clinics: assignedClinicIds(user) }; return true;
    } };
    const module = await Test.createTestingModule({ controllers: [ClinicClosuresController, AppointmentsController, VisitsController], providers: [
      { provide: ClinicClosuresService, useValue: new ClinicClosuresService(closures, clinics, appointments, users, notifications, new EventEmitter2()) },
      { provide: AppointmentsService, useValue: new AppointmentsService(appointments, new AppointmentSchedulingService(appointments, users, clinics, catalog, closures), referrals, users, cases, visits) },
      { provide: VisitsService, useValue: new VisitsService(access, visits, users, clinics, appointments, cases, closures) }, { provide: APP_GUARD, useValue: guard },
    ] }).compile(); app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true })); await app.init();
  });
  beforeEach(async () => {
    await Promise.all(Object.values(db.models).map(model => model.deleteMany({})));
    const hours = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].map(day => ({ day, startTime:'08:00', endTime:'18:00' }));
    const clinics = await db.model<Clinic>(Clinic.name).create([{ name: 'Here', operatingHours: hours },{ name: 'Outside', operatingHours: hours }]);
    const people = await users.create([{ username:'admin', role:'admin', clinics:[clinics[0]._id] },{ username:'super', role:'super-admin' },{ username:'dentist', role:'dentist', clinics:clinics.map(c=>c._id), status:'confirmed', operatingHours:hours },{ username:'patient', role:'user', status:'confirmed', clinics:[clinics[0]._id] }]);
    const service = await db.model<DentalCatalog>(DentalCatalog.name).create({ name:'Consultation', duration:30 });
    const a = await appointments.create({ clinic:clinics[0]._id, patient:people[3]._id, dentist:people[2]._id, date:day(), startTime:'10:00',endTime:'10:30',services:[service._id],createdBy:people[0]._id,status:'pending' });
    f = { clinic:clinics[0].id,outside:clinics[1].id,admin:people[0].id,super:people[1].id,dentist:people[2].id,patient:people[3].id,appointment:a.id,service:service.id };
  });
  afterAll(async () => { await app?.close(); await db?.close(); });
  const post = (url: string, body: object, actor=f.admin) => request(app.getHttpServer()).post(url).set('x-fixture-user', actor).send(body);
  const patch = (url: string, body: object={}, actor=f.admin) => request(app.getHttpServer()).patch(url).set('x-fixture-user',actor).send(body);
  const get = (url: string, actor=f.admin) => request(app.getHttpServer()).get(url).set('x-fixture-user',actor);
  const closure = (extra={}) => ({ clinic:f.clinic,startDate:day(),endDate:day(),startTime:'09:00',endTime:'12:00',reason:'private closure reason',...extra });
  const booking = () => ({ clinic:f.clinic,patient:f.patient,dentist:f.dentist,date:day(),startTime:'11:00',endTime:'11:30',services:[f.service] });
  it('previews within clinic scope and rejects non-management or outside-clinic actors', async () => {
    const preview = await post('/clinic-closures/preview',closure()).expect(201); expect(preview.body.total).toBe(1);
    await post('/clinic-closures/preview',closure({clinic:f.outside})).expect(403);
    await post('/clinic-closures',closure(),f.patient).expect(403); await post('/clinic-closures',closure(),f.dentist).expect(403);
    await post('/clinic-closures',closure({endDate:'2026-02-30'})).expect(400);
  });
  it('flags affected appointments and notifies patient and dentist without cancelling', async () => {
    const result = await post('/clinic-closures',closure()).expect(201);
    expect(result.body.appointments).toHaveLength(1); expect(result.body.appointments[0]).toMatchObject({status:'pending',disruption:{closures:[result.body.closure._id]}});
    expect(await db.model<Notification>(Notification.name).countDocuments({type:'CLINIC_CLOSURE'})).toBe(2);
    const availability = await request(app.getHttpServer()).get(`/clinic-closures/availability?clinic=${f.clinic}`).expect(200);
    expect(JSON.stringify(availability.body)).not.toMatch(/private closure reason|createdBy|affectedAppointments|reopenReason/);
    await post('/clinic-closures',closure()).expect(409);
  });
  it('blocks create, update, approval and overlapping reschedule, then permits a new open interval', async () => {
    await post('/clinic-closures',closure()).expect(201);
    await post('/appointments',booking()).expect(409);
    await request(app.getHttpServer()).put(`/appointments/${f.appointment}`).set('x-fixture-user',f.admin).send(booking()).expect(409);
    await patch(`/appointments/${f.appointment}/approve`).expect(409);
    await patch(`/appointments/${f.appointment}/reschedule`,{date:day(),startTime:'11:00',endTime:'11:30',reason:'Move due to closure'}).expect(409);
    const moved = await patch(`/appointments/${f.appointment}/reschedule`,{date:later(),startTime:'10:00',endTime:'10:30',reason:'Move due to closure'}).expect(200);
    expect(moved.body.disruption).toBeUndefined(); expect(moved.body.status).toBe('pending');
    await post('/appointments',{...booking(),startTime:'12:00',endTime:'12:30'}).expect(201);
  });
  it('retains unresolved flags on reopening and allows explicit reasoned resolution', async () => {
    const c = await post('/clinic-closures',closure()).expect(201);
    await patch(`/appointments/${f.appointment}/clear-disruption`,{reason:'Clinic reopened'}).expect(409);
    await patch(`/clinic-closures/${c.body.closure._id}/reopen`,{reason:'Maintenance completed'}).expect(200);
    expect((await appointments.findById(f.appointment))?.disruption).toBeDefined();
    await patch(`/appointments/${f.appointment}/clear-disruption`,{reason:'Original appointment can proceed'}).expect(200);
    const a = await appointments.findById(f.appointment); expect(a?.disruption).toBeUndefined(); expect(a?.history.at(-1)?.reason).toBe('Original appointment can proceed');
  });
  it('keeps overlapping closures blocking until all applicable intervals reopen', async () => {
    const first = await post('/clinic-closures',closure()).expect(201);
    await post('/clinic-closures',closure({startTime:'10:00',endTime:'13:00'})).expect(201);
    await patch(`/clinic-closures/${first.body.closure._id}/reopen`,{reason:'One issue resolved'}).expect(200);
    await patch(`/appointments/${f.appointment}/clear-disruption`,{reason:'Attempt'}).expect(409);
  });
  it('serializes concurrent booking and closure so every accepted overlapping appointment is flagged', async () => {
    const [closed, booked] = await Promise.all([post('/clinic-closures',closure({endTime:'15:00'})),post('/appointments',{...booking(),startTime:'13:00',endTime:'13:30'})]);
    expect(closed.status).toBe(201); expect([201,409]).toContain(booked.status);
    if (booked.status===201) expect((await appointments.findById(booked.body._id))?.disruption?.closures.map(String)).toContain(closed.body.closure._id);
  });
  it('blocks scheduled and walk-in check-in for a closed clinic', async () => {
    await appointments.updateOne({_id:f.appointment},{$set:{date:manilaDay(),status:'confirmed'}});
    await post('/clinic-closures',closure({startDate:manilaDay(),endDate:manilaDay(),startTime:'00:00',endTime:'24:00'})).expect(201);
    const intake = {patient:f.patient,clinic:f.clinic,dentist:f.dentist,purpose:'consultation',isWalkIn:true};
    await post('/care/visits',intake).expect(409); await post('/care/visits',{...intake,appointment:f.appointment}).expect(409);
  });
});
