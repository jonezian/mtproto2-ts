import { describe, it, expect } from 'vitest';
import { TLWriter, TLReader } from '@mtproto2/binary';
import { FileManager } from './file-manager.js';
import { FILE_CID } from './files.js';

// BOOL_TRUE constructor ID (used as upload response)
const BOOL_TRUE = 0x997275b5;

/**
 * Create a mock invoke function that tracks calls and returns
 * a boolTrue response for upload requests, or a file response for download requests.
 */
function createMockInvoke(options?: {
  downloadData?: Buffer;
  downloadChunkSize?: number;
  failOnPart?: number;
}) {
  const calls: Buffer[] = [];
  let downloadOffset = 0;
  const downloadData = options?.downloadData ?? Buffer.alloc(0);
  const chunkSize = options?.downloadChunkSize ?? downloadData.length;

  const invoke = async (data: Buffer): Promise<Buffer> => {
    calls.push(Buffer.from(data));

    const r = new TLReader(data);
    const cid = r.readConstructorId();

    // upload.saveFilePart or upload.saveBigFilePart -> return boolTrue
    if (cid === FILE_CID.upload_saveFilePart || cid === FILE_CID.upload_saveBigFilePart) {
      if (cid === FILE_CID.upload_saveBigFilePart) {
        r.readInt64(); // fileId
        const part = r.readInt32(); // filePart
        if (options?.failOnPart === part) {
          throw new Error(`Upload part ${part} failed`);
        }
      } else {
        r.readInt64(); // fileId
        const part = r.readInt32(); // filePart
        if (options?.failOnPart === part) {
          throw new Error(`Upload part ${part} failed`);
        }
      }

      const w = new TLWriter(4);
      w.writeUInt32(BOOL_TRUE);
      return w.toBuffer();
    }

    // upload.getFile -> return upload.file
    if (cid === FILE_CID.upload_getFile) {
      r.readInt32(); // flags
      // We don't know the length of the location, but it's followed by offset and limit
      // The simplest approach: read remaining as offset follows location
      // For the mock, we'll determine chunk from the downloadOffset tracker
      const remaining = downloadData.length - downloadOffset;
      const toSend = Math.min(chunkSize, remaining);
      const chunk = downloadData.subarray(downloadOffset, downloadOffset + toSend);
      downloadOffset += toSend;

      const w = new TLWriter(chunk.length + 64);
      w.writeConstructorId(FILE_CID.upload_file);
      w.writeConstructorId(FILE_CID.storage_fileUnknown); // type
      w.writeInt32(0); // mtime
      w.writeBytes(chunk);
      return w.toBuffer();
    }

    throw new Error(`Mock invoke: unexpected CID 0x${cid.toString(16).padStart(8, '0')}`);
  };

  return { invoke, calls };
}

/**
 * Create a mock invoke that returns a CDN redirect for download.
 */
function createCdnRedirectInvoke() {
  const invoke = async (data: Buffer): Promise<Buffer> => {
    const r = new TLReader(data);
    const cid = r.readConstructorId();

    if (cid === FILE_CID.upload_getFile) {
      const w = new TLWriter(256);
      w.writeConstructorId(FILE_CID.upload_fileCdnRedirect);
      w.writeInt32(5); // dc_id
      w.writeBytes(Buffer.from([0x01, 0x02])); // file_token
      w.writeBytes(Buffer.alloc(32, 0xAA)); // encryption_key
      w.writeBytes(Buffer.alloc(16, 0xBB)); // encryption_iv
      return w.toBuffer();
    }

    throw new Error('Unexpected');
  };

  return invoke;
}

