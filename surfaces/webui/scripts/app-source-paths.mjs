import fs from 'node:fs';
import path from 'node:path';

export const webuiRoot = path.resolve(new URL('../', import.meta.url).pathname);

export function appCheckoutRoot(appId) {
  const root = path.join(webuiRoot, '.cowd', 'apps', appId);
  if (!fs.existsSync(root)) {
    throw new Error(`APP ${appId} source is not staged; run npm run apps:sync first`);
  }
  return root;
}

export function appRepositoryPath(appId, ...segments) {
  return path.join(appCheckoutRoot(appId), ...segments);
}

export function appWebUiSourceRoot(appId) {
  return appRepositoryPath(appId, 'webui', 'src');
}

export function appWebUiPath(appId, ...segments) {
  return path.join(appWebUiSourceRoot(appId), ...segments);
}

export function relativeToWebUi(file) {
  return path.relative(webuiRoot, file);
}
