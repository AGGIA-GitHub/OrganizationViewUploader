import * as React from 'react';
import FileUploader, { type FileUploaderTypes } from 'devextreme-react/file-uploader';
import DataGrid, { Column, Scrolling, HeaderFilter, FilterRow, Toolbar, Item, TotalItem, Summary } from 'devextreme-react/data-grid';
import Button from 'devextreme-react/button';
import LoadIndicator from 'devextreme-react/load-indicator';
import ProgressBar from 'devextreme-react/progress-bar';
import { CSV_COLUMNS } from './config/constants';

export interface IHelloWorldProps {
    onFileUpload: (file: File, onProgress: (progress: number, message: string) => void) => Promise<Record<string, unknown>[]>;
    onSynchronizeData: (onProgress: (progress: number, message: string) => void) => Promise<{ cancelled: boolean; data: Record<string, unknown>[] }>;
    onSynchronizeHierarchy: (onProgress: (progress: number, message: string) => void) => Promise<{ cancelled: boolean; data: Record<string, unknown>[] }>;
    width: number | string;
    height: number | string;
}

interface IHelloWorldState {
    uploadedFileName: string;
    data: Record<string, unknown>[];
    isLoading: boolean;
    progress: number;
    progressMessage: string;
}

export class HelloWorld extends React.Component<IHelloWorldProps, IHelloWorldState> {
    private isMounted = false;

    constructor(props: IHelloWorldProps) {
        super(props);
        this.state = {
            uploadedFileName: '',
            data: [],
            isLoading: false,
            progress: 0,
            progressMessage: ''
        };
    }

    componentDidMount(): void {
        this.isMounted = true;
    }

    componentWillUnmount(): void {
        this.isMounted = false;
    }

    /**
     * Safe setState that checks if component is still mounted
     */
    private safeSetState<K extends keyof IHelloWorldState>(
        state: Pick<IHelloWorldState, K> | ((prevState: Readonly<IHelloWorldState>) => Pick<IHelloWorldState, K>)
    ): void {
        if (this.isMounted) {
            this.setState(state as Pick<IHelloWorldState, K>);
        }
    }

    private handleValueChanged = (e: FileUploaderTypes.ValueChangedEvent): void => {
        const files = e.value as File[] | null;
        const file = files?.[0];
        if (file) {
            this.safeSetState({ isLoading: true, progress: 0, progressMessage: 'Loading file...' });

            void (async (): Promise<void> => {
                try {
                    const data = await this.props.onFileUpload(file, (progress, message) => {
                        this.safeSetState({ progress, progressMessage: message });
                    });
                    this.safeSetState({
                        data,
                        uploadedFileName: file.name,
                        isLoading: false,
                        progress: 100,
                        progressMessage: 'Complete!'
                    });
                } catch (error) {
                    console.error('Error loading file:', error);
                    this.safeSetState({ isLoading: false, progress: 0, progressMessage: '' });
                }
            })();
        }
    };

    private handleSynchronizeClick = (): void => {
        void (async (): Promise<void> => {
            try {
                const result = await this.props.onSynchronizeData((progress, message) => {
                    // Use functional setState to avoid race conditions
                    this.safeSetState(() => ({
                        isLoading: true,
                        progress,
                        progressMessage: message
                    }));
                });

                if (!result.cancelled) {
                    this.safeSetState({
                        data: result.data,
                        isLoading: false,
                        progress: 100,
                        progressMessage: 'Synchronization complete!'
                    });
                } else {
                    this.safeSetState({ isLoading: false, progress: 0, progressMessage: '' });
                }
            } catch (error) {
                console.error('Error during synchronization:', error);
                this.safeSetState({ isLoading: false, progress: 0, progressMessage: '' });
            }
        })();
    };

    private handleHierarchyClick = (): void => {
        void (async (): Promise<void> => {
            try {
                const result = await this.props.onSynchronizeHierarchy((progress, message) => {
                    // Use functional setState to avoid race conditions
                    this.safeSetState(() => ({
                        isLoading: true,
                        progress,
                        progressMessage: message
                    }));
                });

                if (!result.cancelled) {
                    this.safeSetState({
                        data: result.data,
                        isLoading: false,
                        progress: 100,
                        progressMessage: 'Hierarchy update complete!'
                    });
                } else {
                    this.safeSetState({ isLoading: false, progress: 0, progressMessage: '' });
                }
            } catch (error) {
                console.error('Error during hierarchy synchronization:', error);
                this.safeSetState({ isLoading: false, progress: 0, progressMessage: '' });
            }
        })();
    };