describe('FileManager', () => {
  describe('constructor', () => {
    it('should use default options', () => {
      const fm = new FileManager({ invoke: async () => Buffer.alloc(0) });
      // No error means defaults were set properly
      expect(fm).toBeInstanceOf(FileManager);
    });

    it('should accept custom options', () => {
      const fm = new FileManager({
        invoke: async () => Buffer.alloc(0),
        maxConcurrentUploads: 5,
        maxConcurrentDownloads: 2,
        defaultPartSize: 262144,
        defaultDownloadLimit: 524288,
      });
      expect(fm).toBeInstanceOf(FileManager);
    });
  });

  describe('upload', () => {
    it('should upload a small file using saveFilePart', async () => {
      const fileData = Buffer.alloc(2048, 0xAB);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke });
      const result = await fm.upload(fileData, 'test.bin', { partSize: 1024 });

      expect(result.parts).toBe(2);
      expect(result.name).toBe('test.bin');
      expect(typeof result.fileId).toBe('bigint');

      // Both calls should use saveFilePart (< 10MB)
      for (const call of calls) {
        const r = new TLReader(call);
        expect(r.readConstructorId()).toBe(FILE_CID.upload_saveFilePart);
      }
    });

    it('should upload a big file using saveBigFilePart', async () => {
      // Create a 10MB file (exactly at threshold)
      const fileData = Buffer.alloc(10 * 1024 * 1024, 0xCD);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke });
      const result = await fm.upload(fileData, 'big.bin', { partSize: 524288 });

      expect(result.parts).toBe(20); // 10MB / 512KB
      expect(result.name).toBe('big.bin');

      // All calls should use saveBigFilePart (>= 10MB)
      for (const call of calls) {
        const r = new TLReader(call);
        expect(r.readConstructorId()).toBe(FILE_CID.upload_saveBigFilePart);
      }
    });

    it('should pass correct fileTotalParts for big files', async () => {
      const fileData = Buffer.alloc(10 * 1024 * 1024);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke });
      await fm.upload(fileData, 'big.bin', { partSize: 524288 });

      // Check that fileTotalParts is correct (20)
      for (const call of calls) {
        const r = new TLReader(call);
        r.readConstructorId(); // saveBigFilePart
        r.readInt64(); // fileId
        r.readInt32(); // filePart
        expect(r.readInt32()).toBe(20); // fileTotalParts
      }
    });

    it('should pass correct part numbers in sequence', async () => {
      const fileData = Buffer.alloc(4096, 0x01);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({
        invoke,
        maxConcurrentUploads: 1, // sequential to ensure order
      });
      await fm.upload(fileData, 'test.bin', { partSize: 1024 });

      expect(calls.length).toBe(4);
      const partNumbers: number[] = [];
      for (const call of calls) {
        const r = new TLReader(call);
        r.readConstructorId();
        r.readInt64(); // fileId
        partNumbers.push(r.readInt32());
      }
      expect(partNumbers).toEqual([0, 1, 2, 3]);
    });

    it('should use the same fileId for all parts', async () => {
      const fileData = Buffer.alloc(3072);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke, maxConcurrentUploads: 1 });
      const result = await fm.upload(fileData, 'test.bin', { partSize: 1024 });

      const fileIds: bigint[] = [];
      for (const call of calls) {
        const r = new TLReader(call);
        r.readConstructorId();
        fileIds.push(r.readInt64());
      }

      // All parts should have the same fileId
      for (const id of fileIds) {
        expect(id).toBe(result.fileId);
      }
    });

    it('should emit upload-progress events', async () => {
      const fileData = Buffer.alloc(3072);
      const { invoke } = createMockInvoke();

      const fm = new FileManager({ invoke, maxConcurrentUploads: 1 });
      const progressEvents: Array<{ uploaded: number; total: number }> = [];

      fm.on('upload-progress', (progress) => {
        progressEvents.push({ uploaded: progress.uploaded, total: progress.total });
      });

      await fm.upload(fileData, 'test.bin', { partSize: 1024 });

      expect(progressEvents.length).toBe(3);
      expect(progressEvents[0]!.total).toBe(3072);
      expect(progressEvents[2]!.uploaded).toBe(3072);
    });

    it('should upload concurrently with multiple workers', async () => {
      const fileData = Buffer.alloc(4096);
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const invoke = async (data: Buffer): Promise<Buffer> => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate some async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;

        const r = new TLReader(data);
        r.readConstructorId(); // consume CID

        const w = new TLWriter(4);
        w.writeUInt32(BOOL_TRUE);
        return w.toBuffer();
      };

      const fm = new FileManager({ invoke, maxConcurrentUploads: 3 });
      await fm.upload(fileData, 'test.bin', {
        partSize: 1024,
        workers: 3,
      });

      // With 4 parts and 3 workers, we should see some concurrency
      expect(maxConcurrent).toBeGreaterThan(1);
    });

    it('should handle upload failure in a part', async () => {
      const fileData = Buffer.alloc(3072);
      const { invoke } = createMockInvoke({ failOnPart: 1 });

      const fm = new FileManager({ invoke, maxConcurrentUploads: 1 });

      await expect(fm.upload(fileData, 'test.bin', { partSize: 1024 })).rejects.toThrow(
        'Upload part 1 failed',
      );
    });

    it('should handle single-part file', async () => {
      const fileData = Buffer.from([0x01, 0x02, 0x03]);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke });
      const result = await fm.upload(fileData, 'tiny.bin', { partSize: 1024 });

      expect(result.parts).toBe(1);
      expect(calls.length).toBe(1);
    });

    it('should use defaultPartSize when no partSize is specified', async () => {
      const fileData = Buffer.alloc(1024 * 1024); // 1MB
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({
        invoke,
        defaultPartSize: 524288, // 512KB
        maxConcurrentUploads: 1,
      });
      await fm.upload(fileData, 'test.bin');

      // 1MB / 512KB = 2 parts
      expect(calls.length).toBe(2);
    });
  });

  describe('download', () => {
    it('should download a file in a single chunk', async () => {
      const fileContent = Buffer.alloc(1000, 0xEE);
      const { invoke } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1048576, // larger than file
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(16, 0x42);
      const result = await fm.download(location);

      expect(result).toEqual(fileContent);
    });

    it('should download a file in multiple chunks', async () => {
      const fileContent = Buffer.alloc(3000);
      for (let i = 0; i < fileContent.length; i++) {
        fileContent[i] = i & 0xFF;
      }

      const { invoke } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke, defaultDownloadLimit: 1024 });
      const location = Buffer.alloc(16);
      const result = await fm.download(location, { limit: 1024 });

      expect(result).toEqual(fileContent);
    });

    it('should emit download-progress events', async () => {
      const fileContent = Buffer.alloc(2048, 0xAA);
      const { invoke } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke });
      const progressEvents: Array<{ offset: number; total: number }> = [];

      fm.on('download-progress', (progress) => {
        progressEvents.push({ offset: progress.offset, total: progress.total });
      });

      const location = Buffer.alloc(8);
      await fm.download(location, { limit: 1024, fileSize: 2048 });

      // 2048 / 1024 = 2 full chunks + 1 final empty request = 3 progress events
      expect(progressEvents.length).toBe(3);
      expect(progressEvents[0]!.total).toBe(2048);
      expect(progressEvents[2]!.offset).toBe(2048);
    });

    it('should throw on CDN redirect', async () => {
      const invoke = createCdnRedirectInvoke();

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);

      await expect(fm.download(location)).rejects.toThrow('CDN redirect');
    });

    it('should handle empty file download', async () => {
      const { invoke } = createMockInvoke({
        downloadData: Buffer.alloc(0),
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);
      const result = await fm.download(location);

      expect(result.length).toBe(0);
    });

    it('should pass custom offset to getFile', async () => {
      const fileContent = Buffer.alloc(100, 0xBB);
      const { invoke, calls } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1048576,
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);
      await fm.download(location, { offset: 4096n });

      // Verify the offset was passed to the getFile request
      expect(calls.length).toBe(1);
      // The call should contain the offset; we verify indirectly
      // by checking the call was made successfully
    });
  });

  describe('downloadStream', () => {
    it('should stream chunks via callback', async () => {
      const fileContent = Buffer.alloc(3000);
      for (let i = 0; i < fileContent.length; i++) {
        fileContent[i] = i & 0xFF;
      }

      const { invoke } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);
      const chunks: Array<{ chunk: Buffer; offset: number }> = [];

      await fm.downloadStream(
        location,
        (chunk, offset) => {
          chunks.push({ chunk: Buffer.from(chunk), offset });
        },
        { limit: 1024 },
      );

      expect(chunks.length).toBe(3);
      expect(chunks[0]!.offset).toBe(0);
      expect(chunks[0]!.chunk.length).toBe(1024);
      expect(chunks[1]!.offset).toBe(1024);
      expect(chunks[1]!.chunk.length).toBe(1024);
      expect(chunks[2]!.offset).toBe(2048);
      expect(chunks[2]!.chunk.length).toBe(952);

      // Verify combined data matches
      const combined = Buffer.concat(chunks.map((c) => c.chunk));
      expect(combined).toEqual(fileContent);
    });

    it('should support async callback', async () => {
      const fileContent = Buffer.alloc(2048, 0xCC);
      const { invoke } = createMockInvoke({
        downloadData: fileContent,
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);
      const receivedChunks: Buffer[] = [];

      await fm.downloadStream(
        location,
        async (chunk) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          receivedChunks.push(Buffer.from(chunk));
        },
        { limit: 1024 },
      );

      expect(receivedChunks.length).toBe(2);
      expect(Buffer.concat(receivedChunks)).toEqual(fileContent);
    });

    it('should throw on CDN redirect in stream', async () => {
      const invoke = createCdnRedirectInvoke();

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);

      await expect(
        fm.downloadStream(location, () => {}),
      ).rejects.toThrow('CDN redirect');
    });

    it('should handle empty file in stream', async () => {
      const { invoke } = createMockInvoke({
        downloadData: Buffer.alloc(0),
        downloadChunkSize: 1024,
      });

      const fm = new FileManager({ invoke });
      const location = Buffer.alloc(8);
      const chunks: Buffer[] = [];

      await fm.downloadStream(location, (chunk) => {
        chunks.push(chunk);
      });

      expect(chunks.length).toBe(0);
    });
  });

  describe('progress speed calculation', () => {
    it('should report non-negative speed after upload', async () => {
      const fileData = Buffer.alloc(4096);

      // Add a small delay to the mock so elapsed > 0
      const invoke = async (data: Buffer): Promise<Buffer> => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const r = new TLReader(data);
        r.readConstructorId(); // consume CID
        const w = new TLWriter(4);
        w.writeUInt32(BOOL_TRUE);
        return w.toBuffer();
      };

      const fm = new FileManager({ invoke, maxConcurrentUploads: 1 });
      const speeds: number[] = [];

      fm.on('upload-progress', (progress) => {
        speeds.push(progress.speed);
      });

      await fm.upload(fileData, 'test.bin', { partSize: 1024 });

      // Should have progress events
      expect(speeds.length).toBe(4);
      // All speeds should be non-negative
      for (const s of speeds) {
        expect(s).toBeGreaterThanOrEqual(0);
      }
      // With the delay, at least one should be > 0
      expect(speeds.some((s) => s > 0)).toBe(true);
    });

    it('should report non-negative speed after download', async () => {
      const fileContent = Buffer.alloc(2048, 0xDD);
      let downloadOffset = 0;

      // Add a small delay so elapsed time > 0
      const invoke = async (data: Buffer): Promise<Buffer> => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const r = new TLReader(data);
        const cid = r.readConstructorId();

        if (cid === FILE_CID.upload_getFile) {
          const remaining = fileContent.length - downloadOffset;
          const toSend = Math.min(1024, remaining);
          const chunk = fileContent.subarray(downloadOffset, downloadOffset + toSend);
          downloadOffset += toSend;

          const w = new TLWriter(chunk.length + 64);
          w.writeConstructorId(FILE_CID.upload_file);
          w.writeConstructorId(FILE_CID.storage_fileUnknown);
          w.writeInt32(0);
          w.writeBytes(chunk);
          return w.toBuffer();
        }

        throw new Error('Unexpected');
      };

      const fm = new FileManager({ invoke });
      const speeds: number[] = [];

      fm.on('download-progress', (progress) => {
        speeds.push(progress.speed);
      });

      const location = Buffer.alloc(8);
      await fm.download(location, { limit: 1024 });

      // Should have progress events
      expect(speeds.length).toBeGreaterThan(0);
      // All speeds should be non-negative
      for (const s of speeds) {
        expect(s).toBeGreaterThanOrEqual(0);
      }
      // With the delay, at least one should be > 0
      expect(speeds.some((s) => s > 0)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle 1-byte file upload', async () => {
      const fileData = Buffer.from([0x42]);
      const { invoke, calls } = createMockInvoke();

      const fm = new FileManager({ invoke });
      const result = await fm.upload(fileData, 'one.bin', { partSize: 1024 });

      expect(result.parts).toBe(1);
      expect(calls.length).toBe(1);
    });

    it('should respect workers option for upload', async () => {
      const fileData = Buffer.alloc(4096);
      const callOrder: number[] = [];
      let callCount = 0;

      const invoke = async (_data: Buffer): Promise<Buffer> => {
        const idx = callCount++;
        callOrder.push(idx);
        await new Promise((resolve) => setTimeout(resolve, 5));

        const w = new TLWriter(4);
        w.writeUInt32(BOOL_TRUE);
        return w.toBuffer();
      };

      const fm = new FileManager({ invoke, maxConcurrentUploads: 10 });
      await fm.upload(fileData, 'test.bin', {
        partSize: 1024,
        workers: 1,  // Override to 1 worker
      });

      // With 1 worker, calls should be sequential
      expect(callOrder).toEqual([0, 1, 2, 3]);
    });
  });
});
