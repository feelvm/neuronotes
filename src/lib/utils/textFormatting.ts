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

const URL_REGEX = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.(?:[a-zA-Z]{2,})(?:\/[^\s<>"']*)?)/gi;

/**
 * Converts URLs in text to clickable links
 */
export function linkifyText(text: string): string {
    if (!text) return text;
    return text.replace(URL_REGEX, (url) => {
        let href = url;
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
            href = 'https://' + href;
        }
        const escapedUrl = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="note-link" style="color: #4a9eff; text-decoration: underline; cursor: pointer;">${escapedUrl}</a>`;
    });
}

/**
 * Converts plain text nodes containing URLs to links in the DOM
 */
export function linkifyNode(node: Node): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const matches = Array.from(text.matchAll(URL_REGEX));
        
        if (matches.length > 0) {
            const parent = node.parentNode;
            if (!parent) return;
            
            let lastIndex = 0;
            const fragment = document.createDocumentFragment();
            
            for (const match of matches) {
                const matchIndex = match.index!;
                const matchText = match[0];
                
                if (matchIndex > lastIndex) {
                    const beforeText = text.substring(lastIndex, matchIndex);
                    if (beforeText) {
                        fragment.appendChild(document.createTextNode(beforeText));
                    }
                }
                
                let href = matchText;
                if (!href.startsWith('http://') && !href.startsWith('https://')) {
                    href = 'https://' + href;
                }
                
                const link = document.createElement('a');
                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'note-link';
                link.textContent = matchText;
                link.style.color = '#4a9eff';
                link.style.textDecoration = 'underline';
                link.style.cursor = 'pointer';
                
                fragment.appendChild(link);
                lastIndex = matchIndex + matchText.length;
            }
            
            if (lastIndex < text.length) {
                const afterText = text.substring(lastIndex);
                if (afterText) {
                    fragment.appendChild(document.createTextNode(afterText));
                }
            }
            
            parent.replaceChild(fragment, node);
        }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        if (element.tagName === 'A' || element.classList.contains('note-link')) {
            return;
        }
        
        const children = Array.from(node.childNodes);
        for (const child of children) {
            linkifyNode(child);
        }
    }
}

/**
 * Scans the editor content and converts any plain text URLs to links
 */
export function linkifyEditor(editorDiv: HTMLElement): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!editorDiv) return;
    
    URL_REGEX.lastIndex = 0;
    
    const walker = document.createTreeWalker(
        editorDiv,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: (node) => {
                let parent = node.parentNode;
                while (parent && parent !== editorDiv) {
                    if (parent instanceof Element && 
                        (parent.tagName === 'A' || parent.classList.contains('note-link'))) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    parent = parent.parentNode;
                }
                if (node.textContent && node.textContent.trim().length > 0) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        }
    );
    
    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            const text = node.textContent.trim();
            URL_REGEX.lastIndex = 0;
            if (text.length > 0 && URL_REGEX.test(text)) {
                textNodes.push(node as Text);
            }
        }
    }
    
    for (let i = textNodes.length - 1; i >= 0; i--) {
        const textNode = textNodes[i];
        if (textNode.parentNode && textNode.textContent) {
            let parent: ParentNode | null = textNode.parentNode;
            let isInsideLink = false;
            while (parent && parent !== editorDiv) {
                if (parent instanceof Element && 
                    (parent.tagName === 'A' || parent.classList.contains('note-link'))) {
                    isInsideLink = true;
                    break;
                }
                parent = parent.parentNode;
            }
            if (!isInsideLink && textNode.textContent.trim().length > 0) {
                linkifyNode(textNode);
            }
        }
    }
}

export function handlePlainTextPaste(event: ClipboardEvent): boolean {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return false;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text) return false;
    
    try {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            
            URL_REGEX.lastIndex = 0;
            const hasUrls = URL_REGEX.test(text);
            
            if (hasUrls) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = linkifyText(text);
                
                const fragment = document.createDocumentFragment();
                while (tempDiv.firstChild) {
                    fragment.appendChild(tempDiv.firstChild);
                }
                range.insertNode(fragment);
                
                if (fragment.lastChild) {
                    range.setStartAfter(fragment.lastChild);
                    range.setEndAfter(fragment.lastChild);
                } else {
                    range.collapse(false);
                }
            } else {
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
            }
            
            selection.removeAllRanges();
            selection.addRange(range);
            
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
                range.commonAncestorContainer.parentElement?.dispatchEvent(inputEvent);
            } else {
                (range.commonAncestorContainer as Element).dispatchEvent(inputEvent);
            }
            
            return true;
        }
    } catch (error) {
        console.warn('Modern paste failed, using fallback:', error);
    }
    
    try {
        const result = document.execCommand('insertText', false, text);
        return result;
    } catch (error) {
        console.error('Paste operation failed:', error);
        return false;
    }
}

