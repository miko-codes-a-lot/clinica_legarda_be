import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { UserActor } from '../auth/role-policy';
import { referenceId } from '../auth/reference-id';
import { PatientRecordAuditState, PatientRecordChange } from './entities/patient-record-change.entity';

export const PROFILE_AUDIT_FIELDS = ['firstName','middleName','lastName','username','emailAddress','mobileNumber','address','profilePicture'] as const;
export const CLINICAL_AUDIT_FIELDS = ['assessment','treatments','summary','aftercare','nextSteps','state'] as const;
export function changedPatientFields(before: object, after: object, allowed: readonly string[]): string[] {
  const value = (row: object, key: string): unknown => (row as Record<string, unknown>)[key] ?? '';
  return allowed.filter(field => JSON.stringify(value(before, field)) !== JSON.stringify(value(after, field)));
}
export interface PatientChangeInput {
  patient: string; clinicScope: readonly string[]; actor: UserActor; kind: PatientRecordChange['kind']; fields: readonly string[]; sourceEventId: string;
}
@Injectable()
export class PatientRecordChangesService implements OnModuleInit {
  private coverageFrom?: string;
  constructor(@InjectModel(PatientRecordChange.name) private readonly changes: Model<PatientRecordChange>,
    @InjectModel(PatientRecordAuditState.name) private readonly state: Model<PatientRecordAuditState>) {}
  async onModuleInit() { await this.changes.init(); await this.coverage(); }
  async coverage(): Promise<string> {
    if (this.coverageFrom) return this.coverageFrom;
    const state = await this.state.findOneAndUpdate({ _id: 'coverage' }, { $setOnInsert: { startedAt: new Date(Date.now()) } }, { upsert: true, new: true });
    this.coverageFrom = state!.startedAt.toISOString();
    return this.coverageFrom;
  }
  async recordPatientChange(session: ClientSession, input: PatientChangeInput): Promise<void> {
    const allowed = input.kind === 'profile' ? PROFILE_AUDIT_FIELDS : input.kind === 'clinical' ? CLINICAL_AUDIT_FIELDS : ['dentition','teeth'];
    const fields = [...new Set(input.fields)].filter(field => (allowed as readonly string[]).includes(field));
    if (!fields.length) return;
    await this.changes.create([{ patient: referenceId(input.patient), clinicScope: [...new Set(input.clinicScope.map(referenceId))],
      actorId: referenceId(input.actor.sub), actorRole: input.actor.role, actorName: input.actor.username,
      kind: input.kind, fields, sourceEventId: input.sourceEventId, createdAt: new Date(Date.now()) }], { session });
  }
  inPeriod(scope: Record<string, unknown>, start: Date, end: Date, session: ClientSession) {
    return this.changes.find({ ...scope, createdAt: { $gte: start, $lt: end } }).select('patient createdAt').session(session).lean();
  }
}
