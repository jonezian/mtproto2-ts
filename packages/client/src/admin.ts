import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for admin methods.
 */
const CID = {
  channels_createChannel: 0x91006707,
  channels_deleteChannel: 0xc0111fe3,
  channels_editAdmin: 0xd33c8902,
  chatAdminRights: 0x5fb224d5,
} as const;

export { CID as ADMIN_CID };

/**
 * Create a new channel or supergroup (admin helper).
 *
 * TL: channels.createChannel#91006707 flags:# broadcast:flags.0?true megagroup:flags.1?true
 *     for_import:flags.3?true forum:flags.5?true title:string about:string
 *     geo_point:flags.2?InputGeoPoint address:flags.2?string ttl_period:flags.4?int = Updates;
 *
 * @param client - TelegramClient instance
 * @param title - Channel title
 * @param about - Channel description
 * @param megagroup - Whether to create a megagroup (supergroup) instead of a channel
 * @returns Raw TL response buffer
 */
export async function createChannel(
  client: TelegramClient,
  title: string,
  about: string,
  megagroup?: boolean,
): Promise<Buffer> {
  const w = new TLWriter(title.length + about.length + 128);
  w.writeConstructorId(CID.channels_createChannel);

  let flags = 0;
  if (megagroup) {
    flags |= (1 << 1);
  } else {
    flags |= (1 << 0);
  }
  w.writeInt32(flags);

  w.writeString(title);
  w.writeString(about);

  return client.invoke(w.toBuffer());
}

/**
 * Delete a channel or supergroup.
 *
 * TL: channels.deleteChannel#c0111fe3 channel:InputChannel = Updates;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @returns Raw TL response buffer
 */
export async function deleteChannel(
  client: TelegramClient,
  channel: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(channel.length + 32);
  w.writeConstructorId(CID.channels_deleteChannel);
  w.writeRaw(channel);
  return client.invoke(w.toBuffer());
}

/**
 * Edit admin rights for a user in a channel (admin helper).
 *
 * TL: channels.editAdmin#d33c8902 channel:InputChannel user_id:InputUser
 *     admin_rights:ChatAdminRights rank:string = Updates;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @param userId - Serialized InputUser bytes
 * @param rights - Admin rights flags bitmask
 * @returns Raw TL response buffer
 */
export async function editAdmin(
  client: TelegramClient,
  channel: Buffer,
  userId: Buffer,
  rights: number,
): Promise<Buffer> {
  const w = new TLWriter(128);
  w.writeConstructorId(CID.channels_editAdmin);
  w.writeRaw(channel);
  w.writeRaw(userId);
  // chatAdminRights#5fb224d5 flags:#
  w.writeConstructorId(CID.chatAdminRights);
  w.writeInt32(rights);
  w.writeString(''); // rank
  return client.invoke(w.toBuffer());
}
