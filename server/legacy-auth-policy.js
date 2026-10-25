// Google/Firebase is the preferred login. Legacy JWT must never work with a
// public example key simply because production configuration is missing.
function legacyAuthPolicy(env = process.env) {
    const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : '';
    const explicitlyDisabled = String(env.ALLOW_LEGACY_JWT ?? '').trim().toLowerCase() === 'false';
    const usableSecret = !!secret.trim() && secret.trim() !== 'itrc-secret-key-change-in-production';
    return { secret: usableSecret ? secret : '', enabled: usableSecret && !explicitlyDisabled };
}
module.exports = { legacyAuthPolicy };
