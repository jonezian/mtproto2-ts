import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationManager } from './migration.js';
import type { SessionData } from '@mtproto2/client';
import type { TelegramClient } from '@mtproto2/client';

function makeSessionData(overrides?: Partial<SessionData>): SessionData {
  return {
    dcId: 2,
    authKey: Buffer.alloc(256, 0xab),
    port: 443,
    serverAddress: '149.154.167.51',
    ...overrides,
  };
}

function createMockClient(overrides?: Partial<TelegramClient>): TelegramClient {
  return {
    apiId: 12345,
    apiHash: 'abc123',
    isConnected: vi.fn(() => true),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    invoke: vi.fn(async () => Buffer.alloc(0)),
    on: vi.fn(() => ({})),
    off: vi.fn(() => ({})),
    once: vi.fn(() => ({})),
    emit: vi.fn(() => true),
    getMe: vi.fn(async () => Buffer.alloc(0)),
    ...overrides,
  } as unknown as TelegramClient;
}

/**
 * Build a valid Telethon StringSession base64 string.
 */
function buildTelethonSession(opts?: {
  version?: number;
  dcId?: number;
  port?: number;
  authKey?: Buffer;
  serverAddress?: string;
}): string {
  const version = opts?.version ?? 1;
  const dcId = opts?.dcId ?? 2;
  const port = opts?.port ?? 443;
  const authKey = opts?.authKey ?? Buffer.alloc(256, 0xab);
  const serverAddress = opts?.serverAddress ?? '149.154.167.51';
  const addrBuf = Buffer.from(serverAddress, 'utf-8');

  const buf = Buffer.alloc(261 + addrBuf.length);
  buf[0] = version;
  buf.writeUInt16BE(dcId, 1);
  buf.writeUInt16BE(port, 3);
  authKey.copy(buf, 5, 0, 256);
  addrBuf.copy(buf, 261);

  return buf.toString('base64');
}

