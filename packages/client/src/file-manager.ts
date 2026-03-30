import { EventEmitter } from 'node:events';
import {
  serializeSaveFilePart,
  serializeSaveBigFilePart,
  serializeGetFile,
  parseGetFileResponse,
  splitFile,
  generateFileId,
} from './files.js';
import type { UploadResult, GetFileResult, CdnRedirectResult } from './files.js';

export interface UploadProgress {
  fileId: bigint;
  uploaded: number;
  total: number;
  speed: number;  // bytes/sec
}

export interface DownloadProgress {
  offset: number;
  total: number;
  speed: number;
}

export interface FileManagerOptions {
  /** Function to invoke an MTProto RPC call */
  invoke: (data: Buffer) => Promise<Buffer>;
  /** Maximum concurrent uploads (default: 3) */
  maxConcurrentUploads?: number;
  /** Maximum concurrent downloads (default: 3) */
  maxConcurrentDownloads?: number;
  /** Default part size for uploads (default: 524288 = 512KB) */
  defaultPartSize?: number;
  /** Default limit for downloads (default: 1048576 = 1MB) */
  defaultDownloadLimit?: number;
}

/** Threshold for using saveBigFilePart (10MB) */
const BIG_FILE_THRESHOLD = 10 * 1024 * 1024;

/**
 * High-level file upload/download manager for MTProto.
 *
 * Emits:
 * - 'upload-progress': UploadProgress
 * - 'download-progress': DownloadProgress
 */
export class FileManager extends EventEmitter {
  private readonly invoke: (data: Buffer) => Promise<Buffer>;
  private readonly maxConcurrentUploads: number;
  private readonly maxConcurrentDownloads: number;
  private readonly defaultPartSize: number;
  private readonly defaultDownloadLimit: number;

  constructor(options: FileManagerOptions) {
    super();
    this.invoke = options.invoke;
    this.maxConcurrentUploads = options.maxConcurrentUploads ?? 3;
    this.maxConcurrentDownloads = options.maxConcurrentDownloads ?? 3;
    this.defaultPartSize = options.defaultPartSize ?? 524288;
    this.defaultDownloadLimit = options.defaultDownloadLimit ?? 1048576;
  }

  /**
   * Upload a file, returns UploadResult for use in API calls.
   *
   * For files < 10MB, uses upload.saveFilePart (simpler protocol).
   * For files >= 10MB, uses upload.saveBigFilePart (requires total_parts).
   * Parts are uploaded concurrently up to `workers` (or maxConcurrentUploads).
   */
  async upload(
    data: Buffer,
    fileName: string,
    options?: { partSize?: number; workers?: number },
  ): Promise<UploadResult> {
    const partSize = options?.partSize ?? this.defaultPartSize;
    const workers = options?.workers ?? this.maxConcurrentUploads;
    const fileId = generateFileId();
    const isBigFile = data.length >= BIG_FILE_THRESHOLD;
    const parts = splitFile(data, partSize);
    const totalParts = parts.length;
    const startTime = Date.now();
    let uploadedBytes = 0;

    // Upload parts with concurrency control
    let nextPart = 0;

    const uploadWorker = async (): Promise<void> => {
      while (nextPart < totalParts) {
        const partIndex = nextPart++;
        const partData = parts[partIndex]!;

        let request: Buffer;
        if (isBigFile) {
          request = serializeSaveBigFilePart({
            fileId,
            filePart: partIndex,
            fileTotalParts: totalParts,
            bytes: partData,
          });
        } else {
          request = serializeSaveFilePart({
            fileId,
            filePart: partIndex,
            bytes: partData,
          });
        }

        await this.invoke(request);

        uploadedBytes += partData.length;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;

        this.emit('upload-progress', {
          fileId,
          uploaded: uploadedBytes,
          total: data.length,
          speed,
        } satisfies UploadProgress);
      }
    };

    // Spawn worker tasks
    const workerCount = Math.min(workers, totalParts);
    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(uploadWorker());
    }
    await Promise.all(workerPromises);

    return {
      fileId,
      parts: totalParts,
      name: fileName,
    };
  }

  /** Maximum concurrent download workers. Reserved for future parallel download support. */
  get downloadConcurrency(): number {
    return this.maxConcurrentDownloads;
  }

  /**
   * Download a file by its serialized InputFileLocation.
   * Returns the complete file data as a Buffer.
   */
  async download(
    location: Buffer,
    options?: {
      offset?: bigint;
      limit?: number;
      fileSize?: number;  // If known, enables progress tracking
    },
  ): Promise<Buffer> {
    const limit = options?.limit ?? this.defaultDownloadLimit;
    let offset = options?.offset ?? 0n;
    const fileSize = options?.fileSize;
    const startTime = Date.now();
    let downloadedBytes = 0;

    const chunks: Buffer[] = [];

    // Download sequentially in chunks
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const request = serializeGetFile({
        location,
        offset,
        limit,
      });

      const response = await this.invoke(request);
      const result = parseGetFileResponse(response);

      if ('cdnRedirect' in result) {
        throw new Error(
          `CDN redirect to DC ${(result as CdnRedirectResult).dcId} — not yet supported`,
        );
      }

      const fileResult = result as GetFileResult;
      chunks.push(fileResult.bytes);
      downloadedBytes += fileResult.bytes.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? downloadedBytes / elapsed : 0;

      this.emit('download-progress', {
        offset: downloadedBytes,
        total: fileSize ?? 0,
        speed,
      } satisfies DownloadProgress);

      // If we got fewer bytes than requested, we've reached the end
      if (fileResult.bytes.length < limit) {
        break;
      }

      offset += BigInt(limit);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Download with streaming: each chunk is passed to the callback
   * instead of being accumulated in memory.
   */
  async downloadStream(
    location: Buffer,
    callback: (chunk: Buffer, offset: number) => void | Promise<void>,
    options?: { offset?: bigint; limit?: number },
  ): Promise<void> {
    const limit = options?.limit ?? this.defaultDownloadLimit;
    let offset = options?.offset ?? 0n;
    let downloadedBytes = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const request = serializeGetFile({
        location,
        offset,
        limit,
      });

      const response = await this.invoke(request);
      const result = parseGetFileResponse(response);

      if ('cdnRedirect' in result) {
        throw new Error(
          `CDN redirect to DC ${(result as CdnRedirectResult).dcId} — not yet supported`,
        );
      }

      const fileResult = result as GetFileResult;

      if (fileResult.bytes.length > 0) {
        await callback(fileResult.bytes, downloadedBytes);
      }

      downloadedBytes += fileResult.bytes.length;

      // If we got fewer bytes than requested, we've reached the end
      if (fileResult.bytes.length < limit) {
        break;
      }

      offset += BigInt(limit);
    }
  }
}
