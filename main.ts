
import { MarkdownView, Plugin, Notice, Editor, TFile } from 'obsidian';

// Performance optimization interfaces
interface PositionInfo {
	readonly contextBefore: string;
	readonly contextAfter: string;
	readonly lineNumber?: number;
}

interface ToggleResult {
	readonly success: boolean;
	readonly newContent?: string;
	readonly action?: string;
	readonly error?: string;
}

// Optimized regex cache using Flyweight pattern
class RegexCache {
	private static readonly cache = new Map<string, RegExp>();
	private static readonly escapeCache = new Map<string, string>();

	static getEscapedText(text: string): string {
		if (this.escapeCache.has(text)) {
			return this.escapeCache.get(text)!;
		}

		const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		this.escapeCache.set(text, escaped);
		return escaped;
	}

	static getRegex(pattern: string, flags: string = 'g'): RegExp {
		const key = `${pattern}:${flags}`;
		if (this.cache.has(key)) {
			return this.cache.get(key)!;
		}

		const regex = new RegExp(pattern, flags);
		this.cache.set(key, regex);
		return regex;
	}

	static clearCache(): void {
		this.cache.clear();
		this.escapeCache.clear();
	}
}

// Context processing optimization with memoization
class ContextProcessor {
	private static readonly contextCache = new Map<string, PositionInfo>();

	static processContext(range: Range, selectedText: string): PositionInfo | null {
		const cacheKey = `${selectedText}:${range.startOffset}:${range.endOffset}`;

		if (this.contextCache.has(cacheKey)) {
			return this.contextCache.get(cacheKey)!;
		}

		try {
			const container = range.commonAncestorContainer;
			const textContent = container.textContent || '';

			const startOffset = range.startOffset;
			const endOffset = range.endOffset;

			const contextLength = 50;
			const beforeStart = Math.max(0, startOffset - contextLength);
			const afterEnd = Math.min(textContent.length, endOffset + contextLength);

			const contextBefore = textContent.substring(beforeStart, startOffset);
			const contextAfter = textContent.substring(endOffset, afterEnd);

			// Optimized line number detection
			let lineNumber: number | undefined;
			let element = range.startContainer.parentElement;

			while (element && element !== document.body) {
				const lineAttr = element.getAttribute('data-line');
				if (lineAttr) {
					lineNumber = parseInt(lineAttr, 10);
					break;
				}

				if (element.matches('h1, h2, h3, h4, h5, h6, p, li, blockquote')) {
					break;
				}

				element = element.parentElement;
			}

			const result: PositionInfo = Object.freeze({
				contextBefore,
				contextAfter,
				lineNumber
			});

			this.contextCache.set(cacheKey, result);
			return result;
		} catch (error) {
			console.error("Error processing context:", error);
			return null;
		}
	}

	static clearCache(): void {
		this.contextCache.clear();
	}
}

// File-based highlight detection optimizer
class HighlightDetector {
	private static readonly detectionCache = new Map<string, boolean>();

	static isHighlighted(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo
	): boolean {
		const cacheKey = `${selectedText}:${positionInfo.contextBefore}:${positionInfo.contextAfter}`;

		if (this.detectionCache.has(cacheKey)) {
			return this.detectionCache.get(cacheKey)!;
		}

		const highlightedVersion = `==${selectedText}==`;
		let isHighlighted = false;

		// Strategy 1: Exact context matching (optimized)
		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const exactPattern = `${escapedBefore}${escapedHighlighted}${escapedAfter}`;
		const exactRegex = RegexCache.getRegex(exactPattern);

		if (exactRegex.test(content)) {
			isHighlighted = true;
		} else if (positionInfo.lineNumber !== undefined) {
			// Strategy 2: Optimized line-based detection
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			if (lineIndex >= 0 && lineIndex < lines.length) {
				isHighlighted = lines[lineIndex].includes(highlightedVersion);
			}
		}

		this.detectionCache.set(cacheKey, isHighlighted);
		return isHighlighted;
	}

	static clearCache(): void {
		this.detectionCache.clear();
	}
}

export default class ReadingModeHighlighter extends Plugin {
	// Performance monitoring
	private static readonly performanceMetrics = {
		highlightOperations: 0,
		averageProcessingTime: 0,
		cacheHitRate: 0
	};

