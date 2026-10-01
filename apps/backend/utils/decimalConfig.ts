import Big from "big.js";
import mongoose from "mongoose";

// ⚠️ Optimizador de V8 para Serialización de Decimal128 (O(1) C++)
// Evita bucles recursivos en .lean() y .aggregate() al hacer res.json()
Object.defineProperty(mongoose.Types.Decimal128.prototype, "toJSON", {
  value: function (this: mongoose.Types.Decimal128) {
    return this.toString();
  },
});

type DecimalValue =
  | mongoose.Types.Decimal128
  | string
  | number
  | null
  | undefined;

type DecimalSchemaOptions = mongoose.SchemaTypeOptions<
  mongoose.Types.Decimal128
>;

const decimalSetter = (value: DecimalValue) => {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof mongoose.Types.Decimal128) {
    return value;
  }

  return mongoose.Types.Decimal128.fromString(
    Big(value.toString()).toString()
  );
};

export const createDecimalConfig = (
  options: Pick<DecimalSchemaOptions, "required" | "default"> = {
    required: true,
  }
): DecimalSchemaOptions => {
  return {
    type: mongoose.Schema.Types.Decimal128,
    required: options.required ?? true,
    default: options.default,

    set: decimalSetter,
  };
};

export const DecimalConfig = createDecimalConfig({
  required: true,
});

export const DecimalOptionalConfig = createDecimalConfig({
  required: false,
  default: null,
});