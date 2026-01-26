/**
 * Dataverse API service for fetching and managing organization view records
 */

import { DV_CONFIG, BATCH_CONFIG, SYSTEMUSER_CONFIG } from '../config/constants';
import { getStringValue, hasValue } from '../utils/helpers';
import type { DataverseRecord, SystemUser } from '../types';

/**
 * Fetch all records from Dataverse with pagination support
 * Handles datasets larger than 5000 records by paging through results
 *
 * @param context PCF context with WebAPI access
 * @param dataverseRecords Map to populate with fetched records
 * @returns Number of records fetched
 */
export async function fetchDataverseRecords(
    context: ComponentFramework.Context<unknown>,
    dataverseRecords: Map<string, DataverseRecord>
): Promise<number> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  FETCHING DATAVERSE RECORDS                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    dataverseRecords.clear();
    let pageNumber = 1;
    let hasMoreRecords = true;
    let totalFetched = 0;
    let stored = 0;
    let skipped = 0;

    while (hasMoreRecords) {
        const fetchXml = `
            <fetch count="${BATCH_CONFIG.PAGE_SIZE}" page="${pageNumber}" returntotalrecordcount="true">
                <entity name="${DV_CONFIG.ENTITY_NAME}">
                    <attribute name="${DV_CONFIG.FIELDS.ID}" />
                    <attribute name="${DV_CONFIG.FIELDS.GLOBAL_ID}" />
                    <attribute name="${DV_CONFIG.FIELDS.FIRST_NAME}" />
                    <attribute name="${DV_CONFIG.FIELDS.LAST_NAME}" />
                    <attribute name="${DV_CONFIG.FIELDS.FULL_NAME}" />
                    <attribute name="${DV_CONFIG.FIELDS.EMAIL}" />
                    <attribute name="${DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID}" />
                    <attribute name="${DV_CONFIG.FIELDS.MANAGER_LOOKUP}" />
                    <attribute name="${DV_CONFIG.FIELDS.USER_LOOKUP}" />
                    <order attribute="${DV_CONFIG.FIELDS.GLOBAL_ID}" />
                </entity>
            </fetch>`;

        const options = `?fetchXml=${encodeURIComponent(fetchXml)}`;
        const result = await context.webAPI.retrieveMultipleRecords(DV_CONFIG.ENTITY_NAME, options);

        console.log(`Page ${pageNumber}: fetched ${result.entities.length} records`);

        // Process entities
        result.entities.forEach((entity: ComponentFramework.WebApi.Entity) => {
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

            // Get user lookup ID - try both field names
            const userLookupId = getStringValue(
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/dot-notation
                entity[DV_CONFIG.FIELDS.USER_LOOKUP_VALUE] || entity['_ag_user_value']
            );

            dataverseRecords.set(globalId, {
                ag_organizationviewid: getStringValue(entity[DV_CONFIG.FIELDS.ID]),
                ag_globalid: globalId,
                ag_firstname: getStringValue(entity[DV_CONFIG.FIELDS.FIRST_NAME]),
                ag_lastname: getStringValue(entity[DV_CONFIG.FIELDS.LAST_NAME]),
                ag_fullname: getStringValue(entity[DV_CONFIG.FIELDS.FULL_NAME]),
                ag_primaryemail: getStringValue(entity[DV_CONFIG.FIELDS.EMAIL]),
                ag_managerglobalid: getStringValue(entity[DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]),
                ag_managerid: managerLookupId,
                ag_userid: userLookupId || undefined
            });
            stored++;
        });

        totalFetched += result.entities.length;

        // Check for more pages
        hasMoreRecords = result.entities.length === BATCH_CONFIG.PAGE_SIZE;
        pageNumber++;
    }

    console.log(`\n✅ Total: ${totalFetched} records fetched across ${pageNumber - 1} page(s)`);
    console.log(`✅ Stored ${stored} records in Map (keyed by Global ID)`);
    if (skipped > 0) {
        console.warn(`⚠️ Skipped ${skipped} records (no Global ID)`);
    }

    // Log sample from Map
    if (stored > 0) {
        console.log('\n📋 Sample records IN MAP (first 3):');
        const mapEntries = Array.from(dataverseRecords.entries()).slice(0, 3);
        mapEntries.forEach(([key, value], idx) => {
            console.log(`\n  [${idx + 1}] Key: "${key}"`);
            console.log('      Value:', {
                id: value.ag_organizationviewid,
                firstName: value.ag_firstname,
                lastName: value.ag_lastname,
                email: value.ag_primaryemail,
                managerGlobalId: value.ag_managerglobalid,
                managerLookupId: value.ag_managerid,
                userLookupId: value.ag_userid
            });
        });
    }

    console.log('\n════════════════════════════════════════════════════════════════\n');

    return stored;
}

/**
 * Add a newly created record to the dataverse records map
 * This prevents the need to re-fetch after creating records
 */
