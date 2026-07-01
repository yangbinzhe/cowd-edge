import { fileNameOf } from './workspaceTree';
import MarkdownIt from 'markdown-it';

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

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

function escapeHtml(value: string) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWorkspacePreviewHtml(path: string, content: string, sourceFirst = false) {
  const kind = workspacePreviewKind(path);
  const title = escapeHtml(fileNameOf(path));
  const source = escapeHtml(content);
  const rendered = kind === 'markdown'
    ? markdown.render(content || '')
    : kind === 'web'
      ? content
      : `<pre>${source}</pre>`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;background:#f6f7f9;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:2;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #d8dee8;background:#fff}
main{max-width:1040px;margin:0 auto;padding:28px;background:#fff;min-height:100vh}
button{border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#1f2937;padding:6px 10px}
pre{white-space:pre-wrap;overflow:auto;background:#0f172a;color:#dbeafe;border-radius:8px;padding:16px;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
table{width:100%;border-collapse:collapse;margin:16px 0;display:block;overflow:auto}
th,td{border:1px solid #d8dee8;padding:8px 10px;text-align:left}
th{background:#f1f5f9}
blockquote{margin:14px 0;padding:10px 14px;border-left:4px solid #64748b;background:#f8fafc}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:4px;padding:1px 4px}
img{max-width:100%;height:auto}
.source #rendered{display:none}.source #source{display:block}#source{display:none}
</style>
</head>
<body class="${sourceFirst ? 'source' : ''}">
<header><strong>${title}</strong><button type="button" onclick="document.body.classList.toggle('source')">Render / Source</button></header>
<main><section id="rendered">${rendered}</section><section id="source"><pre>${source}</pre></section></main>
</body>
</html>`;
}
