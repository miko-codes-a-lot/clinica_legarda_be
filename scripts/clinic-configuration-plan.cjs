'use strict';
const assert = require('node:assert/strict');
const fixedHours = [
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map(day => ({ day, startTime: '09:30', endTime: '16:00' })),
  { day: 'saturday', startTime: '11:00', endTime: '16:00' },
];
function buildClinicConfigurationPlan(clinics, services, mainClinicId) {
  const main = clinics.find(clinic => String(clinic._id) === mainClinicId);
  assert(main, 'Expected main clinic is missing');
  const ids = clinics.map(clinic => String(clinic._id)).sort();
  const currentHours = (main.operatingHours || []).map(({ day, startTime, endTime }) => ({ day, startTime, endTime }));
  const fields = { operatingHours: fixedHours.map(hour => ({ ...hour })), appointmentOnlyDays: ['sunday'] };
  const clinicUpdate = JSON.stringify(currentHours) === JSON.stringify(fixedHours) && JSON.stringify(main.appointmentOnlyDays) === '["sunday"]'
    ? null : { id: mainClinicId, fields };
  const serviceBackfills = services.flatMap(service => {
    if (!Object.hasOwn(service, 'clinics')) return [{ id: String(service._id), clinics: [...ids] }];
    assert(Array.isArray(service.clinics), 'Malformed service assignments; resolve before backfill');
    return [];
  });
  return { clinicUpdate, serviceBackfills };
}
module.exports = { buildClinicConfigurationPlan };
