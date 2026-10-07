import { User, ROLES, type IUser } from "../models/User.js";
import { Category } from "../models/Category.js";
import { Product } from "../models/Product.js";
import { Purchase } from "../models/Purchase.js";
import { PurchaseDetail } from "../models/PurchaseDetail.js";
import { Sale } from "../models/Sale.js";
import { SaleDetail } from "../models/SaleDetail.js";
import mongoose from "mongoose";
import crypto from "crypto";
import jwt from "jsonwebtoken";
// bcryptjs ships its own types inside the package; no @types needed
import bcryptjs from "bcryptjs";
import type { Request, Response } from "express";
import { generateAccessToken, generateRefreshToken } from "../utils/generateToken.js";
import { RefreshToken } from "../models/RefreshToken.js";
import { randomUUID } from "crypto";
import { sendPasswordResetEmail, sendResetSuccessEmail } from "../mailtrap/emails.js";
import { bumpCacheVersion, redis } from "../lib/redis.js";

// ─── CONSTANTES DE SEGURIDAD ────────────────────────────────────────────────
const GRACE_PERIOD_MS = 15_000; // 15 segundos de tolerancia para reintentos legítimos
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
if (!JWT_REFRESH_SECRET) {
  throw new Error("CRITICAL: JWT_REFRESH_SECRET is not defined in environment variables.");
}

