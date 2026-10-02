import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { assertClinicalRecordWrite, publicVisitSummary, assertCareCaseLink } from './clinical-rules';

const patient = '000000000000000000000001';
const clinic = '000000000000000000000002';
const dentist = '000000000000000000000003';
describe('clinical visit records and linked treatment rules', () => {
  const visit = () => ({ state: 'in_progress', purpose: 'consultation', revision: 2, dentist, clinic, assessment: 'Internal assessment', treatments: [{ description: 'Exam', tooth: 'Upper', notes: 'Private procedure note' }], summary: 'Exam completed', aftercare: 'Patient instructions', nextSteps: 'Follow-up', events: [{ actor: dentist }], createdBy: dentist });
  it('requires responsible clinical writer and current clinic access', () => {
    expect(() => assertClinicalRecordWrite(visit(), { role: 'admin', sub: patient, clinics: [clinic] }, 2, false, '')).toThrow(ForbiddenException);
    expect(() => assertClinicalRecordWrite(visit(), { role: 'dentist', sub: patient, clinics: [clinic] }, 2, false, '')).toThrow(ForbiddenException);
    expect(() => assertClinicalRecordWrite(visit(), { role: 'dentist', sub: dentist, clinics: [] }, 2, false, '')).toThrow(ForbiddenException);
    expect(() => assertClinicalRecordWrite(visit(), { role: 'dentist', sub: dentist, clinics: [clinic] }, 2, false, '')).not.toThrow();
  });
  it('rejects stale and terminal clinical edits', () => {
    const actor = { role: 'super-admin', sub: patient };
    expect(() => assertClinicalRecordWrite(visit(), actor, 1, false, '')).toThrow(ConflictException);
    for (const state of ['waiting', 'completed', 'cancelled']) expect(() => assertClinicalRecordWrite({ ...visit(), state }, actor, 2, false, '')).toThrow(ConflictException);
  });
  it('requires a nonblank summary when completing clinical care', () => {
    const actor = { role: 'super-admin', sub: patient };
    expect(() => assertClinicalRecordWrite(visit(), actor, 2, true, '  ')).toThrow(BadRequestException);
    expect(() => assertClinicalRecordWrite(visit(), actor, 2, true, 'Consultation complete')).not.toThrow();
  });
  it('projects only published patient-facing fields and treatment descriptions', () => {
    const summary = publicVisitSummary({ ...visit(), _id: patient, state: 'completed', patient, checkedInAt: new Date('2026-10-03'), date: '2026-10-03' });
    expect(summary).toMatchObject({ summary: 'Exam completed', aftercare: 'Patient instructions', treatments: [{ description: 'Exam', tooth: 'Upper' }] });
    expect(JSON.stringify(summary)).not.toMatch(/Internal|Private|assessment|events|createdBy|revision/);
    expect(publicVisitSummary(visit())).toBeNull();
  });
  it('links only an active case with the same patient, dentist and clinic', () => {
    const careCase = { patient, dentist, clinic, status: 'active' };
    expect(() => assertCareCaseLink(careCase, { patient, dentist, clinic })).not.toThrow();
    for (const key of ['patient', 'dentist', 'clinic']) expect(() => assertCareCaseLink(careCase, { patient, dentist, clinic, [key]: '000000000000000000000004' })).toThrow(BadRequestException);
    expect(() => assertCareCaseLink({ ...careCase, status: 'completed' }, careCase)).toThrow(ConflictException);
  });
});
