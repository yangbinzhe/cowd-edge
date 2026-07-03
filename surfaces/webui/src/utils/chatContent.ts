export type ToolNoticeFormatter = (toolName: string, outcome: 'completed' | 'failed') => string;

function comparableText(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function collapseRepeatedParts(parts: string[], separator: string) {
  const cleaned = parts.map((part) => part.trim()).filter(Boolean);
  if (cleaned.length < 2) return '';
  const comparable = cleaned.map(comparableText);
  for (let unitSize = 1; unitSize <= Math.floor(cleaned.length / 2); unitSize += 1) {
    if (cleaned.length % unitSize !== 0) continue;
    const unit = comparable.slice(0, unitSize);
    let repeated = true;
    for (let index = unitSize; index < comparable.length; index += 1) {
      if (comparable[index] !== unit[index % unitSize]) {
        repeated = false;
        break;
      }
    }
    if (repeated) return cleaned.slice(0, unitSize).join(separator).trim();
  }
  return '';
}

export function collapseRepeatedText(content: string) {
  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return text;
  if (text.length >= 80) {
    for (let copies = 2; copies <= 6; copies += 1) {
      if (text.length % copies !== 0) continue;
      const size = text.length / copies;
      const chunk = text.slice(0, size);
      if (chunk.trim() && chunk.repeat(copies) === text) return chunk.trim();
    }
  }
  const paragraphCollapsed = collapseRepeatedParts(text.split(/\n{2,}/), '\n\n');
  if (paragraphCollapsed) return paragraphCollapsed;
  const lineCollapsed = collapseRepeatedParts(text.split('\n'), '\n');
  if (lineCollapsed && comparableText(lineCollapsed).length >= 60) return lineCollapsed;
  return text;
}

function skipJsonSummary(lines: string[], startIndex: number) {
  let index = startIndex;
  let depth = 0;
  let started = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!started && !line.trim()) break;
    const opens = (line.match(/[\[{]/g) || []).length;
    const closes = (line.match(/[\]}]/g) || []).length;
    depth += opens - closes;
    started = started || opens > 0;
    if (started && depth <= 0) return index;
    if (!started && index > startIndex) return index - 1;
  }
  return startIndex;
}

export function cleanAssistantContent(content: string, formatToolNotice: ToolNoticeFormatter = (tool, outcome) => `Tool ${tool} ${outcome}. Evidence is available in the evidence panel.`) {
  if (!content) return content;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const toolMatch = line.match(/^\s*Tool\s+(.+?)\s+(completed|failed)\.\s*(?:Raw evidence ref:.*)?$/i);
    if (toolMatch && (/Raw evidence ref:/i.test(line) || /^\s*Tool\s+.+?\s+(?:completed|failed)\.\s*$/i.test(line))) {
      const toolName = toolMatch[1].trim();
      const outcome = toolMatch[2].toLowerCase() === 'failed' ? 'failed' : 'completed';
      const notice = formatToolNotice(toolName, outcome);
      if (output[output.length - 1] !== notice) output.push(notice);
      const next = lines[index + 1] || '';
      if (/^\s*Summary:\s*[\[{]/i.test(next)) index = skipJsonSummary(lines, index + 1);
      continue;
    }

    if (/^\s*Raw evidence ref:/i.test(line)) continue;
    output.push(line);
  }

  return collapseRepeatedText(output.join('\n').replace(/\n{3,}/g, '\n\n'));
}