describe('MigrationManager', () => {
  let manager: MigrationManager;

  beforeEach(() => {
    manager = new MigrationManager();
  });

  describe('validateSession', () => {
    it('should accept a valid session', () => {
      const result = manager.validateSession(makeSessionData());
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject auth_key that is too short', () => {
      const result = manager.validateSession(
        makeSessionData({ authKey: Buffer.alloc(128) }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('128');
    });

    it('should reject auth_key that is too long', () => {
      const result = manager.validateSession(
        makeSessionData({ authKey: Buffer.alloc(512) }),
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('512');
    });

    it('should reject empty auth_key', () => {
      const result = manager.validateSession(
        makeSessionData({ authKey: Buffer.alloc(0) }),
      );
      expect(result.valid).toBe(false);
    });

    it('should accept dc_id 1 through 5', () => {
      for (let dc = 1; dc <= 5; dc++) {
        const result = manager.validateSession(makeSessionData({ dcId: dc }));
        expect(result.valid).toBe(true);
      }
    });

    it('should reject dc_id 0', () => {
      const result = manager.validateSession(makeSessionData({ dcId: 0 }));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('dc_id');
    });

    it('should reject dc_id 6', () => {
      const result = manager.validateSession(makeSessionData({ dcId: 6 }));
      expect(result.valid).toBe(false);
    });

    it('should reject negative dc_id', () => {
      const result = manager.validateSession(makeSessionData({ dcId: -1 }));
      expect(result.valid).toBe(false);
    });

    it('should report multiple errors at once', () => {
      const result = manager.validateSession({
        dcId: 0,
        authKey: Buffer.alloc(10),
        port: 443,
        serverAddress: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(2);
    });
  });

  describe('convertTelethonSession', () => {
    it('should convert a valid Telethon session string', () => {
      const b64 = buildTelethonSession();
      const data = manager.convertTelethonSession(b64);
      expect(data.dcId).toBe(2);
      expect(data.port).toBe(443);
      expect(data.authKey.length).toBe(256);
      expect(data.serverAddress).toBe('149.154.167.51');
    });

    it('should preserve exact auth key bytes', () => {
      const authKey = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) authKey[i] = i;

      const b64 = buildTelethonSession({ authKey });
      const data = manager.convertTelethonSession(b64);
      expect(data.authKey).toEqual(authKey);
    });

    it('should handle different DC IDs', () => {
      for (const dcId of [1, 2, 3, 4, 5]) {
        const b64 = buildTelethonSession({ dcId });
        const data = manager.convertTelethonSession(b64);
        expect(data.dcId).toBe(dcId);
      }
    });

    it('should handle different ports', () => {
      const b64 = buildTelethonSession({ port: 8443 });
      const data = manager.convertTelethonSession(b64);
      expect(data.port).toBe(8443);
    });

    it('should handle IPv6 server addresses', () => {
      const addr = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      const b64 = buildTelethonSession({ serverAddress: addr });
      const data = manager.convertTelethonSession(b64);
      expect(data.serverAddress).toBe(addr);
    });

    it('should handle empty server address', () => {
      const b64 = buildTelethonSession({ serverAddress: '' });
      const data = manager.convertTelethonSession(b64);
      expect(data.serverAddress).toBe('');
    });

    it('should throw for too-short string', () => {
      const shortBuf = Buffer.alloc(10).toString('base64');
      expect(() => manager.convertTelethonSession(shortBuf)).toThrow(
        'at least 261 bytes',
      );
    });

    it('should throw for unsupported version', () => {
      const b64 = buildTelethonSession({ version: 99 });
      expect(() => manager.convertTelethonSession(b64)).toThrow(
        'Unsupported Telethon session version',
      );
    });
  });

  describe('exportSessionData / importSessionData', () => {
    it('should round-trip session data through portable format', () => {
      const original = makeSessionData();
      const portable = manager.exportSessionData(original);
      const restored = manager.importSessionData(portable);

      expect(restored.dcId).toBe(original.dcId);
      expect(restored.authKey).toEqual(original.authKey);
      expect(restored.serverAddress).toBe(original.serverAddress);
      expect(restored.port).toBe(original.port);
    });

    it('should encode auth key as hex', () => {
      const authKey = Buffer.alloc(256, 0xab);
      const portable = manager.exportSessionData(makeSessionData({ authKey }));
      expect(portable.authKey).toBe('ab'.repeat(256));
    });

    it('should decode hex auth key back to buffer', () => {
      const portable = {
        dcId: 2,
        authKey: 'cd'.repeat(256),
        serverAddress: '10.0.0.1',
        port: 443,
      };
      const data = manager.importSessionData(portable);
      expect(data.authKey).toEqual(Buffer.alloc(256, 0xcd));
    });
  });

  describe('compareSessions', () => {
    it('should report all fields matching for identical sessions', () => {
      const s1 = makeSessionData();
      const s2 = makeSessionData();
      const diff = manager.compareSessions(s1, s2);

      expect(diff.dcIdMatch).toBe(true);
      expect(diff.authKeyMatch).toBe(true);
      expect(diff.serverAddressMatch).toBe(true);
      expect(diff.portMatch).toBe(true);
      expect(diff.allMatch).toBe(true);
    });

    it('should detect dc_id difference', () => {
      const s1 = makeSessionData({ dcId: 1 });
      const s2 = makeSessionData({ dcId: 2 });
      const diff = manager.compareSessions(s1, s2);

      expect(diff.dcIdMatch).toBe(false);
      expect(diff.allMatch).toBe(false);
    });

    it('should detect auth_key difference', () => {
      const s1 = makeSessionData({ authKey: Buffer.alloc(256, 0xaa) });
      const s2 = makeSessionData({ authKey: Buffer.alloc(256, 0xbb) });
      const diff = manager.compareSessions(s1, s2);

      expect(diff.authKeyMatch).toBe(false);
      expect(diff.allMatch).toBe(false);
    });

    it('should detect server address difference', () => {
      const s1 = makeSessionData({ serverAddress: '10.0.0.1' });
      const s2 = makeSessionData({ serverAddress: '10.0.0.2' });
      const diff = manager.compareSessions(s1, s2);

      expect(diff.serverAddressMatch).toBe(false);
      expect(diff.allMatch).toBe(false);
    });

    it('should detect port difference', () => {
      const s1 = makeSessionData({ port: 443 });
      const s2 = makeSessionData({ port: 8443 });
      const diff = manager.compareSessions(s1, s2);

      expect(diff.portMatch).toBe(false);
      expect(diff.allMatch).toBe(false);
    });

    it('should handle multiple differences', () => {
      const s1 = makeSessionData({ dcId: 1, port: 80 });
      const s2 = makeSessionData({ dcId: 3, port: 443 });
      const diff = manager.compareSessions(s1, s2);

      expect(diff.dcIdMatch).toBe(false);
      expect(diff.portMatch).toBe(false);
      expect(diff.authKeyMatch).toBe(true);
      expect(diff.allMatch).toBe(false);
    });
  });

  describe('runHealthCheck', () => {
    it('should return ok:true when invoke succeeds', async () => {
      const client = createMockClient({
        invoke: vi.fn(async () => Buffer.alloc(32)) as TelegramClient['invoke'],
      });

      const result = await manager.runHealthCheck(client);
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it('should call invoke with help.getConfig constructor ID', async () => {
      const invoke = vi.fn(async (_buf: Buffer) => Buffer.alloc(32));
      const client = createMockClient({ invoke: invoke as unknown as TelegramClient['invoke'] });

      await manager.runHealthCheck(client);

      expect(invoke).toHaveBeenCalledOnce();
      const buf = invoke.mock.calls[0]![0];
      expect(buf.readUInt32LE(0)).toBe(0xc4f9186b);
    });

    it('should return ok:false when invoke throws', async () => {
      const client = createMockClient({
        invoke: vi.fn(async () => {
          throw new Error('Connection refused');
        }) as TelegramClient['invoke'],
      });

      const result = await manager.runHealthCheck(client);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle non-Error throws', async () => {
      const client = createMockClient({
        invoke: vi.fn(async () => {
          throw 'string error';
        }) as TelegramClient['invoke'],
      });

      const result = await manager.runHealthCheck(client);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  describe('verifyShadowMode', () => {
    it('should report match for identical results', () => {
      const py = { chatId: '-100', text: 'hello', count: 42 };
      const kr = { chatId: '-100', text: 'hello', count: 42 };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it('should detect value differences', () => {
      const py = { text: 'hello' };
      const kr = { text: 'world' };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(false);
      expect(result.differences).toHaveLength(1);
      expect(result.differences[0]).toContain('text');
      expect(result.differences[0]).toContain('hello');
      expect(result.differences[0]).toContain('world');
    });

    it('should detect keys only in python result', () => {
      const py = { a: 1, b: 2 };
      const kr = { a: 1 };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.includes('"b"') && d.includes('python'))).toBe(true);
    });

    it('should detect keys only in kerain result', () => {
      const py = { a: 1 };
      const kr = { a: 1, c: 3 };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.includes('"c"') && d.includes('kerain'))).toBe(true);
    });

    it('should handle empty objects', () => {
      const result = manager.verifyShadowMode({}, {});
      expect(result.match).toBe(true);
      expect(result.differences).toEqual([]);
    });

    it('should compare nested objects', () => {
      const py = { data: { inner: [1, 2, 3] } };
      const kr = { data: { inner: [1, 2, 3] } };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(true);
    });

    it('should detect nested object differences', () => {
      const py = { data: { inner: [1, 2, 3] } };
      const kr = { data: { inner: [1, 2, 4] } };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(false);
      expect(result.differences[0]).toContain('data');
    });

    it('should handle multiple differences', () => {
      const py = { a: 1, b: 2, c: 3 };
      const kr = { a: 1, b: 99, c: 99 };

      const result = manager.verifyShadowMode(py, kr);
      expect(result.match).toBe(false);
      expect(result.differences.length).toBe(2);
    });
  });

  describe('exportSession', () => {
    it('should return null when client is not connected', () => {
      const client = createMockClient({
        isConnected: vi.fn(() => false) as TelegramClient['isConnected'],
      });

      const result = manager.exportSession(client);
      expect(result).toBeNull();
    });
  });
});
