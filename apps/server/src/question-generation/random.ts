/** xoshiro128** v1. All arithmetic is unsigned 32-bit; no platform entropy. */
export class SeededRandom {
  private readonly state: number[];
  constructor(words: readonly number[]) {
    if (
      words.length !== 4 ||
      words.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffffffff)
    )
      throw new Error('INVALID_RANDOM_STATE');
    this.state = [...words];
    if (this.state.reduce((bits, word) => bits | word, 0) === 0)
      this.state[3] = 1;
  }
  next(): number {
    const [a, b, c, d] = this.state;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined
    )
      throw new Error('INVALID_RANDOM_STATE');
    const product = Math.imul(b, 5) >>> 0;
    const result = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
    const nextC = (c ^ a ^ (b << 9)) >>> 0;
    const nextD = (d ^ b) >>> 0;
    this.state[0] = (a ^ nextD) >>> 0;
    this.state[1] = (b ^ c ^ a) >>> 0;
    this.state[2] = nextC;
    this.state[3] = ((nextD << 11) | (nextD >>> 21)) >>> 0;
    return result;
  }
  index(size: number): number {
    if (!Number.isInteger(size) || size < 1 || size > 0x100000000)
      throw new Error('INVALID_RANDOM_SIZE');
    const limit = Math.floor(0x100000000 / size) * size;
    for (let attempt = 0; attempt < 256; attempt++) {
      const value = this.next();
      if (value < limit) return value % size;
    }
    throw new Error('RANDOM_BUDGET_EXHAUSTED');
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.index(items.length)];
    if (item === undefined) throw new Error('EMPTY_RANDOM_POOL');
    return item;
  }
  sample<T>(items: readonly T[], count: number): T[] {
    if (!Number.isInteger(count) || count < 0 || count > items.length)
      throw new Error('INVALID_SAMPLE_SIZE');
    const result = [...items];
    const swap = (left: number, right: number) => {
      const a = result[left],
        b = result[right];
      if (a === undefined || b === undefined)
        throw new Error('INVALID_SAMPLE_INDEX');
      result[left] = b;
      result[right] = a;
    };
    if (count === result.length) {
      for (let index = result.length - 1; index > 0; index--)
        swap(index, this.index(index + 1));
    } else {
      for (let index = 0; index < count; index++)
        swap(index, index + this.index(result.length - index));
    }
    return result.slice(0, count);
  }
}
export type RandomStreams = (
  purpose: string,
  ...keys: readonly (string | number | readonly string[])[]
) => SeededRandom;
export const stableCompare = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;
