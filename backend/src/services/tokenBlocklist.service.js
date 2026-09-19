import { getRedisClient, isRedisConfigured } from "../config/redis.config.js";

const PREFIX = "blocklist:jti:";

/**
 * @description Adds a token's unique ID (jti) to the Redis blocklist so
 * `protect` middleware rejects it on any future request, even though the
 * JWT signature itself is still valid until it naturally expires. The Redis
 * key is given the SAME remaining TTL as the token, so blocklist entries
 * clean themselves up automatically — no stale data accumulates.
 * @param {string} jti - unique token ID (see auth.controller.js signing helpers)
 * @param {number} ttlSeconds - seconds until the token's natural expiry
 * @returns {Promise<boolean>} true if blocklisted, false if Redis isn't
 *   configured/reachable (caller should treat this as "best effort only" —
 *   the refresh-token invalidation in MongoDB still happens regardless)
 * @access Private
 */
export const blocklistToken = async (jti, ttlSeconds) => {
  if (!isRedisConfigured() || ttlSeconds <= 0) return false;

  const client = getRedisClient();
  if (!client) return false;

  try {
    await client.set(PREFIX + jti, "1", "EX", ttlSeconds);
    return true;
  } catch (err) {
    console.warn("Failed to blocklist token in Redis:", err.message);
    return false;
  }
};

/**
 * @description Checks whether a token's jti has been blocklisted (i.e. the
 * user logged out before this access token's natural expiry). Returns false
 * (not blocklisted) if Redis isn't configured/reachable — this is a
 * deliberate fail-open choice: losing Redis should degrade logout security,
 * not lock every user out of the app.
 * @param {string} jti
 * @returns {Promise<boolean>}
 * @access Private
 */
export const isTokenBlocklisted = async (jti) => {
  if (!isRedisConfigured() || !jti) return false;

  const client = getRedisClient();
  if (!client) return false;

  try {
    const result = await client.get(PREFIX + jti);
    return result === "1";
  } catch (err) {
    console.warn("Failed to check token blocklist in Redis:", err.message);
    return false;
  }
};