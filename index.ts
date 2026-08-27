#!/usr/bin/env node
import blessed from 'blessed';
import fs from 'fs';
import path from 'path';
import figlet from 'figlet';

const screen = blessed.screen({
  smartCSR: true,
  title: 'Notes App',
  fullUnicode: true
});

let file: string | null = null;
let lines: string[] = [''];
let row = 0;
let column = 0;
let scroll = 0;
let selector = false;
let language = 0;
let clipboard = '';
let start: {line: number, col: number} | null = null;
let end: {line: number, col: number} | null = null;
let cache: {startLine: number, endLine: number, lang: string}[] = [];
let dirty = true;

const args = process.argv.slice(2);
if (args.length > 0) {
  file = path.resolve(args[0]);
  
  screen.title = `Notes App - ${path.basename(file)}`;
  
  if (fs.existsSync(file)) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      lines = content.split('\n');
      if (lines.length === 0) {
        lines = [''];
      }
    } catch (err) {
      lines = [`Error loading file: ${err instanceof Error ? err.message : String(err)}`];
      bar.setContent(' Error: Could not read file');
    }
  } else {
    lines = [''];
  }
}

const languages = [
  'JavaScript', 'TypeScript'
];

function esc(text: string): string {
  return text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

const STATUS = ' Ctrl+Q: Quit | Ctrl+S: Save | Ctrl+V: Paste | ESC: Copy';
let timeout: NodeJS.Timeout | null = null;

function status(message: string, duration: number = 2000) {
  if (timeout) {
    clearTimeout(timeout);
  }
  
  bar.setContent(message);
  screen.render();
  
  timeout = setTimeout(() => {
    bar.setContent(STATUS);
    screen.render();
    timeout = null;
  }, duration);
}

function rebuild() {
  cache = [];
  let inBlock = false;
  let blockStart = -1;
  let blockLang = '';
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('"""') && lines[i].length > 3) {
      if (!inBlock) {
        inBlock = true;
        blockStart = i;
        blockLang = lines[i].substring(3).trim();
      } else {
        cache.push({startLine: blockStart, endLine: i, lang: blockLang});
        inBlock = false;
      }
    } else if (lines[i] === '"""') {
      if (!inBlock) {
        inBlock = true;
        blockStart = i;
        blockLang = '';
      } else {
        cache.push({startLine: blockStart, endLine: i, lang: blockLang});
        inBlock = false;
      }
    }
  }
  
  dirty = false;
}

function info(index: number): {inBlock: boolean, lang: string} {
  if (dirty) {
    rebuild();
  }
  
  for (const block of cache) {
    if (index > block.startLine && index < block.endLine) {
      return {inBlock: true, lang: block.lang};
    }
  }
  
  return {inBlock: false, lang: ''};
}

const editor = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%-1',
  scrollable: false,
  keys: true,
  mouse: true,
  tags: true,
  style: {
    fg: 'white',
    bg: 'black'
  }
});

const bar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  content: STATUS,
  style: {
    fg: 'black',
    bg: 'white'
  }
});

const popup = blessed.list({
  parent: screen,
  left: 'center',
  top: 'center',
  width: 40,
  height: 15,
  border: {
    type: 'line'
  },
  style: {
    fg: 'white',
    bg: 'black',
    border: {
      fg: 'cyan'
    },
    selected: {
      bg: 'blue',
      fg: 'white'
    }
  },
  keys: true,
  vi: true,
  mouse: true,
  hidden: true,
  label: ' Select Language '
});

function colorize(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//')) {
    return `{gray-fg}${line}{/gray-fg}`;
  }
  
  const position = line.indexOf('//');
  if (position !== -1) {
    const before = line.substring(0, position);
    const comment = line.substring(position);
    return highlight(before) + `{gray-fg}${comment}{/gray-fg}`;
  }
  
  return highlight(line);
}

