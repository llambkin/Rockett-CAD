import { Type, type Static } from "typebox";

export const user = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 100 }),
    username: Type.String({ pattern: "^[a-z0-9._-]{1,32}$" }),
    displayName: Type.String({ minLength: 1, maxLength: 100 }),
    role: Type.Union([Type.Literal("admin"), Type.Literal("member")]),
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
    email: Type.Optional(
      Type.String({
        maxLength: 254,
        pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      }),
    ),
    totp: Type.Optional(Type.Boolean()),
    createdAt: Type.String(),
    modifiedAt: Type.String(),
  },
  { additionalProperties: false },
);

export type User = Static<typeof user>;

export interface SignInStep {
  step: "enrol" | "code";
}

export interface TotpEnrolment {
  secret: string;
  uri: string;
}
