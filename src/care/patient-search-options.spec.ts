import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PatientSearchDto } from './dto/patient-search.dto';
import { patientSearchOptions } from './patient-search-options';

describe('Scoped patient list query', () => {
  it('combines account and walk-in registration conditions', () => {
    expect(patientSearchOptions({ page: 1, status: 'confirmed', registration: 'walk_in' }).filter).toEqual({ status: 'confirmed', isWalkIn: true });
    expect(patientSearchOptions({ page: 1, registration: 'standard' }).filter).toEqual({ isWalkIn: { $ne: true } });
  });
  it('sorts by an allowlisted field and adds deterministic pagination ties', () => {
    expect(patientSearchOptions({ page: 1, sortBy: 'username', direction: 'desc' }).sort).toEqual({ username: -1, lastName: 1, firstName: 1, _id: 1 });
    expect(patientSearchOptions({ page: 1, sortBy: 'name', direction: 'desc' }).sort).toEqual({ lastName: -1, firstName: -1, _id: 1 });
    expect(patientSearchOptions({ page: 1 }).sort).toEqual({ lastName: 1, firstName: 1, _id: 1 });
  });
  it('rejects arbitrary fields, invalid status and registration at the query boundary', () => {
    for (const input of [{ sortBy: 'password' }, { direction: 'sideways' }, { status: 'anything' }, { registration: 'true' }]) {
      expect(validateSync(plainToInstance(PatientSearchDto, input)).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(PatientSearchDto, { status: 'walk_in', registration: 'walk_in', sortBy: 'emailAddress', direction: 'asc' }))).toEqual([]);
  });
});
