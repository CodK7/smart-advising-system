import dotenv from 'dotenv';

/**
 * Load configuration consistently for the server and database commands.
 * Precedence is shell/platform variables, then .env.local, then .env.
 * Developer-local overrides are ignored in production and tests.
 */
export function loadEnvironment() {
  const useLocalOverrides =
    process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
  dotenv.config({
    path: useLocalOverrides ? ['.env.local', '.env'] : ['.env'],
    quiet: true,
  });
}
