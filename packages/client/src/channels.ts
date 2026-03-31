import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for channel methods.
 */
const CID = {
  channels_joinChannel: 0x24b524c5,
  channels_leaveChannel: 0xf836aa95,
  channels_getParticipants: 0x77ced9d0,
  channels_getFullChannel: 0x08736a09,
  channels_createChannel: 0x91006707,
  channels_editAdmin: 0xd33c8902,
  channelParticipantsRecent: 0xde3f3c79,
  chatAdminRights: 0x5fb224d5,
} as const;

export { CID as CHANNELS_CID };

/**
 * Join a channel or supergroup.
 *
 * TL: channels.joinChannel#24b524c5 channel:InputChannel = Updates;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @returns Raw TL response buffer
 */
export async function joinChannel(
  client: TelegramClient,
  channel: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(64);
  w.writeConstructorId(CID.channels_joinChannel);
  w.writeRaw(channel);
  return client.invoke(w.toBuffer());
}

/**
 * Leave a channel or supergroup.
 *
 * TL: channels.leaveChannel#f836aa95 channel:InputChannel = Updates;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @returns Raw TL response buffer
 */
export async function leaveChannel(
  client: TelegramClient,
  channel: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(64);
  w.writeConstructorId(CID.channels_leaveChannel);
  w.writeRaw(channel);
  return client.invoke(w.toBuffer());
}

/**
 * Get the participants of a channel.
 *
 * TL: channels.getParticipants#77ced9d0 channel:InputChannel filter:ChannelParticipantsFilter offset:int limit:int hash:long = channels.ChannelParticipants;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @param opts - Pagination options
 * @returns Raw TL response buffer
 */
export async function getParticipants(
  client: TelegramClient,
  channel: Buffer,
  opts?: { offset?: number; limit?: number; hash?: bigint },
): Promise<Buffer> {
  const w = new TLWriter(128);
  w.writeConstructorId(CID.channels_getParticipants);
  w.writeRaw(channel);
  // filter: channelParticipantsRecent (no fields)
  w.writeConstructorId(CID.channelParticipantsRecent);
  w.writeInt32(opts?.offset ?? 0);
  w.writeInt32(opts?.limit ?? 200);
  w.writeInt64(opts?.hash ?? 0n);
  return client.invoke(w.toBuffer());
}

/**
 * Get the full channel information.
 *
 * TL: channels.getFullChannel#08736a09 channel:InputChannel = messages.ChatFull;
 *
 * @param client - TelegramClient instance
 * @param channel - Serialized InputChannel bytes
 * @returns Raw TL response buffer
 */
export async function getFullChannel(
  client: TelegramClient,
  channel: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(64);
  w.writeConstructorId(CID.channels_getFullChannel);
  w.writeRaw(channel);
  return client.invoke(w.toBuffer());
}

/**
 * Create a new channel or supergroup.
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
    flags |= (1 << 1); // megagroup flag
  } else {
    flags |= (1 << 0); // broadcast flag
  }
  w.writeInt32(flags);

  w.writeString(title);
  w.writeString(about);

  return client.invoke(w.toBuffer());
}

/**
 * Edit admin rights for a user in a channel.
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
  w.writeInt32(rights); // flags field serves as the rights bitmask
  w.writeString(''); // rank (empty string for default)
  return client.invoke(w.toBuffer());
}
