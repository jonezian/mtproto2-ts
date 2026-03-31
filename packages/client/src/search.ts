import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for search methods.
 */
const CID = {
  messages_searchGlobal: 0x4bc6589a,
  inputMessagesFilterEmpty: 0x57e2f66c,
  inputPeerEmpty: 0x7f3b18ea,
} as const;

export { CID as SEARCH_CID };

/**
 * Search messages globally across all chats.
 *
 * TL: messages.searchGlobal#4bc6589a flags:# broadcasts_only:flags.1?true
 *     groups_only:flags.2?true users_only:flags.3?true
 *     folder_id:flags.0?int q:string filter:MessagesFilter
 *     min_date:int max_date:int offset_rate:int offset_peer:InputPeer
 *     offset_id:int limit:int = messages.Messages;
 *
 * @param client - TelegramClient instance
 * @param query - Search query
 * @param opts - Search options
 * @returns Raw TL response buffer
 */
export async function searchGlobal(
  client: TelegramClient,
  query: string,
  opts?: {
    folderId?: number;
    broadcastsOnly?: boolean;
    groupsOnly?: boolean;
    usersOnly?: boolean;
    minDate?: number;
    maxDate?: number;
    offsetRate?: number;
    offsetPeer?: Buffer;
    offsetId?: number;
    limit?: number;
  },
): Promise<Buffer> {
  const w = new TLWriter(query.length + 256);
  w.writeConstructorId(CID.messages_searchGlobal);

  let flags = 0;
  if (opts?.folderId !== undefined) flags |= (1 << 0);
  if (opts?.broadcastsOnly) flags |= (1 << 1);
  if (opts?.groupsOnly) flags |= (1 << 2);
  if (opts?.usersOnly) flags |= (1 << 3);
  w.writeInt32(flags);

  if (opts?.folderId !== undefined) {
    w.writeInt32(opts.folderId);
  }

  w.writeString(query);
  // filter: inputMessagesFilterEmpty
  w.writeConstructorId(CID.inputMessagesFilterEmpty);
  w.writeInt32(opts?.minDate ?? 0);
  w.writeInt32(opts?.maxDate ?? 0);
  w.writeInt32(opts?.offsetRate ?? 0);

  if (opts?.offsetPeer) {
    w.writeRaw(opts.offsetPeer);
  } else {
    w.writeConstructorId(CID.inputPeerEmpty);
  }

  w.writeInt32(opts?.offsetId ?? 0);
  w.writeInt32(opts?.limit ?? 100);

  return client.invoke(w.toBuffer());
}
