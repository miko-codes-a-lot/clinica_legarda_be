'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const key = value => String(value).normalize('NFKC').trim().toLowerCase();

function buildPlan(clinics, services, profile) {
  assert(clinics.some(c => String(c._id) === profile.mainClinicId), 'Expected main clinic is missing');
  assert(profile.fullName && profile.address && profile.phones?.[0] && profile.email, 'Incomplete clinic profile');
  const plan = { updates: [], inserts: [] };
  const branches = clinics.filter(c => String(c._id) !== profile.mainClinicId).sort((a, b) => String(a._id).localeCompare(String(b._id)));
  for (const clinic of clinics) {
    const main = String(clinic._id) === profile.mainClinicId;
    const index = branches.findIndex(c => String(c._id) === String(clinic._id)) + 1;
    const careDemo = String(clinic._id) === '70ca00000000000000000001';
    const name = main ? profile.fullName : `${profile.fullName} — ${careDemo ? 'Care demo' : `Demo branch ${index}`}`;
    const fields = { name, nameKey: key(name), address: main ? profile.address : `Presentation demo location ${index} — Pasig City`, mobileNumber: profile.phones[0], emailAddress: profile.email };
    if (Object.entries(fields).some(([field, value]) => clinic[field] !== value)) plan.updates.push({ collection: 'clinics', id: String(clinic._id), fields });
  }
  const usedNames = new Set();
  const claimedIds = new Set();
  for (const service of profile.serviceGroups.flatMap(g => g.services)) {
    assert(service.name?.trim().length >= 3, 'Invalid service name');
    assert(Number.isInteger(service.duration) && service.duration > 0, 'Invalid service duration');
    const names = new Set([service.name, ...service.aliases].map(key));
    for (const name of names) {
      assert(!usedNames.has(name), 'Ambiguous service aliases in profile');
      usedNames.add(name);
    }
    const matching = services.filter(s => names.has(key(s.name)));
    assert(matching.length < 2, `Multiple existing services match ${service.name}; preserve references and resolve explicitly`);
    if (matching.length) {
      const existing = matching[0];
      const id = String(existing._id);
      assert(!claimedIds.has(id), 'Service matches multiple profile entries');
      claimedIds.add(id);
      if (existing.name !== service.name) plan.updates.push({ collection: 'services', id, fields: { name: service.name } });
    } else {
      const id = createHash('sha256').update(`rnanez-service:${key(service.name)}`).digest('hex').slice(0, 24);
      assert(!services.some(s => String(s._id) === id), 'Reserved service ID collision');
      plan.inserts.push({ _id: id, name: service.name, duration: service.duration });
    }
  }
  const finalNames = services.map(s => key(plan.updates.find(u => u.collection === 'services' && u.id === String(s._id))?.fields.name || s.name)).concat(plan.inserts.map(s => key(s.name)));
  assert.equal(new Set(finalNames).size, finalNames.length, 'Duplicate service names after migration');
  return plan;
}
module.exports = { buildPlan };
