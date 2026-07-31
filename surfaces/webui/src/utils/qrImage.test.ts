import { describe, expect, it } from 'vitest';

import { qrImageSource } from './qrImage';

describe('qrImageSource', () => {
  it('preserves browser-ready image data URIs', async () => {
    const source = 'data:image/png;base64,iVBORw0KGgo=';
    await expect(qrImageSource(source)).resolves.toBe(source);
  });

  it('wraps recognized image base64 without regenerating it', async () => {
    await expect(qrImageSource('iVBORw0KGgo=')).resolves.toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });

  it('renders scan URLs as local QR images', async () => {
    const source = await qrImageSource('https://liteapp.weixin.qq.com/q/example');
    expect(source).toMatch(/^data:image\/png;base64,/);
    expect(source.length).toBeGreaterThan(100);
  });

  it('uses fallback scan data when no image content is supplied', async () => {
    const source = await qrImageSource('', 'wechat-login-token');
    expect(source).toMatch(/^data:image\/png;base64,/);
  });
});
