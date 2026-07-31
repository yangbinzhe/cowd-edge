import { describe, expect, it } from 'vitest';

import { resolveWechatQrPollState } from './wechatQr';

describe('resolveWechatQrPollState', () => {
  it('continues polling against the official redirect host after a scan', () => {
    expect(resolveWechatQrPollState({
      status: 'scaned_but_redirect',
      base_url: 'https://redirect.weixin.qq.com',
    }, 'https://ilinkai.weixin.qq.com')).toEqual({
      status: 'scaned_but_redirect',
      baseUrl: 'https://redirect.weixin.qq.com',
      terminal: false,
    });
  });

  it('rejects an untrusted poll host and stops on expiry', () => {
    expect(resolveWechatQrPollState({
      status: 'expired',
      base_url: 'https://attacker.example',
    }, 'https://ilinkai.weixin.qq.com')).toEqual({
      status: 'expired',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      terminal: true,
    });
  });
});
