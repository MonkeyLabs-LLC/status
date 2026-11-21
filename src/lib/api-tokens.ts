



import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { postStatus, StatusServiceError } from './status-client';
export function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}
export function generateToken(): string {
    return randomBytes(32).toString('hex');
}

export async function validateApiToken(token: string) {
    if (!token)
        return null;
    {
        const result = await postStatus<Record<string, string>, {
            valid: boolean;
            token_id?: string;
            name?: string;
            scope?: string;
        }>('/internal/auth/api-tokens/validate', {
            version: 'credential-registry/v1',
            request_id: `api-token-validate_${randomUUID()}`,
            token,
            required_scope: 'read',
            validated_at: new Date().toISOString(),
        });
        if (result.valid === false)
            return null;
        if (result.valid !== true || !result.token_id || !result.scope) {
            throw new StatusServiceError('Invalid API token validation response.', 502);
        }
        return { id: result.token_id, name: result.name ?? '', scope: result.scope };
    }
}


/** Validate a Bearer token from the Authorization header and enforce a minimum scope level. Returns the token row, or null on any failure. */
export async function requireApiToken(request: Request, minScope: 'read' | 'write' | 'full') {
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer '))
        return null;
    const token = await validateApiToken(auth.slice(7));
    if (!token)
        return null;
    const scopeRank: Record<string, number> = { read: 1, write: 2, full: 3 };
    if ((scopeRank[token.scope] ?? 0) < (scopeRank[minScope] ?? 3))
        return null;
    return token;
}
