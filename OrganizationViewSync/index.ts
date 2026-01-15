import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { HelloWorld, IHelloWorldProps } from "./HelloWorld";
import * as React from "react";
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/**
 * CSV Column names (exact match required unless alias mapping applies)
 */
const CSV_COLUMNS = {
    GLOBAL_ID: 'Global ID',
    FIRST_NAME: 'First Name',
    LAST_NAME: 'Last Name',
    EMAIL: 'Business  Email Information Email Address', // NOTE: TWO spaces between "Business" and "Email"
    POSITION_TITLE: 'Position Title',
    MANAGER_GLOBAL_ID: 'Manager Global ID',
    MANAGER_NAME: 'Manager Name'
} as const;

const CSV_COLUMN_ALIASES: Record<keyof typeof CSV_COLUMNS, string[]> = {
    GLOBAL_ID: [CSV_COLUMNS.GLOBAL_ID],
    FIRST_NAME: [CSV_COLUMNS.FIRST_NAME],
    LAST_NAME: [CSV_COLUMNS.LAST_NAME],
    EMAIL: [CSV_COLUMNS.EMAIL],
    POSITION_TITLE: [CSV_COLUMNS.POSITION_TITLE],
    MANAGER_GLOBAL_ID: [CSV_COLUMNS.MANAGER_GLOBAL_ID, 'Manager User Sys ID'],
    MANAGER_NAME: [CSV_COLUMNS.MANAGER_NAME, 'Manager']
};

const REQUIRED_COLUMNS: (keyof typeof CSV_COLUMNS)[] = [
    'GLOBAL_ID',
    'FIRST_NAME',
    'LAST_NAME',
    'EMAIL',
    'POSITION_TITLE',
    'MANAGER_GLOBAL_ID'
];

/**
 * Dataverse entity and field names
 */