function highlight(line: string): string {
  const tokens: Array<{text: string, color: string}> = [];
  let i = 0;
  
  while (i < line.length) {
    let matched = false;
    
    if (/\s/.test(line[i])) {
      tokens.push({text: esc(line[i]), color: 'white'});
      i++;
      continue;
    }
    
    if (line[i] === '`') {
      let j = i + 1;
      let inInterpolation = false;
      while (j < line.length) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === '$' && line[j + 1] === '{') {
          inInterpolation = true;
        }
        if (inInterpolation && line[j] === '}') {
          inInterpolation = false;
        }
        if (line[j] === '`' && !inInterpolation) {
          break;
        }
        j++;
      }
      tokens.push({text: esc(line.substring(i, j + 1)), color: 'yellow'});
      i = j + 1;
      matched = true;
    }
    
    else if (line[i] === '"' || line[i] === "'") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++;
        j++;
      }
      tokens.push({text: esc(line.substring(i, j + 1)), color: 'yellow'});
      i = j + 1;
      matched = true;
    }
    
    else if (line[i] === '/' && i > 0) {
      const before = line.substring(0, i).trim();
      const regexTriggers = ['=', '(', '[', ',', 'return', ':', ';', '!', '&', '|', '?', '+', '-', '*', '%', '^', '~'];
      const canBeRegex = regexTriggers.some(t => before.endsWith(t));
      
      if (canBeRegex) {
        let j = i + 1;
        let inCharClass = false;
        while (j < line.length) {
          if (line[j] === '\\') {
            j += 2;
            continue;
          }
          if (line[j] === '[') inCharClass = true;
          if (line[j] === ']') inCharClass = false;
          if (line[j] === '/' && !inCharClass) {
            j++;
            while (j < line.length && /[gimsuvy]/.test(line[j])) j++;
            break;
          }
          j++;
        }
        tokens.push({text: esc(line.substring(i, j)), color: 'red'});
        i = j;
        matched = true;
      }
    }
    
    else if (/\d/.test(line[i]) || (line[i] === '.' && /\d/.test(line[i + 1]))) {
      let j = i;
      if (line[j] === '0' && /[xXbBoO]/.test(line[j + 1])) {
        j += 2;
        while (j < line.length && /[0-9a-fA-F]/.test(line[j])) j++;
      } else {
        let hasDecimal = line[i] === '.';
        if (hasDecimal) j++;
        
        while (j < line.length && /\d/.test(line[j])) j++;
        
        if (!hasDecimal && line[j] === '.' && /\d/.test(line[j + 1])) {
          j++;
          while (j < line.length && /\d/.test(line[j])) j++;
        }
        
        if (line[j] === 'e' || line[j] === 'E') {
          j++;
          if (line[j] === '+' || line[j] === '-') j++;
          while (j < line.length && /\d/.test(line[j])) j++;
        }
        if (line[j] === 'n') j++;
      }
      tokens.push({text: esc(line.substring(i, j)), color: 'green'});
      i = j;
      matched = true;
    }
    
    else if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.substring(i, j);
      
      const keywords = [
        'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 
        'class', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 
        'new', 'this', 'super', 'extends', 'static', 'get', 'set', 'typeof', 
        'instanceof', 'void', 'delete', 'in', 'of', 'yield', 'break', 'continue', 
        'switch', 'case', 'default', 'do', 'throw', 'null', 'undefined', 'true', 
        'false', 'finally', 'with', 'debugger', 'implements', 'interface', 'package',
        'private', 'protected', 'public', 'enum'
      ];
      const builtins = [
        'console', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 
        'Date', 'RegExp', 'Promise', 'JSON', 'Error', 'window', 'document', 
        'process', 'Buffer', 'module', 'require', 'exports', 'Set', 'Map',
        'WeakSet', 'WeakMap', 'Symbol', 'BigInt', 'Infinity', 'NaN', 'parseInt',
        'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI'
      ];
      
      if (keywords.includes(word)) {
        tokens.push({text: esc(word), color: 'magenta'});
        i = j;
        matched = true;
      } else if (builtins.includes(word)) {
        tokens.push({text: esc(word), color: 'cyan'});
        i = j;
        matched = true;
      } else {
        let k = j;
        while (k < line.length && /\s/.test(line[k])) k++;
        
        if (line[k] === '(') {
          tokens.push({text: esc(word), color: 'blue'});
          i = j;
          matched = true;
        }
        else if (i > 0 && line[i - 1] === '.') {
          tokens.push({text: esc(word), color: 'blue'});
          i = j;
          matched = true;
        }
        else {
          tokens.push({text: esc(word), color: 'white'});
          i = j;
          matched = true;
        }
      }
    }
    
    if (!matched) {
      const char = line[i];
      if ('+-*/%=<>!&|^~?:'.includes(char)) {
        tokens.push({text: esc(char), color: 'white'});
      } else {
        tokens.push({text: esc(char), color: 'white'});
      }
      i++;
    }
  }
  
  let result = '';
  for (const token of tokens) {
    result += `{${token.color}-fg}${token.text}{/${token.color}-fg}`;
  }
  
  return result;
}

