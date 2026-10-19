import { patientDemographics } from './patient-demographics';

describe('optional patient demographics', () => {
  const now = new Date('2026-10-20T16:01:00Z');
  it('leaves legacy profiles unchanged and trims optional text', () => {
    expect(patientDemographics({}, now)).toEqual({});
    expect(patientDemographics({ sex: ' Female ', occupation: ' Student ', religion: '', maritalStatus: ' Single ' }, now))
      .toEqual({ sex: 'Female', occupation: 'Student', religion: '', maritalStatus: 'Single' });
  });
  it('validates calendar dates against the Manila day and allows clearing', () => {
    expect(patientDemographics({ birthDate: '2024-02-29' }, now).birthDate).toBe('2024-02-29');
    expect(patientDemographics({ birthDate: '2026-10-21' }, now).birthDate).toBe('2026-10-21');
    expect(patientDemographics({ birthDate: '' }, now).birthDate).toBe('');
    for (const birthDate of ['2025-02-29','2024-02-30','2026-10-22','12/10/2000'])
      expect(() => patientDemographics({ birthDate }, now)).toThrow();
  });
  it('rejects non-text and oversized text', () => {
    expect(() => patientDemographics({ occupation: 'x'.repeat(101) }, now)).toThrow();
    expect(() => patientDemographics({ sex: 2 }, now)).toThrow();
  });
});
