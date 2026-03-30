import { describe, it, expect } from 'vitest';
import { modPow, isGoodPrime, isGoodGa } from './dh.js';

describe('modPow', () => {
  it('should compute 2^10 mod 1000 = 24', () => {
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
  });

  it('should compute 3^13 mod 7 = 3', () => {
    expect(modPow(3n, 13n, 7n)).toBe(3n);
  });

  it('should handle base=0', () => {
    expect(modPow(0n, 5n, 7n)).toBe(0n);
  });

  it('should handle exp=0', () => {
    expect(modPow(5n, 0n, 7n)).toBe(1n);
  });

  it('should handle mod=1', () => {
    expect(modPow(5n, 3n, 1n)).toBe(0n);
  });

  it('should handle large numbers', () => {
    const base = 123456789n;
    const exp = 987654321n;
    const mod = 1000000007n;
    const result = modPow(base, exp, mod);
    // Verify result is in range
    expect(result).toBeGreaterThanOrEqual(0n);
    expect(result).toBeLessThan(mod);
  });
});

describe('isGoodPrime', () => {
  // Use the known Telegram DH prime (2048-bit safe prime)
  const knownGoodPrime = 0xC71CAEB9C6B1C9048E6C522F70F13F73980D40238E3E21C14934D037563D930F48198A0AA7C14058229493D22530F4DBFA336F6E0AC925139543AED44CCE7C3720FD51F69458705AC68CD4FE6B6B13ABDC9746512969328454F18FAF8C595F642477FE96BB2A941D5BCD1D4AC8CC49880708FA9B378E3C4F3A9060BEE67CF9A4A4A695811051907E162753B56B0F6B410DBA74D8A84B2A14B3144E0EF1284754FD17ED950D5965B4B9DD46582DB1178D169C6BC465B0D6FF9CA3928FEF5B9AE4E418FC15E83EBEA0F87FA9FF5EED70050DED2849F47BF959D956850CE929851F0D8115F635B105EE2E4E15D04B2454BF6F4FADF034B10403119CD8E3B92FCC5Bn;

  it('should accept known good Telegram DH prime with g=3', () => {
    expect(isGoodPrime(knownGoodPrime, 3)).toBe(true);
  });

  it('should reject non-2048-bit numbers', () => {
    expect(isGoodPrime(7n, 2)).toBe(false);
  });

  it('should reject even numbers of appropriate size', () => {
    // A 2048-bit even number
    const evenNumber = 1n << 2047n;
    expect(isGoodPrime(evenNumber, 2)).toBe(false);
  });
});

describe('isGoodGa', () => {
  const dhPrime = 0xC71CAEB9C6B1C9048E6C522F70F13F73980D40238E3E21C14934D037563D930F48198A0AA7C14058229493D22530F4DBFA336F6E0AC925139543AED44CCE7C3720FD51F69458705AC68CD4FE6B6B13ABDC9746512969328454F18FAF8C595F642477FE96BB2A941D5BCD1D4AC8CC49880708FA9B378E3C4F3A9060BEE67CF9A4A4A695811051907E162753B56B0F6B410DBA74D8A84B2A14B3144E0EF1284754FD17ED950D5965B4B9DD46582DB1178D169C6BC465B0D6FF9CA3928FEF5B9AE4E418FC15E83EBEA0F87FA9FF5EED70050DED2849F47BF959D956850CE929851F0D8115F635B105EE2E4E15D04B2454BF6F4FADF034B10403119CD8E3B92FCC5Bn;

  it('should accept a value in the valid range', () => {
    // A value clearly in the middle of the valid range
    const ga = dhPrime / 2n;
    expect(isGoodGa(ga, dhPrime)).toBe(true);
  });

  it('should reject 0', () => {
    expect(isGoodGa(0n, dhPrime)).toBe(false);
  });

  it('should reject 1', () => {
    expect(isGoodGa(1n, dhPrime)).toBe(false);
  });

  it('should reject dhPrime - 1', () => {
    expect(isGoodGa(dhPrime - 1n, dhPrime)).toBe(false);
  });

  it('should reject values too close to 0', () => {
    expect(isGoodGa(2n, dhPrime)).toBe(false);
  });

  it('should reject values too close to dhPrime', () => {
    expect(isGoodGa(dhPrime - 2n, dhPrime)).toBe(false);
  });
});
