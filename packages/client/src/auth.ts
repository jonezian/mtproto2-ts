import { TLWriter } from '@kerainmtp/binary';
import type { TelegramClient } from './client.js';

/**
 * TL Constructor IDs for auth methods and related types.
 */
const CID = {
  auth_sendCode: 0xa677244f,
  auth_signIn: 0x8d52a951,
  auth_signUp: 0xaac7b717,
  auth_logOut: 0x3e72ba19,
  auth_checkPassword: 0xd18b4d16,
  codeSettings: 0xad253d78,
  inputCheckPasswordSRP: 0xd27ff082,
  inputCheckPasswordEmpty: 0x9880f658,
} as const;

export { CID as AUTH_CID };

/**
 * Send an authentication code to the given phone number.
 *
 * TL: auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
 *
 * @returns Raw TL response buffer (auth.SentCode)
 */
export async function sendCode(
  client: TelegramClient,
  phoneNumber: string,
): Promise<Buffer> {
  const w = new TLWriter(256);
  w.writeConstructorId(CID.auth_sendCode);
  w.writeString(phoneNumber);
  w.writeInt32(client.apiId);
  w.writeString(client.apiHash);
  // codeSettings#ad253d78 flags:# ... (all flags 0 for basic settings)
  w.writeConstructorId(CID.codeSettings);
  w.writeInt32(0); // flags = 0
  return client.invoke(w.toBuffer());
}

/**
 * Sign in with the received phone code.
 *
 * TL: auth.signIn#8d52a951 flags:# phone_number:string phone_code_hash:string phone_code:flags.0?string = auth.Authorization;
 *
 * @returns Raw TL response buffer (auth.Authorization)
 */
export async function signIn(
  client: TelegramClient,
  phoneNumber: string,
  phoneCodeHash: string,
  phoneCode: string,
): Promise<Buffer> {
  const w = new TLWriter(256);
  w.writeConstructorId(CID.auth_signIn);
  const flags = 0x1; // phone_code present (flags.0)
  w.writeInt32(flags);
  w.writeString(phoneNumber);
  w.writeString(phoneCodeHash);
  w.writeString(phoneCode);
  return client.invoke(w.toBuffer());
}

/**
 * Sign up a new user.
 *
 * TL: auth.signUp#aac7b717 flags:# no_joined_notifications:flags.0?true phone_number:string phone_code_hash:string first_name:string last_name:string = auth.Authorization;
 *
 * @returns Raw TL response buffer (auth.Authorization)
 */
export async function signUp(
  client: TelegramClient,
  phoneNumber: string,
  phoneCodeHash: string,
  firstName: string,
  lastName?: string,
): Promise<Buffer> {
  const w = new TLWriter(256);
  w.writeConstructorId(CID.auth_signUp);
  w.writeInt32(0); // flags = 0 (no_joined_notifications = false)
  w.writeString(phoneNumber);
  w.writeString(phoneCodeHash);
  w.writeString(firstName);
  w.writeString(lastName ?? '');
  return client.invoke(w.toBuffer());
}

/**
 * Log out from the current session.
 *
 * TL: auth.logOut#3e72ba19 = auth.LoggedOut;
 *
 * @returns Raw TL response buffer (auth.LoggedOut)
 */
export async function logOut(client: TelegramClient): Promise<Buffer> {
  const w = new TLWriter(16);
  w.writeConstructorId(CID.auth_logOut);
  return client.invoke(w.toBuffer());
}

/**
 * Check the 2FA password.
 *
 * TL: auth.checkPassword#d18b4d16 password:InputCheckPasswordSRP = auth.Authorization;
 *
 * The `srpParams` buffer should contain the serialized InputCheckPasswordSRP
 * object (srpId, A, M1). If no password is provided, sends inputCheckPasswordEmpty.
 *
 * @param client - TelegramClient instance
 * @param srpParams - Serialized InputCheckPasswordSRP bytes (srpId + A + M1),
 *                    or undefined to send inputCheckPasswordEmpty
 * @returns Raw TL response buffer (auth.Authorization)
 */
export async function checkPassword(
  client: TelegramClient,
  srpParams?: Buffer,
): Promise<Buffer> {
  const w = new TLWriter(256);
  w.writeConstructorId(CID.auth_checkPassword);
  if (srpParams) {
    w.writeRaw(srpParams);
  } else {
    w.writeConstructorId(CID.inputCheckPasswordEmpty);
  }
  return client.invoke(w.toBuffer());
}
