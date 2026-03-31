import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for user methods.
 */
const CID = {
  users_getUsers: 0x0d91a548,
  users_getFullUser: 0xb60f5918,
  vector: 0x1cb5c415,
} as const;

export { CID as USERS_CID };

/**
 * Get information about users.
 *
 * TL: users.getUsers#0d91a548 id:Vector<InputUser> = Vector<User>;
 *
 * @param client - TelegramClient instance
 * @param ids - Array of serialized InputUser buffers
 * @returns Raw TL response buffer
 */
export async function getUsers(
  client: TelegramClient,
  ids: Buffer[],
): Promise<Buffer> {
  const totalSize = ids.reduce((sum, buf) => sum + buf.length, 0);
  const w = new TLWriter(totalSize + 64);
  w.writeConstructorId(CID.users_getUsers);
  // Vector<InputUser>
  w.writeConstructorId(CID.vector);
  w.writeInt32(ids.length);
  for (const id of ids) {
    w.writeRaw(id);
  }
  return client.invoke(w.toBuffer());
}

/**
 * Get full information about a user.
 *
 * TL: users.getFullUser#b60f5918 id:InputUser = users.UserFull;
 *
 * @param client - TelegramClient instance
 * @param userId - Serialized InputUser buffer
 * @returns Raw TL response buffer
 */
export async function getFullUser(
  client: TelegramClient,
  userId: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(userId.length + 32);
  w.writeConstructorId(CID.users_getFullUser);
  w.writeRaw(userId);
  return client.invoke(w.toBuffer());
}
