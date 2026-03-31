import { TLWriter } from '@mtproto2/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for dialog methods.
 */
const CID = {
  messages_getDialogs: 0xa0f4cb4f,
  messages_getPeerDialogs: 0xe470bcfd,
  inputPeerEmpty: 0x7f3b18ea,
  inputDialogPeer: 0xfcaafeb7,
  vector: 0x1cb5c415,
} as const;

export { CID as DIALOGS_CID };

/**
 * Get the user's dialog list.
 *
 * TL: messages.getDialogs#a0f4cb4f flags:# exclude_pinned:flags.0?true
 *     folder_id:flags.1?int offset_date:int offset_id:int
 *     offset_peer:InputPeer limit:int hash:long = messages.Dialogs;
 *
 * @param client - TelegramClient instance
 * @param opts - Pagination options
 * @returns Raw TL response buffer
 */
export async function getDialogs(
  client: TelegramClient,
  opts?: {
    excludePinned?: boolean;
    folderId?: number;
    offsetDate?: number;
    offsetId?: number;
    offsetPeer?: Buffer;
    limit?: number;
    hash?: bigint;
  },
): Promise<Buffer> {
  const w = new TLWriter(256);
  w.writeConstructorId(CID.messages_getDialogs);

  let flags = 0;
  if (opts?.excludePinned) flags |= (1 << 0);
  if (opts?.folderId !== undefined) flags |= (1 << 1);
  w.writeInt32(flags);

  if (opts?.folderId !== undefined) {
    w.writeInt32(opts.folderId);
  }

  w.writeInt32(opts?.offsetDate ?? 0);
  w.writeInt32(opts?.offsetId ?? 0);

  if (opts?.offsetPeer) {
    w.writeRaw(opts.offsetPeer);
  } else {
    w.writeConstructorId(CID.inputPeerEmpty);
  }

  w.writeInt32(opts?.limit ?? 100);
  w.writeInt64(opts?.hash ?? 0n);

  return client.invoke(w.toBuffer());
}

/**
 * Get dialogs for specific peers.
 *
 * TL: messages.getPeerDialogs#e470bcfd peers:Vector<InputDialogPeer> = messages.PeerDialogs;
 *
 * @param client - TelegramClient instance
 * @param peers - Array of serialized InputPeer buffers
 * @returns Raw TL response buffer
 */
export async function getPeerDialogs(
  client: TelegramClient,
  peers: Buffer[],
): Promise<Buffer> {
  const totalSize = peers.reduce((sum, buf) => sum + buf.length, 0);
  const w = new TLWriter(totalSize + 64 + peers.length * 8);
  w.writeConstructorId(CID.messages_getPeerDialogs);
  // Vector<InputDialogPeer>
  w.writeConstructorId(CID.vector);
  w.writeInt32(peers.length);
  for (const peer of peers) {
    // inputDialogPeer#fcaafeb7 peer:InputPeer
    w.writeConstructorId(CID.inputDialogPeer);
    w.writeRaw(peer);
  }
  return client.invoke(w.toBuffer());
}
