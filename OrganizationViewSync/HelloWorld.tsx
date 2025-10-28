import * as React from 'react';
import Button from 'devextreme-react/button';
import DataGrid, { Column, Paging, Scrolling, HeaderFilter, FilterRow } from 'devextreme-react/data-grid';

export interface IHelloWorldProps {
  onFileUpload: (file: File) => Promise<Record<string, unknown>[]>;
  width: number;
  height: number;
}

interface IHelloWorldState {
  data: Record<string, unknown>[];
}

export class HelloWorld extends React.Component<IHelloWorldProps, IHelloWorldState> {
  private fileInputRef: React.RefObject<HTMLInputElement>;

  constructor(props: IHelloWorldProps) {
    super(props);
    this.fileInputRef = React.createRef();
    this.state = {
      data: []
    };
  }

  private handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      void (async (): Promise<void> => {
        try {
          const data = await this.props.onFileUpload(file);
          this.setState({ data });
        } catch (error) {
          console.error('Error loading file:', error);
        }
      })();
      // Reset input to allow selecting the same file again
      event.target.value = '';
    }
  };

  private handleUploadClick = (): void => {
    this.fileInputRef.current?.click();
  };

  public render(): React.ReactNode {
    const padding = 8;
    const buttonHeight = 36;
    const gridWidth = this.props.width - (padding * 2);
    const gridHeight = this.props.height - (padding * 3) - buttonHeight;

    console.log('Rendering with data length:', this.state.data.length);

    return (
      <div style={{ padding: `${padding}px`, textAlign: 'left', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: `${padding}px` }}>
          <input
            ref={this.fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={this.handleFileChange}
            style={{ display: 'none' }}
          />
          <Button
            text="Upload CSV/XLSX File"
            icon="upload"
            type="default"
            stylingMode="contained"
            onClick={this.handleUploadClick}
            width={200}
          />
        </div>
        
        {this.state.data.length > 0 && (
          <div style={{ flex: 1 }}>
            <DataGrid
              dataSource={this.state.data}
              showBorders={true}
              columnAutoWidth={true}
              width={gridWidth}
              height={gridHeight}
              allowColumnReordering={true}
              allowColumnResizing={true}
              columnResizingMode="widget"
            >
              <Scrolling mode="virtual" />
              <Paging enabled={false} />
              <FilterRow visible={true} />
              <HeaderFilter visible={true} />
            </DataGrid>
          </div>
        )}
      </div>
    );
  }
}