function display(line: string, current: boolean, index: number): string {
  if (current) {
    return line;
  }
  
  const block = info(index);
  
  if (line.startsWith('"""') && line.length > 3) {
    const lang = line.substring(3).trim();
    return `{blue-fg}{underline} ${esc(lang)} {/underline}{/blue-fg}`;
  }
  
  if (line === '"""') {
    return '{gray-fg}"""{/gray-fg}';
  }
  
  if (block.inBlock) {
    if (block.lang === 'javascript' || block.lang === 'js' || block.lang === 'typescript' || block.lang === 'ts') {
      return colorize(line);
    }
    return `{green-fg}${esc(line)}{/green-fg}`;
  }
  
  if (line.startsWith('# ')) {
    const text = line.substring(2);
    try {
      const ascii = figlet.textSync(text, {
        font: 'Standard',
        horizontalLayout: 'default'
      });
      return `{bold}{cyan-fg}${esc(ascii)}{/cyan-fg}{/bold}`;
    } catch (err) {
      return `{bold}{cyan-fg}${esc(text)}{/cyan-fg}{/bold}`;
    }
  }
  if (line.startsWith('## ')) {
    const text = line.substring(3);
    return `{bold}{blue-fg}█▓▒░ ${esc(text)} ░▒▓█{/blue-fg}{/bold}`;
  }
  if (line.startsWith('### ')) {
    const text = line.substring(4);
    return `{bold}{magenta-fg}${esc(text)}{/magenta-fg}{/bold}`;
  }
  if (line.match(/^\* |^- |^\+ /)) {
    const text = line.substring(2);
    return `  {yellow-fg}•{/yellow-fg} ${esc(text)}`;
  }
  if (line.startsWith('> ')) {
    const text = line.substring(2);
    return `  {gray-fg}│ ${esc(text)}{/gray-fg}`;
  }
  
  let rendered = esc(line);
  
  rendered = rendered.replace(/\[(.+?)\]\((.+?)\)/g, (match, text, url) => {
    return `{underline}{blue-fg}${text}{/blue-fg}{/underline}`;
  });
  
  rendered = rendered.replace(/\[\[(.+?)\]\]/g, (match, filepath) => {
    const filename = filepath.split('/').pop() || filepath;
    return `{underline}{cyan-fg}${filename}{/cyan-fg}{/underline}`;
  });
  
  rendered = rendered.replace(/==(.+?)==/g, (match, content) => {
    return `{yellow-bg}{black-fg}${content}{/black-fg}{/yellow-bg}`;
  });
  rendered = rendered.replace(/\*\*(.+?)\*\*/g, (match, content) => {
    return `{bold}${content}{/bold}`;
  });
  rendered = rendered.replace(/`(.+?)`/g, (match, content) => {
    return `{black-bg}{green-fg} ${content} {/green-fg}{/black-bg}`;
  });
  
  return rendered;
}

function normal(): {start: {line: number, col: number}, end: {line: number, col: number}} | null {
  if (!start || !end) return null;
  
  const s = {
    line: Math.min(start.line, end.line),
    col: start.line === end.line ? Math.min(start.col, end.col) : 
         start.line < end.line ? start.col : end.col
  };
  const e = {
    line: Math.max(start.line, end.line),
    col: start.line === end.line ? Math.max(start.col, end.col) :
         start.line < end.line ? end.col : start.col
  };
  
  return {start: s, end: e};
}

function draw() {
  const height = editor.height as number - 2;
  let content = '';
  
  const first = Math.max(0, row - Math.floor(height / 2));
  const last = Math.min(lines.length, first + height);
  
  const selection = normal();
  
  for (let i = first; i < last; i++) {
    const current = i === row;
    const raw = lines[i];
    
    let rendered = display(raw, current, i);
    
    if (selection && i >= selection.start.line && i <= selection.end.line) {
      const startCol = i === selection.start.line ? selection.start.col : 0;
      const endCol = i === selection.end.line ? selection.end.col : raw.length;
      
      const before = raw.substring(0, startCol);
      const selected = raw.substring(startCol, endCol);
      const after = raw.substring(endCol);
      
      rendered = esc(before) + `{inverse}${esc(selected)}{/inverse}` + esc(after);
    }
    
    if (current && !selection) {
      const before = rendered.substring(0, column);
      const cursor = rendered[column] || ' ';
      const after = rendered.substring(column + 1);
      content += `${before}{inverse}${cursor}{/inverse}${after}\n`;
    } else {
      content += rendered + '\n';
    }
  }
  
  editor.setContent(content);
  screen.render();
}

