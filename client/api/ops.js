import { getVercelOidcToken } from '@vercel/oidc';
import { createOpsProxy } from '../server/ops-proxy.mjs';

// Server function only. Never import this entry or @vercel/oidc into browser code.
// Read the short-lived token for each request; do not cache or accept a caller token.
export default createOpsProxy({ getOidcToken: getVercelOidcToken });
