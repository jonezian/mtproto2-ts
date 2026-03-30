const BOOL_TRUE = 0x997275b5;
const BOOL_FALSE = 0xbc799737;
const VECTOR_CID = 0x1cb5c415;

const DEFAULT_CAPACITY = 256;

export class TLWriter {
  private buf: Buffer;
  private offset: number;

  constructor(initialCapacity: number = DEFAULT_CAPACITY) {
    this.buf = Buffer.alloc(initialCapacity);
    this.offset = 0;
  }

  get length(): number {
    return this.offset;
  }

  private ensureCapacity(additional: number): void {
    const required = this.offset + additional;
    if (required <= this.buf.length) return;

    let newSize = this.buf.length;
    while (newSize < required) {
      newSize *= 2;
    }
    const newBuf = Buffer.alloc(newSize);
    this.buf.copy(newBuf, 0, 0, this.offset);
    this.buf = newBuf;
  }

  writeInt32(value: number): void {
    this.ensureCapacity(4);
    this.buf.writeInt32LE(value, this.offset);
    this.offset += 4;
  }

  writeUInt32(value: number): void {
    this.ensureCapacity(4);
    this.buf.writeUInt32LE(value, this.offset);
    this.offset += 4;
  }

  writeInt64(value: bigint): void {
    this.ensureCapacity(8);
    this.buf.writeBigInt64LE(value, this.offset);
    this.offset += 8;
  }

  writeDouble(value: number): void {
    this.ensureCapacity(8);
    this.buf.writeDoubleLE(value, this.offset);
    this.offset += 8;
  }

  writeInt128(value: Buffer): void {
    if (value.length !== 16) {
      throw new Error(`int128 must be exactly 16 bytes, got ${value.length}`);
    }
    this.ensureCapacity(16);
    value.copy(this.buf, this.offset);
    this.offset += 16;
  }

  writeInt256(value: Buffer): void {
    if (value.length !== 32) {
      throw new Error(`int256 must be exactly 32 bytes, got ${value.length}`);
    }
    this.ensureCapacity(32);
    value.copy(this.buf, this.offset);
    this.offset += 32;
  }

  writeBytes(data: Buffer): void {
    const length = data.length;
    let headerSize: number;

    if (length < 254) {
      headerSize = 1;
      const totalBeforePad = headerSize + length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const totalBytes = totalBeforePad + padding;

      this.ensureCapacity(totalBytes);
      this.buf[this.offset] = length;
      this.offset += 1;
    } else {
      headerSize = 4;
      const totalBeforePad = headerSize + length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const totalBytes = totalBeforePad + padding;

      this.ensureCapacity(totalBytes);
      this.buf[this.offset] = 0xfe;
      this.buf[this.offset + 1] = length & 0xff;
      this.buf[this.offset + 2] = (length >> 8) & 0xff;
      this.buf[this.offset + 3] = (length >> 16) & 0xff;
      this.offset += 4;
    }

    data.copy(this.buf, this.offset);
    this.offset += length;

    const totalBeforePad = headerSize + length;
    const padding = (4 - (totalBeforePad % 4)) % 4;
    // Write zero-padding
    for (let i = 0; i < padding; i++) {
      this.buf[this.offset] = 0;
      this.offset += 1;
    }
  }

  writeString(str: string): void {
    this.writeBytes(Buffer.from(str, 'utf-8'));
  }

  writeBool(value: boolean): void {
    this.writeUInt32(value ? BOOL_TRUE : BOOL_FALSE);
  }

  writeVector<T>(items: T[], writeItem: (item: T) => void): void {
    this.writeUInt32(VECTOR_CID);
    this.writeInt32(items.length);
    for (const item of items) {
      writeItem(item);
    }
  }

  writeRaw(data: Buffer): void {
    this.ensureCapacity(data.length);
    data.copy(this.buf, this.offset);
    this.offset += data.length;
  }

  writeConstructorId(id: number): void {
    this.writeUInt32(id);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.offset));
  }
}
