/**
 * Centralized Error Handling & Logging Utility
 * Provides consistent error responses and logging across all backend functions
 */

/**
 * Log levels for different types of messages
 */
export const LogLevel = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG'
};

/**
 * Logs a message with context and timestamp
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
 * @param {string} functionName - Name of the function logging
 * @param {string} message - Log message
 * @param {object} context - Additional context (user, params, etc.)
 */
export function log(level, functionName, message, context = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    function: functionName,
    message,
    ...context
  };
  
  const emoji = {
    INFO: 'ℹ️',
    WARN: '⚠️',
    ERROR: '❌',
    DEBUG: '🔍'
  }[level] || '📝';
  
  console.log(`${emoji} [${timestamp}] [${functionName}] ${message}`, context);
  
  return logEntry;
}

/**
 * Standard error response format
 * @param {string} message - User-friendly error message
 * @param {number} status - HTTP status code
 * @param {string} code - Error code for debugging
 * @param {object} details - Additional error details
 */
export function createErrorResponse(message, status = 500, code = 'INTERNAL_ERROR', details = null) {
  return {
    error: message,
    code,
    status,
    details,
    timestamp: new Date().toISOString()
  };
}

/**
 * Wraps async function execution with error handling
 * @param {string} functionName - Name of the function for logging
 * @param {Function} fn - Async function to execute
 * @param {object} context - Context for logging (user, params)
 */
export async function withErrorHandling(functionName, fn, context = {}) {
  try {
    log(LogLevel.INFO, functionName, 'Function started', context);
    const result = await fn();
    log(LogLevel.INFO, functionName, 'Function completed successfully', context);
    return result;
  } catch (error) {
    log(LogLevel.ERROR, functionName, `Error: ${error.message}`, {
      ...context,
      stack: error.stack,
      errorName: error.name
    });
    throw error;
  }
}

/**
 * Common error types with standard responses
 */
export const ErrorTypes = {
  UNAUTHORIZED: (details = null) => createErrorResponse(
    'Unauthorized - Please log in',
    401,
    'UNAUTHORIZED',
    details
  ),
  
  FORBIDDEN: (details = null) => createErrorResponse(
    'Forbidden - You do not have permission',
    403,
    'FORBIDDEN',
    details
  ),
  
  NOT_FOUND: (resource, details = null) => createErrorResponse(
    `${resource} not found`,
    404,
    'NOT_FOUND',
    details
  ),
  
  VALIDATION_ERROR: (message, details = null) => createErrorResponse(
    message,
    400,
    'VALIDATION_ERROR',
    details
  ),
  
  EXTERNAL_API_ERROR: (service, message, details = null) => createErrorResponse(
    `${service} API error: ${message}`,
    502,
    'EXTERNAL_API_ERROR',
    details
  ),
  
  INTERNAL_ERROR: (message = 'An internal error occurred', details = null) => createErrorResponse(
    message,
    500,
    'INTERNAL_ERROR',
    details
  )
};

/**
 * Helper to return a JSON error response
 */
export function jsonErrorResponse(error, functionName = 'unknown') {
  const errorResponse = typeof error === 'string' 
    ? ErrorTypes.INTERNAL_ERROR(error)
    : error.status 
      ? error 
      : ErrorTypes.INTERNAL_ERROR(error.message, { originalError: error.name });
  
  log(LogLevel.ERROR, functionName, 'Returning error response', errorResponse);
  
  return Response.json(errorResponse, { status: errorResponse.status });
}