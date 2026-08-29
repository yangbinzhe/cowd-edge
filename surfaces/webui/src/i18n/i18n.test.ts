import { afterEach, describe, expect, it } from 'vitest';
import { formatCount, setLocale, t } from './index';
import { displayStatus } from './domain/status';

describe('WebUI i18n', () => {
  afterEach(() => setLocale('zh-CN'));

  it('uses explicit keys for Chinese interface text', () => {
    setLocale('zh-CN');
    expect(t('term.missionControl')).toBe('任务控制台');
    expect(t('term.tool')).toBe('工具');
    expect(t('requestReceipt.endpoint')).toBe('端点');
  });

  it('keeps English interface text separate', () => {
    setLocale('en-US');
    expect(t('term.missionControl')).toBe('Mission Control');
    expect(t('term.tool')).toBe('Tool');
    expect(t('requestReceipt.endpoint')).toBe('Endpoint');
  });

  it('formats common dynamic counts and runtime statuses', () => {
    setLocale('zh-CN');
    expect(formatCount('events', 12)).toBe('12 事件');
    expect(formatCount('tools', 3)).toBe('3 工具');
    expect(formatCount('agents', 2)).toBe('2 Agent');
    expect(formatCount('grants', 4)).toBe('4 授权');
    expect(formatCount('tokens', 128)).toBe('128 Token');
    expect(displayStatus('running')).toBe('运行中');
    expect(displayStatus('materializing')).toBe('同步执行数据');
  });
});
