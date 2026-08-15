import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import MarkdownBlock from './MarkdownBlock.vue';

describe('MarkdownBlock streaming DOM', () => {
  it('updates only the plain-text tail while completed Markdown stays mounted', async () => {
    const wrapper = mount(MarkdownBlock, {
      props: { content: '# Result\n\npartial', streaming: true },
    });
    const stable = wrapper.get('.markdown-stable-blocks').element;
    const stableMarkup = wrapper.get('.markdown-stable-blocks').html();
    let stableMutations = 0;
    const observer = new MutationObserver((records) => {
      stableMutations += records.length;
    });
    observer.observe(stable, { childList: true, subtree: true, characterData: true });

    await wrapper.setProps({ content: '# Result\n\npartial answer grows' });
    await Promise.resolve();

    expect(wrapper.get('.markdown-stable-blocks').element).toBe(stable);
    expect(wrapper.get('.markdown-stable-blocks').html()).toBe(stableMarkup);
    expect(wrapper.get('.markdown-stream-tail').text()).toBe('partial answer grows');
    expect(stableMutations).toBe(0);
    observer.disconnect();
  });

  it('switches once to canonical Markdown after streaming completes', async () => {
    const wrapper = mount(MarkdownBlock, {
      props: { content: '**done**', streaming: true },
    });
    expect(wrapper.get('.markdown-stream-tail').text()).toBe('**done**');

    await wrapper.setProps({ streaming: false });

    expect(wrapper.find('.markdown-stream-tail').exists()).toBe(false);
    expect(wrapper.html()).toContain('<strong>done</strong>');
  });
});
