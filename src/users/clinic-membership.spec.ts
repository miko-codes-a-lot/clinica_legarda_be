import mongoose from 'mongoose';
import { assignedClinicIds } from './clinic-membership';
import { UserSchema } from './entities/user.entity';

const first = '64a000000000000000000001';
const second = '64a000000000000000000002';
const UserModel = mongoose.model('MembershipFallbackTest', UserSchema);

describe('Current clinic membership', () => {
  afterAll(() => mongoose.deleteModel('MembershipFallbackTest'));

  it('retains legacy membership when reading documents without an assignment array', () => {
    const legacy = UserModel.hydrate({
      clinic: new mongoose.Types.ObjectId(first),
    });
    expect(assignedClinicIds(legacy)).toEqual([first]);
  });

  it('keeps an explicit revocation authoritative over a stale legacy field', () => {
    const revoked = UserModel.hydrate({
      clinic: new mongoose.Types.ObjectId(first),
      clinics: [],
    });
    expect(assignedClinicIds(revoked)).toEqual([]);
  });

  it('uses all current assignments for both populated and stored references', () => {
    expect(
      assignedClinicIds({
        clinic: first,
        clinics: [
          { _id: new mongoose.Types.ObjectId(second) },
          new mongoose.Types.ObjectId(first),
        ],
      }),
    ).toEqual([second, first]);
  });
});
