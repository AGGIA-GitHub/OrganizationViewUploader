/**
 * Type definitions for the OrganizationViewSync control
 */

/**
 * Record structure from Dataverse
 */
export interface DataverseRecord {
    ag_organizationviewid: string;
    ag_globalid: string;
    ag_firstname: string;
    ag_lastname: string;
    ag_fullname: string;
    ag_primaryemail: string;
    ag_managerglobalid: string;
    /** Lookup ID if manager relationship is set */
    ag_managerid: string;
}

/**
 * Sync status for employee records
 */
export type SyncStatus = 'synced' | 'not-synced' | 'modified' | 'error';

/**
 * Employee record from CSV with sync metadata
 */
export interface EmployeeRecord extends Record<string, unknown> {
    'Global ID': string;
    'First Name': string;
    'Last Name': string;
    'Business  Email Information Email Address': string;
    'Manager User Sys ID': string;
    'Manager': string;
    'Operating Entity': string;
    'Device User': string;
    syncStatus?: SyncStatus;
    syncError?: string;
    dataverseId?: string;
}

/**
 * Result from batch processing operations
 */
export interface BatchResult<T> {
    results: (T | Error)[];
    succeeded: number;
    failed: number;
}

/**
 * Result from sync operations
 */
export interface SyncResult {
    created: number;
    updated: number;
    skipped: number;
    errors: string[];
}

/**
 * Result from hierarchy sync operations
 */
export interface HierarchySyncResult {
    updated: number;
    skipped: number;
    errors: string[];
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (progress: number, message: string) => void;

/**
 * Column mapping from actual CSV headers to expected column names
 */
export type ColumnMapping = Map<string, string>;
