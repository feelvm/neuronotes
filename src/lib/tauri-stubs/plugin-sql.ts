// Stub for @tauri-apps/plugin-sql in browser builds
// This module is only used when dynamically imported in Tauri environment

class Database {
  static async load(name: string): Promise<Database> {
    throw new Error('Tauri SQL plugin not available in browser');
  }
  
  async execute(sql: string, bindValues?: any[]): Promise<void> {
    throw new Error('Tauri SQL plugin not available in browser');
  }
  
  async select<T = any>(sql: string, bindValues?: any[]): Promise<T[]> {
    throw new Error('Tauri SQL plugin not available in browser');
  }
}

export default Database;

