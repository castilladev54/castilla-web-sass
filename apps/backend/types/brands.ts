import { Types } from "mongoose";

declare const brand: unique symbol;
export type Brand<T, TBrand> = T & { readonly [brand]: TBrand };

export type BusinessOwnerId = Brand<Types.ObjectId, "BusinessOwnerId">;
export type ActorId = Brand<Types.ObjectId, "ActorId">;
export type BranchId = Brand<Types.ObjectId, "BranchId">;
export type ProductId = Brand<Types.ObjectId, "ProductId">;
export type CategoryId = Brand<Types.ObjectId, "CategoryId">;
export type CustomerId = Brand<Types.ObjectId, "CustomerId">;
