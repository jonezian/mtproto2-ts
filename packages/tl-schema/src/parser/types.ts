/**
 * AST types for parsed TL schema.
 */

export interface TLParam {
  name: string;
  type: string;           // Raw type string e.g. "int", "long", "string", "VectorMessage>"
  isFlag: boolean;         // Is this a conditional field?
  flagField: string | null; // e.g. "flags" or "flags2"
  flagIndex: number | null; // e.g. 0, 1, 2...
  isVector: boolean;
  innerType: string | null; // Inner type if vector
  isBareType: boolean;     // lowercase = bare type
  isTrueFlag: boolean;     // flags.N?true means "field is present if bit set, no data"
}

export interface TLConstructor {
  name: string;            // e.g. "message" or "messages.sendMessage"
  id: number;              // CRC32 hex parsed to number, e.g. 0x94345242
  namespace: string | null; // e.g. "messages", "channels", null
  localName: string;       // e.g. "sendMessage" (without namespace)
  params: TLParam[];
  type: string;            // Result type: "Message", "Updates", "Bool"
  isFunction: boolean;
}

export interface TLSchema {
  constructors: TLConstructor[];
  functions: TLConstructor[];
  layer: number;           // Extracted from schema comments or computed
}
