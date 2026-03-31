/**
 * Tests for the TL schema differ.
 */

import { describe, it, expect } from 'vitest';
import { diffSchemaStrings, formatDiffSummary } from './diff-schema.js';

describe('Schema Differ', () => {
  describe('no changes', () => {
    it('should detect no changes when schemas are identical', () => {
      const schema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
      `;
      const diff = diffSchemaStrings(schema, schema);
      expect(diff.hasChanges).toBe(false);
      expect(diff.addedConstructors).toHaveLength(0);
      expect(diff.removedConstructors).toHaveLength(0);
      expect(diff.modifiedConstructors).toHaveLength(0);
      expect(diff.addedMethods).toHaveLength(0);
      expect(diff.removedMethods).toHaveLength(0);
      expect(diff.modifiedMethods).toHaveLength(0);
    });

    it('should detect no changes for empty schemas', () => {
      const diff = diffSchemaStrings('', '');
      expect(diff.hasChanges).toBe(false);
    });
  });

  describe('new constructor detection', () => {
    it('should detect a newly added constructor', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.addedConstructors).toHaveLength(1);
      expect(diff.addedConstructors[0].name).toBe('boolTrue');
      expect(diff.removedConstructors).toHaveLength(0);
      expect(diff.modifiedConstructors).toHaveLength(0);
    });

    it('should detect multiple new constructors', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
error#c4b9f9bb code:int text:string = Error;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.addedConstructors).toHaveLength(2);
      const addedNames = diff.addedConstructors.map((c) => c.name);
      expect(addedNames).toContain('boolTrue');
      expect(addedNames).toContain('error');
    });
  });

  describe('removed constructor detection', () => {
    it('should detect a removed constructor', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.removedConstructors).toHaveLength(1);
      expect(diff.removedConstructors[0].name).toBe('boolTrue');
      expect(diff.addedConstructors).toHaveLength(0);
    });

    it('should detect multiple removed constructors', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.removedConstructors).toHaveLength(2);
    });
  });

  describe('modified constructor detection', () => {
    it('should detect a modified constructor (new param added)', () => {
      const oldSchema = `
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
error#aabbccdd code:int text:string details:string = Error;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedConstructors).toHaveLength(1);
      expect(diff.modifiedConstructors[0].name).toBe('error');
      expect(diff.modifiedConstructors[0].old.params).toHaveLength(2);
      expect(diff.modifiedConstructors[0].new.params).toHaveLength(3);
    });

    it('should detect a modified constructor (param type changed)', () => {
      const oldSchema = `
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
error#aabbccdd code:long text:string = Error;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedConstructors).toHaveLength(1);
      expect(diff.modifiedConstructors[0].name).toBe('error');
    });

    it('should detect a modified constructor (result type changed)', () => {
      const oldSchema = `
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
error#aabbccdd code:int text:string = RichError;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedConstructors).toHaveLength(1);
    });

    it('should detect a modified constructor (ID changed only)', () => {
      const oldSchema = `
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
error#deadbeef code:int text:string = Error;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedConstructors).toHaveLength(1);
    });
  });

  describe('method/function changes', () => {
    it('should detect added methods', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
auth.logOut#3e72ba19 = auth.LoggedOut;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.addedMethods).toHaveLength(1);
      expect(diff.addedMethods[0].name).toBe('auth.logOut');
      expect(diff.addedMethods[0].isFunction).toBe(true);
    });

    it('should detect removed methods', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
auth.logOut#3e72ba19 = auth.LoggedOut;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.removedMethods).toHaveLength(1);
      expect(diff.removedMethods[0].name).toBe('auth.logOut');
    });

    it('should detect modified methods', () => {
      const oldSchema = `
---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
      `;
      const newSchema = `
---functions---

auth.sendCode#bbccddee phone_number:string api_id:int api_hash:string settings:CodeSettings extra:string = auth.SentCode;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedMethods).toHaveLength(1);
      expect(diff.modifiedMethods[0].name).toBe('auth.sendCode');
    });
  });

  describe('layer change detection', () => {
    it('should detect layer number change', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
// LAYER 190
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
// LAYER 195
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.oldLayer).toBe(190);
      expect(diff.newLayer).toBe(195);
    });

    it('should report same layer when unchanged', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
// LAYER 195
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
// LAYER 195
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(false);
      expect(diff.oldLayer).toBe(195);
      expect(diff.newLayer).toBe(195);
    });

    it('should handle schemas without layer comments', () => {
      const oldSchema = `boolFalse#bc799737 = Bool;`;
      const newSchema = `boolFalse#bc799737 = Bool;`;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.oldLayer).toBe(0);
      expect(diff.newLayer).toBe(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle simultaneous adds, removes, and modifications', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
error#c4b9f9bb code:int text:string = Error;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
auth.logOut#3e72ba19 = auth.LoggedOut;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
error#aabbccdd code:long text:string details:string = Error;
null#56730bcc = Null;

---functions---

auth.sendCode#a677244f phone_number:string api_id:int api_hash:string settings:CodeSettings = auth.SentCode;
auth.signIn#12345678 phone_number:string code:string = auth.Authorization;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);

      // Constructor changes
      expect(diff.addedConstructors).toHaveLength(1); // null
      expect(diff.addedConstructors[0].name).toBe('null');
      expect(diff.removedConstructors).toHaveLength(1); // boolTrue
      expect(diff.removedConstructors[0].name).toBe('boolTrue');
      expect(diff.modifiedConstructors).toHaveLength(1); // error
      expect(diff.modifiedConstructors[0].name).toBe('error');

      // Method changes
      expect(diff.addedMethods).toHaveLength(1); // auth.signIn
      expect(diff.addedMethods[0].name).toBe('auth.signIn');
      expect(diff.removedMethods).toHaveLength(1); // auth.logOut
      expect(diff.removedMethods[0].name).toBe('auth.logOut');
      expect(diff.modifiedMethods).toHaveLength(0); // auth.sendCode unchanged
    });

    it('should handle constructors with flags', () => {
      const oldSchema = `
inputMediaUploadedPhoto#1e287d04 flags:# spoiler:flags.2?true file:InputFile ttl_seconds:flags.1?int = InputMedia;
      `;
      const newSchema = `
inputMediaUploadedPhoto#aabbccdd flags:# spoiler:flags.2?true file:InputFile stickers:flags.0?VectorInputDocument> ttl_seconds:flags.1?int = InputMedia;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      expect(diff.hasChanges).toBe(true);
      expect(diff.modifiedConstructors).toHaveLength(1);
      expect(diff.modifiedConstructors[0].name).toBe('inputMediaUploadedPhoto');
    });
  });

  describe('formatDiffSummary', () => {
    it('should format a no-changes summary', () => {
      const diff = diffSchemaStrings(
        'boolFalse#bc799737 = Bool;',
        'boolFalse#bc799737 = Bool;'
      );
      const summary = formatDiffSummary(diff);
      expect(summary).toContain('No changes detected');
    });

    it('should format a summary with changes', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
// LAYER 190
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
// LAYER 195
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      const summary = formatDiffSummary(diff);
      expect(summary).toContain('TL Schema Diff Summary');
      expect(summary).toContain('Layer: 190 -> 195');
      expect(summary).toContain('Added:    1');
      expect(summary).toContain('boolTrue');
      expect(summary).toContain('Total changes: 1');
    });

    it('should include removed and modified details', () => {
      const oldSchema = `
boolFalse#bc799737 = Bool;
boolTrue#997275b5 = Bool;
error#c4b9f9bb code:int text:string = Error;
      `;
      const newSchema = `
boolFalse#bc799737 = Bool;
error#aabbccdd code:long text:string = Error;
      `;
      const diff = diffSchemaStrings(oldSchema, newSchema);
      const summary = formatDiffSummary(diff);
      expect(summary).toContain('Removed:  1');
      expect(summary).toContain('Modified: 1');
      expect(summary).toContain('boolTrue');
      expect(summary).toContain('error');
    });
  });
});
