# Learning database seed

The learning seed recreates a useful fictional Clinica Legarda dataset without
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

The first run creates users with secure random passwords that are intentionally
not printed or saved.

## Set a known local learning password

Read the password silently, export it only for the seed process, and remove it
from the shell afterward:

```sh
printf 'Learning password: '
read -s SEED_USER_PASSWORD
printf '\n'
export SEED_USER_PASSWORD
SEED_RESET_PASSWORDS=true SEED_MARK_OTP_VERIFIED=true npm run seed:learning
unset SEED_USER_PASSWORD
```

Requirements:

- at least 12 characters;
- never put the password in a committed file or command-line argument;
- `SEED_MARK_OTP_VERIFIED=true` provides only the application's existing
  24-hour OTP grace period.

Seed usernames:

- `learning.superadmin`
- `learning.admin`
- `learning.dentist.ana`
- `learning.dentist.miguel`
- `learning.dentist.sofia`
- `learning.patient.alex`
- `learning.patient.jamie`
- `learning.patient.sam`
- `learning.patient.taylor`

All names, email addresses, phone numbers, addresses, clinical notes, and
appointments are fictional learning data.

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

Remote MongoDB URIs are rejected by default. A remote seed requires both an
explicit allow flag and an exact database-name confirmation:

```sh
ALLOW_REMOTE_SEED=true \
SEED_CONFIRM_DATABASE='clinica_legarda' \
DATABASE_URI='<provided securely outside Git>' \
DATABASE_NAME='clinica_legarda' \
npm run seed:learning
```

The script never calls `dropDatabase`, deletes a collection, or deletes
documents. It only upserts its deterministic learning records and creates the
indexes declared by the current Mongoose schemas.
