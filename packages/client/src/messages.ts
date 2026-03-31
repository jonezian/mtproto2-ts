import { TLWriter } from '@mtproto2/binary';
import { randomBytes } from '@mtproto2/crypto';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for message methods.
 */
const CID = {
  messages_sendMessage: 0xfe05dc9a,
  messages_getMessages: 0x63c66506,
  messages_getHistory: 0x4423e6c5,
  messages_deleteMessages: 0xe58e95d2,
  messages_editMessage: 0xdfd14005,
  messages_search: 0x29ee847a,
  inputMessagesFilterEmpty: 0x57e2f66c,
  inputPeerEmpty: 0x7f3b18ea,
  vector: 0x1cb5c415,
  inputMessageID: 0xa676a322,
} as const;

export { CID as MESSAGES_CID };

/**
 * Send a text message to a peer.
 *
 * TL: messages.sendMessage#fe05dc9a flags:# ... peer:InputPeer message:string random_id:long ...
 *
 * @param client - TelegramClient instance
 * @param peer - Serialized InputPeer bytes
 * @param text - Message text
 * @param opts - Optional parameters
 * @returns Raw TL response buffer
 */
export async function sendMessage(
  client: TelegramClient,
  peer: Buffer,
  text: string,
  opts?: { silent?: boolean; noWebpage?: boolean; randomId?: bigint },
): Promise<Buffer> {
  const w = new TLWriter(text.length + 256);
  w.writeConstructorId(CID.messages_sendMessage);

  let flags = 0;
  if (opts?.noWebpage) flags |= (1 << 1);
  if (opts?.silent) flags |= (1 << 5);
  w.writeInt32(flags);

  w.writeRaw(peer); // InputPeer (already serialized)
  w.writeString(text);
  // random_id: long
  const randomId = opts?.randomId ?? randomBytes(8).readBigInt64LE(0);
  w.writeInt64(randomId);

  return client.invoke(w.toBuffer());
}

/**
 * Get messages by their IDs.
 *
 * TL: messages.getMessages#63c66506 id:Vector<InputMessage> = messages.Messages;
 *
 * @param client - TelegramClient instance
 * @param ids - Array of message IDs
 * @returns Raw TL response buffer
 */
export async function getMessages(
  client: TelegramClient,
  ids: number[],
): Promise<Buffer> {
  const w = new TLWriter(64 + ids.length * 12);
  w.writeConstructorId(CID.messages_getMessages);
  // Vector<InputMessage> — using inputMessageID#a676a322 id:int
  w.writeConstructorId(CID.vector);
  w.writeInt32(ids.length);
  for (const id of ids) {
    w.writeConstructorId(CID.inputMessageID);
    w.writeInt32(id);
  }
  return client.invoke(w.toBuffer());
}

/**
 * Get message history from a peer.
 *
 * TL: messages.getHistory#4423e6c5 peer:InputPeer offset_id:int offset_date:int
 *     add_offset:int limit:int max_id:int min_id:int hash:long = messages.Messages;
 *
 * @param client - TelegramClient instance
 * @param peer - Serialized InputPeer bytes
 * @param opts - Pagination options
 * @returns Raw TL response buffer
 */
export async function getHistory(
  client: TelegramClient,
  peer: Buffer,
  opts?: {
    offsetId?: number;
    offsetDate?: number;
    addOffset?: number;
    limit?: number;
    maxId?: number;
    minId?: number;
    hash?: bigint;
  },
): Promise<Buffer> {
  const w = new TLWriter(128);
  w.writeConstructorId(CID.messages_getHistory);
  w.writeRaw(peer);
  w.writeInt32(opts?.offsetId ?? 0);
  w.writeInt32(opts?.offsetDate ?? 0);
  w.writeInt32(opts?.addOffset ?? 0);
  w.writeInt32(opts?.limit ?? 100);
  w.writeInt32(opts?.maxId ?? 0);
  w.writeInt32(opts?.minId ?? 0);
  w.writeInt64(opts?.hash ?? 0n);
  return client.invoke(w.toBuffer());
}

/**
 * Delete messages by their IDs.
 *
 * TL: messages.deleteMessages#e58e95d2 flags:# revoke:flags.0?true id:Vector<int> = messages.AffectedMessages;
 *
 * @param client - TelegramClient instance
 * @param ids - Array of message IDs to delete
 * @param revoke - Whether to revoke for all participants
 * @returns Raw TL response buffer
 */
export async function deleteMessages(
  client: TelegramClient,
  ids: number[],
  revoke?: boolean,
): Promise<Buffer> {
  const w = new TLWriter(64 + ids.length * 4);
  w.writeConstructorId(CID.messages_deleteMessages);

  const flags = revoke ? 0x1 : 0;
  w.writeInt32(flags);

  // Vector<int>
  w.writeConstructorId(CID.vector);
  w.writeInt32(ids.length);
  for (const id of ids) {
    w.writeInt32(id);
  }

  return client.invoke(w.toBuffer());
}

/**
 * Edit a message.
 *
 * TL: messages.editMessage#dfd14005 flags:# ... peer:InputPeer id:int message:flags.11?string ...
 *
 * @param client - TelegramClient instance
 * @param peer - Serialized InputPeer bytes
 * @param msgId - Message ID to edit
 * @param text - New message text
 * @returns Raw TL response buffer
 */
export async function editMessage(
  client: TelegramClient,
  peer: Buffer,
  msgId: number,
  text: string,
): Promise<Buffer> {
  const w = new TLWriter(text.length + 256);
  w.writeConstructorId(CID.messages_editMessage);

  const flags = (1 << 11); // message present (flags.11)
  w.writeInt32(flags);

  w.writeRaw(peer);
  w.writeInt32(msgId);
  w.writeString(text);

  return client.invoke(w.toBuffer());
}

/**
 * Search messages in a peer.
 *
 * TL: messages.search#29ee847a flags:# peer:InputPeer q:string
 *     from_id:flags.0?InputPeer saved_peer_id:flags.2?InputPeer
 *     saved_reaction:flags.3?Vector<Reaction> top_msg_id:flags.1?int
 *     filter:MessagesFilter min_date:int max_date:int
 *     offset_id:int add_offset:int limit:int max_id:int min_id:int hash:long = messages.Messages;
 *
 * @param client - TelegramClient instance
 * @param peer - Serialized InputPeer bytes
 * @param query - Search query
 * @param opts - Search options
 * @returns Raw TL response buffer
 */
export async function searchMessages(
  client: TelegramClient,
  peer: Buffer,
  query: string,
  opts?: {
    limit?: number;
    offsetId?: number;
    addOffset?: number;
    maxId?: number;
    minId?: number;
    minDate?: number;
    maxDate?: number;
    hash?: bigint;
  },
): Promise<Buffer> {
  const w = new TLWriter(query.length + 256);
  w.writeConstructorId(CID.messages_search);

  const flags = 0; // no optional fields
  w.writeInt32(flags);

  w.writeRaw(peer);
  w.writeString(query);
  // filter: inputMessagesFilterEmpty
  w.writeConstructorId(CID.inputMessagesFilterEmpty);
  w.writeInt32(opts?.minDate ?? 0);
  w.writeInt32(opts?.maxDate ?? 0);
  w.writeInt32(opts?.offsetId ?? 0);
  w.writeInt32(opts?.addOffset ?? 0);
  w.writeInt32(opts?.limit ?? 100);
  w.writeInt32(opts?.maxId ?? 0);
  w.writeInt32(opts?.minId ?? 0);
  w.writeInt64(opts?.hash ?? 0n);

  return client.invoke(w.toBuffer());
}