const DV_CONFIG = {
    ENTITY_NAME: 'ag_organizationview',
    ENTITY_PLURAL: 'ag_organizationviews',
    FIELDS: {
        ID: 'ag_organizationviewid',
        GLOBAL_ID: 'ag_globalid',
        FIRST_NAME: 'ag_firstname',
        LAST_NAME: 'ag_lastname',
        FULL_NAME: 'ag_fullname',
        EMAIL: 'ag_primaryemail',
        ROLE: 'ag_role',
        MANAGER_GLOBAL_ID: 'ag_managerglobalid',
        MANAGER_LOOKUP: 'ag_manager',
        MANAGER_LOOKUP_VALUE: '_ag_manager_value'
    }
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Record structure from Dataverse
 */
interface DataverseRecord {
    ag_organizationviewid: string;
    ag_globalid: string;
    ag_firstname: string;
    ag_lastname: string;
    ag_fullname: string;
    ag_primaryemail: string;
    ag_role: string;
    ag_managerglobalid: string;
    ag_managerid: string; // Lookup ID if manager relationship is set
}

/**
 * Employee record from CSV with sync metadata
 */
interface EmployeeRecord extends Record<string, unknown> {
    'Global ID': string;
    'First Name': string;
    'Last Name': string;
    'Business  Email Information Email Address': string;
    'Position Title': string;
    'Manager Global ID': string;
    'Manager Name': string;
    syncStatus?: 'synced' | 'not-synced' | 'modified';
    dataverseId?: string;
}

type ColumnKey = keyof typeof CSV_COLUMNS;
type ColumnMap = Record<ColumnKey, string | null>;

interface ParseResult {
    records: Record<string, unknown>[];
    headers: string[];
}


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Safely converts unknown value to string and trims whitespace
 */
function getStringValue(value: unknown): string {
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
function getEmailValue(value: unknown): string {
    const str = getStringValue(value);
    return str.toLowerCase();
}

/**
 * Checks if value is non-empty string after trimming
 */
function hasValue(value: unknown): boolean {
    return getStringValue(value) !== '';
}

/**
 * Creates full name from first and last name
 */
function createFullName(firstName: string, lastName: string): string {
    const first = getStringValue(firstName);
    const last = getStringValue(lastName);
    return `${first} ${last}`.trim();
}

function buildColumnMap(headers: string[]): ColumnMap {
    const normalizedHeaders = headers.map(header => header.trim());
    const columnMap = {} as ColumnMap;

    (Object.keys(CSV_COLUMNS) as ColumnKey[]).forEach((key) => {
        const aliases = CSV_COLUMN_ALIASES[key];
        const match = normalizedHeaders.find(header => aliases.includes(header)) ?? null;
        columnMap[key] = match;
    });

    return columnMap;
}

function validateHeaders(headers: string[], columnMap: ColumnMap): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedHeaders = headers.map(header => header.trim()).filter(header => header);

    const duplicateHeaders = normalizedHeaders.filter((header, index) => normalizedHeaders.indexOf(header) !== index);
    if (duplicateHeaders.length > 0) {
        const uniqueDuplicates = Array.from(new Set(duplicateHeaders));
        errors.push(`Duplicate column names detected: ${uniqueDuplicates.join(', ')}`);
    }

    const missingRequired = REQUIRED_COLUMNS.filter((key) => !columnMap[key]);
    if (missingRequired.length > 0) {
        errors.push(`Missing required columns: ${missingRequired.map(key => CSV_COLUMNS[key]).join(', ')}`);
    }

    const optionalMissing = (Object.keys(CSV_COLUMNS) as ColumnKey[])
        .filter((key) => !REQUIRED_COLUMNS.includes(key))
        .filter((key) => !columnMap[key]);
    if (optionalMissing.length > 0) {
        warnings.push(`Optional columns missing: ${optionalMissing.map(key => CSV_COLUMNS[key]).join(', ')}`);
    }

    (Object.keys(CSV_COLUMNS) as ColumnKey[]).forEach((key) => {
        const mappedHeader = columnMap[key];
        if (mappedHeader && mappedHeader !== CSV_COLUMNS[key]) {
            warnings.push(`Using alias "${mappedHeader}" for "${CSV_COLUMNS[key]}"`);
        }
    });

    return { errors, warnings };
}

function getColumnValue(record: Record<string, unknown>, columnMap: ColumnMap, key: ColumnKey): string {
    const column = columnMap[key];
    if (!column) return '';
    return getStringValue(record[column]);
}

function normalizeRecords(records: Record<string, unknown>[], columnMap: ColumnMap): EmployeeRecord[] {
    return records.map((record) => ({
        [CSV_COLUMNS.GLOBAL_ID]: getColumnValue(record, columnMap, 'GLOBAL_ID'),
        [CSV_COLUMNS.FIRST_NAME]: getColumnValue(record, columnMap, 'FIRST_NAME'),
        [CSV_COLUMNS.LAST_NAME]: getColumnValue(record, columnMap, 'LAST_NAME'),
        [CSV_COLUMNS.EMAIL]: getColumnValue(record, columnMap, 'EMAIL'),
        [CSV_COLUMNS.POSITION_TITLE]: getColumnValue(record, columnMap, 'POSITION_TITLE'),
        [CSV_COLUMNS.MANAGER_GLOBAL_ID]: getColumnValue(record, columnMap, 'MANAGER_GLOBAL_ID'),
        [CSV_COLUMNS.MANAGER_NAME]: getColumnValue(record, columnMap, 'MANAGER_NAME')
    }));
}

function validateRecords(records: EmployeeRecord[]): string[] {
    const errors: string[] = [];

    if (records.length > 500) {
        errors.push(`Row limit exceeded: ${records.length} records (max 500).`);
    }

    const missingIds: number[] = [];
    const seen = new Map<string, number>();
    const duplicates = new Set<string>();

    records.forEach((record, index) => {
        const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
        if (!hasValue(globalId)) {
            missingIds.push(index + 2);
            return;
        }
        if (seen.has(globalId)) {
            duplicates.add(globalId);
        } else {
            seen.set(globalId, index + 2);
        }
    });

    if (missingIds.length > 0) {
        const sample = missingIds.slice(0, 15).join(', ');
        errors.push(`Missing Global ID in rows: ${sample}${missingIds.length > 15 ? ', ...' : ''}`);
    }

    if (duplicates.size > 0) {
        const sample = Array.from(duplicates).slice(0, 15).join(', ');
        errors.push(`Duplicate Global ID values: ${sample}${duplicates.size > 15 ? ', ...' : ''}`);
    }

    return errors;
}

// ============================================================================
// MAIN CONTROL CLASS
// ============================================================================

export class OrganizationViewSync implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private context: ComponentFramework.Context<IInputs>;
    private width: number;
    private height: number;
    private dataverseRecords = new Map<string, DataverseRecord>();
    private csvRecords: EmployeeRecord[] = [];
    private csvColumnMap: ColumnMap | null = null;

    /**
     * Empty constructor.
     */
    constructor() {
        // Empty
    }

    /**
     * Used to initialize the control instance. Controls can kick off remote server calls and other initialization actions here.
     * Data-set values are not initialized here, use updateView.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to property names defined in the manifest, as well as utility functions.
     * @param notifyOutputChanged A callback method to alert the framework that the control has new outputs ready to be retrieved asynchronously.
     * @param state A piece of data that persists in one session for a single user. Can be set at any point in a controls life cycle by calling 'setControlState' in the Mode interface.
     */
    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.context = context;
        this.width = context.mode.allocatedWidth;
        this.height = context.mode.allocatedHeight;
        context.mode.trackContainerResize(true);
    }

    /**
     * Called when any value in the property bag has changed. This includes field values, data-sets, global values such as container height and width, offline status, control metadata values such as label, visible, etc.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to names defined in the manifest, as well as utility functions
     * @returns ReactElement root react element for the control
     */
    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        this.context = context;
        this.width = context.mode.allocatedWidth;
        this.height = context.mode.allocatedHeight;
        
        const props: IHelloWorldProps = { 
            onFileUpload: this.handleFileUpload.bind(this),
            onSynchronizeData: this.handleSynchronizeData.bind(this),
            onSynchronizeHierarchy: this.handleSynchronizeHierarchy.bind(this),
            width: this.width,
            height: this.height
        };
        
        return React.createElement(HelloWorld, props);
    }

    /**
     * Handle file upload
     */
    private async handleFileUpload(file: File, onProgress: (progress: number, message: string) => void): Promise<Record<string, unknown>[]> {
        try {
            onProgress(10, 'Reading file...');
            
            const extension = file.name.split('.').pop()?.toLowerCase();
            let parseResult: ParseResult;

            if (extension === 'csv') {
                const text = await file.text();
                parseResult = this.parseCSV(text);
            } else if (extension === 'xlsx' || extension === 'xls') {
                parseResult = await this.parseXLSX(file);
            } else {
                void this.context.navigation.openAlertDialog({
                    text: 'Unsupported file format. Please upload CSV, XLSX, or XLS file.',
                    confirmButtonLabel: "OK"
                });
                return [];
            }

            if (parseResult.records.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data rows found in the uploaded file.',
                    confirmButtonLabel: "OK"
                });
                this.csvRecords = [];
                this.csvColumnMap = null;
                return [];
            }

            const columnMap = buildColumnMap(parseResult.headers);
            const headerValidation = validateHeaders(parseResult.headers, columnMap);
            if (headerValidation.errors.length > 0) {
                void this.context.navigation.openAlertDialog({
                    text: `Invalid template:\n\n${headerValidation.errors.join('\n')}`,
                    confirmButtonLabel: "OK"
                });
                this.csvRecords = [];
                this.csvColumnMap = null;
                return [];
            }

            if (headerValidation.warnings.length > 0) {
                console.warn('Template warnings:', headerValidation.warnings);
            }

            const normalizedRecords = normalizeRecords(parseResult.records, columnMap);
            const recordErrors = validateRecords(normalizedRecords);
            if (recordErrors.length > 0) {
                void this.context.navigation.openAlertDialog({
                    text: `Data validation failed:\n\n${recordErrors.join('\n')}`,
                    confirmButtonLabel: "OK"
                });
                this.csvRecords = [];
                this.csvColumnMap = null;
                return [];
            }

            this.csvColumnMap = columnMap;

            onProgress(40, `Parsed ${normalizedRecords.length} records from file`);
            
            // Fetch existing records from Dataverse
            onProgress(50, 'Fetching existing records from Dataverse...');
            await this.fetchDataverseRecords();
            
            onProgress(70, `Loaded ${this.dataverseRecords.size} records from Dataverse`);
            
            // Compare and add sync status
            onProgress(85, 'Comparing data...');
            const enrichedData = this.addSyncStatus(normalizedRecords);
            
            // Store CSV records for synchronization
            this.csvRecords = enrichedData;
            
            // Show summary
            const syncedCount = enrichedData.filter(r => r.syncStatus === 'synced').length;
            const notSyncedCount = enrichedData.filter(r => r.syncStatus === 'not-synced').length;
            const modifiedCount = enrichedData.filter(r => r.syncStatus === 'modified').length;
            
            void this.context.navigation.openAlertDialog({
                text: `File loaded successfully!\n\nTotal: ${normalizedRecords.length}\nSynced: ${syncedCount}\nNot Synced: ${notSyncedCount}\nModified: ${modifiedCount}`,
                confirmButtonLabel: "OK"
            });
            
            return enrichedData;
            
        } catch (error) {
            console.error('Error processing file:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            void this.context.navigation.openAlertDialog({
                text: `Error: ${errorMessage}`,
                confirmButtonLabel: "OK"
            });
            this.csvRecords = [];
            this.csvColumnMap = null;
            return [];
        }
    }

    /**
     * Fetch all records from Dataverse and store in Map by Global ID
     */
    private async fetchDataverseRecords(): Promise<void> {
        try {
            console.log('\n╔════════════════════════════════════════════════════════════════╗');
            console.log('║  FETCHING DATAVERSE RECORDS                                    ║');
            console.log('╚════════════════════════════════════════════════════════════════╝');
            
            const fetchXml = `
                <fetch>
                    <entity name="${DV_CONFIG.ENTITY_NAME}">
                        <attribute name="${DV_CONFIG.FIELDS.ID}" />
                        <attribute name="${DV_CONFIG.FIELDS.GLOBAL_ID}" />
                        <attribute name="${DV_CONFIG.FIELDS.FIRST_NAME}" />
                        <attribute name="${DV_CONFIG.FIELDS.LAST_NAME}" />
                        <attribute name="${DV_CONFIG.FIELDS.FULL_NAME}" />
                        <attribute name="${DV_CONFIG.FIELDS.EMAIL}" />
                        <attribute name="${DV_CONFIG.FIELDS.ROLE}" />
                        <attribute name="${DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID}" />
                        <attribute name="${DV_CONFIG.FIELDS.MANAGER_LOOKUP}" />
                    </entity>
                </fetch>`;
            
            const options = `?fetchXml=${encodeURIComponent(fetchXml)}`;
            let result = await this.context.webAPI.retrieveMultipleRecords(DV_CONFIG.ENTITY_NAME, options, 500);
            const entities = [...result.entities];

            while (result.nextLink) {
                result = await this.context.webAPI.retrieveMultipleRecords(DV_CONFIG.ENTITY_NAME, result.nextLink, 500);
                entities.push(...result.entities);
            }
            
            console.log(`\n✅ API returned ${entities.length} records`);
            
            // Log sample raw entities
            if (entities.length > 0) {
                console.log('\n📋 Sample RAW entities from API (first 3):');
                entities.slice(0, 3).forEach((entity, idx) => {
                    console.log(`\n  [${idx + 1}]`, {
                        id: String(entity[DV_CONFIG.FIELDS.ID]),
                        globalId: String(entity[DV_CONFIG.FIELDS.GLOBAL_ID]),
                        firstName: String(entity[DV_CONFIG.FIELDS.FIRST_NAME] ?? ''),
                        lastName: String(entity[DV_CONFIG.FIELDS.LAST_NAME] ?? ''),
                        email: String(entity[DV_CONFIG.FIELDS.EMAIL] ?? ''),
                        role: String(entity[DV_CONFIG.FIELDS.ROLE] ?? ''),
                        managerGlobalId: String(entity[DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID] ?? ''),
                        managerLookupValue: String(entity[DV_CONFIG.FIELDS.MANAGER_LOOKUP_VALUE] ?? '')
                    });
                });
            }
            
            // Store records in Map by Global ID (string-to-string matching)
            this.dataverseRecords.clear();
            let stored = 0;
            let skipped = 0;
            
            entities.forEach((entity: ComponentFramework.WebApi.Entity) => {
                const globalId = getStringValue(entity[DV_CONFIG.FIELDS.GLOBAL_ID]);
                
                if (!hasValue(globalId)) {
                    skipped++;
                    console.warn(`⚠️ Skipping record without Global ID:`, entity[DV_CONFIG.FIELDS.ID]);
                    return;
                }
                
                // Get manager lookup ID - try both field names
                const managerLookupId = getStringValue(
                    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/dot-notation
                    entity[DV_CONFIG.FIELDS.MANAGER_LOOKUP_VALUE] || entity['_ag_manager_value']
                );
                
                this.dataverseRecords.set(globalId, {
                    ag_organizationviewid: getStringValue(entity[DV_CONFIG.FIELDS.ID]),
                    ag_globalid: globalId,
                    ag_firstname: getStringValue(entity[DV_CONFIG.FIELDS.FIRST_NAME]),
                    ag_lastname: getStringValue(entity[DV_CONFIG.FIELDS.LAST_NAME]),
                    ag_fullname: getStringValue(entity[DV_CONFIG.FIELDS.FULL_NAME]),
                    ag_primaryemail: getStringValue(entity[DV_CONFIG.FIELDS.EMAIL]),
                    ag_role: getStringValue(entity[DV_CONFIG.FIELDS.ROLE]),
                    ag_managerglobalid: getStringValue(entity[DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]),
                    ag_managerid: managerLookupId
                });
                stored++;
            });
            
            console.log(`\n✅ Stored ${stored} records in Map (keyed by Global ID as string)`);
            if (skipped > 0) {
                console.warn(`⚠️ Skipped ${skipped} records (no Global ID)`);
            }
            
            // Log sample from Map
            if (stored > 0) {
                console.log('\n📋 Sample records IN MAP (first 3):');
                const mapEntries = Array.from(this.dataverseRecords.entries()).slice(0, 3);
                mapEntries.forEach(([key, value], idx) => {
                    console.log(`\n  [${idx + 1}] Key: "${key}"`);
                    console.log('      Value:', {
                        id: value.ag_organizationviewid,
                        firstName: value.ag_firstname,
                        lastName: value.ag_lastname,
                        email: value.ag_primaryemail,
                        role: value.ag_role,
                        managerGlobalId: value.ag_managerglobalid,
                        managerLookupId: value.ag_managerid
                    });
                });
            }
            
            console.log('\n════════════════════════════════════════════════════════════════\n');
            
        } catch (error) {
            console.error('\n❌ ERROR fetching Dataverse records:', error);
            throw error;
        }
    }

    /**
     * Compare CSV records with Dataverse and add sync status
     * 
     * Status logic:
     * - 'not-synced': Record doesn't exist in Dataverse
     * - 'modified': Record exists but data differs OR manager lookup is missing
     * - 'synced': Record exists, data matches, and manager lookup is set (if applicable)
     */
    private addSyncStatus(records: EmployeeRecord[]): EmployeeRecord[] {
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║  COMPARING CSV WITH DATAVERSE                                  ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log(`\n📊 CSV records: ${records.length}`);
        console.log(`📊 DV records in Map: ${this.dataverseRecords.size}\n`);
        
        // Show CSV column structure
        if (records.length > 0) {
            console.log('📋 CSV columns detected:', Object.keys(records[0]).join(', '));
            console.log('\n📋 Sample CSV record (first one):');
            console.log('   Global ID:', records[0][CSV_COLUMNS.GLOBAL_ID]);
            console.log('   First Name:', records[0][CSV_COLUMNS.FIRST_NAME]);
            console.log('   Last Name:', records[0][CSV_COLUMNS.LAST_NAME]);
            console.log('   Email:', records[0][CSV_COLUMNS.EMAIL]);
            console.log('   Position Title:', records[0][CSV_COLUMNS.POSITION_TITLE]);
            console.log('   Manager Global ID:', records[0][CSV_COLUMNS.MANAGER_GLOBAL_ID]);
        }
        
        // Show DV Map structure
        const mapSample = Array.from(this.dataverseRecords.entries()).slice(0, 3);
        if (mapSample.length > 0) {
            console.log('\n📋 Sample DV records from Map (first 3):');
            mapSample.forEach(([key, value], idx) => {
                console.log(`\n  [${idx + 1}] Map Key (Global ID): "${key}"`);
                console.log('      Dataverse ID:', value.ag_organizationviewid);
                console.log('      Name:', `${value.ag_firstname} ${value.ag_lastname}`);
                console.log('      Email:', value.ag_primaryemail || '(empty)');
                console.log('      Role:', value.ag_role || '(empty)');
                console.log('      Manager Global ID:', value.ag_managerglobalid || '(empty)');
                console.log('      Manager Lookup Set:', value.ag_managerid ? 'YES' : 'NO');
            });
        }
        
        console.log('\n────────────────────────────────────────────────────────────────');
        console.log('Starting detailed comparison...\n');
        
        let notSynced = 0;
        let modified = 0;
        let synced = 0;
        
        const result = records.map((record, index) => {
            // Extract and normalize CSV Global ID
            const csvGlobalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
            
            // Try to find matching DV record
            const dvRecord = this.dataverseRecords.get(csvGlobalId);
            
            // Detailed logging for first 5 records
            const shouldLog = index < 5;
            
            if (shouldLog) {
                console.log(`\n🔍 Record ${index + 1}/${records.length}: Global ID="${csvGlobalId}"`);
            }
            
            // Case 1: Record not found in Dataverse
            if (!dvRecord) {
                notSynced++;
                if (shouldLog) {
                    console.log(`   ❌ NOT FOUND in Dataverse`);
                    console.log(`   Status: NOT-SYNCED`);
                }
                return {
                    ...record,
                    syncStatus: 'not-synced' as const,
                    dataverseId: undefined
                };
            }
            
            if (shouldLog) {
                console.log(`   ✅ FOUND in Dataverse (ID: ${dvRecord.ag_organizationviewid})`);
            }
            
            // Extract and normalize CSV values
            const csvFirstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
            const csvLastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
            const csvEmail = getEmailValue(record[CSV_COLUMNS.EMAIL]);
            const csvPositionTitle = getStringValue(record[CSV_COLUMNS.POSITION_TITLE]);
            const csvManagerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
            
            // Extract and normalize DV values
            const dvFirstName = getStringValue(dvRecord.ag_firstname);
            const dvLastName = getStringValue(dvRecord.ag_lastname);
            const dvEmail = getEmailValue(dvRecord.ag_primaryemail);
            const dvRole = getStringValue(dvRecord.ag_role);
            const dvManagerGlobalId = getStringValue(dvRecord.ag_managerglobalid);
            const dvHasManagerLookup = hasValue(dvRecord.ag_managerid);
            
            // Compare all fields
            const firstNameMatch = csvFirstName === dvFirstName;
            const lastNameMatch = csvLastName === dvLastName;
            const emailMatch = csvEmail === dvEmail;
            const roleMatch = csvPositionTitle === dvRole;
            const managerGlobalIdMatch = csvManagerGlobalId === dvManagerGlobalId;
            
            // Check if CSV specifies a manager
            const csvHasManager = hasValue(csvManagerGlobalId);
            
            if (shouldLog) {
                console.log(`   📊 Field comparison:`);
                console.log(`      First Name: ${firstNameMatch ? '✅' : '❌'} CSV="${csvFirstName}" DV="${dvFirstName}"`);
                console.log(`      Last Name:  ${lastNameMatch ? '✅' : '❌'} CSV="${csvLastName}" DV="${dvLastName}"`);
                console.log(`      Email:      ${emailMatch ? '✅' : '❌'} CSV="${csvEmail}" DV="${dvEmail}"`);
                console.log(`      Role:       ${roleMatch ? 'OK' : 'NO'} CSV="${csvPositionTitle}" DV="${dvRole}"`);
                console.log(`      Manager ID: ${managerGlobalIdMatch ? '✅' : '❌'} CSV="${csvManagerGlobalId}" DV="${dvManagerGlobalId}"`);
                console.log(`   📊 Manager status:`);
                console.log(`      CSV specifies manager: ${csvHasManager ? 'YES' : 'NO'}`);
                console.log(`      DV has manager lookup: ${dvHasManagerLookup ? 'YES' : 'NO'}`);
            }
            
            // Determine status
            const allFieldsMatch = firstNameMatch && lastNameMatch && emailMatch && roleMatch && managerGlobalIdMatch;
            const managerLookupMissing = csvHasManager && !dvHasManagerLookup;
            
            let status: 'synced' | 'modified' | 'not-synced';
            let reason = '';
            
            if (!allFieldsMatch) {
                status = 'modified';
                modified++;
                reason = 'Data fields differ';
                if (shouldLog) console.log(`   ⚠️  Status: MODIFIED (${reason})`);
            } else if (managerLookupMissing) {
                status = 'modified';
                modified++;
                reason = 'Manager lookup relationship not set';
                if (shouldLog) console.log(`   ⚠️  Status: MODIFIED (${reason})`);
            } else {
                status = 'synced';
                synced++;
                if (shouldLog) console.log(`   ✅ Status: SYNCED (all fields match, manager lookup ${csvHasManager ? 'set' : 'not needed'})`);
            }
            
            return {
                ...record,
                syncStatus: status,
                dataverseId: dvRecord.ag_organizationviewid
            };
        });
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('║  COMPARISON COMPLETE                                           ║');
        console.log('════════════════════════════════════════════════════════════════');
        console.log(`\n📊 SUMMARY:`);
        console.log(`   ✅ Synced:      ${synced.toString().padStart(4)} records`);
        console.log(`   ⚠️  Modified:    ${modified.toString().padStart(4)} records`);
        console.log(`   ❌ Not Synced:  ${notSynced.toString().padStart(4)} records`);
        console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   📋 Total:       ${records.length.toString().padStart(4)} records`);
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
        return result;
    }

    /**
     * Handle synchronization button click
     */
    private async handleSynchronizeData(onProgress: (progress: number, message: string) => void): Promise<{ cancelled: boolean; data: EmployeeRecord[] }> {
        try {
            if (this.csvRecords.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data to synchronize. Please load a file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }
            if (!this.csvColumnMap) {
                void this.context.navigation.openAlertDialog({
                    text: 'No valid template loaded. Please upload a valid file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            // Filter records that need synchronization
            const toCreate = this.csvRecords.filter(r => r.syncStatus === 'not-synced');
            const toUpdate = this.csvRecords.filter(r => r.syncStatus === 'modified');

            if (toCreate.length === 0 && toUpdate.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'All records are already synchronized!',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            const confirmMessage = `Ready to synchronize data:\n\n` +
                `Create: ${toCreate.length} records\n` +
                `Update: ${toUpdate.length} records\n\n` +
                `Note: Manager relationships will NOT be set. Use "Set Manager Relations" button after this.\n\n` +
                `Continue?`;

            const confirmResult = await this.context.navigation.openConfirmDialog({
                text: confirmMessage,
                title: 'Confirm Data Synchronization'
            });

            if (!confirmResult.confirmed) {
                return { cancelled: true, data: this.csvRecords };
            }

            // User confirmed - now show progress
            onProgress(0, 'Starting synchronization...');

            // Phase 1: Create/Update all records without manager lookup
            await this.syncRecordsWithoutHierarchy(toCreate, toUpdate, onProgress);

            void this.context.navigation.openAlertDialog({
                text: `Data synchronization completed!\n\nCreated: ${toCreate.length}\nUpdated: ${toUpdate.length}\n\nYou can now use "Set Manager Relations" to update the hierarchy.`,
                confirmButtonLabel: "OK"
            });

            // Return updated records for React to refresh
            return { cancelled: false, data: [...this.csvRecords] };

        } catch (error) {
            console.error('Error during data synchronization:', error);
            void this.context.navigation.openAlertDialog({
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                confirmButtonLabel: "OK"
            });
            return { cancelled: false, data: this.csvRecords };
        }
    }

    /**
     * Handle setting manager hierarchy
     */
    private async handleSynchronizeHierarchy(onProgress: (progress: number, message: string) => void): Promise<{ cancelled: boolean; data: EmployeeRecord[] }> {
        try {
            if (this.csvRecords.length === 0) {
                void this.context.navigation.openAlertDialog({
                    text: 'No data loaded. Please load a file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }
            if (!this.csvColumnMap) {
                void this.context.navigation.openAlertDialog({
                    text: 'No valid template loaded. Please upload a valid file first.',
                    confirmButtonLabel: "OK"
                });
                return { cancelled: true, data: this.csvRecords };
            }

            const confirmMessage = `This will update manager relationships for all records.\n\n` +
                `Make sure you have already synchronized the data using "Synchronize Data" button.\n\n` +
                `Continue?`;

            const confirmResult = await this.context.navigation.openConfirmDialog({
                text: confirmMessage,
                title: 'Confirm Manager Hierarchy Update'
            });

            if (!confirmResult.confirmed) {
                return { cancelled: true, data: this.csvRecords };
            }

            // User confirmed - now show progress
            onProgress(0, 'Starting hierarchy update...');

            // Phase 2: Update manager lookups
            const result = await this.syncManagerHierarchy(onProgress);

            void this.context.navigation.openAlertDialog({
                text: `Manager relationships updated!\n\nUpdated: ${result.updated}\nSkipped: ${result.skipped}`,
                confirmButtonLabel: "OK"
            });

            // Return updated records for React to refresh
            return { cancelled: false, data: [...this.csvRecords] };

        } catch (error) {
            console.error('Error during hierarchy synchronization:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            void this.context.navigation.openAlertDialog({
                text: `Synchronization error: ${errorMessage}`,
                confirmButtonLabel: "OK"
            });
            return { cancelled: false, data: this.csvRecords };
        }
    }

    /**
     * Phase 1: Sync all records without manager hierarchy
     * Creates/updates basic data fields but does NOT set manager lookup relationship
     */
    private async syncRecordsWithoutHierarchy(
        toCreate: EmployeeRecord[], 
        toUpdate: EmployeeRecord[], 
        onProgress: (progress: number, message: string) => void
    ): Promise<void> {
        const totalRecords = toCreate.length + toUpdate.length;
        let processedRecords = 0;

        console.log(`\n📝 Phase 1: Syncing ${totalRecords} records (${toCreate.length} create, ${toUpdate.length} update)`);

        // Create new records
        for (const record of toCreate) {
            // Double-check if record already exists (in case of duplicate sync)
            const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
            const existingRecord = this.dataverseRecords.get(globalId);

            if (!hasValue(globalId)) {
                console.warn('Skipping record without Global ID in create batch.');
                processedRecords++;
                continue;
            }
            
            if (existingRecord) {
                console.warn(`⚠️ Record ${globalId} already exists. Skipping creation.`);
                record.dataverseId = existingRecord.ag_organizationviewid;
                record.syncStatus = 'synced';
                processedRecords++;
                continue;
            }

            // Prepare data for creation
            const firstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
            const lastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
            const email = getStringValue(record[CSV_COLUMNS.EMAIL]);
            const positionTitle = getStringValue(record[CSV_COLUMNS.POSITION_TITLE]);
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
            
            const data: Record<string, unknown> = {
                [DV_CONFIG.FIELDS.GLOBAL_ID]: globalId,
                [DV_CONFIG.FIELDS.FIRST_NAME]: firstName,
                [DV_CONFIG.FIELDS.LAST_NAME]: lastName,
                [DV_CONFIG.FIELDS.FULL_NAME]: createFullName(firstName, lastName),
                [DV_CONFIG.FIELDS.EMAIL]: email || null,
                [DV_CONFIG.FIELDS.ROLE]: positionTitle || null,
                [DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]: managerGlobalId || null
            };

            try {
                const result = await this.context.webAPI.createRecord(DV_CONFIG.ENTITY_NAME, data);
                record.dataverseId = result.id;
                this.dataverseRecords.set(globalId, {
                    ag_organizationviewid: result.id,
                    ag_globalid: globalId,
                    ag_firstname: firstName,
                    ag_lastname: lastName,
                    ag_fullname: createFullName(firstName, lastName),
                    ag_primaryemail: email,
                    ag_role: positionTitle,
                    ag_managerglobalid: managerGlobalId,
                    ag_managerid: ''
                });
                
                // Status depends on whether manager relationship needs to be set later
                const csvHasManager = hasValue(managerGlobalId);
                record.syncStatus = csvHasManager ? 'modified' : 'synced';
                
                console.log(`✅ Created: ${globalId} (${firstName} ${lastName})`);
            } catch (error) {
                console.error(`❌ Failed to create ${globalId}:`, error);
            }
            
            processedRecords++;
            const progress = Math.round((processedRecords / totalRecords) * 100);
            onProgress(progress, `Creating records: ${processedRecords}/${totalRecords}`);
        }

        // Update existing records
        for (const record of toUpdate) {
            if (!record.dataverseId) {
                console.warn(`⚠️ Record without dataverseId, skipping update`);
                processedRecords++;
                continue;
            }

            // Prepare data for update
            const firstName = getStringValue(record[CSV_COLUMNS.FIRST_NAME]);
            const lastName = getStringValue(record[CSV_COLUMNS.LAST_NAME]);
            const email = getStringValue(record[CSV_COLUMNS.EMAIL]);
            const positionTitle = getStringValue(record[CSV_COLUMNS.POSITION_TITLE]);
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
            
            const data: Record<string, unknown> = {
                [DV_CONFIG.FIELDS.FIRST_NAME]: firstName,
                [DV_CONFIG.FIELDS.LAST_NAME]: lastName,
                [DV_CONFIG.FIELDS.FULL_NAME]: createFullName(firstName, lastName),
                [DV_CONFIG.FIELDS.EMAIL]: email || null,
                [DV_CONFIG.FIELDS.ROLE]: positionTitle || null,
                [DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]: managerGlobalId || null
            };

            try {
                await this.context.webAPI.updateRecord(DV_CONFIG.ENTITY_NAME, record.dataverseId, data);
                
                // Status depends on whether manager relationship needs to be set later
                const csvHasManager = hasValue(managerGlobalId);
                record.syncStatus = csvHasManager ? 'modified' : 'synced';
                
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                const existingRecord = this.dataverseRecords.get(globalId);
                this.dataverseRecords.set(globalId, {
                    ag_organizationviewid: record.dataverseId,
                    ag_globalid: globalId,
                    ag_firstname: firstName,
                    ag_lastname: lastName,
                    ag_fullname: createFullName(firstName, lastName),
                    ag_primaryemail: email,
                    ag_role: positionTitle,
                    ag_managerglobalid: managerGlobalId,
                    ag_managerid: existingRecord?.ag_managerid ?? ''
                });
                console.log(`✅ Updated: ${globalId} (${firstName} ${lastName})`);
            } catch (error) {
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                console.error(`❌ Failed to update ${globalId}:`, error);
            }
            
            processedRecords++;
            const progress = Math.round((processedRecords / totalRecords) * 100);
            onProgress(progress, `Updating records: ${processedRecords}/${totalRecords}`);
        }
        
        console.log(`\n✅ Phase 1 complete: ${processedRecords} records processed\n`);
    }

    /**
     * Phase 2: Update manager hierarchy (lookups)
     * Sets the ag_manager lookup relationship based on Manager Global ID
     */
    private async syncManagerHierarchy(onProgress: (progress: number, message: string) => void): Promise<{ updated: number; skipped: number }> {
        console.log(`\n📝 Phase 2: Setting manager relationships`);

        // Refresh Dataverse records to get newly created ones
        onProgress(10, 'Refreshing Dataverse records...');
        await this.fetchDataverseRecords();

        // Update dataverseId in csvRecords based on Global ID
        onProgress(20, 'Mapping record IDs...');
        for (const record of this.csvRecords) {
            const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
            const dvRecord = this.dataverseRecords.get(globalId);
            if (dvRecord) {
                record.dataverseId = dvRecord.ag_organizationviewid;
            }
        }

        let updated = 0;
        let skipped = 0;
        const recordsWithManagers = this.csvRecords.filter(r => hasValue(r[CSV_COLUMNS.MANAGER_GLOBAL_ID]));
        const totalRecords = recordsWithManagers.length;
        let processedRecords = 0;

        console.log(`Processing ${totalRecords} records with managers...`);

        for (const record of this.csvRecords) {
            const managerGlobalId = getStringValue(record[CSV_COLUMNS.MANAGER_GLOBAL_ID]);
            
            // Skip if no manager specified
            if (!hasValue(managerGlobalId)) {
                // No manager to set - if record exists in DV, it's fully synced
                if (record.dataverseId) {
                    record.syncStatus = 'synced';
                }
                skipped++;
                continue;
            }

            // Skip if record doesn't have Dataverse ID
            if (!record.dataverseId) {
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                console.warn(`⚠️ Record ${globalId} without dataverseId, skipping`);
                skipped++;
                processedRecords++;
                continue;
            }

            // Find manager record by Global ID
            const managerRecord = this.dataverseRecords.get(managerGlobalId);
            if (!managerRecord) {
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                console.warn(`⚠️ Manager not found: ${managerGlobalId} for record ${globalId}`);
                skipped++;
                processedRecords++;
                continue;
            }

            try {
                // Set manager lookup using @odata.bind syntax
                const data = {
                    [`${DV_CONFIG.FIELDS.MANAGER_LOOKUP}@odata.bind`]: 
                        `/${DV_CONFIG.ENTITY_PLURAL}(${managerRecord.ag_organizationviewid})`
                };

                await this.context.webAPI.updateRecord(DV_CONFIG.ENTITY_NAME, record.dataverseId, data);
                
                // Now the record is fully synced (including manager relationship)
                record.syncStatus = 'synced';
                
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                console.log(`✅ Set manager for ${globalId} → ${managerGlobalId}`);
                
                updated++;
                processedRecords++;
                
                const progress = 20 + Math.round((processedRecords / totalRecords) * 80);
                onProgress(progress, `Updating manager relations: ${processedRecords}/${totalRecords}`);
            } catch (error) {
                const globalId = getStringValue(record[CSV_COLUMNS.GLOBAL_ID]);
                console.error(`❌ Failed to set manager for ${globalId}:`, error);
                skipped++;
                processedRecords++;
            }
        }

        console.log(`\n✅ Phase 2 complete: ${updated} updated, ${skipped} skipped\n`);
        return { updated, skipped };
    }
    
    /**
     * Parse CSV file content
     */
    private parseCSV(text: string): ParseResult {
        const result = Papa.parse<Record<string, unknown>>(text, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: false,
            transformHeader: (header) => header.trim()
        });

        if (result.errors && result.errors.length > 0) {
            const firstError = result.errors[0];
            throw new Error(`CSV parse error at row ${firstError.row ?? 'unknown'}: ${firstError.message}`);
        }

        const headers = (result.meta.fields ?? []).map(header => header.trim()).filter(header => header);
        const records = result.data.filter((row) => Object.values(row).some(value => hasValue(value)));

        return { records, headers };
    }

    /**
     * Parse XLSX/XLS file content
     */
    private async parseXLSX(file: File): Promise<ParseResult> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e: ProgressEvent<FileReader>) => {
                try {
                    const data = e.target?.result;
                    if (!data) {
                        reject(new Error('Failed to read file'));
                        return;
                    }
                    
                    // Read the workbook
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    // Get the first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    
                    const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
                        header: 1,
                        defval: '',
                        raw: false
                    });

                    if (rows.length === 0) {
                        resolve({ records: [], headers: [] });
                        return;
                    }

                    const headers = rows[0].map(header => getStringValue(header)).filter(header => header);
                    const records: Record<string, unknown>[] = [];

                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        if (!row || row.every(value => !hasValue(value))) {
                            continue;
                        }

                        const record: Record<string, unknown> = {};
                        headers.forEach((header, index) => {
                            record[header] = row[index] ?? '';
                        });
                        records.push(record);
                    }

                    resolve({ records, headers });
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };
            
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * It is called by the framework prior to a control receiving new data.
     * @returns an object based on nomenclature defined in manifest, expecting object[s] for property marked as "bound" or "output"
     */
    public getOutputs(): IOutputs {
        return {};
    }

    /**
     * Called when the control is to be removed from the DOM tree. Controls should use this call for cleanup.
     * i.e. cancelling any pending remote calls, removing listeners, etc.
     */
    public destroy(): void {
        // Add code to cleanup control if necessary
    }
}
