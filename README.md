# Obsidian Reading Mode Highlighter

A seamless highlighting plugin for Obsidian that works in both reading and editing modes without visual disruptions.

## Features

- 🎯 **Toggle highlights** in both reading and editing modes
- 🚀 **Zero visual transitions** - no flickering when highlighting in reading mode
- ⌨️ **Hotkey support** - assign custom keyboard shortcuts
- 🖱️ **Ribbon icon** - quick access from the sidebar
- 🔄 **Smart toggle** - automatically detects and removes existing highlights

## Installation

### Manual Installation

1. Download the latest release from the [Releases](https://github.com/13byte/obsidian-reading-mode-highlighter/releases) page
2. Extract the files into your vault's `.obsidian/plugins/obsidian-reading-mode-highlighter/` folder
3. Reload Obsidian
4. Enable the plugin in Settings → Community plugins

### From Community Plugins

1. Open Settings → Community plugins
2. Disable Safe mode
3. Click Browse and search for "Reading Mode Highlighter"
4. Install and enable the plugin

## Usage

### Basic Usage

1. Select any text in reading or editing mode
2. Click the highlighter icon in the ribbon, or
3. Use the assigned hotkey (configure in Settings → Hotkeys)
4. The selected text will be wrapped with `==` markers

### Toggle Behavior

- **First use**: Adds highlight (`==text==`)
- **Second use**: Removes highlight (back to `text`)

## Configuration

### Hotkey Setup

1. Go to Settings → Hotkeys
2. Search for "Reading Mode Highlighter"
3. Click the ⊕ button next to "Toggle highlight on selected text"
4. Press your desired key combination

## Technical Details

### How It Works

- **Editing mode**: Uses standard Obsidian editor API
- **Reading mode**: Performs direct file manipulation without mode switching
- **Smart detection**: Checks context around selection to identify existing highlights

### Performance

- No mode transitions = no visual flickering
- Minimal file I/O operations
- Instant preview updates

## Compatibility

- Requires Obsidian v0.15.0 or higher
- Works on desktop and mobile
- Compatible with most themes and plugins

## Support

- 🐛 [Report issues](https://github.com/13byte/obsidian-reading-mode-highlighter/issues)
- 💡 [Request features](https://github.com/13byte/obsidian-reading-mode-highlighter/issues)
- ⭐ Star this repo if you find it helpful!

## License

ISC License

Copyright (C) 2020-2025 by Dynalist Inc.

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

See [LICENSE](LICENSE) file for full details.

## Author

Created by [13byte](https://github.com/13byte)

---

**Note**: This plugin focuses on providing a seamless highlighting experience, especially in reading mode where traditional approaches cause visual disruptions.