export const createUser = async (req: Request, res: Response): Promise<void> => {
  const { email, password, name, role } = req.body as {
    email: string;
    password: string;
    name: string;
    role?: string;
  };

  try {
    // Validar si es administrador el que hace la petición
    const adminUser = await User.findById(req.userId);
    if (!adminUser || adminUser.role !== 'admin') {
      res.status(403).json({ success: false, message: "Sólo los administradores pueden crear usuarios." });
      return;
    }

    const userAlreadyExists = await User.findOne({ email });

    if (userAlreadyExists) {
      res.status(400).json({ success: false, message: "El correo ya está registrado" });
      return;
    }

    const hashedPassword = await bcryptjs.hash(password, 10);

    // Inicia sus 7 días de prueba en el momento en que el admin lo crea
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 7);

    const user = new User({
      email,
      password: hashedPassword,
      name,
      role: role ?? ROLES.TENANT_OWNER,
      subscriptionExpiresAt: expireDate
    });

    await user.save();

    const userObj = user.toObject();
    const { password: _pw, ...userWithoutPassword } = userObj;

    res.status(201).json({
      success: true,
      message: "Usuario creado exitosamente. Ya puede iniciar sesión.",
      user: userWithoutPassword,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };
  try {
    const user = await User.findOne({ email });
    if (!user) {
      res.status(400).json({ success: false, message: "Invalid credentials" });
      return;
    }

    const isPasswordValid = await bcryptjs.compare(password, user.password as string);
    if (!isPasswordValid) {
      res.status(400).json({ success: false, message: "Invalid credentials" });
      return;
    }

    const accessToken = generateAccessToken(user);
    const refreshTokenString = generateRefreshToken(user);

    // Guardar Refresh Token en BD con un nuevo familyId
    const familyId = randomUUID();
    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + 7); // 7 días

    await RefreshToken.create({
      token: refreshTokenString,
      userId: user._id,
      familyId,
      expiresAt: expireDate,
    });

    // Actualizar lastLogin
    const lastLogin = new Date();
    await User.updateOne({ _id: user._id }, { $set: { lastLogin } });

    const userObj = user.toObject();
    const { password: _pw, ...userWithoutPassword } = userObj;

    res.cookie("refreshToken", refreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      success: true,
      message: "Logged in successfully",
      token: accessToken,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("Error in login ", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, message });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      // Revocar el token actual
      await RefreshToken.findOneAndUpdate(
        { token: refreshToken },
        { isRevoked: true }
      );
    }
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.status(200).json({
      success: true,
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Error in logout ", error);
    res.status(500).json({ success: false, message: "Error during logout" });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  const currentToken = req.cookies?.refreshToken;
  if (!currentToken) {
    res.status(401).json({ success: false, message: "No refresh token provided" });
    return;
  }

  // 1. ESCUDO ANTI-DoS (CPU-first)
  try {
    jwt.verify(currentToken, JWT_REFRESH_SECRET as string);
  } catch {
    res.clearCookie("refreshToken");
    res.status(401).json({ success: false, message: "Invalid token signature" });
    return;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const savedToken = await RefreshToken.findOne({ token: currentToken })
      .populate("userId")
      .session(session);

    if (!savedToken) {
      await session.abortTransaction();
      res.clearCookie("refreshToken");
      res.status(401).json({ success: false, message: "Invalid refresh token" });
      return;
    }

    // 2. EVALUACIÓN ESTRICTA DE ROTACIÓN VS REVOCACIÓN
    if (savedToken.isRevoked) {
      const isLegitimateRotation = Boolean(savedToken.replacedAt && savedToken.replacedByToken);
      const elapsed = savedToken.replacedAt ? Date.now() - savedToken.replacedAt.getTime() : Infinity;

      if (isLegitimateRotation && elapsed < GRACE_PERIOD_MS) {
        await session.abortTransaction();
        
        const user = savedToken.userId as unknown as IUser;
        if (!user || !user._id) {
          res.clearCookie("refreshToken");
          res.status(401).json({ success: false, message: "User not found" });
          return;
        }

        const newAccessToken = generateAccessToken(user);
        res.cookie("refreshToken", savedToken.replacedByToken!, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        res.status(200).json({ success: true, token: newAccessToken });
        return;
      }

      // Reutilización ilícita o fuera de ventana: Revocar familia entera
      await RefreshToken.updateMany(
        { familyId: savedToken.familyId },
        { $set: { isRevoked: true } },
        { session }
      );
      await session.commitTransaction();
      res.clearCookie("refreshToken");
      res.status(401).json({ success: false, message: "Token reuse detected. Session terminated." });
      return;
    }

    // 3. VALIDACIÓN DE EXPIRACIÓN Y USUARIO
    if (savedToken.expiresAt < new Date()) {
      await session.abortTransaction();
      res.clearCookie("refreshToken");
      res.status(401).json({ success: false, message: "Refresh token expired" });
      return;
    }

    const user = savedToken.userId as unknown as IUser;
    if (!user || !user._id) {
      await session.abortTransaction();
      res.clearCookie("refreshToken");
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }

    // 4. ROTACIÓN ESTRICTA DE TOKENS
    const newAccessToken = generateAccessToken(user);
    const newRefreshTokenString = generateRefreshToken(user);
    const expireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    savedToken.isRevoked = true;
    savedToken.replacedAt = new Date();
    savedToken.replacedByToken = newRefreshTokenString;
    await savedToken.save({ session });

    await RefreshToken.create(
      [
        {
          token: newRefreshTokenString,
          userId: user._id,
          familyId: savedToken.familyId,
          expiresAt: expireDate,
        },
      ],
      { session }
    );

    await session.commitTransaction();

    res.cookie("refreshToken", newRefreshTokenString, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ success: true, token: newAccessToken });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ success: false, message });
  } finally {
    session.endSession();
  }
};


export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email: string };
  try {
    const user = await User.findOne({ email });

    if (!user) {
      res.status(400).json({ success: false, message: "User not found" });
      return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetTokenExpiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpiresAt = resetTokenExpiresAt;

    await user.save();

    // send email
    await sendPasswordResetEmail(
      user.email,
      `${process.env.CLIENT_URL}/reset-password/${resetToken}`
    );

    res.status(200).json({ success: true, message: "Password reset link sent to your email" });
  } catch (error) {
    console.error("Error in forgotPassword ", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, message });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { password } = req.body as { password: string };

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiresAt: { $gt: Date.now() },
    });

    if (!user) {
      res.status(400).json({ success: false, message: "Invalid or expired reset token" });
      return;
    }

    // update password
    const hashedPassword = await bcryptjs.hash(password, 10);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiresAt = undefined;
    await user.save();

    await sendResetSuccessEmail(user.email);

    res.status(200).json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Error in resetPassword ", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ success: false, message });
  }
};

