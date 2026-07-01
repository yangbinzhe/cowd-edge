export type ToolNoticeFormatter = (toolName: string, outcome: 'completed' | 'failed') => string;

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

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
