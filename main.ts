
import { MarkdownView, Plugin, Notice, Editor, TFile, Menu } from 'obsidian';

// ============================================================
// LRU Cache Implementation (MEDIUM Fix: Unbounded Cache Growth)
// ============================================================
class LRUCache<K, V> {
	private cache: Map<K, V>;
	private readonly maxSize: number;

	constructor(maxSize: number = 500) {
		this.cache = new Map<K, V>();
		this.maxSize = maxSize;
	}

	get(key: K): V | undefined {
		if (!this.cache.has(key)) {
			return undefined;
		}
		// Move to end (most recently used)
		const value = this.cache.get(key)!;
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		// Delete if exists (to re-insert at end)
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
		// Evict oldest if at capacity
		else if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey !== undefined) {
				this.cache.delete(firstKey);
			}
		}
		this.cache.set(key, value);
	}

	has(key: K): boolean {
		return this.cache.has(key);
	}

	clear(): void {
		this.cache.clear();
	}

	get size(): number {
		return this.cache.size;
	}
}

// ============================================================
// Configuration Interfaces
// ============================================================
interface ContextConfig {
	readonly defaultContextLength: number;
	readonly useWordBoundaries: boolean;
	readonly minContextLength: number;
	readonly maxContextLength: number;
}

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

// ============================================================
// RegexCache - Flyweight Pattern with LRU Eviction
// CRITICAL Fix: Reset lastIndex to prevent state pollution
// ============================================================
class RegexCache {
	private static readonly cache = new LRUCache<string, RegExp>(500);
	private static readonly escapeCache = new LRUCache<string, string>(500);
	private static metricsTracker: ((hit: boolean) => void) | null = null;

	static setMetricsTracker(tracker: (hit: boolean) => void): void {
		this.metricsTracker = tracker;
	}

	static getEscapedText(text: string): string {
		const cached = this.escapeCache.get(text);
		if (cached !== undefined) {
			this.metricsTracker?.(true);
			return cached;
		}

		this.metricsTracker?.(false);
		const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		this.escapeCache.set(text, escaped);
		return escaped;
	}

