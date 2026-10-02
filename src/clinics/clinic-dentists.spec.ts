import { ClinicsService } from './clinics.service';

const clinicId = '64a000000000000000000002';

it('looks up dentists by all assignments and only falls back for absent membership arrays', async () => {
  const clinic = { _id: clinicId, name: 'Second clinic' };
  const clinicModel = {
    findOne: () =>
      Object.assign(Promise.resolve({ toObject: () => clinic }), {
        populate: () => Promise.resolve(clinic),
      }),
  };
  const find = jest.fn().mockReturnValue({
    select: () => ({
      populate: () => Promise.resolve([{ firstName: 'Assigned dentist' }]),
    }),
    populate: () => Promise.resolve([{ firstName: 'Assigned dentist' }]),
  });
  const service = Reflect.construct(ClinicsService, [
    clinicModel,
    { find },
  ]) as ClinicsService;
  const result = await service.findOne(clinicId, { sub: '64b000000000000000000099', role: 'super-admin' });
  expect(find).toHaveBeenCalledWith({
    role: 'dentist',
    status: 'confirmed',
    $or: [
      { clinics: clinicId },
      { clinics: { $exists: false }, clinic: clinicId },
    ],
  });
  expect(result).toMatchObject({
    dentists: [{ firstName: 'Assigned dentist' }],
  });
});
