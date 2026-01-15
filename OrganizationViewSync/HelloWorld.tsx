import * as React from 'react';
import FileUploader, { type FileUploaderTypes } from 'devextreme-react/file-uploader';
import DataGrid, { Column, Paging, Scrolling, HeaderFilter, FilterRow, Toolbar, Item, TotalItem, Summary } from 'devextreme-react/data-grid';
import Button from 'devextreme-react/button';
import LoadIndicator from 'devextreme-react/load-indicator';
import ProgressBar from 'devextreme-react/progress-bar';

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

  private handleValueChanged = (e: FileUploaderTypes.ValueChangedEvent): void => {
    const files = e.value as File[] | null;
    const file = files?.[0];
    if (file) {
      this.setState({ isLoading: true, progress: 0, progressMessage: 'Loading file...' });
      
      void (async (): Promise<void> => {
        try {
          const data = await this.props.onFileUpload(file, (progress, message) => {
            this.setState({ progress, progressMessage: message });
          });
          this.setState({ 
            data,
            uploadedFileName: file.name,
            isLoading: false,
            progress: 100,
            progressMessage: 'Complete!'
          });
        } catch (error) {
          console.error('Error loading file:', error);
          this.setState({ isLoading: false, progress: 0, progressMessage: '' });
        }
      })();
    }
  };

  private handleSynchronizeClick = (): void => {
    // Don't set isLoading here - wait for confirmation first
    
    void (async (): Promise<void> => {
      try {
        const result = await this.props.onSynchronizeData((progress, message) => {
          // Only set loading state when we receive first progress update (after confirmation)
          if (!this.state.isLoading) {
            this.setState({ isLoading: true });
          }
          this.setState({ progress, progressMessage: message });
        });
        
        // Only update data if not cancelled
        if (!result.cancelled) {
          this.setState({ 
            data: result.data,
            isLoading: false,
            progress: 100,
            progressMessage: 'Synchronization complete!'
          });
        } else {
          // User cancelled - reset state
          this.setState({ isLoading: false, progress: 0, progressMessage: '' });
        }
      } catch (error) {
        console.error('Error during synchronization:', error);
        this.setState({ isLoading: false, progress: 0, progressMessage: '' });
      }
    })();
  };

  private handleHierarchyClick = (): void => {
    // Don't set isLoading here - wait for confirmation first
    
    void (async (): Promise<void> => {
      try {
        const result = await this.props.onSynchronizeHierarchy((progress, message) => {
          // Only set loading state when we receive first progress update (after confirmation)
          if (!this.state.isLoading) {
            this.setState({ isLoading: true });
          }
          this.setState({ progress, progressMessage: message });
        });
        
        // Only update data if not cancelled
        if (!result.cancelled) {
          this.setState({ 
            data: result.data,
            isLoading: false,
            progress: 100,
            progressMessage: 'Hierarchy update complete!'
          });
        } else {
          // User cancelled - reset state
          this.setState({ isLoading: false, progress: 0, progressMessage: '' });
        }
      } catch (error) {
        console.error('Error during hierarchy synchronization:', error);
        this.setState({ isLoading: false, progress: 0, progressMessage: '' });
      }
    })();
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
                statusFormat={(ratio) => `${this.state.progress}%`}
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
          cellRender={(cellData: { value: unknown }) => {
            const status = cellData.value as string;
            let color = '#666';
            let text = status;
            
            if (status === 'synced') {
              color = '#107C10';
              text = 'Synced';
            } else if (status === 'not-synced') {
              color = '#D83B01';
              text = 'Not Synced';
            } else if (status === 'modified') {
              color = '#FF8C00';
              text = 'Modified';
            }
            
            return <span style={{ color, fontWeight: 'bold' }}>{text}</span>;
          }}
        />
        <Column dataField="Global ID" caption="Global ID" width={100} />
        <Column dataField="dataverseId" caption="Dataverse ID" width={250} visible={true} />
        <Column dataField="First Name" caption="First Name" width={120} />
        <Column dataField="Last Name" caption="Last Name" width={120} />
        <Column dataField="Business  Email Information Email Address" caption="Email" width={250} />
        <Column dataField="Position Title" caption="Position Title" width={180} />
        <Column dataField="Manager Name" caption="Manager Name" width={150} />
        <Column dataField="Manager Global ID" caption="Manager Global ID" width={140} />
        <Scrolling mode="virtual" />
        {/* <Paging enabled={false} /> */}
        <FilterRow visible={true} />
        <HeaderFilter visible={true} />
        <Summary>
          <TotalItem column="syncStatus" summaryType="count" />
        </Summary>
      </DataGrid>
      </div>
    );
  }
}
