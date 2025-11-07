// Modern text formatting utilities to replace deprecated document.execCommand
// Falls back to execCommand for older browsers

/**
 * Apply formatting to selected text in a contenteditable element
 * Uses modern APIs where available, falls back to execCommand
 */
export function applyFormat(command: string, value?: string): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return false;
    }

    try {
        // For most formatting commands, we still need to use execCommand
        // as there's no direct modern replacement
        // However, we add better error handling and validation
        return document.execCommand(command, false, value);
    } catch (error) {
        console.warn(`Failed to apply format ${command}:`, error);
        return false;
    }
}

/**
 * Modify font size of selected text
 * A safer alternative to using execCommand for fontSize
 */
export function modifyFontSize(editorDiv: HTMLElement, amount: number): number {
    if (!editorDiv) return 14;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return 14;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return 14;

    const parentElement =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : (range.commonAncestorContainer as HTMLElement);

    if (parentElement && editorDiv.contains(parentElement)) {
        const currentSize = window.getComputedStyle(parentElement).fontSize || '14px';
        const newSize = Math.max(8, parseInt(currentSize) + amount);

        try {
            // Create a span wrapper for the selected text
            const span = document.createElement('span');
            span.style.fontSize = `${newSize}px`;
            
            // Extract the selected content and wrap it
            const contents = range.extractContents();
            span.appendChild(contents);
            range.insertNode(span);
            
            // Restore selection
            range.selectNodeContents(span);
            selection.removeAllRanges();
            selection.addRange(range);
            
            return newSize;
        } catch (error) {
            console.warn('Failed to modify font size:', error);
            // Fallback to old method
            try {
                document.execCommand('fontSize', false, '1');
                const fontElements = editorDiv.getElementsByTagName('font');
                for (const element of Array.from(fontElements)) {
                    if (element.getAttribute('size') === '1') {
                        element.removeAttribute('size');
                        element.style.fontSize = `${newSize}px`;
                    }
                }
                return newSize;
            } catch (fallbackError) {
                console.error('Font size fallback also failed:', fallbackError);
                return 14;
            }
        }
    }
    return 14;
}

/**
 * Get the current font size at the cursor position
 */
export function getSelectedFontSize(editorDiv: HTMLElement): number {
    if (!editorDiv) return 14;

    const selection = window.getSelection();
    if (!selection?.rangeCount) return 14;

    const range = selection.getRangeAt(0);
    const parentElement =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? range.commonAncestorContainer.parentElement
            : (range.commonAncestorContainer as HTMLElement);

    if (parentElement && editorDiv.contains(parentElement)) {
        const sizeStr = window.getComputedStyle(parentElement).fontSize || '14px';
        return parseInt(sizeStr);
    }
    
    return 14;
}

/**
 * Handle paste to insert plain text only (prevents formatting issues)
 */
export function handlePlainTextPaste(event: ClipboardEvent): boolean {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    
    try {
        // Try modern approach first
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            
            // Move cursor to end of inserted text
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
            
            return true;
        }
    } catch (error) {
        console.warn('Modern paste failed, using fallback:', error);
    }
    
    // Fallback to execCommand
    try {
        return document.execCommand('insertText', false, text);
    } catch (error) {
        console.error('Paste operation failed:', error);
        return false;
    }
}

