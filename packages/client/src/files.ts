import crypto from 'node:crypto';
import { TLWriter, TLReader } from '@mtproto2/binary';

// Constructor IDs
const CID = {
  upload_saveFilePart: 0xb304a621,
  upload_saveBigFilePart: 0xde7b673d,
  upload_getFile: 0xbe5335be,
  upload_getCdnFile: 0x395f69da,
  upload_file: 0x096a18d5,
  upload_fileCdnRedirect: 0xf18cda44,
  storage_fileUnknown: 0xaa963b05,
  inputFileLocation: 0xdfdaabe1,
  inputPhotoFileLocation: 0x40181ffe,
  inputDocumentFileLocation: 0xbad07584,
  inputPeerPhotoFileLocation: 0x37c1011c,
} as const;

export { CID as FILE_CID };

export interface FilePartOptions {
  fileId: bigint;     // Random unique file ID
  filePart: number;   // Part number (0-indexed)
  bytes: Buffer;      // Part data (max 524288 = 512KB)
}

export interface BigFilePartOptions extends FilePartOptions {
  fileTotalParts: number;  // Total number of parts
}

export interface GetFileOptions {
  location: Buffer;   // Serialized InputFileLocation
  offset: bigint;     // Byte offset
  limit: number;      // Max bytes to return (must be divisible by 4096, max 1048576 = 1MB)
}

export interface UploadResult {
  fileId: bigint;
  parts: number;
  name: string;
  md5Checksum?: string;
}

export interface GetFileResult {
  type: number;  // File type constructor ID
  mtime: number;
  bytes: Buffer;
}

export interface CdnRedirectResult {
  cdnRedirect: true;
  dcId: number;
  fileToken: Buffer;
  encryptionKey: Buffer;
  encryptionIv: Buffer;
}

/**
 * Serialize upload.saveFilePart request.
 *
 * TL: upload.saveFilePart#b304a621 file_id:long file_part:int bytes:bytes = Bool;
 */
export function serializeSaveFilePart(opts: FilePartOptions): Buffer {
  const w = new TLWriter(opts.bytes.length + 64);
  w.writeConstructorId(CID.upload_saveFilePart);
  w.writeInt64(opts.fileId);
  w.writeInt32(opts.filePart);
  w.writeBytes(opts.bytes);
  return w.toBuffer();
}

/**
 * Serialize upload.saveBigFilePart request.
 *
 * TL: upload.saveBigFilePart#de7b673d file_id:long file_part:int file_total_parts:int bytes:bytes = Bool;
 */
export function serializeSaveBigFilePart(opts: BigFilePartOptions): Buffer {
  const w = new TLWriter(opts.bytes.length + 64);
  w.writeConstructorId(CID.upload_saveBigFilePart);
  w.writeInt64(opts.fileId);
  w.writeInt32(opts.filePart);
  w.writeInt32(opts.fileTotalParts);
  w.writeBytes(opts.bytes);
  return w.toBuffer();
}

/**
 * Serialize upload.getFile request.
 *
 * TL: upload.getFile#be5335be flags:# precise:flags.0?true cdn_supported:flags.1?true location:InputFileLocation offset:long limit:int = upload.File;
 *
 * We set flags to 0 (no precise, no cdn_supported).
 */
export function serializeGetFile(opts: GetFileOptions): Buffer {
  const w = new TLWriter(opts.location.length + 64);
  w.writeConstructorId(CID.upload_getFile);
  w.writeInt32(0); // flags: no precise, no cdn_supported
  w.writeRaw(opts.location); // Already serialized InputFileLocation
  w.writeInt64(opts.offset);
  w.writeInt32(opts.limit);
  return w.toBuffer();
}

/**
 * Parse upload.file or upload.fileCdnRedirect response.
 *
 * upload.file#96a18d5 type:storage.FileType mtime:int bytes:bytes = upload.File;
 * upload.fileCdnRedirect#f18cda44 dc_id:int file_token:bytes encryption_key:bytes encryption_iv:bytes = upload.File;
 */
