/**
 * Type declarations for Uint8Array Base64 methods (TC39 Stage 4)
 * https://github.com/tc39/proposal-arraybuffer-base64
 */

interface Base64Options {
  alphabet?: 'base64' | 'base64url';
}

interface Base64EncodeOptions extends Base64Options {
  omitPadding?: boolean;
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string, options?: Base64Options): Uint8Array;
}

interface Uint8Array {
  toBase64(options?: Base64EncodeOptions): string;
}
