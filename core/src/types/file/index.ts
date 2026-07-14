export type FileStat = {
  isDirectory: boolean
  size: number
}

/**
 * The file metadata
 */
export type FileMetadata = {
  /**
   * The origin file path.
   */
  file_path: string

  /**
   * The file name.
   */
  file_name: string
}