export function parseGetFileResponse(data: Buffer): GetFileResult | CdnRedirectResult {
  const r = new TLReader(data);
  const cid = r.readConstructorId();

  if (cid === CID.upload_file) {
    const type = r.readConstructorId(); // storage.FileType constructor
    const mtime = r.readInt32();
    const bytes = r.readBytes();
    return { type, mtime, bytes };
  } else if (cid === CID.upload_fileCdnRedirect) {
    const dcId = r.readInt32();
    const fileToken = r.readBytes();
    const encryptionKey = r.readBytes();
    const encryptionIv = r.readBytes();
    return { cdnRedirect: true, dcId, fileToken, encryptionKey, encryptionIv };
  }

  throw new Error(
    `Unexpected upload.File constructor: 0x${cid.toString(16).padStart(8, '0')}`,
  );
}

/**
 * Split a file buffer into parts of the given size.
 * The last part may be smaller than partSize.
 */
export function splitFile(data: Buffer, partSize?: number): Buffer[] {
  const size = partSize ?? computePartSize(data.length);
  if (size < 1024 || size > 524288) {
    throw new Error(`Part size must be between 1024 and 524288, got ${size}`);
  }
  if (size % 1024 !== 0) {
    throw new Error(`Part size must be divisible by 1024, got ${size}`);
  }

  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += size) {
    const end = Math.min(offset + size, data.length);
    parts.push(data.subarray(offset, end));
  }

  // If data is empty, return one empty part
  if (parts.length === 0) {
    parts.push(Buffer.alloc(0));
  }

  return parts;
}

/**
 * Compute optimal part size based on total file size.
 *
 * Rules:
 * - Must be divisible by 1024
 * - Minimum 1024 bytes
 * - Maximum 524288 bytes (512KB)
 * - Choose smallest part size that results in <= 4000 parts (Telegram limit is 4000 for big files)
 */
export function computePartSize(fileSize: number): number {
  // Telegram limits: max 3000 parts for regular, 4000 for big files.
  // We target max 3000 parts for safety.
  const maxParts = 3000;
  const minPartSize = 1024;
  const maxPartSize = 524288;

  if (fileSize <= 0) {
    return minPartSize;
  }

  // Start from minimum and double until we find a suitable size
  let partSize = minPartSize;
  while (partSize < maxPartSize) {
    if (Math.ceil(fileSize / partSize) <= maxParts) {
      return partSize;
    }
    partSize *= 2;
  }

  return maxPartSize;
}

/**
 * Serialize inputFileLocation for various file types.
 *
 * - inputPhotoFileLocation#40181ffe id:long access_hash:long file_reference:bytes thumb_size:string = InputFileLocation;
 * - inputDocumentFileLocation#bad07584 id:long access_hash:long file_reference:bytes thumb_size:string = InputFileLocation;
 * - inputPeerPhotoFileLocation#37c1011c flags:# big:flags.0?true peer:InputPeer photo_id:long = InputFileLocation;
 *   (simplified: we take id as photo_id and accessHash is unused, fileReference is unused for peer photos)
 */
export function serializeInputFileLocation(opts: {
  type: 'photo' | 'document' | 'peer_photo';
  id: bigint;
  accessHash: bigint;
  fileReference: Buffer;
  thumbSize?: string;
}): Buffer {
  const w = new TLWriter(256);

  if (opts.type === 'photo') {
    w.writeConstructorId(CID.inputPhotoFileLocation);
    w.writeInt64(opts.id);
    w.writeInt64(opts.accessHash);
    w.writeBytes(opts.fileReference);
    w.writeString(opts.thumbSize ?? '');
  } else if (opts.type === 'document') {
    w.writeConstructorId(CID.inputDocumentFileLocation);
    w.writeInt64(opts.id);
    w.writeInt64(opts.accessHash);
    w.writeBytes(opts.fileReference);
    w.writeString(opts.thumbSize ?? '');
  } else if (opts.type === 'peer_photo') {
    // inputPeerPhotoFileLocation#37c1011c flags:# big:flags.0?true peer:InputPeer photo_id:long
    // Simplified: flags=0 (not big), peer is encoded externally
    w.writeConstructorId(CID.inputPeerPhotoFileLocation);
    w.writeInt32(0); // flags: not big
    // The peer would be serialized externally; for our purposes we write
    // a minimal inputPeerUser-like stub using id and accessHash
    w.writeInt64(opts.id);     // photo_id
    w.writeInt64(opts.accessHash); // not standard but used for tracking
    w.writeBytes(opts.fileReference);
  } else {
    throw new Error(`Unknown file location type: ${String(opts.type)}`);
  }

  return w.toBuffer();
}

/**
 * Generate a random file ID for uploads.
 */
export function generateFileId(): bigint {
  return crypto.randomBytes(8).readBigInt64LE(0);
}
