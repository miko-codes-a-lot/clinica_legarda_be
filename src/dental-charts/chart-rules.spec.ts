import { chartTeeth, toothNumbers } from './chart-rules';
describe('manual dental chart observations', () => {
  it('uses separate permanent and primary numbering with no inferred findings', () => {
    expect(toothNumbers('permanent')).toHaveLength(32); expect(toothNumbers('primary')).toHaveLength(20);
    expect(toothNumbers('permanent')).toEqual(expect.arrayContaining([11,18,21,28,31,38,41,48]));
    expect(toothNumbers('primary')).toEqual(expect.arrayContaining([51,55,61,65,71,75,81,85]));
    expect(chartTeeth('permanent', [{ tooth: 11, observation: ' Observed by clinician ', notes: ' Note ' }])).toEqual([{ tooth: 11, observation: 'Observed by clinician', notes: 'Note' }]);
    expect(chartTeeth('primary', [])).toEqual([]);
  });
  it('rejects invalid teeth, mixed sets, duplicates and unbounded or blank observations', () => {
    for (const tooth of [0,19,49,51,11.5]) expect(() => chartTeeth('permanent', [{ tooth, observation: 'Recorded' }])).toThrow();
    expect(() => chartTeeth('primary', [{ tooth: 11, observation: 'Recorded' }])).toThrow();
    expect(() => chartTeeth('permanent', [{ tooth: 11, observation: 'Recorded' }, { tooth: 11, observation: 'Duplicate' }])).toThrow();
    expect(() => chartTeeth('permanent', [{ tooth: 11, observation: ' ' }])).toThrow();
    expect(() => chartTeeth('permanent', [{ tooth: 11, observation: 'x'.repeat(1001) }])).toThrow();
    expect(() => chartTeeth('invalid', [])).toThrow();
  });
});
