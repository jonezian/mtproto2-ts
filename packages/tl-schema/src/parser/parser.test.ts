/**
 * Tests for the TL schema parser.
 */

import { describe, it, expect } from 'vitest';
import { parseTLSchema } from './parser.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { crc32 } from '../generator/crc32.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, '../schema');

describe('TL Parser', () => {
  describe('basic constructor parsing', () => {
    it('should parse a simple constructor', () => {
      const schema = parseTLSchema('error#c4b9f9bb code:int text:string = Error;');
      expect(schema.constructors).toHaveLength(1);
      expect(schema.constructors[0].name).toBe('error');
      expect(schema.constructors[0].id).toBe(0xc4b9f9bb);
      expect(schema.constructors[0].type).toBe('Error');
      expect(schema.constructors[0].isFunction).toBe(false);
      expect(schema.constructors[0].namespace).toBeNull();
      expect(schema.constructors[0].localName).toBe('error');
      expect(schema.constructors[0].params).toHaveLength(2);
      expect(schema.constructors[0].params[0]).toMatchObject({
        name: 'code',
        type: 'int',
        isFlag: false,
        isVector: false,
        isTrueFlag: false,
      });
      expect(schema.constructors[0].params[1]).toMatchObject({
        name: 'text',
        type: 'string',
        isFlag: false,
        isVector: false,
        isTrueFlag: false,
      });
    });

    it('should parse a constructor with no parameters', () => {
      const schema = parseTLSchema('boolTrue#997275b5 = Bool;');
      expect(schema.constructors).toHaveLength(1);
      expect(schema.constructors[0].name).toBe('boolTrue');
      expect(schema.constructors[0].id).toBe(0x997275b5);
      expect(schema.constructors[0].type).toBe('Bool');
      expect(schema.constructors[0].params).toHaveLength(0);
    });

    it('should parse a constructor with long id', () => {
      const schema = parseTLSchema('peerUser#59511722 user_id:long = Peer;');
      expect(schema.constructors[0].id).toBe(0x59511722);
      expect(schema.constructors[0].params[0]).toMatchObject({
        name: 'user_id',
        type: 'long',
      });
    });
  });

  describe('namespaced constructors', () => {
    it('should parse namespaced constructors', () => {
      const schema = parseTLSchema(
        'storage.fileJpeg#7efe0e = storage.FileType;'
      );
      expect(schema.constructors).toHaveLength(1);
      expect(schema.constructors[0].name).toBe('storage.fileJpeg');
      expect(schema.constructors[0].namespace).toBe('storage');
      expect(schema.constructors[0].localName).toBe('fileJpeg');
      expect(schema.constructors[0].type).toBe('storage.FileType');
    });
  });

  describe('flag fields', () => {
    it('should parse flags field', () => {
      const schema = parseTLSchema(
        'inputGeoPoint#48222faf flags:# lat:double long:double accuracy_radius:flags.0?int = InputGeoPoint;'
      );
      expect(schema.constructors).toHaveLength(1);
      const params = schema.constructors[0].params;
      expect(params).toHaveLength(4);

      // flags param
      expect(params[0]).toMatchObject({
        name: 'flags',
        type: '#',
        isFlag: false,
      });

      // lat (not a flag)
      expect(params[1]).toMatchObject({
        name: 'lat',
        type: 'double',
        isFlag: false,
      });

      // accuracy_radius (conditional)
      expect(params[3]).toMatchObject({
        name: 'accuracy_radius',
        type: 'int',
        isFlag: true,
        flagField: 'flags',
        flagIndex: 0,
        isTrueFlag: false,
      });
    });

    it('should parse true flags', () => {
      const schema = parseTLSchema(
        'userStatusRecently#7b197dc8 flags:# by_me:flags.0?true = UserStatus;'
      );
      const params = schema.constructors[0].params;
      expect(params[1]).toMatchObject({
        name: 'by_me',
        type: 'true',
        isFlag: true,
        flagField: 'flags',
        flagIndex: 0,
        isTrueFlag: true,
      });
    });

    it('should parse multiple flag fields (flags and flags2)', () => {
      const schema = parseTLSchema(
        'user#20b1422 flags:# self:flags.10?true flags2:# bot_can_edit:flags2.1?true id:long = User;'
      );
      const params = schema.constructors[0].params;
      const selfParam = params.find(p => p.name === 'self');
      const botCanEditParam = params.find(p => p.name === 'bot_can_edit');

      expect(selfParam).toMatchObject({
        isFlag: true,
        flagField: 'flags',
        flagIndex: 10,
        isTrueFlag: true,
      });
      expect(botCanEditParam).toMatchObject({
        isFlag: true,
        flagField: 'flags2',
        flagIndex: 1,
        isTrueFlag: true,
      });
    });
  });

  describe('vector types', () => {
    it('should parse HTML-escaped vector (VectorType>)', () => {
      const schema = parseTLSchema(
        'messages.chats#64ff9fd5 chats:VectorChat> = messages.Chats;'
      );
      const params = schema.constructors[0].params;
      expect(params[0]).toMatchObject({
        name: 'chats',
        isVector: true,
        innerType: 'Chat',
      });
    });

    it('should parse Vector<Type> with angle brackets', () => {
      const schema = parseTLSchema(
        'test#12345678 items:Vector<int> = Test;'
      );
      const params = schema.constructors[0].params;
      expect(params[0]).toMatchObject({
        name: 'items',
        isVector: true,
        innerType: 'int',
      });
    });

    it('should parse conditional vector', () => {
      const schema = parseTLSchema(
        'inputMediaUploadedPhoto#1e287d04 flags:# spoiler:flags.2?true file:InputFile stickers:flags.0?VectorInputDocument> ttl_seconds:flags.1?int = InputMedia;'
      );
      const stickers = schema.constructors[0].params.find(
        (p) => p.name === 'stickers'
      );
      expect(stickers).toMatchObject({
        isFlag: true,
        flagField: 'flags',
        flagIndex: 0,
        isVector: true,
        innerType: 'InputDocument',
      });
    });
  });

  describe('functions section', () => {
    it('should separate constructors and functions', () => {
      const schema = parseTLSchema(`
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
      `);
      expect(schema.constructors).toHaveLength(2);
      expect(schema.functions).toHaveLength(1);
      expect(schema.functions[0].isFunction).toBe(true);
      expect(schema.functions[0].name).toBe('auth.sendCode');
    });
  });

  describe('generic types', () => {
    it('should handle {X:Type} in function definitions', () => {
      const schema = parseTLSchema(
        'invokeAfterMsg#cb9f372d {X:Type} msg_id:long query:!X = X;'
      );
      // The {X:Type} is stripped, and query:!X is a parameter
      expect(schema.constructors).toHaveLength(1);
      expect(schema.constructors[0].name).toBe('invokeAfterMsg');
      const queryParam = schema.constructors[0].params.find(
        (p) => p.name === 'query'
      );
      expect(queryParam).toBeDefined();
      expect(queryParam!.type).toBe('!X');
    });
  });

  describe('comments and empty lines', () => {
    it('should skip comments and empty lines', () => {
      const schema = parseTLSchema(`
// This is a comment
boolFalse#bc799737 = Bool;

// Another comment
boolTrue#997275b5 = Bool;
      `);
      expect(schema.constructors).toHaveLength(2);
    });

    it('should extract layer number from comments', () => {
      const schema = parseTLSchema(`
boolFalse#bc799737 = Bool;
// LAYER 195
      `);
      expect(schema.layer).toBe(195);
    });
  });

  describe('full schema parsing', () => {
    it('should parse the FULL api.tl without errors', () => {
      const content = readFileSync(
        resolve(SCHEMA_DIR, 'api.tl'),
        'utf-8'
      );
      const schema = parseTLSchema(content);

      // Should have a substantial number of constructors and functions
      expect(schema.constructors.length).toBeGreaterThan(1400);
      expect(schema.functions.length).toBeGreaterThan(700);

      // Every constructor should have a name and valid ID
      for (const ctor of schema.constructors) {
        expect(ctor.name).toBeTruthy();
        expect(ctor.id).toBeGreaterThan(0);
        expect(ctor.type).toBeTruthy();
        expect(ctor.isFunction).toBe(false);
      }

      // Every function should have a name and valid ID
      for (const fn of schema.functions) {
        expect(fn.name).toBeTruthy();
        expect(fn.id).toBeGreaterThan(0);
        expect(fn.type).toBeTruthy();
        expect(fn.isFunction).toBe(true);
      }

      console.log(
        `api.tl: ${schema.constructors.length} constructors, ${schema.functions.length} functions`
      );
    });

    it('should parse the FULL mtproto.tl without errors', () => {
      const content = readFileSync(
        resolve(SCHEMA_DIR, 'mtproto.tl'),
        'utf-8'
      );
      const schema = parseTLSchema(content);

      expect(schema.constructors.length).toBeGreaterThan(30);
      expect(schema.functions.length).toBeGreaterThan(5);

      for (const ctor of schema.constructors) {
        expect(ctor.name).toBeTruthy();
        expect(ctor.id).toBeGreaterThan(0);
        expect(ctor.type).toBeTruthy();
      }

      console.log(
        `mtproto.tl: ${schema.constructors.length} constructors, ${schema.functions.length} functions`
      );
    });
  });

  describe('CRC32', () => {
    it('should compute correct CRC32 for known constructor IDs', () => {
      // boolFalse = Bool => crc32("boolFalse = Bool") should be 0xbc799737
      expect(crc32('boolFalse = Bool')).toBe(0xbc799737);

      // boolTrue = Bool => crc32("boolTrue = Bool") should be 0x997275b5
      expect(crc32('boolTrue = Bool')).toBe(0x997275b5);

      // vector {t:Type} # [ t ] = Vector t => crc32("vector t:Type # [ t ] = Vector t")
      // The vector constructor is 0x1cb5c415
      expect(crc32('vector t:Type # [ t ] = Vector t')).toBe(0x1cb5c415);
    });
  });
});
