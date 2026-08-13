import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const MAX_UNSTABLE_TAIL_CHARS = 16 * 1024;

export type MarkdownRenderResult = {
  html: string;
  stableBlockCount: number;
  hiddenTailChars: number;
  canonical: boolean;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function stableBoundary(value: string) {
  let offset = 0;
  let lastBoundary = 0;
  let fence: '`' | '~' | null = null;
  let fenceLength = 0;
  for (const line of value.matchAll(/.*(?:\n|$)/g)) {
    const text = line[0];
    if (!text) continue;
    const marker = text.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      const kind = marker[1][0] as '`' | '~';
      if (!fence) {
        fence = kind;
        fenceLength = marker[1].length;
      } else if (fence === kind && marker[1].length >= fenceLength) {
        fence = null;
        fenceLength = 0;
      }
    }
    offset += text.length;
    if (!fence && /^\s*\n$/.test(text)) lastBoundary = offset;
  }
  return lastBoundary;
}

function splitStableBlocks(value: string) {
  return value.match(/[\s\S]*?(?:\n\s*\n|$)/g)?.filter(Boolean) || [];
}

export class StreamingMarkdownRenderer {
  private source = '';
  private stableSource = '';
  private stableHtml: string[] = [];
  private parseCountValue = 0;

  get parseCount() {
    return this.parseCountValue;
  }

  reset() {
    this.source = '';
    this.stableSource = '';
    this.stableHtml = [];
    this.parseCountValue = 0;
  }

  render(content: string, streaming: boolean): MarkdownRenderResult {
    const source = content || '';
    if (!streaming) {
      this.source = source;
      this.stableSource = source;
      this.stableHtml = [];
      this.parseCountValue += 1;
      return {
        html: markdown.render(source),
        stableBlockCount: 0,
        hiddenTailChars: 0,
        canonical: true,
      };
    }

    if (!source.startsWith(this.source) || !source.startsWith(this.stableSource)) {
      this.reset();
    }
    this.source = source;
    const pending = source.slice(this.stableSource.length);
    const boundary = stableBoundary(pending);
    if (boundary > 0) {
      const stable = pending.slice(0, boundary);
      for (const block of splitStableBlocks(stable)) {
        this.stableHtml.push(markdown.render(block));
        this.parseCountValue += 1;
      }
      this.stableSource += stable;
    }

    const tail = source.slice(this.stableSource.length);
    const visibleTail = tail.slice(-MAX_UNSTABLE_TAIL_CHARS);
    const hiddenTailChars = tail.length - visibleTail.length;
    const tailHtml = visibleTail
      ? `<div class="markdown-stream-tail" data-hidden-chars="${hiddenTailChars}">${escapeHtml(visibleTail)}</div>`
      : '';
    return {
      html: `${this.stableHtml.join('')}${tailHtml}`,
      stableBlockCount: this.stableHtml.length,
      hiddenTailChars,
      canonical: false,
    };
  }
}

export function renderCanonicalMarkdown(content: string) {
  return markdown.render(content || '');
}

export const streamingMarkdownLimits = {
  maxUnstableTailChars: MAX_UNSTABLE_TAIL_CHARS,
};
