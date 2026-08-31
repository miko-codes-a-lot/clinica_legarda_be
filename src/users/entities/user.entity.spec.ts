import mongoose from 'mongoose';
import { UserSchema } from './user.entity';

describe('UserSchema', () => {
  const modelName = 'UserStatusSchemaTest';
  const UserModel = mongoose.model(modelName, UserSchema);

  afterAll(() => {
    mongoose.deleteModel(modelName);
  });

  it('preserves a confirmed user status', () => {
    const user = new UserModel({ status: 'confirmed' });

    const persisted = user.toObject() as unknown as Record<string, unknown>;

    expect(persisted.status).toBe('confirmed');
  });

  it('defaults a new user to pending status', () => {
    const user = new UserModel();
    const persisted = user.toObject() as unknown as Record<string, unknown>;

    expect(persisted.status).toBe('pending');
  });
});
