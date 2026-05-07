import { MiddlewareHandler } from 'hono';
import { XScopes, XFields, XTokenResponse, XUser } from './types.js';
export { XErrorResponse, XMeResponse, XRevokeResponse } from './types.js';
import { OAuthVariables } from '../../index.js';

declare function xAuth(options: {
    scope: XScopes[];
    fields?: XFields[];
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
}): MiddlewareHandler;

declare function refreshToken(client_id: string, client_secret: string, refresh_token: string): Promise<XTokenResponse>;

declare function revokeToken(client_id: string, client_secret: string, token: string): Promise<boolean>;

declare module 'hono' {
    interface ContextVariableMap extends OAuthVariables {
        'user-x': Partial<XUser> | undefined;
    }
}

export { XFields, XScopes, XTokenResponse, XUser, refreshToken, revokeToken, xAuth };
