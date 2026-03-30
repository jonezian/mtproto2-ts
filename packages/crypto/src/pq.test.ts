import { describe, it, expect } from 'vitest';
import { factorizePQ } from './pq.js';

describe('PQ Factorization', () => {
  it('should factor known Telegram PQ value', () => {
    const pq = 0x17ED48941A08F981n;
    const [p, q] = factorizePQ(pq);

    expect(p).toBe(0x494C553Bn);
    expect(q).toBe(0x53911073n);
    expect(p * q).toBe(pq);
  });

  it('should factor small composite numbers', () => {
    const pq = 15n;
    const [p, q] = factorizePQ(pq);

    expect(p).toBe(3n);
    expect(q).toBe(5n);
    expect(p * q).toBe(pq);
  });

  it('should return p < q', () => {
    const pq = 0x17ED48941A08F981n;
    const [p, q] = factorizePQ(pq);

    expect(p).toBeLessThan(q);
  });

  it('should factor even numbers', () => {
    const pq = 14n;
    const [p, q] = factorizePQ(pq);

    expect(p).toBe(2n);
    expect(q).toBe(7n);
    expect(p * q).toBe(pq);
  });

  it('should factor another composite number', () => {
    const pq = 1000003n * 1000033n;
    const [p, q] = factorizePQ(pq);

    expect(p).toBe(1000003n);
    expect(q).toBe(1000033n);
    expect(p * q).toBe(pq);
  });
});
