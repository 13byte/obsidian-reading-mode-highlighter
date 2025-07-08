import { MarkdownView, Plugin, Notice, Editor, TFile } from 'obsidian';

export default class ReadingModeHighlighter extends Plugin {

	async onload() {
		// Register command for hotkey assignment
		this.addCommand({
			id: 'highlight-selection',
			name: 'Toggle highlight on selected text',
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					this.toggleHighlight(activeView);
				} else {
					new Notice("No active Markdown view found.");
				}
			}
		});

		// Add ribbon icon for quick access
		this.addRibbonIcon('highlighter', 'Toggle highlight on selected text', () => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				this.toggleHighlight(activeView);
			} else {
				new Notice("No active Markdown view found.");
			}
		});
	}

	// Main toggle highlight function
	async toggleHighlight(view: MarkdownView) {
		const mode = view.getMode();

		if (mode === 'preview') {
			// Handle reading mode with direct file manipulation
			await this.handleReadingModeDirectly(view);
		} else {
			// Handle editing mode with standard editor API
			this.handleEditingMode(view.editor);
		}
	}

	// Direct file manipulation for reading mode (no visible transitions)
	async handleReadingModeDirectly(view: MarkdownView) {
		const selection = window.getSelection()?.toString();

		if (!selection || selection.trim().length === 0) {
			new Notice("Please select text to highlight first.");
			return;
		}

		const file = view.file;
		if (!file) {
			new Notice("No file is currently open.");
			return;
		}

		try {
			// Read current file content
			const content = await this.app.vault.read(file);
			const searchText = selection.trim();

			// Check for highlighted and non-highlighted versions
			const highlightedVersion = `==${searchText}==`;
			let newContent: string;
			let actionPerformed: string;

			if (content.includes(highlightedVersion)) {
				// Remove highlight
				newContent = content.replace(highlightedVersion, searchText);
				actionPerformed = "removed";
			} else if (content.includes(searchText)) {
				// Add highlight
				newContent = content.replace(searchText, highlightedVersion);
				actionPerformed = "added";
			} else {
				new Notice("Selected text not found in the document.");
				return;
			}

			// Write modified content back to file
			await this.app.vault.modify(file, newContent);

			// Notify user of action
			new Notice(`Highlight ${actionPerformed}.`);

			// Force refresh preview without mode change
			if (view.previewMode) {
				view.previewMode.rerender();
			}

		} catch (error) {
			console.error("Error modifying file:", error);
			new Notice("An error occurred while modifying the file.");
		}
	}

	// Handle editing mode with extended context detection
	handleEditingMode(editor: Editor) {
		const selection = editor.getSelection();

		if (!selection || selection.trim().length === 0) {
			new Notice("Please select text to highlight first.");
			return;
		}

		// Get precise cursor positions
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");

		// Check for highlight markers before and after selection
		const beforeMarker = line.substring(Math.max(0, selectionStart.ch - 2), selectionStart.ch);
		const afterMarker = line.substring(selectionEnd.ch, Math.min(line.length, selectionEnd.ch + 2));

		if (beforeMarker === '==' && afterMarker === '==') {
			// Remove highlight by extending selection to include markers
			const newFrom = { line: selectionStart.line, ch: selectionStart.ch - 2 };
			const newTo = { line: selectionEnd.line, ch: selectionEnd.ch + 2 };
			editor.setSelection(newFrom, newTo);
			editor.replaceSelection(selection);
			new Notice("Highlight removed.");
		} else if (selection.startsWith('==') && selection.endsWith('==')) {
			// Selection already includes markers
			const innerText = selection.slice(2, -2);
			editor.replaceSelection(innerText);
			new Notice("Highlight removed.");
		} else {
			// Add highlight
			editor.replaceSelection(`==${selection}==`);
			new Notice("Highlight added.");
		}
	}
}
