// Date utility functions to handle timezone issues properly

/**
 * Creates a date from YYYY-MM-DD string in local timezone
 * Fixes the common timezone offset bug when using Date constructor
 */
export function localDateFromYMD(ymd: string): Date {
    const [year, month, day] = ymd.split('-').map(Number);
    return new Date(year, month - 1, day);
}

/**
 * Formats date as YYYY-MM-DD
 */
export function ymd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Formats date as DD-MM-YYYY
 */
export function dmy(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

/**
 * Gets the start of the week for a given date
 */
export function startOfWeek(date: Date, weekStartsOn = 1): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

