/**
 * CSV parsing utilities with support for RFC 4180 compliant CSV files
 */

import { CSV_COLUMNS, COLUMN_ALIASES, REQUIRED_COLUMNS } from '../config/constants';
import { normalizeColumnName } from './helpers';
import type { ColumnMapping } from '../types';

/**
 * Parse a single CSV line handling quoted fields correctly
 * Supports:
 * - Quoted fields containing commas: "Smith, Jr."
 * - Escaped quotes within fields: "He said ""Hello"""
 * - Mixed quoted and unquoted fields
 */
export function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote ("") - add single quote and skip next
                current += '"';
                i++;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Don't forget the last field
    result.push(current.trim());
    return result;
}

/**
 * Create a mapping from expected column names to actual CSV headers
 * Uses flexible matching via normalization and aliases
 *
 * @param actualHeaders Headers found in the CSV file
 * @returns Map from expected column name to actual header name
 */
export function createColumnMapping(actualHeaders: string[]): ColumnMapping {
    const mapping = new Map<string, string>();
    const normalizedActual = actualHeaders.map(h => ({
        original: h,
        normalized: normalizeColumnName(h)
    }));

    for (const [expectedCol, aliases] of Object.entries(COLUMN_ALIASES)) {
        const normalizedAliases = aliases.map(normalizeColumnName);

        for (const { original, normalized } of normalizedActual) {
            if (
                normalizedAliases.includes(normalized) ||
                normalized === normalizeColumnName(expectedCol)
            ) {
                mapping.set(expectedCol, original);
                break;
            }
        }
    }

    return mapping;
}

/**
 * Validate that all required columns are present in the mapping
 *
 * @param mapping Column mapping to validate
 * @param actualHeaders Original headers for error messages
 * @throws Error if required columns are missing
 */
export function validateRequiredColumns(
    mapping: ColumnMapping,
    actualHeaders: string[]
): void {
    const missingColumns = REQUIRED_COLUMNS.filter(col => !mapping.has(col));

    if (missingColumns.length > 0) {
        throw new Error(
            `Required columns not found: ${missingColumns.join(', ')}. ` +
            `Available columns: ${actualHeaders.join(', ')}`
        );
    }
}

/**
 * Parse CSV file content with proper handling of quoted fields
 * and flexible column name matching
 *
 * @param text Raw CSV text content
 * @returns Array of parsed records with standardized column names
 */
export function parseCSV(text: string): Record<string, unknown>[] {
    // Split into lines, handling both \n and \r\n
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return [];

    // Parse header line
    const headers = parseCSVLine(lines[0]);

    // Create column mapping for flexible matching
    const columnMapping = createColumnMapping(headers);

    // Log mapping for debugging
    console.log('Column mapping:', Object.fromEntries(columnMapping));

    // Validate required columns
    validateRequiredColumns(columnMapping, headers);

    // Warn about unmapped columns
    const mappedHeaders = new Set(columnMapping.values());
    const unmappedHeaders = headers.filter(h => !mappedHeaders.has(h));
    if (unmappedHeaders.length > 0) {
        console.warn(`Unmapped columns (will be preserved): ${unmappedHeaders.join(', ')}`);
    }

    // Parse data rows
    const data: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);

        // Skip empty rows
        if (values.length === 1 && values[0] === '') {
            continue;
        }

        const row: Record<string, unknown> = {};

        // Map values to expected column names
        for (const [expectedCol, actualCol] of columnMapping) {
            const colIndex = headers.indexOf(actualCol);
            if (colIndex !== -1 && colIndex < values.length) {
                row[expectedCol] = values[colIndex];
            } else {
                row[expectedCol] = '';
            }
        }

        // Also preserve original columns that weren't mapped
        headers.forEach((header, index) => {
            if (index < values.length && !(header in row)) {
                row[header] = values[index];
            }
        });

        data.push(row);
    }

    return data;
}

/**
 * Deduplicate records by Global ID, keeping the last occurrence
 *
 * @param records Array of records to deduplicate
 * @param globalIdColumn Column name containing the Global ID
 * @returns Deduplicated records and list of duplicate IDs found
 */
export function deduplicateRecords<T extends Record<string, unknown>>(
    records: T[],
    globalIdColumn: string = CSV_COLUMNS.GLOBAL_ID
): { records: T[]; duplicates: string[] } {
    const seenGlobalIds = new Set<string>();
    const duplicates: string[] = [];

    // Process in reverse to keep last occurrence
    const deduplicated = [...records].reverse().filter(record => {
        const rawValue = record[globalIdColumn];
        let globalId = '';
        if (rawValue !== null && rawValue !== undefined) {
            globalId = (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean')
                ? String(rawValue).trim()
                : '';
        }

        if (!globalId) {
            console.warn('Record without Global ID found, will be included');
            return true;
        }

        if (seenGlobalIds.has(globalId)) {
            duplicates.push(globalId);
            return false;
        }

        seenGlobalIds.add(globalId);
        return true;
    }).reverse();

    if (duplicates.length > 0) {
        console.warn(`Removed ${duplicates.length} duplicate records by Global ID`);
    }

    return { records: deduplicated, duplicates };
}

/**
 * Normalize raw data (from CSV or XLSX) by applying column mapping
 * This ensures consistent column names regardless of input format
 *
 * @param rawData Array of records with original column names
 * @returns Array of records with normalized column names matching CSV_COLUMNS
 */
export function normalizeColumnNames(rawData: Record<string, unknown>[]): Record<string, unknown>[] {
    if (rawData.length === 0) return [];

    // Get actual headers from the first record
    const actualHeaders = Object.keys(rawData[0]);

    // Create column mapping
    const columnMapping = createColumnMapping(actualHeaders);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  COLUMN MAPPING                                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('Original headers:', actualHeaders.join(', '));
    console.log('Mapped columns:', Object.fromEntries(columnMapping));

    // Validate required columns
    validateRequiredColumns(columnMapping, actualHeaders);

    // Warn about unmapped columns
    const mappedHeaders = new Set(columnMapping.values());
    const unmappedHeaders = actualHeaders.filter(h => !mappedHeaders.has(h));
    if (unmappedHeaders.length > 0) {
        console.warn(`Unmapped columns (will be preserved): ${unmappedHeaders.join(', ')}`);
    }

    // Transform each record
    return rawData.map(record => {
        const normalizedRecord: Record<string, unknown> = {};

        // Map values to expected column names
        for (const [expectedCol, actualCol] of columnMapping) {
            normalizedRecord[expectedCol] = record[actualCol] ?? '';
        }

        // Also preserve original columns that weren't mapped
        for (const header of actualHeaders) {
            if (!mappedHeaders.has(header)) {
                normalizedRecord[header] = record[header];
            }
        }

        return normalizedRecord;
    });
}
