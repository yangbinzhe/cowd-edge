import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalClipboard === undefined) {
      delete (navigator as any).clipboard;
    } else {
      Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
    }
    Object.defineProperty(document, 'execCommand', { value: originalExecCommand, configurable: true });
  });

  it('writes the exact source text through the async Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const ok = await copyTextToClipboard('analysis README.md');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('analysis README.md');
  });

  it('falls back to a legacy textarea copy when the Clipboard API is unavailable', async () => {
    delete (navigator as any).clipboard;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const remove = vi.spyOn(HTMLTextAreaElement.prototype, 'remove');

    const ok = await copyTextToClipboard('branch from here');

    expect(ok).toBe(true);
    expect(appendChild).toHaveBeenCalledTimes(1);
    const textarea = appendChild.mock.calls[0][0] as HTMLTextAreaElement;
    expect(textarea.value).toBe('branch from here');
    expect(textarea.getAttribute('readonly')).toBe('');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('returns false for empty text and reports failed fallback copies', async () => {
    expect(await copyTextToClipboard('')).toBe(false);
    expect(await copyTextToClipboard('   ')).toBe(false);

    delete (navigator as any).clipboard;
    Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    expect(await copyTextToClipboard('cannot copy')).toBe(false);
  });
});
