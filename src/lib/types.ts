export type ExtractMode = 'safe' | 'balanced' | 'aggressive';

export type EngineKind = 'deepseek' | 'deepl' | 'lingva';

export type LogLevel = 'info' | 'warn' | 'error';

export type ProjectSettings = {
  mode: ExtractMode;
  targetLang: string;
  sourceLang: string;
  engine: EngineKind;
  batchSize: number;
  concurrency: number;
  lingvaBaseUrl: string;
  tmEnabled: boolean;
  tmAutoAdd: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
};

export type FileItem = {
  id: string;
  projectId: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  sourceText: string;
  eol: '\n' | '\r\n';
  dialogCount: number;
};

export type DialogItem = {
  id: string;
  fileId: string;
  idx: number;
  lineIndex: number;
  contentStart: number;
  contentEnd: number;
  quoteChar: '"' | "'";
  isTriple: boolean;
  quote: string;
  maskedQuote: string;
  placeholderMap: Record<string, string>;
  cacheKey: string;
  translated: string | null;
  updatedAt: number;
};

export type TranslationMemoryEntry = {
  key: string;
  targetLang: string;
  sourceKey: string;
  sourceText: string;
  translatedText: string;
  createdAt: number;
  updatedAt: number;
  useCount: number;
};

export type LogItem = {
  id: string;
  projectId: string;
  ts: number;
  level: LogLevel;
  message: string;
};
