/**
 * Security utility functions for input validation and sanitization
 */

/**
 * Safely parses JSON with error handling
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn('[security] Failed to parse JSON:', error);
    return fallback;
  }
}

/**
 * Validates backup data structure
 */
export interface BackupDataStructure {
  version?: string;
  backupDate?: string;
  metadata?: {
    id?: string;
    timestamp?: number;
    date?: string;
    size?: number;
    type?: string;
    description?: string;
  };
  data?: {
    workspaces?: unknown[];
    folders?: unknown[];
    notes?: unknown[];
    calendarEvents?: unknown[];
    kanban?: unknown[];
    settings?: unknown[];
  };
}

export function validateBackupData(data: unknown): data is BackupDataStructure {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const backup = data as Record<string, unknown>;
  
  // Check for required top-level structure
  if (!backup.metadata && !backup.data && !backup.workspaces) {
    return false;
  }

  // Validate metadata if present
  if (backup.metadata) {
    if (typeof backup.metadata !== 'object') {
      return false;
    }
    const metadata = backup.metadata as Record<string, unknown>;
    if (metadata.id && typeof metadata.id !== 'string') {
      return false;
    }
    if (metadata.timestamp && typeof metadata.timestamp !== 'number') {
      return false;
    }
  }

  // Validate data structure if present
  if (backup.data && typeof backup.data !== 'object') {
    return false;
  }

  return true;
}

/**
 * Validates password strength
 */
export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password is too common or weak');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates and sanitizes redirect URL to prevent open redirect attacks
 */
export function validateRedirectUrl(url: string, allowedOrigins: string[] = []): string | null {
  try {
    const parsedUrl = new URL(url, window.location.origin);
    
    // Only allow same origin by default
    if (parsedUrl.origin !== window.location.origin) {
      // Check against allowed origins if provided
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(parsedUrl.origin)) {
        return null;
      }
      // If no allowed origins specified, reject external URLs
      if (allowedOrigins.length === 0) {
        return null;
      }
    }

    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return null;
    }

    return parsedUrl.toString();
  } catch (error) {
    console.warn('[security] Invalid redirect URL:', error);
    return null;
  }
}

/**
 * Sanitizes error messages to prevent information disclosure
 */
export function sanitizeErrorMessage(error: unknown, userFacing: boolean = true): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (userFacing) {
    // Generic error messages for users
    if (errorMessage.includes('SQL') || errorMessage.includes('database')) {
      return 'A database error occurred. Please try again.';
    }
    if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      return 'A network error occurred. Please check your connection.';
    }
    if (errorMessage.includes('auth') || errorMessage.includes('authentication')) {
      return 'Authentication failed. Please check your credentials.';
    }
    if (errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
      return 'You do not have permission to perform this action.';
    }
    // Generic fallback
    return 'An error occurred. Please try again.';
  }

  // Return full error for logging
  return errorMessage;
}

/**
 * Escapes HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

