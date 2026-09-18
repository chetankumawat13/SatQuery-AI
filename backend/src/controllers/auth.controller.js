import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import config from "../config/config.js";
import User from "../models/user.model.js";
import { asyncHandler } from "../utils/error.handler.js";
import { blocklistToken } from "../services/tokenBlocklist.service.js";

const SALT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
};

const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const mobileAuthData = (req, user, accessToken, refreshToken) =>
  req.get("X-Client") === "mobile"
    ? { user: publicUser(user), accessToken, refreshToken }
    : { user: publicUser(user) };

/**
 * @description Signs a short-lived JWT access token for a given user ID. Sent
 * with every authenticated request via the Authorization header. Includes a
 * unique `jti` claim so this specific token can be individually blocklisted
 * in Redis on logout, without affecting the user's other active sessions.
 * @param {string} userId - The MongoDB _id of the user to encode in the token.
 * @access Private
 */
const signAccessToken = (userId) =>
  jwt.sign({ id: userId, jti: crypto.randomUUID() }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

/**
 * @description Signs a longer-lived JWT refresh token for a given user ID.
 * Only ever used to obtain a new access token via /api/auth/refresh — never
 * sent on normal API requests.
 * @param {string} userId - The MongoDB _id of the user to encode in the token.
 * @access Private
 */
const signRefreshToken = (userId) =>
  jwt.sign({ id: userId }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiresIn,
  });

/**
 * @description Strips sensitive/internal fields off a user document before it
 * is ever sent in an API response.
 * @param {import("mongoose").Document} user - A full User mongoose document.
 * @access Private
 */
const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organisation: user.organisation,
  isActive: user.isActive,
  createdAt: user.createdAt,
});

/**
 * @description Creates a new user account. Hashes the password before storage,
 * always assigns the default "analyst" role regardless of what the client
 * sends (role escalation is blocked at the validation layer too), and
 * returns a fresh access + refresh token pair on success.
 * @route POST /api/auth/register
 * @access Public
 */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, organisation } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "An account with this email already exists",
    });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // role is intentionally never taken from req.body — always defaults to "analyst"
  const user = await User.create({
    name,
    email,
    passwordHash,
    organisation,
  });

  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  await user.save();
  setAuthCookies(res, accessToken, refreshToken);

  res.status(201).json({
    success: true,
    data: mobileAuthData(req, user, accessToken, refreshToken),
  });
});

/**
 * @description Authenticates a user by email + password. Applies a lockout
 * after repeated failed attempts (5 failures -> 15 minute lock) to slow down
 * brute-force attempts, and rejects deactivated accounts outright.
 * @route POST /api/auth/login
 * @access Public
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select(
    "+passwordHash +refreshTokenHash"
  );

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  }

  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    return res.status(423).json({
      success: false,
      message: `Account temporarily locked. Try again in ${minutesLeft} minute(s).`,
    });
  }

  if (!user.isActive) {
    return res.status(403).json({ success: false, message: "This account has been deactivated" });
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);

  if (!isMatch) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    return res.status(401).json({ success: false, message: "Invalid email or password" });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();

  const accessToken = signAccessToken(user._id);
  const refreshToken = signRefreshToken(user._id);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  await user.save();
  setAuthCookies(res, accessToken, refreshToken);

  res.status(200).json({
    success: true,
    data: mobileAuthData(req, user, accessToken, refreshToken),
  });
});

/**
 * @description Exchanges a valid, previously-issued refresh token for a new
 * short-lived access token, without requiring the user to log in again. The
 * refresh token itself is verified both cryptographically (JWT signature)
 * and against the hashed copy stored on the user document.
 * @route POST /api/auth/refresh
 * @access Public (requires a valid refresh token in the request body)
 */
export const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: "Refresh token is required" });
  }

  let decoded;
  try {
    decoded = jwt.verify(refreshToken, config.jwtRefreshSecret);
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired refresh token" });
  }

  const user = await User.findById(decoded.id).select("+refreshTokenHash");
  if (!user || !user.refreshTokenHash) {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }

  const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!isValid) {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }

  const newAccessToken = signAccessToken(user._id);
  res.cookie("accessToken", newAccessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000,
  });
  res.status(200).json({
    success: true,
    data:
      req.get("X-Client") === "mobile"
        ? { accessToken: newAccessToken }
        : {},
  });
});

/**
 * @description Logs the current user out two ways: (1) clears their stored
 * refresh token hash in MongoDB, so /refresh calls with the old refresh
 * token fail; (2) blocklists this specific access token's jti in Redis
 * (if configured), so it's rejected immediately on the next request instead
 * of remaining valid until its natural expiry. If Redis isn't configured,
 * step 2 is silently skipped — logout still succeeds, just without
 * immediate access-token invalidation.
 * @route POST /api/auth/logout
 * @access Private
 */
export const logout = asyncHandler(async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { $unset: { refreshTokenHash: 1 } }
  );

  const { jti, exp } = req.tokenPayload || {};
  if (jti && exp) {
    const ttlSeconds = exp - Math.floor(Date.now() / 1000);
    await blocklistToken(jti, ttlSeconds);
  }

  res.clearCookie("accessToken", cookieOptions);
  res.clearCookie("refreshToken", cookieOptions);

  // Remove cookies created before the shared root path was configured.
  res.clearCookie("accessToken", { ...cookieOptions, path: "/api/auth" });
  res.clearCookie("refreshToken", { ...cookieOptions, path: "/api/auth" });

  res.status(200).json({ success: true, message: "Logged out successfully" });
});

/**
 * @description Returns the profile of the currently authenticated user, based
 * on the user document attached by the `protect` middleware.
 * @route GET /api/auth/me
 * @access Private
 */
export const getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { user: publicUser(req.user) } });
});
