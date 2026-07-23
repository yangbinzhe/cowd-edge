import type { Component } from 'vue';

export type CowdWebUiLocale = 'zh-CN' | 'en-US';

export interface CowdWebUiAppSection {
  id: string;
  labelKey: string;
  descriptionKey: string;
  displayMode?: 'summary' | 'detail' | 'table' | 'graph' | 'timeline' | 'governance' | 'queue' | 'form' | 'reader';
  density?: 'compact' | 'standard' | 'inspect';
  primaryObject?: string;
}

export interface CowdWebUiAppAction {
  labelKey: string;
  kind: 'primary' | 'secondary';
  endpoint: string;
}

/**
 * 外部 APP 在构建期静态装配到 Edge 的最小 WebUI 合同。
 * 不包含 Edge 私有 store、私有路由或部署信息。
 */
export interface CowdWebUiAppContribution {
  appId: string;
  route: string;
  navigation: {
    titleKey: string;
    icon: string;
    group: string;
  };
  readiness: {
    appApi: string;
    contractApi: string;
    requiredCapabilities: string[];
  };
  capability: {
    titleKey: string;
    subtitleKey: string;
    sections: CowdWebUiAppSection[];
    actions: CowdWebUiAppAction[];
    inspector: Array<{ labelKey: string; value: string }>;
  };
  messages: Record<CowdWebUiLocale, Record<string, string>>;
  page: () => Promise<{ default: Component }>;
}
