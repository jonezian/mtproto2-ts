import crypto from 'node:crypto';

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b > 0n) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function randomInRange(min: bigint, max: bigint): bigint {
  const range = max - min;
  const byteLen = Math.ceil(range.toString(16).length / 2) + 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const buf = crypto.randomBytes(byteLen);
    const val = BigInt('0x' + buf.toString('hex'));
    const result = min + (val % range);
    if (result >= min && result < max) {
      return result;
    }
  }
}

function pollardRho(n: bigint): bigint {
  if (n % 2n === 0n) return 2n;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x = randomInRange(2n, n - 1n);
    let y = x;
    const c = randomInRange(1n, n - 1n);
    let d = 1n;

    while (d === 1n) {
      x = (x * x + c) % n;
      y = (y * y + c) % n;
      y = (y * y + c) % n;

      let diff = x - y;
      if (diff < 0n) diff = -diff;
      d = gcd(diff, n);
    }

    if (d !== n) {
      return d;
    }
    // If d === n, retry with different random values
  }
}

/**
 * Factor a composite number pq into its two prime factors p and q.
 * Returns [p, q] where p < q.
 * Uses Pollard's rho algorithm.
 */
export function factorizePQ(pq: bigint): [bigint, bigint] {
  if (pq <= 1n) {
    throw new Error('pq must be greater than 1');
  }

  const factor = pollardRho(pq);
  const other = pq / factor;

  const p = factor < other ? factor : other;
  const q = factor < other ? other : factor;

  return [p, q];
}
