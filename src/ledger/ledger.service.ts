import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId, sameId } from '../auth/reference-id';
import { CareAccessService, CARE_CLINIC_FIELDS } from '../care/care-access.service';
import { User } from '../users/entities/user.entity';
import { Clinic } from '../clinics/entities/clinic.entity';
import { Visit } from '../care/entities/visit.entity';
import { TreatmentCase } from '../care/entities/treatment-case.entity';
import { Appointment } from '../appointments/entities/appointment.entity';
import { manilaDay } from '../care/visit-rules';
import { LedgerAccount } from './entities/ledger-account.entity';
import { LedgerEntry } from './entities/ledger-entry.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { LedgerChargeDto, LedgerPaymentDto } from './dto/ledger-entry.dto';
import { InstallmentPlanDto, ReviseInstallmentPlanDto } from './dto/installment-plan.dto';
import { assertMinorMoney, assertNewPayment, assertRecordedDate, chargeBalance, installmentAllocation, sumMoney, validateInstallments } from './ledger-rules';

const ENTRY_FIELDS = '_id patient clinic kind amount date description charge visit careCase method reference voidedAt voidReason createdAt';
@Injectable()
export class LedgerService implements OnModuleInit {
  constructor(private readonly access: CareAccessService,
    @InjectModel(LedgerAccount.name) private readonly accounts: Model<LedgerAccount>,
    @InjectModel(LedgerEntry.name) private readonly entries: Model<LedgerEntry>,
    @InjectModel(InstallmentPlan.name) private readonly plans: Model<InstallmentPlan>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Clinic.name) private readonly clinics: Model<Clinic>,
    @InjectModel(Visit.name) private readonly visits: Model<Visit>,
    @InjectModel(TreatmentCase.name) private readonly cases: Model<TreatmentCase>,
    @InjectModel(Appointment.name) private readonly appointments: Model<Appointment>,
  ) {}
  async onModuleInit() { await Promise.all([this.accounts.init(), this.entries.init(), this.plans.init()]); }
  private writer(actor: UserActor, clinic: string) {
    if (!['admin', 'super-admin'].includes(actor.role)) throw new ForbiddenException('Only clinic administrators may record manual ledger entries.');
    this.access.requireClinic(actor, clinic);
  }
  private async prepareAccount(patient: string, clinic: string) {
    if (!await this.clinics.exists({ _id: clinic })) throw new NotFoundException('Clinic not found.');
    try { await this.accounts.updateOne({ patient, clinic }, { $setOnInsert: { patient, clinic, revision: 0 } }, { upsert: true }); }
    catch (error) { if (!this.duplicate(error)) throw error; }
  }
  private duplicate(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 11000; }
  private async lock(patient: string, clinic: string, session: ClientSession) {
    if (!(await this.users.updateOne({ _id: patient, role: 'user' }, { $inc: { scheduleRevision: 1 } }, { session, timestamps: false })).matchedCount)
      throw new ConflictException('The patient identity changed. Reload before recording a payment.');
    if (!(await this.accounts.updateOne({ patient, clinic }, { $inc: { revision: 1 } }, { session })).matchedCount)
      throw new ConflictException('The patient ledger is unavailable. Reload and try again.');
  }
  private async actorSnapshot(actor: UserActor, session: ClientSession) {
    const user = await this.users.findById(referenceId(actor.sub)).select('firstName lastName username').session(session).lean();
    if (!user) throw new ForbiddenException('The recording staff account no longer exists.');
    return { actor: user._id, actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username, actorRole: actor.role };
  }
  private async retryOperation(patient: string, clinic: string, operationId: string, signature: string, session: ClientSession) {
    const previous = await this.entries.findOne({ patient, clinic, operationId: operationId.toLowerCase() }).select('+signature').session(session);
    if (previous && previous.signature !== signature) throw new ConflictException('This operation ID was already used for a different ledger entry.');
    return previous;
  }
  async charge(actor: UserActor, dto: LedgerChargeDto) {
    const patient = referenceId(dto.patient), clinic = referenceId(dto.clinic);
    this.writer(actor, clinic); await this.access.requirePatient(actor, patient, clinic);
    assertMinorMoney(dto.amount); assertRecordedDate(dto.date, manilaDay());
    const description = dto.description.trim(); if (!description) throw new BadRequestException('Enter the charge description.');
    const normalized = { patient, clinic, kind: 'charge', amount: dto.amount, date: dto.date, description,
      visit: dto.visit ? referenceId(dto.visit) : undefined, careCase: dto.careCase ? referenceId(dto.careCase) : undefined, notes: dto.notes?.trim() || '' };
    const signature = JSON.stringify(normalized); await this.prepareAccount(patient, clinic);
    const id = await this.entries.db.transaction(async session => {
      await this.lock(patient, clinic, session);
      const retry = await this.retryOperation(patient, clinic, dto.operationId, signature, session); if (retry) return retry.id as string;
      const person = await this.access.requirePatient(actor, patient, clinic, session);
      if (!['confirmed', 'walk_in'].includes(person.status)) throw new BadRequestException('Register or verify the patient before recording a new charge.');
      if (normalized.visit) {
        const visit = await this.visits.findById(normalized.visit).session(session);
        if (!visit || !sameId(visit.patient, patient) || !sameId(visit.clinic, clinic)
          || (normalized.careCase && !sameId(visit.careCase, normalized.careCase))) throw new BadRequestException('The linked visit must belong to this patient, clinic and treatment case.');
      }
      if (normalized.careCase) {
        const careCase = await this.cases.findById(normalized.careCase).session(session);
        if (!careCase || !sameId(careCase.patient, patient) || !sameId(careCase.clinic, clinic)) throw new BadRequestException('The linked treatment case must belong to this patient and clinic.');
      }
      const [entry] = await this.entries.create([{ ...normalized, operationId: dto.operationId.toLowerCase(), signature, ...await this.actorSnapshot(actor, session) }], { session });
      return entry.id as string;
    });
    return this.entry(id);
  }
  private async chargeEntry(id: string, session?: ClientSession) {
    const charge = await this.entries.findOne({ _id: referenceId(id), kind: 'charge' }).session(session ?? null);
    if (!charge) throw new NotFoundException('Charge not found.'); return charge;
  }
  private async paidBalance(charge: { _id: unknown; amount: number }, session?: ClientSession) {
    const payments = await this.entries.find({ charge: charge._id, kind: 'payment' }).select('amount voidedAt').session(session ?? null).lean();
    return chargeBalance(charge.amount, payments);
  }
  async payment(actor: UserActor, dto: LedgerPaymentDto) {
    const initial = await this.chargeEntry(dto.charge); const patient = referenceId(initial.patient), clinic = referenceId(initial.clinic);
    this.writer(actor, clinic); assertMinorMoney(dto.amount); assertRecordedDate(dto.date, manilaDay());
    const method = dto.method.trim(); if (!method) throw new BadRequestException('Enter the manual payment method.');
    const normalized = { patient, clinic, kind: 'payment', charge: initial.id as string, amount: dto.amount, date: dto.date, method, reference: dto.reference?.trim() || '', notes: dto.notes?.trim() || '' };
    const signature = JSON.stringify(normalized); await this.prepareAccount(patient, clinic);
    const id = await this.entries.db.transaction(async session => {
      await this.lock(patient, clinic, session);
      const retry = await this.retryOperation(patient, clinic, dto.operationId, signature, session); if (retry) return retry.id as string;
      const charge = await this.chargeEntry(dto.charge, session);
      if (charge.voidedAt) throw new ConflictException('Payments cannot be recorded against a voided charge.');
      assertNewPayment(await this.paidBalance(charge, session), dto.amount);
      const [entry] = await this.entries.create([{ ...normalized, description: `Payment: ${charge.description}`.slice(0, 500),
        operationId: dto.operationId.toLowerCase(), signature, ...await this.actorSnapshot(actor, session) }], { session });
      return entry.id as string;
    });
    return this.entry(id);
  }
  private entry(id: string) { return this.entries.findById(id).select(`${ENTRY_FIELDS} notes actorName actorRole actor voidedBy voidedByName`).populate({ path: 'clinic', select: CARE_CLINIC_FIELDS }).lean().exec(); }
  async void(actor: UserActor, id: string, reason: string) {
    if (!reason.trim()) throw new BadRequestException('Enter a reason for voiding this entry.');
    const initial = await this.entries.findById(referenceId(id)); if (!initial) throw new NotFoundException('Ledger entry not found.');
    const patient = referenceId(initial.patient), clinic = referenceId(initial.clinic); this.writer(actor, clinic); await this.prepareAccount(patient, clinic);
    await this.entries.db.transaction(async session => {
      await this.lock(patient, clinic, session);
      const entry = await this.entries.findById(initial._id).session(session); if (!entry) throw new NotFoundException('Ledger entry not found.');
      if (entry.voidedAt) throw new ConflictException('This entry is already voided.');
      if (entry.kind === 'charge' && await this.entries.exists({ charge: entry._id, kind: 'payment', voidedAt: { $exists: false } }).session(session))
        throw new ConflictException('Void the active payments before voiding this charge.');
      await this.entries.updateOne({ _id: entry._id, voidedAt: { $exists: false } }, { $set: { voidedAt: new Date(), voidedBy: referenceId(actor.sub), voidedByName: (await this.actorSnapshot(actor, session)).actorName, voidReason: reason.trim() } }, { session });
    });
    return this.entry(id);
  }
  async installments(actor: UserActor, dto: InstallmentPlanDto) {
    const charge = await this.chargeEntry(dto.charge); const patient = referenceId(charge.patient), clinic = referenceId(charge.clinic);
    this.writer(actor, clinic); validateInstallments(charge.amount, dto.items); await this.prepareAccount(patient, clinic);
    try {
      return await this.entries.db.transaction(async session => {
        await this.lock(patient, clinic, session); const current = await this.chargeEntry(dto.charge, session);
        if (current.voidedAt) throw new ConflictException('A voided charge cannot have an installment plan.');
        if (await this.plans.exists({ charge: current._id }).session(session)) throw new ConflictException('This charge already has an installment plan. Revise its existing schedule.');
        const staff = await this.actorSnapshot(actor, session);
        const [plan] = await this.plans.create([{ charge: current._id, patient, clinic, items: dto.items, createdBy: staff.actor, createdByName: staff.actorName }], { session }); return plan.toObject();
      });
    } catch (error) { if (this.duplicate(error)) throw new ConflictException('This charge already has an installment plan.'); throw error; }
  }
  async revise(actor: UserActor, id: string, dto: ReviseInstallmentPlanDto) {
    if (!dto.reason.trim()) throw new BadRequestException('Enter why the installment schedule is changing.');
    const initial = await this.plans.findById(referenceId(id)); if (!initial) throw new NotFoundException('Installment plan not found.');
    const patient = referenceId(initial.patient), clinic = referenceId(initial.clinic); this.writer(actor, clinic); await this.prepareAccount(patient, clinic);
    await this.entries.db.transaction(async session => {
      await this.lock(patient, clinic, session); const plan = await this.plans.findById(initial._id).session(session);
      if (!plan || plan.revision !== dto.revision) throw new ConflictException('The installment schedule changed. Reload before revising it.');
      const charge = await this.chargeEntry(referenceId(plan.charge), session); if (charge.voidedAt) throw new ConflictException('A voided charge schedule cannot be revised.');
      validateInstallments(charge.amount, dto.items); const snapshot = await this.actorSnapshot(actor, session);
      await this.plans.updateOne({ _id: plan._id, revision: dto.revision }, { $set: { items: dto.items }, $inc: { revision: 1 },
        $push: { history: { revision: plan.revision, items: plan.items, actor: snapshot.actor, actorName: snapshot.actorName, at: new Date(), reason: dto.reason.trim() } } }, { session });
    });
    return this.plans.findById(initial._id).lean().exec();
  }
  async record(actor: UserActor, patient: string, clinic?: string, self = false) {
    if (self ? actor.role !== 'user' || !sameId(actor.sub, patient) : !['admin', 'super-admin', 'dentist'].includes(actor.role))
      throw new ForbiddenException('You cannot access this ledger.');
    const person = await this.access.requirePatient(actor, patient, self ? undefined : clinic);
    const filter: FilterQuery<LedgerEntry> = { patient: referenceId(patient) };
    if (!self) {
      if (clinic) this.access.requireClinic(actor, clinic);
      if (actor.role === 'admin') filter.clinic = clinic ? referenceId(clinic) : { $in: (actor.clinics ?? []).map(referenceId) };
      else if (actor.role === 'dentist') {
        const careFilter = { patient: referenceId(patient), dentist: referenceId(actor.sub), ...(clinic ? { clinic: referenceId(clinic) } : {}) };
        const allowed = [...await this.appointments.distinct('clinic', careFilter), ...await this.visits.distinct('clinic', careFilter)].map(referenceId);
        if (clinic && !allowed.includes(referenceId(clinic))) throw new ForbiddenException('This clinic is outside your established patient care.');
        filter.clinic = { $in: allowed };
      } else if (clinic) filter.clinic = referenceId(clinic);
    }
    const fields = self ? ENTRY_FIELDS : `${ENTRY_FIELDS} notes actorName actorRole actor voidedBy voidedByName`;
    const [entries, plans] = await Promise.all([
      this.entries.find(filter).select(fields).populate({ path: 'clinic', select: CARE_CLINIC_FIELDS }).sort({ date: -1, createdAt: -1 }).lean().exec(),
      this.plans.find(filter).select(self ? '_id charge patient clinic items revision' : '_id charge patient clinic items revision history createdBy createdByName createdAt').lean().exec(),
    ]);
    const charges = entries.filter(e => e.kind === 'charge').map(charge => {
      const balance = charge.voidedAt ? 0 : chargeBalance(charge.amount, entries.filter(e => e.kind === 'payment' && sameId(e.charge, charge._id)));
      return { ...charge, paid: charge.voidedAt ? 0 : charge.amount - balance, balance };
    });
    const day = manilaDay();
    const schedules = plans.map(plan => {
      const charge = charges.find(c => sameId(c._id, plan.charge));
      const allocation = installmentAllocation(plan.items, charge?.paid ?? 0, day);
      return { ...plan, ...allocation, status: charge?.voidedAt ? 'voided' : charge?.balance === 0 ? 'paid' : 'active',
        overdue: charge?.voidedAt ? 0 : allocation.overdue, upcoming: charge?.voidedAt ? 0 : allocation.upcoming };
    });
    const totals = (subset: typeof charges) => ({ charged: sumMoney(subset.filter(c => !c.voidedAt).map(c => c.amount)), paid: sumMoney(subset.map(c => c.paid)),
      balance: sumMoney(subset.map(c => c.balance)), overdue: sumMoney(schedules.filter(p => subset.some(c => sameId(c._id, p.charge))).map(p => p.overdue)) });
    const clinicIds = [...new Set(charges.map(c => referenceId(c.clinic)))];
    return { patient: person, currency: 'PHP', asOf: day, entries, charges, plans: schedules, totals: totals(charges),
      clinicTotals: clinicIds.map(id => ({ clinic: charges.find(c => sameId(c.clinic, id))?.clinic, ...totals(charges.filter(c => sameId(c.clinic, id))) })) };
  }
}
