import Dexie, { type Table } from 'dexie';
import type { DialogItem, FileItem, LogItem, Project, TranslationMemoryEntry } from '../lib/types';

export class AppDB extends Dexie {
  projects!: Table<Project, string>;
  files!: Table<FileItem, string>;
  dialogs!: Table<DialogItem, string>;
  logs!: Table<LogItem, string>;
  tm!: Table<TranslationMemoryEntry, string>;

  constructor() {
    super('vnrpy_db');

    this.version(1).stores({
      projects: '&id, updatedAt',
      files: '&id, projectId, name, updatedAt',
      dialogs: '&id, fileId, idx, updatedAt',
      logs: '&id, projectId, ts',
    });

    this.version(2).stores({
      projects: '&id, updatedAt',
      files: '&id, projectId, name, updatedAt',
      dialogs: '&id, fileId, idx, updatedAt',
      logs: '&id, projectId, ts',
      tm: '&key, targetLang, updatedAt, sourceKey',
    });
  }
}

export const db = new AppDB();
