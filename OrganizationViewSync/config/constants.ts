/**
 * Configuration constants for the OrganizationViewSync control
 */

/**
 * CSV Column names - used for mapping CSV headers to internal field names
 */
export const CSV_COLUMNS = {
    GLOBAL_ID: 'Global ID',
    FIRST_NAME: 'First Name',
    LAST_NAME: 'Last Name',
    EMAIL: 'Business  Email Information Email Address', // NOTE: TWO spaces between "Business" and "Email"
    MANAGER_GLOBAL_ID: 'Manager User Sys ID',
    MANAGER_NAME: 'Manager',
    OPERATING_ENTITY: 'Operating Entity',
    DEVICE_USER: 'Device User'
} as const;

/**
 * Column name aliases for flexible CSV header matching
 * Maps normalized column names to the canonical CSV_COLUMNS keys
 */
export const COLUMN_ALIASES: Record<string, string[]> = {
    [CSV_COLUMNS.GLOBAL_ID]: ['global id', 'globalid', 'global_id', 'employee id', 'employeeid'],
    [CSV_COLUMNS.FIRST_NAME]: ['first name', 'firstname', 'first_name', 'fname', 'given name'],
    [CSV_COLUMNS.LAST_NAME]: ['last name', 'lastname', 'last_name', 'lname', 'surname', 'family name'],
    [CSV_COLUMNS.EMAIL]: [
        'business email information email address',
        'email',
        'email address',
        'primary email',
        'work email',
        'business email'
    ],
    [CSV_COLUMNS.MANAGER_GLOBAL_ID]: [
        'manager user sys id',
        'manager id',
        'managerid',
        'manager global id',
        'manager user id',
        'Manager Global ID'  // Exact case match as fallback
    ],
    [CSV_COLUMNS.MANAGER_NAME]: ['manager', 'manager name', 'reports to'],
    [CSV_COLUMNS.OPERATING_ENTITY]: ['operating entity', 'entity', 'department', 'business unit'],
    [CSV_COLUMNS.DEVICE_USER]: ['device user', 'deviceuser', 'device_user']
};

/**
 * Required columns that must be present in the CSV file
 */
export const REQUIRED_COLUMNS = [
    CSV_COLUMNS.GLOBAL_ID,
    CSV_COLUMNS.FIRST_NAME,
    CSV_COLUMNS.LAST_NAME
] as const;

/**
 * Dataverse entity and field names
 */
export const DV_CONFIG = {
    ENTITY_NAME: 'ag_organizationview',
    ENTITY_PLURAL: 'ag_organizationviews',
    FIELDS: {
        ID: 'ag_organizationviewid',
        GLOBAL_ID: 'ag_globalid',
        FIRST_NAME: 'ag_firstname',
        LAST_NAME: 'ag_lastname',
        FULL_NAME: 'ag_fullname',
        EMAIL: 'ag_primaryemail',
        MANAGER_GLOBAL_ID: 'ag_managerglobalid',
        MANAGER_LOOKUP: 'ag_manager',
        MANAGER_LOOKUP_VALUE: '_ag_manager_value',
        USER_LOOKUP: 'ag_user',
        USER_LOOKUP_VALUE: '_ag_user_value',
        // Lookup field schema names for OData bind operations
        // IMPORTANT: Use schema name (proper casing), not logical name (lowercase)
        MANAGER_NAV_PROPERTY: 'ag_Manager',
        USER_NAV_PROPERTY: 'ag_User'
    }
} as const;

/**
 * Systemuser entity configuration for user lookup
 */
export const SYSTEMUSER_CONFIG = {
    ENTITY_NAME: 'systemuser',
    ENTITY_PLURAL: 'systemusers',
    FIELDS: {
        ID: 'systemuserid',
        EMAIL: 'internalemailaddress'
    }
} as const;

/**
 * Batch processing configuration
 */
export const BATCH_CONFIG = {
    /** Number of concurrent API requests */
    CONCURRENCY: 25,
    /** Maximum retry attempts for failed requests */
    RETRY_ATTEMPTS: 3,
    /** Base delay in milliseconds for retry backoff */
    RETRY_DELAY_MS: 1000,
    /** HTTP status codes that should trigger a retry */
    RETRYABLE_STATUS_CODES: [429, 500, 503, 504],
    /** Page size for Dataverse queries */
    PAGE_SIZE: 5000
} as const;
