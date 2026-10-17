import { matchSocketCorsOrigin } from './socket-auth.util';

describe('matchSocketCorsOrigin', () => {
  const allowed = 'http://localhost:5173';

  it('没有 Origin 时放行', () => {
    expect(matchSocketCorsOrigin(undefined, allowed)).toBe(true);
  });

  it('与 CORS_ORIGIN 完全一致时放行', () => {
    expect(matchSocketCorsOrigin(allowed, allowed)).toBe(true);
  });

  it('本机其它端口不放行', () => {
    expect(matchSocketCorsOrigin('http://localhost:3000', allowed)).toBe(false);
    expect(matchSocketCorsOrigin('http://127.0.0.1:5173', allowed)).toBe(false);
    expect(matchSocketCorsOrigin('http://localhost:5174', allowed)).toBe(false);
  });
});
