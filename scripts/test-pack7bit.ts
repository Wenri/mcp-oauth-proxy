/**
 * Test script for pack7bit/unpack7bit functions
 * Explores padding bit behavior in GSM 7-bit encoding
 */

import { utils } from 'node-pdu';
import { pack7bit, unpack7bit } from '../siyuan-mcp/utils/crypto';

// Test encode7Bit with various string lengths
function testEncode7Bit() {
  console.log('=== Testing encode7Bit padding behavior ===\n');

  // Test strings of length 1-16 to see padding patterns
  for (let len = 1; len <= 16; len++) {
    const str = 'a'.repeat(len);
    const { length, result } = utils.Helper.encode7Bit(str);

    // Calculate expected bytes: ceil(len * 7 / 8)
    const expectedBytes = Math.ceil((len * 7) / 8);
    const actualBytes = result.length / 2;

    // Calculate padding bits
    const totalBits = len * 7;
    const usedBits = expectedBytes * 8;
    const paddingBits = usedBits - totalBits;

    // Get the last byte to see padding
    const lastByteHex = result.slice(-2);
    const lastByte = parseInt(lastByteHex, 16);

    console.log(`len=${len.toString().padStart(2)}: hex="${result}" (${actualBytes} bytes)`);
    console.log(`         length=${length}, paddingBits=${paddingBits}, lastByte=0x${lastByteHex} (${lastByte.toString(2).padStart(8, '0')})`);

    // Decode and check
    const decoded = utils.Helper.decode7Bit(result, length);
    console.log(`         decoded="${decoded}" (matches: ${decoded === str})\n`);
  }
}

// Modified pack7bit that uses 0x1B padding when length % 8 == 7
function pack7bitWithEscPadding(str: string): Uint8Array {
  const { result } = utils.Helper.encode7Bit(str);
  const bytes = utils.Helper.hexToUint8Array(result);

  // When length % 8 == 7, we have 7 padding bits in the last byte
  // Set them to 0x1B (ESC = position 27 in GSM) shifted appropriately
  if (str.length % 8 === 7) {
    // 7 padding bits means the entire last byte except the LSB is padding
    // ESC = 27 = 0b0011011, we need to put this in the upper 7 bits
    // Last data bit is in position 0, padding is in positions 1-7
    // So we set: (0x1B << 1) | (lastByte & 0x01)
    bytes[bytes.length - 1] = (0x1B << 1) | (bytes[bytes.length - 1] & 0x01);
  }

  return bytes;
}

function testEscPadding() {
  console.log('=== Testing 0x1B (ESC) padding when length % 8 == 7 ===\n');

  const testStrings = ['user123', 'test123', 'abcdefg', 'aaaaaaaaaaaaaaa']; // All length 7 or 15

  for (const str of testStrings) {
    console.log(`Original: "${str}" (${str.length} chars, length % 8 = ${str.length % 8})`);

    // Original encoding
    const { length, result } = utils.Helper.encode7Bit(str);
    const originalBytes = utils.Helper.hexToUint8Array(result);
    console.log(`  Original hex: ${result}`);
    console.log(`  Original last byte: 0x${originalBytes[originalBytes.length - 1].toString(16).padStart(2, '0')}`);

    // Modified encoding with ESC padding
    const modifiedBytes = pack7bitWithEscPadding(str);
    const modifiedHex = modifiedBytes.toHex();
    console.log(`  Modified hex: ${modifiedHex}`);
    console.log(`  Modified last byte: 0x${modifiedBytes[modifiedBytes.length - 1].toString(16).padStart(2, '0')}`);

    // Decode both with correct length
    const decodedOriginal = utils.Helper.decode7Bit(result, length);
    const decodedModified = utils.Helper.decode7Bit(modifiedHex, length);
    console.log(`  Decoded original (len=${length}): "${decodedOriginal}"`);
    console.log(`  Decoded modified (len=${length}): "${decodedModified}"`);

    // Decode both with length+1 to see phantom character
    const decodedOriginalPlus1 = utils.Helper.decode7Bit(result, length + 1);
    const decodedModifiedPlus1 = utils.Helper.decode7Bit(modifiedHex, length + 1);
    console.log(`  Decoded original (len=${length + 1}): "${decodedOriginalPlus1}" (phantom: "${decodedOriginalPlus1.charAt(length)}")`);
    console.log(`  Decoded modified (len=${length + 1}): "${decodedModifiedPlus1}" (phantom: "${decodedModifiedPlus1.charAt(length)}")`);

    console.log();
  }
}

