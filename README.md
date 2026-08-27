# Terminal Notes App

Simple terminal notes app for Linux

## Install

```bash
npm install -g git+https://github.com/KirshWasHere/Terminal-Notes-app.git
```

## Usage

```bash
notes yourfile.md
```

## Keybinds

- `Ctrl+Q` - Quit
- `Ctrl+S` - Save
- `Ctrl+V` - Paste
- `Ctrl+X` - Cut
- `Ctrl+A` - Select all
- `Shift+Arrow Keys` - Select text
- `ESC` - Copy selected

## Syntax

### Headings

- `# text` - ASCII art heading
- `## text` - Block style █▓▒░
- `### text` - Bold heading

### Text Formatting

- `**bold**`
- `*italic*`
- `` `code` ``
- `==highlight==`

### Lists

- `* item`
- `- item`
- `+ item`

### Blockquotes

- `> quote`

### Links & Files

- `[text](url)`
- `[[path/to/file]]`

### Code Blocks

- `"""javascript` or `"""typescript` only js and ts for now
- Close with `"""`