function selected(): string {
  const selection = normal();
  if (!selection) return '';
  
  const {start: s, end: e} = selection;
  
  if (s.line === e.line) {
    return lines[s.line].substring(s.col, e.col);
  }
  
  let text = lines[s.line].substring(s.col) + '\n';
  for (let i = s.line + 1; i < e.line; i++) {
    text += lines[i] + '\n';
  }
  text += lines[e.line].substring(0, e.col);
  return text;
}

function remove() {
  const selection = normal();
  if (!selection) return;
  
  const {start: s, end: e} = selection;
  
  if (s.line === e.line) {
    lines[s.line] = lines[s.line].substring(0, s.col) + lines[s.line].substring(e.col);
  } else {
    const newLine = lines[s.line].substring(0, s.col) + lines[e.line].substring(e.col);
    lines.splice(s.line, e.line - s.line + 1, newLine);
  }
  
  row = s.line;
  column = s.col;
  start = null;
  end = null;
  dirty = true;
}

editor.on('keypress', (ch: string, key: any) => {
  if (key.full === 'C-q') {
    screen.destroy();
    process.exit(0);
  }
  
  if (key.full === 'C-c') {
    if (start && end) {
      clipboard = selected();
      start = null;
      end = null;
      status(' Copied to clipboard', 1000);
      draw();
      return;
    } else {
      screen.destroy();
      process.exit(0);
    }
  }
  
  if (key.full === 'C-x') {
    if (start && end) {
      clipboard = selected();
      remove();
      status(' Cut to clipboard', 1000);
      draw();
    }
    return;
  }
  
  if (key.full === 'C-v') {
    if (clipboard) {
      if (start && end) {
        remove();
      }
      
      const normalized = clipboard.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const clipLines = normalized.split('\n');
      
      if (clipLines.length === 1) {
        const line = lines[row];
        lines[row] = line.substring(0, column) + normalized + line.substring(column);
        column += normalized.length;
      } else {
        const line = lines[row];
        const before = line.substring(0, column);
        const after = line.substring(column);
        
        lines[row] = before + clipLines[0];
        for (let i = 1; i < clipLines.length - 1; i++) {
          lines.splice(row + i, 0, clipLines[i]);
        }
        lines.splice(row + clipLines.length - 1, 0, clipLines[clipLines.length - 1] + after);
        
        row += clipLines.length - 1;
        column = clipLines[clipLines.length - 1].length;
      }
      
      if (normalized.includes('"""')) {
        dirty = true;
      }
      
      draw();
    }
    return;
  }
  
  if (key.full === 'C-a') {
    start = {line: 0, col: 0};
    end = {line: lines.length - 1, col: lines[lines.length - 1].length};
    draw();
    return;
  }
  
  if (key.full === 'C-s') {
    if (file) {
      try {
        const content = lines.join('\n');
        fs.writeFileSync(file, content, 'utf-8');
        status(` Saved: ${path.basename(file)}`);
      } catch (err) {
        status(` Error saving file: ${err}`);
      }
    } else {
      status(' No file opened. Use: notes filename.md');
    }
    return;
  }
  
  if (key.name === 'escape') {
    if (selector) {
      selector = false;
      popup.hide();
      editor.focus();
      draw();
      return;
    }
    
    if (start && end) {
      clipboard = selected();
      status(' Copied to clipboard', 1000);
      start = null;
      end = null;
      draw();
    }
    return;
  }
  
  if (key.name === 'up') {
    if (key.shift) {
      if (!start) {
        start = {line: row, col: column};
      }
      
      if (row > 0) {
        row--;
        column = Math.min(column, lines[row].length);
      }
      
      end = {line: row, col: column};
    } else {
      if (start && end) {
        clipboard = selected();
        status(' Copied to clipboard', 1000);
      }
      start = null;
      end = null;
      
      if (row > 0) {
        row--;
        column = Math.min(column, lines[row].length);
      }
    }
    draw();
    return;
  }
  
  if (key.name === 'down') {
    if (key.shift) {
      if (!start) {
        start = {line: row, col: column};
      }
      
      if (row < lines.length - 1) {
        row++;
        column = Math.min(column, lines[row].length);
      }
      
      end = {line: row, col: column};
    } else {
      if (start && end) {
        clipboard = selected();
        status(' Copied to clipboard', 1000);
      }
      start = null;
      end = null;
      
      if (row < lines.length - 1) {
        row++;
        column = Math.min(column, lines[row].length);
      }
    }
    draw();
    return;
  }
  
  if (key.name === 'left') {
    if (key.shift) {
      if (!start) {
        start = {line: row, col: column};
      }
      
      if (column > 0) {
        column--;
      }
      
      end = {line: row, col: column};
    } else {
      if (start && end) {
        clipboard = selected();
        status(' Copied to clipboard', 1000);
      }
      start = null;
      end = null;
      
      if (column > 0) {
        column--;
      }
    }
    draw();
    return;
  }
  
  if (key.name === 'right') {
    if (key.shift) {
      if (!start) {
        start = {line: row, col: column};
      }
      
      if (column < lines[row].length) {
        column++;
      }
      
      end = {line: row, col: column};
    } else {
      if (start && end) {
        clipboard = selected();
        status(' Copied to clipboard', 1000);
      }
      start = null;
      end = null;
      
      if (column < lines[row].length) {
        column++;
      }
    }
    draw();
    return;
  }
  
  if (key.name === 'home') {
    if (start && end) {
      clipboard = selected();
      status(' Copied to clipboard', 1000);
      start = null;
      end = null;
    }
    
    column = 0;
    draw();
    return;
  }
  
  if (key.name === 'end') {
    if (start && end) {
      clipboard = selected();
      status(' Copied to clipboard', 1000);
      start = null;
      end = null;
    }
    
    column = lines[row].length;
    draw();
    return;
  }
  
  if (key.name === 'return' || key.name === 'enter') {
    if (start && end) {
      clipboard = selected();
      remove();
      status(' Copied to clipboard', 1000);
    }
    
    const line = lines[row];
    const before = line.substring(0, column);
    const after = line.substring(column);
    lines[row] = before;
    lines.splice(row + 1, 0, after);
    row++;
    column = 0;
    dirty = true;
    draw();
    return;
  }
  
  if (key.name === 'backspace') {
    if (start && end) {
      clipboard = selected();
      remove();
      status(' Copied to clipboard', 1000);
      draw();
      return;
    }
    
    if (column > 0) {
      const line = lines[row];
      const charBefore = line[column - 1];
      const charAfter = line[column];
      
      const pairs: Record<string, string> = {
        '(': ')',
        '[': ']',
        '{': '}',
        '"': '"',
        "'": "'",
        '`': '`'
      };
      
      if (pairs[charBefore] === charAfter) {
        lines[row] = line.substring(0, column - 1) + line.substring(column + 1);
        column--;
      } else {
        lines[row] = line.substring(0, column - 1) + line.substring(column);
        column--;
      }
      if (line.includes('"""')) {
        dirty = true;
      }
      draw();
    } else if (row > 0) {
      const line = lines[row];
      row--;
      column = lines[row].length;
      lines[row] += line;
      lines.splice(row + 1, 1);
      dirty = true;
      draw();
    }
    return;
  }
  
  if (ch && !key.ctrl && !key.meta) {
    if (start && end) {
      clipboard = selected();
      remove();
      status(' Copied to clipboard', 1000);
    }
    const line = lines[row];
    
    const pairs: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}',
      '"': '"',
      "'": "'",
      '`': '`'
    };
    
    if (pairs[ch]) {
      if ((ch === '"' || ch === "'" || ch === '`')) {
        if (line[column] === ch) {
          column++;
          draw();
          return;
        }
        
        if (column >= 2 && line.substring(column - 2, column) === ch + ch) {
          lines[row] = line.substring(0, column) + ch + line.substring(column);
          column++;
          
          if (lines[row].endsWith('"""')) {
            dirty = true;
            selector = true;
            const filtered = languages;
            popup.setItems(filtered);
            popup.show();
            popup.focus();
            screen.render();
          } else {
            draw();
          }
          return;
        }
      }
      
      lines[row] = line.substring(0, column) + ch + pairs[ch] + line.substring(column);
      column++;
    } else {
      lines[row] = line.substring(0, column) + ch + line.substring(column);
      column++;
    }
    
    if (lines[row].endsWith('"""')) {
      selector = true;
      const filtered = languages;
      popup.setItems(filtered);
      popup.show();
      popup.focus();
      screen.render();
    } else {
      draw();
    }
  }
});

popup.on('select', (item: any) => {
  const lang = item.content.toLowerCase();
  const line = lines[row];
  lines[row] = line.replace('"""', `"""${lang}`);
  lines.splice(row + 1, 0, '');
  lines.splice(row + 2, 0, '"""');
  row++;
  column = 0;
  selector = false;
  popup.hide();
  editor.focus();
  dirty = true;
  draw();
});

popup.key(['escape'], () => {
  selector = false;
  popup.hide();
  editor.focus();
  draw();
});

editor.focus();
draw();