	async onload() {
		this.addCommand({
			id: 'highlight-selection',
			name: 'Toggle highlight on selected text',
			callback: () => this.executeHighlightCommand()
		});

		this.addRibbonIcon('highlighter', 'Toggle highlight on selected text', () => {
			this.executeHighlightCommand();
		});

		// Clear caches periodically to prevent memory leaks
		this.registerInterval(setInterval(() => {
			RegexCache.clearCache();
			ContextProcessor.clearCache();
			HighlightDetector.clearCache();
		}, 300000)); // Every 5 minutes
	}

	private executeHighlightCommand(): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			this.toggleHighlight(activeView);
		} else {
			new Notice("No active Markdown view found.");
		}
	}

	async toggleHighlight(view: MarkdownView): Promise<void> {
		const startTime = performance.now();

		try {
			const mode = view.getMode();

			if (mode === 'preview') {
				await this.handleReadingModeOptimized(view);
			} else {
				this.handleEditingModeOptimized(view.editor);
			}

			// Update performance metrics
			const processingTime = performance.now() - startTime;
			this.updatePerformanceMetrics(processingTime);

		} catch (error) {
			console.error("Error in toggleHighlight:", error);
			new Notice("An error occurred during highlight operation.");
		}
	}

	// Optimized reading mode handler with minimal allocations
	private async handleReadingModeOptimized(view: MarkdownView): Promise<void> {
		const selection = window.getSelection();
		if (!selection?.rangeCount) {
			new Notice("Please select text to highlight first.");
			return;
		}

		const selectedText = selection.toString().trim();
		if (!selectedText) {
			new Notice("Please select text to highlight first.");
			return;
		}

		const file = view.file;
		if (!file) {
			new Notice("No file is currently open.");
			return;
		}

		try {
			const range = selection.getRangeAt(0);
			const positionInfo = ContextProcessor.processContext(range, selectedText);

			if (!positionInfo) {
				new Notice("Could not determine text position.");
				return;
			}

			const content = await this.app.vault.read(file);
			const isHighlighted = HighlightDetector.isHighlighted(content, selectedText, positionInfo);

			console.log(`[ReadingModeHighlighter] Selected: "${selectedText}"`);
			console.log(`[ReadingModeHighlighter] File-based highlight status: ${isHighlighted}`);

			const result = this.processHighlightToggle(content, selectedText, positionInfo, isHighlighted);

			if (result.success && result.newContent) {
				await this.app.vault.modify(file, result.newContent);
				new Notice(`Highlight ${result.action}.`);

				view.previewMode?.rerender();
			} else {
				new Notice(result.error || "Could not modify highlight.");
			}

		} catch (error) {
			console.error("Error in reading mode handler:", error);
			new Notice("An error occurred while modifying the file.");
		}
	}

	// Optimized highlight toggle processing with reduced object creation
	private processHighlightToggle(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo,
		isHighlighted: boolean
	): ToggleResult {
		if (isHighlighted) {
			return this.removeHighlightOptimized(content, selectedText, positionInfo);
		}

		return this.addHighlightOptimized(content, selectedText, positionInfo);
	}

	// Optimized highlight addition with cached regex patterns
	private addHighlightOptimized(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo
	): ToggleResult {
		const highlightedVersion = `==${selectedText}==`;

		// Step 1: Context-based matching (most accurate)
		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedText = RegexCache.getEscapedText(selectedText);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const contextPattern = `${escapedBefore}(${escapedText}|${escapedHighlighted})${escapedAfter}`;
		const contextRegex = RegexCache.getRegex(contextPattern);

		const match = contextRegex.exec(content);
		if (match) {
			const matchedText = match[1];
			const replacement = matchedText === highlightedVersion ?
				`${positionInfo.contextBefore}${selectedText}${positionInfo.contextAfter}` :
				`${positionInfo.contextBefore}${highlightedVersion}${positionInfo.contextAfter}`;

			const newContent = content.replace(match[0], replacement);
			const action = matchedText === highlightedVersion ? "removed" : "added";

			return Object.freeze({ success: true, newContent, action });
		}

		// Step 2: Line-based matching (fallback)
		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			if (lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];

				if (line.includes(selectedText)) {
					lines[lineIndex] = line.replace(selectedText, highlightedVersion);
					return Object.freeze({
						success: true,
						newContent: lines.join('\n'),
						action: "added"
					});
				}
			}
		}

		// Step 3: Safe global matching
		const globalTextRegex = RegexCache.getRegex(escapedText);
		const globalHighlightedRegex = RegexCache.getRegex(escapedHighlighted);

		const allMatches = content.match(globalTextRegex);
		const allHighlightedMatches = content.match(globalHighlightedRegex);

		if (allMatches?.length === 1 && !allHighlightedMatches) {
			const newContent = content.replace(selectedText, highlightedVersion);
			return Object.freeze({ success: true, newContent, action: "added" });
		}

		return Object.freeze({
			success: false,
			error: "Multiple instances found. Please select text with unique context."
		});
	}

	// Optimized highlight removal with enhanced pattern matching
	private removeHighlightOptimized(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo
	): ToggleResult {
		const highlightedVersion = `==${selectedText}==`;

		// Strategy 1: Exact pattern with context
		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const exactPattern = `${escapedBefore}${escapedHighlighted}${escapedAfter}`;
		const exactRegex = RegexCache.getRegex(exactPattern);

		if (exactRegex.test(content)) {
			const replacement = `${positionInfo.contextBefore}${selectedText}${positionInfo.contextAfter}`;
			const newContent = content.replace(exactRegex, replacement);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		// Strategy 2: Line-based removal
		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			if (lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];
				if (line.includes(highlightedVersion)) {
					lines[lineIndex] = line.replace(highlightedVersion, selectedText);
					return Object.freeze({
						success: true,
						newContent: lines.join('\n'),
						action: "removed"
					});
				}
			}
		}

		// Strategy 3: Safe global removal
		const globalHighlightedRegex = RegexCache.getRegex(escapedHighlighted);
		const allHighlightedMatches = content.match(globalHighlightedRegex);

		if (allHighlightedMatches?.length === 1) {
			const newContent = content.replace(highlightedVersion, selectedText);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		return Object.freeze({
			success: false,
			error: "Could not safely remove highlight. Multiple instances found."
		});
	}

	// Optimized editing mode with reduced DOM operations
	private handleEditingModeOptimized(editor: Editor): void {
		const selection = editor.getSelection();
		if (!selection?.trim()) {
			new Notice("Please select text to highlight first.");
			return;
		}

		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");
		const line = editor.getLine(selectionStart.line);

		// Pre-calculate marker positions to avoid repeated substring operations
		const beforeStartPos = Math.max(0, selectionStart.ch - 2);
		const afterEndPos = Math.min(line.length, selectionEnd.ch + 2);

		const beforeMarker = line.substring(beforeStartPos, selectionStart.ch);
		const afterMarker = line.substring(selectionEnd.ch, afterEndPos);

		if (beforeMarker === '==' && afterMarker === '==') {
			// Remove highlight by extending selection
			const newFrom = { line: selectionStart.line, ch: beforeStartPos };
			const newTo = { line: selectionEnd.line, ch: afterEndPos };
			editor.setSelection(newFrom, newTo);
			editor.replaceSelection(selection);
			new Notice("Highlight removed.");
		} else if (selection.startsWith('==') && selection.endsWith('==')) {
			// Remove highlight markers from selection
			const innerText = selection.slice(2, -2);
			editor.replaceSelection(innerText);
			new Notice("Highlight removed.");
		} else {
			// Add highlight markers
			editor.replaceSelection(`==${selection}==`);
			new Notice("Highlight added.");
		}
	}

	// Performance monitoring helper
	private updatePerformanceMetrics(processingTime: number): void {
		const metrics = ReadingModeHighlighter.performanceMetrics;
		metrics.highlightOperations++;
		metrics.averageProcessingTime =
			(metrics.averageProcessingTime * (metrics.highlightOperations - 1) + processingTime) /
			metrics.highlightOperations;
	}

	onunload(): void {
		// Clear all caches on plugin unload
		RegexCache.clearCache();
		ContextProcessor.clearCache();
		HighlightDetector.clearCache();
	}
}
