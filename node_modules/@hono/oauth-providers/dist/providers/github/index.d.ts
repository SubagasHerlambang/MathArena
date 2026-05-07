import { OAuthVariables } from '../../index.js';
import { GitHubScope, GitHubUser } from './types.js';
export { GitHubEmailResponse, GitHubErrorResponse, GitHubTokenResponse } from './types.js';
import { MiddlewareHandler } from 'hono';

declare function githubAuth(options: {
    client_id?: string;
    client_secret?: string;
    scope?: GitHubScope[];
    oauthApp?: boolean;
    redirect_uri?: string;
}): MiddlewareHandler;

declare module 'hono' {
    interface ContextVariableMap extends OAuthVariables {
        'user-github': Partial<GitHubUser> | undefined;
    }
}

export { GitHubScope, GitHubUser, githubAuth };
