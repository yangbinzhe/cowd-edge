import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../apps/fixtures/catalog-single.json';
import { parseAppCatalog } from '../../apps/catalog';
import AppPage from './AppPage.vue';
import { setLocale } from '../../i18n';

describe('AppPage', () => {
  beforeEach(() => setLocale('en-US'));
  it('loads a sandboxed static surface while a lazy worker is idle', () => {
    const entry = parseAppCatalog(fixture).apps[0];
    const wrapper = mount(AppPage, { props: {
      entry, protocolDigest: fixture.protocol_digest, catalogGeneration: fixture.catalog_generation,
    } });
    const frame = wrapper.get('iframe');
    expect(frame.attributes('src')).toBe('/apps/reference-app/index.html');
    expect(frame.attributes('sandbox')).toBe('allow-scripts allow-forms allow-downloads');
    expect(frame.attributes('referrerpolicy')).toBe('origin');
    expect(wrapper.text()).toContain('Granted capabilities');
    expect(wrapper.text()).toContain('reference.read');
    wrapper.unmount();
  });

  it('keeps a compatible static surface available after worker failure', () => {
    const input = structuredClone(fixture);
    input.apps[0].lifecycle.state = 'failed';
    input.apps[0].lifecycle.retryable = true;
    const wrapper = mount(AppPage, { props: {
      entry: parseAppCatalog(input).apps[0], protocolDigest: input.protocol_digest,
      catalogGeneration: input.catalog_generation,
    } });
    expect(wrapper.find('iframe').exists()).toBe(true);
    expect(wrapper.text()).toContain('Unavailable');
    wrapper.unmount();
  });

  it('does not load an incompatible surface', () => {
    const input = structuredClone(fixture);
    input.apps[0].lifecycle.state = 'protocol_incompatible';
    input.apps[0].compatibility.status = 'protocol_incompatible';
    const wrapper = mount(AppPage, { props: {
      entry: parseAppCatalog(input).apps[0], protocolDigest: input.protocol_digest,
      catalogGeneration: input.catalog_generation,
    } });
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.text()).toContain('Web surface unavailable');
    wrapper.unmount();
  });
});
