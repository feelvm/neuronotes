export function debounce<T extends (...args: any[]) => any>(func: T, timeout = 300) {
    let timer: ReturnType<typeof setTimeout>;
    let pendingArgs: Parameters<T> | null = null;

    const debounced = (...args: Parameters<T>) => {
        pendingArgs = args;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (pendingArgs) {
                func(...pendingArgs);
            }
            pendingArgs = null;
        }, timeout);
    };

    debounced.flush = () => {
        clearTimeout(timer);
        if (pendingArgs) {
            func(...pendingArgs);
            pendingArgs = null;
        }
    };

    return debounced;
}

