'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildPlan } = require('./rnanez-plan.cjs');
const profile = { fullName: 'R. Nañez Dental Clinic', mainClinicId: 'main', address: 'Pasig', phones: ['09092535715'], email: 'rnanezdentalclinic@gmail.com',
  serviceGroups: [{ services: [{ name: 'Tooth Restoration', aliases: ['Tooth Filling'], duration: 30 }, { name: 'Braces', aliases: [], duration: 120 }] }] };
const clinics = [{ _id: 'main', name: 'Old main', operatingHours: ['keep'], scheduleRevision: 7 }, { _id: 'other', name: 'Old branch' }];

test('renames clinics without replacing IDs or writing schedules/assignments', () => {
  const frozen = clinics.map(c => Object.freeze({ ...c }));
  const plan = buildPlan(frozen, [], profile);
  assert.deepEqual(plan.updates.find(u => u.id === 'main').fields, { name: 'R. Nañez Dental Clinic', nameKey: 'r. nañez dental clinic', address: 'Pasig', mobileNumber: '09092535715', emailAddress: 'rnanezdentalclinic@gmail.com' });
  assert.equal(plan.updates.find(u => u.id === 'other').fields.name, 'R. Nañez Dental Clinic — Demo branch 1');
  assert.equal(frozen[0].scheduleRevision, 7);
  assert.deepEqual(frozen[0].operatingHours, ['keep']);
});
test('maps a service alias in place and preserves its existing duration', () => {
  const plan = buildPlan(clinics, [{ _id: 'filling', name: 'Tooth Filling', duration: 60 }], profile);
  assert.deepEqual(plan.updates.find(u => u.collection === 'services'), { collection: 'services', id: 'filling', fields: { name: 'Tooth Restoration' } });
  assert.equal(plan.inserts.length, 1);
  assert.equal(plan.inserts[0].name, 'Braces');
  assert.equal(plan.inserts[0].duration, 120);
});
test('rejects alias/canonical collisions instead of merging referenced services', () => {
  assert.throws(() => buildPlan(clinics, [{ _id: 'a', name: 'Tooth Filling' }, { _id: 'b', name: 'tooth restoration' }], profile), /multiple existing services/i);
});
test('does not invent a replacement main clinic when the expected record is missing', () => {
  assert.throws(() => buildPlan([{ _id: 'other', name: 'Something' }], [], profile), /main clinic/i);
});
test('is idempotent and does not rename unrelated service records', () => {
  const first = buildPlan(clinics, [{ _id: 'unrelated', name: 'Dental Consultation', duration: 45 }], profile);
  const brandedClinics = clinics.map(c => ({ ...c, ...first.updates.find(u => u.id === c._id).fields }));
  const services = [{ _id: 'unrelated', name: 'Dental Consultation', duration: 45 }, ...first.inserts];
  const second = buildPlan(brandedClinics, services, profile);
  assert.deepEqual(second, { updates: [], inserts: [] });
});
test('rejects invalid scheduling defaults before a migration can write', () => {
  const bad = { ...profile, serviceGroups: [{ services: [{ name: 'Braces', aliases: [], duration: NaN }] }] };
  assert.throws(() => buildPlan(clinics, [], bad), /duration/i);
});
