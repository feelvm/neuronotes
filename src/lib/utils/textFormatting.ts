export function applyFormat(command: string, value?: string): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return false;
    }

    try {
        return document.execCommand(command, false, value);
    } catch (error) {
        console.warn(`Failed to apply format ${command}:`, error);
        return false;
    }
}

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
            const span = document.createElement('span');
            span.style.fontSize = `${newSize}px`;
            
            const contents = range.extractContents();
            span.appendChild(contents);
            range.insertNode(span);
            
            range.selectNodeContents(span);
            selection.removeAllRanges();
            selection.addRange(range);
            
            return newSize;
        } catch (error) {
            console.warn('Failed to modify font size:', error);
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

export function handlePlainTextPaste(event: ClipboardEvent): boolean {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    
    try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const textNode = document.createTextNode(text);
            range.insertNode(textNode);
            
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);
            
            return true;
        }
    } catch (error) {
        console.warn('Modern paste failed, using fallback:', error);
    }
    
    try {
        return document.execCommand('insertText', false, text);
    } catch (error) {
        console.error('Paste operation failed:', error);
        return false;
    }
}

