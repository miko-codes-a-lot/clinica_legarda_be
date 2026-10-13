'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildClinicConfigurationPlan } = require('./clinic-configuration-plan.cjs');
const mainId = '70c100000000000000000002';
const clinics = [{ _id: '70c100000000000000000001', operatingHours: [{ day: 'sunday', startTime: '09:00', endTime: '17:00' }] },
  { _id: mainId, name: 'R. Nañez Dental Clinic', operatingHours: [] }];
test('changes main clinic hours and backfills only absent service assignments, preserving identity and durations', () => {
  const services = [{ _id: '1', name: 'Legacy', duration: 45 }, { _id: '2', name: 'Unavailable', duration: 90, clinics: [] },
    { _id: '3', name: 'Assigned', duration: 30, clinics: [mainId] }];
  const snapshot = JSON.stringify({ clinics, services });
  const plan = buildClinicConfigurationPlan(clinics, services, mainId);
  assert.deepEqual(plan.serviceBackfills, [{ id: '1', clinics: ['70c100000000000000000001', mainId] }]);
  assert.equal(plan.clinicUpdate.id, mainId);
  assert.deepEqual(plan.clinicUpdate.fields.appointmentOnlyDays, ['sunday']);
  assert.deepEqual(plan.clinicUpdate.fields.operatingHours, [
    ...['monday','tuesday','wednesday','thursday','friday'].map(day => ({ day, startTime: '09:30', endTime: '16:00' })),
    { day: 'saturday', startTime: '11:00', endTime: '16:00' },
  ]);
  assert.equal(JSON.stringify({ clinics, services }), snapshot);
});
test('is idempotent after the exact plan is applied', () => {
  const first = buildClinicConfigurationPlan(clinics, [{ _id: '1', name: 'Legacy', duration: 45 }], mainId);
  assert.deepEqual(buildClinicConfigurationPlan(clinics.map(row => String(row._id) === mainId ? { ...row, ...first.clinicUpdate.fields } : row),
    [{ _id: '1', name: 'Legacy', duration: 45, clinics: first.serviceBackfills[0].clinics }], mainId), { clinicUpdate: null, serviceBackfills: [] });
});
test('refuses unknown main clinic identity or malformed existing assignments', () => {
  assert.throws(() => buildClinicConfigurationPlan(clinics, [], '70c100000000000000000099'), /main clinic/);
  assert.throws(() => buildClinicConfigurationPlan(clinics, [{ _id: '1', clinics: null }], mainId), /Malformed service assignments/);
});