    /**
     * Memoized cell renderer for sync status column
     * Moved outside render to prevent recreation on each render
     */
    private renderSyncStatus = (cellData: { value: unknown }): React.ReactNode => {
        const status = cellData.value as string;
        let color = '#666';
        let text = status || 'Unknown';

        switch (status) {
            case 'synced':
                color = '#107C10';
                text = '✓ Synced';
                break;
            case 'not-synced':
                color = '#D83B01';
                text = '✗ Not Synced';
                break;
            case 'modified':
                color = '#FF8C00';
                text = '⚠ Modified';
                break;
            case 'error':
                color = '#A80000';
                text = '✗ Error';
                break;
        }

        return <span style={{ color, fontWeight: 'bold' }}>{text}</span>;
    };

    /**
     * Progress status formatter - memoized outside render
     */
    private formatProgressStatus = (): string => {
        return `${this.state.progress}%`;
    };

    public render(): React.ReactNode {
        return (
            <div style={{ position: 'relative', width: this.props.width, height: this.props.height }}>
                {this.state.isLoading && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        gap: '20px'
                    }}>
                        <LoadIndicator height={60} width={60} visible={true} />
                        <div style={{ width: '400px', textAlign: 'center' }}>
                            <ProgressBar
                                value={this.state.progress}
                                min={0}
                                max={100}
                                statusFormat={this.formatProgressStatus}
                                showStatus={true}
                            />
                            <div style={{ marginTop: '10px', fontSize: '14px', color: '#333' }}>
                                {this.state.progressMessage}
                            </div>
                        </div>
                    </div>
                )}
                <DataGrid
                    dataSource={this.state.data}
                    showBorders={false}
                    columnAutoWidth={true}
                    width={this.props.width}
                    height={this.props.height}
                    allowColumnReordering={true}
                    allowColumnResizing={true}
                    columnResizingMode="widget"
                    wordWrapEnabled={false}
                >
                    <Toolbar>
                        <Item location="before">
                            <FileUploader
                                selectButtonText="Select CSV/XLSX File"
                                accept=".csv,.xlsx,.xls"
                                uploadMode="instantly"
                                multiple={false}
                                showFileList={false}
                                maxFileSize={10485760}
                                onValueChanged={this.handleValueChanged}
                                width={175}
                                disabled={this.state.isLoading}
                            />
                        </Item>
                        <Item location="before">
                            <Button
                                text="Synchronize Data"
                                type="normal"
                                stylingMode="contained"
                                icon="save"
                                onClick={this.handleSynchronizeClick}
                                disabled={this.state.data.length === 0 || this.state.isLoading}
                            />
                        </Item>
                        <Item location="before">
                            <Button
                                text="Set Manager Relations"
                                type="normal"
                                stylingMode="contained"
                                icon="hierarchy"
                                onClick={this.handleHierarchyClick}
                                disabled={this.state.data.length === 0 || this.state.isLoading}
                            />
                        </Item>
                    </Toolbar>
                    <Column
                        dataField="syncStatus"
                        caption="Status"
                        width={120}
                        cellRender={this.renderSyncStatus}
                    />
                    <Column dataField={CSV_COLUMNS.GLOBAL_ID} caption="Global ID" width={100} />
                    <Column dataField="dataverseId" caption="Dataverse ID" width={280} visible={true} />
                    <Column dataField={CSV_COLUMNS.FIRST_NAME} caption="First Name" width={120} />
                    <Column dataField={CSV_COLUMNS.LAST_NAME} caption="Last Name" width={120} />
                    <Column dataField={CSV_COLUMNS.EMAIL} caption="Email" width={250} />
                    <Column dataField={CSV_COLUMNS.MANAGER_NAME} caption="Manager" width={150} />
                    <Column dataField={CSV_COLUMNS.MANAGER_GLOBAL_ID} caption="Manager Global ID" width={150} />
                    <Scrolling mode="virtual" />
                    <FilterRow visible={true} />
                    <HeaderFilter visible={true} />
                    <Summary>
                        <TotalItem column="Status" summaryType="count" />
                    </Summary>
                </DataGrid>
            </div>
        );
    }
}