	// CRITICAL FIX: Reset lastIndex before returning cached regex
	static getRegex(pattern: string, flags: string = 'g'): RegExp {
		const key = `${pattern}:${flags}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			this.metricsTracker?.(true);
			cached.lastIndex = 0; // CRITICAL: Reset state to prevent pollution
			return cached;
		}

		this.metricsTracker?.(false);
		const regex = new RegExp(pattern, flags);
		this.cache.set(key, regex);
		return regex;
	}

	static clearCache(): void {
		this.cache.clear();
		this.escapeCache.clear();
	}
}

// ============================================================
// ContextProcessor - Memoization with LRU Cache
// CRITICAL Fix: Include filePath in cache key
// MEDIUM Fix: Adaptive context length with word boundaries
// ============================================================
class ContextProcessor {
	private static readonly contextCache = new LRUCache<string, PositionInfo>(500);
	private static config: ContextConfig = {
		defaultContextLength: 50,
		useWordBoundaries: true,
		minContextLength: 20,
		maxContextLength: 150
	};

	static setConfig(config: Partial<ContextConfig>): void {
		this.config = { ...this.config, ...config };
	}

	// CRITICAL FIX: Added filePath parameter to prevent cross-file cache pollution
	static processContext(range: Range, selectedText: string, filePath: string): PositionInfo | null {
		const cacheKey = `${filePath}:${selectedText}:${range.startOffset}:${range.endOffset}`;

		const cached = this.contextCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		try {
			const container = range.commonAncestorContainer;
			const textContent = container.textContent || '';

			const startOffset = range.startOffset;
			const endOffset = range.endOffset;

			// MEDIUM FIX: Adaptive context length based on selection size
			const selectionLength = selectedText.length;
			let contextLength = this.config.defaultContextLength;

			if (selectionLength < 10) {
				contextLength = this.config.maxContextLength;
			} else if (selectionLength > 100) {
				contextLength = this.config.minContextLength;
			}

			let beforeStart = Math.max(0, startOffset - contextLength);
			let afterEnd = Math.min(textContent.length, endOffset + contextLength);

			// MEDIUM FIX: Adjust to word boundaries if enabled
			if (this.config.useWordBoundaries) {
				while (beforeStart > 0 && beforeStart < startOffset && !/\s/.test(textContent[beforeStart - 1])) {
					beforeStart--;
				}
				while (afterEnd < textContent.length && afterEnd > endOffset && !/\s/.test(textContent[afterEnd])) {
					afterEnd++;
				}
			}

			const contextBefore = textContent.substring(beforeStart, startOffset);
			const contextAfter = textContent.substring(endOffset, afterEnd);

			// Line number detection with improved null safety
			// Note: Obsidian's data-line attribute is 0-indexed (first line = 0)
			let lineNumber: number | undefined;
			let element = range.startContainer?.parentElement ?? null;

			while (element && element !== document.body) {
				const lineAttr = element.getAttribute('data-line');
				if (lineAttr) {
					const parsed = parseInt(lineAttr, 10);
					// LOW FIX: Validate parsed line number
					if (!isNaN(parsed) && parsed >= 0) {
						lineNumber = parsed;
					}
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

// ============================================================
// HighlightDetector - File-based Detection with LRU Cache
// CRITICAL Fix: Include filePath in cache key
// ============================================================
class HighlightDetector {
	private static readonly detectionCache = new LRUCache<string, boolean>(500);

	// CRITICAL FIX: Added filePath parameter to prevent cross-file cache pollution
	static isHighlighted(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo,
		filePath: string
	): boolean {
		const cacheKey = `${filePath}:${selectedText}:${positionInfo.contextBefore}:${positionInfo.contextAfter}`;

		const cached = this.detectionCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		const highlightedVersion = `==${selectedText}==`;
		let isHighlighted = false;

		// Strategy 1: Exact context matching
		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const exactPattern = `${escapedBefore}${escapedHighlighted}${escapedAfter}`;
		const exactRegex = RegexCache.getRegex(exactPattern);

		if (exactRegex.test(content)) {
			isHighlighted = true;
		} else if (positionInfo.lineNumber !== undefined) {
			// Strategy 2: Line-based detection
			// HIGH FIX: lineNumber from data-line is 0-indexed, matching array indices
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			// HIGH FIX: Validate line index is an integer and within bounds
			if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
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

// ============================================================
// Main Plugin Class
// ============================================================
export default class ReadingModeHighlighter extends Plugin {
	// LOW FIX: Debug mode toggle for conditional logging
	private static debugMode: boolean = false;

	// LOW FIX: Properly implemented performance metrics
	private static readonly performanceMetrics = {
		highlightOperations: 0,
		averageProcessingTime: 0,
		cacheHits: 0,
		cacheMisses: 0,
		get cacheHitRate(): number {
			const total = this.cacheHits + this.cacheMisses;
			return total > 0 ? (this.cacheHits / total) * 100 : 0;
		}
	};

	async onload() {
		// Set up cache metrics tracking
		RegexCache.setMetricsTracker((hit: boolean) => {
			if (hit) {
				ReadingModeHighlighter.performanceMetrics.cacheHits++;
			} else {
				ReadingModeHighlighter.performanceMetrics.cacheMisses++;
			}
		});

		this.addCommand({
			id: 'highlight-selection',
			name: 'Toggle highlight on selected text',
			callback: () => this.executeHighlightCommand()
		});

		// LOW FIX: Command to view performance metrics
		this.addCommand({
			id: 'show-performance-metrics',
			name: 'Show performance metrics',
			callback: () => this.showPerformanceMetrics()
		});

		// LOW FIX: Command to toggle debug mode
		this.addCommand({
			id: 'toggle-debug-mode',
			name: 'Toggle debug mode',
			callback: () => {
				ReadingModeHighlighter.debugMode = !ReadingModeHighlighter.debugMode;
				new Notice(`Debug mode ${ReadingModeHighlighter.debugMode ? 'enabled' : 'disabled'}.`);
			}
		});

		this.addRibbonIcon('highlighter', 'Toggle highlight on selected text', () => {
			this.executeHighlightCommand();
		});

		// Context menu for editing mode (right-click / long-press on mobile)
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (selection?.trim()) {
					menu.addItem((item) => {
						item
							.setTitle('Toggle highlight')
							.setIcon('highlighter')
							.onClick(() => {
								this.handleEditingModeOptimized(editor);
							});
					});
				}
			})
		);

		// Context menu for reading mode (right-click / long-press on mobile)
		this.registerDomEvent(document, 'contextmenu', (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || activeView.getMode() !== 'preview') {
				return;
			}

			const selection = window.getSelection();
			if (!selection?.toString().trim()) {
				return;
			}

			const menu = new Menu();
			menu.addItem((item) => {
				item
					.setTitle('Toggle highlight')
					.setIcon('highlighter')
					.onClick(() => {
						this.handleReadingModeOptimized(activeView);
					});
			});

			menu.showAtMouseEvent(evt);
			evt.preventDefault();
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

			const processingTime = performance.now() - startTime;
			this.updatePerformanceMetrics(processingTime);

		} catch (error) {
			console.error("Error in toggleHighlight:", error);
			new Notice("An error occurred during highlight operation.");
		}
	}

	private async handleReadingModeOptimized(view: MarkdownView): Promise<void> {
		const selection = window.getSelection();
		if (!selection?.rangeCount) {
			new Notice("Please select text to highlight first.");
			return;
		}

		// MEDIUM FIX: Better whitespace handling
		const rawSelection = selection.toString();
		const selectedText = rawSelection.trim();
		if (!selectedText) {
			new Notice(rawSelection.length > 0 ?
				"Cannot highlight whitespace-only text." :
				"Please select text to highlight first.");
			return;
		}

		const file = view.file;
		if (!file) {
			new Notice("No file is currently open.");
			return;
		}

		try {
			const range = selection.getRangeAt(0);
			// CRITICAL FIX: Pass file path to prevent cache pollution
			const positionInfo = ContextProcessor.processContext(range, selectedText, file.path);

			if (!positionInfo) {
				new Notice("Could not determine text position.");
				return;
			}

			const content = await this.app.vault.read(file);
			// CRITICAL FIX: Capture modification time for race condition prevention
			const initialMtime = file.stat.mtime;

			// CRITICAL FIX: Pass file path to detection
			const isHighlighted = HighlightDetector.isHighlighted(content, selectedText, positionInfo, file.path);

			// LOW FIX: Conditional debug logging
			if (ReadingModeHighlighter.debugMode) {
				console.log(`[ReadingModeHighlighter] Selected: "${selectedText}"`);
				console.log(`[ReadingModeHighlighter] File-based highlight status: ${isHighlighted}`);
			}

			const result = this.processHighlightToggle(content, selectedText, positionInfo, isHighlighted);

			if (result.success && result.newContent) {
				// CRITICAL FIX: Check file hasn't been modified before writing
				const currentFile = this.app.vault.getAbstractFileByPath(file.path);
				if (currentFile instanceof TFile && currentFile.stat.mtime === initialMtime) {
					await this.app.vault.modify(file, result.newContent);
					new Notice(`Highlight ${result.action}.`);

					// LOW FIX: Null check for previewMode
					if (view.previewMode) {
						view.previewMode.rerender();
					}
				} else {
					new Notice("File was modified by another process. Please try again.");
				}
			} else {
				new Notice(result.error || "Could not modify highlight.");
			}

		} catch (error) {
			console.error("Error in reading mode handler:", error);
			new Notice("An error occurred while modifying the file.");
		}
	}

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

	// HIGH FIX: Use substring concatenation instead of replace to avoid $ character issues
	// and ensure exact position replacement
	private addHighlightOptimized(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo
	): ToggleResult {
		const highlightedVersion = `==${selectedText}==`;

		// Strategy 1: Context-based matching (most accurate)
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

			// HIGH FIX: Use substring concatenation for exact position replacement
			// This avoids $ character interpretation issues
			const matchIndex = match.index;
			const matchLength = match[0].length;
			const newContent = content.substring(0, matchIndex) + replacement + content.substring(matchIndex + matchLength);
			const action = matchedText === highlightedVersion ? "removed" : "added";

			return Object.freeze({ success: true, newContent, action });
		}

		// Strategy 2: Line-based matching (fallback)
		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			// HIGH FIX: Validate line index
			if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];
				const textIndex = line.indexOf(selectedText);

				if (textIndex !== -1) {
					// HIGH FIX: Use substring concatenation to replace at exact position
					lines[lineIndex] = line.substring(0, textIndex) + highlightedVersion + line.substring(textIndex + selectedText.length);
					return Object.freeze({
						success: true,
						newContent: lines.join('\n'),
						action: "added"
					});
				}
			}
		}

		// Strategy 3: Safe global matching with improved detection
		const globalTextRegex = RegexCache.getRegex(escapedText);
		const globalHighlightedRegex = RegexCache.getRegex(escapedHighlighted);

		const allMatches = content.match(globalTextRegex);
		const allHighlightedMatches = content.match(globalHighlightedRegex);

		const plainTextCount = allMatches?.length || 0;
		const highlightedCount = allHighlightedMatches?.length || 0;
		const totalInstances = plainTextCount + highlightedCount;

		// CRITICAL FIX: Only proceed if there's exactly one plain text instance
		if (plainTextCount === 1 && totalInstances === 1) {
			// HIGH FIX: Use function replacer to avoid $ character issues
			const newContent = content.replace(globalTextRegex, () => highlightedVersion);
			return Object.freeze({ success: true, newContent, action: "added" });
		}

		return Object.freeze({
			success: false,
			error: totalInstances > 1
				? "Multiple instances found. Please select text with unique context."
				: "Text not found or already highlighted."
		});
	}

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

		const exactMatch = exactRegex.exec(content);
		if (exactMatch) {
			const replacement = `${positionInfo.contextBefore}${selectedText}${positionInfo.contextAfter}`;
			// HIGH FIX: Use substring concatenation for exact position replacement
			const matchIndex = exactMatch.index;
			const matchLength = exactMatch[0].length;
			const newContent = content.substring(0, matchIndex) + replacement + content.substring(matchIndex + matchLength);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		// Strategy 2: Line-based removal
		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			// HIGH FIX: Validate line index
			if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];
				const highlightIndex = line.indexOf(highlightedVersion);

				if (highlightIndex !== -1) {
					// HIGH FIX: Use substring concatenation
					lines[lineIndex] = line.substring(0, highlightIndex) + selectedText + line.substring(highlightIndex + highlightedVersion.length);
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
			// HIGH FIX: Use function replacer to avoid $ character issues
			const newContent = content.replace(globalHighlightedRegex, () => selectedText);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		return Object.freeze({
			success: false,
			error: "Could not safely remove highlight. Multiple instances found."
		});
	}

	// HIGH FIX: Support for multi-line selections
	private handleEditingModeOptimized(editor: Editor): void {
		const rawSelection = editor.getSelection();
		const selection = rawSelection.trim();

		// MEDIUM FIX: Better empty selection handling
		if (!selection) {
			new Notice(rawSelection.length > 0 ?
				"Cannot highlight whitespace-only text." :
				"Please select text to highlight first.");
			return;
		}

		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");

		// HIGH FIX: Detect multi-line selection
		const isMultiLine = selectionStart.line !== selectionEnd.line;

		if (isMultiLine) {
			this.handleMultiLineHighlight(editor, selection, selectionStart, selectionEnd);
		} else {
			this.handleSingleLineHighlight(editor, selection, selectionStart, selectionEnd);
		}
	}

	// HIGH FIX: Extracted single-line handling
	private handleSingleLineHighlight(
		editor: Editor,
		selection: string,
		selectionStart: { line: number; ch: number },
		selectionEnd: { line: number; ch: number }
	): void {
		const line = editor.getLine(selectionStart.line);

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
		} else if (selection.startsWith('==') && selection.endsWith('==') && selection.length > 4) {
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

	// HIGH FIX: New method for multi-line selections
	private handleMultiLineHighlight(
		editor: Editor,
		selection: string,
		selectionStart: { line: number; ch: number },
		selectionEnd: { line: number; ch: number }
	): void {
		// Check if selection contains highlight markers
		const containsHighlightMarkers = selection.includes('==');

		if (containsHighlightMarkers) {
			// Check if entire selection is wrapped in markers
			if (selection.startsWith('==') && selection.endsWith('==')) {
				// Remove outer markers
				const innerText = selection.slice(2, -2);
				editor.replaceSelection(innerText);
				new Notice("Highlight removed.");
				return;
			}

			// Check if markers surround the selection (on first and last lines)
			const firstLine = editor.getLine(selectionStart.line);
			const lastLine = editor.getLine(selectionEnd.line);

			const beforeStartPos = Math.max(0, selectionStart.ch - 2);
			const afterEndPos = Math.min(lastLine.length, selectionEnd.ch + 2);

			const beforeMarker = firstLine.substring(beforeStartPos, selectionStart.ch);
			const afterMarker = lastLine.substring(selectionEnd.ch, afterEndPos);

			if (beforeMarker === '==' && afterMarker === '==') {
				// Extend selection to include markers and remove them
				const newFrom = { line: selectionStart.line, ch: beforeStartPos };
				const newTo = { line: selectionEnd.line, ch: afterEndPos };
				editor.setSelection(newFrom, newTo);
				editor.replaceSelection(selection);
				new Notice("Highlight removed.");
				return;
			}
		}

		// Add highlight markers around entire selection
		editor.replaceSelection(`==${selection}==`);
		new Notice("Highlight added.");
	}

	private updatePerformanceMetrics(processingTime: number): void {
		const metrics = ReadingModeHighlighter.performanceMetrics;
		metrics.highlightOperations++;
		metrics.averageProcessingTime =
			(metrics.averageProcessingTime * (metrics.highlightOperations - 1) + processingTime) /
			metrics.highlightOperations;
	}

	// LOW FIX: Method to display performance metrics
	private showPerformanceMetrics(): void {
		const metrics = ReadingModeHighlighter.performanceMetrics;
		const message = `Performance Metrics:
Operations: ${metrics.highlightOperations}
Avg Time: ${metrics.averageProcessingTime.toFixed(2)}ms
Cache Hit Rate: ${metrics.cacheHitRate.toFixed(1)}%
Cache Hits: ${metrics.cacheHits}
Cache Misses: ${metrics.cacheMisses}`;

		new Notice(message, 8000);
		if (ReadingModeHighlighter.debugMode) {
			console.log('[ReadingModeHighlighter]', message);
		}
	}

	onunload(): void {
		// Clear all caches on plugin unload
		RegexCache.clearCache();
		ContextProcessor.clearCache();
		HighlightDetector.clearCache();
	}
}
