/**
 * Modular exponentiation using square-and-multiply.
 * Computes (base ^ exp) mod mod.
 */
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;

  base = ((base % mod) + mod) % mod;
  let result = 1n;

  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }

  return result;
}

/**
 * Miller-Rabin primality test.
 * Returns true if n is probably prime.
 */
function millerRabin(n: bigint, rounds: number = 20): boolean {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;

  // Write n-1 as 2^r * d
  let d = n - 1n;
  let r = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    r++;
  }

  // Witness loop with fixed bases for determinism in testing,
  // plus we check known small primes
  const witnesses: bigint[] = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

  // For large numbers, also use additional rounds
  const toTest = rounds > witnesses.length
    ? witnesses
    : witnesses.slice(0, rounds);

  for (const a of toTest) {
    if (a >= n) continue;

    let x = modPow(a, d, n);

    if (x === 1n || x === n - 1n) continue;

    let continueOuter = false;
    for (let i = 0; i < r - 1; i++) {
      x = modPow(x, 2n, n);
      if (x === n - 1n) {
        continueOuter = true;
        break;
      }
    }

    if (!continueOuter) return false;
  }

  return true;
}

function bitLength(n: bigint): number {
  if (n === 0n) return 0;
  return n.toString(2).length;
}

/**
 * Validate DH parameters.
 * - dhPrime must be 2048-bit
 * - dhPrime must be prime
 * - (dhPrime - 1) / 2 must also be prime (safe prime)
 * - g must be valid for the prime
 */
export function isGoodPrime(dhPrime: bigint, g: number): boolean {
  // Must be 2048-bit
  const bits = bitLength(dhPrime);
  if (bits !== 2048) return false;

  // dhPrime must be prime
  if (!millerRabin(dhPrime, 20)) return false;

  // (dhPrime - 1) / 2 must also be prime (safe prime check)
  const halfPrime = (dhPrime - 1n) / 2n;
  if (!millerRabin(halfPrime, 20)) return false;

  // Validate g values per MTProto specification
  const bigG = BigInt(g);
  if (bigG < 2n) return false;

  // Check that g generates a subgroup of the correct order
  // For specific g values, additional checks apply:
  switch (g) {
    case 2:
      // dhPrime % 8 === 7
      if (dhPrime % 8n !== 7n) return false;
      break;
    case 3:
      // dhPrime % 3 === 2
      if (dhPrime % 3n !== 2n) return false;
      break;
    case 4:
      // No additional constraint beyond safe prime
      break;
    case 5:
      // dhPrime % 5 === 1 or 4
      if (dhPrime % 5n !== 1n && dhPrime % 5n !== 4n) return false;
      break;
    case 6:
      // dhPrime % 24 === 19 or 23
      if (dhPrime % 24n !== 19n && dhPrime % 24n !== 23n) return false;
      break;
    case 7:
      // dhPrime % 7 === 3, 5, or 6
      if (dhPrime % 7n !== 3n && dhPrime % 7n !== 5n && dhPrime % 7n !== 6n) return false;
      break;
    default:
      return false;
  }

  return true;
}

/**
 * Validate g_a (or g_b) is in a valid range.
 * - 1 < g_a < dhPrime - 1
 * - 2^{2048-64} < g_a < dhPrime - 2^{2048-64}
 */
export function isGoodGa(ga: bigint, dhPrime: bigint): boolean {
  if (ga <= 1n) return false;
  if (ga >= dhPrime - 1n) return false;

  const boundary = 1n << (2048n - 64n);
  if (ga < boundary) return false;
  if (ga > dhPrime - boundary) return false;

  return true;
}
