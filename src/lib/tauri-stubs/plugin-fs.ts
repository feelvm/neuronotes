// Stub for @tauri-apps/plugin-fs in browser builds
// This module is only used when dynamically imported in Tauri environment

export const BaseDirectory = {
  AppData: 'AppData',
  AppConfig: 'AppConfig',
  AppLocalData: 'AppLocalData',
  AppCache: 'AppCache',
  AppLog: 'AppLog',
  Audio: 'Audio',
  Cache: 'Cache',
  Config: 'Config',
  Data: 'Data',
  Desktop: 'Desktop',
  Document: 'Document',
  Download: 'Download',
  Executable: 'Executable',
  Font: 'Font',
  Home: 'Home',
  LocalData: 'LocalData',
  Picture: 'Picture',
  Public: 'Public',
  Resource: 'Resource',
  Runtime: 'Runtime',
  Template: 'Template',
  Video: 'Video'
} as const;

export async function writeTextFile(
  path: string,
  contents: string,
  options?: { baseDir?: string }
): Promise<void> {
  throw new Error('Tauri FS plugin not available in browser');
}

export async function readTextFile(
  path: string,
  options?: { baseDir?: string }
): Promise<string> {
  throw new Error('Tauri FS plugin not available in browser');
}

export async function mkdir(
  path: string,
  options?: { baseDir?: string; recursive?: boolean }
): Promise<void> {
  throw new Error('Tauri FS plugin not available in browser');
}

export async function exists(
  path: string,
  options?: { baseDir?: string }
): Promise<boolean> {
  throw new Error('Tauri FS plugin not available in browser');
}

export async function remove(
  path: string,
  options?: { baseDir?: string; recursive?: boolean }
): Promise<void> {
  throw new Error('Tauri FS plugin not available in browser');
}

