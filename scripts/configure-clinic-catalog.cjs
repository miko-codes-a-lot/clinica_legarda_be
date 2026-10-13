'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require(require.resolve('mongoose', { paths: [process.cwd()] }));
const { buildClinicConfigurationPlan } = require('./clinic-configuration-plan.cjs');
const EJSON = mongoose.mongo.BSON.EJSON;
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  assert(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${name}`);
  return args[index + 1];
};
const target = option('--target', 'local');
const apply = args.includes('--apply');
const mainClinicId = '70c100000000000000000002';
const backupDir = option('--backup-dir');
const retainedClinic = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['operatingHours', 'appointmentOnlyDays'].includes(key)));
const retainedService = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'clinics'));
async function run() {
  assert(['local', 'live'].includes(target), 'Target must be local or live');
  assert(target !== 'live' || args.includes('--allow-live'), 'LIVE requires --allow-live');
  assert(!apply || backupDir, '--apply requires --backup-dir');
  let uri = 'mongodb://127.0.0.1:27017/clinica_legarda?directConnection=true';
  if (target === 'live') {
    const dotenv = require(require.resolve('dotenv', { paths: [process.cwd()] }));
    uri = dotenv.parse(fs.readFileSync(path.resolve('.env'))).DATABASE_URI;
    assert(uri, 'Database configuration missing');
  }
  const connection = await mongoose.createConnection(uri, { dbName: 'clinica_legarda', serverSelectionTimeoutMS: 15000 }).asPromise();
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    assert(hello.isWritablePrimary, 'Database must be writable primary');
    if (target === 'local') assert.equal(hello.setName, 'rs0', 'Unexpected local database');
    const collections = (await connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(name => !name.startsWith('system.'));
    const rows = (name, session) => connection.db.collection(name).find({}, { session }).sort({ _id: 1 }).toArray();
    const plan = buildClinicConfigurationPlan(await rows('clinics'), await rows('services'), mainClinicId);
    let summary = { target, apply, mainClinicHoursUpdates: plan.clinicUpdate ? 1 : 0, legacyServiceBackfills: plan.serviceBackfills.length };
    if (apply && (plan.clinicUpdate || plan.serviceBackfills.length)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      const session = await connection.startSession();
      try {
        await session.withTransaction(async () => {
          const clinics = await rows('clinics', session), services = await rows('services', session);
          const current = buildClinicConfigurationPlan(clinics, services, mainClinicId);
          const protectedHashes = {};
          for (const name of collections.filter(name => !['clinics', 'services'].includes(name))) protectedHashes[name] = hash(await rows(name, session));
          const backup = path.join(backupDir, `clinic-catalog-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
          fs.writeFileSync(backup, EJSON.stringify({ database: 'clinica_legarda', clinics, services, plan: current }, null, 2), { mode: 0o600, flag: 'wx' });
          if (current.clinicUpdate) {
            const updated = await connection.db.collection('clinics').updateOne({ _id: new mongoose.Types.ObjectId(mainClinicId) }, { $set: current.clinicUpdate.fields }, { session });
            assert.equal(updated.matchedCount, 1, 'Main clinic disappeared');
          }
          for (const backfill of current.serviceBackfills) {
            const updated = await connection.db.collection('services').updateOne({ _id: new mongoose.Types.ObjectId(backfill.id), clinics: { $exists: false } },
              { $set: { clinics: backfill.clinics.map(id => new mongoose.Types.ObjectId(id)) } }, { session });
            assert.equal(updated.modifiedCount, 1, 'Service assignment changed concurrently');
          }
          const afterClinics = await rows('clinics', session), afterServices = await rows('services', session);
          assert.equal(afterClinics.length, clinics.length); assert.equal(afterServices.length, services.length);
          for (const clinic of clinics) {
            const after = afterClinics.find(row => String(row._id) === String(clinic._id));
            assert(after, 'Clinic identity lost');
            assert.equal(hash(String(clinic._id) === mainClinicId ? retainedClinic(after) : after),
              hash(String(clinic._id) === mainClinicId ? retainedClinic(clinic) : clinic), 'Unrelated clinic fields changed');
          }
          for (const service of services) {
            const after = afterServices.find(row => String(row._id) === String(service._id));
            assert(after, 'Service identity lost'); assert.equal(hash(retainedService(after)), hash(retainedService(service)), 'Service identity/details/duration changed');
            if (Object.hasOwn(service, 'clinics')) assert.equal(hash(after), hash(service), 'Explicit service assignments changed');
          }
          for (const [name, before] of Object.entries(protectedHashes)) assert.equal(hash(await rows(name, session)), before, `Protected collection changed: ${name}`);
          assert.deepEqual(buildClinicConfigurationPlan(afterClinics, afterServices, mainClinicId), { clinicUpdate: null, serviceBackfills: [] });
          summary = { ...summary, backup, protectedCollectionsVerified: Object.keys(protectedHashes).length, preservedExistingIdsAndDurations: true, idempotent: true };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } finally { await session.endSession(); }
    } else if (apply) summary = { ...summary, noChanges: true, idempotent: true };
    console.log(JSON.stringify(summary, null, 2));
  } finally { await connection.close(); }
}
run().catch(error => { console.error(`Clinic configuration stopped: ${error instanceof assert.AssertionError ? error.message : 'Operation failed; database credentials and details omitted'}`); process.exitCode = 1; });
