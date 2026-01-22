/**
 * Helper utility functions for data processing
 */

/**
 * Safely converts unknown value to string and trims whitespace
 */
export function getStringValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value).trim();
    }
    // For objects, try to get a meaningful string
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value).trim();
}

/**
 * Safely converts email value to lowercase trimmed string
 */
export function getEmailValue(value: unknown): string {
    const str = getStringValue(value);
    return str.toLowerCase();
}

/**
 * Checks if value is non-empty string after trimming
 */
export function hasValue(value: unknown): boolean {
    return getStringValue(value) !== '';
}

/**
 * Creates full name from first and last name
 */
export function createFullName(firstName: string, lastName: string): string {
    const first = getStringValue(firstName);
    const last = getStringValue(lastName);
    return `${first} ${last}`.trim();
}

/**
 * Normalize column name for flexible matching
 * - Converts to lowercase
 * - Collapses multiple whitespace to single space
 * - Trims whitespace
 */
export function normalizeColumnName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, ' ').trim();
}
