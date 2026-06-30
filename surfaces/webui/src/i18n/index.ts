import { computed, ref, watch, type App } from 'vue';
import { translatePattern, zhText, type Locale } from './catalog';

export type { Locale } from './catalog';

const LOCALE_KEY = 'cowd.webui.locale';
const ATTRIBUTES = ['aria-label', 'title', 'placeholder'] as const;
const rawText = new WeakMap<Text, string>();
const rawAttrs = new WeakMap<Element, Map<string, string>>();
let observer: MutationObserver | null = null;
let translating = false;

function browserLocale(): Locale {
  if (typeof window === 'undefined') return 'en-US';
  const stored = window.localStorage?.getItem(LOCALE_KEY);
  if (stored === 'zh-CN' || stored === 'en-US') return stored;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language?.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en-US';
}

export const locale = ref<Locale>(browserLocale());
export const isChinese = computed(() => locale.value === 'zh-CN');

function splitOuterWhitespace(value: string) {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return {
    leading: match?.[1] || '',
    body: match?.[2] || value,
    trailing: match?.[3] || '',
  };
}

function translateBody(value: string): string {
  if (!value) return value;
  const exact = zhText[value];
  if (exact) return exact;
  const patterned = translatePattern(value, translateBody);
  return patterned || value;
}

export function translateText(value: unknown): string {
  const source = String(value ?? '');
  if (locale.value !== 'zh-CN') return source;
  const { leading, body, trailing } = splitOuterWhitespace(source);
  return `${leading}${translateBody(body)}${trailing}`;
}

export function translateStatus(value: unknown): string {
  return translateText(String(value ?? 'unknown'));
}

export function setLocale(next: Locale) {
  locale.value = next;
  if (typeof window !== 'undefined') window.localStorage?.setItem(LOCALE_KEY, next);
  applyDocumentLocale();
}

export function useI18n() {
  return {
    locale,
    isChinese,
    setLocale,
    t: translateText,
    status: translateStatus,
  };
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  const tag = parent.tagName;
  if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(tag)) return true;
  return Boolean(parent.closest('.markdown-body, .raw-payload-body, .skill-markdown, pre, code'));
}

function translateTextNode(node: Text) {
  if (shouldSkipTextNode(node)) return;
  if (!rawText.has(node)) rawText.set(node, node.textContent || '');
  const source = rawText.get(node) || '';
  const next = translateText(source);
  if (node.textContent !== next) node.textContent = next;
}

function translateElementAttributes(element: Element) {
  if (element.closest('.markdown-body, .raw-payload-body, .skill-markdown, pre, code')) return;
  let store = rawAttrs.get(element);
  if (!store) {
    store = new Map();
    rawAttrs.set(element, store);
  }
  ATTRIBUTES.forEach((attribute) => {
    if (!element.hasAttribute(attribute)) return;
    if (!store.has(attribute)) store.set(attribute, element.getAttribute(attribute) || '');
    const source = store.get(attribute) || '';
    const next = translateText(source);
    if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
  });
}

function walk(root: ParentNode) {
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode) {
    translateTextNode(textNode as Text);
    textNode = textWalker.nextNode();
  }

  if (root instanceof Element) translateElementAttributes(root);
  const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let element = elementWalker.nextNode();
  while (element) {
    translateElementAttributes(element as Element);
    element = elementWalker.nextNode();
  }
}

export function applyDomI18n(root: ParentNode = document.body) {
  if (typeof document === 'undefined' || !root) return;
  translating = true;
  try {
    walk(root);
  } finally {
    translating = false;
  }
}

function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale.value === 'zh-CN' ? 'zh-CN' : 'en';
  document.documentElement.dataset.locale = locale.value;
  applyDomI18n();
}

export function installDomI18n(_app?: App) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  applyDocumentLocale();
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (translating) return;
    const roots = new Set<ParentNode>();
    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData') {
        const node = mutation.target as Text;
        rawText.set(node, node.textContent || '');
        roots.add(node.parentElement || document.body);
      } else if (mutation.type === 'attributes') {
        const element = mutation.target as Element;
        const attr = mutation.attributeName || '';
        const store = rawAttrs.get(element);
        if (store && ATTRIBUTES.includes(attr as any)) store.set(attr, element.getAttribute(attr) || '');
        roots.add(element);
      } else {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            roots.add(node.parentNode || document.body);
          }
        });
      }
    });
    roots.forEach((root) => applyDomI18n(root));
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTES],
  });
}

watch(locale, applyDocumentLocale);
