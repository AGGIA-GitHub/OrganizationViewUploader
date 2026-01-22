/**
 * Dataverse API service for fetching and managing organization view records
 */

import { DV_CONFIG, BATCH_CONFIG } from '../config/constants';
import { getStringValue, hasValue } from '../utils/helpers';
import type { DataverseRecord } from '../types';

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

            dataverseRecords.set(globalId, {
                ag_organizationviewid: getStringValue(entity[DV_CONFIG.FIELDS.ID]),
                ag_globalid: globalId,
                ag_firstname: getStringValue(entity[DV_CONFIG.FIELDS.FIRST_NAME]),
                ag_lastname: getStringValue(entity[DV_CONFIG.FIELDS.LAST_NAME]),
                ag_fullname: getStringValue(entity[DV_CONFIG.FIELDS.FULL_NAME]),
                ag_primaryemail: getStringValue(entity[DV_CONFIG.FIELDS.EMAIL]),
                ag_managerglobalid: getStringValue(entity[DV_CONFIG.FIELDS.MANAGER_GLOBAL_ID]),
                ag_managerid: managerLookupId
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
                managerLookupId: value.ag_managerid
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
