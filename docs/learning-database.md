# Learning database seed

The learning seed recreates a useful R. Nañez Dental Clinic presentation dataset without
dropping the database or deleting unrelated records.

It manages these collections in dependency order:

1. `clinics`
2. `services`
3. `reasons`
4. `users`
5. `appointments`
6. `referrals`
7. `notifications`
8. `otps` remains empty because OTPs are temporary

The seed uses stable ObjectIds and upserts, so rerunning it updates the managed
learning records instead of creating duplicates.

## Included learning scenarios

| Collection      | Records | Coverage                                                |
| --------------- | ------: | ------------------------------------------------------- |
| `clinics`       |       2 | Different weekly operating schedules                    |
| `services`      |       8 | Consultations and procedures lasting 30–120 minutes     |
| `reasons`       |       8 | Referral, decline, and shared reason types              |
| `users`         |       9 | Super-admin, admin, three dentists, and four patients   |
| `appointments`  |       8 | Pending, confirmed, completed, cancelled, no-show, etc. |
| `referrals`     |       2 | Confirmed and rejected flows                            |
| `notifications` |       6 | Unread/read appointment notifications                   |
| `otps`          |       0 | Intentionally empty because OTP records are ephemeral   |

All ObjectId links between clinics, users, services, appointments, referrals,
and notifications are checked after every seed or verification run.

## Local Docker MongoDB

The default target is:

```text
mongodb://127.0.0.1:27017/?directConnection=true
database: clinica_legarda
```

Run:

```sh
npm run seed:learning
npm run seed:learning:verify
```

Every seed run resets all managed learning accounts to:

```text
password: password
```

It also refreshes `otpVerifiedAt`, allowing local sign-in without sending an
OTP for the application's existing 24-hour grace period. Rerun the seed when
that local testing window expires.

Learning accounts:

| Role        | Name                  | Username         |
| ----------- | --------------------- | ---------------- |
| Super-admin | Maria Lourdes Santos  | `maria.santos`   |
| Admin       | Carlo Miguel Reyes    | `carlo.reyes`    |
| Dentist     | Ana Patricia Cruz     | `ana.cruz`       |
| Dentist     | Miguel Antonio Garcia | `miguel.garcia`  |
| Dentist     | Sofia Marie Lim       | `sofia.lim`      |
| Patient     | Alex Paolo Rivera     | `alex.rivera`    |
| Patient     | Jamie Nicole Flores   | `jamie.flores`   |
| Patient     | Sam Luis Navarro      | `sam.navarro`    |
| Patient     | Taylor Anne Mendoza   | `taylor.mendoza` |

Patient identities, clinical notes and appointments are fictional learning data.
The main clinic contact details were supplied by the client; other clinic records
are explicitly labelled demo branches for the school presentation.

## Client catalog and existing database rebrand

The rebrand reads the authoritative client content from the sibling frontend's
`src/app/_shared/clinic-profile.json`. Pass `--profile /absolute/path/clinic-profile.json`
when using a separately deployed copy. Run the plan first:

```sh
npm run seed:rnanez
npm run seed:rnanez:test
npm run seed:rnanez -- --apply --backup-dir /absolute/path/private-backups
```

It renames clinic records in place, keeps their IDs/schedules/assignments, maps
service aliases without replacing referenced IDs, and adds missing client services.
Existing service durations remain intact. Newly added basic services use 30 minutes,
prosthetic/periodontal services use 60 minutes (Night Guard 30), and Braces/surgery
use 120 minutes as editable presentation scheduling defaults. These are not a
promise of clinical treatment time. The interview described basic visits of
20–30 minutes and complicated procedures of 1–2 hours.

The migration defaults to read-only, rejects ambiguous alias collisions, requires
a backup directory before applying, and verifies all other collections and retained
clinic/service fields inside the transaction. Backups use MongoDB Extended JSON
with private permissions. A second run must report zero changes. The LIVE target
also requires `--target live --allow-live` and uses the server's existing environment
configuration without printing it. Do not run the broader learning seed against LIVE
to rebrand it: that seed updates accounts and appointment fixtures.

After creating a fresh local learning database, run this rebrand to add the supplied
16-treatment catalog. It preserves the existing consultation/check-up entries.

## Custom local target

```sh
DATABASE_URI='mongodb://127.0.0.1:27018/?directConnection=true' \
DATABASE_NAME='clinica_legarda' \
npm run seed:learning
```

`directConnection=true` keeps a host-run command connected through Docker's
published port even when the replica set advertises a hostname that only
resolves inside its Docker network.

Do not place a credential-bearing URI in shell history. Prefer an environment
file outside Git or a secret manager when authentication is enabled.

## Remote safety gate

Remote MongoDB URIs are rejected by default. Because the learning users share
the intentionally weak password `password`, a remote seed requires an explicit
allow flag, an exact database-name confirmation, and a separate acknowledgment
of the insecure credentials:

```sh
ALLOW_REMOTE_SEED=true \
SEED_CONFIRM_DATABASE='clinica_legarda' \
ALLOW_INSECURE_LEARNING_CREDENTIALS=true \
DATABASE_URI='<provided securely outside Git>' \
DATABASE_NAME='clinica_legarda' \
npm run seed:learning
```

Never expose a remotely seeded learning database through a public API.

The script never calls `dropDatabase`, deletes a collection, or deletes
documents. It only upserts its deterministic learning records and creates the
indexes declared by the current Mongoose schemas.
