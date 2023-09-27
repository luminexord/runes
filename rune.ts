/**
  Convert between rune symbols and values using Base 26 (A=1)
  Similar rust implementation at https://github.com/ordinals/ord/blob/f3cae5400fdebf31bfd494a02c846a90ea12310d/src/sat.rs#L63
*/

class Rune {
  constructor(public value: number) { }

  public get name(): string {
      let x = this.value;
      let name = '';
      while (x > 0) {
          name += "abcdefghijklmnopqrstuvwxyz".charAt((x - 1) % 26);
          x = Math.floor((x - 1) / 26);
      }
      return name.split('').reverse().join('');
  }

  public static fromName(s: string): Rune {
    s = s.toLowerCase()
    let x = 0;
    for (const c of s) {
        if (c >= 'a' && c <= 'z') {
            x = x * 26 + c.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
        } else {
            throw new Error(`invalid character in sat name: ${c}`);
        }
    }
    return new Rune(x);
  }
}


/**
   PrefixVarint
   Similar rust implementation at: https://github.com/otake84/dlhn/blob/22ce82ab3740328ff7041b63f77ee70020605b1c/dlhn/src/prefix_varint.rs#L5
*/

const PREFIX_VARINT_BUF_SIZE = 9;

function countLeadingZeros(input: string) {
    let splitted = input.split("");
    let count = 0;
    for (let i = 0; i < splitted.length; i++) {
        if (+splitted[i] !== 0) {
            break;
        }
        count++
    }
    return count;
}

function encodePrefixVarint(value: bigint, buf: Buffer): number {
    const leadingZeros = countLeadingZeros(value.toString(2).padStart(64, '0'));
    let bytesRequired: number = 1;

    // Define the thresholds for leading zeros to determine bytes required
    const thresholds = [7, 14, 21, 28, 35, 42, 49, 56];
    for (let i = 0; i < thresholds.length; i++) {
        if (leadingZeros <= thresholds[i]) {
            bytesRequired = PREFIX_VARINT_BUF_SIZE - i;
            break;
        }
    }

    switch (bytesRequired) {
        case 9:
            buf[0] = 255;
            buf.writeBigUInt64LE(value, 1);
            return bytesRequired;
        
        case 8:
            buf[0] = 254;
            for (let i = 1; i <= 7; i++) {
                buf[i] = Number((value >> BigInt(8 * (i - 1))) & BigInt(0xFF));
            }
            return bytesRequired;
        
        case 1:
            buf[0] = Number(value & BigInt(0xFF));
            return bytesRequired;

        default:
            const prefixMask = 256 - (1 << (PREFIX_VARINT_BUF_SIZE - bytesRequired))
            value <<= BigInt(bytesRequired);
            buf[0] = Number(((value & BigInt(0xFF)) >> BigInt(bytesRequired)) | BigInt(prefixMask));
            for (let i = 1; i < bytesRequired; i++) {
                buf[i] = Number((value >> BigInt(8 * i)) & BigInt(0xFF));
            }
            return bytesRequired;
    }
}

function decodePrefixVarint(buf: Buffer): bigint {
    const firstByte = buf[0];

    switch (true) {
        case (firstByte & 128) === 0: // Leading ones: 0
            return BigInt(firstByte);

        case (firstByte & 192) === 128: // Leading ones: 1
            return (BigInt(firstByte & 0x3F) | (BigInt(buf[1]) << BigInt(6)));

        case (firstByte & 224) === 192: // Leading ones: 2
            return (BigInt(firstByte & 0x1F) | (BigInt(buf[1]) | (BigInt(buf[2]) << BigInt(8))) << BigInt(5));

        case (firstByte & 240) === 224: // Leading ones: 3
            let value3 = BigInt(firstByte & 0x0F);
            value3 |= (BigInt(buf[1]) | (BigInt(buf[2]) << BigInt(8)) | (BigInt(buf[3]) << BigInt(16))) << BigInt(4);
            return value3;

        case (firstByte & 248) === 240: // Leading ones: 4
            let value4 = BigInt(firstByte & 0x07);
            value4 |= (BigInt(buf.readUInt32LE(1))) << BigInt(3);
            return value4;

        case (firstByte & 252) === 248: // Leading ones: 5
            return (BigInt(firstByte & 0x03) |
                    (BigInt(buf[1]) |
                    (BigInt(buf[2]) << BigInt(8)) |
                    (BigInt(buf[3]) << BigInt(16)) |
                    (BigInt(buf[4]) << BigInt(24)) |
                    (BigInt(buf[5]) << BigInt(32))) << BigInt(2));
        case (firstByte & 254) === 252: // Leading ones: 6
            let value6 = BigInt(firstByte & 0x01);
            value6 |= (BigInt(buf.readUInt32LE(1)) | (BigInt(buf.readUInt16LE(5)) << BigInt(32))) << BigInt(1);
            return value6;

        case firstByte === 254: // Leading ones: 7
            const tempBuf = Buffer.alloc(8);
            tempBuf[0] = firstByte;
            buf.copy(tempBuf, 1, 1, 8);  // Copy next 7 bytes from buf into tempBuf starting from position 1
            return (tempBuf.readBigUInt64LE(0) >> BigInt(8));

        case firstByte === 255: // Leading ones: 8
            return buf.readBigUInt64LE(1);

        default:
            throw new Error('Invalid prefix varint');
    }
}

// Test cases
(async () => {
    const testCases = [
        { value: 0n, expected: '00' },
        { value: 1n, expected: '01' },
        { value: 127n, expected: '7f' },
        { value: 128n, expected: '8002' },
        { value: 16383n, expected: 'bfff' },
        { value: 16384n, expected: 'c00002' },
        { value: 2097151n, expected: 'dfffff' },
        { value: 2097152n, expected: 'e0000002' },
        { value: 21000000n, expected: 'e0f40614' },
        { value: 268435455n, expected: 'efffffff' },
        { value: 268435456n, expected: 'f000000002' },
        { value: 34359738367n, expected: 'f7ffffffff' },
        { value: 34359738368n, expected: 'f80000000002' }, // 
        { value: 4398046511103n, expected: 'fbffffffffff' }, //
        { value: 4398046511104n, expected: 'fc000000000002' },
        { value: 562949953421311n, expected: 'fdffffffffffff' },
        { value: 562949953421312n, expected: 'fe00000000000002' },
        { value: 72057594037927935n, expected: 'feffffffffffffff' },
        { value: 72057594037927936n, expected: 'ff0000000000000001' },
        { value: 18446744073709551615n, expected: 'ffffffffffffffffff' },
    ]

    for (const testCase of testCases) {
        const buf = Buffer.alloc(PREFIX_VARINT_BUF_SIZE);

        const encodedLength = encodePrefixVarint(testCase.value, buf);
        if (testCase.expected !== buf.slice(0, encodedLength).toString('hex')) {
            throw new Error(`Expected ${testCase.expected} but got ${buf.slice(0, encodedLength).toString('hex')}`);
        }

        const decoded = decodePrefixVarint(buf);
        if (testCase.value !== decoded) {
            throw new Error(`Expected ${testCase.value} but got ${decoded}`);
        }
    }
})();