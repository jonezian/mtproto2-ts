import { describe, it, expect } from 'vitest';
import { TLReader } from '@kerainmtp/binary';
import {
  serializeSaveFilePart,
  serializeSaveBigFilePart,
  serializeGetFile,
  parseGetFileResponse,
  splitFile,
  computePartSize,
  serializeInputFileLocation,
  generateFileId,
  FILE_CID,
} from './files.js';

describe('serializeSaveFilePart', () => {
  it('should serialize with correct constructor ID', () => {
    const buf = serializeSaveFilePart({
      fileId: 12345n,
      filePart: 0,
      bytes: Buffer.from([0x01, 0x02, 0x03]),
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.upload_saveFilePart);
  });

  it('should serialize fileId as int64', () => {
    const fileId = 9876543210n;
    const buf = serializeSaveFilePart({
      fileId,
      filePart: 0,
      bytes: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    r.readConstructorId(); // skip CID
    expect(r.readInt64()).toBe(fileId);
  });

  it('should serialize filePart as int32', () => {
    const buf = serializeSaveFilePart({
      fileId: 1n,
      filePart: 42,
      bytes: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt64(); // skip fileId
    expect(r.readInt32()).toBe(42);
  });

  it('should serialize bytes as TL bytes', () => {
    const data = Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]);
    const buf = serializeSaveFilePart({
      fileId: 1n,
      filePart: 0,
      bytes: data,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt64();
    r.readInt32();
    expect(r.readBytes()).toEqual(data);
  });

  it('should handle empty bytes', () => {
    const buf = serializeSaveFilePart({
      fileId: 1n,
      filePart: 0,
      bytes: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt64();
    r.readInt32();
    const bytes = r.readBytes();
    expect(bytes.length).toBe(0);
  });

  it('should handle large file part data', () => {
    const data = Buffer.alloc(524288, 0xFF); // 512KB
    const buf = serializeSaveFilePart({
      fileId: 1n,
      filePart: 0,
      bytes: data,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt64();
    r.readInt32();
    const readData = r.readBytes();
    expect(readData.length).toBe(524288);
    expect(readData[0]).toBe(0xFF);
    expect(readData[524287]).toBe(0xFF);
  });

  it('should handle negative fileId (signed bigint)', () => {
    const fileId = -42n;
    const buf = serializeSaveFilePart({
      fileId,
      filePart: 0,
      bytes: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    expect(r.readInt64()).toBe(fileId);
  });
});

describe('serializeSaveBigFilePart', () => {
  it('should serialize with correct constructor ID', () => {
    const buf = serializeSaveBigFilePart({
      fileId: 1n,
      filePart: 0,
      fileTotalParts: 10,
      bytes: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.upload_saveBigFilePart);
  });

  it('should serialize all fields correctly', () => {
    const data = Buffer.from([0x01, 0x02]);
    const buf = serializeSaveBigFilePart({
      fileId: 99999n,
      filePart: 5,
      fileTotalParts: 20,
      bytes: data,
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.upload_saveBigFilePart);
    expect(r.readInt64()).toBe(99999n);
    expect(r.readInt32()).toBe(5);
    expect(r.readInt32()).toBe(20);
    expect(r.readBytes()).toEqual(data);
  });

  it('should include fileTotalParts that saveFilePart does not have', () => {
    const bigBuf = serializeSaveBigFilePart({
      fileId: 1n,
      filePart: 0,
      fileTotalParts: 100,
      bytes: Buffer.alloc(4),
    });

    const smallBuf = serializeSaveFilePart({
      fileId: 1n,
      filePart: 0,
      bytes: Buffer.alloc(4),
    });

    // Big file part should be larger due to extra int32 for fileTotalParts
    expect(bigBuf.length).toBe(smallBuf.length + 4);
  });
});

describe('serializeGetFile', () => {
  it('should serialize with correct constructor ID', () => {
    const location = Buffer.alloc(16, 0x42);
    const buf = serializeGetFile({
      location,
      offset: 0n,
      limit: 1048576,
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.upload_getFile);
  });

  it('should include flags field set to 0', () => {
    const location = Buffer.alloc(16, 0x42);
    const buf = serializeGetFile({
      location,
      offset: 0n,
      limit: 1048576,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    expect(r.readInt32()).toBe(0); // flags
  });

  it('should include location as raw bytes', () => {
    const location = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const buf = serializeGetFile({
      location,
      offset: 0n,
      limit: 4096,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt32(); // flags
    const readLocation = r.readRaw(location.length);
    expect(readLocation).toEqual(location);
  });

  it('should serialize offset as int64', () => {
    const location = Buffer.alloc(8);
    const buf = serializeGetFile({
      location,
      offset: 1048576n,
      limit: 4096,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt32(); // flags
    r.readRaw(8); // location
    expect(r.readInt64()).toBe(1048576n);
  });

  it('should serialize limit as int32', () => {
    const location = Buffer.alloc(8);
    const buf = serializeGetFile({
      location,
      offset: 0n,
      limit: 524288,
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt32(); // flags
    r.readRaw(8); // location
    r.readInt64(); // offset
    expect(r.readInt32()).toBe(524288);
  });
});

describe('parseGetFileResponse', () => {
  it('should parse upload.file response', () => {
    const { TLWriter: W } = require('@kerainmtp/binary');
    const w = new W(128);
    w.writeConstructorId(FILE_CID.upload_file);
    w.writeConstructorId(FILE_CID.storage_fileUnknown); // type
    w.writeInt32(1700000000); // mtime
    w.writeBytes(Buffer.from([0xAA, 0xBB, 0xCC])); // bytes

    const result = parseGetFileResponse(w.toBuffer());
    expect('cdnRedirect' in result).toBe(false);

    const fileResult = result as { type: number; mtime: number; bytes: Buffer };
    expect(fileResult.type).toBe(FILE_CID.storage_fileUnknown);
    expect(fileResult.mtime).toBe(1700000000);
    expect(fileResult.bytes).toEqual(Buffer.from([0xAA, 0xBB, 0xCC]));
  });

  it('should parse upload.fileCdnRedirect response', () => {
    const { TLWriter: W } = require('@kerainmtp/binary');
    const w = new W(256);
    w.writeConstructorId(FILE_CID.upload_fileCdnRedirect);
    w.writeInt32(3); // dc_id
    w.writeBytes(Buffer.from([0x01, 0x02])); // file_token
    w.writeBytes(Buffer.alloc(32, 0xAA)); // encryption_key
    w.writeBytes(Buffer.alloc(16, 0xBB)); // encryption_iv

    const result = parseGetFileResponse(w.toBuffer());
    expect('cdnRedirect' in result).toBe(true);

    const cdnResult = result as {
      cdnRedirect: true;
      dcId: number;
      fileToken: Buffer;
      encryptionKey: Buffer;
      encryptionIv: Buffer;
    };
    expect(cdnResult.dcId).toBe(3);
    expect(cdnResult.fileToken).toEqual(Buffer.from([0x01, 0x02]));
    expect(cdnResult.encryptionKey.length).toBe(32);
    expect(cdnResult.encryptionIv.length).toBe(16);
  });

  it('should throw on unknown constructor ID', () => {
    const { TLWriter: W } = require('@kerainmtp/binary');
    const w = new W(16);
    w.writeConstructorId(0xDEADBEEF);

    expect(() => parseGetFileResponse(w.toBuffer())).toThrow(
      'Unexpected upload.File constructor',
    );
  });

  it('should handle empty file bytes in upload.file', () => {
    const { TLWriter: W } = require('@kerainmtp/binary');
    const w = new W(64);
    w.writeConstructorId(FILE_CID.upload_file);
    w.writeConstructorId(FILE_CID.storage_fileUnknown);
    w.writeInt32(0);
    w.writeBytes(Buffer.alloc(0));

    const result = parseGetFileResponse(w.toBuffer());
    expect('cdnRedirect' in result).toBe(false);
    const fileResult = result as { type: number; mtime: number; bytes: Buffer };
    expect(fileResult.bytes.length).toBe(0);
  });
});

describe('splitFile', () => {
  it('should split file into correct number of parts', () => {
    const data = Buffer.alloc(10240); // 10KB
    const parts = splitFile(data, 4096);
    expect(parts.length).toBe(3); // 4096 + 4096 + 2048
  });

  it('should have last part smaller than partSize when not evenly divisible', () => {
    const data = Buffer.alloc(5000);
    const parts = splitFile(data, 4096);
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBe(4096);
    expect(parts[1]!.length).toBe(904);
  });

  it('should return single part for data smaller than partSize', () => {
    const data = Buffer.alloc(100);
    const parts = splitFile(data, 1024);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBe(100);
  });

  it('should return single part for data exactly partSize', () => {
    const data = Buffer.alloc(1024);
    const parts = splitFile(data, 1024);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBe(1024);
  });

  it('should handle empty data', () => {
    const data = Buffer.alloc(0);
    const parts = splitFile(data, 1024);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBe(0);
  });

  it('should preserve data integrity across splits', () => {
    const data = Buffer.alloc(3072);
    for (let i = 0; i < data.length; i++) {
      data[i] = i & 0xFF;
    }

    const parts = splitFile(data, 1024);
    const reassembled = Buffer.concat(parts);
    expect(reassembled).toEqual(data);
  });

  it('should throw if partSize is not divisible by 1024', () => {
    expect(() => splitFile(Buffer.alloc(100), 2000)).toThrow('divisible by 1024');
  });

  it('should throw if partSize is less than 1024', () => {
    expect(() => splitFile(Buffer.alloc(100), 512)).toThrow('between 1024 and 524288');
  });

  it('should throw if partSize exceeds 524288', () => {
    expect(() => splitFile(Buffer.alloc(100), 1048576)).toThrow('between 1024 and 524288');
  });

  it('should use computePartSize when no partSize is given', () => {
    const data = Buffer.alloc(2048);
    const parts = splitFile(data);
    // computePartSize(2048) returns 1024 (minimum)
    expect(parts.length).toBe(2);
    expect(parts[0]!.length).toBe(1024);
    expect(parts[1]!.length).toBe(1024);
  });
});

describe('computePartSize', () => {
  it('should return 1024 for very small files', () => {
    expect(computePartSize(100)).toBe(1024);
    expect(computePartSize(1024)).toBe(1024);
  });

  it('should return 1024 for zero-length files', () => {
    expect(computePartSize(0)).toBe(1024);
  });

  it('should return 1024 for negative sizes', () => {
    expect(computePartSize(-1)).toBe(1024);
  });

  it('should return a value that keeps parts under 3000', () => {
    const fileSize = 100 * 1024 * 1024; // 100MB
    const partSize = computePartSize(fileSize);
    const parts = Math.ceil(fileSize / partSize);
    expect(parts).toBeLessThanOrEqual(3000);
  });

  it('should return a value divisible by 1024', () => {
    for (const size of [1000, 50000, 1_000_000, 100_000_000, 1_500_000_000]) {
      const partSize = computePartSize(size);
      expect(partSize % 1024).toBe(0);
    }
  });

  it('should not exceed 524288', () => {
    const partSize = computePartSize(Number.MAX_SAFE_INTEGER);
    expect(partSize).toBeLessThanOrEqual(524288);
  });

  it('should increase part size as file size grows', () => {
    const small = computePartSize(1024); // 1KB
    const large = computePartSize(500 * 1024 * 1024); // 500MB
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it('should return 1024 for files up to ~3MB', () => {
    // 3000 parts * 1024 bytes = 3072000 bytes ~ 3MB
    expect(computePartSize(3072000)).toBe(1024);
  });

  it('should scale up for files that would need > 3000 parts at 1024', () => {
    // 3072001 bytes would need 3001 parts at 1024 -> should bump to 2048
    expect(computePartSize(3072001)).toBe(2048);
  });
});

describe('serializeInputFileLocation', () => {
  it('should serialize photo file location', () => {
    const buf = serializeInputFileLocation({
      type: 'photo',
      id: 12345n,
      accessHash: 67890n,
      fileReference: Buffer.from([0x01, 0x02, 0x03]),
      thumbSize: 'x',
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.inputPhotoFileLocation);
    expect(r.readInt64()).toBe(12345n);
    expect(r.readInt64()).toBe(67890n);
    expect(r.readBytes()).toEqual(Buffer.from([0x01, 0x02, 0x03]));
    expect(r.readString()).toBe('x');
  });

  it('should serialize document file location', () => {
    const buf = serializeInputFileLocation({
      type: 'document',
      id: 11111n,
      accessHash: 22222n,
      fileReference: Buffer.from([0xFF]),
      thumbSize: 'w',
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.inputDocumentFileLocation);
    expect(r.readInt64()).toBe(11111n);
    expect(r.readInt64()).toBe(22222n);
    expect(r.readBytes()).toEqual(Buffer.from([0xFF]));
    expect(r.readString()).toBe('w');
  });

  it('should use empty string for thumbSize when not provided', () => {
    const buf = serializeInputFileLocation({
      type: 'photo',
      id: 1n,
      accessHash: 2n,
      fileReference: Buffer.alloc(0),
    });

    const r = new TLReader(buf);
    r.readConstructorId();
    r.readInt64();
    r.readInt64();
    r.readBytes();
    expect(r.readString()).toBe('');
  });

  it('should serialize peer_photo file location', () => {
    const buf = serializeInputFileLocation({
      type: 'peer_photo',
      id: 333n,
      accessHash: 444n,
      fileReference: Buffer.from([0xAB]),
    });

    const r = new TLReader(buf);
    expect(r.readConstructorId()).toBe(FILE_CID.inputPeerPhotoFileLocation);
    expect(r.readInt32()).toBe(0); // flags
    expect(r.readInt64()).toBe(333n); // photo_id
    expect(r.readInt64()).toBe(444n); // accessHash
    expect(r.readBytes()).toEqual(Buffer.from([0xAB]));
  });

  it('should throw for unknown type', () => {
    expect(() =>
      serializeInputFileLocation({
        type: 'invalid' as 'photo',
        id: 1n,
        accessHash: 2n,
        fileReference: Buffer.alloc(0),
      }),
    ).toThrow('Unknown file location type');
  });
});

describe('generateFileId', () => {
  it('should return a bigint', () => {
    const id = generateFileId();
    expect(typeof id).toBe('bigint');
  });

  it('should generate different IDs on subsequent calls', () => {
    const ids = new Set<bigint>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateFileId());
    }
    // All 100 should be unique (extremely high probability)
    expect(ids.size).toBe(100);
  });
});
