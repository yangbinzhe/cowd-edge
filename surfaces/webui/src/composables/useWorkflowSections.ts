export function scrollToWorkflowSection(id: string) {
  document.querySelector(`[data-section="${id}"], #${id}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}
