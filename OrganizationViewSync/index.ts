import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { HelloWorld, IHelloWorldProps } from "./HelloWorld";
import * as React from "react";
import DataSetInterfaces = ComponentFramework.PropertyHelper.DataSetApi;
type DataSet = ComponentFramework.PropertyTypes.DataSet;

export class OrganizationViewSync implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private context: ComponentFramework.Context<IInputs>;
    private width: number;
    private height: number;

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
            width: this.width,
            height: this.height
        };
        
        return React.createElement(HelloWorld, props);
    }

    /**
     * Handle file upload from the button
     */
    private async handleFileUpload(file: File): Promise<Record<string, unknown>[]> {
        console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type);
        
        try {
            const text = await file.text();
            const extension = file.name.split('.').pop()?.toLowerCase();
            
            let data: Record<string, unknown>[] = [];
            
            if (extension === 'csv') {
                data = this.parseCSV(text);
            } else {
                // For now, show alert that only CSV is supported
                void this.context.navigation.openAlertDialog({
                    text: 'Currently only CSV files are supported. XLSX support coming soon!',
                    confirmButtonLabel: "OK"
                });
                return [];
            }
            
            console.log('Parsed data:', data);
            
            // Show success notification
            void this.context.navigation.openAlertDialog({
                text: `File "${file.name}" loaded successfully! ${data.length} rows found.`,
                confirmButtonLabel: "OK"
            });
            
            return data;
            
        } catch (error) {
            console.error('Error processing file:', error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            void this.context.navigation.openAlertDialog({
                text: `Error processing file: ${errorMessage}`,
                confirmButtonLabel: "OK"
            });
            return [];
        }
    }
    
    /**
     * Parse CSV file content
     */
    private parseCSV(text: string): Record<string, unknown>[] {
        const lines = text.split('\n').filter(line => line.trim());
        if (lines.length === 0) return [];
        
        // Parse header
        const headers = lines[0].split(',').map(h => h.trim());
        
        // Parse data rows
        const data: Record<string, unknown>[] = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            const row: Record<string, unknown> = {};
            
            headers.forEach((header, index) => {
                row[header] = values[index]?.trim() || '';
            });
            
            data.push(row);
        }
        
        return data;
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
