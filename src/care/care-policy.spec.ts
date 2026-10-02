import { ForbiddenException } from '@nestjs/common';
import { careScope, requireCareStaff, requireCareClinic, patientSearchFilter } from './care-policy';

const clinic = '000000000000000000000001';
const outside = '000000000000000000000002';
const user = '000000000000000000000003';

describe('patient care access and search', () => {
  it('scopes admins by their own clinics', () => {
    expect(careScope({ sub: user, role: 'admin', clinics: [clinic] })).toEqual({ clinic: { $in: [clinic] } });
  });
  it('gives unassigned admins no records', () => {
    expect(careScope({ sub: user, role: 'admin' })).toEqual({ clinic: { $in: [] } });
  });
  it('does not widen selected clinic access', () => {
    expect(() => careScope({ sub: user, role: 'admin', clinics: [clinic] }, outside)).toThrow(ForbiddenException);
  });
  it('limits dentist records to their own sessions', () => {
    expect(careScope({ sub: user, role: 'dentist', clinics: [clinic] })).toEqual({ dentist: user });
  });
  it('limits patients to their own records', () => {
    expect(careScope({ sub: user, role: 'user' })).toEqual({ patient: user });
  });
  it('allows super admin global records', () => {
    expect(careScope({ sub: user, role: 'super-admin' })).toEqual({});
  });
  it('rejects unknown roles and patient staff operations', () => {
    expect(() => careScope({ sub: user, role: 'visitor' })).toThrow(ForbiddenException);
    expect(() => requireCareStaff({ sub: user, role: 'user' })).toThrow(ForbiddenException);
  });
  it('requires current clinic assignment for dentist writes', () => {
    expect(() => requireCareClinic({ sub: user, role: 'dentist', clinics: [clinic] }, outside)).toThrow(ForbiddenException);
    expect(() => requireCareClinic({ sub: user, role: 'dentist', clinics: [clinic] }, clinic)).not.toThrow();
  });
  it('treats search regex characters literally', () => {
    const filter = patientSearchFilter('  Ana.*(test)  ');
    expect(JSON.stringify(filter)).toContain('Ana\\\\.\\\\*\\\\(test\\\\)');
  });
  it('does not use unbounded or blank regex searches', () => {
    expect(patientSearchFilter('   ')).toEqual({});
    expect(() => patientSearchFilter('a'.repeat(101))).toThrow();
  });
  it('supports exact patient identifiers', () => {
    const filter = patientSearchFilter(user) as { $or: Record<string, unknown>[] };
    expect(filter.$or).toContainEqual({ _id: user });
  });
});
