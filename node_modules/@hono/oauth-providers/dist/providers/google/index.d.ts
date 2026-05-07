import { MiddlewareHandler } from 'hono';
import { GoogleUser } from './types.js';
export { GoogleErrorResponse, GoogleTokenInfoResponse, GoogleTokenResponse } from './types.js';
import { OAuthVariables } from '../../index.js';

declare function googleAuth(options: {
    scope: string[];
    login_hint?: string;
    prompt?: 'none' | 'consent' | 'select_account';
    access_type?: 'online' | 'offline';
    client_id?: string;
    client_secret?: string;
    state?: string;
    redirect_uri?: string;
}): MiddlewareHandler;

declare function revokeToken(token: string): Promise<boolean>;

declare module 'hono' {
    interface ContextVariableMap extends OAuthVariables {
        'user-google': Partial<GoogleUser> | undefined;
    }
}

export { GoogleUser, googleAuth, revokeToken };
