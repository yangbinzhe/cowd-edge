import { fileNameOf } from './workspaceTree';

export type WorkspacePreviewKind =
  | 'markdown'
  | 'structured'
  | 'web'
  | 'text'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'binary';

const markdownExt = new Set(['md', 'markdown', 'mdx']);
const structuredExt = new Set(['json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv']);
const webExt = new Set(['html', 'htm', 'xhtml', 'svg']);
const textExt = new Set([
  'txt', 'log', 'rs', 'ts', 'tsx', 'js', 'jsx', 'vue', 'css', 'scss', 'sass', 'less',
  'py', 'go', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh', 'fish',
  'sql', 'ini', 'conf', 'env', 'gitignore', 'dockerfile', 'lock', 'gradle', 'rb',
  'php', 'swift', 'kt', 'kts', 'lua', 'r', 'pl', 'ps1',
]);
const imageExt = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']);
const pdfExt = new Set(['pdf']);
const audioExt = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']);
const videoExt = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

export function workspaceFileExtension(path: string) {
  const name = fileNameOf(path).toLowerCase();
  if (name === 'dockerfile' || name === 'makefile') return name;
  const parts = name.split('.');
  return parts.length > 1 ? parts.at(-1) || '' : '';
}

export function workspacePreviewKind(path: string): WorkspacePreviewKind {
  const ext = workspaceFileExtension(path);
  if (markdownExt.has(ext)) return 'markdown';
  if (structuredExt.has(ext)) return 'structured';
  if (webExt.has(ext)) return 'web';
  if (imageExt.has(ext)) return 'image';
  if (pdfExt.has(ext)) return 'pdf';
  if (audioExt.has(ext)) return 'audio';
  if (videoExt.has(ext)) return 'video';
  if (textExt.has(ext) || !ext) return 'text';
  return 'binary';
}

export function isWorkspaceTextPreview(path: string) {
  return ['markdown', 'structured', 'web', 'text'].includes(workspacePreviewKind(path));
}

export function isWorkspaceEditablePreview(path: string) {
  return isWorkspaceTextPreview(path);
}

export function workspacePreviewMime(path: string) {
  const ext = workspaceFileExtension(path);
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'text/html';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'css') return 'text/css';
  if (ext === 'js' || ext === 'jsx') return 'text/javascript';
  if (ext === 'json' || ext === 'jsonl') return 'application/json';
  if (ext === 'xml') return 'application/xml';
  if (ext === 'csv') return 'text/csv';
  if (ext === 'pdf') return 'application/pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'].includes(ext)) return `audio/${ext === 'm4a' ? 'mp4' : ext}`;
  if (['mp4', 'webm', 'mov', 'm4v', 'ogv'].includes(ext)) return `video/${ext === 'mov' || ext === 'm4v' ? 'mp4' : ext}`;
  return 'text/plain';
}