export function addToDataverseMap(
    dataverseRecords: Map<string, DataverseRecord>,
    record: DataverseRecord
): void {
    dataverseRecords.set(record.ag_globalid, record);
}

/**
 * Fetch all systemusers from Dataverse and create email→systemuserid map
 * This map is used to set the ag_user lookup based on email matching
 *
 * @param context PCF context with WebAPI access
 * @returns Map of lowercase email to systemuserid
 */
export async function fetchSystemUsers(
    context: ComponentFramework.Context<unknown>
): Promise<Map<string, string>> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  FETCHING SYSTEMUSERS                                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    const emailToUserMap = new Map<string, string>();
    let pageNumber = 1;
    let hasMoreRecords = true;
    let totalFetched = 0;

    while (hasMoreRecords) {
        const fetchXml = `
            <fetch count="${BATCH_CONFIG.PAGE_SIZE}" page="${pageNumber}">
                <entity name="${SYSTEMUSER_CONFIG.ENTITY_NAME}">
                    <attribute name="${SYSTEMUSER_CONFIG.FIELDS.ID}" />
                    <attribute name="${SYSTEMUSER_CONFIG.FIELDS.EMAIL}" />
                    <filter>
                        <condition attribute="${SYSTEMUSER_CONFIG.FIELDS.EMAIL}" operator="not-null" />
                        <condition attribute="isdisabled" operator="eq" value="0" />
                    </filter>
                    <order attribute="${SYSTEMUSER_CONFIG.FIELDS.EMAIL}" />
                </entity>
            </fetch>`;

        const options = `?fetchXml=${encodeURIComponent(fetchXml)}`;
        const result = await context.webAPI.retrieveMultipleRecords(SYSTEMUSER_CONFIG.ENTITY_NAME, options);

        console.log(`Page ${pageNumber}: fetched ${result.entities.length} systemusers`);

        result.entities.forEach((entity: ComponentFramework.WebApi.Entity) => {
            const userId = getStringValue(entity[SYSTEMUSER_CONFIG.FIELDS.ID]);
            const email = getStringValue(entity[SYSTEMUSER_CONFIG.FIELDS.EMAIL]);

            if (hasValue(email) && hasValue(userId)) {
                // Store with lowercase email as key for case-insensitive matching
                emailToUserMap.set(email.toLowerCase(), userId);
            }
        });

        totalFetched += result.entities.length;

        // Check for more pages
        hasMoreRecords = result.entities.length === BATCH_CONFIG.PAGE_SIZE;
        pageNumber++;
    }

    console.log(`\n✅ Total: ${totalFetched} systemusers fetched`);
    console.log(`✅ Stored ${emailToUserMap.size} email→userid mappings`);

    // Log sample emails for debugging
    if (emailToUserMap.size > 0) {
        console.log('\n📧 Sample systemuser emails (first 5):');
        const entries = Array.from(emailToUserMap.entries()).slice(0, 5);
        entries.forEach(([email, userId], idx) => {
            console.log(`  [${idx + 1}] "${email}" → "${userId}"`);
        });
    }

    console.log('\n════════════════════════════════════════════════════════════════\n');

    return emailToUserMap;
}

/**
 * Discover available navigation properties for lookup fields
 * Helps identify correct OData bind property names
 *
 * @param context PCF context with WebAPI access
 */
export async function discoverNavigationProperties(
    context: ComponentFramework.Context<unknown>
): Promise<void> {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  DISCOVERING NAVIGATION PROPERTIES                             ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');

    try {
        // Fetch a single record to inspect available properties
        const result = await context.webAPI.retrieveMultipleRecords(
            DV_CONFIG.ENTITY_NAME,
            '?$top=1'
        );

        if (result.entities.length > 0) {
            const record = result.entities[0];
            const allKeys = Object.keys(record);

            console.log('\n📋 All lookup-related fields:');
            allKeys
                .filter(k =>
                    k.includes('manager') ||
                    k.includes('user') ||
                    k.includes('_value') ||
                    k.startsWith('_') ||
                    k.includes('@')
                )
                .sort()
                .forEach(k => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const value = record[k];
                    const displayValue = value === null ? 'null' : value === undefined ? 'undefined' : String(value).substring(0, 50);
                    console.log(`  ${k}: ${displayValue}`);
                });

            console.log('\n💡 Navigation property naming patterns:');
            console.log('  - Self-lookup: {fieldname}_{tablename} (e.g., ag_manager_ag_organizationview)');
            console.log('  - Other lookup: {fieldname} or {fieldname}_{targettable}');
            console.log('  - Lookup value: _{fieldname}_value (e.g., _ag_manager_value)');
        } else {
            console.log('⚠️ No records found in table - cannot discover properties');
        }
    } catch (error) {
        console.error('❌ Discovery failed:', error instanceof Error ? error.message : error);
    }

    console.log('\n════════════════════════════════════════════════════════════════\n');
}
