export interface Comic {
  /** `${driveId}!${itemId}` */
  id: string;
  driveId?: string;
  itemId: string;
  /** Bestandsnaam op OneDrive */
  fileName: string;
  /** Map op OneDrive, bv. "Comics/Marvel/Spider-Man" */
  folderPath: string;
  size: number;

  title: string;
  series: string;
  issue?: number;
  year?: number;

  /** Hoofdthema, bv. "Avengers" of "Civil War" */
  theme: string;
  /** Characters, bv. ["Spider-Man", "Venom"] */
  characters: string[];

  addedAt: number;
  updatedAt: number;
  lastReadAt?: number;
  lastPage?: number;
  pageCount?: number;
  finished?: boolean;

  /** Extra info uit ComicInfo.xml (indien aanwezig in het bestand) */
  writer?: string;
  summary?: string;
}

export interface RemoteLibrary {
  version: 1;
  updatedAt: number;
  comics: Comic[];
  /** id -> tijdstip van verwijderen */
  deleted: Record<string, number>;
}
