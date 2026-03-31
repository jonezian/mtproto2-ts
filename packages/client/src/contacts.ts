import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for contacts methods.
 */
const CID = {
  contacts_importContacts: 0x2c800be5,
  contacts_resolveUsername: 0x725afbbc,
  contacts_search: 0x11f812d8,
  contacts_getContacts: 0x5dd69e12,
  inputPhoneContact: 0xf392b7f4,
  vector: 0x1cb5c415,
} as const;

export { CID as CONTACTS_CID };

/**
 * A phone contact to import.
 */
export interface PhoneContact {
  clientId: bigint;
  phone: string;
  firstName: string;
  lastName: string;
}

/**
 * Import phone contacts.
 *
 * TL: contacts.importContacts#2c800be5 contacts:Vector<InputContact> = contacts.ImportedContacts;
 *
 * @param client - TelegramClient instance
 * @param contacts - Array of phone contacts
 * @returns Raw TL response buffer
 */
export async function importContacts(
  client: TelegramClient,
  contacts: PhoneContact[],
): Promise<Buffer> {
  const w = new TLWriter(contacts.length * 128 + 64);
  w.writeConstructorId(CID.contacts_importContacts);
  // Vector<InputContact>
  w.writeConstructorId(CID.vector);
  w.writeInt32(contacts.length);
  for (const contact of contacts) {
    // inputPhoneContact#f392b7f4 client_id:long phone:string first_name:string last_name:string
    w.writeConstructorId(CID.inputPhoneContact);
    w.writeInt64(contact.clientId);
    w.writeString(contact.phone);
    w.writeString(contact.firstName);
    w.writeString(contact.lastName);
  }
  return client.invoke(w.toBuffer());
}

/**
 * Resolve a username to a peer.
 *
 * TL: contacts.resolveUsername#725afbbc flags:# username:string referer:flags.0?string = contacts.ResolvedPeer;
 *
 * @param client - TelegramClient instance
 * @param username - Username to resolve (without the @ prefix)
 * @returns Raw TL response buffer
 */
export async function resolveUsername(
  client: TelegramClient,
  username: string,
): Promise<Buffer> {
  const w = new TLWriter(username.length + 64);
  w.writeConstructorId(CID.contacts_resolveUsername);
  w.writeInt32(0); // flags = 0 (no referer)
  w.writeString(username);
  return client.invoke(w.toBuffer());
}

/**
 * Search for contacts.
 *
 * TL: contacts.search#11f812d8 q:string limit:int = contacts.Found;
 *
 * @param client - TelegramClient instance
 * @param query - Search query
 * @param limit - Maximum number of results
 * @returns Raw TL response buffer
 */
export async function search(
  client: TelegramClient,
  query: string,
  limit?: number,
): Promise<Buffer> {
  const w = new TLWriter(query.length + 64);
  w.writeConstructorId(CID.contacts_search);
  w.writeString(query);
  w.writeInt32(limit ?? 50);
  return client.invoke(w.toBuffer());
}

/**
 * Get the user's contacts.
 *
 * TL: contacts.getContacts#5dd69e12 hash:long = contacts.Contacts;
 *
 * @param client - TelegramClient instance
 * @param hash - Hash for checking if the contact list has changed
 * @returns Raw TL response buffer
 */
export async function getContacts(
  client: TelegramClient,
  hash?: bigint,
): Promise<Buffer> {
  const w = new TLWriter(32);
  w.writeConstructorId(CID.contacts_getContacts);
  w.writeInt64(hash ?? 0n);
  return client.invoke(w.toBuffer());
}
