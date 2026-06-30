import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, translateStatus, translateText } from './index';

describe('WebUI i18n', () => {
  afterEach(() => setLocale('en-US'));

  it('translates core navigation and operational labels to Chinese', () => {
    setLocale('zh-CN');
    expect(translateText('Mission Control')).toBe('任务控制');
    expect(translateText('Tools Registry')).toBe('工具注册表');
    expect(translateText('Gateway access')).toBe('Gateway 访问');
  });

  it('keeps English source text available when locale is English', () => {
    setLocale('en-US');
    expect(translateText('Mission Control')).toBe('Mission Control');
  });

  it('handles common dynamic counts and runtime statuses', () => {
    setLocale('zh-CN');
    expect(translateText('12 events')).toBe('12 事件');
    expect(translateText('3 tools')).toBe('3 工具');
    expect(translateText('Refresh runtime completed')).toBe('刷新运行时 已完成');
    expect(translateStatus('running')).toBe('运行中');
  });
});