export const checkAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      res.status(401).json({ success: false, message: "User not found" });
      return;
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Error in checkAuth ", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, message });
  }
};

export const purgeUserAndData = async (req: Request, res: Response): Promise<void> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const adminUser = await User.findById(req.userId).session(session);
    if (!adminUser || adminUser.role !== 'admin') {
      await session.abortTransaction();
      session.endSession();
      res.status(403).json({ success: false, message: "Sólo administradores pueden purgar cuentas." });
      return;
    }

    const { targetUserId } = req.params;

    // Evitar auto-eliminación por seguridad
    if (adminUser._id.toString() === targetUserId) {
      await session.abortTransaction();
      session.endSession();
      res.status(400).json({ success: false, message: "No puedes eliminar tu propia cuenta." });
      return;
    }

    // 1. Eliminar datos transaccionales en Cascada (ACID: todo o nada)
    const userPurchases = await Purchase.find({ admin_id: targetUserId }).session(session);
    const purchaseIds = userPurchases.map(p => p._id);
    await PurchaseDetail.deleteMany({ purchase_id: { $in: purchaseIds } }).session(session);
    await Purchase.deleteMany({ admin_id: targetUserId }).session(session);

    const userSales = await Sale.find({ business_owner_id: targetUserId }).session(session);
    const saleIds = userSales.map(s => s._id);
    await SaleDetail.deleteMany({ sale_id: { $in: saleIds } }).session(session);
    await Sale.deleteMany({ business_owner_id: targetUserId }).session(session);

    // 2. Eliminar Catálogo del usuario
    await Product.deleteMany({ user: targetUserId }).session(session);
    await Category.deleteMany({ user: targetUserId }).session(session);

    // 3. Eliminar empleados del usuario (quedarían huérfanos con owner_id inválido)
    const userEmployees = await User.find({ owner_id: targetUserId, role: 'employee' }).session(session);
    const employeeIds = userEmployees.map(emp => emp._id.toString());
    await User.deleteMany({ owner_id: targetUserId, role: 'employee' }).session(session);

    // 4. Eliminar Usuario (si no existe, abort y 404)
    const deletedUser = await User.findByIdAndDelete(targetUserId).session(session);
    if (!deletedUser) {
      await session.abortTransaction();
      session.endSession();
      res.status(404).json({ success: false, message: "Usuario no encontrado." });
      return;
    }

    // 5. Confirmar todo en un único commit atómico
    await session.commitTransaction();
    session.endSession();

    // Invalidar sesiones en Redis de inmediato
    try {
      const redisPromises: Promise<unknown>[] = [
        redis.set(`tokenVersion:${targetUserId}`, "999999", { ex: 7 * 24 * 60 * 60 })
      ];
      for (const empId of employeeIds) {
        redisPromises.push(redis.set(`tokenVersion:${empId}`, "999999", { ex: 7 * 24 * 60 * 60 }));
      }
      await Promise.all(redisPromises);
    } catch (redisError) {
      const msg = redisError instanceof Error ? redisError.message : String(redisError);
      console.error("Error invalidating deleted user sessions in Redis:", msg);
    }

    // 6. Invalidar caché del usuario purgado usando bumpCacheVersion
    //    (el formato real es versionado: "products:v3:p1:l20:userId" — invalidateCache con claves simples no funciona)
    const targetId = targetUserId as string;
    await Promise.all([
      bumpCacheVersion('categories', targetId),
      bumpCacheVersion('products',   targetId),
      bumpCacheVersion('purchases',  targetId),
      bumpCacheVersion('sales',      targetId),
    ]);

    res.status(200).json({ success: true, message: "El usuario y todos sus registros han sido purgados exitosamente de la base de datos." });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    session.endSession();
    console.error("Error in purgeUserAndData ", error);
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, message });
  }
};
