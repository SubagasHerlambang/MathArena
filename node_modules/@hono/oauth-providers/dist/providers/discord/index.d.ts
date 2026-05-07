import { MiddlewareHandler } from 'hono';
import { Scopes, DiscordTokenResponse, DiscordUser } from './types.js';
export { DiscordErrorResponse, DiscordMeResponse } from './types.js';
import { OAuthVariables } from '../../index.js';

declare function discordAuth(options: {
    scope: Scopes[];
    client_id?: string;
    client_secret?: string;
    redirect_uri?: string;
}): MiddlewareHandler;

declare function refreshToken(client_id: string, client_secret: string, refresh_token: string): Promise<DiscordTokenResponse>;

declare function revokeToken(client_id: string, client_secret: string, token: string): Promise<boolean>;

declare module 'hono' {
    interface ContextVariableMap extends OAuthVariables {
        'user-discord': Partial<DiscordUser> | undefined;
    }
}

export { DiscordTokenResponse, DiscordUser, Scopes, discordAuth, refreshToken, revokeToken };
