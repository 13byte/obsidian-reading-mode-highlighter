import { MarkdownView, Plugin, Notice, Editor, TFile, Menu } from 'obsidian';

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
		const value = this.cache.get(key)!;
		this.cache.delete(key);
		this.cache.set(key, value);
		return value;
	}

	set(key: K, value: V): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		}
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

	static getRegex(pattern: string, flags: string = 'g'): RegExp {
		const key = `${pattern}:${flags}`;
		const cached = this.cache.get(key);
		if (cached !== undefined) {
			this.metricsTracker?.(true);
			cached.lastIndex = 0;
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

			const selectionLength = selectedText.length;
			let contextLength = this.config.defaultContextLength;

			if (selectionLength < 10) {
				contextLength = this.config.maxContextLength;
			} else if (selectionLength > 100) {
				contextLength = this.config.minContextLength;
			}

			let beforeStart = Math.max(0, startOffset - contextLength);
			let afterEnd = Math.min(textContent.length, endOffset + contextLength);

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

			let lineNumber: number | undefined;
			let element = range.startContainer?.parentElement ?? null;

			while (element && element !== document.body) {
				const lineAttr = element.getAttribute('data-line');
				if (lineAttr) {
					const parsed = parseInt(lineAttr, 10);
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

	static clearCacheForFile(filePath: string): void {
		// Clear all cache entries for a specific file
		// Note: LRUCache doesn't expose keys(), so we clear all cache
		// This is a limitation of the current cache implementation
		this.contextCache.clear();
	}
}

class HighlightDetector {
	private static readonly detectionCache = new LRUCache<string, boolean>(500);

	static isHighlighted(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo,
		filePath: string,
		contentHash?: string
	): boolean {
		// Include contentHash to prevent stale cache after file modifications
		const hashSuffix = contentHash ? `:${contentHash}` : '';
		const cacheKey = `${filePath}:${selectedText}:${positionInfo.contextBefore}:${positionInfo.contextAfter}${hashSuffix}`;

		const cached = this.detectionCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		const highlightedVersion = `==${selectedText}==`;
		let isHighlighted = false;

		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const exactPattern = `${escapedBefore}${escapedHighlighted}${escapedAfter}`;
		const exactRegex = RegexCache.getRegex(exactPattern);

		if (exactRegex.test(content)) {
			isHighlighted = true;
		} else if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

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

	static clearCacheForFile(filePath: string): void {
		// Clear all cache entries for a specific file
		const keysToDelete: string[] = [];
		// Note: LRUCache doesn't expose keys(), so we clear all cache
		// This is a limitation of the current cache implementation
		this.detectionCache.clear();
	}
}

export default class ReadingModeHighlighter extends Plugin {
	private static debugMode: boolean = false;
	private floatingButton: HTMLElement | null = null;

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

		this.addCommand({
			id: 'show-performance-metrics',
			name: 'Show performance metrics',
			callback: () => this.showPerformanceMetrics()
		});

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

		this.setupFloatingButton();

		// Cache clearing is now handled after each file modification
		// No need for aggressive periodic clearing
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
			const positionInfo = ContextProcessor.processContext(range, selectedText, file.path);

			if (!positionInfo) {
				new Notice("Could not determine text position.");
				return;
			}

			const content = await this.app.vault.read(file);
			const initialMtime = file.stat.mtime;

			// Use mtime as content hash to prevent stale cache
			const contentHash = initialMtime.toString();
			const isHighlighted = HighlightDetector.isHighlighted(content, selectedText, positionInfo, file.path, contentHash);

			if (ReadingModeHighlighter.debugMode) {
				console.log(`[ReadingModeHighlighter] Selected: "${selectedText}"`);
				console.log(`[ReadingModeHighlighter] File-based highlight status: ${isHighlighted}`);
			}

			const result = this.processHighlightToggle(content, selectedText, positionInfo, isHighlighted);

			if (result.success && result.newContent) {
				const currentFile = this.app.vault.getAbstractFileByPath(file.path);
				if (currentFile instanceof TFile && currentFile.stat.mtime === initialMtime) {
					await this.app.vault.modify(file, result.newContent);

					// Critical: Clear all caches after file modification
					HighlightDetector.clearCache();
					ContextProcessor.clearCache();

					new Notice(`Highlight ${result.action}.`);

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

	private addHighlightOptimized(
		content: string,
		selectedText: string,
		positionInfo: PositionInfo
	): ToggleResult {
		const highlightedVersion = `==${selectedText}==`;

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

			const matchIndex = match.index;
			const matchLength = match[0].length;
			const newContent = content.substring(0, matchIndex) + replacement + content.substring(matchIndex + matchLength);
			const action = matchedText === highlightedVersion ? "removed" : "added";

			return Object.freeze({ success: true, newContent, action });
		}

		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];
				const textIndex = line.indexOf(selectedText);

				if (textIndex !== -1) {
					lines[lineIndex] = line.substring(0, textIndex) + highlightedVersion + line.substring(textIndex + selectedText.length);
					return Object.freeze({
						success: true,
						newContent: lines.join('\n'),
						action: "added"
					});
				}
			}
		}

		const globalTextRegex = RegexCache.getRegex(escapedText);
		const globalHighlightedRegex = RegexCache.getRegex(escapedHighlighted);

		const allMatches = content.match(globalTextRegex);
		const allHighlightedMatches = content.match(globalHighlightedRegex);

		const plainTextCount = allMatches?.length || 0;
		const highlightedCount = allHighlightedMatches?.length || 0;
		const totalInstances = plainTextCount + highlightedCount;

		if (plainTextCount === 1 && totalInstances === 1) {
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

		const escapedBefore = RegexCache.getEscapedText(positionInfo.contextBefore);
		const escapedHighlighted = RegexCache.getEscapedText(highlightedVersion);
		const escapedAfter = RegexCache.getEscapedText(positionInfo.contextAfter);

		const exactPattern = `${escapedBefore}${escapedHighlighted}${escapedAfter}`;
		const exactRegex = RegexCache.getRegex(exactPattern);

		const exactMatch = exactRegex.exec(content);
		if (exactMatch) {
			const replacement = `${positionInfo.contextBefore}${selectedText}${positionInfo.contextAfter}`;
			const matchIndex = exactMatch.index;
			const matchLength = exactMatch[0].length;
			const newContent = content.substring(0, matchIndex) + replacement + content.substring(matchIndex + matchLength);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		if (positionInfo.lineNumber !== undefined) {
			const lines = content.split('\n');
			const lineIndex = positionInfo.lineNumber;

			if (Number.isInteger(lineIndex) && lineIndex >= 0 && lineIndex < lines.length) {
				const line = lines[lineIndex];
				const highlightIndex = line.indexOf(highlightedVersion);

				if (highlightIndex !== -1) {
					lines[lineIndex] = line.substring(0, highlightIndex) + selectedText + line.substring(highlightIndex + highlightedVersion.length);
					return Object.freeze({
						success: true,
						newContent: lines.join('\n'),
						action: "removed"
					});
				}
			}
		}

		const globalHighlightedRegex = RegexCache.getRegex(escapedHighlighted);
		const allHighlightedMatches = content.match(globalHighlightedRegex);

		if (allHighlightedMatches?.length === 1) {
			const newContent = content.replace(globalHighlightedRegex, () => selectedText);
			return Object.freeze({ success: true, newContent, action: "removed" });
		}

		return Object.freeze({
			success: false,
			error: "Could not safely remove highlight. Multiple instances found."
		});
	}

	private handleEditingModeOptimized(editor: Editor): void {
		const rawSelection = editor.getSelection();
		const selection = rawSelection.trim();

		if (!selection) {
			new Notice(rawSelection.length > 0 ?
				"Cannot highlight whitespace-only text." :
				"Please select text to highlight first.");
			return;
		}

		const selectionStart = editor.getCursor("from");
		const selectionEnd = editor.getCursor("to");

		const isMultiLine = selectionStart.line !== selectionEnd.line;

		if (isMultiLine) {
			this.handleMultiLineHighlight(editor, selection, selectionStart, selectionEnd);
		} else {
			this.handleSingleLineHighlight(editor, selection, selectionStart, selectionEnd);
		}
	}

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
			const newFrom = { line: selectionStart.line, ch: beforeStartPos };
			const newTo = { line: selectionEnd.line, ch: afterEndPos };
			editor.setSelection(newFrom, newTo);
			editor.replaceSelection(selection);
			new Notice("Highlight removed.");
		} else if (selection.startsWith('==') && selection.endsWith('==') && selection.length > 4) {
			const innerText = selection.slice(2, -2);
			editor.replaceSelection(innerText);
			new Notice("Highlight removed.");
		} else {
			editor.replaceSelection(`==${selection}==`);
			new Notice("Highlight added.");
		}
	}

	private handleMultiLineHighlight(
		editor: Editor,
		selection: string,
		selectionStart: { line: number; ch: number },
		selectionEnd: { line: number; ch: number }
	): void {
		const containsHighlightMarkers = selection.includes('==');

		if (containsHighlightMarkers) {
			if (selection.startsWith('==') && selection.endsWith('==')) {
				const innerText = selection.slice(2, -2);
				editor.replaceSelection(innerText);
				new Notice("Highlight removed.");
				return;
			}

			const firstLine = editor.getLine(selectionStart.line);
			const lastLine = editor.getLine(selectionEnd.line);

			const beforeStartPos = Math.max(0, selectionStart.ch - 2);
			const afterEndPos = Math.min(lastLine.length, selectionEnd.ch + 2);

			const beforeMarker = firstLine.substring(beforeStartPos, selectionStart.ch);
			const afterMarker = lastLine.substring(selectionEnd.ch, afterEndPos);

			if (beforeMarker === '==' && afterMarker === '==') {
				const newFrom = { line: selectionStart.line, ch: beforeStartPos };
				const newTo = { line: selectionEnd.line, ch: afterEndPos };
				editor.setSelection(newFrom, newTo);
				editor.replaceSelection(selection);
				new Notice("Highlight removed.");
				return;
			}
		}

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

	private setupFloatingButton(): void {
		this.floatingButton = document.createElement('div');
		this.floatingButton.addClass('highlight-floating-button');
		this.floatingButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;
		this.floatingButton.style.display = 'none';
		document.body.appendChild(this.floatingButton);

		this.floatingButton.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView && activeView.getMode() === 'preview') {
				this.handleReadingModeOptimized(activeView);
			}
			this.hideFloatingButton();
		});

		this.registerDomEvent(document, 'mouseup', (evt: MouseEvent) => {
			setTimeout(() => this.handleSelectionChange(evt), 10);
		});

		this.registerDomEvent(document, 'mousedown', (evt: MouseEvent) => {
			if (this.floatingButton && !this.floatingButton.contains(evt.target as Node)) {
				this.hideFloatingButton();
			}
		});

		this.registerDomEvent(document, 'touchend', (evt: TouchEvent) => {
			setTimeout(() => {
				const touch = evt.changedTouches[0];
				if (touch) {
					this.handleSelectionChange({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent);
				}
			}, 300);
		});
	}

	private handleSelectionChange(evt: MouseEvent): void {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || activeView.getMode() !== 'preview') {
			return;
		}

		const selection = window.getSelection();
		const selectedText = selection?.toString().trim();

		if (!selectedText || !selection?.rangeCount) {
			this.hideFloatingButton();
			return;
		}

		const range = selection.getRangeAt(0);
		const rect = range.getBoundingClientRect();

		this.showFloatingButton(rect.left + rect.width / 2, rect.top - 10);
	}

	private showFloatingButton(x: number, y: number): void {
		if (!this.floatingButton) return;

		const buttonWidth = 32;
		const buttonHeight = 32;

		let posX = x - buttonWidth / 2;
		let posY = y - buttonHeight;

		posX = Math.max(8, Math.min(posX, window.innerWidth - buttonWidth - 8));
		posY = Math.max(8, posY);

		this.floatingButton.style.left = `${posX}px`;
		this.floatingButton.style.top = `${posY}px`;
		this.floatingButton.style.display = 'flex';
	}

	private hideFloatingButton(): void {
		if (this.floatingButton) {
			this.floatingButton.style.display = 'none';
		}
	}

	onunload(): void {
		if (this.floatingButton) {
			this.floatingButton.remove();
			this.floatingButton = null;
		}

		RegexCache.clearCache();
		ContextProcessor.clearCache();
		HighlightDetector.clearCache();
	}
}
