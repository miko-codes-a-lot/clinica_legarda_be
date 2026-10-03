'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require(require.resolve('mongoose', { paths: [process.cwd()] }));
const { buildPlan } = require('./rnanez-plan.cjs');
const EJSON = mongoose.mongo.BSON.EJSON;
const hash = value => crypto.createHash('sha256').update(EJSON.stringify(value)).digest('hex');
const argumentsList = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argumentsList.indexOf(name);
  if (index < 0) return fallback;
  assert(argumentsList[index + 1] && !argumentsList[index + 1].startsWith('--'), `Missing value for ${name}`);
  return argumentsList[index + 1];
};
const target = option('--target', 'local');
const apply = argumentsList.includes('--apply');
const backupDirectory = option('--backup-dir');
const profilePath = option('--profile', path.resolve(__dirname, '../../clinica_legarda_fe/src/app/_shared/clinic-profile.json'));
const clinicFields = new Set(['name', 'nameKey', 'address', 'mobileNumber', 'emailAddress']);
const retainedFields = row => Object.fromEntries(Object.entries(row).filter(([field]) => !clinicFields.has(field)));

async function run() {
  assert(['local', 'live'].includes(target), 'Target must be local or live');
  assert(target !== 'live' || argumentsList.includes('--allow-live'), 'LIVE requires --allow-live');
  assert(!apply || backupDirectory, '--apply requires --backup-dir');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  let uri = 'mongodb://127.0.0.1:27017/clinica_legarda?directConnection=true';
  if (target === 'live') {
    const dotenv = require(require.resolve('dotenv', { paths: [process.cwd()] }));
    uri = dotenv.parse(fs.readFileSync(path.resolve('.env'))).DATABASE_URI;
    assert(uri, 'Database configuration missing');
  }
  const connection = await mongoose.createConnection(uri, { dbName: 'clinica_legarda', serverSelectionTimeoutMS: 15000 }).asPromise();
  try {
    assert.equal(connection.name, 'clinica_legarda');
    const hello = await connection.db.admin().command({ hello: 1 });
    assert(hello.isWritablePrimary, 'Database must be writable primary');
    if (target === 'local') assert.equal(hello.setName, 'rs0', 'Unexpected local database');
    const collections = (await connection.db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(name => !name.startsWith('system.'));
    const rows = async (collection, session) => connection.db.collection(collection).find({}, { session }).sort({ _id: 1 }).toArray();
    const clinics = await rows('clinics');
    const services = await rows('services');
    const initialPlan = buildPlan(clinics, services, profile);
    let summary = { target, apply, clinics: clinics.length, previousServices: services.length, clinicUpdates: initialPlan.updates.filter(u => u.collection === 'clinics').length, serviceRenames: initialPlan.updates.filter(u => u.collection === 'services').length, newServices: initialPlan.inserts.length, names: initialPlan.inserts.map(s => s.name) };
    if (apply && (initialPlan.updates.length || initialPlan.inserts.length)) {
      fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
      const session = await connection.startSession();
      try {
        await session.withTransaction(async () => {
          const beforeClinics = await rows('clinics', session);
          const beforeServices = await rows('services', session);
          const plan = buildPlan(beforeClinics, beforeServices, profile);
          const protectedHashes = {};
          for (const name of collections.filter(n => !['clinics', 'services'].includes(n))) protectedHashes[name] = hash(await rows(name, session));
          const backup = path.join(backupDirectory, `rnanez-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
          fs.writeFileSync(backup, EJSON.stringify({ database: connection.name, beforeClinics, beforeServices, plan }, null, 2), { mode: 0o600, flag: 'wx' });
          for (const update of plan.updates) {
            const result = await connection.db.collection(update.collection).updateOne({ _id: new mongoose.Types.ObjectId(update.id) }, { $set: update.fields }, { session });
            assert.equal(result.matchedCount, 1, 'Migration target disappeared');
          }
          if (plan.inserts.length) await connection.db.collection('services').insertMany(plan.inserts.map(s => ({ ...s, _id: new mongoose.Types.ObjectId(s._id), createdAt: new Date(), updatedAt: new Date() })), { session });
          const afterClinics = await rows('clinics', session);
          const afterServices = await rows('services', session);
          assert.equal(afterClinics.length, beforeClinics.length, 'Clinic IDs/count changed');
          for (const clinic of beforeClinics) assert.equal(hash(retainedFields(afterClinics.find(c => String(c._id) === String(clinic._id)))), hash(retainedFields(clinic)), 'Clinic schedule/other fields changed');
          for (const service of beforeServices) {
            const after = afterServices.find(s => String(s._id) === String(service._id));
            assert(after, 'Existing service ID removed');
            assert.equal(hash({ ...after, name: service.name }), hash(service), 'Service duration/other fields changed');
          }
          for (const [name, beforeHash] of Object.entries(protectedHashes)) assert.equal(hash(await rows(name, session)), beforeHash, `Protected collection changed: ${name}`);
          assert.deepEqual(buildPlan(afterClinics, afterServices, profile), { updates: [], inserts: [] }, 'Migration is not idempotent');
          summary = { ...summary, backup, services: afterServices.length, protectedCollectionsVerified: Object.keys(protectedHashes).length, preservedExistingIdsAndDurations: true, idempotent: true };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      } finally { await session.endSession(); }
    } else if (apply) summary = { ...summary, idempotent: true, noChanges: true };
    console.log(JSON.stringify(summary, null, 2));
  } finally { await connection.close(); }
}
run().catch(error => { console.error(`Rebrand stopped: ${error instanceof assert.AssertionError ? error.message : 'Operation failed; database credentials and details omitted'}`); process.exitCode = 1; });
