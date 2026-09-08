// File System Access API typing for the Titlebar export menu (OBJ/GLB/URDF).
// Not part of the default DOM lib; vendored from the legacy viewer so the
// export feature type-checks single-origin.

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BlobPart): Promise<void>
  close(): Promise<void>
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}
