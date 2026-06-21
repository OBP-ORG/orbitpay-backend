import { signJwt, verifyJwt } from '../lib/jwt';

describe('JWT', () => {
  it('signs and verifies a token', () => {
    const token = signJwt({ sub: 'GABCDE' });
    const payload = verifyJwt(token);
    expect(payload?.sub).toBe('GABCDE');
  });

  it('returns null for a tampered token', () => {
    const token = signJwt({ sub: 'GABCDE' });
    const [h, p, s] = token.split('.');
    const tampered = `${h}.${p}.INVALIDSIG`;
    expect(verifyJwt(tampered)).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(verifyJwt('not.a.jwt.at.all')).toBeNull();
    expect(verifyJwt('')).toBeNull();
  });

  it('returns null for an expired token', () => {
    // Manually craft an expired payload
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'GABCDE', iat: 1, exp: 1 }),
    ).toString('base64url');
    const token = `${header}.${payload}.fakesig`;
    expect(verifyJwt(token)).toBeNull();
  });
});
