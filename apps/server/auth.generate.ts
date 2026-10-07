import { betterAuth } from 'better-auth';
import { authOptions } from './src/auth/options.js';

// CLI --adapter/--dialect selects the target without opening a database.
export const auth = betterAuth(authOptions);
