import jwt from "jsonwebtoken";
import type { IUser } from "../models/User.js";
import type { Types } from "mongoose";

type PopulatedUser = Omit<IUser, '_id' | 'owner_id' | 'assigned_branches'> & {
  _id: Types.ObjectId;
  owner_id?: Types.ObjectId | null;
  assigned_branches?: Types.ObjectId[];
};

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret_key_for_vitest_suite';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_refresh_secret_key_for_vitest_suite';

/**
 * Genera un Access Token JWT (corta duración).
 */
export const generateAccessToken = (user: PopulatedUser) => {
  return jwt.sign(
    {
      userId: user._id.toString(),
      tokenVersion: user.tokenVersion || 0,
      role: user.role,
      permissions: user.permissions || [],
      ownerId: user.owner_id ? user.owner_id.toString() : null,
      assignedBranches: (user.assigned_branches || []).map((id) => id.toString()),
    },
    JWT_SECRET,
    {
      expiresIn: "15m",
    }
  );
};

/**
 * Genera un Refresh Token JWT (larga duración, solo sirve para obtener un nuevo Access Token).
 */
export const generateRefreshToken = (user: PopulatedUser) => {
  return jwt.sign(
    {
      userId: user._id.toString()
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: "7d",
    }
  );
};
