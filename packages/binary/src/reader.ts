const BOOL_TRUE = 0x997275b5;
const BOOL_FALSE = 0xbc799737;
const VECTOR_CID = 0x1cb5c415;

export class TLReader {
  private buf: Buffer;
  private offset: number;

  constructor(buffer: Buffer) {
    this.buf = buffer;
    this.offset = 0;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private ensureAvailable(bytes: number): void {
    if (this.offset + bytes > this.buf.length) {
      throw new RangeError(
        `Read past end of buffer: need ${bytes} bytes at offset ${this.offset}, but only ${this.remaining} remain`,
      );
    }
  }

  readInt32(): number {
    this.ensureAvailable(4);
    const value = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readUInt32(): number {
    this.ensureAvailable(4);
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readInt64(): bigint {
    this.ensureAvailable(8);
    const value = this.buf.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readDouble(): number {
    this.ensureAvailable(8);
    const value = this.buf.readDoubleLE(this.offset);
    this.offset += 8;
    return value;
  }

  readInt128(): Buffer {
    this.ensureAvailable(16);
    const value = Buffer.alloc(16);
    this.buf.copy(value, 0, this.offset, this.offset + 16);
    this.offset += 16;
    return value;
  }

  readInt256(): Buffer {
    this.ensureAvailable(32);
    const value = Buffer.alloc(32);
    this.buf.copy(value, 0, this.offset, this.offset + 32);
    this.offset += 32;
    return value;
  }

  readBytes(): Buffer {
    this.ensureAvailable(1);
    let length: number;
    let headerSize: number;

    const firstByte = this.buf[this.offset]!;
    if (firstByte < 254) {
      length = firstByte;
      headerSize = 1;
    } else {
      // 0xFE followed by 3 bytes of length (little-endian)
      this.ensureAvailable(4);
      length =
        this.buf[this.offset + 1]! |
        (this.buf[this.offset + 2]! << 8) |
        (this.buf[this.offset + 3]! << 16);
      headerSize = 4;
    }

    const totalBeforePad = headerSize + length;
    const padding = (4 - (totalBeforePad % 4)) % 4;
    const totalBytes = totalBeforePad + padding;

    this.ensureAvailable(totalBytes);

    const data = Buffer.alloc(length);
    this.buf.copy(data, 0, this.offset + headerSize, this.offset + headerSize + length);
    this.offset += totalBytes;
    return data;
  }

  readString(): string {
    return this.readBytes().toString('utf-8');
  }

  readBool(): boolean {
    const id = this.readUInt32();
    if (id === BOOL_TRUE) return true;
    if (id === BOOL_FALSE) return false;
    throw new Error(`Invalid Bool constructor ID: 0x${id.toString(16).padStart(8, '0')}`);
  }

  readVector<T>(readItem: () => T): T[] {
    const cid = this.readUInt32();
    if (cid !== VECTOR_CID) {
      throw new Error(
        `Invalid Vector constructor ID: 0x${cid.toString(16).padStart(8, '0')}, expected 0x${VECTOR_CID.toString(16).padStart(8, '0')}`,
      );
    }
    const count = this.readInt32();
    const items: T[] = [];
    for (let i = 0; i < count; i++) {
      items.push(readItem());
    }
    return items;
  }

  readRaw(length: number): Buffer {
    this.ensureAvailable(length);
    const data = Buffer.alloc(length);
    this.buf.copy(data, 0, this.offset, this.offset + length);
    this.offset += length;
    return data;
  }

  readConstructorId(): number {
    return this.readUInt32();
  }

  peekInt32(): number {
    this.ensureAvailable(4);
    return this.buf.readInt32LE(this.offset);
  }
}
