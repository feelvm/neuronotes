export function debounce<T extends (...args: any[]) => any>(func: T, timeout = 300) {
    let timer: ReturnType<typeof setTimeout>;
    let pendingArgs: Parameters<T> | null = null;
    let pendingPromise: Promise<any> | null = null;

    const debounced = (...args: Parameters<T>) => {
        pendingArgs = args;
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (pendingArgs) {
                const result = func(...pendingArgs);
                if (result && typeof result.then === 'function') {
                    pendingPromise = result;
                    result.finally(() => {
                        if (pendingPromise === result) {
                            pendingPromise = null;
                        }
                    });
                }
            }
            pendingArgs = null;
        }, timeout);
    };

    debounced.flush = () => {
        clearTimeout(timer);
        if (pendingArgs) {
            const result = func(...pendingArgs);
            pendingArgs = null;
            if (result && typeof result.then === 'function') {
                pendingPromise = result;
                return result.finally(() => {
                    if (pendingPromise === result) {
                        pendingPromise = null;
                    }
                });
            }
            return Promise.resolve(result);
        }
        if (pendingPromise) {
            return pendingPromise;
        }
        return Promise.resolve();
    };

    return debounced;
}

