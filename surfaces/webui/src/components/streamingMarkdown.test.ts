import { describe, expect, it } from 'vitest';
import {
  renderCanonicalMarkdown,
  StreamingMarkdownRenderer,
  streamingMarkdownLimits,
} from './streamingMarkdown';

describe('StreamingMarkdownRenderer', () => {
  it('parses each completed block once while the unsafe tail grows', () => {
    const renderer = new StreamingMarkdownRenderer();
    renderer.render('# Heading\n\nunfinished', true);
    const afterFirstBlock = renderer.parseCount;
    renderer.render('# Heading\n\nunfinished tail', true);
    renderer.render('# Heading\n\nunfinished tail grows', true);

    expect(afterFirstBlock).toBe(1);
    expect(renderer.parseCount).toBe(afterFirstBlock);
    const rendered = renderer.render('# Heading\n\nunfinished tail grows again', true);
    expect(rendered.stableHtml).toContain('<h1>Heading</h1>');
    expect(rendered.visibleTail).toBe('unfinished tail grows again');
  });

  it('keeps an open fence escaped and bounded until completion', () => {
    const renderer = new StreamingMarkdownRenderer();
    const source = `\`\`\`html\n${'<script>alert(1)</script>\n'.repeat(1_000)}`;
    const result = renderer.render(source, true);

    expect(result.canonical).toBe(false);
    expect(result.hiddenTailChars).toBeGreaterThan(0);
    expect(result.html).not.toContain('<script>');
    expect(result.html.length).toBeLessThan(streamingMarkdownLimits.maxUnstableTailChars * 2);
  });

  it('replaces the streaming representation with the canonical final parse', () => {
    const renderer = new StreamingMarkdownRenderer();
    const source = [
      '# Report',
      '',
      '| Item | Value |',
      '| --- | ---: |',
      '| latency | 12 |',
      '',
      '```diff',
      '+fast',
      '```',
      '',
      '[reference](https://example.com)',
    ].join('\n');
    renderer.render(source.slice(0, -10), true);
    const final = renderer.render(source, false);

    expect(final.canonical).toBe(true);
    expect(final.html).toBe(renderCanonicalMarkdown(source));
    expect(final.html).toContain('<table>');
  });

  it('handles ten thousand completed lines without reparsing prior blocks', () => {
    const renderer = new StreamingMarkdownRenderer();
    const source = `${Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join('\n')}\n\n`;
    renderer.render(source, true);
    const parses = renderer.parseCount;
    renderer.render(`${source}tail`, true);
    expect(parses).toBe(1);
    expect(renderer.parseCount).toBe(parses);
  });
});