// Test what happens with different padding values
function testPaddingValues() {
  console.log('=== Testing different padding values ===\n');

  // Encode "user123" (7 chars) - should have 7 padding bits (almost a full byte)
  const str = 'user123';
  const { length, result } = utils.Helper.encode7Bit(str);
  console.log(`Original: "${str}" (${str.length} chars)`);
  console.log(`Encoded:  ${result} (length=${length})`);

  // 7 chars * 7 bits = 49 bits = 6 bytes + 1 bit
  // So we have 7 bytes with 7 padding bits in the last byte
  const bytes = utils.Helper.hexToUint8Array(result);
  console.log(`Bytes:    [${Array.from(bytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

  // Try decoding with length 7 vs 8
  const decoded7 = utils.Helper.decode7Bit(result, 7);
  const decoded8 = utils.Helper.decode7Bit(result, 8);
  console.log(`\nDecode with length=7: "${decoded7}"`);
  console.log(`Decode with length=8: "${decoded8}"`);
  console.log(`Extra char code: ${decoded8.charCodeAt(7)} (GSM: ${decoded8.charAt(7) === '@' ? '@ (position 0)' : decoded8.charAt(7)})`);

  // Now manually set different padding values
  console.log('\n--- Testing manual padding values ---');
  const lastByte = bytes[bytes.length - 1];
  const paddingMask = 0b01111111; // 7 padding bits

  for (const padValue of [0x00, 0x1A, 0x0D, 0x14, 0x7F]) {
    const testBytes = new Uint8Array(bytes);
    // Clear padding bits and set new value
    testBytes[testBytes.length - 1] = (lastByte & ~paddingMask) | (padValue & paddingMask);
    const testHex = testBytes.toHex();
    const testDecoded = utils.Helper.decode7Bit(testHex, 8);
    console.log(`Padding 0x${padValue.toString(16).padStart(2, '0')}: decoded[7]="${testDecoded.charAt(7)}" (code=${testDecoded.charCodeAt(7)})`);
  }
}

// Test GSM alphabet special characters
function testGsmAlphabet() {
  console.log('\n=== GSM 7-bit Alphabet Reference ===\n');

  const specialPositions = [
    { pos: 0, char: '@' },
    { pos: 10, char: '\\n (LF)' },
    { pos: 13, char: '\\r (CR)' },
    { pos: 26, char: 'SUB' },
    { pos: 27, char: 'ESC' },
    { pos: 32, char: 'SPACE' },
  ];

  for (const { pos, char } of specialPositions) {
    console.log(`Position ${pos.toString().padStart(2)}: ${char}`);
  }
}

// Test roundtrip with various strings
function testRoundtrip() {
  console.log('\n=== Roundtrip Tests ===\n');

  const testStrings = [
    'user@example.com',
    'test123',
    'a',
    'ab',
    'abc',
    'abcdefgh', // 8 chars - perfect alignment
    'hello world',
    '0123456789abcdef', // 16 chars
  ];

  for (const str of testStrings) {
    const { length, result } = utils.Helper.encode7Bit(str);
    const decoded = utils.Helper.decode7Bit(result, length);
    const match = decoded === str;

    const paddingBits = (Math.ceil((str.length * 7) / 8) * 8) - (str.length * 7);

    console.log(`"${str}" (${str.length} chars, ${paddingBits} padding bits)`);
    console.log(`  hex: ${result}`);
    console.log(`  roundtrip: ${match ? '✓' : '✗'} "${decoded}"`);
    if (!match) {
      console.log(`  MISMATCH!`);
    }
    console.log();
  }
}

// Count septets (extended chars like []{}~\^€| take 2 septets)
const GSM_EXTENDED = new Set(['[', ']', '{', '}', '~', '\\', '^', '€', '|']);
function countSeptets(str: string): number {
  let count = 0;
  for (const char of str) {
    count += GSM_EXTENDED.has(char) ? 2 : 1;
  }
  return count;
}

// Test actual pack7bit/unpack7bit from crypto.ts
function testCryptoFunctions() {
  console.log('=== Testing actual pack7bit/unpack7bit from crypto.ts ===\n');

  const testStrings = [
    'user123',           // 7 chars, 7 septets - ESC padding case
    'test123',           // 7 chars, 7 septets - ESC padding case
    'user@example.com',  // 16 chars, 16 septets - perfect alignment
    'a]b[c',             // 5 chars, 7 septets - ESC padding case (extended chars)
    'hello world',       // 11 chars, 11 septets
    'aaaaaaaaaaaaaaa',   // 15 chars, 15 septets - ESC padding case
    'test[1]',           // 7 chars, 9 septets
    '€100',              // 4 chars, 5 septets (€ is extended)
  ];

  for (const str of testStrings) {
    const septets = countSeptets(str);
    const packed = pack7bit(str);
    const maxSeptets = Math.floor((packed.length * 8) / 7);
    const unpacked = unpack7bit(packed, maxSeptets);
    const match = unpacked === str;

    console.log(`"${str}" (${str.length} chars, ${septets} septets, septets%8=${septets % 8})`);
    console.log(`  packed:   ${packed.toHex()} (${packed.length} bytes)`);
    console.log(`  unpacked: "${unpacked}"`);
    console.log(`  match:    ${match ? '✓' : '✗ FAILED'}`);

    // Also test decoding with maxSeptets+1 to verify no phantom char
    if (septets % 8 === 7) {
      const unpackedPlus1 = unpack7bit(packed, maxSeptets + 1);
      console.log(`  decode+1: "${unpackedPlus1}" (should have no phantom @)`);
    }
    console.log();
  }
}

// Run all tests
testEncode7Bit();
testEscPadding();
testCryptoFunctions();
testPaddingValues();
testGsmAlphabet();
testRoundtrip();
