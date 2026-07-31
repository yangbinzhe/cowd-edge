export interface WechatQrPollState {
  status: string;
  baseUrl: string;
  terminal: boolean;
}

function isOfficialWechatBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:'
      && (host === 'weixin.qq.com' || host.endsWith('.weixin.qq.com'))
      && !url.username
      && !url.password
      && !url.port
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function resolveWechatQrPollState(
  payload: Record<string, unknown>,
  currentBaseUrl: string,
): WechatQrPollState {
  const status = typeof payload.status === 'string' && payload.status
    ? payload.status
    : 'waiting_for_scan';
  const candidate = typeof payload.base_url === 'string' ? payload.base_url : '';
  return {
    status,
    baseUrl: isOfficialWechatBaseUrl(candidate) ? candidate : currentBaseUrl,
    terminal: status === 'connected' || status === 'expired' || status === 'error',
  };
}
