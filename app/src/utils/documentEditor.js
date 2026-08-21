export function applyMarkdownCommand(content, start, end, command) {
  const selected = content.slice(start, end)
  const wrap = (before, after = before, placeholder = 'text') => {
    const value = selected || placeholder
    return { content: content.slice(0, start) + before + value + after + content.slice(end), start: start + before.length, end: start + before.length + value.length }
  }
  const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const prefix = (value) => ({ content: content.slice(0, lineStart) + value + content.slice(lineStart), start: start + value.length, end: end + value.length })
  const block = (value) => ({ content: content.slice(0, start) + value + content.slice(end), start: start + value.indexOf(selected || '') , end: start + value.length })
  if (command === 'bold') return wrap('**')
  if (command === 'italic') return wrap('_')
  if (command === 'strike') return wrap('~~')
  if (command === 'code') return wrap('`')
  if (command === 'link') return wrap('[', '](https://)', 'label')
  if (command === 'h1') return prefix('# ')
  if (command === 'h2') return prefix('## ')
  if (command === 'h3') return prefix('### ')
  if (command === 'bullet') return prefix('- ')
  if (command === 'numbered') return prefix('1. ')
  if (command === 'checklist') return prefix('- [ ] ')
  if (command === 'quote') return prefix('> ')
  if (command === 'codeblock') return block(`\`\`\`\n${selected || 'code'}\n\`\`\``)
  if (command === 'divider') return block('\n---\n')
  if (command === 'table') return block('\n| Column | Column |\n| --- | --- |\n| Value | Value |\n')
  if (command === 'date') return block(new Date().toISOString().slice(0, 10))
  return { content, start, end }
}

export function headingSlug(value) {
  return value.toLowerCase().trim().replace(/[`*_~()[\]{}]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'
}

export function documentHeadings(content) {
  const seen = new Map()
  const headings = []
  const pattern = /^(#{1,6})\s+(.+?)\s*#*$/gm
  let match
  while ((match = pattern.exec(content))) {
    const base = headingSlug(match[2]); const count = seen.get(base) || 0; seen.set(base, count + 1)
    headings.push({ level: match[1].length, title: match[2].trim(), slug: count ? `${base}-${count + 1}` : base, start: match.index, end: pattern.lastIndex })
  }
  return headings
}

export function slashCommandAt(content, cursor) {
  const lineStart = content.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const fragment = content.slice(lineStart, cursor)
  if (!fragment.startsWith('/') || fragment.includes(' ')) return null
  return { query: fragment.slice(1).toLowerCase(), start: lineStart, end: cursor }
}
