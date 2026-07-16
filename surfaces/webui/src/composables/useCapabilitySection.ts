import { computed, inject, type ComputedRef, type InjectionKey } from 'vue';

export const activeCapabilitySectionKey: InjectionKey<Readonly<ComputedRef<string>>> = Symbol('active-capability-section');

export function useCapabilitySection() {
  const activeSection = inject(activeCapabilitySectionKey, computed(() => ''));
  const isSectionActive = (sectionId: string) => !activeSection.value || activeSection.value === sectionId;
  return { activeSection, isSectionActive };
}
